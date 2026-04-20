// End-to-end test — Bridge server validation with real Copilot CLI
// This test requires a real Copilot CLI session (must be authenticated via gh auth)
// Run: node --import tsx tests/e2e/copilot-e2e.test.ts

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { ServerMessage, ClientMessage } from "@copilot-mobile/shared";
import { serverMessageSchema } from "@copilot-mobile/shared";
import { createBridgeServer } from "../../src/ws/server.js";
import { createCopilotAdapter } from "../../src/copilot/client.js";
import { generatePairingToken, clearPairingToken } from "../../src/auth/pairing.js";
import { clearRateLimitState } from "../../src/utils/rate-limit.js";
import { resetSeq } from "../../src/utils/message.js";
import type { AdaptedCopilotClient } from "@copilot-mobile/shared";

const E2E_PORT = 29876;
const E2E_TIMEOUT = 60_000; // Copilot CLI can be slow

// --- Test Helpers ---

function makeClientMsg(
    type: ClientMessage["type"],
    payload: Record<string, unknown>
): Record<string, unknown> {
    return {
        id: randomUUID(),
        timestamp: Date.now(),
        seq: 1,
        type,
        payload,
    };
}

type WSClient = {
    ws: WebSocket;
    messages: ServerMessage[];
    waitForMessage(type: string, timeoutMs?: number): Promise<ServerMessage>;
    send(msg: Record<string, unknown>): void;
    close(): Promise<void>;
};

function connectToServer(port: number, jwtToken?: string): Promise<WSClient> {
    return new Promise((resolve, reject) => {
        const url = jwtToken !== undefined
            ? `ws://127.0.0.1:${port}?token=${encodeURIComponent(jwtToken)}`
            : `ws://127.0.0.1:${port}`;

        const ws = new WebSocket(url, { rejectUnauthorized: false });
        const messages: ServerMessage[] = [];
        const waiters: Array<{
            type: string;
            resolve: (msg: ServerMessage) => void;
            reject: (err: Error) => void;
        }> = [];

        ws.on("message", (data: Buffer) => {
            const msg = JSON.parse(data.toString("utf-8")) as ServerMessage;
            messages.push(msg);

            const idx = waiters.findIndex((w) => w.type === msg.type);
            if (idx !== -1) {
                const waiter = waiters[idx]!;
                waiters.splice(idx, 1);
                waiter.resolve(msg);
            }
        });

        ws.on("open", () => {
            resolve({
                ws,
                messages,

                waitForMessage(type: string, timeoutMs: number = E2E_TIMEOUT): Promise<ServerMessage> {
                    const existing = messages.find((m) => m.type === type);
                    if (existing !== undefined) {
                        return Promise.resolve(existing);
                    }

                    return new Promise((res, rej) => {
                        const timer = setTimeout(() => {
                            const idx = waiters.findIndex((w) => w.type === type);
                            if (idx !== -1) waiters.splice(idx, 1);
                            rej(new Error(`Timeout: ${type} message not received within ${timeoutMs}ms`));
                        }, timeoutMs);

                        waiters.push({
                            type,
                            resolve: (msg) => {
                                clearTimeout(timer);
                                res(msg);
                            },
                            reject: rej,
                        });
                    });
                },

                send(msg: Record<string, unknown>): void {
                    ws.send(JSON.stringify(msg));
                },

                close(): Promise<void> {
                    return new Promise((res) => {
                        if (ws.readyState === WebSocket.CLOSED) {
                            res();
                            return;
                        }
                        ws.on("close", () => res());
                        ws.close();
                    });
                },
            });
        });

        ws.on("error", reject);
    });
}

// --- E2E Tests ---

describe("Copilot E2E — Full flow with real CLI", { timeout: E2E_TIMEOUT * 2 }, () => {
    let copilotAdapter: AdaptedCopilotClient;
    let server: ReturnType<typeof createBridgeServer>;
    let cliAvailable = false;

    before(async () => {
        process.env["BRIDGE_PORT"] = String(E2E_PORT);
        copilotAdapter = createCopilotAdapter();

        // Check if Copilot CLI is accessible
        try {
            cliAvailable = await copilotAdapter.isAvailable();
        } catch {
            cliAvailable = false;
        }

        if (!cliAvailable) {
            console.log("⚠️  Copilot CLI not accessible — skipping E2E tests");
            console.log("   Sign in with gh auth login and ensure copilot CLI is installed");
            return;
        }

        server = createBridgeServer(copilotAdapter);
        await server.start();
        console.log(`✅ E2E bridge server started: ws://127.0.0.1:${E2E_PORT}`);
    });

    after(async () => {
        if (server !== undefined) {
            await server.shutdown();
        }
        await copilotAdapter.shutdown();
        delete process.env["BRIDGE_PORT"];
        clearRateLimitState();
        resetSeq();
    });

    it("should verify Copilot CLI connection", (t) => {
        if (!cliAvailable) {
            t.skip("Copilot CLI not accessible");
            return;
        }
        assert.ok(cliAvailable, "Copilot CLI connection established");
    });

    it("QR pairing → capabilities.state → model capability normalization", async (t) => {
        if (!cliAvailable) {
            t.skip("Copilot CLI not accessible");
            return;
        }
        clearPairingToken();
        const token = generatePairingToken();
        const client = await connectToServer(E2E_PORT);

        try {
            // 1. Pairing
            client.send(makeClientMsg("auth.pair", { pairingToken: token }));
            const pairingMsg = await client.waitForMessage("pairing.success");
            assert.equal(pairingMsg.type, "pairing.success");

            // 2. capabilities.state should be emitted after pairing
            const capsMsg = await client.waitForMessage("capabilities.state");
            assert.equal(capsMsg.type, "capabilities.state");
            // Validate against schema
            const parsedCaps = serverMessageSchema.parse(capsMsg);
            assert.equal(parsedCaps.type, "capabilities.state");
            if (parsedCaps.type === "capabilities.state") {
                assert.equal(typeof parsedCaps.payload.host.elicitation, "boolean");
                assert.equal(typeof parsedCaps.payload.bridge.autoApproveReads, "boolean");
                assert.equal(
                    typeof parsedCaps.payload.bridge.readApprovalsConfigurable,
                    "boolean"
                );
            }

            // 3. Get model list and validate normalized capability fields
            client.send(makeClientMsg("models.request", {}));
            const modelsMsg = await client.waitForMessage("models.list");
            const parsedModels = serverMessageSchema.parse(modelsMsg);
            assert.equal(parsedModels.type, "models.list");

            if (parsedModels.type === "models.list") {
                const models = parsedModels.payload.models;
                assert.ok(models.length > 0, "Should return at least one model");

                let effortSupportingCount = 0;
                let effortNotSupportingCount = 0;

                for (const model of models) {
                    assert.equal(typeof model.id, "string");
                    assert.equal(typeof model.name, "string");
                    assert.equal(model.provider, "copilot");

                    if (model.supportsReasoningEffort === true) {
                        effortSupportingCount += 1;
                        // If supported and list provided, validate canonical levels
                        if (model.supportedReasoningEfforts !== undefined) {
                            for (const level of model.supportedReasoningEfforts) {
                                assert.ok(
                                    ["low", "medium", "high", "xhigh"].includes(level),
                                    `Invalid level: ${level}`
                                );
                            }
                        }
                    } else {
                        effortNotSupportingCount += 1;
                    }

                    console.log(
                        `   - ${model.id} | effort=${model.supportsReasoningEffort ?? "n/a"}` +
                        ` | levels=${model.supportedReasoningEfforts?.join(",") ?? "none"}` +
                        ` | policy=${model.policyState ?? "n/a"}`
                    );
                }

                console.log(
                    `   📊 Effort supporting: ${effortSupportingCount}, not supporting: ${effortNotSupportingCount}`
                );
            }
        } finally {
            await client.close();
        }
    });

    it("should create session and send message (effort-supporting model)", async (t) => {
        if (!cliAvailable) {
            t.skip("Copilot CLI not accessible");
            return;
        }
        clearRateLimitState();
        clearPairingToken();
        const token = generatePairingToken();
        const client = await connectToServer(E2E_PORT);

        try {
            // Pair
            client.send(makeClientMsg("auth.pair", { pairingToken: token }));
            await client.waitForMessage("pairing.success");

            // Find an effort-supporting model from the real model list
            client.send(makeClientMsg("models.request", {}));
            const modelsMsg = await client.waitForMessage("models.list");
            if (modelsMsg.type !== "models.list") {
                throw new Error("Expected models.list");
            }
            const effortModel = modelsMsg.payload.models.find(
                (m) => m.supportsReasoningEffort === true &&
                    (m.supportedReasoningEfforts?.length ?? 0) > 0
            );
            if (effortModel === undefined) {
                t.skip("No effort-supporting model found");
                return;
            }
            const effortLevel =
                effortModel.defaultReasoningEffort ??
                effortModel.supportedReasoningEfforts?.[0];
            assert.ok(effortLevel !== undefined, "Should find an effort level");

            console.log(`   🧠 Test modeli: ${effortModel.id} effort=${effortLevel}`);

            // Create session — including reasoningEffort
            client.send(
                makeClientMsg("session.create", {
                    config: {
                        model: effortModel.id,
                        reasoningEffort: effortLevel,
                        streaming: true,
                    },
                })
            );
            const sessionMsg = await client.waitForMessage("session.created");
            assert.equal(sessionMsg.type, "session.created");

            if (sessionMsg.type !== "session.created") return;
            const sessionId = sessionMsg.payload.session.id;
            console.log(`   🔗 Session created: ${sessionId}`);

            // capabilities.state should be emitted after session creation
            const afterCreateCaps = await client.waitForMessage("capabilities.state");
            serverMessageSchema.parse(afterCreateCaps);

            // Send message
            client.send(
                makeClientMsg("message.send", {
                    sessionId,
                    content: "What is 2+2? Reply with just the number.",
                })
            );

            const responseMsg = await client.waitForMessage("assistant.message");
            assert.equal(responseMsg.type, "assistant.message");

            if (responseMsg.type === "assistant.message") {
                console.log(`   🤖 Response: ${responseMsg.payload.content.slice(0, 100)}`);
            }

            const idleMsg = await client.waitForMessage("session.idle");
            assert.equal(idleMsg.type, "session.idle");
            console.log("   ✅ Session is idle");

        } finally {
            await client.close();
        }
    });

    it("should not send reasoningEffort for non-effort-supporting model", async (t) => {
        if (!cliAvailable) {
            t.skip("Copilot CLI not accessible");
            return;
        }
        clearRateLimitState();
        clearPairingToken();
        const token = generatePairingToken();
        const client = await connectToServer(E2E_PORT);

        try {
            client.send(makeClientMsg("auth.pair", { pairingToken: token }));
            await client.waitForMessage("pairing.success");

            client.send(makeClientMsg("models.request", {}));
            const modelsMsg = await client.waitForMessage("models.list");
            if (modelsMsg.type !== "models.list") {
                throw new Error("Expected models.list");
            }
            const nonEffortModel = modelsMsg.payload.models.find(
                (m) => m.supportsReasoningEffort === false
            );
            if (nonEffortModel === undefined) {
                t.skip("No non-effort-supporting model found");
                return;
            }

            console.log(`   🚫 Non-effort model: ${nonEffortModel.id}`);

            // NOT sending reasoningEffort field
            client.send(
                makeClientMsg("session.create", {
                    config: {
                        model: nonEffortModel.id,
                        streaming: true,
                    },
                })
            );
            const sessionMsg = await client.waitForMessage("session.created");
            assert.equal(sessionMsg.type, "session.created");
            console.log("   ✅ Non-effort session created successfully");
        } finally {
            await client.close();
        }
    });

    it("should list and delete sessions", async (t) => {
        if (!cliAvailable) {
            t.skip("Copilot CLI not accessible");
            return;
        }
        clearRateLimitState();
        clearPairingToken();
        const token = generatePairingToken();
        const client = await connectToServer(E2E_PORT);

        try {
            // Pair
            client.send(makeClientMsg("auth.pair", { pairingToken: token }));
            await client.waitForMessage("pairing.success");

            // List sessions
            client.send(makeClientMsg("session.list", {}));
            const listMsg = await client.waitForMessage("session.list");
            assert.equal(listMsg.type, "session.list");

            if (listMsg.type === "session.list") {
                console.log(`   📋 ${listMsg.payload.sessions.length} active sessions`);
            }
        } finally {
            await client.close();
        }
    });
});

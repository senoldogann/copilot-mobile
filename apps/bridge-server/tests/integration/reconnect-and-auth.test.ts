import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import type {
    AdaptedCopilotClient,
    AdaptedCopilotSession,
    AdaptedPermissionRequest,
    AdaptedSessionLifecycleEvent,
    AdaptedSessionState,
    AdaptedUserInputRequest,
    SessionConfig,
    SessionHistoryItem,
    SessionInfo,
    ServerMessage,
    ModelInfo,
    HostSessionCapabilities,
    SessionMessageInput,
} from "@copilot-mobile/shared";
import type { SessionContext } from "@copilot-mobile/shared";
import { createBridgeServer } from "../../src/ws/server.js";
import { generatePairingToken, clearPairingToken } from "../../src/auth/pairing.js";
import { clearRateLimitState } from "../../src/utils/rate-limit.js";
import { resetSeq } from "../../src/utils/message.js";

const TEST_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFileCallback);

type WSClient = {
    ws: WebSocket;
    messages: ServerMessage[];
    waitForMessage: (type: ServerMessage["type"], timeoutMs?: number) => Promise<ServerMessage>;
    send: (message: Record<string, unknown>) => void;
    close: () => Promise<void>;
};

type HandlerMap = {
    onMessage?: (content: string) => void;
    onDelta?: (delta: string, index: number) => void;
    onReasoning?: (content: string) => void;
    onReasoningDelta?: (delta: string, index: number) => void;
    onPermissionRequest?: (request: AdaptedPermissionRequest) => Promise<boolean>;
    onUserInputRequest?: (request: AdaptedUserInputRequest) => Promise<string>;
    onToolStart?: (toolName: string, requestId: string) => void;
    onToolPartialResult?: (requestId: string, partialOutput: string) => void;
    onToolProgress?: (requestId: string, progressMessage: string) => void;
    onToolComplete?: (toolName: string, requestId: string, success: boolean) => void;
    onIdle?: () => void;
    onSessionError?: (errorType: string, message: string) => void;
    onTitleChanged?: (title: string) => void;
    onIntent?: (intent: string) => void;
};

function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

async function listenHttpServer(server: ReturnType<typeof createHttpServer>): Promise<number> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Failed to read listening address");
    }
    return address.port;
}

async function reservePort(): Promise<number> {
    const server = createHttpServer((_req, res) => {
        res.writeHead(404);
        res.end();
    });
    try {
        return await listenHttpServer(server);
    } finally {
        server.close();
        await once(server, "close");
    }
}

async function fetchManagement(port: number, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
}

function makeClientMessage(
    type: string,
    payload: Record<string, unknown>
): Record<string, unknown> {
    return {
        id: randomUUID(),
        timestamp: Date.now(),
        seq: 1,
        protocolVersion: 2,
        type,
        payload,
    };
}

function createWSClient(port: number): Promise<WSClient> {
    return new Promise((resolve, reject) => {
        const url = `ws://127.0.0.1:${port}`;
        const ws = new WebSocket(url);
        const messages: ServerMessage[] = [];
        const waiters: Array<{
            type: ServerMessage["type"];
            resolve: (message: ServerMessage) => void;
            reject: (error: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }> = [];

        ws.on("open", () => {
            resolve({
                ws,
                messages,
                waitForMessage(type, timeoutMs = TEST_TIMEOUT_MS) {
                    const existing = messages.find((message) => message.type === type);
                    if (existing !== undefined) {
                        return Promise.resolve(existing);
                    }

                    return new Promise((resolveMessage, rejectMessage) => {
                        const timer = setTimeout(() => {
                            const waiterIndex = waiters.findIndex((waiter) => waiter.type === type);
                            if (waiterIndex !== -1) {
                                waiters.splice(waiterIndex, 1);
                            }
                            rejectMessage(new Error(`Timed out waiting for ${type}`));
                        }, timeoutMs);

                        waiters.push({
                            type,
                            resolve: (message) => {
                                clearTimeout(timer);
                                resolveMessage(message);
                            },
                            reject: rejectMessage,
                            timer,
                        });
                    });
                },
                send(message) {
                    ws.send(JSON.stringify(message));
                },
                close() {
                    return new Promise((resolveClose) => {
                        if (ws.readyState === WebSocket.CLOSED) {
                            resolveClose();
                            return;
                        }

                        ws.once("close", () => resolveClose());
                        ws.close();
                    });
                },
            });
        });

        ws.on("message", (data: Buffer) => {
            const message = JSON.parse(data.toString("utf-8")) as ServerMessage;
            messages.push(message);

            const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
            if (waiterIndex === -1) {
                return;
            }

            const waiter = waiters[waiterIndex];
            if (waiter === undefined) {
                return;
            }

            waiters.splice(waiterIndex, 1);
            waiter.resolve(message);
        });

        ws.on("error", reject);
    });
}

class FakeSession implements AdaptedCopilotSession {
    public readonly id = "session-test";
    public closeCallCount = 0;
    public unsubscribeAllCallCount = 0;
    private info: SessionInfo = {
        id: this.id,
        model: "gpt-4.1",
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        status: "active",
        title: "Test Session",
    };
    private readonly capabilities: HostSessionCapabilities = { elicitation: true };
    private handlers: HandlerMap = {};
    private historyItems: ReadonlyArray<SessionHistoryItem> = [];
    private historyResolver: (() => Promise<ReadonlyArray<SessionHistoryItem>>) | null = null;
    private state: AdaptedSessionState = {
        agentMode: "agent",
        permissionLevel: "default",
        runtimeMode: "interactive",
    };

    async send(_message: SessionMessageInput): Promise<void> {
        return Promise.resolve();
    }

    abort(): void { }

    onMessage(handler: (content: string) => void): void {
        this.handlers.onMessage = handler;
    }

    onDelta(handler: (delta: string, index: number) => void): void {
        this.handlers.onDelta = handler;
    }

    onReasoning(handler: (content: string) => void): void {
        this.handlers.onReasoning = handler;
    }

    onReasoningDelta(handler: (delta: string, index: number) => void): void {
        this.handlers.onReasoningDelta = handler;
    }

    onPermissionRequest(handler: (request: AdaptedPermissionRequest) => Promise<boolean>): void {
        this.handlers.onPermissionRequest = handler;
    }

    onUserInputRequest(handler: (request: AdaptedUserInputRequest) => Promise<string>): void {
        this.handlers.onUserInputRequest = handler;
    }

    onToolStart(handler: (toolName: string, requestId: string) => void): void {
        this.handlers.onToolStart = handler;
    }

    onToolPartialResult(handler: (requestId: string, partialOutput: string) => void): void {
        this.handlers.onToolPartialResult = handler;
    }

    onToolProgress(handler: (requestId: string, progressMessage: string) => void): void {
        this.handlers.onToolProgress = handler;
    }

    onToolComplete(handler: (toolName: string, requestId: string, success: boolean) => void): void {
        this.handlers.onToolComplete = handler;
    }

    onIdle(handler: () => void): void {
        this.handlers.onIdle = handler;
    }

    onSessionError(handler: (errorType: string, message: string) => void): void {
        this.handlers.onSessionError = handler;
    }

    onTitleChanged(handler: (title: string) => void): void {
        this.handlers.onTitleChanged = handler;
    }

    onIntent(handler: (intent: string) => void): void {
        this.handlers.onIntent = handler;
    }

    onUsage(_handler: (usage: {
        tokenLimit: number;
        currentTokens: number;
        systemTokens?: number;
        conversationTokens?: number;
        toolDefinitionsTokens?: number;
        messagesLength?: number;
    }) => void): void { }

    onRuntimeModeChanged(_handler: (runtimeMode: "interactive" | "plan" | "autopilot") => void): void { }

    onPlanExitRequest(_handler: (request: {
        requestId: string;
        summary: string;
        planContent: string;
        actions: ReadonlyArray<string>;
        recommendedAction: string;
    }) => void): void { }

    async getHistory(): Promise<ReadonlyArray<SessionHistoryItem>> {
        if (this.historyResolver !== null) {
            return this.historyResolver();
        }

        return this.historyItems;
    }

    setHistory(items: ReadonlyArray<SessionHistoryItem>): void {
        this.historyItems = items;
    }

    setHistoryResolver(resolver: () => Promise<ReadonlyArray<SessionHistoryItem>>): void {
        this.historyResolver = resolver;
    }

    unsubscribeAll(): void {
        this.unsubscribeAllCallCount += 1;
        this.handlers = {};
    }

    close(): void {
        this.closeCallCount += 1;
    }

    getInfo(): SessionInfo {
        return this.info;
    }

    setContext(context: SessionContext | undefined): void {
        this.info = {
            ...this.info,
            ...(context !== undefined ? { context } : {}),
        };
    }

    getCapabilities(): HostSessionCapabilities {
        return this.capabilities;
    }

    async applyState(state: AdaptedSessionState): Promise<AdaptedSessionState> {
        this.state = state;
        return this.state;
    }

    async getState(permissionLevel: "default" | "bypass" | "autopilot"): Promise<AdaptedSessionState> {
        this.state = {
            ...this.state,
            permissionLevel,
            runtimeMode: this.state.agentMode === "plan"
                ? "plan"
                : permissionLevel === "autopilot"
                    ? "autopilot"
                    : "interactive",
        };
        return this.state;
    }

    emitAssistantMessage(content: string): void {
        this.handlers.onMessage?.(content);
    }

    requestPermission(request: AdaptedPermissionRequest): Promise<boolean> {
        const handler = this.handlers.onPermissionRequest;
        if (handler === undefined) {
            throw new Error("Permission handler not registered");
        }

        return handler(request);
    }

    emitSessionError(errorType: string, message: string): void {
        this.handlers.onSessionError?.(errorType, message);
    }
}

function createFakeClient(
    session: FakeSession,
    options: {
        resumeSession?: (
            sessionId: string,
            options?: { forceRefresh?: boolean }
        ) => Promise<AdaptedCopilotSession>;
        listSessions?: () => Promise<ReadonlyArray<SessionInfo>>;
        deleteSession?: (sessionId: string) => Promise<void>;
        onSessionLifecycle?: (handler: (event: AdaptedSessionLifecycleEvent) => void) => void;
    } = {}
): AdaptedCopilotClient {
    return {
        async createSession(_config: SessionConfig): Promise<AdaptedCopilotSession> {
            return session;
        },
        async resumeSession(
            sessionId: string,
            resumeOptions?: { forceRefresh?: boolean }
        ): Promise<AdaptedCopilotSession> {
            if (options.resumeSession !== undefined) {
                return options.resumeSession(sessionId, resumeOptions);
            }
            return session;
        },
        async listSessions(): Promise<ReadonlyArray<SessionInfo>> {
            if (options.listSessions !== undefined) {
                return options.listSessions();
            }
            return [session.getInfo()];
        },
        async deleteSession(sessionId: string): Promise<void> {
            if (options.deleteSession !== undefined) {
                return options.deleteSession(sessionId);
            }
            return Promise.resolve();
        },
        async listModels(): Promise<ReadonlyArray<ModelInfo>> {
            return [];
        },
        async isAvailable(): Promise<boolean> {
            return true;
        },
        onSessionLifecycle(handler: (event: AdaptedSessionLifecycleEvent) => void): () => void {
            options.onSessionLifecycle?.(handler);
            return () => undefined;
        },
        async shutdown(): Promise<void> {
            return Promise.resolve();
        },
    };
}

async function runGit(cwd: string, args: ReadonlyArray<string>): Promise<void> {
    await execFileAsync("git", [...args], {
        cwd,
        env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
        },
    });
}

async function createWorkspaceFixture(options: { commitCount?: number; deepDepth?: number } = {}): Promise<{ root: string }> {
    const { commitCount = 2, deepDepth = 0 } = options;
    const fixturesRoot = join(process.cwd(), "apps/bridge-server/tests/.workspace-fixtures");
    await mkdir(fixturesRoot, { recursive: true });

    const root = join(fixturesRoot, `repo-${randomUUID()}`);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "README.md"), "workspace tree\n");
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");

    if (deepDepth > 0) {
        let currentDir = join(root, "deep");
        await mkdir(currentDir, { recursive: true });
        for (let index = 1; index <= deepDepth; index += 1) {
            currentDir = join(currentDir, `level-${index}`);
            await mkdir(currentDir, { recursive: true });
        }
        await writeFile(join(currentDir, "leaf.txt"), "deep leaf\n");
    }

    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "copilot@example.com"]);
    await runGit(root, ["config", "user.name", "Copilot Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "initial commit"]);
    await runGit(root, ["branch", "-M", "main"]);

    if (commitCount >= 2) {
        await writeFile(join(root, "src", "feature.ts"), "export const feature = true;\n");
        await runGit(root, ["add", "src/feature.ts"]);
        await runGit(root, ["commit", "-m", "add feature file"]);
    }

    for (let commitIndex = 3; commitIndex <= commitCount; commitIndex += 1) {
        const filePath = join(root, `history-${commitIndex}.txt`);
        await writeFile(filePath, `commit ${commitIndex}\n`);
        await runGit(root, ["add", `history-${commitIndex}.txt`]);
        await runGit(root, ["commit", "-m", `history ${commitIndex}`]);
    }

    if (commitCount === 2) {
        await appendFile(join(root, "README.md"), "modified\n");
        await writeFile(join(root, "notes.txt"), "untracked\n");
    }

    return { root };
}

async function createPlainWorkspaceFixture(): Promise<{ root: string }> {
    const fixturesRoot = join(tmpdir(), "copilot-mobile-workspace-fixtures");
    await mkdir(fixturesRoot, { recursive: true });

    const root = join(fixturesRoot, `plain-${randomUUID()}`);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "README.md"), "plain workspace\n");
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");

    return { root };
}

describe("bridge reconnect and auth integration", () => {
    let session: FakeSession;
    let server: ReturnType<typeof createBridgeServer>;
    let testPort = 0;

    beforeEach(async () => {
        testPort = await reservePort();
        process.env["BRIDGE_PORT"] = String(testPort);
        session = new FakeSession();
        session.setHistory([
            {
                id: "history-user-1",
                type: "user",
                content: "hello",
                timestamp: Date.now() - 1_000,
            },
        ]);
        server = createBridgeServer(createFakeClient(session));
        await server.start();
    });

    afterEach(async () => {
        await server.shutdown();
        delete process.env["BRIDGE_PORT"];
        clearPairingToken();
        clearRateLimitState();
        resetSeq();
    });

    it("sanitizes client validation errors", async () => {
        const client = await createWSClient(testPort);

        try {
            client.send(makeClientMessage("session.create", {
                config: {
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));

            const errorMessage = await client.waitForMessage("error");
            if (errorMessage.type !== "error") {
                throw new Error("Expected error message");
            }

            assert.equal(errorMessage.payload.code, "VALIDATION_ERROR");
            assert.equal(errorMessage.payload.message, "Invalid message payload");
            assert.equal(errorMessage.payload.message.includes("Required"), false);
        } finally {
            await client.close();
        }
    });

    it("serves the localhost dashboard and status endpoints", async () => {
        const statusResponse = await fetchManagement(testPort, "/__copilot_mobile/status");
        assert.equal(statusResponse.status, 200);

        const statusPayload = await statusResponse.json() as {
            status: {
                port: number;
                publicUrl: string;
            };
        };
        assert.equal(statusPayload.status.port, testPort);
        assert.equal(statusPayload.status.publicUrl, `ws://127.0.0.1:${testPort}`);

        const dashboardResponse = await fetchManagement(testPort, "/__copilot_mobile/dashboard");
        assert.equal(dashboardResponse.status, 200);
        assert.equal(
            dashboardResponse.headers.get("content-type")?.includes("text/html"),
            true
        );

        const html = await dashboardResponse.text();
        assert.equal(html.includes("Companion Dashboard"), true);
        assert.equal(html.includes("/__copilot_mobile/status"), true);
        assert.equal(html.includes("/__copilot_mobile/qr"), true);
    });

    it("keeps the authenticated client active until a replacement authenticates", async () => {
        const token = generatePairingToken();
        const clientA = await createWSClient(testPort);

        try {
            clientA.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await clientA.waitForMessage("auth.authenticated");

            clientA.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await clientA.waitForMessage("session.created");

            const clientB = await createWSClient(testPort);
            try {
                session.emitAssistantMessage("still connected");
                const assistantMessage = await clientA.waitForMessage("assistant.message");
                assert.equal(assistantMessage.type, "assistant.message");
                await wait(200);
                assert.equal(
                    clientB.messages.some((message) => message.type === "assistant.message"),
                    false
                );
            } finally {
                await clientB.close();
            }
        } finally {
            await clientA.close();
        }
    });

    it("releases idle sessions on disconnect so later resumes do not conflict", async () => {
        await server.shutdown();

        let resumeCallCount = 0;
        server = createBridgeServer(createFakeClient(session, {
            async resumeSession(
                _sessionId: string,
                _options?: { forceRefresh?: boolean }
            ): Promise<AdaptedCopilotSession> {
                resumeCallCount += 1;
                return session;
            },
        }));
        await server.start();

        const token = generatePairingToken();
        const clientA = await createWSClient(testPort);

        try {
            clientA.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            const pairingMessage = await clientA.waitForMessage("auth.authenticated");
            assert.equal(pairingMessage.type, "auth.authenticated");

            clientA.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            const created = await clientA.waitForMessage("session.created");
            assert.equal(created.type, "session.created");

            await clientA.close();
            await wait(25);
            assert.equal(session.closeCallCount, 1);

            const clientB = await createWSClient(testPort);
            try {
                clientB.send(makeClientMessage("auth.resume", {
                    deviceCredential: pairingMessage.payload.deviceCredential,
                    sessionToken: pairingMessage.payload.sessionToken,
                    lastSeenSeq: pairingMessage.seq,
                    transportMode: "direct",
                }));
                await clientB.waitForMessage("auth.authenticated");

                clientB.send(makeClientMessage("session.resume", {
                    sessionId: created.payload.session.id,
                }));
                const resumed = await clientB.waitForMessage("session.resumed");
                assert.equal(resumed.type, "session.resumed");
                assert.equal(resumeCallCount, 1);
            } finally {
                await clientB.close();
            }
        } finally {
            if (clientA.ws.readyState !== WebSocket.CLOSED) {
                await clientA.close();
            }
        }
    });

    it("rate limits repeated auth.resume attempts from the same client ip", async () => {
        const token = generatePairingToken();
        const pairedClient = await createWSClient(testPort);

        try {
            pairedClient.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            const pairingMessage = await pairedClient.waitForMessage("auth.authenticated");
            assert.equal(pairingMessage.type, "auth.authenticated");
            await pairedClient.close();

            for (let attempt = 0; attempt < 10; attempt += 1) {
                const client = await createWSClient(testPort);
                try {
                    client.send(makeClientMessage("auth.resume", {
                        deviceCredential: pairingMessage.payload.deviceCredential,
                        sessionToken: pairingMessage.payload.sessionToken,
                        lastSeenSeq: pairingMessage.seq,
                        transportMode: "direct",
                    }));
                    const authenticated = await client.waitForMessage("auth.authenticated");
                    assert.equal(authenticated.type, "auth.authenticated");
                } finally {
                    await client.close();
                }
            }

            const blockedClient = await createWSClient(testPort);
            try {
                const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
                    blockedClient.ws.once("close", (code, reason) => {
                        resolve({ code, reason: reason.toString("utf-8") });
                    });
                });

                blockedClient.send(makeClientMessage("auth.resume", {
                    deviceCredential: pairingMessage.payload.deviceCredential,
                    sessionToken: pairingMessage.payload.sessionToken,
                    lastSeenSeq: pairingMessage.seq,
                    transportMode: "direct",
                }));

                const closed = await closeEvent;
                assert.equal(closed.code, 1008);
                assert.equal(closed.reason, "Rate limit exceeded");
            } finally {
                if (blockedClient.ws.readyState !== WebSocket.CLOSED) {
                    await blockedClient.close();
                }
            }
        } finally {
            if (pairedClient.ws.readyState !== WebSocket.CLOSED) {
                await pairedClient.close();
            }
        }
    });

    it("replays pending permission prompts after reconnect", async () => {
        const token = generatePairingToken();
        const clientA = await createWSClient(testPort);

        try {
            clientA.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            const pairingMessage = await clientA.waitForMessage("auth.authenticated");
            assert.equal(pairingMessage.type, "auth.authenticated");

            clientA.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await clientA.waitForMessage("session.created");

            const pendingDecision = session.requestPermission({
                id: "perm-1",
                kind: "shell",
                metadata: { intention: "run command" },
            });
            await clientA.waitForMessage("permission.request");
            await clientA.close();

            const clientB = await createWSClient(testPort);
            try {
                clientB.send(makeClientMessage("auth.resume", {
                    deviceCredential: pairingMessage.payload.deviceCredential,
                    sessionToken: pairingMessage.payload.sessionToken,
                    lastSeenSeq: pairingMessage.seq,
                    transportMode: "direct",
                }));
                await clientB.waitForMessage("auth.authenticated");
                clientB.send(makeClientMessage("session.resume", { sessionId: session.id }));
                const replayedPrompt = await clientB.waitForMessage("permission.request");
                assert.equal(replayedPrompt.type, "permission.request");
                clientB.send(makeClientMessage("permission.respond", {
                    requestId: "perm-1",
                    approved: true,
                }));
                assert.equal(await pendingDecision, true);
            } finally {
                await clientB.close();
            }
        } finally {
            if (clientA.ws.readyState !== WebSocket.CLOSED) {
                await clientA.close();
            }
        }
    });

    it("does not replay stale error messages after reconnect", async () => {
        const token = generatePairingToken();
        const clientA = await createWSClient(testPort);

        try {
            clientA.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            const pairingMessage = await clientA.waitForMessage("auth.authenticated");
            assert.equal(pairingMessage.type, "auth.authenticated");

            clientA.send(makeClientMessage("message.send", {
                sessionId: "missing-session",
                content: "hello",
            }));
            const errorMessage = await clientA.waitForMessage("error");
            assert.equal(errorMessage.type, "error");
            await clientA.close();

            const clientB = await createWSClient(testPort);
            try {
                clientB.send(makeClientMessage("auth.resume", {
                    deviceCredential: pairingMessage.payload.deviceCredential,
                    sessionToken: pairingMessage.payload.sessionToken,
                    lastSeenSeq: errorMessage.seq,
                    transportMode: "direct",
                }));
                const authenticated = await clientB.waitForMessage("auth.authenticated");
                assert.equal(authenticated.type, "auth.authenticated");

                await wait(100);
                assert.equal(
                    clientB.messages.some((message) => message.type === "error"),
                    false
                );
            } finally {
                await clientB.close();
            }
        } finally {
            if (clientA.ws.readyState !== WebSocket.CLOSED) {
                await clientA.close();
            }
        }
    });

    it("replays pending prompts even when session history fetch fails during resume", async () => {
        const token = generatePairingToken();
        const clientA = await createWSClient(testPort);

        try {
            clientA.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            const pairingMessage = await clientA.waitForMessage("auth.authenticated");
            assert.equal(pairingMessage.type, "auth.authenticated");

            clientA.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await clientA.waitForMessage("session.created");

            const pendingDecision = session.requestPermission({
                id: "perm-history-failure",
                kind: "shell",
                metadata: { intention: "run command after failed history load" },
            });
            await clientA.waitForMessage("permission.request");
            await clientA.close();

            session.setHistoryResolver(async () => {
                setTimeout(() => {
                    session.emitAssistantMessage("live event after failed history load");
                }, 10);
                await wait(30);
                throw new Error("history unavailable");
            });

            const clientB = await createWSClient(testPort);
            try {
                clientB.send(makeClientMessage("auth.resume", {
                    deviceCredential: pairingMessage.payload.deviceCredential,
                    sessionToken: pairingMessage.payload.sessionToken,
                    lastSeenSeq: pairingMessage.seq,
                    transportMode: "direct",
                }));
                await clientB.waitForMessage("auth.authenticated");
                clientB.send(makeClientMessage("session.resume", { sessionId: session.id }));

                const resumed = await clientB.waitForMessage("session.resumed");
                assert.equal(resumed.type, "session.resumed");

                const replayedPrompt = await clientB.waitForMessage("permission.request");
                assert.equal(replayedPrompt.type, "permission.request");

                const liveMessage = await clientB.waitForMessage("assistant.message");
                assert.equal(liveMessage.type, "assistant.message");
                assert.equal(liveMessage.payload.content, "live event after failed history load");

                await wait(80);
                assert.equal(
                    clientB.messages.some((message) => message.type === "session.history"),
                    false
                );

                clientB.send(makeClientMessage("permission.respond", {
                    requestId: "perm-history-failure",
                    approved: true,
                }));
                assert.equal(await pendingDecision, true);
            } finally {
                await clientB.close();
            }
        } finally {
            if (clientA.ws.readyState !== WebSocket.CLOSED) {
                await clientA.close();
            }
            session.setHistory([]);
            session.setHistoryResolver(async () => []);
        }
    });

    it("removes corrupted sessions instead of surfacing a fatal resume SDK error", async () => {
        await server.shutdown();

        const corruptedSessionId = session.id;
        const deletedSessionIds: Array<string> = [];
        server = createBridgeServer(createFakeClient(session, {
            async resumeSession(
                requestedSessionId: string,
                _options?: { forceRefresh?: boolean }
            ): Promise<AdaptedCopilotSession> {
                assert.equal(requestedSessionId, corruptedSessionId);
                throw new Error(
                    "Session file is corrupted (line 16: SyntaxError: Unterminated string in JSON at position 79 (line 1 column 80))"
                );
            },
            async deleteSession(sessionId: string): Promise<void> {
                deletedSessionIds.push(sessionId);
            },
        }));
        await server.start();

        const token = generatePairingToken();
        const client = await createWSClient(testPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.resume", { sessionId: corruptedSessionId }));
            const errorMessage = await client.waitForMessage("error");
            assert.equal(errorMessage.type, "error");
            assert.equal(errorMessage.payload.code, "SESSION_NOT_FOUND");
            assert.equal(errorMessage.payload.retry, false);
            assert.match(errorMessage.payload.message, /corrupted/i);
            assert.deepEqual(deletedSessionIds, [corruptedSessionId]);
        } finally {
            await client.close();
        }
    });

    it("does not delay live resume events behind session history", async () => {
        const token = generatePairingToken();
        const client = await createWSClient(testPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            session.setHistoryResolver(async () => {
                setTimeout(() => {
                    session.emitAssistantMessage("queued while loading history");
                }, 10);
                await wait(40);
                return [{
                    id: "history-assistant-1",
                    type: "assistant",
                    content: "history snapshot",
                    timestamp: Date.now() - 500,
                }];
            });

            client.send(makeClientMessage("session.resume", { sessionId: session.id }));
            await client.waitForMessage("session.resumed");
            await client.waitForMessage("assistant.message");
            await client.waitForMessage("session.history");

            const relevantTypes = client.messages
                .filter((message) =>
                    message.type === "session.resumed"
                    || message.type === "session.history"
                    || message.type === "assistant.message"
                )
                .slice(-3)
                .map((message) => message.type);

            assert.deepEqual(
                relevantTypes,
                ["session.resumed", "assistant.message", "session.history"]
            );
        } finally {
            await client.close();
        }
    });

    it("refreshes active session history from a fresh resume when the session changed externally", async () => {
        await server.shutdown();

        const staleSession = new FakeSession();
        staleSession.setHistory([
            {
                id: "history-assistant-stale",
                type: "assistant",
                content: "stale bridge history",
                timestamp: Date.now() - 1_000,
            },
        ]);

        const refreshedSession = new FakeSession();
        refreshedSession.setHistory([
            {
                id: "history-assistant-fresh",
                type: "assistant",
                content: "fresh desktop history",
                timestamp: Date.now(),
            },
        ]);

        const resumeCalls: Array<{ sessionId: string; forceRefresh: boolean }> = [];

        server = createBridgeServer(createFakeClient(staleSession, {
            async resumeSession(
                requestedSessionId: string,
                options?: { forceRefresh?: boolean }
            ): Promise<AdaptedCopilotSession> {
                resumeCalls.push({
                    sessionId: requestedSessionId,
                    forceRefresh: options?.forceRefresh === true,
                });
                return options?.forceRefresh === true ? refreshedSession : staleSession;
            },
        }));
        await server.start();

        const token = generatePairingToken();
        const client = await createWSClient(testPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.resume", { sessionId: staleSession.id }));
            await client.waitForMessage("session.resumed");
            await client.waitForMessage("session.history");

            client.send(makeClientMessage("session.history.request", { sessionId: staleSession.id }));
            await wait(25);
            const historyMessage = [...client.messages]
                .reverse()
                .find((message) => message.type === "session.history");

            assert.ok(historyMessage);
            assert.equal(historyMessage.type, "session.history");
            assert.equal(historyMessage.payload.sessionId, staleSession.id);
            assert.equal(historyMessage.payload.items.at(-1)?.content, "fresh desktop history");
            assert.deepEqual(resumeCalls, [
                { sessionId: staleSession.id, forceRefresh: false },
                { sessionId: staleSession.id, forceRefresh: true },
            ]);
        } finally {
            await client.close();
        }
    });

    it("pushes a fresh session list when the SDK reports an external session update", async () => {
        await server.shutdown();

        let lifecycleHandler: ((event: AdaptedSessionLifecycleEvent) => void) | null = null;
        let listedSessions: ReadonlyArray<SessionInfo> = [session.getInfo()];
        server = createBridgeServer(createFakeClient(session, {
            listSessions: async () => listedSessions,
            onSessionLifecycle: (handler) => {
                lifecycleHandler = handler;
            },
        }));
        await server.start();

        const token = generatePairingToken();
        const client = await createWSClient(testPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.list", {}));
            await client.waitForMessage("session.list");

            listedSessions = [{
                ...session.getInfo(),
                lastActiveAt: Date.now() + 5_000,
                title: "Updated by desktop",
            }];

            lifecycleHandler?.({
                type: "session.updated",
                sessionId: session.id,
                metadata: {
                    startTime: new Date(session.getInfo().createdAt).toISOString(),
                    modifiedTime: new Date(listedSessions[0]?.lastActiveAt ?? Date.now()).toISOString(),
                    summary: "Updated by desktop",
                },
            });

            await wait(220);

            const latestSessionList = [...client.messages]
                .reverse()
                .find((message) => message.type === "session.list");

            assert.ok(latestSessionList);
            assert.equal(latestSessionList.type, "session.list");
            assert.equal(latestSessionList.payload.sessions[0]?.title, "Updated by desktop");
        } finally {
            await client.close();
        }
    });

    it("cleans up session handlers explicitly when deleting a session", async () => {
        const token = generatePairingToken();
        const client = await createWSClient(testPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("session.delete", { sessionId: session.id }));
            await wait(25);

            assert.equal(session.unsubscribeAllCallCount, 1);
            assert.equal(session.closeCallCount, 1);
        } finally {
            await client.close();
        }
    });
});

describe("workspace explorer integration", () => {
    let session: FakeSession;
    let server: ReturnType<typeof createBridgeServer>;
    let workspaceRoot: string;
    let workspaceTestPort = 0;

    beforeEach(async () => {
        workspaceTestPort = await reservePort();
        process.env["BRIDGE_PORT"] = String(workspaceTestPort);
        const fixture = await createWorkspaceFixture();
        workspaceRoot = fixture.root;
        session = new FakeSession();
        session.setContext({
            sessionCwd: workspaceRoot,
            workspaceRoot,
            gitRoot: workspaceRoot,
            repository: "example/copilot-mobile",
            branch: "main",
        });
        server = createBridgeServer(createFakeClient(session));
        await server.start();
    });

    afterEach(async () => {
        await server.shutdown();
        delete process.env["BRIDGE_PORT"];
        await rm(workspaceRoot, { recursive: true, force: true });
        clearPairingToken();
        clearRateLimitState();
        resetSeq();
    });

    it("returns workspace tree listings for the active session", async () => {
        const token = generatePairingToken();
        const client = await createWSClient(workspaceTestPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            const sessionMsg = await client.waitForMessage("session.created");
            if (sessionMsg.type !== "session.created") {
                throw new Error("Expected session.created");
            }

            client.send(makeClientMessage("workspace.tree.request", {
                sessionId: session.id,
                workspaceRelativePath: ".",
                maxDepth: 2,
            }));
            const treeMsg = await client.waitForMessage("workspace.tree");
            const parsedTree = treeMsg.type === "workspace.tree" ? treeMsg : null;
            assert.ok(parsedTree !== null, "Expected workspace.tree response");
            if (parsedTree === null) {
                return;
            }

            assert.equal(parsedTree.payload.sessionId, session.id);
            assert.equal(parsedTree.payload.context.sessionCwd, workspaceRoot);
            assert.equal(parsedTree.payload.context.workspaceRoot, workspaceRoot);
            assert.equal(parsedTree.payload.workspaceRoot, workspaceRoot);
            assert.equal(parsedTree.payload.requestedWorkspaceRelativePath, ".");
            assert.equal(parsedTree.payload.tree.type, "directory");
            assert.equal(parsedTree.payload.truncated, false);

            const childNames = parsedTree.payload.tree.children?.map((child) => child.name) ?? [];
            assert.ok(childNames.includes("README.md"));
            assert.ok(childNames.includes("notes.txt"));
            assert.ok(childNames.includes("src"));
        } finally {
            await client.close();
        }
    });

    it("searches files within the active workspace for @file autocomplete", async () => {
        const token = generatePairingToken();
        const client = await createWSClient(workspaceTestPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.search.request", {
                requestKey: "workspace-file-search",
                sessionId: session.id,
                query: "feature",
                limit: 10,
                searchScope: "workspace_files",
            }));

            const searchMessage = await client.waitForMessage("workspace.search.response");
            assert.equal(searchMessage.type, "workspace.search.response");
            assert.equal(
                searchMessage.payload.matches.some((match) => match.path === "src/feature.ts"),
                true
            );
        } finally {
            await client.close();
        }
    });

    it("returns git summary, supports commit, and reports safe pull/push results", async () => {
        const token = generatePairingToken();
        const client = await createWSClient(workspaceTestPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.git.request", {
                sessionId: session.id,
                commitLimit: 5,
            }));
            const gitMsg = await client.waitForMessage("workspace.git.summary");
            if (gitMsg.type !== "workspace.git.summary") {
                throw new Error("Expected workspace.git.summary");
            }

            assert.equal(gitMsg.payload.sessionId, session.id);
            assert.equal(gitMsg.payload.workspaceRoot, workspaceRoot);
            assert.equal(gitMsg.payload.gitRoot, workspaceRoot);
            assert.equal(gitMsg.payload.branch, "main");
            assert.equal(gitMsg.payload.repository, "example/copilot-mobile");
            assert.ok(gitMsg.payload.uncommittedChanges.some((change) => change.path === "README.md"));
            assert.ok(gitMsg.payload.uncommittedChanges.some((change) => change.path === "notes.txt"));
            assert.deepEqual(
                gitMsg.payload.uncommittedChanges.find((change) => change.path === "notes.txt"),
                {
                    path: "notes.txt",
                    status: "untracked",
                    indexStatus: "?",
                    worktreeStatus: "?",
                    additions: 1,
                    deletions: 0,
                }
            );
            assert.ok(gitMsg.payload.recentCommits.length >= 2);
            assert.equal(gitMsg.payload.recentCommits[0]?.files.includes("src/feature.ts"), true);

            client.send(makeClientMessage("workspace.commit", {
                sessionId: session.id,
                message: "commit from mobile",
            }));
            const commitMsg = await client.waitForMessage("workspace.commit.result");
            if (commitMsg.type !== "workspace.commit.result") {
                throw new Error("Expected workspace.commit.result");
            }
            assert.equal(commitMsg.payload.sessionId, session.id);
            assert.equal(commitMsg.payload.operation, "commit");
            assert.equal(commitMsg.payload.success, true);
            const statusAfterCommit = await execFileAsync("git", ["status", "--porcelain=v1"], {
                cwd: workspaceRoot,
                env: {
                    ...process.env,
                    GIT_TERMINAL_PROMPT: "0",
                    GIT_OPTIONAL_LOCKS: "0",
                },
            });
            assert.equal(statusAfterCommit.stdout.toString().trim().length, 0);
            const lastCommit = await execFileAsync("git", ["log", "-1", "--pretty=%s"], {
                cwd: workspaceRoot,
                env: {
                    ...process.env,
                    GIT_TERMINAL_PROMPT: "0",
                    GIT_OPTIONAL_LOCKS: "0",
                },
            });
            assert.equal(lastCommit.stdout.toString().trim(), "commit from mobile");

            client.send(makeClientMessage("workspace.pull", {
                sessionId: session.id,
            }));
            const pullMsg = await client.waitForMessage("workspace.pull.result");
            if (pullMsg.type !== "workspace.pull.result") {
                throw new Error("Expected workspace.pull.result");
            }
            assert.equal(pullMsg.payload.sessionId, session.id);
            assert.equal(pullMsg.payload.operation, "pull");
            assert.equal(pullMsg.payload.success, false);
            assert.ok((pullMsg.payload.message ?? pullMsg.payload.stderr ?? "").length > 0);

            client.send(makeClientMessage("workspace.push", {
                sessionId: session.id,
            }));
            const pushMsg = await client.waitForMessage("workspace.push.result");
            if (pushMsg.type !== "workspace.push.result") {
                throw new Error("Expected workspace.push.result");
            }
            assert.equal(pushMsg.payload.sessionId, session.id);
            assert.equal(pushMsg.payload.operation, "push");
            assert.equal(pushMsg.payload.success, false);
            assert.ok((pushMsg.payload.message ?? pushMsg.payload.stderr ?? "").length > 0);
        } finally {
            await client.close();
        }
    });

    it("uses the repository root for tree, file, and diff requests when cwd is a subdirectory", async () => {
        const nestedFilePath = join("apps", "bridge-server", "src", "copilot", "session-manager.ts");
        await mkdir(join(workspaceRoot, "apps", "bridge-server", "src", "copilot"), { recursive: true });
        await writeFile(join(workspaceRoot, nestedFilePath), "export const nested = true;\n");
        await runGit(workspaceRoot, ["add", nestedFilePath]);
        await runGit(workspaceRoot, ["commit", "-m", "add nested workspace file"]);
        await appendFile(join(workspaceRoot, nestedFilePath), "export const changed = true;\n");

        session.setContext({
            sessionCwd: join(workspaceRoot, "apps", "bridge-server"),
            workspaceRoot,
            gitRoot: workspaceRoot,
            repository: "example/copilot-mobile",
            branch: "main",
        });

        const token = generatePairingToken();
        const client = await createWSClient(workspaceTestPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.tree.request", {
                sessionId: session.id,
                workspaceRelativePath: ".",
                maxDepth: 2,
            }));
            const treeMsg = await client.waitForMessage("workspace.tree");
            if (treeMsg.type !== "workspace.tree") {
                throw new Error("Expected workspace.tree");
            }

            assert.equal(treeMsg.payload.workspaceRoot, workspaceRoot);
            assert.equal(treeMsg.payload.tree.path, ".");
            assert.ok((treeMsg.payload.tree.children?.map((child) => child.name) ?? []).includes("apps"));

            client.send(makeClientMessage("workspace.git.request", {
                sessionId: session.id,
                commitLimit: 5,
            }));
            const gitMsg = await client.waitForMessage("workspace.git.summary");
            if (gitMsg.type !== "workspace.git.summary") {
                throw new Error("Expected workspace.git.summary");
            }

            assert.equal(gitMsg.payload.workspaceRoot, workspaceRoot);
            assert.ok(gitMsg.payload.uncommittedChanges.some((change) => change.path === nestedFilePath));

            client.send(makeClientMessage("workspace.file.request", {
                sessionId: session.id,
                workspaceRelativePath: nestedFilePath,
            }));
            const fileMsg = await client.waitForMessage("workspace.file.response");
            if (fileMsg.type !== "workspace.file.response") {
                throw new Error("Expected workspace.file.response");
            }

            assert.equal(fileMsg.payload.error, undefined);
            assert.match(fileMsg.payload.content, /changed/);

            client.send(makeClientMessage("workspace.diff.request", {
                sessionId: session.id,
                workspaceRelativePath: nestedFilePath,
            }));
            const diffMsg = await client.waitForMessage("workspace.diff.response");
            if (diffMsg.type !== "workspace.diff.response") {
                throw new Error("Expected workspace.diff.response");
            }

            assert.equal(diffMsg.payload.error, undefined);
            assert.match(diffMsg.payload.diff, /changed/);
        } finally {
            await client.close();
        }
    });

    it("scopes recent commits to the active workspace root", async () => {
        const nestedWorkspaceRoot = join(workspaceRoot, "apps", "bridge-server");
        const nestedFilePath = join("src", "nested.ts");
        await mkdir(join(nestedWorkspaceRoot, "src"), { recursive: true });
        await writeFile(join(nestedWorkspaceRoot, nestedFilePath), "export const nested = true;\n");
        await runGit(workspaceRoot, ["add", "."]);
        await runGit(workspaceRoot, ["commit", "-m", "add nested workspace commit"]);

        session.setContext({
            sessionCwd: nestedWorkspaceRoot,
            workspaceRoot: nestedWorkspaceRoot,
            gitRoot: workspaceRoot,
            repository: "example/copilot-mobile",
            branch: "main",
        });

        const token = generatePairingToken();
        const client = await createWSClient(workspaceTestPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.git.request", {
                sessionId: session.id,
                commitLimit: 5,
            }));
            const gitMsg = await client.waitForMessage("workspace.git.summary");
            if (gitMsg.type !== "workspace.git.summary") {
                throw new Error("Expected workspace.git.summary");
            }

            assert.equal(gitMsg.payload.workspaceRoot, nestedWorkspaceRoot);
            assert.equal(gitMsg.payload.recentCommits.length, 1);
            assert.equal(
                gitMsg.payload.recentCommits.some((commit) =>
                    commit.fileChanges.some((file) => file.path === nestedFilePath)
                ),
                true
            );
            assert.equal(
                gitMsg.payload.recentCommits.some((commit) =>
                    commit.fileChanges.some((file) => file.path === "README.md" || file.path === "src/feature.ts")
                ),
                false
            );
        } finally {
            await client.close();
        }
    });

    it("returns no recent commits when none fall within the active workspace root", async () => {
        const nestedWorkspaceRoot = join(workspaceRoot, "apps", "bridge-server");
        await mkdir(nestedWorkspaceRoot, { recursive: true });

        session.setContext({
            sessionCwd: nestedWorkspaceRoot,
            workspaceRoot: nestedWorkspaceRoot,
            gitRoot: workspaceRoot,
            repository: "example/copilot-mobile",
            branch: "main",
        });

        const token = generatePairingToken();
        const client = await createWSClient(workspaceTestPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.git.request", {
                sessionId: session.id,
                commitLimit: 5,
            }));
            const gitMsg = await client.waitForMessage("workspace.git.summary");
            if (gitMsg.type !== "workspace.git.summary") {
                throw new Error("Expected workspace.git.summary");
            }

            assert.equal(gitMsg.payload.workspaceRoot, nestedWorkspaceRoot);
            assert.deepEqual(gitMsg.payload.recentCommits, []);
        } finally {
            await client.close();
        }
    });

    it("caps oversized workspace tree and git summary requests", async () => {
        const fixture = await createWorkspaceFixture({ commitCount: 55, deepDepth: 7 });
        const cappedSession = new FakeSession();
        cappedSession.setContext({
            sessionCwd: fixture.root,
            workspaceRoot: fixture.root,
            gitRoot: fixture.root,
            repository: "example/copilot-mobile",
            branch: "main",
        });

        const workspaceLimitPort = await reservePort();
        process.env["BRIDGE_PORT"] = String(workspaceLimitPort);
        const cappedServer = createBridgeServer(createFakeClient(cappedSession));
        await cappedServer.start();

        const token = generatePairingToken();
        const client = await createWSClient(workspaceLimitPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.tree.request", {
                sessionId: cappedSession.id,
                maxDepth: 999,
            }));
            const treeMsg = await client.waitForMessage("workspace.tree");
            if (treeMsg.type !== "workspace.tree") {
                throw new Error("Expected workspace.tree");
            }
            assert.equal(treeMsg.payload.truncated, true);

            client.send(makeClientMessage("workspace.git.request", {
                sessionId: cappedSession.id,
                commitLimit: 999,
            }));
            const gitMsg = await client.waitForMessage("workspace.git.summary");
            if (gitMsg.type !== "workspace.git.summary") {
                throw new Error("Expected workspace.git.summary");
            }
            assert.equal(gitMsg.payload.recentCommits.length, 50);
        } finally {
            await client.close();
            await cappedServer.shutdown();
            delete process.env["BRIDGE_PORT"];
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it("returns an empty git summary for non-repository workspaces", async () => {
        const fixture = await createPlainWorkspaceFixture();
        const plainSession = new FakeSession();
        plainSession.setContext({
            sessionCwd: fixture.root,
            workspaceRoot: fixture.root,
        });

        const workspaceLimitPort = await reservePort();
        process.env["BRIDGE_PORT"] = String(workspaceLimitPort);
        const plainServer = createBridgeServer(createFakeClient(plainSession));
        await plainServer.start();

        const token = generatePairingToken();
        const client = await createWSClient(workspaceLimitPort);

        try {
            client.send(makeClientMessage("auth.pair", {
                pairingToken: token,
                transportMode: "direct",
            }));
            await client.waitForMessage("auth.authenticated");

            client.send(makeClientMessage("session.create", {
                config: {
                    model: "gpt-4.1",
                    streaming: true,
                    agentMode: "agent",
                    permissionLevel: "default",
                },
            }));
            await client.waitForMessage("session.created");

            client.send(makeClientMessage("workspace.git.request", {
                sessionId: plainSession.id,
                commitLimit: 5,
            }));
            const gitMsg = await client.waitForMessage("workspace.git.summary");
            if (gitMsg.type !== "workspace.git.summary") {
                throw new Error("Expected workspace.git.summary");
            }

            assert.equal(gitMsg.payload.workspaceRoot, fixture.root);
            assert.equal(gitMsg.payload.gitRoot, null);
            assert.deepEqual(gitMsg.payload.uncommittedChanges, []);
            assert.deepEqual(gitMsg.payload.recentCommits, []);
        } finally {
            await client.close();
            await plainServer.shutdown();
            delete process.env["BRIDGE_PORT"];
            await rm(fixture.root, { recursive: true, force: true });
        }
    });
});

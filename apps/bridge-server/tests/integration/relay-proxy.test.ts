import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { createRelayAccessToken } from "../../src/auth/relay-token.js";
import { createRelayProxy } from "../../src/relay/proxy.js";

type RelayRoom = {
    companion: WebSocket | null;
    mobile: WebSocket | null;
};

type TestRelayServer = {
    url: string;
    close: () => Promise<void>;
};

type LocalBridgeHarness = {
    url: string;
    receivedMessages: Array<string>;
    broadcastToClient: (message: string) => void;
    close: () => Promise<void>;
};

async function listenHttpServer(server: ReturnType<typeof createHttpServer>): Promise<number> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Failed to read listening address");
    }
    return address.port;
}

async function createTestRelayServer(): Promise<TestRelayServer> {
    const rooms = new Map<string, RelayRoom>();
    const httpServer = createHttpServer((_req, res) => {
        res.writeHead(404);
        res.end();
    });
    const wss = new WebSocketServer({ noServer: true });

    function getOrCreateRoom(companionId: string): RelayRoom {
        const existing = rooms.get(companionId);
        if (existing !== undefined) {
            return existing;
        }

        const created: RelayRoom = { companion: null, mobile: null };
        rooms.set(companionId, created);
        return created;
    }

    wss.on("connection", (ws, _req, meta: { role: "mobile" | "companion"; companionId: string }) => {
        const room = getOrCreateRoom(meta.companionId);
        let authenticated = false;

        function attachAuthenticatedConnection(): void {
            if (meta.role === "companion") {
                room.companion = ws;
                ws.send(JSON.stringify({ type: "companion.ready", companionId: meta.companionId }));

                if (room.mobile !== null) {
                    ws.send(JSON.stringify({ type: "mobile.open", companionId: meta.companionId }));
                }

                ws.on("message", (data) => {
                    const payload = JSON.parse(String(data)) as { type: string; data?: string };
                    if (payload.type === "mobile.message" && payload.data !== undefined && room.mobile !== null) {
                        room.mobile.send(payload.data);
                        return;
                    }

                    if (payload.type === "mobile.close" && room.mobile !== null) {
                        room.mobile.close(1013, payload.reason ?? "Companion requested close");
                    }
                });

                ws.on("close", () => {
                    room.companion = null;
                    if (room.mobile !== null) {
                        room.mobile.close(1013, "Companion offline");
                        room.mobile = null;
                    }
                });

                return;
            }

            room.mobile = ws;
            if (room.companion === null) {
                ws.close(1013, "Companion offline");
                room.mobile = null;
                return;
            }

            room.companion.send(JSON.stringify({ type: "mobile.open", companionId: meta.companionId }));

            ws.on("message", (data) => {
                if (room.companion !== null) {
                    room.companion.send(JSON.stringify({
                        type: "mobile.message",
                        companionId: meta.companionId,
                        data: String(data),
                    }));
                }
            });

            ws.on("close", () => {
                room.mobile = null;
                if (room.companion !== null) {
                    room.companion.send(JSON.stringify({
                        type: "mobile.close",
                        companionId: meta.companionId,
                        reason: "Mobile disconnected",
                    }));
                }
            });
        }

        ws.on("message", (data) => {
            if (authenticated) {
                return;
            }

            const payload = JSON.parse(String(data)) as {
                type?: string;
                role?: "mobile" | "companion";
                accessToken?: string;
            };

            if (
                payload.type !== "relay.connect"
                || payload.role !== meta.role
                || typeof payload.accessToken !== "string"
            ) {
                ws.close(1008, "Relay authentication failed");
                return;
            }

            authenticated = true;
            attachAuthenticatedConnection();
        });
    });

    httpServer.on("upgrade", (req, socket, head) => {
        const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length !== 3 || parts[0] !== "connect") {
            socket.destroy();
            return;
        }

        const role = parts[1];
        const companionId = decodeURIComponent(parts[2] ?? "");
        if ((role !== "mobile" && role !== "companion") || companionId.length === 0) {
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req, {
                role: role as "mobile" | "companion",
                companionId,
            });
        });
    });

    const port = await listenHttpServer(httpServer);

    return {
        url: `ws://127.0.0.1:${port}`,
        close: async () => {
            wss.close();
            await new Promise<void>((resolve) => {
                httpServer.close(() => resolve());
            });
        },
    };
}

async function createLocalBridgeHarness(): Promise<LocalBridgeHarness> {
    const receivedMessages: Array<string> = [];
    const httpServer = createHttpServer();
    const wss = new WebSocketServer({ server: httpServer });

    let activeSocket: WebSocket | null = null;

    wss.on("connection", (ws) => {
        activeSocket = ws;
        ws.on("message", (data) => {
            receivedMessages.push(String(data));
        });
        ws.on("close", () => {
            if (activeSocket === ws) {
                activeSocket = null;
            }
        });
    });

    const port = await listenHttpServer(httpServer);

    return {
        url: `ws://127.0.0.1:${port}`,
        receivedMessages,
        broadcastToClient: (message: string) => {
            activeSocket?.send(message);
        },
        close: async () => {
            wss.close();
            await new Promise<void>((resolve) => {
                httpServer.close(() => resolve());
            });
        },
    };
}

function waitForCondition(check: () => boolean, timeoutMs = 5_000): Promise<void> {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
            if (check()) {
                clearInterval(timer);
                resolve();
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                reject(new Error("Timed out waiting for condition"));
            }
        }, 25);
    });
}

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (cleanupCallbacks.length > 0) {
        const cleanup = cleanupCallbacks.pop();
        await cleanup?.();
    }
});

describe("relay proxy", () => {
    it("forwards mobile traffic to the local bridge and back", async () => {
        process.env["COPILOT_MOBILE_RELAY_SECRET"] = "relay-test-secret-0123456789abcdef";
        const relayServer = await createTestRelayServer();
        cleanupCallbacks.push(() => relayServer.close());

        const localBridge = await createLocalBridgeHarness();
        cleanupCallbacks.push(() => localBridge.close());

        const companionId = "companion-test";
        const relayProxy = createRelayProxy({
            relayUrl: `${relayServer.url}/connect/companion/${companionId}`,
            localBridgeUrl: localBridge.url,
            companionId,
            accessToken: createRelayAccessToken("companion", companionId),
        });
        relayProxy.start();
        cleanupCallbacks.push(async () => {
            relayProxy.shutdown();
        });

        const mobileSocket = new WebSocket(`${relayServer.url}/connect/mobile/${companionId}`);
        cleanupCallbacks.push(async () => {
            await new Promise<void>((resolve) => {
                if (mobileSocket.readyState === WebSocket.CLOSED) {
                    resolve();
                    return;
                }

                mobileSocket.once("close", () => resolve());
                mobileSocket.close();
            });
        });

        await once(mobileSocket, "open");
        mobileSocket.send(JSON.stringify({
            type: "relay.connect",
            role: "mobile",
            accessToken: createRelayAccessToken("mobile", companionId),
        }));

        const mobileMessages: Array<string> = [];
        mobileSocket.on("message", (data) => {
            mobileMessages.push(String(data));
        });

        mobileSocket.send(JSON.stringify({ type: "ping", from: "mobile" }));
        await waitForCondition(() => localBridge.receivedMessages.length === 1);
        assert.equal(localBridge.receivedMessages[0], JSON.stringify({ type: "ping", from: "mobile" }));

        localBridge.broadcastToClient(JSON.stringify({ type: "pong", from: "bridge" }));
        await waitForCondition(() => mobileMessages.length === 1);
        assert.equal(mobileMessages[0], JSON.stringify({ type: "pong", from: "bridge" }));

        const status = relayProxy.getStatus();
        assert.equal(status.connectedToRelay, true);
        assert.equal(status.connectedToLocalBridge, true);
        assert.equal(status.companionId, companionId);
    });

    it("closes the mobile tunnel when the local bridge buffer overflows", async () => {
        process.env["COPILOT_MOBILE_RELAY_SECRET"] = "relay-test-secret-0123456789abcdef";
        const relayServer = await createTestRelayServer();
        cleanupCallbacks.push(() => relayServer.close());

        const companionId = "companion-overflow";
        const relayProxy = createRelayProxy({
            relayUrl: `${relayServer.url}/connect/companion/${companionId}`,
            localBridgeUrl: "ws://127.0.0.1:9",
            companionId,
            accessToken: createRelayAccessToken("companion", companionId),
        });
        relayProxy.start();
        cleanupCallbacks.push(async () => {
            relayProxy.shutdown();
        });

        const mobileSocket = new WebSocket(`${relayServer.url}/connect/mobile/${companionId}`);
        await once(mobileSocket, "open");
        mobileSocket.send(JSON.stringify({
            type: "relay.connect",
            role: "mobile",
            accessToken: createRelayAccessToken("mobile", companionId),
        }));

        const closeEventPromise = once(mobileSocket, "close");
        for (let index = 0; index <= 100; index += 1) {
            mobileSocket.send(JSON.stringify({ type: "queued", index }));
        }

        const [closeCode, closeReason] = await closeEventPromise;
        assert.equal(closeCode, 1013);
        assert.equal(String(closeReason), "Local bridge unavailable. Please retry.");
    });
});

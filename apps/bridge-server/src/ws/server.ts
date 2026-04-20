// WebSocket server — local bridge connection, heartbeat, message routing

import { createServer as createHttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { ServerMessage, AdaptedCopilotClient } from "@copilot-mobile/shared";
import { DEFAULT_WS_PORT, HEARTBEAT_INTERVAL_MS, MAX_MESSAGE_BUFFER } from "@copilot-mobile/shared";
import { createSessionManager } from "../copilot/session-manager.js";
import { createMessageHandler } from "./handler.js";
import { checkPairingRateLimit } from "../utils/rate-limit.js";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";

const AUTH_HANDSHAKE_TIMEOUT_MS = 10_000;

type ActiveClient = {
    ws: WebSocket;
    handler: ReturnType<typeof createMessageHandler>;
    alive: boolean;
};

export function createBridgeServer(copilotClient: AdaptedCopilotClient) {
    const port = parseInt(process.env["BRIDGE_PORT"] ?? "", 10) || DEFAULT_WS_PORT;

    const httpServer = createHttpServer();
    const wss = new WebSocketServer({ server: httpServer, maxPayload: 1 * 1024 * 1024 });

    let activeClient: ActiveClient | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    // Reconnect replay buffer — keeps last MAX_MESSAGE_BUFFER messages
    const messageBuffer: ServerMessage[] = [];

    const sendToActiveClient: (message: ServerMessage) => void = (message) => {
        if (
            message.type !== "pairing.success"
            && message.type !== "token.refresh"
            && message.type !== "reconnect.ready"
            && message.type !== "permission.request"
            && message.type !== "user_input.request"
        ) {
            const alreadyBuffered = messageBuffer.some((m) => m.seq === message.seq);
            if (!alreadyBuffered) {
                messageBuffer.push(message);
                if (messageBuffer.length > MAX_MESSAGE_BUFFER) {
                    messageBuffer.shift();
                }
            }
        }

        if (activeClient?.ws.readyState === WebSocket.OPEN) {
            activeClient.ws.send(JSON.stringify(message));
        }
    };

    const sessionManager = createSessionManager(copilotClient, sendToActiveClient);

    function getClientIP(req: IncomingMessage): string {
        return req.socket.remoteAddress ?? "unknown";
    }

    function sendToSocket(ws: WebSocket, message: ServerMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    function promoteClient(nextClient: ActiveClient, preserveReplayBuffer: boolean): void {
        const previousClient = activeClient;
        activeClient = nextClient;
        activeClient.alive = true;

        if (!preserveReplayBuffer) {
            sessionManager.discardPendingPrompts();
            messageBuffer.length = 0;
        }

        if (previousClient !== null && previousClient.ws !== nextClient.ws) {
            console.log("[ws] Closing existing authenticated connection");
            previousClient.ws.close(1000, "New authenticated client connected");
        }
    }

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        const clientIP = getClientIP(req);
        console.log(`[ws] New connection: ${clientIP}`);

        // JWT reconnect desteği
        const url = new URL(req.url ?? "/", `ws://${req.headers.host ?? "localhost"}`);
        const jwtToken = url.searchParams.get("token");

        // Rate limit — sadece yeni pairing bağlantıları için (JWT reconnect hariç)
        if (jwtToken === null && !checkPairingRateLimit(clientIP)) {
            ws.close(1008, "Rate limit exceeded");
            return;
        }

        let handler: ReturnType<typeof createMessageHandler>;
        let authTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            if (!handler.isAuthenticated && ws.readyState === WebSocket.OPEN) {
                ws.close(1008, "Authentication timeout");
            }
        }, AUTH_HANDSHAKE_TIMEOUT_MS);

        handler = createMessageHandler(
            sessionManager,
            (message) => sendToSocket(ws, message),
            messageBuffer,
            null,
            () => {
                if (authTimeout !== null) {
                    clearTimeout(authTimeout);
                    authTimeout = null;
                }
                promoteClient({ ws, handler, alive: true }, jwtToken !== null);
            }
        );

        // Auto-auth with JWT
        if (jwtToken !== null && handler.authenticateWithJWT(jwtToken)) {
            console.log(`[ws] Reconnected with JWT: ${handler.deviceId}`);
        }

        ws.on("message", async (data: Buffer) => {
            try {
                await handler.handleRawMessage(data.toString("utf-8"));
            } catch (err) {
                console.error("[ws] Message handling error:", err);
                // Hatayı istemciye bildir
                const errorPayload: ServerMessage = {
                    id: generateMessageId(),
                    timestamp: nowMs(),
                    seq: nextSeq(),
                    type: "error",
                    payload: {
                        code: "INTERNAL_ERROR",
                        message: err instanceof Error ? err.message : "Internal server error",
                        retry: false,
                    },
                };
                sendToSocket(ws, errorPayload);
            }
        });

        ws.on("pong", () => {
            if (activeClient !== null && activeClient.ws === ws) {
                activeClient.alive = true;
            }
        });

        ws.on("close", (code: number, reason: Buffer) => {
            console.log(`[ws] Connection closed: ${code} ${reason.toString("utf-8")}`);
            if (authTimeout !== null) {
                clearTimeout(authTimeout);
                authTimeout = null;
            }
            if (activeClient !== null && activeClient.ws === ws) {
                activeClient = null;
            }
        });

        ws.on("error", (err: Error) => {
            console.error("[ws] WebSocket error:", err.message);
            if (authTimeout !== null) {
                clearTimeout(authTimeout);
                authTimeout = null;
            }
            // Hata durumunda bağlantıyı temizle — zombi bağlantıları engelle
            if (activeClient !== null && activeClient.ws === ws) {
                activeClient = null;
            }
        });
    });

    // Heartbeat mechanism
    heartbeatInterval = setInterval(() => {
        if (activeClient !== null) {
            if (!activeClient.alive) {
                console.log("[ws] Heartbeat timeout — closing connection");
                activeClient.handler.cleanup();
                activeClient.ws.terminate();
                activeClient = null;
                return;
            }
            activeClient.alive = false;
            activeClient.ws.ping();
        }
    }, HEARTBEAT_INTERVAL_MS);

    return {
        start(): Promise<void> {
            return new Promise((resolve) => {
                httpServer.listen(port, () => {
                    console.log(`[ws] Bridge server dinliyor: ws://0.0.0.0:${port}`);
                    resolve();
                });
            });
        },

        async shutdown(): Promise<void> {
            console.log("[ws] Shutting down server...");

            if (heartbeatInterval !== null) {
                clearInterval(heartbeatInterval);
            }

            if (activeClient !== null) {
                activeClient.ws.close(1001, "Server shutting down");
                activeClient = null;
            }

            wss.close();

            return new Promise((resolve) => {
                httpServer.close(async () => {
                    await sessionManager.shutdown();
                    console.log("[ws] Server shut down");
                    resolve();
                });
            });
        },

        get port() {
            return port;
        },

        get hasClient() {
            return activeClient !== null;
        },
    };
}

// WebSocket server — local bridge connection, heartbeat, message routing

import { createServer as createHttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { ServerMessage, AdaptedCopilotClient } from "@copilot-mobile/shared";
import {
    AUTH_FRAME_TIMEOUT_MS,
    DEFAULT_WS_PORT,
    HEARTBEAT_INTERVAL_MS,
    MAX_MESSAGE_BUFFER,
    PROTOCOL_VERSION,
} from "@copilot-mobile/shared";
import { createSessionManager } from "../copilot/session-manager.js";
import { createMessageHandler } from "./handler.js";
import { checkPairingRateLimit } from "../utils/rate-limit.js";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";
import { generatePairingQRCode } from "../auth/qr.js";
import { isPairingActive } from "../auth/pairing.js";
import { renderCompanionDashboard } from "../http/dashboard.js";

const MANAGEMENT_STATUS_PATH = "/__copilot_mobile/status";
const MANAGEMENT_QR_PATH = "/__copilot_mobile/qr";
const MANAGEMENT_DASHBOARD_PATH = "/__copilot_mobile/dashboard";

type ActiveClient = {
    ws: WebSocket;
    handler: ReturnType<typeof createMessageHandler>;
    alive: boolean;
};

type PairingQRCodeState = Awaited<ReturnType<typeof generatePairingQRCode>>;

function isLoopbackAddress(remoteAddress: string): boolean {
    return remoteAddress === "::1"
        || remoteAddress === "127.0.0.1"
        || remoteAddress === "::ffff:127.0.0.1";
}

export function createBridgeServer(
    copilotClient: AdaptedCopilotClient,
    publicWebSocketUrl?: string,
    options?: {
        companionId?: string;
        relayMobileAccessToken?: string;
        getRelayStatus?: () => {
            connectedToRelay: boolean;
            connectedToLocalBridge: boolean;
            relayUrl: string;
        } | null;
    }
) {
    const port = parseInt(process.env["BRIDGE_PORT"] ?? "", 10) || DEFAULT_WS_PORT;
    const resolvedPublicWebSocketUrl = publicWebSocketUrl ?? `ws://127.0.0.1:${port}`;

    let activeClient: ActiveClient | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let latestQrCode: PairingQRCodeState | null = null;

    // Reconnect replay buffer — keeps last MAX_MESSAGE_BUFFER messages
    const messageBuffer: ServerMessage[] = [];

    const sendToActiveClient: (message: ServerMessage) => void = (message) => {
        if (
            message.type !== "auth.authenticated"
            && message.type !== "auth.session_token"
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

    async function createPairingQrCode(relayAccessToken?: string): Promise<PairingQRCodeState> {
        const qrCode = await generatePairingQRCode(
            resolvedPublicWebSocketUrl,
            options?.companionId,
            relayAccessToken
        );
        latestQrCode = qrCode;
        return qrCode;
    }

    function getStatus() {
        const relayStatus = options?.getRelayStatus?.() ?? null;
        return {
            pid: process.pid,
            port,
            publicUrl: resolvedPublicWebSocketUrl,
            companionId: options?.companionId ?? null,
            relay: relayStatus,
            hasClient: activeClient !== null,
            pairingActive: isPairingActive(),
            qrExpiresAt: latestQrCode?.expiresAt ?? null,
        };
    }

    async function handleManagementRequest(
        req: IncomingMessage,
        res: import("node:http").ServerResponse
    ): Promise<void> {
        const remoteAddress = req.socket.remoteAddress ?? "";
        if (!isLoopbackAddress(remoteAddress)) {
            res.writeHead(403, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Management endpoints are only available on localhost." }));
            return;
        }

        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

        if (req.method === "GET" && requestUrl.pathname === MANAGEMENT_STATUS_PATH) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: getStatus() }));
            return;
        }

        if (req.method === "GET" && requestUrl.pathname === MANAGEMENT_DASHBOARD_PATH) {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(renderCompanionDashboard());
            return;
        }

        if (req.method === "POST" && requestUrl.pathname === MANAGEMENT_QR_PATH) {
            const qrCode = await createPairingQrCode(options?.relayMobileAccessToken);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
                status: getStatus(),
                qrCode: {
                    ascii: qrCode.ascii,
                    payload: qrCode.payload,
                    expiresAt: qrCode.expiresAt,
                },
            }));
            return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    }

    const httpServer = createHttpServer((req, res) => {
        void handleManagementRequest(req, res).catch((error: unknown) => {
            console.error("[http] Management request failed:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "content-type": "application/json" });
            }
            res.end(JSON.stringify({ error: "Internal server error" }));
        });
    });
    const wss = new WebSocketServer({ server: httpServer, maxPayload: 1 * 1024 * 1024 });
    wss.on("error", (error: Error) => {
        console.error("[ws] WebSocket server error:", error.message);
    });

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

        let handler: ReturnType<typeof createMessageHandler>;
        let authTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            if (!handler.isAuthenticated && ws.readyState === WebSocket.OPEN) {
                ws.close(1008, "Authentication timeout");
            }
        }, AUTH_FRAME_TIMEOUT_MS);

        const clearAuthTimeout = (): void => {
            if (authTimeout !== null) {
                clearTimeout(authTimeout);
                authTimeout = null;
            }
        };

        handler = createMessageHandler(
            sessionManager,
            (message) => sendToSocket(ws, message),
            messageBuffer,
            null,
            (preserveReplayBuffer) => {
                clearAuthTimeout();
                promoteClient({ ws, handler, alive: true }, preserveReplayBuffer);
            }
        );

        ws.on("message", async (data: Buffer) => {
            if (!handler.isAuthenticated) {
                try {
                    const parsed = JSON.parse(data.toString("utf-8")) as { type?: unknown };
                    if (parsed.type === "auth.pair" && !checkPairingRateLimit(clientIP)) {
                        ws.close(1008, "Rate limit exceeded");
                        return;
                    }
                } catch {
                    // Let the handler return structured validation errors.
                }
            }
            try {
                await handler.handleRawMessage(data.toString("utf-8"));
            } catch (err) {
                console.error("[ws] Message handling error:", err);
                // Hatayı istemciye bildir
                const errorPayload: ServerMessage = {
                    id: generateMessageId(),
                    timestamp: nowMs(),
                    seq: nextSeq(),
                    protocolVersion: PROTOCOL_VERSION,
                    type: "error",
                    payload: {
                        code: "INTERNAL_ERROR",
                        message: "Internal server error",
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
            clearAuthTimeout();
            if (activeClient !== null && activeClient.ws === ws) {
                activeClient = null;
            }
        });

        ws.on("error", (err: Error) => {
            console.error("[ws] WebSocket error:", err.message);
            clearAuthTimeout();
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
            return new Promise((resolve, reject) => {
                const handleListenError = (error: Error): void => {
                    httpServer.off("listening", handleListening);
                    reject(error);
                };

                const handleListening = (): void => {
                    httpServer.off("error", handleListenError);
                    console.log(`[ws] Bridge server dinliyor: ws://0.0.0.0:${port}`);
                    resolve();
                };

                httpServer.once("error", handleListenError);
                httpServer.once("listening", handleListening);
                httpServer.listen(port);
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

        getStatus,

        createPairingQrCode,
    };
}

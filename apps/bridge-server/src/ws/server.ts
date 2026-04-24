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
import { checkPairingRateLimit, checkResumeRateLimit } from "../utils/rate-limit.js";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";
import { generatePairingQRCode } from "../auth/qr.js";
import { isPairingActive } from "../auth/pairing.js";
import { renderCompanionDashboard } from "../http/dashboard.js";
import { createCompletionNotifier } from "../notifications/completion-notifier.js";
import { createDeviceRegistry } from "../notifications/device-registry.js";
import { createPushProvider } from "../notifications/push-provider.js";
import { createAttachmentUploadStore } from "../uploads/attachment-upload-store.js";
import { createVSCodeExternalSessionStore } from "../vscode/external-session-store.js";

const MANAGEMENT_STATUS_PATH = "/__copilot_mobile/status";
const MANAGEMENT_QR_PATH = "/__copilot_mobile/qr";
const MANAGEMENT_DASHBOARD_PATH = "/__copilot_mobile/dashboard";
const MANAGEMENT_HEALTH_PATH = "/health";
const RELAY_PROXY_HEADER = "x-copilot-mobile-relay-proxy";
const LOCALHOST_BIND_ADDRESS = "127.0.0.1";
const ALL_INTERFACES_BIND_ADDRESS = "0.0.0.0";
const LOCALHOST_ORIGIN_PATTERNS: ReadonlyArray<RegExp> = [
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
    /^https?:\/\/localhost(?::\d+)?$/i,
    /^https?:\/\/\[::1\](?::\d+)?$/i,
];

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

function isTrustedRelayProxyRequest(req: IncomingMessage): boolean {
    const remoteAddress = req.socket.remoteAddress ?? "";
    const headerValue = req.headers[RELAY_PROXY_HEADER];

    return isLoopbackAddress(remoteAddress)
        && (headerValue === "1" || (Array.isArray(headerValue) && headerValue.includes("1")));
}

function shouldBindAllInterfaces(publicWebSocketUrl: string): boolean {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(publicWebSocketUrl);
    } catch {
        return false;
    }

    return parsedUrl.protocol === "ws:";
}

function writeJson(
    res: import("node:http").ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>
): void {
    res.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(payload));
}

function writeHtml(
    res: import("node:http").ServerResponse,
    statusCode: number,
    html: string
): void {
    res.writeHead(statusCode, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    res.end(html);
}

function isAllowedManagementOrigin(originHeader: string | string[] | undefined): boolean {
    if (originHeader === undefined) {
        return true;
    }

    const origins = Array.isArray(originHeader) ? originHeader : [originHeader];
    return origins.every((origin) => LOCALHOST_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin)));
}

export function createBridgeServer(
    copilotClient: AdaptedCopilotClient,
    publicWebSocketUrl?: string,
    options?: {
        publicCertFingerprint?: string | null;
        companionId?: string;
        getRelayMobileAccessToken?: () => string | null;
        getRelayStatus?: () => {
            connectedToRelay: boolean;
            connectedToLocalBridge: boolean;
            relayUrl: string;
        } | null;
        getManagementState?: () => {
            daemonState: "starting" | "running" | "error" | "stopping";
            mode: "direct" | "hosted" | "self_hosted";
            copilotAuthenticated: boolean;
            lastError: string | null;
            lastPairingAt: number | null;
            logsDirectory: string | null;
            workspaceRoot: string | null;
            hostedApiBaseUrl?: string;
            hostedRelayBaseUrl?: string;
            sessionExpiresAt?: number | null;
        };
        onStopRequested?: () => Promise<void>;
        onOpenLogsRequested?: () => void | Promise<void>;
        onPairingAuthenticated?: () => void;
    }
) {
    const port = parseInt(process.env["BRIDGE_PORT"] ?? "", 10) || DEFAULT_WS_PORT;
    const resolvedPublicWebSocketUrl = publicWebSocketUrl ?? `ws://127.0.0.1:${port}`;
    const listenHost = shouldBindAllInterfaces(resolvedPublicWebSocketUrl)
        ? ALL_INTERFACES_BIND_ADDRESS
        : LOCALHOST_BIND_ADDRESS;

    let activeClient: ActiveClient | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let latestQrCode: PairingQRCodeState | null = null;

    // Reconnect replay buffer — keeps last MAX_MESSAGE_BUFFER messages
    const messageBuffer: ServerMessage[] = [];

    const sendToActiveClient: (message: ServerMessage) => void = (message) => {
        if (
            message.type !== "auth.authenticated"
            && message.type !== "auth.session_token"
            && message.type !== "error"
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

    const deviceRegistry = createDeviceRegistry();
    const pushProvider = createPushProvider();
    const completionNotifier = createCompletionNotifier({
        deviceRegistry,
        pushProvider,
    });
    const attachmentUploads = createAttachmentUploadStore();
    const externalSessionStore = createVSCodeExternalSessionStore();
    const sessionManager = createSessionManager(
        copilotClient,
        sendToActiveClient,
        completionNotifier,
        attachmentUploads,
        externalSessionStore
    );

    async function createPairingQrCode(relayAccessToken?: string): Promise<PairingQRCodeState> {
        const qrCode = await generatePairingQRCode(
            resolvedPublicWebSocketUrl,
            options?.publicCertFingerprint ?? null,
            options?.companionId,
            relayAccessToken
        );
        latestQrCode = qrCode;
        return qrCode;
    }

    function getStatus() {
        const relayStatus = options?.getRelayStatus?.() ?? null;
        const managementState = options?.getManagementState?.();
        return {
            pid: process.pid,
            port,
            publicUrl: resolvedPublicWebSocketUrl,
            companionId: options?.companionId ?? null,
            relay: relayStatus,
            hasClient: activeClient !== null,
            pairingActive: isPairingActive(),
            qrExpiresAt: latestQrCode?.expiresAt ?? null,
            daemonState: managementState?.daemonState ?? "running",
            mode: managementState?.mode ?? "direct",
            copilotAuthenticated: managementState?.copilotAuthenticated ?? true,
            lastError: managementState?.lastError ?? null,
            lastPairingAt: managementState?.lastPairingAt ?? null,
            logsDirectory: managementState?.logsDirectory ?? null,
            workspaceRoot: managementState?.workspaceRoot ?? null,
            hostedApiBaseUrl: managementState?.hostedApiBaseUrl ?? null,
            hostedRelayBaseUrl: managementState?.hostedRelayBaseUrl ?? null,
            sessionExpiresAt: managementState?.sessionExpiresAt ?? null,
        };
    }

    function getHealthStatus() {
        const status = getStatus();
        const relayRequired = status.mode === "hosted" || status.mode === "self_hosted";
        const ready = status.daemonState === "running"
            && status.copilotAuthenticated
            && (!relayRequired || (
                status.relay?.connectedToRelay === true
                && status.relay.connectedToLocalBridge === true
            ));

        return {
            ready,
            daemonState: status.daemonState,
            copilotAuthenticated: status.copilotAuthenticated,
            relayConnected: status.relay?.connectedToRelay ?? false,
            localBridgeLinked: status.relay?.connectedToLocalBridge ?? false,
            mode: status.mode,
        };
    }

    async function handleManagementRequest(
        req: IncomingMessage,
        res: import("node:http").ServerResponse
    ): Promise<void> {
        const remoteAddress = req.socket.remoteAddress ?? "";
        if (!isLoopbackAddress(remoteAddress)) {
            writeJson(res, 403, { error: "Management endpoints are only available on localhost." });
            return;
        }

        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        const method = req.method ?? "GET";

        if (method === "GET" && requestUrl.pathname === MANAGEMENT_STATUS_PATH) {
            writeJson(res, 200, { status: getStatus() });
            return;
        }

        if (method === "GET" && requestUrl.pathname === MANAGEMENT_HEALTH_PATH) {
            const health = getHealthStatus();
            writeJson(res, health.ready ? 200 : 503, { health, status: getStatus() });
            return;
        }

        if (method === "GET" && requestUrl.pathname === MANAGEMENT_DASHBOARD_PATH) {
            writeHtml(res, 200, renderCompanionDashboard());
            return;
        }

        if (method === "POST" && !isAllowedManagementOrigin(req.headers.origin)) {
            writeJson(res, 403, { error: "Cross-origin management requests are not allowed." });
            return;
        }

        if (method === "POST" && requestUrl.pathname === MANAGEMENT_QR_PATH) {
            const relayStatus = options?.getRelayStatus?.() ?? null;
            const managementState = options?.getManagementState?.();
            const relayRequired =
                managementState?.mode === "hosted"
                || managementState?.mode === "self_hosted";
            if (relayRequired && relayStatus?.connectedToRelay !== true) {
                writeJson(res, 503, {
                    error: "Hosted relay is not ready yet. Wait a moment and try again.",
                    status: getStatus(),
                });
                return;
            }

            if (relayRequired && relayStatus?.connectedToLocalBridge !== true) {
                writeJson(res, 503, {
                    error: "Local bridge is still warming up. Wait a moment and try again.",
                    status: getStatus(),
                });
                return;
            }

            const qrCode = await createPairingQrCode(options?.getRelayMobileAccessToken?.() ?? undefined);
            writeJson(res, 200, {
                status: getStatus(),
                qrCode: {
                    ascii: qrCode.ascii,
                    payload: qrCode.payload,
                    expiresAt: qrCode.expiresAt,
                },
            });
            return;
        }

        if (method === "POST" && requestUrl.pathname === "/__copilot_mobile/open-logs") {
            await options?.onOpenLogsRequested?.();
            writeJson(res, 200, { ok: true, status: getStatus() });
            return;
        }

        if (method === "POST" && requestUrl.pathname === "/__copilot_mobile/stop") {
            writeJson(res, 200, { ok: true });
            queueMicrotask(() => {
                void options?.onStopRequested?.();
            });
            return;
        }

        if (requestUrl.pathname === MANAGEMENT_STATUS_PATH
            || requestUrl.pathname === MANAGEMENT_HEALTH_PATH
            || requestUrl.pathname === MANAGEMENT_DASHBOARD_PATH
            || requestUrl.pathname === MANAGEMENT_QR_PATH
            || requestUrl.pathname === "/__copilot_mobile/open-logs"
            || requestUrl.pathname === "/__copilot_mobile/stop") {
            writeJson(res, 405, { error: `Method ${method} is not allowed for ${requestUrl.pathname}.` });
            return;
        }

        writeJson(res, 404, { error: "Not found" });
    }

    const httpServer = createHttpServer((req, res) => {
        void handleManagementRequest(req, res).catch((error: unknown) => {
            console.error("[http] Management request failed:", error);
            if (!res.headersSent && !res.writableEnded) {
                writeJson(res, 500, { error: "Internal server error" });
                return;
            }
            if (!res.writableEnded) {
                res.end();
            }
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
        const trustedRelayProxy = isTrustedRelayProxyRequest(req);
        const connectionId = generateMessageId();
        console.log(`[ws] New connection: ${clientIP}`);

        let handler: ReturnType<typeof createMessageHandler>;
        let authTimeout: ReturnType<typeof setTimeout> | null = trustedRelayProxy
            ? null
            : setTimeout(() => {
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
            (authMethod, preserveReplayBuffer, deviceId) => {
                clearAuthTimeout();
                deviceRegistry.markConnected(deviceId, connectionId);
                promoteClient({ ws, handler, alive: true }, preserveReplayBuffer);
                if (authMethod === "pair") {
                    options?.onPairingAuthenticated?.();
                }
            },
            {
                registerNotificationDevice: (input) => {
                    deviceRegistry.registerPushTarget(input);
                },
                unregisterNotificationDevice: (deviceId) => {
                    deviceRegistry.unregisterPushTarget(deviceId);
                },
                updateNotificationPresence: (input) => {
                    deviceRegistry.updatePresence({
                        ...input,
                        connectionId,
                    });
                },
            },
            options?.getRelayMobileAccessToken
        );

        ws.on("message", async (data: Buffer) => {
            if (!handler.isAuthenticated) {
                try {
                    const parsed = JSON.parse(data.toString("utf-8")) as { type?: unknown };
                    if (parsed.type === "auth.pair" && !checkPairingRateLimit(clientIP)) {
                        ws.close(1008, "Rate limit exceeded");
                        return;
                    }
                    if (parsed.type === "auth.resume" && !checkResumeRateLimit(clientIP)) {
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
            if (handler.deviceId !== null) {
                deviceRegistry.markDisconnected(handler.deviceId, connectionId);
            }
            if (activeClient !== null && activeClient.ws === ws) {
                activeClient = null;
            }
        });

        ws.on("error", (err: Error) => {
            console.error("[ws] WebSocket error:", err.message);
            clearAuthTimeout();
            if (handler.deviceId !== null) {
                deviceRegistry.markDisconnected(handler.deviceId, connectionId);
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
            return new Promise((resolve, reject) => {
                const handleListenError = (error: Error): void => {
                    httpServer.off("listening", handleListening);
                    reject(error);
                };

                const handleListening = (): void => {
                    httpServer.off("error", handleListenError);
                    console.log(`[ws] Bridge server listening on ${listenHost}:${port}`);
                    resolve();
                };

                httpServer.once("error", handleListenError);
                httpServer.once("listening", handleListening);
                httpServer.listen(port, listenHost);
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

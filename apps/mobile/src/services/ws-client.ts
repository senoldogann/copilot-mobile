// WebSocket client — manages connection to bridge server
// Auto-reconnect, heartbeat, message queuing

import * as Crypto from "expo-crypto";
import type {
    ClientMessage,
    QRPayload,
    ServerMessage,
    TransportMode,
} from "@copilot-mobile/shared";
import { PROTOCOL_VERSION, serverMessageSchema } from "@copilot-mobile/shared";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticated";

export type WSClientConfig = {
    onMessage: (message: ServerMessage) => void;
    onStateChange: (state: ConnectionState) => void;
    onError: (error: string) => void;
};

export type ResumeOptions = {
    reconnectOnFailure: boolean;
    reportErrors: boolean;
};

type PendingMessage = {
    message: ClientMessage;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

const PENDING_TIMEOUT_MS = 30_000;
const MAX_PENDING_MESSAGES = 100;
const AUTHENTICATION_TIMEOUT_MS = 12_000;
const SOCKET_ERROR_RECOVERY_DELAY_MS = 250;

function createSeqGenerator(): () => number {
    let counter = 0;
    return () => {
        counter += 1;
        return counter;
    };
}

function generateId(): string {
    if (typeof Crypto.randomUUID === "function") {
        return Crypto.randomUUID();
    }

    const bytes = Crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join(""),
    ].join("-");
}

export function createWSClient(config: WSClientConfig) {
    let ws: WebSocket | null = null;
    let state: ConnectionState = "disconnected";
    let deviceCredential: string | null = null;
    let sessionToken: string | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingMessages: Array<PendingMessage> = [];
    let reconnectAttempt = 0;
    let serverUrl: string | null = null;
    let expectedFingerprint: string | null = null;
    let transportMode: TransportMode | null = null;
    let relayAccessToken: string | null = null;
    let lastServerSeq = 0;
    let reconnectOnClose = false;
    let reportConnectionErrors = true;
    const MAX_RECONNECT_DELAY_MS = 30_000;
    const BASE_RECONNECT_DELAY_MS = 1_000;
    const nextSeq = createSeqGenerator();
    let pendingPairMessage: ClientMessage | null = null;
    let pendingResumeMessage: ClientMessage | null = null;
    let authenticationTimer: ReturnType<typeof setTimeout> | null = null;
    let socketErrorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

    function describeSocketClose(code: number, reason: string): string {
        if (reason.trim().length > 0) {
            return `Connection closed (${code}): ${reason}`;
        }

        if (code === 1008) {
            return "Connection rejected by the companion";
        }

        if (code === 1006) {
            return "Connection closed unexpectedly";
        }

        if (code === 1011) {
            return "Companion encountered an internal error";
        }

        return `Connection closed (${code})`;
    }

    function setState(next: ConnectionState): void {
        if (state === next) return;
        state = next;
        config.onStateChange(next);
    }

    function cleanup(): void {
        if (socketErrorRecoveryTimer !== null) {
            clearTimeout(socketErrorRecoveryTimer);
            socketErrorRecoveryTimer = null;
        }
        if (authenticationTimer !== null) {
            clearTimeout(authenticationTimer);
            authenticationTimer = null;
        }
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (ws !== null) {
            ws.onopen = null;
            ws.onclose = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.close();
            ws = null;
        }
    }

    function buildMessage(
        type: ClientMessage["type"],
        payload: Record<string, unknown>
    ): ClientMessage {
        return {
            id: generateId(),
            timestamp: Date.now(),
            seq: nextSeq(),
            protocolVersion: PROTOCOL_VERSION,
            type,
            payload,
        } as ClientMessage;
    }

    function armAuthenticationTimeout(): void {
        if (authenticationTimer !== null) {
            clearTimeout(authenticationTimer);
        }

        authenticationTimer = setTimeout(() => {
            authenticationTimer = null;
            if (state === "authenticated") {
                return;
            }

            const errorMessage = "Authentication timed out while connecting to your Mac companion";
            cleanup();
            setState("disconnected");
            rejectPendingMessages(errorMessage);
            if (reportConnectionErrors) {
                config.onError(errorMessage);
            }
            scheduleReconnect();
        }, AUTHENTICATION_TIMEOUT_MS);
    }

    function sendRaw(message: ClientMessage): void {
        if (ws !== null && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    function flushPending(): void {
        while (pendingMessages.length > 0) {
            const pending = pendingMessages.shift();
            if (pending !== undefined) {
                sendRaw(pending.message);
                pending.resolve();
            }
        }
    }

    function send(message: ClientMessage): Promise<void> {
        if (state === "authenticated" && ws !== null && ws.readyState === WebSocket.OPEN) {
            sendRaw(message);
            return Promise.resolve();
        }

        const promise = new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const idx = pendingMessages.findIndex((pending) => pending.message === message);
                if (idx !== -1) {
                    pendingMessages.splice(idx, 1);
                    reject(new Error("Message send timed out"));
                }
            }, PENDING_TIMEOUT_MS);

            if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
                console.warn("[WsClient] Pending queue limit reached, dropping oldest message");
                const dropped = pendingMessages.shift();
                if (dropped !== undefined) {
                    clearTimeout(dropped.timeoutId);
                    dropped.reject(new Error("Dropped from pending queue — limit reached"));
                }
            }

            pendingMessages.push({
                message,
                resolve: () => {
                    clearTimeout(timeoutId);
                    resolve();
                },
                reject: (error: Error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                },
                timeoutId,
            });
        });

        promise.catch(() => {});
        return promise;
    }

    function rejectPendingMessages(errorMessage: string): void {
        while (pendingMessages.length > 0) {
            const pending = pendingMessages.shift();
            if (pending !== undefined) {
                clearTimeout(pending.timeoutId);
                pending.reject(new Error(errorMessage));
            }
        }
    }

    function disconnectWithError(errorMessage: string): void {
        deviceCredential = null;
        sessionToken = null;
        serverUrl = null;
        expectedFingerprint = null;
        transportMode = null;
        relayAccessToken = null;
        lastServerSeq = 0;
        reconnectOnClose = false;
        reportConnectionErrors = true;
        reconnectAttempt = 0;
        pendingPairMessage = null;
        pendingResumeMessage = null;
        cleanup();
        setState("disconnected");
        rejectPendingMessages(errorMessage);
        config.onError(errorMessage);
    }

    function scheduleReconnect(): void {
        if (reconnectTimer !== null || state === "connecting") return;
        if (!reconnectOnClose) return;
        if (deviceCredential === null || serverUrl === null || transportMode === null) return;

        const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
            MAX_RECONNECT_DELAY_MS
        );
        reconnectAttempt += 1;

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void resumeConnectionWithCurrentBackoff({
                reconnectOnFailure: true,
                reportErrors: true,
            });
        }, delay);
    }

    function resumeConnectionWithCurrentBackoff(options: ResumeOptions): boolean {
        if (deviceCredential === null || serverUrl === null || transportMode === null) {
            return false;
        }

        if (state === "authenticated" || state === "connected" || state === "connecting") {
            return true;
        }

        reconnectOnClose = options.reconnectOnFailure;
        reportConnectionErrors = options.reportErrors;
        pendingPairMessage = null;
        pendingResumeMessage = buildMessage("auth.resume", {
            deviceCredential,
            ...(sessionToken !== null ? { sessionToken } : {}),
            lastSeenSeq: lastServerSeq,
            transportMode,
        });
        connectToURL(serverUrl, options);
        return true;
    }

    function resumeConnection(options: ResumeOptions): boolean {
        reconnectAttempt = 0;
        return resumeConnectionWithCurrentBackoff(options);
    }

    function handleMessage(data: string): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(data);
        } catch {
            config.onError("Invalid message format");
            return;
        }

        const result = serverMessageSchema.safeParse(parsed);
        if (!result.success) {
            const issue = result.error.issues[0];
            const path = issue?.path.join(".") ?? "unknown";
            const message = issue?.message ?? "unknown";
            config.onError(`Server message validation failed: ${path} — ${message}`);
            return;
        }

        const message = result.data as ServerMessage;
        lastServerSeq = message.seq;

        if (message.type === "error" && state !== "authenticated") {
            const errorMessage = `[${message.payload.code}] ${message.payload.message}`;
            disconnectWithError(errorMessage);
            return;
        }

        if (message.type === "auth.authenticated") {
            if (authenticationTimer !== null) {
                clearTimeout(authenticationTimer);
                authenticationTimer = null;
            }
            const requiresPinnedDirectFingerprint =
                message.payload.transportMode === "direct"
                && serverUrl !== null
                && serverUrl.startsWith("wss://");

            if (requiresPinnedDirectFingerprint && expectedFingerprint === null) {
                disconnectWithError("Direct wss:// connections require a pinned certificate fingerprint");
                return;
            }

            if (
                expectedFingerprint !== null
                && message.payload.certFingerprint !== expectedFingerprint
            ) {
                disconnectWithError("Certificate verification failed — server is not trusted");
                return;
            }

            deviceCredential = message.payload.deviceCredential;
            sessionToken = message.payload.sessionToken;
            transportMode = message.payload.transportMode;
            if (message.payload.relayAccessToken !== undefined) {
                relayAccessToken = message.payload.relayAccessToken;
            }
            reconnectOnClose = true;
            reportConnectionErrors = true;
            setState("authenticated");
            reconnectAttempt = 0;
            flushPending();
        }

        if (message.type === "auth.session_token") {
            sessionToken = message.payload.sessionToken;
        }

        config.onMessage(message);
    }

    function connectToURL(url: string, options: ResumeOptions): void {
        cleanup();
        reconnectOnClose = options.reconnectOnFailure;
        reportConnectionErrors = options.reportErrors;
        setState("connecting");

        if (transportMode === "relay" && relayAccessToken === null) {
            if (reportConnectionErrors) {
                config.onError("Relay connection requires a relay access token");
            }
            setState("disconnected");
            return;
        }

        try {
            ws = new WebSocket(url);
        } catch (error) {
            if (reportConnectionErrors) {
                config.onError(`Connection error: ${String(error)}`);
            }
            setState("disconnected");
            return;
        }

        ws.onopen = () => {
            setState("connected");
            if (transportMode === "relay" && relayAccessToken !== null && ws !== null) {
                ws.send(JSON.stringify({
                    type: "relay.connect",
                    role: "mobile",
                    accessToken: relayAccessToken,
                }));
            }
            if (pendingPairMessage !== null) {
                sendRaw(pendingPairMessage);
                pendingPairMessage = null;
            }
            if (pendingResumeMessage !== null) {
                sendRaw(pendingResumeMessage);
                pendingResumeMessage = null;
            }
            armAuthenticationTimeout();
        };

        ws.onmessage = (event) => {
            handleMessage(String(event.data));
        };

        ws.onclose = (event) => {
            const wasAuthenticated = state === "authenticated";
            const closeMessage = describeSocketClose(event.code, event.reason);
            setState("disconnected");
            cleanup();
            if (!wasAuthenticated && reportConnectionErrors && event.code !== 1000) {
                config.onError(closeMessage);
            }
            if (event.code !== 1000) {
                scheduleReconnect();
            }
        };

        ws.onerror = () => {
            if (reportConnectionErrors) {
                config.onError("WebSocket connection error");
            }

            if (
                socketErrorRecoveryTimer !== null
                || ws === null
                || ws.readyState === WebSocket.CLOSING
                || ws.readyState === WebSocket.CLOSED
            ) {
                return;
            }

            const socketAtError = ws;
            socketErrorRecoveryTimer = setTimeout(() => {
                socketErrorRecoveryTimer = null;
                if (
                    ws !== socketAtError
                    || ws === null
                    || ws.readyState === WebSocket.CLOSING
                    || ws.readyState === WebSocket.CLOSED
                    || state === "disconnected"
                ) {
                    return;
                }

                cleanup();
                setState("disconnected");
                scheduleReconnect();
            }, SOCKET_ERROR_RECOVERY_DELAY_MS);
        };
    }

    function connectWithQR(qrPayload: QRPayload): void {
        reconnectAttempt = 0;
        serverUrl = qrPayload.url;
        expectedFingerprint = qrPayload.certFingerprint;
        transportMode = qrPayload.transportMode;
        relayAccessToken = qrPayload.relayAccessToken ?? null;
        lastServerSeq = 0;
        reconnectOnClose = false;
        reportConnectionErrors = true;
        pendingResumeMessage = null;
        pendingPairMessage = buildMessage("auth.pair", {
            pairingToken: qrPayload.token,
            transportMode: qrPayload.transportMode,
        });
        connectToURL(serverUrl, {
            reconnectOnFailure: false,
            reportErrors: true,
        });
    }

    return {
        connectWithQR,

        seedStoredCredentials(params: {
            deviceCredential: string;
            serverUrl: string;
            certFingerprint: string | null;
            transportMode: TransportMode;
            relayAccessToken: string | null;
        }): void {
            deviceCredential = params.deviceCredential;
            serverUrl = params.serverUrl;
            expectedFingerprint = params.certFingerprint;
            transportMode = params.transportMode;
            relayAccessToken = params.relayAccessToken;
            lastServerSeq = 0;
            reconnectAttempt = 0;
        },

        getPersistableConnection() {
            return {
                serverUrl,
                certFingerprint: expectedFingerprint,
                transportMode,
                relayAccessToken,
            };
        },

        send,

        flushPending(): void {
            flushPending();
        },

        sendMessage(type: ClientMessage["type"], payload: Record<string, unknown>): Promise<void> {
            return send(buildMessage(type, payload));
        },

        disconnect(): void {
            deviceCredential = null;
            sessionToken = null;
            serverUrl = null;
            expectedFingerprint = null;
            transportMode = null;
            relayAccessToken = null;
            lastServerSeq = 0;
            reconnectOnClose = false;
            reportConnectionErrors = true;
            reconnectAttempt = 0;
            pendingPairMessage = null;
            pendingResumeMessage = null;
            cleanup();
            setState("disconnected");
            rejectPendingMessages("Connection closed");
        },

        getState(): ConnectionState {
            return state;
        },

        resume(options: ResumeOptions): boolean {
            return resumeConnection(options);
        },
    };
}

// WebSocket client — manages connection to bridge server
// Auto-reconnect, heartbeat, message queuing

import * as Crypto from "expo-crypto";
import type {
    ServerMessage,
    ClientMessage,
    QRPayload,
} from "@copilot-mobile/shared";
import { serverMessageSchema } from "@copilot-mobile/shared";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticated";

export type WSClientConfig = {
    onMessage: (message: ServerMessage) => void;
    onStateChange: (state: ConnectionState) => void;
    onError: (error: string) => void;
};

type PendingMessage = {
    message: ClientMessage;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

const PENDING_TIMEOUT_MS = 30_000;
const MAX_PENDING_MESSAGES = 100;

// Mesaj ID ve sıra numarası üreteci
// Client-başına tutulur, reconnect'te sıfırlanır (createWSClient içinde)
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
    let jwt: string | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingMessages: Array<PendingMessage> = [];
    let reconnectAttempt = 0;
    let serverUrl: string | null = null;
    let expectedFingerprint: string | null = null;
    let lastServerSeq = 0;
    const MAX_RECONNECT_DELAY_MS = 30_000;
    const BASE_RECONNECT_DELAY_MS = 1_000;
    const nextSeq = createSeqGenerator();
    // QR pairing sonrası gönderilecek mesaj (onopen içinde kullanılır)
    let pendingPairMessage: ClientMessage | null = null;
    // Reconnect sonrası gönderilecek mesaj
    let pendingReconnectMessage: ClientMessage | null = null;

    function setState(next: ConnectionState): void {
        if (state === next) return;
        state = next;
        config.onStateChange(next);
    }

    function cleanup(): void {
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
            type,
            payload,
        } as ClientMessage;
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
                const idx = pendingMessages.findIndex((p) => p.message === message);
                if (idx !== -1) {
                    pendingMessages.splice(idx, 1);
                    reject(new Error("Message send timed out"));
                }
            }, PENDING_TIMEOUT_MS);
            if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
                console.warn("[WsClient] Pending kuyruk limitine ulaşıldı, en eski mesaj düşürülüyor");
                const dropped = pendingMessages.shift();
                if (dropped !== undefined) {
                    clearTimeout(dropped.timeoutId);
                    dropped.reject(new Error("Dropped from pending queue — limit reached"));
                }
            }
            pendingMessages.push({
                message,
                resolve: () => { clearTimeout(timeoutId); resolve(); },
                reject: (err: Error) => { clearTimeout(timeoutId); reject(err); },
                timeoutId,
            });
        });
        // Mark promise as handled for React Native's rejection tracker.
        // Callers still receive the rejection through their await/catch chains.
        promise.catch(() => { });
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
        jwt = null;
        serverUrl = null;
        expectedFingerprint = null;
        lastServerSeq = 0;
        reconnectAttempt = 0;
        pendingPairMessage = null;
        pendingReconnectMessage = null;
        cleanup();
        setState("disconnected");
        rejectPendingMessages(errorMessage);
        config.onError(errorMessage);
    }

    function scheduleReconnect(): void {
        if (reconnectTimer !== null || state === "connecting") return;
        if (jwt === null || serverUrl === null) return;

        const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
            MAX_RECONNECT_DELAY_MS
        );
        reconnectAttempt += 1;

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (jwt !== null) {
                connectWithJWT(jwt);
            }
        }, delay);
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

        if (message.type === "pairing.success") {
            if (
                expectedFingerprint !== null &&
                message.payload.certFingerprint !== expectedFingerprint
            ) {
                disconnectWithError(
                    "Certificate verification failed — server is not trusted"
                );
                return;
            }

            jwt = message.payload.jwt;
            setState("authenticated");
            reconnectAttempt = 0;
            flushPending();
        }

        if (message.type === "reconnect.ready") {
            setState("authenticated");
            reconnectAttempt = 0;
        }

        if (message.type === "token.refresh") {
            jwt = message.payload.jwt;
        }

        config.onMessage(message);
    }

    function connectToURL(url: string): void {
        cleanup();
        setState("connecting");

        try {
            ws = new WebSocket(url);
        } catch (err) {
            config.onError(`Connection error: ${String(err)}`);
            setState("disconnected");
            return;
        }

        ws.onopen = () => {
            setState("connected");
            // Bağlantı açıldığında bekleyen pairing veya reconnect mesajını gönder
            if (pendingPairMessage !== null) {
                sendRaw(pendingPairMessage);
                pendingPairMessage = null;
            }
            if (pendingReconnectMessage !== null) {
                sendRaw(pendingReconnectMessage);
                pendingReconnectMessage = null;
            }
        };

        ws.onmessage = (event) => {
            handleMessage(String(event.data));
        };

        ws.onclose = (event) => {
            setState("disconnected");
            cleanup();
            if (event.code !== 1000) {
                scheduleReconnect();
            }
        };

        ws.onerror = () => {
            config.onError("WebSocket connection error");
        };
    }

    function connectWithQR(qrPayload: QRPayload): void {
        reconnectAttempt = 0;
        serverUrl = qrPayload.url;
        expectedFingerprint = qrPayload.certFingerprint;
        lastServerSeq = 0;
        // Önceki reconnect mesajını temizle — yeni pairing başlıyor
        pendingReconnectMessage = null;
        pendingPairMessage = buildMessage("auth.pair", {
            pairingToken: qrPayload.token,
        });
        connectToURL(serverUrl);
    }

    // NOT: JWT URL query string ile iletiliyor — WebSocket bağlantısında header mekanizması
    // React Native'de mevcut değil. Bridge server'da TLS ile koruma sağlanmalıdır.
    // Bu bilinen bir kısıtlamadır — wss:// kullanıldığında güvenlidir.
    function connectWithJWT(token: string): void {
        jwt = token;
        if (serverUrl === null) {
            config.onError("Server URL unknown — reconnect with QR code");
            return;
        }

        const authenticatedUrl = new URL(serverUrl);
        authenticatedUrl.searchParams.set("token", token);

        // Önceki pairing mesajını temizle — JWT reconnect yapılıyor
        pendingPairMessage = null;
        pendingReconnectMessage = buildMessage("reconnect", { lastSeenSeq: lastServerSeq });
        connectToURL(authenticatedUrl.toString());
        // NOT: Reconnect sonrası session.history otomatik olarak bridge server'dan replay ile gelir.
        // Eksik mesajlar lastSeenSeq ile yakalanır.
    }

    return {
        connectWithQR,

        connectWithJWT,

        // Kal\u0131c\u0131 kimlik bilgilerinden client'\u0131 hidratla. connectWithJWT/resume \u00f6ncesi \u00e7a\u011fr\u0131l\u0131r.
        seedStoredCredentials(params: {
            jwt: string;
            serverUrl: string;
            certFingerprint: string | null;
        }): void {
            jwt = params.jwt;
            serverUrl = params.serverUrl;
            expectedFingerprint = params.certFingerprint;
            lastServerSeq = 0;
            reconnectAttempt = 0;
        },

        send,

        flushPending(): void {
            flushPending();
        },

        sendMessage(type: ClientMessage["type"], payload: Record<string, unknown>): Promise<void> {
            const msg = buildMessage(type, payload);
            return send(msg);
        },

        disconnect(): void {
            jwt = null;
            serverUrl = null;
            expectedFingerprint = null;
            lastServerSeq = 0;
            reconnectAttempt = 0;
            pendingPairMessage = null;
            pendingReconnectMessage = null;
            cleanup();
            setState("disconnected");
            rejectPendingMessages("Connection closed");
        },

        getState(): ConnectionState {
            return state;
        },

        resume(): boolean {
            if (jwt === null || serverUrl === null) {
                return false;
            }

            if (state === "authenticated" || state === "connected" || state === "connecting") {
                return true;
            }

            reconnectAttempt = 0;
            connectWithJWT(jwt);
            return true;
        },

    };
}

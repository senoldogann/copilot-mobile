import { WebSocket } from "ws";

type RelayControlMessage =
    | { type: "companion.ready"; companionId: string }
    | { type: "mobile.open"; companionId: string }
    | { type: "mobile.message"; companionId: string; data: string }
    | { type: "mobile.close"; companionId: string; reason?: string }
    | { type: "relay.error"; message: string };

export type RelayProxyConfig = {
    relayUrl: string;
    localBridgeUrl: string;
    companionId: string;
    accessToken: string;
};

export type RelayProxy = {
    start: () => void;
    shutdown: () => void;
    getStatus: () => {
        connectedToRelay: boolean;
        connectedToLocalBridge: boolean;
        companionId: string;
        relayUrl: string;
    };
};

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const LOCAL_BRIDGE_RECONNECT_DELAY_MS = 1_000;
const MAX_BUFFERED_MOBILE_MESSAGES = 100;
const RELAY_PROXY_HEADER = "x-copilot-mobile-relay-proxy";
const RELAY_COMPANION_ID_HEADER = "x-copilot-mobile-companion-id";

function isRelayControlMessage(value: unknown): value is RelayControlMessage {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const type = (value as { type?: unknown }).type;
    return type === "companion.ready"
        || type === "mobile.open"
        || type === "mobile.message"
        || type === "mobile.close"
        || type === "relay.error";
}

export function createRelayProxy(config: RelayProxyConfig): RelayProxy {
    let relaySocket: WebSocket | null = null;
    let localBridgeSocket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let localBridgeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let stopped = false;
    let relayReady = false;
    const bufferedMobileMessages: Array<string> = [];

    function clearReconnectTimer(): void {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function clearLocalBridgeReconnectTimer(): void {
        if (localBridgeReconnectTimer !== null) {
            clearTimeout(localBridgeReconnectTimer);
            localBridgeReconnectTimer = null;
        }
    }

    function sendRelayControlMessage(message: Exclude<RelayControlMessage, { type: "companion.ready" }>): void {
        if (relaySocket !== null && relaySocket.readyState === WebSocket.OPEN) {
            relaySocket.send(JSON.stringify(message));
        }
    }

    function teardownLocalBridgeSocket(): void {
        clearLocalBridgeReconnectTimer();

        if (localBridgeSocket === null) {
            return;
        }

        localBridgeSocket.onopen = null;
        localBridgeSocket.onclose = null;
        localBridgeSocket.onerror = null;
        localBridgeSocket.onmessage = null;
        localBridgeSocket.close();
        localBridgeSocket = null;
        bufferedMobileMessages.length = 0;
    }

    function scheduleLocalBridgeReconnect(): void {
        if (stopped || !relayReady || localBridgeReconnectTimer !== null) {
            return;
        }

        localBridgeReconnectTimer = setTimeout(() => {
            localBridgeReconnectTimer = null;
            connectLocalBridge();
        }, LOCAL_BRIDGE_RECONNECT_DELAY_MS);
    }

    function scheduleReconnect(): void {
        if (stopped || reconnectTimer !== null) {
            return;
        }

        const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
            MAX_RECONNECT_DELAY_MS
        );
        reconnectAttempt += 1;

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectRelay();
        }, delay);
    }

    function flushBufferedMobileMessages(): void {
        if (localBridgeSocket === null || localBridgeSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        while (bufferedMobileMessages.length > 0) {
            const message = bufferedMobileMessages.shift();
            if (message !== undefined) {
                localBridgeSocket.send(message);
            }
        }
    }

    function handleBufferedMobileOverflow(): void {
        console.warn("[relay] Local bridge buffer limit reached; closing mobile tunnel", {
            companionId: config.companionId,
            bufferedMessages: bufferedMobileMessages.length,
        });
        bufferedMobileMessages.length = 0;
        sendRelayControlMessage({
            type: "mobile.close",
            companionId: config.companionId,
            reason: "Local bridge unavailable. Please retry.",
        });
    }

    function connectLocalBridge(): void {
        clearLocalBridgeReconnectTimer();

        if (localBridgeSocket !== null) {
            const readyState = localBridgeSocket.readyState;
            if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
                return;
            }
        }

        teardownLocalBridgeSocket();

        const ws = new WebSocket(config.localBridgeUrl, {
            headers: {
                [RELAY_PROXY_HEADER]: "1",
                [RELAY_COMPANION_ID_HEADER]: config.companionId,
            },
        });
        localBridgeSocket = ws;

        ws.onopen = () => {
            flushBufferedMobileMessages();
        };

        ws.onmessage = (event) => {
            sendRelayControlMessage({
                type: "mobile.message",
                companionId: config.companionId,
                data: String(event.data),
            });
        };

        ws.onclose = () => {
            localBridgeSocket = null;
            bufferedMobileMessages.length = 0;
            sendRelayControlMessage({
                type: "mobile.close",
                companionId: config.companionId,
                reason: "Local bridge connection closed",
            });
            scheduleLocalBridgeReconnect();
        };

        ws.onerror = () => {
            // The close handler drives cleanup and relay notification.
        };
    }

    function handleRelayControlMessage(message: RelayControlMessage): void {
        switch (message.type) {
            case "companion.ready":
                relayReady = true;
                reconnectAttempt = 0;
                connectLocalBridge();
                return;

            case "mobile.open":
                connectLocalBridge();
                return;

            case "mobile.message":
                if (localBridgeSocket === null || localBridgeSocket.readyState !== WebSocket.OPEN) {
                    if (bufferedMobileMessages.length >= MAX_BUFFERED_MOBILE_MESSAGES) {
                        handleBufferedMobileOverflow();
                        if (localBridgeSocket === null) {
                            connectLocalBridge();
                        }
                        return;
                    }

                    bufferedMobileMessages.push(message.data);
                    if (localBridgeSocket === null) {
                        connectLocalBridge();
                    }
                    return;
                }

                localBridgeSocket.send(message.data);
                return;

            case "mobile.close":
                bufferedMobileMessages.length = 0;
                return;

            case "relay.error":
                console.warn("[relay] Relay error:", message.message);
                teardownLocalBridgeSocket();
                return;
        }
    }

    function connectRelay(): void {
        if (stopped) {
            return;
        }

        clearReconnectTimer();
        relayReady = false;

        const ws = new WebSocket(config.relayUrl);
        relaySocket = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: "relay.connect",
                role: "companion",
                accessToken: config.accessToken,
            }));
            reconnectAttempt = 0;
            console.log("[relay] Connected:", {
                relayUrl: config.relayUrl,
                companionId: config.companionId,
            });
        };

        ws.onmessage = (event) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(String(event.data));
            } catch {
                console.warn("[relay] Ignoring malformed control message");
                return;
            }

            if (!isRelayControlMessage(parsed)) {
                console.warn("[relay] Ignoring unknown control message");
                return;
            }

            handleRelayControlMessage(parsed);
        };

        ws.onclose = () => {
            relayReady = false;
            relaySocket = null;
            teardownLocalBridgeSocket();
            scheduleReconnect();
        };

        ws.onerror = () => {
            // The close handler schedules reconnect.
        };
    }

    return {
        start(): void {
            stopped = false;
            connectRelay();
        },

        shutdown(): void {
            stopped = true;
            relayReady = false;
            clearReconnectTimer();
            clearLocalBridgeReconnectTimer();
            teardownLocalBridgeSocket();
            if (relaySocket !== null) {
                relaySocket.onopen = null;
                relaySocket.onclose = null;
                relaySocket.onerror = null;
                relaySocket.onmessage = null;
                relaySocket.close();
                relaySocket = null;
            }
        },

        getStatus() {
            return {
                connectedToRelay: relayReady,
                connectedToLocalBridge: localBridgeSocket?.readyState === WebSocket.OPEN,
                companionId: config.companionId,
                relayUrl: config.relayUrl,
            };
        },
    };
}

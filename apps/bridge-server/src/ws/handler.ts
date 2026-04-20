// WebSocket message router — dispatches client messages to appropriate handlers

import type { ClientMessage, ServerMessage } from "@copilot-mobile/shared";
import {
    clientMessageSchema,
} from "@copilot-mobile/shared";
import { validatePairingToken, clearPairingToken } from "../auth/pairing.js";
import { createJWT, verifyJWT } from "../auth/jwt.js";
import { checkMessageRateLimit, checkReplayProtection } from "../utils/rate-limit.js";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";
import { JWT_REFRESH_THRESHOLD_MS } from "@copilot-mobile/shared";
import type { createSessionManager } from "../copilot/session-manager.js";

type SessionManager = ReturnType<typeof createSessionManager>;
type SendFn = (message: ServerMessage) => void;

type ClientState = {
    authenticated: boolean;
    deviceId: string | null;
    jwt: string | null;
    tokenIssuedAt: number;
};

export function createMessageHandler(
    sessionManager: SessionManager,
    send: SendFn,
    messageBuffer: ReadonlyArray<ServerMessage> = [],
    certFingerprint: string | null,
    onAuthenticated?: () => void
) {
    const state: ClientState = {
        authenticated: false,
        deviceId: null,
        jwt: null,
        tokenIssuedAt: 0,
    };

    function makeBase() {
        return { id: generateMessageId(), timestamp: nowMs(), seq: nextSeq() };
    }

    function sendError(code: string, message: string, retry: boolean): void {
        send({
            ...makeBase(),
            type: "error",
            payload: { code, message, retry },
        });
    }

    return {
        get isAuthenticated() {
            return state.authenticated;
        },

        get deviceId() {
            return state.deviceId;
        },

        async handleRawMessage(data: string): Promise<void> {
            // JSON parse
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            } catch {
                sendError("INVALID_JSON", "Message is not valid JSON", false);
                return;
            }

            // Zod validation
            const result = clientMessageSchema.safeParse(parsed);
            if (!result.success) {
                sendError(
                    "VALIDATION_ERROR",
                    `Invalid message: ${result.error.issues[0]?.message ?? "unknown"}`,
                    false
                );
                return;
            }

            const message = result.data as ClientMessage;

            // Replay protection
            if (!checkReplayProtection(message.id)) {
                sendError("REPLAY_ATTACK", `Duplicate message ID: ${message.id}`, false);
                return;
            }

            // Authentication required for all messages except auth.pair
            if (message.type !== "auth.pair" && !state.authenticated) {
                sendError("AUTH_REQUIRED", "Authentication required", false);
                return;
            }

            // Rate limiting (for authenticated users)
            if (state.deviceId !== null && message.type !== "auth.pair") {
                if (!checkMessageRateLimit(state.deviceId)) {
                    sendError("RATE_LIMIT", "Too many messages, slow down", false);
                    return;
                }
            }

            await this.dispatch(message);

            // Token refresh check after each successful message
            this.checkTokenRefresh();
        },

        // Token refresh check — called on each message
        checkTokenRefresh(): void {
            if (!state.authenticated || state.deviceId === null) return;
            const elapsed = Date.now() - state.tokenIssuedAt;
            if (elapsed < JWT_REFRESH_THRESHOLD_MS) return;

            const newJwt = createJWT(state.deviceId);
            state.jwt = newJwt;
            state.tokenIssuedAt = Date.now();

            send({
                ...makeBase(),
                type: "token.refresh",
                payload: { jwt: newJwt },
            });
            console.log(`[jwt] Token refreshed: ${state.deviceId}`);
        },

        async dispatch(message: ClientMessage): Promise<void> {
            switch (message.type) {
                case "auth.pair":
                    return this.handlePair(message.payload.pairingToken);

                case "session.create":
                    return sessionManager.createSession(message.payload.config);

                case "session.resume":
                    return sessionManager.resumeSession(message.payload.sessionId);

                case "session.list":
                    return sessionManager.listSessions();

                case "session.delete":
                    return sessionManager.deleteSession(message.payload.sessionId);

                case "message.send":
                    return sessionManager.sendMessage(
                        message.payload.sessionId,
                        message.payload.content,
                        message.payload.attachments
                    );

                case "message.abort":
                    sessionManager.abortMessage(message.payload.sessionId);
                    return;

                case "permission.respond":
                    sessionManager.respondToPermission(
                        message.payload.requestId,
                        message.payload.approved
                    );
                    return;

                case "user_input.respond":
                    sessionManager.respondToUserInput(
                        message.payload.requestId,
                        message.payload.value
                    );
                    return;

                case "settings.update":
                    sessionManager.updateSettings({
                        autoApproveReads: message.payload.autoApproveReads,
                    });
                    console.log("[settings] autoApproveReads:", message.payload.autoApproveReads);
                    return;

                case "models.request":
                    return sessionManager.listModels();

                case "capabilities.request":
                    sessionManager.emitCapabilitiesState();
                    return;

                case "workspace.tree.request":
                    {
                        const maxDepth = Math.min(message.payload.maxDepth ?? 3, 5);
                        return sessionManager.listWorkspaceTree(
                            message.payload.sessionId,
                            message.payload.path,
                            maxDepth
                        );
                    }

                case "workspace.git.request":
                    {
                        const commitLimit = Math.min(message.payload.commitLimit ?? 10, 50);
                        return sessionManager.listWorkspaceGitSummary(
                            message.payload.sessionId,
                            commitLimit
                        );
                    }

                case "workspace.pull":
                    return sessionManager.pullWorkspace(message.payload.sessionId);

                case "workspace.push":
                    return sessionManager.pushWorkspace(message.payload.sessionId);

                case "reconnect": {
                    // Reconnect — replay messages after lastSeenSeq
                    const lastSeenSeq = message.payload.lastSeenSeq;
                    const missed = messageBuffer.filter((m) => m.seq > lastSeenSeq);
                    console.log(`[reconnect] lastSeenSeq: ${lastSeenSeq}, replay: ${missed.length} messages`);

                    for (const m of missed) {
                        send(m);
                    }

                    send({
                        ...makeBase(),
                        type: "reconnect.ready",
                        payload: {},
                    });
                    return;
                }

                default:
                    sendError("UNKNOWN_TYPE", "Unknown message type", false);
                    return;
            }
        },

        handlePair(pairingToken: string): void {
            if (!validatePairingToken(pairingToken)) {
                sendError("AUTH_ERROR", "Invalid or expired pairing token", false);
                return;
            }

            // Pairing successful — clear QR token
            clearPairingToken();

            const deviceId = generateMessageId();
            const jwt = createJWT(deviceId);

            state.authenticated = true;
            state.deviceId = deviceId;
            state.jwt = jwt;
            state.tokenIssuedAt = Date.now();

            send({
                ...makeBase(),
                type: "pairing.success",
                payload: { jwt, deviceId, certFingerprint },
            });

            onAuthenticated?.();

            // After pairing, send current bridge + host capabilities state to mobile.
            sessionManager.emitCapabilitiesState();

            console.log(`[pairing] Device paired: ${deviceId}`);
        },

        // JWT auth verification (used during WebSocket upgrade)
        authenticateWithJWT(token: string): boolean {
            try {
                const payload = verifyJWT(token);
                state.authenticated = true;
                state.deviceId = payload.deviceId;
                state.jwt = token;
                state.tokenIssuedAt = payload.pairedAt;
                onAuthenticated?.();
                return true;
            } catch {
                return false;
            }
        },

        cleanup(): void {
            sessionManager.cleanupOnDisconnect();
        },
    };
}

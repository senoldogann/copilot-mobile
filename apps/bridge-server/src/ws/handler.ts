// WebSocket message router — dispatches client messages to appropriate handlers

import type { ClientMessage, ServerMessage, TransportMode } from "@copilot-mobile/shared";
import {
    PROTOCOL_VERSION,
    SESSION_TOKEN_TTL_SECONDS,
    SESSION_TOKEN_REFRESH_THRESHOLD_MS,
    clientMessageSchema,
} from "@copilot-mobile/shared";
import { clearPairingToken, validatePairingToken } from "../auth/pairing.js";
import {
    createDeviceCredential,
    createSessionToken,
    verifyDeviceCredential,
    verifySessionToken,
} from "../auth/jwt.js";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";
import { checkMessageRateLimit, checkReplayProtection } from "../utils/rate-limit.js";
import type { createSessionManager } from "../copilot/session-manager.js";

type SessionManager = ReturnType<typeof createSessionManager>;
type SendFn = (message: ServerMessage) => void;

type ClientState = {
    authenticated: boolean;
    deviceId: string | null;
    deviceCredential: string | null;
    sessionToken: string | null;
    sessionTokenExpiresAt: number | null;
    tokenIssuedAt: number;
    transportMode: TransportMode | null;
};

export function createMessageHandler(
    sessionManager: SessionManager,
    send: SendFn,
    messageBuffer: ReadonlyArray<ServerMessage> = [],
    certFingerprint: string | null,
    onAuthenticated?: (preserveReplayBuffer: boolean) => void
) {
    const state: ClientState = {
        authenticated: false,
        deviceId: null,
        deviceCredential: null,
        sessionToken: null,
        sessionTokenExpiresAt: null,
        tokenIssuedAt: 0,
        transportMode: null,
    };

    function makeBase() {
        return {
            id: generateMessageId(),
            timestamp: nowMs(),
            seq: nextSeq(),
            protocolVersion: PROTOCOL_VERSION,
        };
    }

    function sendError(code: string, message: string, retry: boolean): void {
        send({
            ...makeBase(),
            type: "error",
            payload: { code, message, retry },
        });
    }

    function logValidationFailure(parsed: unknown, issues: ReadonlyArray<{ path: string; message: string }>): void {
        console.warn("[ws] Client message validation failed", {
            issues,
            receivedType:
                typeof parsed === "object" && parsed !== null && "type" in parsed
                    ? String((parsed as { type?: unknown }).type ?? "unknown")
                    : "unknown",
        });
    }

    function sendAuthenticatedMessage(
        authMethod: "pair" | "resume",
        replayedCount: number
    ): void {
        if (
            state.deviceId === null
            || state.deviceCredential === null
            || state.sessionToken === null
            || state.sessionTokenExpiresAt === null
            || state.transportMode === null
        ) {
            throw new Error("Authenticated client state is incomplete");
        }

        send({
            ...makeBase(),
            type: "auth.authenticated",
            payload: {
                authMethod,
                deviceId: state.deviceId,
                deviceCredential: state.deviceCredential,
                sessionToken: state.sessionToken,
                sessionTokenExpiresAt: state.sessionTokenExpiresAt,
                transportMode: state.transportMode,
                certFingerprint,
                replayedCount,
            },
        });
    }

    function getSessionTokenExpiresAt(issuedAt: number): number {
        return issuedAt + (SESSION_TOKEN_TTL_SECONDS * 1000);
    }

    function mintSessionToken(deviceId: string, issuedAt: number): { token: string; expiresAt: number } {
        const token = createSessionToken(deviceId);
        return {
            token,
            expiresAt: getSessionTokenExpiresAt(issuedAt),
        };
    }

    function checkTokenRefresh(): void {
        if (!state.authenticated || state.deviceId === null) return;
        const elapsed = Date.now() - state.tokenIssuedAt;
        if (elapsed < SESSION_TOKEN_REFRESH_THRESHOLD_MS) return;

        const issuedAt = Date.now();
        const nextToken = mintSessionToken(state.deviceId, issuedAt);
        state.sessionToken = nextToken.token;
        state.sessionTokenExpiresAt = nextToken.expiresAt;
        state.tokenIssuedAt = issuedAt;

        send({
            ...makeBase(),
            type: "auth.session_token",
            payload: {
                sessionToken: nextToken.token,
                sessionTokenExpiresAt: nextToken.expiresAt,
            },
        });
    }

    function handlePair(pairingToken: string, transportMode: TransportMode): void {
        if (!validatePairingToken(pairingToken)) {
            sendError("AUTH_ERROR", "Invalid or expired pairing token", false);
            return;
        }

        clearPairingToken();

        const deviceId = generateMessageId();
        const deviceCredential = createDeviceCredential(deviceId);
        const issuedAt = Date.now();
        const sessionToken = mintSessionToken(deviceId, issuedAt);

        state.authenticated = true;
        state.deviceId = deviceId;
        state.deviceCredential = deviceCredential;
        state.sessionToken = sessionToken.token;
        state.sessionTokenExpiresAt = sessionToken.expiresAt;
        state.tokenIssuedAt = issuedAt;
        state.transportMode = transportMode;

        sendAuthenticatedMessage("pair", 0);
        onAuthenticated?.(false);
        sessionManager.emitCapabilitiesState();

        console.log("[pairing] Device paired:", { deviceId, transportMode });
    }

    function handleResume(payload: {
        deviceCredential: string;
        sessionToken?: string;
        lastSeenSeq: number;
        transportMode: TransportMode;
    }): void {
        let verifiedDeviceId: string;

        try {
            verifiedDeviceId = verifyDeviceCredential(payload.deviceCredential).deviceId;
        } catch {
            sendError("AUTH_ERROR", "Invalid device credential", false);
            return;
        }

        if (payload.sessionToken !== undefined) {
            try {
                const sessionTokenPayload = verifySessionToken(payload.sessionToken);
                if (sessionTokenPayload.deviceId !== verifiedDeviceId) {
                    sendError("AUTH_ERROR", "Session token does not match device credential", false);
                    return;
                }
            } catch {
                sendError("AUTH_ERROR", "Invalid session token", false);
                return;
            }
        }

        const issuedAt = Date.now();
        const nextSessionToken = mintSessionToken(verifiedDeviceId, issuedAt);
        state.authenticated = true;
        state.deviceId = verifiedDeviceId;
        state.deviceCredential = payload.deviceCredential;
        state.sessionToken = nextSessionToken.token;
        state.sessionTokenExpiresAt = nextSessionToken.expiresAt;
        state.tokenIssuedAt = issuedAt;
        state.transportMode = payload.transportMode;

        const missedMessages = messageBuffer.filter((message) => message.seq > payload.lastSeenSeq);
        sendAuthenticatedMessage("resume", missedMessages.length);
        onAuthenticated?.(true);

        for (const message of missedMessages) {
            send(message);
        }

        sessionManager.resyncStateAfterReconnect();
    }

    return {
        get isAuthenticated() {
            return state.authenticated;
        },

        get deviceId() {
            return state.deviceId;
        },

        async handleRawMessage(data: string): Promise<void> {
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            } catch {
                sendError("INVALID_JSON", "Message is not valid JSON", false);
                return;
            }

            const result = clientMessageSchema.safeParse(parsed);
            if (!result.success) {
                logValidationFailure(
                    parsed,
                    result.error.issues.map((issue) => ({
                        path: issue.path.join("."),
                        message: issue.message,
                    }))
                );
                sendError("VALIDATION_ERROR", "Invalid message payload", false);
                return;
            }

            const message = result.data as ClientMessage;

            if (!checkReplayProtection(message.id)) {
                sendError("REPLAY_ATTACK", "Duplicate message ID rejected", false);
                return;
            }

            const unauthenticatedAllowed =
                message.type === "auth.pair" || message.type === "auth.resume";
            if (!unauthenticatedAllowed && !state.authenticated) {
                sendError("AUTH_REQUIRED", "Authentication required", false);
                return;
            }

            if (state.deviceId !== null && !unauthenticatedAllowed) {
                if (!checkMessageRateLimit(state.deviceId)) {
                    sendError("RATE_LIMIT", "Too many messages, slow down", false);
                    return;
                }
            }

            await this.dispatch(message);
            checkTokenRefresh();
        },

        async dispatch(message: ClientMessage): Promise<void> {
            switch (message.type) {
                case "auth.pair":
                    handlePair(message.payload.pairingToken, message.payload.transportMode);
                    return;

                case "auth.resume":
                    handleResume(message.payload);
                    return;

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
                    return;

                case "session.mode.update":
                    return sessionManager.updateSessionMode(
                        message.payload.sessionId,
                        message.payload.agentMode
                    );

                case "permission.level.update":
                    return sessionManager.updatePermissionLevel(
                        message.payload.sessionId,
                        message.payload.permissionLevel
                    );

                case "models.request":
                    return sessionManager.listModels();

                case "skills.list.request":
                    return sessionManager.listSkills();

                case "capabilities.request":
                    sessionManager.emitCapabilitiesState();
                    return;

                case "workspace.tree.request": {
                    const maxDepth = Math.min(message.payload.maxDepth ?? 3, 5);
                    return sessionManager.listWorkspaceTree(
                        message.payload.sessionId,
                        message.payload.workspaceRelativePath,
                        maxDepth
                    );
                }

                case "workspace.git.request": {
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

                case "workspace.branch.switch":
                    return sessionManager.switchWorkspaceBranch(
                        message.payload.sessionId,
                        message.payload.branchName
                    );

                case "workspace.file.request":
                    return sessionManager.readWorkspaceFile(
                        message.payload.sessionId,
                        message.payload.workspaceRelativePath,
                        message.payload.maxBytes
                    );

                case "workspace.resolve.request":
                    return sessionManager.resolveWorkspaceReference(
                        message.payload.sessionId,
                        message.payload.rawPath
                    );

                case "workspace.diff.request":
                    return sessionManager.readWorkspaceDiff(
                        message.payload.sessionId,
                        message.payload.workspaceRelativePath
                    );

                default:
                    sendError("UNKNOWN_TYPE", "Unknown message type", false);
            }
        },

        cleanup(): void {
            sessionManager.cleanupOnDisconnect();
        },
    };
}

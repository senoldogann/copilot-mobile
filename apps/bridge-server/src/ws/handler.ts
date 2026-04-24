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
import {
    checkMessageRateLimit,
    checkOperationRateLimit,
    checkReplayProtection,
    type OperationRateLimitBucket,
} from "../utils/rate-limit.js";
import { searchWorkspaceDirectories } from "../utils/workspace-search.js";
import type { createSessionManager } from "../copilot/session-manager.js";

type SessionManager = ReturnType<typeof createSessionManager>;
type SendFn = (message: ServerMessage) => void;
type NotificationHandlers = {
    registerNotificationDevice: (input: {
        deviceId: string;
        provider: "expo";
        pushToken: string;
        platform: "ios" | "android";
        appVersion?: string;
    }) => void;
    unregisterNotificationDevice: (deviceId: string) => void;
    updateNotificationPresence: (input: {
        deviceId: string;
        state: "active" | "inactive" | "background";
        timestamp: number;
    }) => void;
};

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
    onAuthenticated?: (
        authMethod: "pair" | "resume",
        preserveReplayBuffer: boolean,
        deviceId: string
    ) => void,
    notificationHandlers?: NotificationHandlers,
    getRelayMobileAccessToken?: () => string | null
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
    let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

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

    function clearTokenRefreshTimer(): void {
        if (tokenRefreshTimer === null) {
            return;
        }

        clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }

    function scheduleTokenRefresh(): void {
        clearTokenRefreshTimer();
        if (!state.authenticated || state.deviceId === null) {
            return;
        }

        const refreshDelayMs = Math.max(
            (state.tokenIssuedAt + SESSION_TOKEN_REFRESH_THRESHOLD_MS) - Date.now(),
            0
        );
        tokenRefreshTimer = setTimeout(() => {
            tokenRefreshTimer = null;
            checkTokenRefresh();
        }, refreshDelayMs);
        tokenRefreshTimer.unref?.();
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

        const relayAccessTokenCandidate = state.transportMode === "relay"
            ? getRelayMobileAccessToken?.()
            : null;

        if (state.transportMode === "relay" && relayAccessTokenCandidate == null) {
            throw new Error("Relay transport requires a mobile relay access token");
        }

        if (state.transportMode === "relay") {
            const relayAccessToken: string = relayAccessTokenCandidate as string;
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
                    relayAccessToken,
                    replayedCount,
                },
            });
            return;
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

    function requireDeviceId(): string {
        if (!state.authenticated || state.deviceId === null) {
            throw new Error("Authenticated device ID is unavailable");
        }

        return state.deviceId;
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
        scheduleTokenRefresh();
    }

    function getOperationRateLimitConfig(
        message: ClientMessage
    ): { bucket: OperationRateLimitBucket; errorMessage: string } | null {
        switch (message.type) {
            case "session.create":
                return {
                    bucket: "session.create",
                    errorMessage: "Too many session creations, slow down",
                };

            case "workspace.search.request":
            case "workspace.tree.request":
            case "workspace.git.request":
            case "workspace.file.request":
            case "workspace.resolve.request":
            case "workspace.diff.request":
                return {
                    bucket: "workspace-read",
                    errorMessage: "Too many workspace reads, slow down",
                };

            case "workspace.pull":
            case "workspace.commit":
            case "workspace.push":
            case "workspace.branch.switch":
            case "workspace.branch.create":
                return {
                    bucket: "workspace-write",
                    errorMessage: "Too many workspace changes, slow down",
                };

            default:
                return null;
        }
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
        scheduleTokenRefresh();
        onAuthenticated?.("pair", false, deviceId);
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
        scheduleTokenRefresh();
        onAuthenticated?.("resume", true, verifiedDeviceId);

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

            const rateLimitedMessage = message.type === "message.send";
            if (state.deviceId !== null && rateLimitedMessage) {
                if (!checkMessageRateLimit(state.deviceId)) {
                    sendError("RATE_LIMIT", "Too many messages, slow down", false);
                    return;
                }
            }

            const operationRateLimit = state.deviceId !== null
                ? getOperationRateLimitConfig(message)
                : null;
            if (
                state.deviceId !== null
                && operationRateLimit !== null
                && !checkOperationRateLimit(state.deviceId, operationRateLimit.bucket)
            ) {
                sendError("RATE_LIMIT", operationRateLimit.errorMessage, false);
                return;
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
                    return sessionManager.createSession(
                        message.payload.config,
                        requireDeviceId(),
                        message.payload.initialMessage
                    );

                case "session.resume":
                    return sessionManager.resumeSession(message.payload.sessionId, requireDeviceId());

                case "session.list":
                    return sessionManager.listSessions();

                case "session.delete":
                    return sessionManager.deleteSession(message.payload.sessionId);

                case "attachment.upload.start":
                    return sessionManager.startAttachmentUpload(
                        requireDeviceId(),
                        message.payload.uploadId,
                        message.payload.mimeType,
                        message.payload.displayName
                    );

                case "attachment.upload.chunk":
                    return sessionManager.appendAttachmentUploadChunk(
                        requireDeviceId(),
                        message.payload.uploadId,
                        message.payload.data
                    );

                case "attachment.upload.complete":
                    return sessionManager.completeAttachmentUpload(
                        requireDeviceId(),
                        message.payload.uploadId
                    );

                case "message.send":
                    return sessionManager.sendMessage(
                        message.payload.sessionId,
                        message.payload.content,
                        message.payload.attachments,
                        requireDeviceId()
                    );

                case "message.abort":
                    return sessionManager.abortMessage(message.payload.sessionId);

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

                case "notification.device.register":
                    notificationHandlers?.registerNotificationDevice({
                        deviceId: requireDeviceId(),
                        provider: message.payload.provider,
                        pushToken: message.payload.pushToken,
                        platform: message.payload.platform,
                        ...(message.payload.appVersion !== undefined
                            ? { appVersion: message.payload.appVersion }
                            : {}),
                    });
                    return;

                case "notification.device.unregister":
                    notificationHandlers?.unregisterNotificationDevice(requireDeviceId());
                    return;

                case "notification.presence.update":
                    notificationHandlers?.updateNotificationPresence({
                        deviceId: requireDeviceId(),
                        state: message.payload.state,
                        timestamp: message.payload.timestamp,
                    });
                    return;

                case "workspace.search.request": {
                    try {
                        const matches = message.payload.sessionId !== undefined
                            ? await sessionManager.searchWorkspaceFiles(
                                message.payload.sessionId,
                                message.payload.query,
                                message.payload.limit
                            )
                            : await searchWorkspaceDirectories(
                                message.payload.query,
                                message.payload.limit
                            );
                        send({
                            ...makeBase(),
                            type: "workspace.search.response",
                            payload: {
                                requestKey: message.payload.requestKey,
                                query: message.payload.query,
                                matches,
                            },
                        });
                    } catch (error) {
                        send({
                            ...makeBase(),
                            type: "workspace.search.response",
                            payload: {
                                requestKey: message.payload.requestKey,
                                query: message.payload.query,
                                matches: [],
                                error: error instanceof Error ? error.message : String(error),
                            },
                        });
                    }
                    return;
                }

                case "workspace.tree.request": {
                    const maxDepth = Math.min(message.payload.maxDepth ?? 3, 7);
                    return sessionManager.listWorkspaceTree(
                        message.payload.sessionId,
                        message.payload.workspaceRelativePath,
                        maxDepth,
                        message.payload.offset ?? 0,
                        message.payload.pageSize ?? 200
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

                case "workspace.commit":
                    return sessionManager.commitWorkspace(
                        message.payload.sessionId,
                        message.payload.message
                    );

                case "workspace.push":
                    return sessionManager.pushWorkspace(message.payload.sessionId);

                case "workspace.branch.switch":
                    return sessionManager.switchWorkspaceBranch(
                        message.payload.sessionId,
                        message.payload.branchName
                    );

                case "workspace.branch.create":
                    return sessionManager.createWorkspaceBranch(
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
                        message.payload.workspaceRelativePath,
                        message.payload.commitHash
                    );

                default:
                    sendError("UNKNOWN_TYPE", "Unknown message type", false);
            }
        },

        cleanup(): void {
            clearTokenRefreshTimer();
            sessionManager.cleanupOnDisconnect();
        },
    };
}

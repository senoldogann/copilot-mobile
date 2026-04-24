// Bridge service — combines WebSocket client and message dispatcher
// All bridge communication goes through this module

import type { AppStateStatus } from "react-native";
import type {
    AgentMode,
    NotificationPresenceState,
    PermissionLevel,
    QRPayload,
    SessionConfig,
    ClientMessage,
    SessionMessageInput,
    SessionMessageAttachment,
} from "@copilot-mobile/shared";
import { createWSClient } from "./ws-client";
import type { ConnectionState, ResumeOptions } from "./ws-client";
import { handleServerMessage } from "./message-handler";
import {
    getBridgeConnectionState,
    getBridgeSessionState,
    getBridgeWorkspaceState,
    setBridgeConnectionError,
    setBridgeConnectionState,
    setBridgeServerInfo,
} from "./bridge-state";
import {
    dispatchWorkspaceDiffResponse,
    dispatchWorkspaceFileResponse,
    dispatchWorkspaceResolveResponse,
    onWorkspaceDiffResponse,
    onWorkspaceFileResponse,
    onWorkspaceResolveResponse,
    onWorkspaceSearchResponse,
} from "./workspace-events";
import {
    clearCredentials,
    loadCredentials,
    saveCredentials,
} from "./credentials";
import { getAppVisibilityState } from "./app-visibility";
import {
    clearBridgeRemotePushRegistration,
    hasBridgeRemotePushRegistration,
    isBridgeRemotePushCurrent,
    markBridgeRemotePushRegistered,
    resolveRemotePushAvailability,
} from "./notifications";
import { clearSessionPrefetch, markSessionPrefetchRequest } from "./session-prefetch";

export { onWorkspaceFileResponse, onWorkspaceDiffResponse, onWorkspaceResolveResponse };

export type WorkspaceDirectorySearchMatch = {
    path: string;
    displayPath: string;
    name: string;
};

let client: ReturnType<typeof createWSClient> | null = null;
const STALE_DIRECT_CREDENTIAL_GRACE_MS = 3_000;
const NOTIFICATION_UNREGISTER_TIMEOUT_MS = 1_500;
const DELETE_SESSION_BASE_TIMEOUT_MS = 6_000;
const DELETE_SESSION_MAX_TIMEOUT_MS = 20_000;
const DELETE_SESSION_PER_ITEM_TIMEOUT_MS = 300;
const DELETE_SESSION_REFRESH_INTERVAL_MS = 300;
const DELETE_SESSION_SEND_DELAY_MS = 40;
const WORKSPACE_GIT_SUMMARY_THROTTLE_MS = 8_000;
const WORKSPACE_BRANCH_RESPONSE_TIMEOUT_MS = 12_000;
const workspaceGitSummaryRequestTimestamps = new Map<string, number>();
let workspaceBranchResponseTimer: ReturnType<typeof setTimeout> | null = null;

export type RemoteDeleteSessionsResult = {
    deletedSessionIds: ReadonlyArray<string>;
    failedSessionIds: ReadonlyArray<string>;
};

function mapPresenceState(nextAppState: AppStateStatus): NotificationPresenceState {
    if (nextAppState === "active") {
        return "active";
    }

    return "background";
}

function persistAuthenticatedConnection(params: {
    deviceCredential: string;
    serverUrl: string;
    certFingerprint: string | null;
    deviceId: string;
    transportMode: "direct" | "relay";
    relayAccessToken: string | null;
}): void {
    void saveCredentials(params).catch((error: unknown) => {
        console.warn("[Bridge] Failed to persist authenticated connection", {
            deviceId: params.deviceId,
            transportMode: params.transportMode,
            error,
        });
    });
}

function armWorkspaceBranchResponseTimeout(): void {
    if (workspaceBranchResponseTimer !== null) {
        clearTimeout(workspaceBranchResponseTimer);
    }

    workspaceBranchResponseTimer = setTimeout(() => {
        workspaceBranchResponseTimer = null;
        const workspaceStore = getBridgeWorkspaceState();
        if (!workspaceStore.isSwitchingBranch) {
            return;
        }

        workspaceStore.setBranchSwitching(false);
        workspaceStore.setError("Branch update timed out. Reopen the branch menu and try again.");
    }, WORKSPACE_BRANCH_RESPONSE_TIMEOUT_MS);
}

async function syncRemoteNotificationRegistrationInternal(
    c: ReturnType<typeof createWSClient>,
    options: {
        allowPrompt: boolean;
        force: boolean;
    }
): Promise<void> {
    if (c.getState() !== "authenticated") {
        return;
    }

    const availability = await resolveRemotePushAvailability({
        allowPrompt: options.allowPrompt,
    });

    if (availability.kind === "ready") {
        if (!options.force && isBridgeRemotePushCurrent(availability.registration.pushToken)) {
            return;
        }

        try {
            await c.sendMessage("notification.device.register", {
                provider: availability.registration.provider,
                pushToken: availability.registration.pushToken,
                platform: availability.registration.platform,
                ...(availability.registration.appVersion !== undefined
                    ? { appVersion: availability.registration.appVersion }
                    : {}),
            });
            markBridgeRemotePushRegistered(availability.registration.pushToken);
        } catch (error) {
            setBridgeConnectionError(
                `Failed to register remote notifications: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        return;
    }

    if (availability.kind === "permission_denied" && hasBridgeRemotePushRegistration()) {
        try {
            await c.sendMessage("notification.device.unregister", {});
        } catch (error) {
            console.warn("[Bridge] notification.device.unregister failed", { error });
        } finally {
            clearBridgeRemotePushRegistration();
        }
    }
}

async function unregisterRemoteNotificationsBeforeDisconnect(
    c: ReturnType<typeof createWSClient>
): Promise<void> {
    if (c.getState() !== "authenticated" || !hasBridgeRemotePushRegistration()) {
        clearBridgeRemotePushRegistration();
        return;
    }

    try {
        await Promise.race([
            c.sendMessage("notification.device.unregister", {}),
            new Promise<void>((resolve) => {
                setTimeout(resolve, NOTIFICATION_UNREGISTER_TIMEOUT_MS);
            }),
        ]);
    } catch (error) {
        console.warn("[Bridge] notification.device.unregister failed during disconnect", { error });
    } finally {
        clearBridgeRemotePushRegistration();
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function waitForRemoteSessionDeletion(
    c: ReturnType<typeof createWSClient>,
    sessionIds: ReadonlyArray<string>
): Promise<RemoteDeleteSessionsResult> {
    const pendingSessionIds = new Set(sessionIds);
    const timeoutMs = Math.min(
        DELETE_SESSION_BASE_TIMEOUT_MS + (sessionIds.length * DELETE_SESSION_PER_ITEM_TIMEOUT_MS),
        DELETE_SESSION_MAX_TIMEOUT_MS
    );
    const startedAt = Date.now();

    while (pendingSessionIds.size > 0 && (Date.now() - startedAt) < timeoutMs) {
        await c.sendMessage("session.list", {});
        await sleep(DELETE_SESSION_REFRESH_INTERVAL_MS);

        const listedSessionIds = new Set(
            getBridgeSessionState().sessions.map((item) => item.id)
        );
        for (const sessionId of [...pendingSessionIds]) {
            if (!listedSessionIds.has(sessionId)) {
                pendingSessionIds.delete(sessionId);
            }
        }
    }

    return {
        deletedSessionIds: sessionIds.filter((sessionId) => !pendingSessionIds.has(sessionId)),
        failedSessionIds: [...pendingSessionIds],
    };
}

async function deleteSessionsRemotely(
    c: ReturnType<typeof createWSClient>,
    sessionIds: ReadonlyArray<string>
): Promise<RemoteDeleteSessionsResult> {
    const uniqueSessionIds = [...new Set(sessionIds)];
    if (uniqueSessionIds.length === 0) {
        return { deletedSessionIds: [], failedSessionIds: [] };
    }

    const requestedSessionIds: Array<string> = [];
    const failedToRequestSessionIds: Array<string> = [];

    for (const sessionId of uniqueSessionIds) {
        try {
            await c.sendMessage("session.delete", { sessionId });
            requestedSessionIds.push(sessionId);
        } catch (error) {
            console.warn("[Bridge] session.delete request failed", {
                sessionId,
                error,
            });
            failedToRequestSessionIds.push(sessionId);
        }

        if (uniqueSessionIds.length > 1) {
            await sleep(DELETE_SESSION_SEND_DELAY_MS);
        }
    }

    const settledDeletes = await waitForRemoteSessionDeletion(c, requestedSessionIds);
    return {
        deletedSessionIds: settledDeletes.deletedSessionIds,
        failedSessionIds: [...failedToRequestSessionIds, ...settledDeletes.failedSessionIds],
    };
}

function getClient(): ReturnType<typeof createWSClient> {
    if (client === null) {
        const nextClient = createWSClient({
            onMessage: (message) => {
                if (message.type === "auth.authenticated") {
                    const persistableConnection = nextClient.getPersistableConnection();
                    if (
                        persistableConnection.serverUrl !== null
                        && persistableConnection.transportMode !== null
                    ) {
                        persistAuthenticatedConnection({
                            deviceCredential: message.payload.deviceCredential,
                            serverUrl: persistableConnection.serverUrl,
                            certFingerprint: persistableConnection.certFingerprint,
                            deviceId: message.payload.deviceId,
                            transportMode: persistableConnection.transportMode,
                            relayAccessToken: message.payload.relayAccessToken
                                ?? persistableConnection.relayAccessToken,
                        });
                    }
                }

                const sessionStore = getBridgeSessionState();
                const activeSessionId = sessionStore.activeSessionId;

                if (message.type === "permission.request") {
                    const { permissionLevel, autoApproveReads } = sessionStore;
                    const kind = message.payload.kind;
                    const shouldAutoApprove =
                        message.payload.sessionId === activeSessionId
                        && (
                        permissionLevel === "bypass"
                        || permissionLevel === "autopilot"
                        || (autoApproveReads && kind === "read")
                        );

                    if (shouldAutoApprove) {
                        void nextClient.sendMessage("permission.respond", {
                            requestId: message.payload.requestId,
                            approved: true,
                        });
                        return;
                    }
                }

                handleServerMessage(message);
                if (message.type === "session.history") {
                    nextClient.flushPending();
                }
            },
            onStateChange: (state: ConnectionState) => {
                setBridgeConnectionState(state);
                if (state !== "authenticated") {
                    return;
                }

                const activeSessionId = getBridgeSessionState().activeSessionId;
                const resolvedClient = client ?? nextClient;
                void syncRemoteNotificationRegistrationInternal(resolvedClient, {
                    allowPrompt: false,
                    force: true,
                });
                void reportNotificationPresence(getAppVisibilityState());
                if (activeSessionId !== null) {
                    getBridgeSessionState().setSessionLoading(true);
                    void resolvedClient.sendMessage("session.resume", { sessionId: activeSessionId });
                    return;
                }

                resolvedClient.flushPending();
            },
            onError: (error: string) => {
                setBridgeConnectionError(error);
            },
        });
        client = nextClient;
    }
    return client;
}

// Connect with QR code
export function connectWithQR(qrPayload: QRPayload): void {
    const c = getClient();
    const connStore = getBridgeConnectionState();
    connStore.setError(null);
    setBridgeServerInfo(qrPayload.url, qrPayload.certFingerprint);
    c.connectWithQR(qrPayload);
}

// Create new session
export async function createSession(config: SessionConfig): Promise<void> {
    const c = getClient();
    setBridgeConnectionError(null);
    try {
        await c.sendMessage("session.create", { config });
    } catch (error) {
        getBridgeSessionState().setSessionLoading(false);
        setBridgeConnectionError(
            `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

export async function createSessionWithInitialMessage(
    config: SessionConfig,
    initialMessage: SessionMessageInput
): Promise<void> {
    const c = getClient();
    setBridgeConnectionError(null);
    try {
        await c.sendMessage("session.create", {
            config,
            initialMessage,
        });
    } catch (error) {
        getBridgeSessionState().setSessionLoading(false);
        getBridgeSessionState().setAssistantTyping(false);
        setBridgeConnectionError(
            `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

async function sendMessageWithoutLocalEcho(
    sessionId: string,
    content: string,
    attachments?: ReadonlyArray<SessionMessageAttachment>
): Promise<void> {
    const c = getClient();

    try {
        await c.sendMessage(
            "message.send",
            attachments !== undefined && attachments.length > 0
                ? { sessionId, content, attachments }
                : { sessionId, content }
        );
    } catch (error) {
        getBridgeSessionState().setAssistantTyping(false);
        setBridgeConnectionError(
            `Failed to send message: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

// Send message
export async function sendMessage(
    sessionId: string,
    content: string,
    attachments?: ReadonlyArray<SessionMessageAttachment>
): Promise<void> {
    const sessionStore = getBridgeSessionState();
    const itemId = sessionStore.addUserMessage(content, attachments);
    sessionStore.setAssistantTyping(true);
    try {
        await sendMessageWithoutLocalEcho(sessionId, content, attachments);
        sessionStore.updateUserMessageDeliveryState(itemId, "sent");
    } catch {
        sessionStore.updateUserMessageDeliveryState(itemId, "failed");
    }
}

export async function sendQueuedMessage(
    sessionId: string,
    content: string,
    attachments?: ReadonlyArray<SessionMessageAttachment>
): Promise<void> {
    const sessionStore = getBridgeSessionState();
    sessionStore.setAssistantTyping(true);
    await sendMessageWithoutLocalEcho(sessionId, content, attachments);
}

export async function syncSessionPreferences(sessionId: string): Promise<void> {
    const c = getClient();
    const sessionStore = getBridgeSessionState();

    try {
        await c.sendMessage("session.mode.update", {
            sessionId,
            agentMode: sessionStore.agentMode,
        });
        await c.sendMessage("permission.level.update", {
            sessionId,
            permissionLevel: sessionStore.permissionLevel,
        });
    } catch (error) {
        setBridgeConnectionError(
            `Failed to restore session behavior: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Abort message — best-effort, swallows send failures
export async function abortMessage(sessionId: string): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("message.abort", { sessionId });
    } catch (error) {
        setBridgeConnectionError(
            `Failed to stop message: ${error instanceof Error ? error.message : String(error)}`
        );
        console.warn("[Bridge] message.abort failed", { sessionId, error });
        throw error;
    }
}

// Respond to permission request
export async function respondPermission(requestId: string, approved: boolean): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("permission.respond", { requestId, approved });
        getBridgeSessionState().resolvePermissionPrompt(requestId);
    } catch (error) {
        setBridgeConnectionError("Failed to send permission response");
        console.warn("[Bridge] permission.respond failed", { requestId, approved, error });
    }
}

// Respond to user input request
export async function respondUserInput(requestId: string, value: string): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("user_input.respond", { requestId, value });
        getBridgeSessionState().resolveUserInputPrompt(requestId);
    } catch (error) {
        setBridgeConnectionError("Failed to send input response");
        console.warn("[Bridge] user_input.respond failed", { requestId, error });
    }
}

export async function updateSettings(settings: { autoApproveReads: boolean }): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("settings.update", settings);
    } catch {
        setBridgeConnectionError("Failed to update settings");
    }
}

export async function updateSessionMode(sessionId: string, agentMode: AgentMode): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("session.mode.update", {
            sessionId,
            agentMode,
        });
    } catch {
        setBridgeConnectionError("Failed to update agent mode");
    }
}

export async function updatePermissionLevel(
    sessionId: string,
    permissionLevel: PermissionLevel
): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("permission.level.update", {
            sessionId,
            permissionLevel,
        });
    } catch {
        setBridgeConnectionError("Failed to update permission level");
    }
}

// List sessions — best-effort query, swallows send failures on disconnect
export async function listSessions(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("session.list", {});
    } catch (error) {
        console.warn("[Bridge] session.list failed", { error });
    }
}

// Delete session
export async function deleteSession(sessionId: string): Promise<void> {
    const c = getClient();
    try {
        const result = await deleteSessionsRemotely(c, [sessionId]);
        if (result.failedSessionIds.length > 0) {
            throw new Error(`Session ${sessionId} could not be deleted remotely`);
        }
    } catch (error) {
        setBridgeConnectionError("Failed to delete session");
        throw error;
    }
}

export async function deleteSessions(
    sessionIds: ReadonlyArray<string>
): Promise<RemoteDeleteSessionsResult> {
    const c = getClient();
    try {
        return await deleteSessionsRemotely(c, sessionIds);
    } catch (error) {
        setBridgeConnectionError("Failed to delete sessions");
        throw error;
    }
}

// Resume session
export async function resumeSession(sessionId: string): Promise<void> {
    const c = getClient();
    setBridgeConnectionError(null);
    try {
        await c.sendMessage("session.resume", { sessionId });
    } catch (error) {
        setBridgeConnectionError("Failed to resume session");
        throw error;
    }
}

export async function prefetchSessionState(
    sessionId: string,
    hydrateActiveSession: boolean
): Promise<void> {
    const c = getClient();
    try {
        if (!hydrateActiveSession) {
            markSessionPrefetchRequest(sessionId);
        }
        await c.sendMessage("session.resume", { sessionId });
    } catch (error) {
        if (!hydrateActiveSession) {
            clearSessionPrefetch(sessionId);
        }
        console.warn("[Bridge] session.resume prefetch failed", {
            sessionId,
            error,
        });
    }
}

// List models — best-effort query, swallows send failures on disconnect
export async function listModels(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("models.request", {});
    } catch (error) {
        console.warn("[Bridge] models.request failed", { error });
    }
}

// Request current capabilities state from bridge — best-effort query
export async function requestCapabilities(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("capabilities.request", {});
    } catch (error) {
        console.warn("[Bridge] capabilities.request failed", { error });
    }
}

export async function syncRemoteNotificationRegistration(
    options: {
        allowPrompt: boolean;
        force: boolean;
    }
): Promise<void> {
    const c = client;
    if (c === null) {
        return;
    }

    await syncRemoteNotificationRegistrationInternal(c, options);
}

export async function reportNotificationPresence(nextAppState: AppStateStatus): Promise<void> {
    const c = client;
    if (c === null || c.getState() !== "authenticated") {
        return;
    }

    try {
        await c.sendMessage("notification.presence.update", {
            state: mapPresenceState(nextAppState),
            timestamp: Date.now(),
        });
    } catch (error) {
        console.warn("[Bridge] notification.presence.update failed", {
            state: nextAppState,
            error,
        });
    }
}

// Request list of installed agent skills from bridge
export async function requestSkillsList(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("skills.list.request", {});
    } catch (error) {
        console.warn("[Bridge] skills.list.request failed", { error });
    }
}

// Workspace tree — requests a repository subtree for the active session
export async function requestWorkspaceTree(
    sessionId: string,
    workspaceRelativePath?: string,
    maxDepth?: number,
    offset?: number,
    pageSize?: number
): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setTreeLoading(workspaceRelativePath ?? "__root__", true);
    try {
        await c.sendMessage("workspace.tree.request", {
            sessionId,
            ...(workspaceRelativePath !== undefined ? { workspaceRelativePath } : {}),
            ...(maxDepth !== undefined ? { maxDepth } : {}),
            ...(offset !== undefined ? { offset } : {}),
            ...(pageSize !== undefined ? { pageSize } : {}),
        });
    } catch (error) {
        workspaceStore.setTreeLoading(workspaceRelativePath ?? "__root__", false);
        workspaceStore.setError(
            `Failed to request workspace tree: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Workspace git summary — requests changes + recent commits for the active session
export async function requestWorkspaceGitSummary(
    sessionId: string,
    commitLimit?: number
): Promise<void> {
    const lastRequestedAt = workspaceGitSummaryRequestTimestamps.get(sessionId);
    const now = Date.now();
    if (
        lastRequestedAt !== undefined
        && now - lastRequestedAt < WORKSPACE_GIT_SUMMARY_THROTTLE_MS
    ) {
        return;
    }

    workspaceGitSummaryRequestTimestamps.set(sessionId, now);
    await sendWorkspaceGitSummaryRequest(sessionId, commitLimit);
}

export async function refreshWorkspaceGitSummary(
    sessionId: string,
    commitLimit?: number
): Promise<void> {
    workspaceGitSummaryRequestTimestamps.delete(sessionId);
    await sendWorkspaceGitSummaryRequest(sessionId, commitLimit);
}

async function sendWorkspaceGitSummaryRequest(
    sessionId: string,
    commitLimit?: number
): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setGitLoading(true);
    try {
        await c.sendMessage("workspace.git.request", {
            sessionId,
            ...(commitLimit !== undefined ? { commitLimit } : {}),
        });
    } catch (error) {
        workspaceGitSummaryRequestTimestamps.delete(sessionId);
        workspaceStore.setGitLoading(false);
        workspaceStore.setError(
            `Failed to request workspace changes: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Workspace pull — triggers repository pull if backend supports it
export async function pullWorkspace(sessionId: string): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setWorkspaceOperationState("pull", true);
    try {
        await c.sendMessage("workspace.pull", { sessionId });
    } catch (error) {
        workspaceStore.setWorkspaceOperationState("pull", false);
        workspaceStore.setError(
            `Failed to pull workspace: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Workspace commit — stages workspace changes and creates a git commit
export async function commitWorkspace(sessionId: string, message: string): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setWorkspaceOperationState("commit", true);
    try {
        await c.sendMessage("workspace.commit", {
            sessionId,
            message,
        });
    } catch (error) {
        workspaceStore.setWorkspaceOperationState("commit", false);
        workspaceStore.setError(
            `Failed to commit workspace: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Workspace push — triggers repository push if backend supports it
export async function pushWorkspace(sessionId: string): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setWorkspaceOperationState("push", true);
    try {
        await c.sendMessage("workspace.push", { sessionId });
    } catch (error) {
        workspaceStore.setWorkspaceOperationState("push", false);
        workspaceStore.setError(
            `Failed to push workspace: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Workspace branch switch — switches to an existing local branch
export async function switchWorkspaceBranch(sessionId: string, branchName: string): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setBranchSwitching(true);
    armWorkspaceBranchResponseTimeout();
    try {
        await c.sendMessage("workspace.branch.switch", {
            sessionId,
            branchName,
        });
    } catch (error) {
        workspaceStore.setBranchSwitching(false);
        workspaceStore.setError(
            `Failed to switch branch: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export async function createWorkspaceBranch(sessionId: string, branchName: string): Promise<void> {
    const c = getClient();
    const workspaceStore = getBridgeWorkspaceState();
    workspaceStore.setBranchSwitching(true);
    armWorkspaceBranchResponseTimeout();
    try {
        await c.sendMessage("workspace.branch.create", {
            sessionId,
            branchName,
        });
    } catch (error) {
        workspaceStore.setBranchSwitching(false);
        workspaceStore.setError(
            `Failed to create branch: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export function resumeBridgeConnection(): boolean {
    if (client === null) {
        return false;
    }
    return client.resume({
        reconnectOnFailure: true,
        reportErrors: true,
    });
}

// Load persisted credentials after app restart and resume with auth.resume.
export async function tryResumeFromStoredCredentials(options: ResumeOptions): Promise<boolean> {
    const initialConnectionState = getBridgeConnectionState();
    if (initialConnectionState.state !== "disconnected") {
        return false;
    }

    const creds = await loadCredentials();
    if (creds === null) {
        return false;
    }

    const currentConnectionState = getBridgeConnectionState();
    if (currentConnectionState.state !== "disconnected") {
        return false;
    }

    const c = getClient();
    c.seedStoredCredentials({
        deviceCredential: creds.deviceCredential,
        serverUrl: creds.serverUrl,
        certFingerprint: creds.certFingerprint,
        transportMode: creds.transportMode,
        relayAccessToken: creds.relayAccessToken,
    });
    const connStore = getBridgeConnectionState();
    connStore.setServerInfo(creds.serverUrl, creds.certFingerprint);
    connStore.setDeviceId(creds.deviceId);
    const didStartResume = c.resume(options);

    if (
        didStartResume
        && creds.transportMode === "direct"
        && !options.reconnectOnFailure
        && !options.reportErrors
    ) {
        setTimeout(() => {
            const currentConnection = getBridgeConnectionState();
            if (
                currentConnection.state === "disconnected"
                && currentConnection.serverUrl === creds.serverUrl
            ) {
                void clearCredentials();
                currentConnection.reset();
            }
        }, STALE_DIRECT_CREDENTIAL_GRACE_MS);
    }

    return didStartResume;
}

export async function requestWorkspaceFile(
    sessionId: string,
    workspaceRelativePath: string,
    maxBytes?: number
): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("workspace.file.request", {
            sessionId,
            workspaceRelativePath,
            ...(maxBytes !== undefined ? { maxBytes } : {}),
        });
    } catch (error) {
        dispatchWorkspaceFileResponse(sessionId, workspaceRelativePath, {
            content: "",
            mimeType: "text/plain",
            truncated: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function requestWorkspaceDiff(
    sessionId: string,
    workspaceRelativePath: string,
    commitHash?: string
): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("workspace.diff.request", {
            sessionId,
            workspaceRelativePath,
            ...(commitHash !== undefined ? { commitHash } : {}),
        });
    } catch (error) {
        dispatchWorkspaceDiffResponse(sessionId, workspaceRelativePath, commitHash, {
            diff: "",
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function requestWorkspaceResolve(
    sessionId: string,
    rawPath: string
): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("workspace.resolve.request", {
            sessionId,
            rawPath,
        });
    } catch (error) {
        dispatchWorkspaceResolveResponse(sessionId, rawPath, {
            rawPath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function searchWorkspaceDirectories(
    query: string,
    limit: number
): Promise<ReadonlyArray<WorkspaceDirectorySearchMatch>> {
    const c = getClient();
    const requestKey = `workspace-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const connectionState = getBridgeConnectionState();

    if (connectionState.state !== "authenticated") {
        throw new Error("Connect to the bridge before searching for workspaces.");
    }

    return new Promise<ReadonlyArray<WorkspaceDirectorySearchMatch>>((resolve, reject) => {
        const unsubscribe = onWorkspaceSearchResponse(requestKey, (payload) => {
            clearTimeout(timeoutId);
            unsubscribe();

            if (payload.error !== undefined) {
                reject(new Error(payload.error));
                return;
            }

            resolve(payload.matches);
        });

        const timeoutId = setTimeout(() => {
            unsubscribe();
            reject(new Error("Workspace search timed out."));
        }, 8000);

        void c.sendMessage("workspace.search.request", {
            requestKey,
            query,
            limit,
        }).catch((error) => {
            clearTimeout(timeoutId);
            unsubscribe();
            reject(error);
        });
    });
}

export async function searchWorkspaceFiles(
    sessionId: string,
    query: string,
    limit: number
): Promise<ReadonlyArray<WorkspaceDirectorySearchMatch>> {
    const c = getClient();
    const requestKey = `workspace-file-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const connectionState = getBridgeConnectionState();

    if (connectionState.state !== "authenticated") {
        throw new Error("Connect to the bridge before searching files.");
    }

    return new Promise<ReadonlyArray<WorkspaceDirectorySearchMatch>>((resolve, reject) => {
        const unsubscribe = onWorkspaceSearchResponse(requestKey, (payload) => {
            clearTimeout(timeoutId);
            unsubscribe();

            if (payload.error !== undefined) {
                reject(new Error(payload.error));
                return;
            }

            resolve(payload.matches);
        });

        const timeoutId = setTimeout(() => {
            unsubscribe();
            reject(new Error("Workspace file search timed out."));
        }, 8000);

        void c.sendMessage("workspace.search.request", {
            requestKey,
            sessionId,
            query,
            limit,
            searchScope: "workspace_files",
        }).catch((error) => {
            clearTimeout(timeoutId);
            unsubscribe();
            reject(error);
        });
    });
}

// Disconnect
export function disconnect(): void {
    const existingClient = client;
    void (async () => {
        if (existingClient !== null) {
            await unregisterRemoteNotificationsBeforeDisconnect(existingClient);
            existingClient.disconnect();
        } else {
            clearBridgeRemotePushRegistration();
        }
        client = null;
        getBridgeConnectionState().reset();
        getBridgeSessionState().reset();
        // Kal\u0131c\u0131 kimlik bilgilerini de temizle: QR'\u0131 tekrar taramak gerekecek.
        await clearCredentials();
    })();
}

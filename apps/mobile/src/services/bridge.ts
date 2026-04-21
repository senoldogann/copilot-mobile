// Bridge service — combines WebSocket client and message dispatcher
// All bridge communication goes through this module

import type {
    AgentMode,
    PermissionLevel,
    QRPayload,
    SessionConfig,
    ClientMessage,
    SessionMessageAttachment,
} from "@copilot-mobile/shared";
import { createWSClient } from "./ws-client";
import type { ConnectionState, ResumeOptions } from "./ws-client";
import { handleServerMessage } from "./message-handler";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import {
    dispatchWorkspaceDiffResponse,
    dispatchWorkspaceFileResponse,
    dispatchWorkspaceResolveResponse,
    onWorkspaceDiffResponse,
    onWorkspaceFileResponse,
    onWorkspaceResolveResponse,
} from "./workspace-events";
import {
    clearCredentials,
    loadCredentials,
    saveCredentials,
} from "./credentials";

export { onWorkspaceFileResponse, onWorkspaceDiffResponse, onWorkspaceResolveResponse };

let client: ReturnType<typeof createWSClient> | null = null;
const STALE_DIRECT_CREDENTIAL_GRACE_MS = 3_000;

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
                        void saveCredentials({
                            deviceCredential: message.payload.deviceCredential,
                            serverUrl: persistableConnection.serverUrl,
                            certFingerprint: persistableConnection.certFingerprint,
                            deviceId: message.payload.deviceId,
                            transportMode: persistableConnection.transportMode,
                            relayAccessToken: persistableConnection.relayAccessToken,
                        });
                    }
                }

                const sessionStore = useSessionStore.getState();
                const activeSessionId = sessionStore.activeSessionId;

                if (message.type === "permission.request") {
                    if (message.payload.sessionId !== activeSessionId) {
                        // Not the active session — auto-deny
                        void nextClient.sendMessage("permission.respond", {
                            requestId: message.payload.requestId,
                            approved: false,
                        });
                        return;
                    }

                    const { permissionLevel, autoApproveReads } = sessionStore;
                    const kind = message.payload.kind;
                    const shouldAutoApprove =
                        permissionLevel === "bypass"
                        || permissionLevel === "autopilot"
                        || (autoApproveReads && kind === "read");

                    if (shouldAutoApprove) {
                        void nextClient.sendMessage("permission.respond", {
                            requestId: message.payload.requestId,
                            approved: true,
                        });
                        return;
                    }
                }

                if (
                    message.type === "user_input.request"
                    && message.payload.sessionId !== activeSessionId
                ) {
                    void nextClient.sendMessage("user_input.respond", {
                        requestId: message.payload.requestId,
                        value: "",
                    });
                    return;
                }

                handleServerMessage(message);
                if (message.type === "session.history") {
                    nextClient.flushPending();
                }
            },
            onStateChange: (state: ConnectionState) => {
                useConnectionStore.getState().setState(state);
                if (state !== "authenticated") {
                    return;
                }

                const activeSessionId = useSessionStore.getState().activeSessionId;
                const resolvedClient = client ?? nextClient;
                if (activeSessionId !== null) {
                    useSessionStore.getState().setSessionLoading(true);
                    void resolvedClient.sendMessage("session.resume", { sessionId: activeSessionId });
                    return;
                }

                resolvedClient.flushPending();
            },
            onError: (error: string) => {
                useConnectionStore.getState().setError(error);
            },
        });
        client = nextClient;
    }
    return client;
}

// Connect with QR code
export function connectWithQR(qrPayload: QRPayload): void {
    const c = getClient();
    const connStore = useConnectionStore.getState();
    connStore.setError(null);
    connStore.setServerInfo(qrPayload.url, qrPayload.certFingerprint);
    c.connectWithQR(qrPayload);
}

// Create new session
export async function createSession(config: SessionConfig): Promise<void> {
    const c = getClient();
    useConnectionStore.getState().setError(null);
    try {
        await c.sendMessage("session.create", { config });
    } catch (error) {
        useSessionStore.getState().setSessionLoading(false);
        useConnectionStore.getState().setError(
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
        useSessionStore.getState().setAssistantTyping(false);
        useConnectionStore.getState().setError(
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
    const sessionStore = useSessionStore.getState();
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
    const sessionStore = useSessionStore.getState();
    sessionStore.setAssistantTyping(true);
    await sendMessageWithoutLocalEcho(sessionId, content, attachments);
}

export async function syncSessionPreferences(sessionId: string): Promise<void> {
    const c = getClient();
    const sessionStore = useSessionStore.getState();

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
        useConnectionStore.getState().setError(
            `Failed to restore session behavior: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Abort message — best-effort, swallows send failures
export async function abortMessage(sessionId: string): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("message.abort", { sessionId });
    } catch {
        // Connection dropped; abort is moot without a live session
    }
}

// Respond to permission request
export async function respondPermission(requestId: string, approved: boolean): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("permission.respond", { requestId, approved });
        useSessionStore.getState().resolvePermissionPrompt(requestId);
    } catch {
        useConnectionStore.getState().setError("Failed to send permission response");
    }
}

// Respond to user input request
export async function respondUserInput(requestId: string, value: string): Promise<void> {
    const c = getClient();
    const sessionStore = useSessionStore.getState();
    sessionStore.setUserInputPrompt(null);
    try {
        await c.sendMessage("user_input.respond", { requestId, value });
    } catch {
        useConnectionStore.getState().setError("Failed to send input response");
    }
}

export async function updateSettings(settings: { autoApproveReads: boolean }): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("settings.update", settings);
    } catch {
        useConnectionStore.getState().setError("Failed to update settings");
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
        useConnectionStore.getState().setError("Failed to update agent mode");
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
        useConnectionStore.getState().setError("Failed to update permission level");
    }
}

// List sessions — best-effort query, swallows send failures on disconnect
export async function listSessions(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("session.list", {});
    } catch {
        // Connection dropped before response; will retry on reconnect
    }
}

// Delete session
export async function deleteSession(sessionId: string): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("session.delete", { sessionId });
    } catch {
        useConnectionStore.getState().setError("Failed to delete session");
    }
}

// Resume session
export async function resumeSession(sessionId: string): Promise<void> {
    const c = getClient();
    useConnectionStore.getState().setError(null);
    try {
        await c.sendMessage("session.resume", { sessionId });
    } catch {
        useConnectionStore.getState().setError("Failed to resume session");
    }
}

// List models — best-effort query, swallows send failures on disconnect
export async function listModels(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("models.request", {});
    } catch {
        // Connection dropped before response; will retry on reconnect
    }
}

// Request current capabilities state from bridge — best-effort query
export async function requestCapabilities(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("capabilities.request", {});
    } catch {
        // Connection dropped before response; will retry on reconnect
    }
}

// Request list of installed agent skills from bridge
export async function requestSkillsList(): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("skills.list.request", {});
    } catch {
        // Connection dropped before response; will retry on reconnect
    }
}

// Workspace tree — requests a repository subtree for the active session
export async function requestWorkspaceTree(
    sessionId: string,
    workspaceRelativePath?: string,
    maxDepth?: number
): Promise<void> {
    const c = getClient();
    const workspaceStore = useWorkspaceStore.getState();
    workspaceStore.setTreeLoading(workspaceRelativePath ?? "__root__", true);
    try {
        await c.sendMessage("workspace.tree.request", {
            sessionId,
            ...(workspaceRelativePath !== undefined ? { workspaceRelativePath } : {}),
            ...(maxDepth !== undefined ? { maxDepth } : {}),
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
    const c = getClient();
    const workspaceStore = useWorkspaceStore.getState();
    workspaceStore.setGitLoading(true);
    try {
        await c.sendMessage("workspace.git.request", {
            sessionId,
            ...(commitLimit !== undefined ? { commitLimit } : {}),
        });
    } catch (error) {
        workspaceStore.setGitLoading(false);
        workspaceStore.setError(
            `Failed to request workspace changes: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Workspace pull — triggers repository pull if backend supports it
export async function pullWorkspace(sessionId: string): Promise<void> {
    const c = getClient();
    const workspaceStore = useWorkspaceStore.getState();
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

// Workspace push — triggers repository push if backend supports it
export async function pushWorkspace(sessionId: string): Promise<void> {
    const c = getClient();
    const workspaceStore = useWorkspaceStore.getState();
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
    const workspaceStore = useWorkspaceStore.getState();
    workspaceStore.setBranchSwitching(true);
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
    const creds = await loadCredentials();
    if (creds === null) {
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
    const connStore = useConnectionStore.getState();
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
            const currentConnection = useConnectionStore.getState();
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
    workspaceRelativePath: string
): Promise<void> {
    const c = getClient();
    try {
        await c.sendMessage("workspace.diff.request", {
            sessionId,
            workspaceRelativePath,
        });
    } catch (error) {
        dispatchWorkspaceDiffResponse(sessionId, workspaceRelativePath, {
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

// Disconnect
export function disconnect(): void {
    if (client !== null) {
        client.disconnect();
        client = null;
    }
    useConnectionStore.getState().reset();
    useSessionStore.getState().reset();
    // Kal\u0131c\u0131 kimlik bilgilerini de temizle: QR'\u0131 tekrar taramak gerekecek.
    void clearCredentials();
}

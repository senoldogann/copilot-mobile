// Session Manager — manages Copilot sessions and converts them to WS messages

import type {
    AdaptedCopilotClient,
    AdaptedCopilotSession,
    AdaptedPermissionRequest,
    AdaptedPlanExitRequest,
    AdaptedSessionState,
    AdaptedToolStartDetails,
    AdaptedUserInputRequest,
    AgentMode,
    PermissionLevel,
    RuntimeMode,
    SessionConfig,
    ServerMessage,
    HostSessionCapabilities,
    CapabilitiesStatePayload,
    PlanExitRequestPayload,
    SessionMessageAttachment,
    SessionHistoryItem,
    SessionInfo,
} from "@copilot-mobile/shared";
import { MAX_SESSIONS, PERMISSION_TIMEOUT_MS, SDKError } from "@copilot-mobile/shared";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";
import {
    buildWorkspaceGitSummary,
    buildWorkspaceTree,
    performWorkspaceGitOperation,
    readWorkspaceFile,
} from "../utils/workspace.js";

type SendFn = (message: ServerMessage) => void;
type PendingPermission = {
    payload: ServerMessage & { type: "permission.request" };
    onTimeout: () => void;
    resolve: (approved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
};
type PendingInput = {
    payload: ServerMessage & { type: "user_input.request" };
    onTimeout: () => void;
    resolve: (value: string) => void;
    timer: ReturnType<typeof setTimeout>;
};

type SessionBehaviorState = {
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    runtimeMode: RuntimeMode;
};

export function createSessionManager(
    copilotClient: AdaptedCopilotClient,
    send: SendFn
) {
    const activeSessions = new Map<string, AdaptedCopilotSession>();
    const pendingPermissions = new Map<string, PendingPermission>();
    const pendingInputs = new Map<string, PendingInput>();
    const sessionStates = new Map<string, SessionBehaviorState>();
    let autoApproveReads = false;
    // Latest observed host session capabilities — merged per session.
    // Currently holds the value for the single active session model.
    let lastHostCapabilities: HostSessionCapabilities = { elicitation: false };

    function makeBase() {
        return { id: generateMessageId(), timestamp: nowMs(), seq: nextSeq() };
    }

    function getSessionInfo(sessionId: string): SessionInfo | undefined {
        return activeSessions.get(sessionId)?.getInfo();
    }

    function getSessionContext(sessionId: string): SessionInfo["context"] | undefined {
        return getSessionInfo(sessionId)?.context;
    }

    function sendWorkspaceError(code: string, message: string, retry: boolean): void {
        send({
            ...makeBase(),
            type: "error",
            payload: {
                code,
                message,
                retry,
            },
        });
    }

    function buildCapabilitiesPayload(): CapabilitiesStatePayload {
        return {
            host: { ...lastHostCapabilities },
            bridge: {
                autoApproveReads,
                readApprovalsConfigurable: true,
            },
        };
    }

    function emitCapabilitiesState(): void {
        send({
            ...makeBase(),
            type: "capabilities.state",
            payload: buildCapabilitiesPayload(),
        });
    }

    function getSessionState(sessionId: string): SessionBehaviorState | undefined {
        return sessionStates.get(sessionId);
    }

    function emitSessionState(sessionId: string): void {
        const state = getSessionState(sessionId);
        if (state === undefined) {
            return;
        }

        send({
            ...makeBase(),
            type: "session.state",
            payload: {
                sessionId,
                agentMode: state.agentMode,
                permissionLevel: state.permissionLevel,
                runtimeMode: state.runtimeMode,
            },
        });
    }

    function adaptSessionState(nextState: AdaptedSessionState): SessionBehaviorState {
        return {
            agentMode: nextState.agentMode,
            permissionLevel: nextState.permissionLevel,
            runtimeMode: nextState.runtimeMode,
        };
    }

    function createPermissionTimeout(
        requestId: string,
        resolve: (approved: boolean) => void
    ): () => void {
        return () => {
            pendingPermissions.delete(requestId);
            send({
                ...makeBase(),
                type: "error",
                payload: {
                    code: "PERMISSION_TIMEOUT",
                    message: `Permission request ${requestId} timed out`,
                    requestId,
                    retry: false,
                },
            });
            resolve(false);
        };
    }

    function createInputTimeout(
        requestId: string,
        resolve: (value: string) => void
    ): () => void {
        return () => {
            pendingInputs.delete(requestId);
            send({
                ...makeBase(),
                type: "error",
                payload: {
                    code: "INPUT_TIMEOUT",
                    message: `User input request ${requestId} timed out`,
                    requestId,
                    retry: false,
                },
            });
            resolve("");
        };
    }

    function replayPendingPrompts(sessionId?: string): void {
        for (const pending of pendingPermissions.values()) {
            if (sessionId !== undefined && pending.payload.payload.sessionId !== sessionId) {
                continue;
            }
            clearTimeout(pending.timer);
            pending.timer = setTimeout(pending.onTimeout, PERMISSION_TIMEOUT_MS);
            send(pending.payload);
        }
        for (const pending of pendingInputs.values()) {
            if (sessionId !== undefined && pending.payload.payload.sessionId !== sessionId) {
                continue;
            }
            clearTimeout(pending.timer);
            pending.timer = setTimeout(pending.onTimeout, PERMISSION_TIMEOUT_MS);
            send(pending.payload);
        }
    }

    function discardPendingPrompts(sessionId?: string): void {
        for (const [requestId, pending] of pendingPermissions) {
            if (sessionId !== undefined && pending.payload.payload.sessionId !== sessionId) {
                continue;
            }
            clearTimeout(pending.timer);
            pending.resolve(false);
            pendingPermissions.delete(requestId);
        }

        for (const [requestId, pending] of pendingInputs) {
            if (sessionId !== undefined && pending.payload.payload.sessionId !== sessionId) {
                continue;
            }
            clearTimeout(pending.timer);
            pending.resolve("");
            pendingInputs.delete(requestId);
        }
    }

    function wireSessionEvents(session: AdaptedCopilotSession, emit: SendFn = send): void {
        const sessionId = session.id;
        const toolNamesByRequestId = new Map<string, string>();
        const resolveState = (): SessionBehaviorState =>
            sessionStates.get(sessionId) ?? {
                agentMode: "agent",
                permissionLevel: "default",
                runtimeMode: "interactive",
            };

        session.onMessage((content: string) => {
            emit({
                ...makeBase(),
                type: "assistant.message",
                payload: { sessionId, content },
            });
        });

        session.onDelta((delta: string, index: number) => {
            emit({
                ...makeBase(),
                type: "assistant.message_delta",
                payload: { sessionId, delta, index },
            });
        });

        session.onReasoning((content: string) => {
            emit({
                ...makeBase(),
                type: "assistant.reasoning",
                payload: { sessionId, content },
            });
        });

        session.onReasoningDelta((delta: string, index: number) => {
            emit({
                ...makeBase(),
                type: "assistant.reasoning_delta",
                payload: { sessionId, delta, index },
            });
        });

        session.onToolStart((toolName: string, requestId: string, details: AdaptedToolStartDetails | undefined) => {
            const normalizedToolName = toolName.trim().length > 0 ? toolName : "tool";
            toolNamesByRequestId.set(requestId, normalizedToolName);

            emit({
                ...makeBase(),
                type: "tool.execution_start",
                payload: {
                    sessionId,
                    toolName: normalizedToolName,
                    requestId,
                    ...(details?.arguments !== undefined ? { arguments: details.arguments } : {}),
                },
            });
        });

        session.onToolPartialResult((requestId: string, partialOutput: string) => {
            emit({
                ...makeBase(),
                type: "tool.execution_partial_result",
                payload: { sessionId, requestId, partialOutput },
            });
        });

        session.onToolProgress((requestId: string, progressMessage: string) => {
            emit({
                ...makeBase(),
                type: "tool.execution_progress",
                payload: { sessionId, requestId, progressMessage },
            });
        });

        session.onToolComplete((toolName: string, requestId: string, success: boolean) => {
            const normalizedToolName =
                toolNamesByRequestId.get(requestId)
                ?? (toolName.trim().length > 0 ? toolName : "tool");

            toolNamesByRequestId.delete(requestId);

            emit({
                ...makeBase(),
                type: "tool.execution_complete",
                payload: { sessionId, toolName: normalizedToolName, requestId, success },
            });
        });

        session.onPermissionRequest(async (request: AdaptedPermissionRequest) => {
            const requestId = request.id;
            const state = resolveState();

            if (
                state.permissionLevel === "bypass"
                || state.permissionLevel === "autopilot"
                || (autoApproveReads && request.kind === "read")
            ) {
                return true;
            }

            const promptMessage: ServerMessage & { type: "permission.request" } = {
                ...makeBase(),
                type: "permission.request",
                payload: {
                    sessionId,
                    requestId,
                    kind: request.kind,
                    metadata: request.metadata,
                    ...(request.toolName !== undefined ? { toolName: request.toolName } : {}),
                    ...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
                    ...(request.commandText !== undefined ? { fullCommandText: request.commandText } : {}),
                },
            };

            emit(promptMessage);

            // Wait for mobile response, with timeout
            return new Promise<boolean>((resolve) => {
                const onTimeout = createPermissionTimeout(requestId, resolve);
                const timer = setTimeout(onTimeout, PERMISSION_TIMEOUT_MS);

                pendingPermissions.set(requestId, { payload: promptMessage, onTimeout, resolve, timer });
            });
        });

        session.onUserInputRequest(async (request: AdaptedUserInputRequest) => {
            const state = resolveState();
            if (state.permissionLevel === "autopilot") {
                const fallbackAnswer = request.choices?.[0] ?? "";
                return fallbackAnswer;
            }

            const requestId = generateMessageId();

            const promptMessage: ServerMessage & { type: "user_input.request" } = {
                ...makeBase(),
                type: "user_input.request",
                payload: {
                    sessionId,
                    requestId,
                    prompt: request.question,
                    ...(request.choices !== undefined ? { choices: request.choices } : {}),
                    ...(request.allowFreeform !== undefined ? { allowFreeform: request.allowFreeform } : {}),
                },
            };

            emit(promptMessage);

            return new Promise<string>((resolve) => {
                const onTimeout = createInputTimeout(requestId, resolve);
                const timer = setTimeout(onTimeout, PERMISSION_TIMEOUT_MS);

                pendingInputs.set(requestId, { payload: promptMessage, onTimeout, resolve, timer });
            });
        });

        session.onRuntimeModeChanged((runtimeMode: RuntimeMode) => {
            const previous = resolveState();
            sessionStates.set(sessionId, {
                ...previous,
                runtimeMode,
            });
            emitSessionState(sessionId);
        });

        session.onPlanExitRequest((request: AdaptedPlanExitRequest) => {
            const payload: PlanExitRequestPayload = {
                sessionId,
                requestId: request.requestId,
                summary: request.summary,
                planContent: request.planContent,
                actions: request.actions,
                recommendedAction: request.recommendedAction,
            };

            emit({
                ...makeBase(),
                type: "plan.exit.request",
                payload,
            });
        });

        session.onIdle(() => {
            emit({
                ...makeBase(),
                type: "session.idle",
                payload: { sessionId },
            });
        });

        session.onSessionError((errorType: string, message: string) => {
            emit({
                ...makeBase(),
                type: "session.error",
                payload: { sessionId, errorType, message },
            });
        });

        session.onTitleChanged((title: string) => {
            emit({
                ...makeBase(),
                type: "session.title_changed",
                payload: { sessionId, title },
            });
        });

        session.onIntent((intent: string) => {
            emit({
                ...makeBase(),
                type: "assistant.intent",
                payload: { sessionId, intent },
            });
        });
    }

    return {
        async createSession(config: SessionConfig): Promise<void> {
            if (activeSessions.size >= MAX_SESSIONS) {
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "MAX_SESSIONS",
                        message: `Maximum ${MAX_SESSIONS} concurrent sessions allowed`,
                        retry: false,
                    },
                });
                return;
            }

            try {
                const session = await copilotClient.createSession(config);
                activeSessions.set(session.id, session);
                sessionStates.set(session.id, {
                    agentMode: config.agentMode,
                    permissionLevel: config.permissionLevel,
                    runtimeMode: config.agentMode === "plan"
                        ? "plan"
                        : config.permissionLevel === "autopilot"
                            ? "autopilot"
                            : "interactive",
                });
                wireSessionEvents(session);

                lastHostCapabilities = session.getCapabilities();

                send({
                    ...makeBase(),
                    type: "session.created",
                    payload: { session: session.getInfo() },
                });

                emitCapabilitiesState();
                emitSessionState(session.id);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session creation failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        async resumeSession(sessionId: string): Promise<void> {
            try {
                const previousSession = activeSessions.get(sessionId);
                const session = await copilotClient.resumeSession(sessionId);
                activeSessions.set(session.id, session);

                if (previousSession !== undefined && previousSession !== session) {
                    previousSession.unsubscribeAll();
                }

                // Eski dinleyicileri temizle ve yeniden bağla — reconnect sonrası duplikasyonu engeller
                session.unsubscribeAll();

                const deferredMessages: Array<ServerMessage> = [];
                let shouldDefer = true;
                wireSessionEvents(session, (message) => {
                    if (shouldDefer) {
                        deferredMessages.push(message);
                        return;
                    }

                    send(message);
                });

                let history: ReadonlyArray<SessionHistoryItem>;
                try {
                    history = await session.getHistory();
                } catch (error) {
                    shouldDefer = false;
                    session.unsubscribeAll();
                    wireSessionEvents(session);
                    discardPendingPrompts(session.id);
                    for (const deferredMessage of deferredMessages) {
                        if (
                            deferredMessage.type === "permission.request"
                            || deferredMessage.type === "user_input.request"
                        ) {
                            continue;
                        }
                        send(deferredMessage);
                    }
                    throw error;
                }

                shouldDefer = false;

                lastHostCapabilities = session.getCapabilities();
                const resumedState = await session.getState(
                    sessionStates.get(session.id)?.permissionLevel ?? "default"
                );
                sessionStates.set(session.id, adaptSessionState(resumedState));

                send({
                    ...makeBase(),
                    type: "session.resumed",
                    payload: { session: session.getInfo() },
                });

                send({
                    ...makeBase(),
                    type: "session.history",
                    payload: {
                        sessionId: session.id,
                        items: history,
                    },
                });

                replayPendingPrompts(session.id);

                for (const message of deferredMessages) {
                    if (
                        message.type === "permission.request"
                        || message.type === "user_input.request"
                    ) {
                        continue;
                    }
                    send(message);
                }

                emitCapabilitiesState();
                emitSessionState(session.id);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session resume failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        async listSessions(): Promise<void> {
            try {
                const sessions = await copilotClient.listSessions();
                send({
                    ...makeBase(),
                    type: "session.list",
                    payload: { sessions },
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session list failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        async deleteSession(sessionId: string): Promise<void> {
            const session = activeSessions.get(sessionId);
            if (session !== undefined) {
                session.close();
                activeSessions.delete(sessionId);
            }
            sessionStates.delete(sessionId);
            try {
                await copilotClient.deleteSession(sessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session delete failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: false,
                    },
                });
            }
        },

        async sendMessage(
            sessionId: string,
            content: string,
            attachments?: ReadonlyArray<SessionMessageAttachment>
        ): Promise<void> {
            const session = activeSessions.get(sessionId);
            if (session === undefined) {
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SESSION_NOT_FOUND",
                        message: `Session ${sessionId} not found`,
                        retry: false,
                    },
                });
                return;
            }

            try {
                await session.send(
                    attachments !== undefined && attachments.length > 0
                        ? { prompt: content, attachments }
                        : { prompt: content }
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : "Message send failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        abortMessage(sessionId: string): void {
            const session = activeSessions.get(sessionId);
            if (session !== undefined) {
                session.abort();
            }
        },

        respondToPermission(requestId: string, approved: boolean): void {
            const pending = pendingPermissions.get(requestId);
            if (pending === undefined) return;

            clearTimeout(pending.timer);
            pendingPermissions.delete(requestId);
            pending.resolve(approved);
        },

        respondToUserInput(requestId: string, value: string): void {
            const pending = pendingInputs.get(requestId);
            if (pending === undefined) return;

            clearTimeout(pending.timer);
            pendingInputs.delete(requestId);
            pending.resolve(value);
        },

        async listModels(): Promise<void> {
            try {
                const models = await copilotClient.listModels();
                send({
                    ...makeBase(),
                    type: "models.list",
                    payload: { models },
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Model list failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        getSessionInfo(sessionId: string): SessionInfo | undefined {
            return getSessionInfo(sessionId);
        },

        getSessionContext(sessionId: string): SessionInfo["context"] | undefined {
            return getSessionContext(sessionId);
        },

        async listWorkspaceTree(
            sessionId: string,
            requestedPath = ".",
            maxDepth = 3
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const tree = await buildWorkspaceTree(context.cwd, requestedPath, maxDepth);
                send({
                    ...makeBase(),
                    type: "workspace.tree",
                    payload: {
                        sessionId,
                        context,
                        rootPath: tree.rootPath,
                        requestedPath: tree.requestedPath,
                        tree: tree.tree,
                        truncated: tree.truncated,
                    },
                });
            } catch (error) {
                sendWorkspaceError(
                    "WORKSPACE_TREE_FAILED",
                    error instanceof Error ? error.message : "Workspace tree lookup failed",
                    false
                );
            }
        },

        async listWorkspaceGitSummary(
            sessionId: string,
            commitLimit = 10
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const summary = await buildWorkspaceGitSummary(context, commitLimit);
                send({
                    ...makeBase(),
                    type: "workspace.git.summary",
                    payload: {
                        sessionId,
                        context,
                        rootPath: summary.rootPath,
                        gitRoot: summary.gitRoot,
                        ...(summary.repository !== undefined ? { repository: summary.repository } : {}),
                        ...(summary.branch !== undefined ? { branch: summary.branch } : {}),
                        uncommittedChanges: summary.uncommittedChanges,
                        recentCommits: summary.recentCommits,
                        truncated: summary.truncated,
                    },
                });
            } catch (error) {
                sendWorkspaceError(
                    "WORKSPACE_GIT_FAILED",
                    error instanceof Error ? error.message : "Workspace git summary failed",
                    false
                );
            }
        },

        async pullWorkspace(sessionId: string): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const result = await performWorkspaceGitOperation(context, "pull");
                send({
                    ...makeBase(),
                    type: "workspace.pull.result",
                    payload: {
                        sessionId,
                        context,
                        operation: "pull",
                        success: result.success,
                        ...(result.stdout.length > 0 ? { stdout: result.stdout.trim() } : {}),
                        ...(result.stderr.length > 0 ? { stderr: result.stderr.trim() } : {}),
                        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
                        ...(result.signal !== undefined ? { signal: result.signal } : {}),
                        ...(result.message !== undefined ? { message: result.message } : {}),
                    },
                });
            } catch (error) {
                send({
                    ...makeBase(),
                    type: "workspace.pull.result",
                    payload: {
                        sessionId,
                        context,
                        operation: "pull",
                        success: false,
                        message: error instanceof Error ? error.message : "Workspace pull failed",
                    },
                });
            }
        },

        async pushWorkspace(sessionId: string): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const result = await performWorkspaceGitOperation(context, "push");
                send({
                    ...makeBase(),
                    type: "workspace.push.result",
                    payload: {
                        sessionId,
                        context,
                        operation: "push",
                        success: result.success,
                        ...(result.stdout.length > 0 ? { stdout: result.stdout.trim() } : {}),
                        ...(result.stderr.length > 0 ? { stderr: result.stderr.trim() } : {}),
                        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
                        ...(result.signal !== undefined ? { signal: result.signal } : {}),
                        ...(result.message !== undefined ? { message: result.message } : {}),
                    },
                });
            } catch (error) {
                send({
                    ...makeBase(),
                    type: "workspace.push.result",
                    payload: {
                        sessionId,
                        context,
                        operation: "push",
                        success: false,
                        message: error instanceof Error ? error.message : "Workspace push failed",
                    },
                });
            }
        },

        async readWorkspaceFile(
            sessionId: string,
            requestedPath: string,
            maxBytes?: number
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                send({
                    ...makeBase(),
                    type: "workspace.file.response",
                    payload: {
                        sessionId,
                        path: requestedPath,
                        content: "",
                        mimeType: "text/plain",
                        truncated: false,
                        error: "SESSION_NOT_FOUND",
                    },
                });
                return;
            }

            const result = await readWorkspaceFile(context, requestedPath, maxBytes);
            send({
                ...makeBase(),
                type: "workspace.file.response",
                payload: {
                    sessionId,
                    path: requestedPath,
                    content: result.content,
                    mimeType: result.mimeType,
                    truncated: result.truncated,
                    ...(result.error !== undefined ? { error: result.error } : {}),
                },
            });
        },

        async updateSessionMode(sessionId: string, agentMode: AgentMode): Promise<void> {
            const session = activeSessions.get(sessionId);
            const currentState = sessionStates.get(sessionId);

            if (session === undefined || currentState === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const nextState = await session.applyState({
                    ...currentState,
                    agentMode,
                });
                sessionStates.set(sessionId, adaptSessionState(nextState));
                emitSessionState(sessionId);
            } catch (error) {
                sendWorkspaceError(
                    "SESSION_MODE_UPDATE_FAILED",
                    error instanceof Error ? error.message : "Session mode update failed",
                    false
                );
            }
        },

        async updatePermissionLevel(sessionId: string, permissionLevel: PermissionLevel): Promise<void> {
            const session = activeSessions.get(sessionId);
            const currentState = sessionStates.get(sessionId);

            if (session === undefined || currentState === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const nextState = await session.applyState({
                    ...currentState,
                    permissionLevel,
                });
                sessionStates.set(sessionId, adaptSessionState(nextState));
                emitSessionState(sessionId);
            } catch (error) {
                sendWorkspaceError(
                    "PERMISSION_LEVEL_UPDATE_FAILED",
                    error instanceof Error ? error.message : "Permission level update failed",
                    false
                );
            }
        },

        updateSettings(nextSettings: { autoApproveReads: boolean }): void {
            autoApproveReads = nextSettings.autoApproveReads;
            emitCapabilitiesState();
        },

        emitCapabilitiesState(): void {
            emitCapabilitiesState();
        },

        replayPendingPrompts(sessionId?: string): void {
            replayPendingPrompts(sessionId);
        },

        discardPendingPrompts(): void {
            discardPendingPrompts();
        },

        cleanupOnDisconnect(): void {
            // Geçici bağlantı kopmalarında pending prompt'ları koru.
        },

        async shutdown(): Promise<void> {
            for (const pending of pendingPermissions.values()) {
                clearTimeout(pending.timer);
                pending.resolve(false);
            }
            pendingPermissions.clear();
            for (const pending of pendingInputs.values()) {
                clearTimeout(pending.timer);
                pending.resolve("");
            }
            pendingInputs.clear();
            for (const [, session] of activeSessions) {
                session.close();
            }
            activeSessions.clear();
            sessionStates.clear();
            await copilotClient.shutdown();
        },
    };
}

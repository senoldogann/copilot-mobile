// Session Manager — manages Copilot sessions and converts them to WS messages

import type {
    AdaptedCopilotClient,
    AdaptedCopilotSession,
    AdaptedToolCompletionDetails,
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
    SessionUsagePayload,
    ToolExecutionStatus,
} from "@copilot-mobile/shared";
import { MAX_SESSIONS, PERMISSION_TIMEOUT_MS, PROTOCOL_VERSION, SDKError } from "@copilot-mobile/shared";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";
import {
    buildWorkspaceGitSummary,
    buildWorkspaceTree,
    performWorkspaceGitOperation,
    readWorkspaceDiff,
    readWorkspaceFile,
    resolveWorkspaceReference as resolveWorkspaceReferenceInContext,
    resolveWorkspaceRoot,
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
    // True while the SDK is actively processing a turn. Tracked here (not in the SDK
    // state) so that reconnecting clients can see "agent is working" after restart.
    busy: boolean;
};

function readToolTelemetryCount(toolTelemetry: Record<string, unknown> | undefined): number | null {
    if (toolTelemetry === undefined) {
        return null;
    }

    const directCount = toolTelemetry["matchCount"];
    if (typeof directCount === "number" && Number.isFinite(directCount)) {
        return directCount;
    }

    const nestedCount = toolTelemetry["matches"];
    if (typeof nestedCount === "number" && Number.isFinite(nestedCount)) {
        return nestedCount;
    }

    return null;
}

function isSearchLikeToolName(toolName: string): boolean {
    const normalized = toolName.trim().toLowerCase();
    return normalized.includes("rg")
        || normalized.includes("grep")
        || normalized.includes("search")
        || normalized.includes("find")
        || normalized.includes("glob");
}

function normalizeToolCompletionStatus(
    toolName: string,
    success: boolean,
    details: AdaptedToolCompletionDetails | undefined
): Exclude<ToolExecutionStatus, "running"> {
    if (success) {
        return "completed";
    }

    const exitCode = details?.exitCode;
    const matchCount = readToolTelemetryCount(details?.toolTelemetry);
    const errorMessage = details?.errorMessage?.toLowerCase() ?? "";

    if (
        isSearchLikeToolName(toolName)
        && (
            exitCode === 1
            || matchCount === 0
            || errorMessage.includes("no matches")
            || errorMessage.includes("0 results")
            || errorMessage.includes("not found")
        )
    ) {
        return "no_results";
    }

    return "failed";
}

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
        return { id: generateMessageId(), timestamp: nowMs(), seq: nextSeq(), protocolVersion: PROTOCOL_VERSION };
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
                busy: state.busy,
            },
        });
    }

    function setSessionBusy(sessionId: string, busy: boolean): void {
        const state = sessionStates.get(sessionId);
        if (state === undefined || state.busy === busy) {
            return;
        }
        state.busy = busy;
        emitSessionState(sessionId);
    }

    function adaptSessionState(
        nextState: AdaptedSessionState,
        sessionId?: string
    ): SessionBehaviorState {
        const existingBusy = sessionId !== undefined
            ? (sessionStates.get(sessionId)?.busy ?? false)
            : false;
        return {
            agentMode: nextState.agentMode,
            permissionLevel: nextState.permissionLevel,
            runtimeMode: nextState.runtimeMode,
            busy: existingBusy,
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
                busy: false,
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

        session.onToolComplete((
            toolName: string,
            requestId: string,
            success: boolean,
            details?: AdaptedToolCompletionDetails
        ) => {
            const normalizedToolName =
                toolNamesByRequestId.get(requestId)
                ?? (toolName.trim().length > 0 ? toolName : "tool");
            const completionStatus = normalizeToolCompletionStatus(
                normalizedToolName,
                success,
                details
            );

            toolNamesByRequestId.delete(requestId);

            // If the tool has result content (e.g. file read output) and no
            // partial output was streamed, forward it as a partial result so
            // the mobile app can display it in the tool detail panel.
            const resultContent = details?.resultContent;
            if (resultContent !== undefined && resultContent.trim().length > 0) {
                emit({
                    ...makeBase(),
                    type: "tool.execution_partial_result",
                    payload: { sessionId, requestId, partialOutput: resultContent },
                });
            }

            emit({
                ...makeBase(),
                type: "tool.execution_complete",
                payload: {
                    sessionId,
                    toolName: normalizedToolName,
                    requestId,
                    success,
                    completionStatus,
                    ...(details?.errorMessage !== undefined ? { errorMessage: details.errorMessage } : {}),
                    ...(details?.exitCode !== undefined ? { exitCode: details.exitCode } : {}),
                    ...(details?.toolTelemetry !== undefined ? { toolTelemetry: details.toolTelemetry } : {}),
                },
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
            setSessionBusy(sessionId, false);
            emit({
                ...makeBase(),
                type: "session.idle",
                payload: { sessionId },
            });
        });

        session.onSessionError((errorType: string, message: string) => {
            setSessionBusy(sessionId, false);
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

        session.onUsage((usage: { tokenLimit: number; currentTokens: number; systemTokens?: number; conversationTokens?: number; toolDefinitionsTokens?: number; messagesLength?: number }) => {
            const payload: SessionUsagePayload = {
                sessionId,
                tokenLimit: usage.tokenLimit,
                currentTokens: usage.currentTokens,
                ...(usage.systemTokens !== undefined ? { systemTokens: usage.systemTokens } : {}),
                ...(usage.conversationTokens !== undefined
                    ? { conversationTokens: usage.conversationTokens }
                    : {}),
                ...(usage.toolDefinitionsTokens !== undefined
                    ? { toolDefinitionsTokens: usage.toolDefinitionsTokens }
                    : {}),
                ...(usage.messagesLength !== undefined ? { messagesLength: usage.messagesLength } : {}),
            };
            emit({
                ...makeBase(),
                type: "session.usage",
                payload,
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
                    busy: false,
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
                sessionStates.set(session.id, adaptSessionState(resumedState, session.id));

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
                setSessionBusy(sessionId, true);
                await session.send(
                    attachments !== undefined && attachments.length > 0
                        ? { prompt: content, attachments }
                        : { prompt: content }
                );
            } catch (err) {
                setSessionBusy(sessionId, false);
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
            setSessionBusy(sessionId, false);
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

        async listSkills(): Promise<void> {
            const os = await import("os");
            const fs = await import("fs/promises");
            const path = await import("path");
            const skillsDir = path.join(os.homedir(), ".agents", "skills");
            try {
                const entries = await fs.readdir(skillsDir, { withFileTypes: true });
                const skills: Array<{ name: string; description: string }> = [];
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
                    let description = "";
                    try {
                        const content = await fs.readFile(skillMdPath, "utf-8");
                        // İlk başlıktan sonraki ilk anlamlı satırı açıklama olarak al.
                        const lines = content.split("\n");
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed.length > 0 && !trimmed.startsWith("#")) {
                                description = trimmed.slice(0, 120);
                                break;
                            }
                        }
                    } catch {
                        // SKILL.md yoksa boş açıklama bırak.
                    }
                    skills.push({ name: entry.name, description });
                }
                send({
                    ...makeBase(),
                    type: "skills.list.response",
                    payload: { skills },
                });
            } catch {
                send({
                    ...makeBase(),
                    type: "skills.list.response",
                    payload: { skills: [] },
                });
            }
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
            requestedWorkspaceRelativePath = ".",
            maxDepth = 3
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                sendWorkspaceError("SESSION_NOT_FOUND", `Session ${sessionId} not found`, false);
                return;
            }

            try {
                const tree = await buildWorkspaceTree(
                    resolveWorkspaceRoot(context),
                    requestedWorkspaceRelativePath,
                    maxDepth
                );
                send({
                    ...makeBase(),
                    type: "workspace.tree",
                    payload: {
                        sessionId,
                        context,
                        workspaceRoot: tree.workspaceRoot,
                        requestedWorkspaceRelativePath: tree.requestedWorkspaceRelativePath,
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
                        workspaceRoot: summary.workspaceRoot,
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
            workspaceRelativePath: string,
            maxBytes?: number
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                send({
                    ...makeBase(),
                    type: "workspace.file.response",
                    payload: {
                        sessionId,
                        workspaceRelativePath,
                        content: "",
                        mimeType: "text/plain",
                        truncated: false,
                        error: "SESSION_NOT_FOUND",
                    },
                });
                return;
            }

            const result = await readWorkspaceFile(context, workspaceRelativePath, maxBytes);
            send({
                ...makeBase(),
                type: "workspace.file.response",
                payload: {
                    sessionId,
                    workspaceRelativePath,
                    content: result.content,
                    mimeType: result.mimeType,
                    truncated: result.truncated,
                    ...(result.error !== undefined ? { error: result.error } : {}),
                },
            });
        },

        async readWorkspaceDiff(
            sessionId: string,
            workspaceRelativePath: string
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                send({
                    ...makeBase(),
                    type: "workspace.diff.response",
                    payload: {
                        sessionId,
                        workspaceRelativePath,
                        diff: "",
                        error: "SESSION_NOT_FOUND",
                    },
                });
                return;
            }

            const result = await readWorkspaceDiff(context, workspaceRelativePath);
            send({
                ...makeBase(),
                type: "workspace.diff.response",
                payload: {
                    sessionId,
                    workspaceRelativePath,
                    diff: result.diff,
                    ...(result.error !== undefined ? { error: result.error } : {}),
                },
            });
        },

        async resolveWorkspaceReference(
            sessionId: string,
            rawPath: string
        ): Promise<void> {
            const context = getSessionContext(sessionId);
            if (context === undefined) {
                send({
                    ...makeBase(),
                    type: "workspace.resolve.response",
                    payload: {
                        sessionId,
                        rawPath,
                        error: "SESSION_NOT_FOUND",
                    },
                });
                return;
            }

            const result = await resolveWorkspaceReferenceInContext(context, rawPath);
            send({
                ...makeBase(),
                type: "workspace.resolve.response",
                payload: {
                    sessionId,
                    rawPath,
                    ...(result.workspaceRelativePath !== undefined
                        ? { resolvedWorkspaceRelativePath: result.workspaceRelativePath }
                        : {}),
                    ...(result.matches !== undefined ? { matches: result.matches } : {}),
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
                sessionStates.set(sessionId, adaptSessionState(nextState, sessionId));
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
                sessionStates.set(sessionId, adaptSessionState(nextState, sessionId));
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

        // Reconnect sonras\u0131 mobilin UI'\u0131n\u0131 tazelemek i\u00e7in: capabilities.state + her aktif
        // session i\u00e7in session.state + bekleyen permission/user_input promptlar\u0131n\u0131 yeniden yay\u0131mla.
        resyncStateAfterReconnect(): void {
            emitCapabilitiesState();
            for (const sessionId of activeSessions.keys()) {
                emitSessionState(sessionId);
            }
            replayPendingPrompts();
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

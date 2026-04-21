// Copilot Mobile Bridge — Protocol Type Definitions
// Type safety ensured via discriminated union pattern

// --- Base Types ---

export type BaseBridgeMessage = {
    id: string;
    timestamp: number;
    seq: number;
    protocolVersion: number;
};

// --- Session Settings ---

export type ReasoningEffortLevel = "low" | "medium" | "high" | "xhigh";

export type AgentMode = "agent" | "plan" | "ask";

export type PermissionLevel = "default" | "bypass" | "autopilot";

export type RuntimeMode = "interactive" | "plan" | "autopilot";

export type SessionConfig = {
    model: string;
    // Some models don't support reasoning effort at all — hence optional.
    reasoningEffort?: ReasoningEffortLevel;
    streaming: boolean;
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
};

export type SessionMessageAttachment = {
    type: "blob";
    data: string;
    mimeType: string;
    displayName?: string;
};

export type SessionMessageInput = {
    prompt: string;
    attachments?: ReadonlyArray<SessionMessageAttachment>;
};

export type ToolArguments = Record<string, unknown>;

export type SessionContext = {
    cwd: string;
    gitRoot?: string | undefined;
    repository?: string | undefined;
    branch?: string | undefined;
};

export type WorkspaceTreeNode = {
    name: string;
    path: string;
    type: "file" | "directory" | "symlink";
    size?: number | undefined;
    modifiedAt?: number | undefined;
    children?: ReadonlyArray<WorkspaceTreeNode> | undefined;
};

export type GitFileChange = {
    path: string;
    status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "conflicted"
    | "type_changed"
    | "unknown";
    indexStatus: string;
    worktreeStatus: string;
    originalPath?: string | undefined;
    additions?: number | undefined;
    deletions?: number | undefined;
};

export type GitCommitSummary = {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    committedAt: number;
    files: ReadonlyArray<string>;
};

export type WorkspaceOperation = "pull" | "push";

export type SessionInfo = {
    id: string;
    model: string;
    createdAt: number;
    lastActiveAt: number;
    status: "active" | "idle" | "closed";
    summary?: string;
    title?: string;
    context?: SessionContext;
};

export type WorkspaceTreeRequestMessage = BaseBridgeMessage & {
    type: "workspace.tree.request";
    payload: {
        sessionId: string;
        path?: string;
        maxDepth?: number;
    };
};

export type WorkspaceTreeMessage = BaseBridgeMessage & {
    type: "workspace.tree";
    payload: {
        sessionId: string;
        context: SessionContext;
        rootPath: string;
        requestedPath: string;
        tree: WorkspaceTreeNode;
        truncated: boolean;
    };
};

export type WorkspaceGitSummaryRequestMessage = BaseBridgeMessage & {
    type: "workspace.git.request";
    payload: {
        sessionId: string;
        commitLimit?: number;
    };
};

export type WorkspaceGitSummaryMessage = BaseBridgeMessage & {
    type: "workspace.git.summary";
    payload: {
        sessionId: string;
        context: SessionContext;
        rootPath: string;
        gitRoot: string | null;
        repository?: string;
        branch?: string;
        uncommittedChanges: ReadonlyArray<GitFileChange>;
        recentCommits: ReadonlyArray<GitCommitSummary>;
        truncated: boolean;
    };
};

export type WorkspaceOperationRequestMessage = BaseBridgeMessage & {
    type: "workspace.pull" | "workspace.push";
    payload: {
        sessionId: string;
    };
};

export type WorkspaceFileRequestMessage = BaseBridgeMessage & {
    type: "workspace.file.request";
    payload: {
        sessionId: string;
        path: string;
        maxBytes?: number;
    };
};

export type WorkspaceFileResponseMessage = BaseBridgeMessage & {
    type: "workspace.file.response";
    payload: {
        sessionId: string;
        path: string;
        content: string;
        mimeType: string;
        truncated: boolean;
        error?: string;
    };
};

export type WorkspaceDiffRequestMessage = BaseBridgeMessage & {
    type: "workspace.diff.request";
    payload: {
        sessionId: string;
        path: string;
    };
};

export type WorkspaceDiffResponseMessage = BaseBridgeMessage & {
    type: "workspace.diff.response";
    payload: {
        sessionId: string;
        path: string;
        diff: string;
        error?: string;
    };
};

export type WorkspaceOperationResultPayload = {
    sessionId: string;
    context: SessionContext;
    operation: WorkspaceOperation;
    success: boolean;
    stdout?: string | undefined;
    stderr?: string | undefined;
    exitCode?: number | undefined;
    signal?: string | null | undefined;
    message?: string | undefined;
};

export type WorkspacePullResultMessage = BaseBridgeMessage & {
    type: "workspace.pull.result";
    payload: WorkspaceOperationResultPayload & { operation: "pull" };
};

export type WorkspacePushResultMessage = BaseBridgeMessage & {
    type: "workspace.push.result";
    payload: WorkspaceOperationResultPayload & { operation: "push" };
};

export type SessionHistoryItem =
    | {
        id: string;
        timestamp: number;
        type: "user";
        content: string;
        attachments?: ReadonlyArray<SessionMessageAttachment>;
    }
    | {
        id: string;
        timestamp: number;
        type: "assistant";
        content: string;
    }
    | {
        id: string;
        timestamp: number;
        type: "thinking";
        content: string;
    }
    | {
        id: string;
        timestamp: number;
        type: "tool";
        toolName: string;
        requestId: string;
        status: "running" | "completed" | "failed";
        argumentsText?: string;
        progressMessage?: string;
        partialOutput?: string;
    };

// --- Permission Types ---

export type PermissionKind =
    | "shell"
    | "write"
    | "read"
    | "mcp"
    | "custom-tool"
    | "url"
    | "memory"
    | "hook";

export type PermissionRequestPayload = {
    sessionId: string;
    requestId: string;
    kind: PermissionKind;
    toolName?: string;
    fileName?: string;
    fullCommandText?: string;
    metadata: Record<string, unknown>;
};

export type PermissionResponsePayload = {
    requestId: string;
    approved: boolean;
};

// --- Model Info ---

export type ModelPolicyState = "enabled" | "disabled" | "unconfigured";

export type ModelInfo = {
    id: string;
    name: string;
    provider: string;
    // Host policy status — UI lists/restricts models based on this.
    policyState?: ModelPolicyState;
    // Billing multiplier (e.g. 1.0, 0.33). Undefined if unknown.
    billingMultiplier?: number;
    // Does the model support vision?
    supportsVision?: boolean;
    // Does the model support the reasoning effort parameter?
    // If true but supportedReasoningEfforts not provided: effort levels are unknown.
    supportsReasoningEffort?: boolean;
    // Exact effort levels reported by the host. Unknown if not provided.
    supportedReasoningEfforts?: ReadonlyArray<ReasoningEffortLevel>;
    // Default effort level suggested by the host.
    defaultReasoningEffort?: ReasoningEffortLevel;
    // Model context window (tokens).
    contextWindowTokens?: number;
};

// --- Skill Info ---

export type SkillInfo = {
    name: string;
    description: string;
};

// --- Host + Bridge Capability State ---

export type HostSessionCapabilities = {
    // Does the host support interactive elicitation dialogs?
    elicitation: boolean;
};

export type BridgeSettings = {
    autoApproveReads: boolean;
    readApprovalsConfigurable: boolean;
};

export type CapabilitiesStatePayload = {
    host: HostSessionCapabilities;
    bridge: BridgeSettings;
};

export type SessionStatePayload = {
    sessionId: string;
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    runtimeMode: RuntimeMode;
};

export type UserInputRequestPayload = {
    sessionId: string;
    requestId: string;
    prompt: string;
    choices?: ReadonlyArray<string>;
    allowFreeform?: boolean;
};

export type PlanExitRequestPayload = {
    sessionId: string;
    requestId: string;
    summary: string;
    planContent: string;
    actions: ReadonlyArray<string>;
    recommendedAction: string;
};

// --- Connection State ---

export type ConnectionStatusPayload = {
    cliConnected: boolean;
    uptime: number;
    activeSessionCount: number;
};

// --- Error Types ---

export type ErrorPayload = {
    code: string;
    message: string;
    requestId?: string;
    retry: boolean;
};

// --- Server → Client Messages (Discriminated Union) ---

export type PairingSuccessMessage = BaseBridgeMessage & {
    type: "pairing.success";
    payload: { jwt: string; deviceId: string; certFingerprint: string | null };
};

export type SessionCreatedMessage = BaseBridgeMessage & {
    type: "session.created";
    payload: { session: SessionInfo };
};

export type SessionResumedMessage = BaseBridgeMessage & {
    type: "session.resumed";
    payload: { session: SessionInfo };
};

export type SessionIdleMessage = BaseBridgeMessage & {
    type: "session.idle";
    payload: { sessionId: string };
};

export type SessionListMessage = BaseBridgeMessage & {
    type: "session.list";
    payload: { sessions: ReadonlyArray<SessionInfo> };
};

export type SessionHistoryMessage = BaseBridgeMessage & {
    type: "session.history";
    payload: { sessionId: string; items: ReadonlyArray<SessionHistoryItem> };
};

export type AssistantMessageMessage = BaseBridgeMessage & {
    type: "assistant.message";
    payload: { sessionId: string; content: string };
};

export type AssistantMessageDeltaMessage = BaseBridgeMessage & {
    type: "assistant.message_delta";
    payload: { sessionId: string; delta: string; index: number };
};

export type AssistantReasoningMessage = BaseBridgeMessage & {
    type: "assistant.reasoning";
    payload: { sessionId: string; content: string };
};

export type AssistantReasoningDeltaMessage = BaseBridgeMessage & {
    type: "assistant.reasoning_delta";
    payload: { sessionId: string; delta: string; index: number };
};

export type ToolExecutionStartMessage = BaseBridgeMessage & {
    type: "tool.execution_start";
    payload: {
        sessionId: string;
        toolName: string;
        requestId: string;
        arguments?: ToolArguments;
    };
};

export type ToolExecutionPartialResultMessage = BaseBridgeMessage & {
    type: "tool.execution_partial_result";
    payload: { sessionId: string; requestId: string; partialOutput: string };
};

export type ToolExecutionProgressMessage = BaseBridgeMessage & {
    type: "tool.execution_progress";
    payload: { sessionId: string; requestId: string; progressMessage: string };
};

export type ToolExecutionCompleteMessage = BaseBridgeMessage & {
    type: "tool.execution_complete";
    payload: { sessionId: string; toolName: string; requestId: string; success: boolean };
};

export type PermissionRequestMessage = BaseBridgeMessage & {
    type: "permission.request";
    payload: PermissionRequestPayload;
};

export type UserInputRequestMessage = BaseBridgeMessage & {
    type: "user_input.request";
    payload: UserInputRequestPayload;
};

export type ModelsListMessage = BaseBridgeMessage & {
    type: "models.list";
    payload: { models: ReadonlyArray<ModelInfo> };
};

export type ErrorMessage = BaseBridgeMessage & {
    type: "error";
    payload: ErrorPayload;
};

export type ConnectionStatusMessage = BaseBridgeMessage & {
    type: "connection.status";
    payload: ConnectionStatusPayload;
};

export type TokenRefreshMessage = BaseBridgeMessage & {
    type: "token.refresh";
    payload: { jwt: string };
};

export type ReconnectReadyMessage = BaseBridgeMessage & {
    type: "reconnect.ready";
    payload: Record<string, never>;
};

export type CapabilitiesStateMessage = BaseBridgeMessage & {
    type: "capabilities.state";
    payload: CapabilitiesStatePayload;
};

export type SessionStateMessage = BaseBridgeMessage & {
    type: "session.state";
    payload: SessionStatePayload;
};

export type SessionErrorMessage = BaseBridgeMessage & {
    type: "session.error";
    payload: { sessionId: string; errorType: string; message: string };
};

export type SessionTitleChangedMessage = BaseBridgeMessage & {
    type: "session.title_changed";
    payload: { sessionId: string; title: string };
};

export type AssistantIntentMessage = BaseBridgeMessage & {
    type: "assistant.intent";
    payload: { sessionId: string; intent: string };
};

export type PlanExitRequestMessage = BaseBridgeMessage & {
    type: "plan.exit.request";
    payload: PlanExitRequestPayload;
};

export type ServerMessage =
    | PairingSuccessMessage
    | SessionCreatedMessage
    | SessionResumedMessage
    | SessionIdleMessage
    | SessionListMessage
    | SessionHistoryMessage
    | AssistantMessageMessage
    | AssistantMessageDeltaMessage
    | AssistantReasoningMessage
    | AssistantReasoningDeltaMessage
    | ToolExecutionStartMessage
    | ToolExecutionPartialResultMessage
    | ToolExecutionProgressMessage
    | ToolExecutionCompleteMessage
    | PermissionRequestMessage
    | UserInputRequestMessage
    | ModelsListMessage
    | ErrorMessage
    | ConnectionStatusMessage
    | TokenRefreshMessage
    | ReconnectReadyMessage
    | CapabilitiesStateMessage
    | SessionStateMessage
    | SessionErrorMessage
    | SessionTitleChangedMessage
    | AssistantIntentMessage
    | PlanExitRequestMessage
    | WorkspaceTreeMessage
    | WorkspaceGitSummaryMessage
    | WorkspacePullResultMessage
    | WorkspacePushResultMessage
    | WorkspaceFileResponseMessage
    | WorkspaceDiffResponseMessage
    | SkillsListResponseMessage;

// --- Client → Server Messages (Discriminated Union) ---

export type AuthPairMessage = BaseBridgeMessage & {
    type: "auth.pair";
    payload: { pairingToken: string };
};

export type SessionCreateMessage = BaseBridgeMessage & {
    type: "session.create";
    payload: { config: SessionConfig };
};

export type SessionResumeMessage = BaseBridgeMessage & {
    type: "session.resume";
    payload: { sessionId: string };
};

export type SessionListRequestMessage = BaseBridgeMessage & {
    type: "session.list";
    payload: Record<string, never>;
};

export type SessionDeleteMessage = BaseBridgeMessage & {
    type: "session.delete";
    payload: { sessionId: string };
};

export type MessageSendMessage = BaseBridgeMessage & {
    type: "message.send";
    payload: {
        sessionId: string;
        content: string;
        attachments?: ReadonlyArray<SessionMessageAttachment>;
    };
};

export type MessageAbortMessage = BaseBridgeMessage & {
    type: "message.abort";
    payload: { sessionId: string };
};

export type PermissionRespondMessage = BaseBridgeMessage & {
    type: "permission.respond";
    payload: PermissionResponsePayload;
};

export type UserInputRespondMessage = BaseBridgeMessage & {
    type: "user_input.respond";
    payload: { requestId: string; value: string };
};

export type SettingsUpdateMessage = BaseBridgeMessage & {
    type: "settings.update";
    payload: { autoApproveReads: boolean };
};

export type SessionModeUpdateMessage = BaseBridgeMessage & {
    type: "session.mode.update";
    payload: {
        sessionId: string;
        agentMode: AgentMode;
    };
};

export type PermissionLevelUpdateMessage = BaseBridgeMessage & {
    type: "permission.level.update";
    payload: {
        sessionId: string;
        permissionLevel: PermissionLevel;
    };
};

export type ModelsRequestMessage = BaseBridgeMessage & {
    type: "models.request";
    payload: Record<string, never>;
};

export type ReconnectMessage = BaseBridgeMessage & {
    type: "reconnect";
    payload: { lastSeenSeq: number };
};

export type CapabilitiesRequestMessage = BaseBridgeMessage & {
    type: "capabilities.request";
    payload: Record<string, never>;
};

export type SkillsListRequestMessage = BaseBridgeMessage & {
    type: "skills.list.request";
    payload: Record<string, never>;
};

export type SkillsListResponseMessage = BaseBridgeMessage & {
    type: "skills.list.response";
    payload: { skills: ReadonlyArray<SkillInfo> };
};

export type ClientMessage =
    | AuthPairMessage
    | SessionCreateMessage
    | SessionResumeMessage
    | SessionListRequestMessage
    | SessionDeleteMessage
    | MessageSendMessage
    | MessageAbortMessage
    | PermissionRespondMessage
    | UserInputRespondMessage
    | SettingsUpdateMessage
    | SessionModeUpdateMessage
    | PermissionLevelUpdateMessage
    | ModelsRequestMessage
    | ReconnectMessage
    | CapabilitiesRequestMessage
    | SkillsListRequestMessage
    | WorkspaceTreeRequestMessage
    | WorkspaceGitSummaryRequestMessage
    | WorkspaceOperationRequestMessage
    | WorkspaceFileRequestMessage
    | WorkspaceDiffRequestMessage;

// --- QR Code Content ---

export type QRPayload = {
    url: string;
    token: string;
    certFingerprint: string | null;
    version: number;
};

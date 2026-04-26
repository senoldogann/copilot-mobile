import type {
    SessionConfig,
    AgentMode,
    PermissionLevel,
    RuntimeMode,
    PermissionKind,
    ModelInfo,
    SessionInfo,
    SessionHistoryItem,
    HostSessionCapabilities,
    SessionMessageInput,
    ToolArguments,
} from "./protocol";

export type AdaptedPermissionRequest = {
    id: string;
    kind: PermissionKind;
    toolName?: string;
    fileName?: string;
    commandText?: string;
    metadata: Record<string, unknown>;
};

export type AdaptedToolStartDetails = {
    arguments?: ToolArguments;
};

export type AdaptedToolCompletionDetails = {
    resultContent?: string;
    errorMessage?: string;
    exitCode?: number;
    toolTelemetry?: Record<string, unknown>;
};

export type AdaptedUserInputRequest = {
    question: string;
    choices?: ReadonlyArray<string>;
    allowFreeform?: boolean;
};

export type AdaptedSessionState = {
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    runtimeMode: RuntimeMode;
};

export type AdaptedPlanExitRequest = {
    requestId: string;
    summary: string;
    planContent: string;
    actions: ReadonlyArray<string>;
    recommendedAction: string;
};

export type AdaptedCopilotSession = {
    id: string;
    title: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
};

export type AdaptedSessionLifecycleEventType =
    | "session.created"
    | "session.deleted"
    | "session.updated"
    | "session.foreground"
    | "session.background";

export type AdaptedSessionLifecycleEvent = {
    type: AdaptedSessionLifecycleEventType;
    sessionId: string;
    metadata?: {
        startTime: string;
        modifiedTime: string;
        summary?: string;
    };
};

export type AdaptedCopilotClient = {
    createSession(config?: SessionConfig): Promise<AdaptedCopilotSession>;
    listSessions(): Promise<ReadonlyArray<SessionInfo>>;
    getSessionHistory(sessionId: string): Promise<ReadonlyArray<SessionHistoryItem>>;
    sendMessage(
        sessionId: string,
        input: SessionMessageInput
    ): AsyncIterableIterator<unknown>;
    abortSession(sessionId: string): Promise<void>;
    approvePermission(
        sessionId: string,
        requestId: string,
        payload?: Record<string, unknown>
    ): Promise<void>;
    denyPermission(sessionId: string, requestId: string, reason?: string): Promise<void>;
    answerUserInput(
        sessionId: string,
        requestId: string,
        payload: string | { choice: string } | { freeform: string }
    ): Promise<void>;
    setPermissionLevel?(sessionId: string, level: PermissionLevel): Promise<void>;
    setSessionMode?(sessionId: string, mode: AgentMode): Promise<void>;
    getModels?(): Promise<ReadonlyArray<ModelInfo>>;
    getCapabilities?(): Promise<HostSessionCapabilities>;
    getAvailabilityStatus?(): Promise<{ available: boolean; detail: string }>;
    onSessionLifecycle?(handler: (event: AdaptedSessionLifecycleEvent) => void): () => void;
};

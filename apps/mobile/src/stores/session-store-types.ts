import type { StoredSessionPreferences } from "../services/credentials";
import type {
    AgentMode,
    PermissionLevel,
    RuntimeMode,
    SessionInfo,
    ModelInfo,
    SkillInfo,
    ReasoningEffortLevel,
    HostSessionCapabilities,
    BridgeSettings,
    SessionMessageAttachment,
    SessionUsagePayload,
} from "@copilot-mobile/shared";

type ChatItemBase = {
    id: string;
    timestamp: number;
};

export type UserMessageItem = ChatItemBase & {
    type: "user";
    content: string;
    attachments?: ReadonlyArray<SessionMessageAttachment>;
    deliveryState: "pending" | "sent" | "failed";
};

export type AssistantMessageItem = ChatItemBase & {
    type: "assistant";
    content: string;
    isStreaming: boolean;
};

export type ThinkingItem = ChatItemBase & {
    type: "thinking";
    content: string;
    isStreaming: boolean;
};

export type ToolItem = ChatItemBase & {
    type: "tool";
    toolName: string;
    requestId: string;
    status: "running" | "completed" | "failed" | "no_results";
    argumentsText?: string;
    progressMessage?: string;
    progressMessages?: ReadonlyArray<string>;
    partialOutput?: string;
    errorMessage?: string;
};

export type TodoItemStatus = "pending" | "in_progress" | "completed";

export type AgentTodo = {
    id: string;
    content: string;
    status: TodoItemStatus;
    priority?: "high" | "medium" | "low";
};

export type ChatItem = UserMessageItem | AssistantMessageItem | ThinkingItem | ToolItem;

export type PermissionPrompt = {
    sessionId: string;
    requestId: string;
    kind: string;
    toolName: string | null;
    fileName: string | null;
    commandText: string | null;
    details: ReadonlyArray<string>;
};

export type UserInputPrompt = {
    sessionId: string;
    requestId: string;
    prompt: string;
    choices?: ReadonlyArray<string>;
    allowFreeform?: boolean;
};

export type PlanExitPrompt = {
    sessionId: string;
    requestId: string;
    summary: string;
    planContent: string;
    actions: ReadonlyArray<string>;
    recommendedAction: string;
};

export type SessionUsage = {
    tokenLimit: number;
    currentTokens: number;
    systemTokens?: number;
    conversationTokens?: number;
    toolDefinitionsTokens?: number;
    messagesLength?: number;
};

export type SessionStore = {
    activeSessionId: string | null;
    isSessionLoading: boolean;
    sessions: ReadonlyArray<SessionInfo>;
    models: ReadonlyArray<ModelInfo>;
    skills: ReadonlyArray<SkillInfo>;
    selectedModel: string;
    reasoningEffort: ReasoningEffortLevel | null;
    autoApproveReads: boolean;
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    runtimeMode: RuntimeMode;
    hostCapabilities: HostSessionCapabilities;
    bridgeSettings: BridgeSettings;
    chatItems: ReadonlyArray<ChatItem>;
    isAssistantTyping: boolean;
    isAbortRequested: boolean;
    currentIntent: string | null;
    agentTodos: ReadonlyArray<AgentTodo>;
    permissionPrompt: PermissionPrompt | null;
    permissionPromptQueue: ReadonlyArray<PermissionPrompt>;
    deferredPermissionPrompts: Readonly<Record<string, ReadonlyArray<PermissionPrompt>>>;
    userInputPrompt: UserInputPrompt | null;
    deferredUserInputPrompts: Readonly<Record<string, ReadonlyArray<UserInputPrompt>>>;
    planExitPrompt: PlanExitPrompt | null;
    deferredPlanExitPrompts: Readonly<Record<string, PlanExitPrompt>>;
    sessionUsage: Readonly<Record<string, SessionUsage>>;
    setActiveSession: (sessionId: string | null) => void;
    setSessionLoading: (loading: boolean) => void;
    setSessions: (sessions: ReadonlyArray<SessionInfo>) => void;
    upsertSession: (session: SessionInfo) => void;
    removeSession: (sessionId: string) => void;
    setModels: (models: ReadonlyArray<ModelInfo>) => void;
    setSkills: (skills: ReadonlyArray<SkillInfo>) => void;
    setSelectedModel: (model: string) => void;
    setReasoningEffort: (effort: ReasoningEffortLevel | null) => void;
    setAutoApproveReads: (enabled: boolean) => void;
    setAgentMode: (mode: AgentMode) => void;
    setPermissionLevel: (level: PermissionLevel) => void;
    setRuntimeMode: (mode: RuntimeMode) => void;
    syncRemoteSessionState: (state: {
        agentMode: AgentMode;
        permissionLevel: PermissionLevel;
        runtimeMode: RuntimeMode;
    }) => void;
    setHostCapabilities: (caps: HostSessionCapabilities) => void;
    setBridgeSettings: (settings: BridgeSettings) => void;
    addUserMessage: (
        content: string,
        attachments?: ReadonlyArray<SessionMessageAttachment>
    ) => string;
    updateUserMessageDeliveryState: (
        itemId: string,
        deliveryState: UserMessageItem["deliveryState"]
    ) => void;
    appendAssistantDelta: (delta: string, index: number) => void;
    finalizeAssistantMessage: (content: string) => void;
    setAssistantTyping: (typing: boolean) => void;
    setAbortRequested: (requested: boolean) => void;
    appendThinkingDelta: (delta: string, index: number) => void;
    finalizeThinking: (content?: string) => void;
    addToolStart: (
        requestId: string,
        toolName: string,
        argumentsText?: string
    ) => void;
    updateToolProgress: (requestId: string, progressMessage: string) => void;
    appendToolPartialOutput: (requestId: string, partialOutput: string) => void;
    updateToolStatus: (
        requestId: string,
        status: "completed" | "failed" | "no_results",
        errorMessage?: string
    ) => void;
    setCurrentIntent: (intent: string | null) => void;
    setAgentTodos: (todos: ReadonlyArray<AgentTodo>) => void;
    receivePermissionPrompt: (prompt: PermissionPrompt) => void;
    enqueuePermissionPrompt: (prompt: PermissionPrompt) => void;
    resolvePermissionPrompt: (requestId: string) => void;
    clearPermissionPrompts: () => void;
    receiveUserInputPrompt: (prompt: UserInputPrompt) => void;
    resolveUserInputPrompt: (requestId: string) => void;
    receivePlanExitPrompt: (prompt: PlanExitPrompt) => void;
    deferActivePrompts: () => void;
    clearSessionPrompts: (sessionId: string) => void;
    setUserInputPrompt: (prompt: UserInputPrompt | null) => void;
    setPlanExitPrompt: (prompt: PlanExitPrompt | null) => void;
    setSessionUsage: (payload: SessionUsagePayload) => void;
    clearSessionUsage: (sessionId: string) => void;
    hydratePreferences: (preferences: StoredSessionPreferences) => void;
    replaceChatItems: (items: ReadonlyArray<ChatItem>) => void;
    clearChatItems: () => void;
    reset: () => void;
};

// SDK Adapter interfaces
// All access goes through this adapter since @github/copilot-sdk is in preview
// If the SDK API changes, only the adapter implementation needs updating

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
} from "./protocol.js";

// Adapter representation of a permission request from the SDK
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

// Session handle — represents a Copilot session
export type AdaptedCopilotSession = {
    readonly id: string;
    send(message: SessionMessageInput): Promise<void>;
    abort(): void;
    onMessage(handler: (content: string) => void): void;
    onDelta(handler: (delta: string, index: number) => void): void;
    onReasoning(handler: (content: string) => void): void;
    onReasoningDelta(handler: (delta: string, index: number) => void): void;
    onPermissionRequest(
        handler: (request: AdaptedPermissionRequest) => Promise<boolean>
    ): void;
    onUserInputRequest(
        handler: (request: AdaptedUserInputRequest) => Promise<string>
    ): void;
    onToolStart(
        handler: (
            toolName: string,
            requestId: string,
            details?: AdaptedToolStartDetails
        ) => void
    ): void;
    onToolPartialResult(handler: (requestId: string, partialOutput: string) => void): void;
    onToolProgress(handler: (requestId: string, progressMessage: string) => void): void;
    onToolComplete(
        handler: (
            toolName: string,
            requestId: string,
            success: boolean,
            details?: AdaptedToolCompletionDetails
        ) => void
    ): void;
    onIdle(handler: () => void): void;
    onSessionError(handler: (errorType: string, message: string) => void): void;
    onTitleChanged(handler: (title: string) => void): void;
    onIntent(handler: (intent: string) => void): void;
    onUsage(
        handler: (usage: {
            tokenLimit: number;
            currentTokens: number;
            systemTokens?: number;
            conversationTokens?: number;
            toolDefinitionsTokens?: number;
            messagesLength?: number;
        }) => void
    ): void;
    onRuntimeModeChanged(handler: (runtimeMode: RuntimeMode) => void): void;
    onPlanExitRequest(handler: (request: AdaptedPlanExitRequest) => void): void;
    getHistory(): Promise<ReadonlyArray<SessionHistoryItem>>;
    // Tüm event listener'ları temizle — reconnect'te eski dinleyicileri kaldırmak için
    unsubscribeAll(): void;
    close(): void;
    getInfo(): SessionInfo;
    // Session capabilities reported by the host. Read after create/resume.
    getCapabilities(): HostSessionCapabilities;
    applyState(state: AdaptedSessionState): Promise<AdaptedSessionState>;
    getState(permissionLevel: PermissionLevel): Promise<AdaptedSessionState>;
};

// Client — main interface managing the Copilot CLI connection
export type AdaptedCopilotClient = {
    createSession(config: SessionConfig): Promise<AdaptedCopilotSession>;
    resumeSession(sessionId: string): Promise<AdaptedCopilotSession>;
    listSessions(): Promise<ReadonlyArray<SessionInfo>>;
    deleteSession(sessionId: string): Promise<void>;
    listModels(): Promise<ReadonlyArray<ModelInfo>>;
    isAvailable(): Promise<boolean>;
    shutdown(): Promise<void>;
};

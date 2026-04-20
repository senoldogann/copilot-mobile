// SDK Adapter interfaces
// All access goes through this adapter since @github/copilot-sdk is in preview
// If the SDK API changes, only the adapter implementation needs updating

import type {
    SessionConfig,
    PermissionKind,
    ModelInfo,
    SessionInfo,
    SessionHistoryItem,
    HostSessionCapabilities,
    SessionMessageInput,
    ToolArguments,
} from "./protocol";

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
        handler: (prompt: string) => Promise<string>
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
    onToolComplete(handler: (toolName: string, requestId: string, success: boolean) => void): void;
    onIdle(handler: () => void): void;
    onSessionError(handler: (errorType: string, message: string) => void): void;
    onTitleChanged(handler: (title: string) => void): void;
    onIntent(handler: (intent: string) => void): void;
    getHistory(): Promise<ReadonlyArray<SessionHistoryItem>>;
    // Tüm event listener'ları temizle — reconnect'te eski dinleyicileri kaldırmak için
    unsubscribeAll(): void;
    close(): void;
    getInfo(): SessionInfo;
    // Session capabilities reported by the host. Read after create/resume.
    getCapabilities(): HostSessionCapabilities;
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

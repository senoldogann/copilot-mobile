// Chat and session state management — Zustand store
// Unified ChatItem timeline with thinking, tool and messages in a single stream

import { create } from "zustand";
import type {
    SessionInfo,
    ModelInfo,
    ReasoningEffortLevel,
    HostSessionCapabilities,
    BridgeSettings,
    SessionMessageAttachment,
} from "@copilot-mobile/shared";

// Chat stream item types
type ChatItemBase = {
    id: string;
    timestamp: number;
};

export type UserMessageItem = ChatItemBase & {
    type: "user";
    content: string;
    attachments?: ReadonlyArray<SessionMessageAttachment>;
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
    status: "running" | "completed" | "failed";
    argumentsText?: string;
    progressMessage?: string;
    partialOutput?: string;
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
};

export type SessionStore = {
    // Session
    activeSessionId: string | null;
    isSessionLoading: boolean;
    sessions: ReadonlyArray<SessionInfo>;
    models: ReadonlyArray<ModelInfo>;
    selectedModel: string;
    // null if model does not support reasoning effort.
    reasoningEffort: ReasoningEffortLevel | null;
    autoApproveReads: boolean;

    // Bridge + host combined capability state
    hostCapabilities: HostSessionCapabilities;
    bridgeSettings: BridgeSettings;

    // Unified chat stream (messages, thinking, tool all in one timeline)
    chatItems: ReadonlyArray<ChatItem>;
    isAssistantTyping: boolean;
    currentIntent: string | null;

    // Permission and input prompts (modal overlay)
    permissionPrompt: PermissionPrompt | null;
    userInputPrompt: UserInputPrompt | null;

    // Actions
    setActiveSession: (sessionId: string | null) => void;
    setSessionLoading: (loading: boolean) => void;
    setSessions: (sessions: ReadonlyArray<SessionInfo>) => void;
    upsertSession: (session: SessionInfo) => void;
    removeSession: (sessionId: string) => void;
    setModels: (models: ReadonlyArray<ModelInfo>) => void;
    setSelectedModel: (model: string) => void;
    setReasoningEffort: (effort: ReasoningEffortLevel | null) => void;
    setAutoApproveReads: (enabled: boolean) => void;
    setHostCapabilities: (caps: HostSessionCapabilities) => void;
    setBridgeSettings: (settings: BridgeSettings) => void;

    addUserMessage: (
        content: string,
        attachments?: ReadonlyArray<SessionMessageAttachment>
    ) => void;
    appendAssistantDelta: (delta: string) => void;
    finalizeAssistantMessage: (content: string) => void;
    setAssistantTyping: (typing: boolean) => void;

    appendThinkingDelta: (delta: string) => void;
    finalizeThinking: () => void;

    addToolStart: (
        requestId: string,
        toolName: string,
        argumentsText?: string
    ) => void;
    updateToolProgress: (requestId: string, progressMessage: string) => void;
    appendToolPartialOutput: (requestId: string, partialOutput: string) => void;
    updateToolStatus: (requestId: string, status: "completed" | "failed") => void;

    setCurrentIntent: (intent: string | null) => void;
    setPermissionPrompt: (prompt: PermissionPrompt | null) => void;
    setUserInputPrompt: (prompt: UserInputPrompt | null) => void;

    replaceChatItems: (items: ReadonlyArray<ChatItem>) => void;
    clearChatItems: () => void;
    reset: () => void;
};

let itemCounter = 0;

function createItemId(): string {
    itemCounter += 1;
    return `item-${Date.now()}-${itemCounter}`;
}

function sortSessionsByActivity(sessions: ReadonlyArray<SessionInfo>): Array<SessionInfo> {
    return [...sessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
}

// Derives available effort options for the selected model.
// Returns:
//   - options: levels the user can select (empty = hide picker)
//   - supported: does the model support effort parameter?
//   - listKnown: did the host explicitly report the level list?
export function deriveAvailableReasoningEfforts(
    model: ModelInfo | undefined
): {
    options: ReadonlyArray<ReasoningEffortLevel>;
    supported: boolean;
    listKnown: boolean;
} {
    if (model === undefined) {
        return { options: [], supported: false, listKnown: false };
    }

    if (model.supportsReasoningEffort !== true) {
        return { options: [], supported: false, listKnown: false };
    }

    const explicit = model.supportedReasoningEfforts;
    if (explicit !== undefined && explicit.length > 0) {
        return {
            options: explicit,
            supported: true,
            listKnown: true,
        };
    }

    return { options: [], supported: true, listKnown: false };
}

// When model changes, reconcile effort selection to a supported level.
// If supportedReasoningEfforts not given: use default if available, otherwise null.
function reconcileReasoningEffort(
    currentEffort: ReasoningEffortLevel | null,
    nextModel: ModelInfo | undefined
): ReasoningEffortLevel | null {
    const derived = deriveAvailableReasoningEfforts(nextModel);

    if (!derived.supported) {
        return null;
    }

    if (derived.listKnown) {
        if (
            currentEffort !== null &&
            derived.options.includes(currentEffort)
        ) {
            return currentEffort;
        }
        if (
            nextModel?.defaultReasoningEffort !== undefined &&
            derived.options.includes(nextModel.defaultReasoningEffort)
        ) {
            return nextModel.defaultReasoningEffort;
        }
        return derived.options[0] ?? null;
    }

    // Supported but level list unknown: use default if available, otherwise keep current.
    if (nextModel?.defaultReasoningEffort !== undefined) {
        return nextModel.defaultReasoningEffort;
    }
    return currentEffort;
}

export const useSessionStore = create<SessionStore>((set) => ({
    activeSessionId: null,
    isSessionLoading: false,
    sessions: [],
    models: [],
    selectedModel: "",
    reasoningEffort: null,
    autoApproveReads: false,
    hostCapabilities: { elicitation: false },
    bridgeSettings: { autoApproveReads: false, readApprovalsConfigurable: true },

    chatItems: [],
    isAssistantTyping: false,
    currentIntent: null,

    permissionPrompt: null,
    userInputPrompt: null,

    setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

    setSessionLoading: (loading) => set({ isSessionLoading: loading }),

    setSessions: (sessions) => set({ sessions: sortSessionsByActivity(sessions) }),

    upsertSession: (session) =>
        set((state) => {
            const existingIndex = state.sessions.findIndex((item) => item.id === session.id);

            if (existingIndex === -1) {
                return { sessions: sortSessionsByActivity([session, ...state.sessions]) };
            }

            const sessions = [...state.sessions];
            sessions[existingIndex] = session;
            return { sessions: sortSessionsByActivity(sessions) };
        }),

    removeSession: (sessionId) =>
        set((state) => ({
            sessions: state.sessions.filter((session) => session.id !== sessionId),
            activeSessionId:
                state.activeSessionId === sessionId ? null : state.activeSessionId,
        })),

    setModels: (models) =>
        set((state) => {
            const selectedModelExists = models.some((model) => model.id === state.selectedModel);
            const nextSelectedModelId = selectedModelExists
                ? state.selectedModel
                : models[0]?.id ?? state.selectedModel;
            const nextSelectedModel = models.find((m) => m.id === nextSelectedModelId);
            const nextEffort = reconcileReasoningEffort(state.reasoningEffort, nextSelectedModel);

            return {
                models,
                selectedModel: nextSelectedModelId,
                reasoningEffort: nextEffort,
            };
        }),

    setSelectedModel: (model) =>
        set((state) => {
            const nextModel = state.models.find((m) => m.id === model);
            const nextEffort = reconcileReasoningEffort(state.reasoningEffort, nextModel);
            return { selectedModel: model, reasoningEffort: nextEffort };
        }),

    setReasoningEffort: (effort) => set({ reasoningEffort: effort }),

    setAutoApproveReads: (enabled) => set({ autoApproveReads: enabled }),

    setHostCapabilities: (caps) => set({ hostCapabilities: caps }),

    setBridgeSettings: (settings) =>
        set({
            bridgeSettings: settings,
            autoApproveReads: settings.autoApproveReads,
        }),

    addUserMessage: (content, attachments) => {
        const item: UserMessageItem = {
            id: createItemId(),
            type: "user",
            content,
            timestamp: Date.now(),
            ...(attachments !== undefined ? { attachments } : {}),
        };
        set((s) => ({ chatItems: [...s.chatItems, item] }));
    },

    appendAssistantDelta: (delta) => {
        set((s) => {
            const items = [...s.chatItems];
            const last = items[items.length - 1];
            if (last !== undefined && last.type === "assistant" && last.isStreaming) {
                items[items.length - 1] = { ...last, content: last.content + delta };
                return { chatItems: items };
            }
            // Start new streaming assistant message
            const item: AssistantMessageItem = {
                id: createItemId(),
                type: "assistant",
                content: delta,
                timestamp: Date.now(),
                isStreaming: true,
            };
            return { chatItems: [...s.chatItems, item] };
        });
    },

    finalizeAssistantMessage: (content) => {
        set((s) => {
            const items = [...s.chatItems];
            const last = items[items.length - 1];
            if (last !== undefined && last.type === "assistant" && last.isStreaming) {
                const nextContent = content.trim().length > 0 ? content : last.content;

                if (nextContent.trim().length === 0) {
                    items.pop();
                    return { chatItems: items, isAssistantTyping: false, currentIntent: null };
                }

                items[items.length - 1] = {
                    ...last,
                    content: nextContent,
                    isStreaming: false,
                };
                return { chatItems: items, isAssistantTyping: false, currentIntent: null };
            }

            if (content.trim().length === 0) {
                return { chatItems: s.chatItems, isAssistantTyping: false, currentIntent: null };
            }

            // Full message received without streaming
            const item: AssistantMessageItem = {
                id: createItemId(),
                type: "assistant",
                content,
                timestamp: Date.now(),
                isStreaming: false,
            };
            return { chatItems: [...s.chatItems, item], isAssistantTyping: false, currentIntent: null };
        });
    },

    setAssistantTyping: (typing) => set({ isAssistantTyping: typing }),

    setCurrentIntent: (intent) => set({ currentIntent: intent }),

    appendThinkingDelta: (delta) => {
        set((s) => {
            const items = [...s.chatItems];
            const last = items[items.length - 1];
            if (last !== undefined && last.type === "thinking" && last.isStreaming) {
                items[items.length - 1] = { ...last, content: last.content + delta };
                return { chatItems: items };
            }
            // Start new thinking block
            const item: ThinkingItem = {
                id: createItemId(),
                type: "thinking",
                content: delta,
                timestamp: Date.now(),
                isStreaming: true,
            };
            return { chatItems: [...s.chatItems, item] };
        });
    },

    finalizeThinking: () => {
        set((s) => {
            const items = [...s.chatItems];
            for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                if (item !== undefined && item.type === "thinking" && item.isStreaming) {
                    items[i] = { ...item, isStreaming: false };
                    break;
                }
            }
            return { chatItems: items };
        });
    },

    addToolStart: (requestId, toolName, argumentsText) => {
        const item: ToolItem = {
            id: createItemId(),
            type: "tool",
            toolName,
            requestId,
            status: "running",
            timestamp: Date.now(),
            ...(argumentsText !== undefined ? { argumentsText } : {}),
        };
        set((s) => ({ chatItems: [...s.chatItems, item] }));
    },

    updateToolProgress: (requestId, progressMessage) => {
        set((s) => ({
            chatItems: s.chatItems.map((item) =>
                item.type === "tool" && item.requestId === requestId
                    ? { ...item, progressMessage }
                    : item
            ),
        }));
    },

    appendToolPartialOutput: (requestId, partialOutput) => {
        set((s) => ({
            chatItems: s.chatItems.map((item) =>
                item.type === "tool" && item.requestId === requestId
                    ? {
                        ...item,
                        partialOutput: (item.partialOutput ?? "") + partialOutput,
                    }
                    : item
            ),
        }));
    },

    updateToolStatus: (requestId, status) => {
        set((s) => ({
            chatItems: s.chatItems.map((item) =>
                item.type === "tool" && item.requestId === requestId
                    ? { ...item, status }
                    : item
            ),
        }));
    },

    setPermissionPrompt: (prompt) => set({ permissionPrompt: prompt }),

    setUserInputPrompt: (prompt) => set({ userInputPrompt: prompt }),

    replaceChatItems: (items) =>
        set({
            chatItems: [...items],
            isAssistantTyping: false,
            permissionPrompt: null,
            userInputPrompt: null,
        }),

    clearChatItems: () => {
        itemCounter = 0;
        set({
            chatItems: [],
            isAssistantTyping: false,
            currentIntent: null,
            permissionPrompt: null,
            userInputPrompt: null,
        });
    },

    reset: () => {
        itemCounter = 0;
        set({
            activeSessionId: null,
            isSessionLoading: false,
            sessions: [],
            models: [],
            selectedModel: "",
            reasoningEffort: null,
            autoApproveReads: false,
            hostCapabilities: { elicitation: false },
            bridgeSettings: { autoApproveReads: false, readApprovalsConfigurable: true },
            chatItems: [],
            isAssistantTyping: false,
            currentIntent: null,
            permissionPrompt: null,
            userInputPrompt: null,
        });
    },
}));

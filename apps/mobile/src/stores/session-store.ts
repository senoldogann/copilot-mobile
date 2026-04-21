// Chat and session state management — Zustand store
// Unified ChatItem timeline with thinking, tool and messages in a single stream

import { create } from "zustand";
import {
    saveActiveSessionId,
    saveSessionPreferences,
    type StoredSessionPreferences,
} from "../services/credentials";
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

// Chat stream item types
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
    // Session
    activeSessionId: string | null;
    isSessionLoading: boolean;
    sessions: ReadonlyArray<SessionInfo>;
    models: ReadonlyArray<ModelInfo>;
    skills: ReadonlyArray<SkillInfo>;
    selectedModel: string;
    // null if model does not support reasoning effort.
    reasoningEffort: ReasoningEffortLevel | null;
    autoApproveReads: boolean;
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    runtimeMode: RuntimeMode;

    // Bridge + host combined capability state
    hostCapabilities: HostSessionCapabilities;
    bridgeSettings: BridgeSettings;

    // Unified chat stream (messages, thinking, tool all in one timeline)
    chatItems: ReadonlyArray<ChatItem>;
    isAssistantTyping: boolean;
    currentIntent: string | null;

    // Agent-managed todo list (from TodoWrite tool calls)
    agentTodos: ReadonlyArray<AgentTodo>;

    // Permission and input prompts (modal overlay)
    permissionPrompt: PermissionPrompt | null;
    permissionPromptQueue: ReadonlyArray<PermissionPrompt>;
    userInputPrompt: UserInputPrompt | null;
    planExitPrompt: PlanExitPrompt | null;

    // Context usage per session (keyed by sessionId).
    sessionUsage: Readonly<Record<string, SessionUsage>>;

    // Actions
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
    enqueuePermissionPrompt: (prompt: PermissionPrompt) => void;
    resolvePermissionPrompt: (requestId: string) => void;
    clearPermissionPrompts: () => void;
    setUserInputPrompt: (prompt: UserInputPrompt | null) => void;
    setPlanExitPrompt: (prompt: PlanExitPrompt | null) => void;

    setSessionUsage: (payload: SessionUsagePayload) => void;
    clearSessionUsage: (sessionId: string) => void;

    hydratePreferences: (preferences: StoredSessionPreferences) => void;

    replaceChatItems: (items: ReadonlyArray<ChatItem>) => void;
    clearChatItems: () => void;
    reset: () => void;
};

let itemCounter = 0;

const reasoningEffortValues: ReadonlyArray<ReasoningEffortLevel> = ["low", "medium", "high", "xhigh"];

function persistSessionPreferences(state: {
    selectedModel: string;
    reasoningEffort: ReasoningEffortLevel | null;
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    autoApproveReads: boolean;
}): void {
    void saveSessionPreferences({
        selectedModel: state.selectedModel,
        reasoningEffort: state.reasoningEffort,
        agentMode: state.agentMode,
        permissionLevel: state.permissionLevel,
        autoApproveReads: state.autoApproveReads,
    }).catch((error: unknown) => {
        console.warn("Failed to persist session preferences", error);
    });
}

function createItemId(): string {
    itemCounter += 1;
    return `item-${Date.now()}-${itemCounter}`;
}

function sortSessionsByActivity(sessions: ReadonlyArray<SessionInfo>): Array<SessionInfo> {
    return [...sessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
}

function dedupeSessionsById(sessions: ReadonlyArray<SessionInfo>): Array<SessionInfo> {
    const byId = new Map<string, SessionInfo>();

    for (const session of sessions) {
        const existing = byId.get(session.id);
        if (existing === undefined || session.lastActiveAt > existing.lastActiveAt) {
            byId.set(session.id, session);
        }
    }

    return [...byId.values()];
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

    // Supported but level list unknown: use default if available, otherwise clear selection.
    if (nextModel?.defaultReasoningEffort !== undefined) {
        return nextModel.defaultReasoningEffort;
    }
    return null;
}

export const useSessionStore = create<SessionStore>((set) => ({
    activeSessionId: null,
    isSessionLoading: false,
    sessions: [],
    models: [],
    skills: [],
    selectedModel: "",
    reasoningEffort: null,
    autoApproveReads: false,
    agentMode: "agent",
    permissionLevel: "default",
    runtimeMode: "interactive",
    hostCapabilities: { elicitation: false },
    bridgeSettings: { autoApproveReads: false, readApprovalsConfigurable: true },

    chatItems: [],
    isAssistantTyping: false,
    currentIntent: null,
    agentTodos: [],

    permissionPrompt: null,
    permissionPromptQueue: [],
    userInputPrompt: null,
    planExitPrompt: null,

    sessionUsage: {},

    setActiveSession: (sessionId) => {
        void saveActiveSessionId(sessionId);
        set({ activeSessionId: sessionId });
    },

    setSessionLoading: (loading) => set({ isSessionLoading: loading }),

    setSessions: (sessions) =>
        set({ sessions: sortSessionsByActivity(dedupeSessionsById(sessions)) }),

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
        set((state) => {
            const nextActiveSessionId =
                state.activeSessionId === sessionId ? null : state.activeSessionId;
            if (nextActiveSessionId !== state.activeSessionId) {
                void saveActiveSessionId(nextActiveSessionId);
            }

            const nextUsage: Record<string, SessionUsage> = { ...state.sessionUsage };
            delete nextUsage[sessionId];

            return {
                sessions: state.sessions.filter((session) => session.id !== sessionId),
                activeSessionId: nextActiveSessionId,
                sessionUsage: nextUsage,
            };
        }),

    setModels: (models) =>
        set((state) => {
            const selectedModelExists = models.some((model) => model.id === state.selectedModel);
            const nextSelectedModelId = selectedModelExists
                ? state.selectedModel
                : models[0]?.id ?? state.selectedModel;
            const nextSelectedModel = models.find((m) => m.id === nextSelectedModelId);
            const nextEffort = reconcileReasoningEffort(state.reasoningEffort, nextSelectedModel);

            persistSessionPreferences({
                selectedModel: nextSelectedModelId,
                reasoningEffort: nextEffort,
                agentMode: state.agentMode,
                permissionLevel: state.permissionLevel,
                autoApproveReads: state.autoApproveReads,
            });

            return {
                models,
                selectedModel: nextSelectedModelId,
                reasoningEffort: nextEffort,
            };
        }),

    setSkills: (skills) => set({ skills }),

    setSelectedModel: (model) =>
        set((state) => {
            const nextModel = state.models.find((m) => m.id === model);
            const nextEffort = reconcileReasoningEffort(state.reasoningEffort, nextModel);
            persistSessionPreferences({
                selectedModel: model,
                reasoningEffort: nextEffort,
                agentMode: state.agentMode,
                permissionLevel: state.permissionLevel,
                autoApproveReads: state.autoApproveReads,
            });
            return { selectedModel: model, reasoningEffort: nextEffort };
        }),

    setReasoningEffort: (effort) =>
        set((state) => {
            persistSessionPreferences({
                selectedModel: state.selectedModel,
                reasoningEffort: effort,
                agentMode: state.agentMode,
                permissionLevel: state.permissionLevel,
                autoApproveReads: state.autoApproveReads,
            });
            return { reasoningEffort: effort };
        }),

    setAutoApproveReads: (enabled) =>
        set((state) => {
            persistSessionPreferences({
                selectedModel: state.selectedModel,
                reasoningEffort: state.reasoningEffort,
                agentMode: state.agentMode,
                permissionLevel: state.permissionLevel,
                autoApproveReads: enabled,
            });
            return { autoApproveReads: enabled };
        }),
    setAgentMode: (mode) =>
        set((state) => {
            persistSessionPreferences({
                selectedModel: state.selectedModel,
                reasoningEffort: state.reasoningEffort,
                agentMode: mode,
                permissionLevel: state.permissionLevel,
                autoApproveReads: state.autoApproveReads,
            });
            return { agentMode: mode };
        }),
    setPermissionLevel: (level) =>
        set((state) => {
            persistSessionPreferences({
                selectedModel: state.selectedModel,
                reasoningEffort: state.reasoningEffort,
                agentMode: state.agentMode,
                permissionLevel: level,
                autoApproveReads: state.autoApproveReads,
            });
            return { permissionLevel: level };
        }),
    setRuntimeMode: (mode) => set({ runtimeMode: mode }),
    syncRemoteSessionState: (nextState) =>
        set({
            agentMode: nextState.agentMode,
            permissionLevel: nextState.permissionLevel,
            runtimeMode: nextState.runtimeMode,
        }),

    setHostCapabilities: (caps) => set({ hostCapabilities: caps }),

    setBridgeSettings: (settings) =>
        set((state) => {
            persistSessionPreferences({
                selectedModel: state.selectedModel,
                reasoningEffort: state.reasoningEffort,
                agentMode: state.agentMode,
                permissionLevel: state.permissionLevel,
                autoApproveReads: settings.autoApproveReads,
            });
            return {
                bridgeSettings: settings,
                autoApproveReads: settings.autoApproveReads,
            };
        }),

    addUserMessage: (content, attachments) => {
        const item: UserMessageItem = {
            id: createItemId(),
            type: "user",
            content,
            timestamp: Date.now(),
            deliveryState: "pending",
            ...(attachments !== undefined ? { attachments } : {}),
        };
        set((s) => ({ chatItems: [...s.chatItems, item] }));
        return item.id;
    },

    updateUserMessageDeliveryState: (itemId, deliveryState) =>
        set((state) => ({
            chatItems: state.chatItems.map((item) =>
                item.type === "user" && item.id === itemId
                    ? { ...item, deliveryState }
                    : item
            ),
        })),

    appendAssistantDelta: (delta, _index) => {
        set((s) => {
            const items = [...s.chatItems];
            const last = items[items.length - 1];
            if (
                last !== undefined
                && last.type === "assistant"
                && last.isStreaming
            ) {
                items[items.length - 1] = {
                    ...last,
                    content: last.content + delta,
                    isStreaming: true,
                };
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

    setAgentTodos: (todos) => set({ agentTodos: todos }),

    appendThinkingDelta: (delta, _index) => {
        set((s) => {
            const items = [...s.chatItems];
            const last = items[items.length - 1];
            if (
                last !== undefined
                && last.type === "thinking"
                && last.isStreaming
            ) {
                items[items.length - 1] = {
                    ...last,
                    content: last.content + delta,
                    isStreaming: true,
                };
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

    finalizeThinking: (content) => {
        set((s) => {
            const items = [...s.chatItems];
            let updatedExisting = false;
            for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                if (item !== undefined && item.type === "thinking" && item.isStreaming) {
                    const nextContent = content !== undefined && content.trim().length > 0
                        ? content
                        : item.content;
                    items[i] = { ...item, content: nextContent, isStreaming: false };
                    updatedExisting = true;
                    break;
                }
            }

            if (!updatedExisting && content !== undefined && content.trim().length > 0) {
                items.push({
                    id: createItemId(),
                    type: "thinking",
                    content,
                    timestamp: Date.now(),
                    isStreaming: false,
                });
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
                    ? {
                        ...item,
                        progressMessage,
                        progressMessages: [...(item.progressMessages ?? []), progressMessage],
                    }
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

    updateToolStatus: (requestId, status, errorMessage) => {
        set((s) => ({
            chatItems: s.chatItems.map((item) =>
                item.type === "tool" && item.requestId === requestId
                    ? (() => {
                        if (errorMessage !== undefined) {
                            return {
                                ...item,
                                status,
                                errorMessage,
                            };
                        }

                        if (item.errorMessage === undefined) {
                            return {
                                ...item,
                                status,
                            };
                        }

                        const { errorMessage: _errorMessage, ...rest } = item;
                        return {
                            ...rest,
                            status,
                        };
                    })()
                    : item
            ),
        }));
    },

    enqueuePermissionPrompt: (prompt) =>
        set((state) => {
            if (state.permissionPrompt?.requestId === prompt.requestId) {
                return state;
            }

            if (state.permissionPromptQueue.some((item) => item.requestId === prompt.requestId)) {
                return state;
            }

            if (state.permissionPrompt === null) {
                return { permissionPrompt: prompt };
            }

            return {
                permissionPromptQueue: [...state.permissionPromptQueue, prompt],
            };
        }),

    resolvePermissionPrompt: (requestId) =>
        set((state) => {
            if (state.permissionPrompt?.requestId === requestId) {
                const [nextPrompt, ...restQueue] = state.permissionPromptQueue;
                return {
                    permissionPrompt: nextPrompt ?? null,
                    permissionPromptQueue: restQueue,
                };
            }

            return {
                permissionPromptQueue: state.permissionPromptQueue.filter((item) => item.requestId !== requestId),
            };
        }),

    clearPermissionPrompts: () => set({
        permissionPrompt: null,
        permissionPromptQueue: [],
    }),

    setUserInputPrompt: (prompt) => set({ userInputPrompt: prompt }),

    setPlanExitPrompt: (prompt) => set({ planExitPrompt: prompt }),

    setSessionUsage: (payload) =>
        set((state) => {
            const next: Record<string, SessionUsage> = { ...state.sessionUsage };
            const usage: SessionUsage = {
                tokenLimit: payload.tokenLimit,
                currentTokens: payload.currentTokens,
            };
            if (payload.systemTokens !== undefined) usage.systemTokens = payload.systemTokens;
            if (payload.conversationTokens !== undefined) usage.conversationTokens = payload.conversationTokens;
            if (payload.toolDefinitionsTokens !== undefined) usage.toolDefinitionsTokens = payload.toolDefinitionsTokens;
            if (payload.messagesLength !== undefined) usage.messagesLength = payload.messagesLength;
            next[payload.sessionId] = usage;
            return { sessionUsage: next };
        }),

    clearSessionUsage: (sessionId) =>
        set((state) => {
            if (state.sessionUsage[sessionId] === undefined) return state;
            const next: Record<string, SessionUsage> = { ...state.sessionUsage };
            delete next[sessionId];
            return { sessionUsage: next };
        }),

    hydratePreferences: (preferences) =>
        set((state) => {
            const nextReasoningEffort = reasoningEffortValues.includes(preferences.reasoningEffort as ReasoningEffortLevel)
                ? (preferences.reasoningEffort as ReasoningEffortLevel | null)
                : null;
            const nextAgentMode = preferences.agentMode === "ask"
                || preferences.agentMode === "plan"
                || preferences.agentMode === "agent"
                ? preferences.agentMode
                : state.agentMode;
            const nextPermissionLevel = preferences.permissionLevel === "default"
                || preferences.permissionLevel === "bypass"
                || preferences.permissionLevel === "autopilot"
                ? preferences.permissionLevel
                : state.permissionLevel;

            return {
                selectedModel: preferences.selectedModel,
                reasoningEffort: nextReasoningEffort,
                agentMode: nextAgentMode,
                permissionLevel: nextPermissionLevel,
                autoApproveReads: preferences.autoApproveReads,
            };
        }),

    replaceChatItems: (items) =>
        set({
            chatItems: [...items],
            isAssistantTyping: false,
            permissionPrompt: null,
            permissionPromptQueue: [],
            userInputPrompt: null,
            planExitPrompt: null,
        }),

    clearChatItems: () => {
        itemCounter = 0;
        set({
            chatItems: [],
            isAssistantTyping: false,
            currentIntent: null,
            agentTodos: [],
            permissionPrompt: null,
            permissionPromptQueue: [],
            userInputPrompt: null,
            planExitPrompt: null,
        });
    },

    reset: () => {
        itemCounter = 0;
        void saveActiveSessionId(null);
        set({
            activeSessionId: null,
            isSessionLoading: false,
            sessions: [],
            models: [],
            skills: [],
            selectedModel: "",
            reasoningEffort: null,
            autoApproveReads: false,
            agentMode: "agent",
            permissionLevel: "default",
            runtimeMode: "interactive",
            hostCapabilities: { elicitation: false },
            bridgeSettings: { autoApproveReads: false, readApprovalsConfigurable: true },
            chatItems: [],
            isAssistantTyping: false,
            currentIntent: null,
            agentTodos: [],
            permissionPrompt: null,
            permissionPromptQueue: [],
            userInputPrompt: null,
            planExitPrompt: null,
            sessionUsage: {},
        });
    },
}));

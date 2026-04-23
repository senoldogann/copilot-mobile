// Chat and session state management — Zustand store
// Unified ChatItem timeline with thinking, tool and messages in a single stream

import { create } from "zustand";
import type { ReasoningEffortLevel } from "@copilot-mobile/shared";
import { saveActiveSessionId } from "../services/credentials";
import type {
    AssistantMessageItem,
    PermissionPrompt,
    SessionStore,
    SessionUsage,
    ThinkingItem,
    ToolItem,
    UserInputPrompt,
    UserMessageItem,
} from "./session-store-types";
import {
    appendDeferredPrompt,
    createItemId,
    dedupeSessionsById,
    deriveAvailableReasoningEfforts,
    findLastStreamingThinkingIndex,
    insertChatItemBeforeTrailingAssistant,
    persistSessionPreferences,
    pruneDeferredPromptEntries,
    reasoningEffortValues,
    reconcileReasoningEffort,
    removeDeferredPromptByRequestId,
    sortSessionsByActivity,
} from "./session-store-helpers";

export { deriveAvailableReasoningEfforts } from "./session-store-helpers";
export type {
    AgentTodo,
    AssistantMessageItem,
    ChatItem,
    PermissionPrompt,
    PlanExitPrompt,
    SessionStore,
    SessionUsage,
    ThinkingItem,
    TodoItemStatus,
    ToolItem,
    UserInputPrompt,
    UserMessageItem,
} from "./session-store-types";

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
    isAbortRequested: false,
    currentIntent: null,
    agentTodos: [],

    permissionPrompt: null,
    permissionPromptQueue: [],
    deferredPermissionPrompts: {},
    userInputPrompt: null,
    deferredUserInputPrompts: {},
    planExitPrompt: null,
    deferredPlanExitPrompts: {},

    sessionUsage: {},

    setActiveSession: (sessionId) => {
        void saveActiveSessionId(sessionId);
        set((state) => {
            if (state.activeSessionId === sessionId) {
                return { activeSessionId: sessionId };
            }

            const nextPermissionPrompts =
                sessionId !== null
                    ? [...(state.deferredPermissionPrompts[sessionId] ?? [])]
                    : [];
            const [nextPermissionPrompt, ...nextPermissionPromptQueue] = nextPermissionPrompts;
            const nextUserInputPrompt =
                sessionId !== null
                    ? state.deferredUserInputPrompts[sessionId]?.[0] ?? null
                    : null;
            const nextPlanExitPrompt =
                sessionId !== null
                    ? state.deferredPlanExitPrompts[sessionId] ?? null
                    : null;

            const nextDeferredPermissionPrompts = { ...state.deferredPermissionPrompts };
            const nextDeferredUserInputPrompts = { ...state.deferredUserInputPrompts };
            const nextDeferredPlanExitPrompts = { ...state.deferredPlanExitPrompts };

            if (sessionId !== null) {
                delete nextDeferredPermissionPrompts[sessionId];
                delete nextDeferredUserInputPrompts[sessionId];
                delete nextDeferredPlanExitPrompts[sessionId];
            }

            return {
                activeSessionId: sessionId,
                isAbortRequested: false,
                agentTodos: [],
                permissionPrompt: nextPermissionPrompt ?? null,
                permissionPromptQueue: nextPermissionPromptQueue,
                deferredPermissionPrompts: nextDeferredPermissionPrompts,
                userInputPrompt: nextUserInputPrompt,
                deferredUserInputPrompts: nextDeferredUserInputPrompts,
                planExitPrompt: nextPlanExitPrompt,
                deferredPlanExitPrompts: nextDeferredPlanExitPrompts,
            };
        });
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

            const nextDeferredPermissionPrompts = { ...state.deferredPermissionPrompts };
            delete nextDeferredPermissionPrompts[sessionId];

            const nextDeferredUserInputPrompts = { ...state.deferredUserInputPrompts };
            delete nextDeferredUserInputPrompts[sessionId];

            const nextDeferredPlanExitPrompts = { ...state.deferredPlanExitPrompts };
            delete nextDeferredPlanExitPrompts[sessionId];

            return {
                sessions: state.sessions.filter((session) => session.id !== sessionId),
                activeSessionId: nextActiveSessionId,
                ...(state.activeSessionId === sessionId ? { isAbortRequested: false } : {}),
                sessionUsage: nextUsage,
                deferredPermissionPrompts: nextDeferredPermissionPrompts,
                deferredUserInputPrompts: nextDeferredUserInputPrompts,
                deferredPlanExitPrompts: nextDeferredPlanExitPrompts,
                ...(state.activeSessionId === sessionId
                    ? {
                        permissionPrompt: null,
                        permissionPromptQueue: [],
                        userInputPrompt: null,
                        planExitPrompt: null,
                    }
                    : {}),
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

    setAbortRequested: (requested) => set({ isAbortRequested: requested }),

    stopActiveTurn: () =>
        set((state) => ({
            chatItems: state.chatItems.map((item) => {
                if ((item.type === "assistant" || item.type === "thinking") && item.isStreaming) {
                    return { ...item, isStreaming: false };
                }

                if (item.type === "tool" && item.status === "running") {
                    return {
                        ...item,
                        status: "failed",
                        errorMessage: item.errorMessage ?? "Stopped by user",
                    };
                }

                return item;
            }),
            isAssistantTyping: false,
            isAbortRequested: false,
            currentIntent: null,
            agentTodos: [],
            permissionPrompt: null,
            permissionPromptQueue: [],
            userInputPrompt: null,
            planExitPrompt: null,
        })),

    setCurrentIntent: (intent) => set({ currentIntent: intent }),

    setAgentTodos: (todos) => set({ agentTodos: todos }),

    appendThinkingDelta: (delta, _index) => {
        set((s) => {
            const items = [...s.chatItems];
            const thinkingIndex = findLastStreamingThinkingIndex(items);

            if (thinkingIndex !== -1) {
                const existingItem = items[thinkingIndex];
                if (existingItem !== undefined && existingItem.type === "thinking") {
                    items[thinkingIndex] = {
                        ...existingItem,
                        content: existingItem.content + delta,
                        isStreaming: true,
                    };
                    return { chatItems: items };
                }
            }

            const item: ThinkingItem = {
                id: createItemId(),
                type: "thinking",
                content: delta,
                timestamp: Date.now(),
                isStreaming: true,
            };
            return { chatItems: insertChatItemBeforeTrailingAssistant(s.chatItems, item) };
        });
    },

    finalizeThinking: (content) => {
        set((s) => {
            const items = [...s.chatItems];
            const thinkingIndex = findLastStreamingThinkingIndex(items);

            if (thinkingIndex !== -1) {
                const item = items[thinkingIndex];
                if (item !== undefined && item.type === "thinking") {
                    const nextContent = content !== undefined && content.trim().length > 0
                        ? content
                        : item.content;
                    items[thinkingIndex] = { ...item, content: nextContent, isStreaming: false };
                    return { chatItems: items };
                }
            }

            if (content !== undefined && content.trim().length > 0) {
                return {
                    chatItems: insertChatItemBeforeTrailingAssistant(items, {
                        id: createItemId(),
                        type: "thinking",
                        content,
                        timestamp: Date.now(),
                        isStreaming: false,
                    }),
                };
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

    receivePermissionPrompt: (prompt) =>
        set((state) => {
            if (prompt.sessionId !== state.activeSessionId) {
                return {
                    deferredPermissionPrompts: {
                        ...state.deferredPermissionPrompts,
                        [prompt.sessionId]: appendDeferredPrompt(
                            state.deferredPermissionPrompts[prompt.sessionId],
                            prompt
                        ),
                    },
                };
            }

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
            const nextDeferredPermissionPrompts = pruneDeferredPromptEntries<PermissionPrompt>(
                Object.entries(state.deferredPermissionPrompts).map(([sessionId, prompts]) => [
                    sessionId,
                    removeDeferredPromptByRequestId(prompts, requestId),
                ])
            );

            if (state.permissionPrompt?.requestId === requestId) {
                const [nextPrompt, ...restQueue] = state.permissionPromptQueue;
                return {
                    permissionPrompt: nextPrompt ?? null,
                    permissionPromptQueue: restQueue,
                    deferredPermissionPrompts: nextDeferredPermissionPrompts,
                };
            }

            return {
                permissionPromptQueue: state.permissionPromptQueue.filter((item) => item.requestId !== requestId),
                deferredPermissionPrompts: nextDeferredPermissionPrompts,
            };
        }),

    clearPermissionPrompts: () => set({
        permissionPrompt: null,
        permissionPromptQueue: [],
        deferredPermissionPrompts: {},
    }),

    receiveUserInputPrompt: (prompt) =>
        set((state) => {
            if (prompt.sessionId !== state.activeSessionId) {
                return {
                    deferredUserInputPrompts: {
                        ...state.deferredUserInputPrompts,
                        [prompt.sessionId]: appendDeferredPrompt(
                            state.deferredUserInputPrompts[prompt.sessionId],
                            prompt
                        ),
                    },
                };
            }

            if (state.userInputPrompt !== null) {
                return {
                    deferredUserInputPrompts: {
                        ...state.deferredUserInputPrompts,
                        [prompt.sessionId]: appendDeferredPrompt(
                            state.deferredUserInputPrompts[prompt.sessionId],
                            prompt
                        ),
                    },
                };
            }

            return { userInputPrompt: prompt };
        }),

    resolveUserInputPrompt: (requestId) =>
        set((state) => {
            const nextDeferredUserInputPrompts = pruneDeferredPromptEntries<UserInputPrompt>(
                Object.entries(state.deferredUserInputPrompts).map(([sessionId, prompts]) => [
                    sessionId,
                    removeDeferredPromptByRequestId(prompts, requestId),
                ])
            );

            if (state.userInputPrompt?.requestId === requestId) {
                const nextActiveSessionId = state.activeSessionId;
                const nextQueuedUserInput =
                    nextActiveSessionId !== null
                        ? nextDeferredUserInputPrompts[nextActiveSessionId]?.[0] ?? null
                        : null;
                const nextDeferredAfterPromote =
                    nextActiveSessionId !== null && nextQueuedUserInput !== null
                        ? {
                            ...nextDeferredUserInputPrompts,
                            [nextActiveSessionId]: removeDeferredPromptByRequestId(
                                nextDeferredUserInputPrompts[nextActiveSessionId],
                                nextQueuedUserInput.requestId
                            ),
                        }
                        : nextDeferredUserInputPrompts;

                return {
                    userInputPrompt: nextQueuedUserInput,
                    deferredUserInputPrompts: pruneDeferredPromptEntries<UserInputPrompt>(
                        Object.entries(nextDeferredAfterPromote).map(([sessionId, prompts]) => [
                            sessionId,
                            prompts,
                        ])
                    ),
                };
            }

            return { deferredUserInputPrompts: nextDeferredUserInputPrompts };
        }),

    receivePlanExitPrompt: (prompt) =>
        set((state) => {
            if (prompt.sessionId !== state.activeSessionId) {
                return {
                    deferredPlanExitPrompts: {
                        ...state.deferredPlanExitPrompts,
                        [prompt.sessionId]: prompt,
                    },
                };
            }

            return { planExitPrompt: prompt };
        }),

    deferActivePrompts: () =>
        set((state) => {
            const activeSessionId = state.activeSessionId;
            if (activeSessionId === null) {
                return {
                    permissionPrompt: null,
                    permissionPromptQueue: [],
                    userInputPrompt: null,
                    planExitPrompt: null,
                };
            }

            const nextDeferredPermissionPrompts =
                state.permissionPrompt === null && state.permissionPromptQueue.length === 0
                    ? state.deferredPermissionPrompts
                    : {
                        ...state.deferredPermissionPrompts,
                        [activeSessionId]: [
                            ...(state.permissionPrompt !== null ? [state.permissionPrompt] : []),
                            ...state.permissionPromptQueue,
                            ...(state.deferredPermissionPrompts[activeSessionId] ?? []),
                        ],
                    };
            const nextDeferredUserInputPrompts =
                state.userInputPrompt === null
                    ? state.deferredUserInputPrompts
                    : {
                        ...state.deferredUserInputPrompts,
                        [activeSessionId]: appendDeferredPrompt(
                            state.deferredUserInputPrompts[activeSessionId],
                            state.userInputPrompt
                        ),
                    };
            const nextDeferredPlanExitPrompts =
                state.planExitPrompt === null
                    ? state.deferredPlanExitPrompts
                    : {
                        ...state.deferredPlanExitPrompts,
                        [activeSessionId]: state.planExitPrompt,
                    };

            return {
                permissionPrompt: null,
                permissionPromptQueue: [],
                deferredPermissionPrompts: nextDeferredPermissionPrompts,
                userInputPrompt: null,
                deferredUserInputPrompts: nextDeferredUserInputPrompts,
                planExitPrompt: null,
                deferredPlanExitPrompts: nextDeferredPlanExitPrompts,
            };
        }),

    clearSessionPrompts: (sessionId) =>
        set((state) => {
            const nextDeferredPermissionPrompts = { ...state.deferredPermissionPrompts };
            delete nextDeferredPermissionPrompts[sessionId];

            const nextDeferredUserInputPrompts = { ...state.deferredUserInputPrompts };
            delete nextDeferredUserInputPrompts[sessionId];

            const nextDeferredPlanExitPrompts = { ...state.deferredPlanExitPrompts };
            delete nextDeferredPlanExitPrompts[sessionId];

            if (state.activeSessionId !== sessionId) {
                return {
                    deferredPermissionPrompts: nextDeferredPermissionPrompts,
                    deferredUserInputPrompts: nextDeferredUserInputPrompts,
                    deferredPlanExitPrompts: nextDeferredPlanExitPrompts,
                };
            }

            return {
                permissionPrompt: null,
                permissionPromptQueue: [],
                deferredPermissionPrompts: nextDeferredPermissionPrompts,
                userInputPrompt: null,
                deferredUserInputPrompts: nextDeferredUserInputPrompts,
                planExitPrompt: null,
                deferredPlanExitPrompts: nextDeferredPlanExitPrompts,
            };
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
            isAbortRequested: false,
            agentTodos: [],
            permissionPrompt: null,
            permissionPromptQueue: [],
            userInputPrompt: null,
            planExitPrompt: null,
        }),

    clearChatItems: () => {
        set({
            chatItems: [],
            isAssistantTyping: false,
            isAbortRequested: false,
            currentIntent: null,
            agentTodos: [],
            permissionPrompt: null,
            permissionPromptQueue: [],
            deferredPermissionPrompts: {},
            userInputPrompt: null,
            deferredUserInputPrompts: {},
            planExitPrompt: null,
            deferredPlanExitPrompts: {},
        });
    },

    reset: () => {
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
            isAbortRequested: false,
            currentIntent: null,
            agentTodos: [],
            permissionPrompt: null,
            permissionPromptQueue: [],
            deferredPermissionPrompts: {},
            userInputPrompt: null,
            deferredUserInputPrompts: {},
            planExitPrompt: null,
            deferredPlanExitPrompts: {},
            sessionUsage: {},
        });
    },
}));

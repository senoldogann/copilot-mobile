// Chat history management — multiple conversation tracking

import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const CHAT_HISTORY_KEY = "copilot_mobile_chat_history";
const MAX_CONVERSATIONS = 50;

export type Conversation = {
    id: string;
    title: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    sessionId: string | null;
};

export type ChatHistoryStore = {
    conversations: ReadonlyArray<Conversation>;
    activeConversationId: string | null;

    createConversation: (sessionId: string | null) => string;
    setActiveConversation: (id: string | null) => void;
    updateConversation: (id: string, title: string, preview: string) => void;
    deleteConversation: (id: string) => void;
    linkConversationToSession: (conversationId: string, sessionId: string) => void;
    removeBySessionId: (sessionId: string) => void;
    hydrate: () => Promise<void>;
};

let convCounter = 0;

type PersistedChatHistory = {
    conversations: ReadonlyArray<Conversation>;
    activeConversationId: string | null;
};

function sanitizeConversation(input: unknown): Conversation | null {
    if (typeof input !== "object" || input === null) {
        return null;
    }

    const raw = input as Record<string, unknown>;
    if (
        typeof raw["id"] !== "string"
        || typeof raw["title"] !== "string"
        || typeof raw["preview"] !== "string"
        || typeof raw["createdAt"] !== "number"
        || typeof raw["updatedAt"] !== "number"
    ) {
        return null;
    }

    const sessionId = raw["sessionId"];
    if (sessionId !== null && typeof sessionId !== "string") {
        return null;
    }

    return {
        id: raw["id"],
        title: raw["title"],
        preview: raw["preview"],
        createdAt: raw["createdAt"],
        updatedAt: raw["updatedAt"],
        sessionId,
    };
}

async function persistChatHistory(snapshot: PersistedChatHistory): Promise<void> {
    await SecureStore.setItemAsync(
        CHAT_HISTORY_KEY,
        JSON.stringify({
            conversations: snapshot.conversations.slice(0, MAX_CONVERSATIONS),
            activeConversationId: snapshot.activeConversationId,
        }),
    );
}

async function loadPersistedChatHistory(): Promise<PersistedChatHistory | null> {
    const raw = await SecureStore.getItemAsync(CHAT_HISTORY_KEY);
    if (raw === null) {
        return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
        return null;
    }

    const record = parsed as Record<string, unknown>;
    const rawConversations = record["conversations"];
    if (!Array.isArray(rawConversations)) {
        return null;
    }

    const conversations = rawConversations
        .map(sanitizeConversation)
        .filter((conversation): conversation is Conversation => conversation !== null)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_CONVERSATIONS);
    const activeConversationId =
        typeof record["activeConversationId"] === "string"
            ? record["activeConversationId"]
            : null;

    return {
        conversations,
        activeConversationId: conversations.some((item) => item.id === activeConversationId)
            ? activeConversationId
            : null,
    };
}

export const useChatHistoryStore = create<ChatHistoryStore>((set, get) => ({
    conversations: [],
    activeConversationId: null,

    createConversation: (sessionId) => {
        convCounter += 1;
        const id = `conv-${Date.now()}-${convCounter}`;
        const conv: Conversation = {
            id,
            title: "New Chat",
            preview: "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sessionId,
        };
        set((s) => ({
            conversations: [conv, ...s.conversations].slice(0, MAX_CONVERSATIONS),
            activeConversationId: id,
        }));
        void persistChatHistory(get());
        return id;
    },

    setActiveConversation: (id) => {
        set({ activeConversationId: id });
        void persistChatHistory(get());
    },

    updateConversation: (id, title, preview) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === id
                    ? { ...c, title, preview, updatedAt: Date.now() }
                    : c
            ),
        }));
        void persistChatHistory(get());
    },

    deleteConversation: (id) => {
        set((s) => ({
            conversations: s.conversations.filter((c) => c.id !== id),
            activeConversationId:
                s.activeConversationId === id ? null : s.activeConversationId,
        }));
        void persistChatHistory(get());
    },

    linkConversationToSession: (conversationId, sessionId) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === conversationId
                    ? { ...c, sessionId, updatedAt: Date.now() }
                    : c
            ),
        }));
        void persistChatHistory(get());
    },

    removeBySessionId: (sessionId) => {
        set((s) => {
            const nextConversations = s.conversations.filter((c) => c.sessionId !== sessionId);
            const activeConversationId =
                s.activeConversationId !== null
                    && nextConversations.every((item) => item.id !== s.activeConversationId)
                    ? null
                    : s.activeConversationId;

            return {
                conversations: nextConversations,
                activeConversationId,
            };
        });
        void persistChatHistory(get());
    },

    hydrate: async () => {
        try {
            const persisted = await loadPersistedChatHistory();
            if (persisted === null) {
                return;
            }

            set({
                conversations: persisted.conversations,
                activeConversationId: persisted.activeConversationId,
            });
        } catch (error) {
            console.warn("[ChatHistory] Failed to hydrate persisted conversations", error);
            await SecureStore.deleteItemAsync(CHAT_HISTORY_KEY);
        }
    },
}));

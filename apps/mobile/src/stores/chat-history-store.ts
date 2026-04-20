// Chat history management — multiple conversation tracking

import { create } from "zustand";

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
};

let convCounter = 0;

export const useChatHistoryStore = create<ChatHistoryStore>((set) => ({
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
            conversations: [conv, ...s.conversations],
            activeConversationId: id,
        }));
        return id;
    },

    setActiveConversation: (id) => set({ activeConversationId: id }),

    updateConversation: (id, title, preview) =>
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === id
                    ? { ...c, title, preview, updatedAt: Date.now() }
                    : c
            ),
        })),

    deleteConversation: (id) =>
        set((s) => ({
            conversations: s.conversations.filter((c) => c.id !== id),
            activeConversationId:
                s.activeConversationId === id ? null : s.activeConversationId,
        })),

    linkConversationToSession: (conversationId, sessionId) =>
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === conversationId
                    ? { ...c, sessionId, updatedAt: Date.now() }
                    : c
            ),
        })),
}));

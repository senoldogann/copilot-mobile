// Chat history management — multiple conversation tracking

import { create } from "zustand";
import type { ChatItem } from "./session-store-types";
import {
    deleteChatHistorySnapshot,
    clearLegacySecureStoreChatHistory,
    readChatHistorySnapshot,
    readLegacySecureStoreChatHistory,
    writeChatHistorySnapshot,
} from "../services/chat-history-storage";

const MAX_CONVERSATIONS = 50;
const MAX_PERSISTED_TEXT_LENGTH = 64_000;

export type Conversation = {
    id: string;
    title: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    lastSyncedAt: number | null;
    sessionId: string | null;
    archived: boolean;
    workspaceRoot: string | null;
};

export type ChatHistoryStore = {
    conversations: ReadonlyArray<Conversation>;
    activeConversationId: string | null;
    conversationItems: Readonly<Record<string, ReadonlyArray<ChatItem>>>;

    createConversation: (sessionId: string | null, workspaceRoot: string | null) => string;
    setActiveConversation: (id: string | null) => void;
    updateConversation: (id: string, title: string, preview: string) => void;
    setConversationItems: (id: string, items: ReadonlyArray<ChatItem>) => void;
    getConversationItems: (id: string) => ReadonlyArray<ChatItem>;
    deleteConversation: (id: string) => void;
    archiveConversation: (id: string) => void;
    unarchiveConversation: (id: string) => void;
    markConversationSynced: (id: string, syncedAt: number) => void;
    linkConversationToSession: (
        conversationId: string,
        sessionId: string,
        workspaceRoot: string | null
    ) => void;
    removeBySessionId: (sessionId: string) => void;
    hydrate: () => Promise<void>;
};

let convCounter = 0;

type PersistedChatHistory = {
    conversations: ReadonlyArray<Conversation>;
    activeConversationId: string | null;
    conversationItems: Readonly<Record<string, ReadonlyArray<ChatItem>>>;
};

function limitPersistedText(value: string): string {
    if (value.length <= MAX_PERSISTED_TEXT_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_PERSISTED_TEXT_LENGTH)}\n…[truncated in local cache]`;
}

function compactChatItemForPersistence(item: ChatItem): ChatItem {
    if (item.type === "user") {
        const { attachments: _attachments, ...rest } = item;
        return rest;
    }

    if (item.type === "assistant" || item.type === "thinking") {
        return {
            ...item,
            content: limitPersistedText(item.content),
            isStreaming: false,
        };
    }

    if (item.type === "system_notification") {
        return {
            ...item,
            content: limitPersistedText(item.content),
        };
    }

    return {
        ...item,
        ...(item.argumentsText !== undefined ? { argumentsText: limitPersistedText(item.argumentsText) } : {}),
        ...(item.progressMessage !== undefined ? { progressMessage: limitPersistedText(item.progressMessage) } : {}),
        ...(item.partialOutput !== undefined ? { partialOutput: limitPersistedText(item.partialOutput) } : {}),
        ...(item.errorMessage !== undefined ? { errorMessage: limitPersistedText(item.errorMessage) } : {}),
    };
}

let pendingSnapshot: PersistedChatHistory | null = null;
let persistInFlight = false;

function toPersistedSnapshot(state: Pick<ChatHistoryStore, "conversations" | "activeConversationId" | "conversationItems">): PersistedChatHistory {
    return {
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        conversationItems: state.conversationItems,
    };
}

async function flushPersistQueue(): Promise<void> {
    if (persistInFlight) {
        return;
    }

    persistInFlight = true;

    try {
        while (pendingSnapshot !== null) {
            const snapshot = pendingSnapshot;
            pendingSnapshot = null;
            await persistChatHistory(snapshot);
        }
    } finally {
        persistInFlight = false;
        if (pendingSnapshot !== null) {
            void flushPersistQueue();
        }
    }
}

function schedulePersist(state: Pick<ChatHistoryStore, "conversations" | "activeConversationId" | "conversationItems">): void {
    pendingSnapshot = toPersistedSnapshot(state);
    void flushPersistQueue();
}

function sanitizeChatItem(input: unknown): ChatItem | null {
    if (typeof input !== "object" || input === null) {
        return null;
    }

    const raw = input as Record<string, unknown>;
    const id = raw["id"];
    const timestamp = raw["timestamp"];
    const type = raw["type"];

    if (typeof id !== "string" || typeof timestamp !== "number" || typeof type !== "string") {
        return null;
    }

    switch (type) {
        case "user": {
            const content = raw["content"];
            const deliveryState = raw["deliveryState"];
            if (
                typeof content !== "string"
                || (deliveryState !== "pending" && deliveryState !== "sent" && deliveryState !== "failed")
            ) {
                return null;
            }

            const attachments = Array.isArray(raw["attachments"])
                ? raw["attachments"].filter((attachment): boolean => typeof attachment === "object" && attachment !== null)
                : undefined;

            return {
                id,
                timestamp,
                type,
                content,
                deliveryState,
                ...(attachments !== undefined ? { attachments } : {}),
            };
        }

        case "assistant":
        case "thinking": {
            const content = raw["content"];
            if (typeof content !== "string") {
                return null;
            }

            return {
                id,
                timestamp,
                type,
                content,
                isStreaming: false,
            };
        }

        case "system_notification": {
            const content = raw["content"];
            if (typeof content !== "string") {
                return null;
            }

            return {
                id,
                timestamp,
                type,
                content,
            };
        }

        case "tool": {
            const toolName = raw["toolName"];
            const requestId = raw["requestId"];
            const status = raw["status"];
            if (
                typeof toolName !== "string"
                || typeof requestId !== "string"
                || (status !== "running" && status !== "completed" && status !== "failed" && status !== "no_results")
            ) {
                return null;
            }

            const item: Extract<ChatItem, { type: "tool" }> = {
                id,
                timestamp,
                type,
                toolName,
                requestId,
                status,
            };

            if (typeof raw["argumentsText"] === "string") {
                item.argumentsText = raw["argumentsText"];
            }
            if (typeof raw["progressMessage"] === "string") {
                item.progressMessage = raw["progressMessage"];
            }
            if (Array.isArray(raw["progressMessages"])) {
                item.progressMessages = raw["progressMessages"].filter(
                    (entry): entry is string => typeof entry === "string"
                );
            }
            if (typeof raw["partialOutput"] === "string") {
                item.partialOutput = raw["partialOutput"];
            }
            if (typeof raw["errorMessage"] === "string") {
                item.errorMessage = raw["errorMessage"];
            }

            return item;
        }

        default:
            return null;
    }
}

function sanitizeConversationItems(input: unknown): Readonly<Record<string, ReadonlyArray<ChatItem>>> {
    if (typeof input !== "object" || input === null) {
        return {};
    }

    const raw = input as Record<string, unknown>;
    const entries = Object.entries(raw).map(([conversationId, items]) => {
        if (!Array.isArray(items)) {
            return [conversationId, []] as const;
        }

        return [
            conversationId,
            items
                .map(sanitizeChatItem)
                .filter((item): item is ChatItem => item !== null),
        ] as const;
    });

    return Object.fromEntries(entries);
}

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

    const workspaceRootRaw = raw["workspaceRoot"];
    const workspaceRoot =
        typeof workspaceRootRaw === "string" && workspaceRootRaw.length > 0
            ? workspaceRootRaw
            : null;

    return {
        id: raw["id"],
        title: raw["title"],
        preview: raw["preview"],
        createdAt: raw["createdAt"],
        updatedAt: raw["updatedAt"],
        lastSyncedAt: typeof raw["lastSyncedAt"] === "number" ? raw["lastSyncedAt"] : null,
        sessionId,
        archived: raw["archived"] === true,
        workspaceRoot,
    };
}

async function persistChatHistory(snapshot: PersistedChatHistory): Promise<void> {
    const serialized = JSON.stringify({
        conversations: snapshot.conversations.slice(0, MAX_CONVERSATIONS),
        activeConversationId: snapshot.activeConversationId,
        conversationItems: Object.fromEntries(
            Object.entries(snapshot.conversationItems).map(([conversationId, items]) => [
                conversationId,
                items.map((item) => compactChatItemForPersistence(item)),
            ])
        ),
    });
    await writeChatHistorySnapshot(serialized);
}

async function loadPersistedChatHistory(): Promise<PersistedChatHistory | null> {
    const persistedRaw = await readChatHistorySnapshot();
    const legacyRaw = persistedRaw === null ? await readLegacySecureStoreChatHistory() : null;
    const raw = persistedRaw ?? legacyRaw;
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

    const snapshot = {
        conversations,
        activeConversationId: conversations.some((item) => item.id === activeConversationId)
            ? activeConversationId
            : null,
        conversationItems: sanitizeConversationItems(record["conversationItems"]),
    };

    if (persistedRaw === null && legacyRaw !== null) {
        await persistChatHistory(snapshot);
        await clearLegacySecureStoreChatHistory();
    }

    return snapshot;
}

export const useChatHistoryStore = create<ChatHistoryStore>((set, get) => ({
    conversations: [],
    activeConversationId: null,
    conversationItems: {},

    createConversation: (sessionId, workspaceRoot) => {
        convCounter += 1;
        const id = `conv-${Date.now()}-${convCounter}`;
        const conv: Conversation = {
            id,
            title: "New Chat",
            preview: "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastSyncedAt: sessionId === null ? null : Date.now(),
            sessionId,
            archived: false,
            workspaceRoot,
        };
        set((s) => ({
            conversations: [conv, ...s.conversations].slice(0, MAX_CONVERSATIONS),
            activeConversationId: id,
        }));
        schedulePersist(get());
        return id;
    },

    setActiveConversation: (id) => {
        set({ activeConversationId: id });
        schedulePersist(get());
    },

    updateConversation: (id, title, preview) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === id
                    ? { ...c, title, preview, updatedAt: Date.now() }
                    : c
            ),
        }));
        schedulePersist(get());
    },

    setConversationItems: (id, items) => {
        set((state) => ({
            conversations: state.conversations.map((conversation) =>
                conversation.id === id
                    ? {
                        ...conversation,
                        ...(conversation.sessionId !== null ? { lastSyncedAt: Date.now() } : {}),
                    }
                    : conversation
            ),
            conversationItems: {
                ...state.conversationItems,
                [id]: items.map((item) => {
                    if (item.type === "assistant" || item.type === "thinking") {
                        return { ...item, isStreaming: false };
                    }

                    return item;
                }),
            },
        }));
        schedulePersist(get());
    },

    getConversationItems: (id) => get().conversationItems[id] ?? [],

    deleteConversation: (id) => {
        set((s) => {
            const nextConversationItems = { ...s.conversationItems };
            delete nextConversationItems[id];

            return {
                conversations: s.conversations.filter((c) => c.id !== id),
                activeConversationId:
                    s.activeConversationId === id ? null : s.activeConversationId,
                conversationItems: nextConversationItems,
            };
        });
        schedulePersist(get());
    },

    archiveConversation: (id) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === id ? { ...c, archived: true, updatedAt: Date.now() } : c
            ),
            activeConversationId:
                s.activeConversationId === id ? null : s.activeConversationId,
        }));
        schedulePersist(get());
    },

    unarchiveConversation: (id) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === id ? { ...c, archived: false, updatedAt: Date.now() } : c
            ),
        }));
        schedulePersist(get());
    },

    markConversationSynced: (id, syncedAt) => {
        set((state) => ({
            conversations: state.conversations.map((conversation) =>
                conversation.id === id
                    ? {
                        ...conversation,
                        lastSyncedAt: syncedAt,
                        updatedAt: Math.max(conversation.updatedAt, syncedAt),
                    }
                    : conversation
            ),
        }));
        schedulePersist(get());
    },

    linkConversationToSession: (conversationId, sessionId, workspaceRoot) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.id === conversationId
                    ? {
                        ...c,
                        sessionId,
                        workspaceRoot,
                        updatedAt: Date.now(),
                        lastSyncedAt: Date.now(),
                    }
                    : c
            ),
        }));
        schedulePersist(get());
    },

    removeBySessionId: (sessionId) => {
        set((s) => {
            const nextConversations = s.conversations.filter((c) => c.sessionId !== sessionId);
            const removedConversationIds = new Set(
                s.conversations
                    .filter((conversation) => conversation.sessionId === sessionId)
                    .map((conversation) => conversation.id)
            );
            const nextConversationItems = Object.fromEntries(
                Object.entries(s.conversationItems).filter(([conversationId]) => !removedConversationIds.has(conversationId))
            );
            const activeConversationId =
                s.activeConversationId !== null
                    && nextConversations.every((item) => item.id !== s.activeConversationId)
                    ? null
                    : s.activeConversationId;

            return {
                conversations: nextConversations,
                activeConversationId,
                conversationItems: nextConversationItems,
            };
        });
        schedulePersist(get());
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
                conversationItems: persisted.conversationItems,
            });
        } catch (error) {
            console.warn("[ChatHistory] Failed to hydrate persisted conversations", { error });
            await deleteChatHistorySnapshot();
            await clearLegacySecureStoreChatHistory();
        }
    },
}));

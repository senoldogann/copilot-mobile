jest.mock("../../services/chat-history-storage", () => ({
    writeChatHistorySnapshot: jest.fn<Promise<void>, [string, string?]>(() => Promise.resolve()),
    readChatHistorySnapshot: jest.fn<Promise<string | null>, [string?]>(() => Promise.resolve(null)),
    readLegacySecureStoreChatHistory: jest.fn<Promise<string | null>, []>(() => Promise.resolve(null)),
    clearLegacySecureStoreChatHistory: jest.fn<Promise<void>, []>(() => Promise.resolve()),
    deleteChatHistorySnapshot: jest.fn<Promise<void>, [string?]>(() => Promise.resolve()),
}));

import { useChatHistoryStore } from "../chat-history-store";

const mockChatHistoryStorage = jest.requireMock("../../services/chat-history-storage") as {
    writeChatHistorySnapshot: jest.Mock<Promise<void>, [string, string?]>;
    readChatHistorySnapshot: jest.Mock<Promise<string | null>, [string?]>;
    readLegacySecureStoreChatHistory: jest.Mock<Promise<string | null>, []>;
};

async function flushPersistence(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
}

function createAssistantItem(id: string) {
    return {
        id,
        timestamp: 1,
        type: "assistant" as const,
        content: "cached response",
        isStreaming: false,
    };
}

describe("chat history store", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockChatHistoryStorage.readChatHistorySnapshot.mockResolvedValue(null);
        mockChatHistoryStorage.readLegacySecureStoreChatHistory.mockResolvedValue(null);
        useChatHistoryStore.setState({
            scopeKey: "default",
            conversations: [],
            activeConversationId: null,
            conversationItems: {},
        });
    });

    it("prunes orphaned conversation items when capped conversations evict older entries", async () => {
        const store = useChatHistoryStore.getState();
        const firstConversationId = store.createConversation(null, null);
        store.setConversationItems(firstConversationId, [createAssistantItem("assistant-1")]);

        for (let index = 0; index < 50; index += 1) {
            store.createConversation(null, null);
        }

        await flushPersistence();

        const lastPersistedSnapshot =
            mockChatHistoryStorage.writeChatHistorySnapshot.mock.calls[
                mockChatHistoryStorage.writeChatHistorySnapshot.mock.calls.length - 1
            ]?.[0];
        if (lastPersistedSnapshot === undefined) {
            throw new Error("Expected a persisted chat-history snapshot");
        }

        const persisted = JSON.parse(lastPersistedSnapshot) as {
            conversations: Array<{ id: string }>;
            conversationItems: Record<string, unknown>;
        };

        expect(persisted.conversations).toHaveLength(50);
        expect(persisted.conversationItems[firstConversationId]).toBeUndefined();
        expect(useChatHistoryStore.getState().conversationItems[firstConversationId]).toBeUndefined();
    });

    it("drops orphaned conversation items during hydration", async () => {
        mockChatHistoryStorage.readChatHistorySnapshot.mockResolvedValue(JSON.stringify({
            conversations: [{
                id: "conv-1",
                title: "New Chat",
                preview: "",
                createdAt: 1,
                updatedAt: 1,
                lastSyncedAt: null,
                sessionId: null,
                archived: false,
                workspaceRoot: null,
            }],
            activeConversationId: "conv-1",
            conversationItems: {
                "conv-1": [createAssistantItem("assistant-1")],
                "orphaned-conv": [createAssistantItem("assistant-2")],
            },
        }));

        await useChatHistoryStore.getState().hydrate();

        expect(useChatHistoryStore.getState().conversationItems["conv-1"]).toHaveLength(1);
        expect(useChatHistoryStore.getState().conversationItems["orphaned-conv"]).toBeUndefined();
    });
});

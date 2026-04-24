jest.mock("../../services/credentials", () => ({
    saveActiveSessionId: jest.fn(() => Promise.resolve()),
}));

import { useSessionStore } from "../session-store";

describe("session store", () => {
    beforeEach(() => {
        useSessionStore.getState().reset();
    });

    it("clears currentIntent when chat items are replaced", () => {
        const store = useSessionStore.getState();

        store.setCurrentIntent("Fixing production issues");
        store.replaceChatItems([{
            id: "assistant-1",
            timestamp: 1,
            type: "assistant",
            content: "hello",
            isStreaming: false,
        }]);

        expect(useSessionStore.getState().currentIntent).toBeNull();
    });
});

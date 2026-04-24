import type { SessionHistoryItem } from "@copilot-mobile/shared";
import type { ChatItem } from "../../stores/session-store-types";
import { __testables } from "../message-handler";

describe("message handler history merge", () => {
    it("preserves an active streaming assistant item when history catches up", () => {
        const currentItems: ReadonlyArray<ChatItem> = [
            {
                id: "user-1",
                timestamp: 1,
                type: "user",
                content: "hello",
                deliveryState: "sent",
            },
            {
                id: "assistant-live",
                timestamp: 2,
                type: "assistant",
                content: "Working on it",
                isStreaming: true,
            },
        ];
        const historyItems: ReadonlyArray<SessionHistoryItem> = [
            {
                id: "user-1",
                timestamp: 1,
                type: "user",
                content: "hello",
            },
            {
                id: "assistant-final",
                timestamp: 2,
                type: "assistant",
                content: "Working on it now",
            },
        ];

        const mergedItems = __testables.mergeHistoryIntoExistingItems(currentItems, historyItems);

        expect(mergedItems).toHaveLength(2);
        expect(mergedItems[1]).toMatchObject({
            id: "assistant-final",
            type: "assistant",
            content: "Working on it now",
            isStreaming: true,
        });
    });

    it("updates tool history in place by request id", () => {
        const currentItems: ReadonlyArray<ChatItem> = [{
            id: "tool-item",
            timestamp: 3,
            type: "tool",
            toolName: "apply_patch",
            requestId: "req-1",
            status: "running",
            partialOutput: "diff chunk",
        }];
        const historyItems: ReadonlyArray<SessionHistoryItem> = [{
            id: "tool-history",
            timestamp: 3,
            type: "tool",
            toolName: "apply_patch",
            requestId: "req-1",
            status: "completed",
            partialOutput: "diff chunk",
        }];

        const mergedItems = __testables.mergeHistoryIntoExistingItems(currentItems, historyItems);

        expect(mergedItems).toEqual([{
            id: "tool-item",
            timestamp: 3,
            type: "tool",
            toolName: "apply_patch",
            requestId: "req-1",
            status: "completed",
            partialOutput: "diff chunk",
        }]);
    });

    it("merges local upload refs with resumed blob attachments", () => {
        const currentItems: ReadonlyArray<ChatItem> = [{
            id: "local-user",
            timestamp: 1,
            type: "user",
            content: "see screenshot",
            deliveryState: "pending",
            attachments: [{
                type: "upload_ref",
                uploadId: "local:0:screen.jpg:file:///screen.jpg",
                mimeType: "image/jpeg",
                displayName: "screen.jpg",
            }],
        }];
        const historyItems: ReadonlyArray<SessionHistoryItem> = [{
            id: "remote-user",
            timestamp: 1,
            type: "user",
            content: "see screenshot",
            attachments: [{
                type: "blob",
                data: "abc123",
                mimeType: "image/jpeg",
                displayName: "screen.jpg",
            }],
        }];

        const mergedItems = __testables.mergeHistoryIntoExistingItems(currentItems, historyItems);

        expect(mergedItems).toHaveLength(1);
        expect(mergedItems[0]).toMatchObject({
            id: "remote-user",
            type: "user",
            content: "see screenshot",
            attachments: [{
                type: "blob",
                data: "abc123",
                mimeType: "image/jpeg",
                displayName: "screen.jpg",
            }],
        });
    });
});

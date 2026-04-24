import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCompletionNotifier } from "../../src/notifications/completion-notifier.js";

describe("completion notifier", () => {
    it("sends pushes when the device is connected but presence has not arrived yet", async () => {
        const completionPushes: Array<{ sessionId: string; title: string; body: string }> = [];
        const syncPushes: Array<{ sessionId: string; eventType: string }> = [];
        const notifier = createCompletionNotifier({
            deviceRegistry: {
                isConnected: () => true,
                getPresence: () => null,
                getPushTarget: () => ({
                    provider: "expo",
                    pushToken: "ExponentPushToken[test-token]",
                    platform: "ios",
                    updatedAt: Date.now(),
                }),
                unregisterPushTarget: () => undefined,
            },
            pushProvider: {
                sendCompletionPush: async (input: {
                    pushToken: string;
                    sessionId: string;
                    title: string;
                    body: string;
                }) => {
                    completionPushes.push({
                        sessionId: input.sessionId,
                        title: input.title,
                        body: input.body,
                    });
                    return { ok: true } as const;
                },
                sendBackgroundSyncPush: async (input: {
                    pushToken: string;
                    sessionId: string;
                    eventType: "completion" | "permission_prompt" | "user_input_prompt";
                }) => {
                    syncPushes.push({
                        sessionId: input.sessionId,
                        eventType: input.eventType,
                    });
                    return { ok: true } as const;
                },
                sendSessionPush: async () => ({ ok: true } as const),
            },
        });

        notifier.bindSessionToDevice("session-1", "device-1");
        notifier.onBusyStateChanged("session-1", true);
        notifier.updateSessionTitle("session-1", "Review PR");
        notifier.appendAssistantPreview("session-1", "Looks good to merge.");
        notifier.onBusyStateChanged("session-1", false);

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(syncPushes, [{
            sessionId: "session-1",
            eventType: "completion",
        }]);
        assert.deepEqual(completionPushes, [{
            sessionId: "session-1",
            title: "Review PR",
            body: "Looks good to merge.",
        }]);
    });

    it("suppresses pushes while the app is actively visible", async () => {
        const completionPushes: Array<unknown> = [];
        const syncPushes: Array<unknown> = [];
        const notifier = createCompletionNotifier({
            deviceRegistry: {
                isConnected: () => true,
                getPresence: () => ({
                    connectionId: "connection-1",
                    state: "active" as const,
                    timestamp: Date.now(),
                    receivedAt: Date.now(),
                }),
                getPushTarget: () => ({
                    provider: "expo",
                    pushToken: "ExponentPushToken[test-token]",
                    platform: "ios",
                    updatedAt: Date.now(),
                }),
                unregisterPushTarget: () => undefined,
            },
            pushProvider: {
                sendCompletionPush: async (input: unknown) => {
                    completionPushes.push(input);
                    return { ok: true } as const;
                },
                sendBackgroundSyncPush: async (input: unknown) => {
                    syncPushes.push(input);
                    return { ok: true } as const;
                },
                sendSessionPush: async () => ({ ok: true } as const),
            },
        });

        notifier.bindSessionToDevice("session-2", "device-2");
        notifier.onBusyStateChanged("session-2", true);
        notifier.appendAssistantPreview("session-2", "Done.");
        notifier.onBusyStateChanged("session-2", false);

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(syncPushes.length, 0);
        assert.equal(completionPushes.length, 0);
    });

    it("awaits background sync before sending the completion push", async () => {
        const events: string[] = [];
        let releaseSyncPush: (() => void) | null = null;
        const syncStarted = new Promise<void>((resolve) => {
            releaseSyncPush = resolve;
        });
        const notifier = createCompletionNotifier({
            deviceRegistry: {
                isConnected: () => true,
                getPresence: () => null,
                getPushTarget: () => ({
                    provider: "expo",
                    pushToken: "ExponentPushToken[test-token]",
                    platform: "ios",
                    updatedAt: Date.now(),
                }),
                unregisterPushTarget: () => undefined,
            },
            pushProvider: {
                sendCompletionPush: async () => {
                    events.push("completion");
                    return { ok: true } as const;
                },
                sendBackgroundSyncPush: async () => {
                    events.push("sync-start");
                    await syncStarted;
                    events.push("sync-finish");
                    return { ok: true } as const;
                },
                sendSessionPush: async () => ({ ok: true } as const),
            },
        });

        notifier.bindSessionToDevice("session-3", "device-3");
        notifier.onBusyStateChanged("session-3", true);
        notifier.onBusyStateChanged("session-3", false);

        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(events, ["sync-start"]);

        releaseSyncPush?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(events, ["sync-start", "sync-finish", "completion"]);
    });
});

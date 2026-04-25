import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { listSessions, prefetchSessionState, tryResumeFromStoredCredentials } from "./bridge";
import { useSessionStore } from "../stores/session-store";
import { BACKGROUND_NOTIFICATION_TASK } from "./notification-background-shared";
import { markRemoteNotificationReceived } from "./notifications";

const BACKGROUND_SYNC_DEDUP_WINDOW_MS = 10_000;

type SessionSyncEventType = "completion" | "permission_prompt" | "user_input_prompt";

type SessionSyncPayload = {
    sessionId: string;
    kind: "session-sync";
    eventType: SessionSyncEventType;
    requestId?: string;
};

let lastBackgroundSyncSignature: string | null = null;
let lastBackgroundSyncAt = 0;

function parseDataString(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return null;
        }

        return parsed as Record<string, unknown>;
    } catch (error) {
        console.warn("[notifications] Failed to parse background notification dataString", {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function readBackgroundNotificationPayload(
    payload: Notifications.NotificationTaskPayload
): SessionSyncPayload | null {
    if ("actionIdentifier" in payload) {
        return null;
    }

    const dataRecord = payload.data;
    const decodedData = parseDataString(dataRecord.dataString);
    const sessionId = decodedData?.["sessionId"] ?? dataRecord["sessionId"];
    const kind = decodedData?.["kind"] ?? dataRecord["kind"];
    const eventType = decodedData?.["eventType"] ?? dataRecord["eventType"];
    const requestId = decodedData?.["requestId"] ?? dataRecord["requestId"];

    if (
        typeof sessionId !== "string"
        || sessionId.trim().length === 0
        || kind !== "session-sync"
        || (eventType !== "completion" && eventType !== "permission_prompt" && eventType !== "user_input_prompt")
    ) {
        return null;
    }

    return {
        sessionId: sessionId.trim(),
        kind,
        eventType,
        ...(typeof requestId === "string" && requestId.trim().length > 0
            ? { requestId: requestId.trim() }
            : {}),
    };
}

function shouldSkipBackgroundSync(signature: string, now: number): boolean {
    return lastBackgroundSyncSignature === signature
        && (now - lastBackgroundSyncAt) < BACKGROUND_SYNC_DEDUP_WINDOW_MS;
}

async function performBackgroundSessionSync(sessionId: string): Promise<void> {
    await tryResumeFromStoredCredentials({
        reconnectOnFailure: false,
        reportErrors: false,
    });

    await listSessions();

    const activeSessionId = useSessionStore.getState().activeSessionId;
    await prefetchSessionState(sessionId, activeSessionId === sessionId);
}

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
    TaskManager.defineTask<Notifications.NotificationTaskPayload>(
        BACKGROUND_NOTIFICATION_TASK,
        async ({ data, error, executionInfo }) => {
            if (error !== null) {
                console.warn("[notifications] Background notification task failed", {
                    taskName: executionInfo.taskName,
                    error: error.message,
                });
                return;
            }

            const payload = readBackgroundNotificationPayload(data);
            if (payload === null) {
                return;
            }

            const syncSignature = payload.requestId !== undefined
                ? `${payload.sessionId}:${payload.eventType}:${payload.requestId}`
                : `${payload.sessionId}:${payload.eventType}`;
            const now = Date.now();
            if (shouldSkipBackgroundSync(syncSignature, now)) {
                return;
            }

            lastBackgroundSyncSignature = syncSignature;
            lastBackgroundSyncAt = now;
            markRemoteNotificationReceived(payload.sessionId, payload.eventType, payload.requestId);

            try {
                await performBackgroundSessionSync(payload.sessionId);
            } catch (syncError) {
                console.warn("[notifications] Background session sync failed", {
                    taskName: executionInfo.taskName,
                    sessionId: payload.sessionId,
                    eventType: payload.eventType,
                    error: syncError instanceof Error ? syncError.message : String(syncError),
                });
            }
        }
    );
}

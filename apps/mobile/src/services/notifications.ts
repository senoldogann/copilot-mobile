import { Platform } from "react-native";
import Constants from "expo-constants";
import type { NotificationPlatform, NotificationProvider } from "@copilot-mobile/shared";
import { useConnectionStore } from "../stores/connection-store";
import { BACKGROUND_NOTIFICATION_TASK } from "./notification-background-shared";
import { readAppVersion } from "./app-version";

const SESSION_EVENTS_CHANNEL_ID = "session-events";
const MAX_LOCAL_NOTIFICATION_KEYS = 200;
const LOCAL_NOTIFICATION_DEDUP_WINDOW_MS = 12_000;
const REMOTE_PUSH_CACHE_TTL_MS = 5 * 60 * 1000;

let initialized = false;
let notificationResponseSubscription: { remove: () => void } | null = null;
let lastHandledNotificationId: string | null = null;
let notificationsModulePromise: Promise<typeof import("expo-notifications") | null> | null = null;
let cachedRemotePushRegistration: RemotePushRegistration | null = null;
let cachedRemotePushRegistrationAt = 0;
let bridgeRegisteredPushToken: string | null = null;
let backgroundNotificationTaskRegistered = false;
const localNotificationKeys = new Set<string>();
const recentRemoteNotificationKeys = new Map<string, number>();
const recentLocalNotificationKeys = new Map<string, number>();

type SessionNotificationEventType = "completion" | "permission_prompt" | "user_input_prompt";

export type RemotePushRegistration = {
    provider: NotificationProvider;
    pushToken: string;
    platform: NotificationPlatform;
    appVersion?: string;
};

export type RemotePushAvailability =
    | {
        kind: "ready";
        registration: RemotePushRegistration;
    }
    | { kind: "permission_denied" }
    | { kind: "unsupported" }
    | { kind: "unavailable" };

// expo-notifications remote-push functionality was removed from Expo Go in SDK 53.
// Only initialize when running as a real dev-build or production build.
function isExpoGo(): boolean {
    return (Constants.appOwnership === "expo") || (Constants.executionEnvironment === "storeClient");
}

async function getNotificationsModule(): Promise<typeof import("expo-notifications") | null> {
    if (isExpoGo()) {
        return null;
    }

    if (notificationsModulePromise === null) {
        notificationsModulePromise = import("expo-notifications")
            .then((module) => module)
            .catch((error) => {
                useConnectionStore.getState().setError(
                    `Failed to load notifications module: ${error instanceof Error ? error.message : String(error)}`
                );
                return null;
            });
    }

    return notificationsModulePromise;
}

function hasNotificationPermission(
    notifications: typeof import("expo-notifications"),
    settings: Awaited<ReturnType<(typeof import("expo-notifications"))["getPermissionsAsync"]>>
): boolean {
    return settings.granted
        || settings.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL;
}

function readNotificationSessionId(
    response: Awaited<ReturnType<(typeof import("expo-notifications"))["getLastNotificationResponseAsync"]>>
): string | null {
    const sessionId = response?.notification.request.content.data?.["sessionId"];
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

async function registerBackgroundNotificationTask(): Promise<void> {
    if (backgroundNotificationTaskRegistered) {
        return;
    }

    const notifications = await getNotificationsModule();
    if (notifications === null) {
        return;
    }

    try {
        const taskManager = await import("expo-task-manager");
        const alreadyRegistered = await taskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK);
        if (!alreadyRegistered) {
            await notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
        }
        backgroundNotificationTaskRegistered = true;
    } catch (error) {
        useConnectionStore.getState().setError(
            `Failed to register background notification task: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function getNotificationResponseId(
    response: Awaited<ReturnType<(typeof import("expo-notifications"))["getLastNotificationResponseAsync"]>>
): string {
    return response?.notification.request.identifier ?? "";
}

function shouldHandleNotificationResponse(
    response: Awaited<ReturnType<(typeof import("expo-notifications"))["getLastNotificationResponseAsync"]>>
): boolean {
    const responseId = getNotificationResponseId(response);
    if (responseId.length === 0 || responseId === lastHandledNotificationId) {
        return false;
    }

    lastHandledNotificationId = responseId;
    return true;
}

function readExpoProjectIdFromExtra(): string | null {
    const extra = Constants.expoConfig?.extra;
    if (typeof extra !== "object" || extra === null || Array.isArray(extra)) {
        return null;
    }

    const eas = (extra as Record<string, unknown>)["eas"];
    if (typeof eas !== "object" || eas === null || Array.isArray(eas)) {
        return null;
    }

    const projectId = (eas as Record<string, unknown>)["projectId"];
    return typeof projectId === "string" && projectId.trim().length > 0 ? projectId.trim() : null;
}

function readExpoProjectId(): string | null {
    const easProjectId = Constants.easConfig?.projectId;
    if (typeof easProjectId === "string" && easProjectId.trim().length > 0) {
        return easProjectId.trim();
    }

    return readExpoProjectIdFromExtra();
}

function readNotificationPlatform(): NotificationPlatform {
    return Platform.OS === "android" ? "android" : "ios";
}

function readRemotePushRegistrationError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();

    if (
        Platform.OS === "ios"
        && normalizedMessage.includes("aps-environment")
    ) {
        return "iOS push notifications are not enabled for this build. Enable the Push Notifications capability for the app identifier, then rebuild the app with a provisioning profile that includes the aps-environment entitlement.";
    }

    return message;
}

function rememberLocalNotificationKey(key: string): boolean {
    if (localNotificationKeys.has(key)) {
        return false;
    }

    localNotificationKeys.add(key);
    if (localNotificationKeys.size <= MAX_LOCAL_NOTIFICATION_KEYS) {
        return true;
    }

    const oldestKey = localNotificationKeys.values().next().value;
    if (typeof oldestKey === "string") {
        localNotificationKeys.delete(oldestKey);
    }

    return true;
}

function pruneExpiredNotificationKeys(
    map: Map<string, number>,
    now: number
): void {
    for (const [key, timestamp] of map.entries()) {
        if (now - timestamp >= LOCAL_NOTIFICATION_DEDUP_WINDOW_MS) {
            map.delete(key);
        }
    }
}

function createSessionNotificationEventKey(sessionId: string, eventType: SessionNotificationEventType): string {
    return `${sessionId}:${eventType}`;
}

function rememberLocalSessionNotification(key: string, now: number): boolean {
    pruneExpiredNotificationKeys(recentLocalNotificationKeys, now);
    const existing = recentLocalNotificationKeys.get(key);
    if (existing !== undefined && now - existing < LOCAL_NOTIFICATION_DEDUP_WINDOW_MS) {
        return false;
    }

    recentLocalNotificationKeys.set(key, now);
    return true;
}

function hasRecentRemoteSessionNotification(key: string, now: number): boolean {
    pruneExpiredNotificationKeys(recentRemoteNotificationKeys, now);
    const existing = recentRemoteNotificationKeys.get(key);
    return existing !== undefined && now - existing < LOCAL_NOTIFICATION_DEDUP_WINDOW_MS;
}

export function markRemoteNotificationReceived(sessionId: string, eventType: SessionNotificationEventType): void {
    const now = Date.now();
    pruneExpiredNotificationKeys(recentRemoteNotificationKeys, now);
    recentRemoteNotificationKeys.set(createSessionNotificationEventKey(sessionId, eventType), now);
}

export async function initializeNotifications(): Promise<void> {
    const notifications = await getNotificationsModule();
    if (notifications === null) return;

    if (!initialized) {
        notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowBanner: false,
                shouldShowList: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
            }),
        });
        initialized = true;
    }

    await registerBackgroundNotificationTask();

    if (Platform.OS === "android") {
        await notifications.setNotificationChannelAsync(SESSION_EVENTS_CHANNEL_ID, {
            name: "Session events",
            importance: notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 120, 250],
            lockscreenVisibility: notifications.AndroidNotificationVisibility.PUBLIC,
        });
    }
}

async function ensureNotificationPermission(options: { allowPrompt: boolean }): Promise<boolean> {
    const notifications = await getNotificationsModule();
    if (notifications === null) return false;

    await initializeNotifications();

    const currentSettings = await notifications.getPermissionsAsync();
    if (hasNotificationPermission(notifications, currentSettings)) {
        return true;
    }

    if (!options.allowPrompt) {
        return false;
    }

    const requestedSettings = await notifications.requestPermissionsAsync({
        ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: true,
        },
    });

    return hasNotificationPermission(notifications, requestedSettings);
}

export async function prepareNotificationPermissions(): Promise<boolean> {
    return ensureNotificationPermission({ allowPrompt: true });
}

export async function resolveRemotePushAvailability(
    options: { allowPrompt: boolean }
): Promise<RemotePushAvailability> {
    const notifications = await getNotificationsModule();
    if (notifications === null) {
        return { kind: "unsupported" };
    }

    const granted = await ensureNotificationPermission({ allowPrompt: options.allowPrompt });
    if (!granted) {
        cachedRemotePushRegistration = null;
        cachedRemotePushRegistrationAt = 0;
        return { kind: "permission_denied" };
    }

    const cachedRegistration = cachedRemotePushRegistration;
    const cacheStillFresh = cachedRegistration !== null
        && (Date.now() - cachedRemotePushRegistrationAt) < REMOTE_PUSH_CACHE_TTL_MS;
    if (cacheStillFresh) {
        return {
            kind: "ready",
            registration: cachedRegistration,
        };
    }

    const projectId = readExpoProjectId();
    if (projectId === null) {
        useConnectionStore.getState().setError(
            "Remote push registration requires an Expo EAS projectId in the app config."
        );
        return { kind: "unavailable" };
    }

    try {
        const tokenResponse = await notifications.getExpoPushTokenAsync({ projectId });
        const pushToken = tokenResponse.data.trim();
        if (pushToken.length === 0) {
            useConnectionStore.getState().setError("Expo push token registration returned an empty token.");
            return { kind: "unavailable" };
        }

        const appVersion = readAppVersion();
        const nextRegistration: RemotePushRegistration = {
            provider: "expo",
            pushToken,
            platform: readNotificationPlatform(),
            ...(appVersion !== undefined ? { appVersion } : {}),
        };
        cachedRemotePushRegistration = nextRegistration;
        cachedRemotePushRegistrationAt = Date.now();

        return {
            kind: "ready",
            registration: nextRegistration,
        };
    } catch (error) {
        if (cachedRegistration !== null) {
            console.warn("[notifications] Reusing cached push registration after refresh failure", {
                error: readRemotePushRegistrationError(error),
            });
            return {
                kind: "ready",
                registration: cachedRegistration,
            };
        }

        useConnectionStore.getState().setError(
            `Failed to register remote notifications: ${readRemotePushRegistrationError(error)}`
        );
        return { kind: "unavailable" };
    }
}

export function markBridgeRemotePushRegistered(pushToken: string): void {
    bridgeRegisteredPushToken = pushToken;
}

export function clearBridgeRemotePushRegistration(): void {
    bridgeRegisteredPushToken = null;
}

export function hasBridgeRemotePushRegistration(): boolean {
    return bridgeRegisteredPushToken !== null;
}

export function isBridgeRemotePushCurrent(pushToken: string): boolean {
    return bridgeRegisteredPushToken === pushToken;
}

export async function initializeNotificationRouting(
    onSessionSelected: (sessionId: string) => void
): Promise<void> {
    const notifications = await getNotificationsModule();
    if (notifications === null) {
        return;
    }

    await initializeNotifications();

    if (notificationResponseSubscription === null) {
        notificationResponseSubscription = notifications.addNotificationResponseReceivedListener((response) => {
            if (!shouldHandleNotificationResponse(response)) {
                return;
            }

            const sessionId = readNotificationSessionId(response);
            if (sessionId !== null) {
                onSessionSelected(sessionId);
                void notifications.clearLastNotificationResponseAsync();
            }
        });
    }

    const initialResponse = await notifications.getLastNotificationResponseAsync();
    if (!shouldHandleNotificationResponse(initialResponse)) {
        return;
    }

    const sessionId = readNotificationSessionId(initialResponse);
    if (sessionId !== null) {
        onSessionSelected(sessionId);
        await notifications.clearLastNotificationResponseAsync();
    }
}

export async function notifySessionCompleted(input: {
    sessionId: string;
    title: string;
    body: string;
}): Promise<void> {
    await scheduleSessionNotification({
        sessionId: input.sessionId,
        title: input.title,
        body: input.body,
        kind: "session-complete",
        eventType: "completion",
    });
}

export async function notifySessionActionRequired(input: {
    sessionId: string;
    requestId: string;
    title: string;
    body: string;
    eventType: "permission_prompt" | "user_input_prompt";
}): Promise<void> {
    if (!rememberLocalNotificationKey(input.requestId)) {
        return;
    }

    await scheduleSessionNotification({
        sessionId: input.sessionId,
        title: input.title,
        body: input.body,
        kind: "session-event",
        eventType: input.eventType,
    });
}

export function getPresentedCompletionNotificationIds(
    presentedNotifications: ReadonlyArray<{
        request: {
            identifier: string;
            content: {
                data?: Record<string, unknown>;
            };
        };
    }>
): ReadonlyArray<string> {
    return presentedNotifications
        .filter((notification) => notification.request.content.data?.["kind"] === "session-complete")
        .map((notification) => notification.request.identifier);
}

async function scheduleSessionNotification(input: {
    sessionId: string;
    title: string;
    body: string;
    kind: "session-complete" | "session-event";
    eventType: SessionNotificationEventType;
}): Promise<void> {
    const now = Date.now();
    const notificationKey = createSessionNotificationEventKey(input.sessionId, input.eventType);
    if (hasRecentRemoteSessionNotification(notificationKey, now)) {
        return;
    }

    if (!rememberLocalSessionNotification(notificationKey, now)) {
        return;
    }

    const granted = await ensureNotificationPermission({ allowPrompt: false });
    if (!granted) {
        return;
    }

    const notifications = await getNotificationsModule();
    if (notifications === null) {
        return;
    }

    try {
        await notifications.scheduleNotificationAsync({
            content: {
                title: input.title,
                body: input.body,
                sound: true,
                ...(Platform.OS === "android" ? { channelId: SESSION_EVENTS_CHANNEL_ID } : {}),
                data: { sessionId: input.sessionId, kind: input.kind },
            },
            trigger: null,
        });
    } catch (error) {
        useConnectionStore.getState().setError(
            `Failed to schedule session notification: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export async function dismissCompletionNotifications(): Promise<void> {
    const notifications = await getNotificationsModule();
    if (notifications === null) return;

    try {
        const presentedNotifications = await notifications.getPresentedNotificationsAsync();
        const completionNotificationIds = getPresentedCompletionNotificationIds(presentedNotifications);

        await Promise.all(
            completionNotificationIds.map((identifier) => notifications.dismissNotificationAsync(identifier))
        );
    } catch (error) {
        useConnectionStore.getState().setError(
            `Failed to clear completion notifications: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

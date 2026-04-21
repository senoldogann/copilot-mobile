import { Platform } from "react-native";
import Constants from "expo-constants";
import { useConnectionStore } from "../stores/connection-store";

const SESSION_EVENTS_CHANNEL_ID = "session-events";

let initialized = false;
let notificationResponseSubscription: { remove: () => void } | null = null;
let lastHandledNotificationId: string | null = null;
let notificationsModulePromise: Promise<typeof import("expo-notifications") | null> | null = null;

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

export async function initializeNotifications(): Promise<void> {
    const notifications = await getNotificationsModule();
    if (notifications === null) return;

    if (!initialized) {
        notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });
        initialized = true;
    }

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
                data: { sessionId: input.sessionId, kind: "session-complete" },
            },
            trigger: null,
        });
    } catch (error) {
        useConnectionStore.getState().setError(
            `Failed to schedule completion notification: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export async function dismissCompletionNotifications(): Promise<void> {
    const notifications = await getNotificationsModule();
    if (notifications === null) return;

    try {
        await notifications.dismissAllNotificationsAsync();
    } catch (error) {
        useConnectionStore.getState().setError(
            `Failed to clear completion notifications: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

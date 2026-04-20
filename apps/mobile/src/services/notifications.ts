import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useConnectionStore } from "../stores/connection-store";

const SESSION_EVENTS_CHANNEL_ID = "session-events";

let initialized = false;
let permissionRequested = false;

function hasNotificationPermission(settings: Notifications.NotificationPermissionsStatus): boolean {
    return settings.granted
        || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function initializeNotifications(): Promise<void> {
    if (!initialized) {
        Notifications.setNotificationHandler({
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
        await Notifications.setNotificationChannelAsync(SESSION_EVENTS_CHANNEL_ID, {
            name: "Session events",
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 120, 250],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
    }
}

async function ensureNotificationPermission(options: { allowPrompt: boolean }): Promise<boolean> {
    await initializeNotifications();

    const currentSettings = await Notifications.getPermissionsAsync();
    if (hasNotificationPermission(currentSettings)) {
        return true;
    }

    if (!options.allowPrompt || permissionRequested) {
        return false;
    }

    permissionRequested = true;
    const requestedSettings = await Notifications.requestPermissionsAsync({
        ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: true,
        },
    });

    return hasNotificationPermission(requestedSettings);
}

export async function prepareNotificationPermissions(): Promise<boolean> {
    return ensureNotificationPermission({ allowPrompt: true });
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

    try {
        await Notifications.scheduleNotificationAsync({
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
    try {
        await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
        useConnectionStore.getState().setError(
            `Failed to clear completion notifications: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import {
    listSessions,
    requestCapabilities,
    resumeSession,
    tryResumeFromStoredCredentials,
} from "./bridge";
import { loadActiveSessionId, loadSessionPreferences } from "./credentials";
import {
    dismissCompletionNotifications,
    initializeNotifications,
    initializeNotificationRouting,
    prepareNotificationPermissions,
} from "./notifications";
import { useConnectionStore } from "../stores/connection-store";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useSessionStore } from "../stores/session-store";
import { armBackgroundCompletion, clearBackgroundCompletion } from "./background-completion";

let currentAppState: AppStateStatus = AppState.currentState;
let runtimeInitialized = false;

function openSessionFromNotification(sessionId: string): void {
    const sessionStore = useSessionStore.getState();
    const connectionStore = useConnectionStore.getState();

    void dismissCompletionNotifications();

    sessionStore.setActiveSession(sessionId);
    sessionStore.setSessionLoading(true);

    if (connectionStore.state === "authenticated") {
        void resumeSession(sessionId);
        return;
    }

    void tryResumeFromStoredCredentials({
        reconnectOnFailure: true,
        reportErrors: true,
    });
}

function syncOnForeground(): void {
    const sessionStore = useSessionStore.getState();
    const connectionStore = useConnectionStore.getState();
    const activeSessionId = sessionStore.activeSessionId;

    void dismissCompletionNotifications();
    void prepareNotificationPermissions();

    if (activeSessionId !== null) {
        sessionStore.setSessionLoading(true);
    }

    if (connectionStore.state === "authenticated") {
        void listSessions();
        void requestCapabilities();
        if (activeSessionId !== null) {
            void resumeSession(activeSessionId);
        }
        return;
    }

    if (connectionStore.state === "disconnected") {
        void tryResumeFromStoredCredentials({
            reconnectOnFailure: false,
            reportErrors: false,
        });
    }
}

async function hydrateMobileState(): Promise<void> {
    await useChatHistoryStore.getState().hydrate();

    const sessionStore = useSessionStore.getState();
    const storedPreferences = await loadSessionPreferences();
    if (storedPreferences !== null) {
        sessionStore.hydratePreferences(storedPreferences);
    }

    if (sessionStore.activeSessionId !== null) {
        return;
    }

    const storedActiveSessionId = await loadActiveSessionId();
    if (storedActiveSessionId !== null) {
        sessionStore.setActiveSession(storedActiveSessionId);
    }
}

function handleAppStateChange(nextAppState: AppStateStatus): void {
    const previousAppState = currentAppState;
    currentAppState = nextAppState;

    if (nextAppState !== "active") {
        const sessionStore = useSessionStore.getState();
        if (sessionStore.activeSessionId !== null && sessionStore.isAssistantTyping) {
            armBackgroundCompletion(sessionStore.activeSessionId);
        }
        return;
    }

    if (previousAppState !== "active") {
        clearBackgroundCompletion();
        syncOnForeground();
    }
}

export function initializeAppRuntime(): () => void {
    if (runtimeInitialized) {
        return () => undefined;
    }

    runtimeInitialized = true;
    void initializeNotifications();
    void initializeNotificationRouting(openSessionFromNotification);
    if (currentAppState === "active") {
        void prepareNotificationPermissions();
    }
    void (async () => {
        await hydrateMobileState();
        await tryResumeFromStoredCredentials({
            reconnectOnFailure: false,
            reportErrors: false,
        });
    })();
    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
        subscription.remove();
        runtimeInitialized = false;
    };
}

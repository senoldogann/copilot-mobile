import { AppState, InteractionManager } from "react-native";
import type { AppStateStatus } from "react-native";
import {
    listSessions,
    reportNotificationPresence,
    requestCapabilities,
    resumeSession,
    syncRemoteNotificationRegistration,
    tryResumeFromStoredCredentials,
} from "./bridge";
import { loadActiveSessionId, loadSessionPreferences } from "./credentials";
import {
    dismissCompletionNotifications,
    initializeNotifications,
    initializeNotificationRouting,
} from "./notifications";
import { useConnectionStore } from "../stores/connection-store";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceDirectoryStore } from "../stores/workspace-directory-store";
import { getAppVisibilityState, setAppVisibilityState } from "./app-visibility";
import { armBackgroundCompletion, clearBackgroundCompletion } from "./background-completion";

let currentAppState: AppStateStatus = getAppVisibilityState();
let runtimeInitialized = false;
let runtimeBootstrapId = 0;
let mobileStateHydrated = false;
let foregroundResumeTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

function createRuntimeBootstrapId(): number {
    runtimeBootstrapId += 1;
    return runtimeBootstrapId;
}

function isRuntimeBootstrapCurrent(bootstrapId: number): boolean {
    return runtimeInitialized && bootstrapId === runtimeBootstrapId;
}

function clearForegroundResumeTask(): void {
    if (foregroundResumeTask === null) {
        return;
    }

    foregroundResumeTask.cancel();
    foregroundResumeTask = null;
}

function scheduleForegroundSessionResume(sessionId: string, immediate: boolean): void {
    clearForegroundResumeTask();

    const runResume = (): void => {
        if (currentAppState !== "active") {
            return;
        }

        const activeSessionId = useSessionStore.getState().activeSessionId;
        if (activeSessionId !== sessionId) {
            return;
        }

        void resumeSession(sessionId);
    };

    if (immediate) {
        runResume();
        return;
    }

    foregroundResumeTask = InteractionManager.runAfterInteractions(() => {
        foregroundResumeTask = null;
        runResume();
    });
}

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
    const hasVisibleChatState = sessionStore.chatItems.length > 0 || sessionStore.isAssistantTyping;

    void dismissCompletionNotifications();
    void syncRemoteNotificationRegistration({
        allowPrompt: false,
        force: false,
    });

    if (activeSessionId === null) {
        sessionStore.setSessionLoading(false);
        sessionStore.setAssistantTyping(false);
    }

    if (activeSessionId !== null) {
        sessionStore.setSessionLoading(
            connectionStore.state !== "authenticated" || !hasVisibleChatState
        );
    }

    if (connectionStore.state === "authenticated") {
        void listSessions();
        void requestCapabilities();
        if (activeSessionId !== null) {
            scheduleForegroundSessionResume(activeSessionId, !hasVisibleChatState);
        }
        return;
    }

    if (connectionStore.state === "disconnected") {
        void tryResumeFromStoredCredentials({
            reconnectOnFailure: true,
            reportErrors: false,
        });
    }
}

async function hydrateMobileState(bootstrapId: number): Promise<void> {
    const chatHistoryStore = useChatHistoryStore.getState();
    await chatHistoryStore.hydrate();
    if (!isRuntimeBootstrapCurrent(bootstrapId)) {
        return;
    }

    await useWorkspaceDirectoryStore.getState().hydrate();
    if (!isRuntimeBootstrapCurrent(bootstrapId)) {
        return;
    }

    const persistedConversationId = chatHistoryStore.activeConversationId;
    if (persistedConversationId !== null) {
        useSessionStore.getState().replaceChatItems(
            chatHistoryStore.getConversationItems(persistedConversationId)
        );
    }
    if (!isRuntimeBootstrapCurrent(bootstrapId)) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    const storedPreferences = await loadSessionPreferences();
    if (!isRuntimeBootstrapCurrent(bootstrapId)) {
        return;
    }
    if (storedPreferences !== null) {
        sessionStore.hydratePreferences(storedPreferences);
    }

    if (sessionStore.activeSessionId !== null) {
        mobileStateHydrated = true;
        return;
    }

    const storedActiveSessionId = await loadActiveSessionId();
    if (!isRuntimeBootstrapCurrent(bootstrapId)) {
        return;
    }
    if (storedActiveSessionId !== null) {
        sessionStore.setActiveSession(storedActiveSessionId);
    }

    mobileStateHydrated = true;
}

function startRuntimeBootstrap(options: { rehydrate: boolean }): void {
    const bootstrapId = createRuntimeBootstrapId();

    void (async () => {
        if (options.rehydrate && !mobileStateHydrated) {
            await hydrateMobileState(bootstrapId);
            if (!isRuntimeBootstrapCurrent(bootstrapId)) {
                return;
            }
        }
        await tryResumeFromStoredCredentials({
            reconnectOnFailure: true,
            reportErrors: false,
        });
    })();
}

function handleAppStateChange(nextAppState: AppStateStatus): void {
    const previousAppState = currentAppState;
    currentAppState = nextAppState;
    setAppVisibilityState(nextAppState);
    void reportNotificationPresence(nextAppState);

    if (nextAppState !== "active") {
        createRuntimeBootstrapId();
        clearForegroundResumeTask();
        const sessionStore = useSessionStore.getState();
        if (sessionStore.activeSessionId !== null && sessionStore.isAssistantTyping) {
            armBackgroundCompletion(sessionStore.activeSessionId);
        }
        return;
    }

    if (previousAppState === "active") {
        return;
    }

    clearBackgroundCompletion();
    syncOnForeground();
}

export function initializeAppRuntime(): () => void {
    if (runtimeInitialized) {
        return () => undefined;
    }

    runtimeInitialized = true;
    setAppVisibilityState(AppState.currentState);
    currentAppState = getAppVisibilityState();
    void initializeNotifications();
    void initializeNotificationRouting(openSessionFromNotification);
    if (currentAppState === "active") {
        void syncRemoteNotificationRegistration({
            allowPrompt: false,
            force: false,
        });
    }
    startRuntimeBootstrap({ rehydrate: true });
    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
        createRuntimeBootstrapId();
        clearForegroundResumeTask();
        subscription.remove();
        runtimeInitialized = false;
        mobileStateHydrated = false;
    };
}

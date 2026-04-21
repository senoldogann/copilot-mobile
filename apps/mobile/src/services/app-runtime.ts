import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import {
    listSessions,
    requestCapabilities,
    resumeSession,
    tryResumeFromStoredCredentials,
} from "./bridge";
import { loadActiveSessionId } from "./credentials";
import {
    dismissCompletionNotifications,
    initializeNotifications,
    notifySessionCompleted,
    prepareNotificationPermissions,
} from "./notifications";
import { useConnectionStore } from "../stores/connection-store";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useSessionStore } from "../stores/session-store";

let currentAppState: AppStateStatus = AppState.currentState;
let runtimeInitialized = false;
const pendingCompletionSessions = new Set<string>();

function sanitizeNotificationText(input: string): string {
    const singleLine = input.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 160) {
        return singleLine;
    }
    return `${singleLine.slice(0, 157)}...`;
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
        void tryResumeFromStoredCredentials();
    }
}

async function hydrateMobileState(): Promise<void> {
    await useChatHistoryStore.getState().hydrate();

    const sessionStore = useSessionStore.getState();
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
            pendingCompletionSessions.add(sessionStore.activeSessionId);
        }
        return;
    }

    if (previousAppState !== "active") {
        pendingCompletionSessions.clear();
        syncOnForeground();
    }
}

export function isAppInForeground(): boolean {
    return currentAppState === "active";
}

export function armBackgroundCompletion(sessionId: string): void {
    if (!isAppInForeground()) {
        pendingCompletionSessions.add(sessionId);
    }
}

export function clearBackgroundCompletion(sessionId?: string): void {
    if (sessionId === undefined) {
        pendingCompletionSessions.clear();
        return;
    }
    pendingCompletionSessions.delete(sessionId);
}

export function notifyIfBackgroundCompletion(sessionId: string): void {
    if (isAppInForeground() || !pendingCompletionSessions.has(sessionId)) {
        return;
    }

    pendingCompletionSessions.delete(sessionId);

    const sessionStore = useSessionStore.getState();
    const session = sessionStore.sessions.find((item) => item.id === sessionId);
    const latestAssistant = [...sessionStore.chatItems]
        .reverse()
        .find((item): item is Extract<(typeof sessionStore.chatItems)[number], { type: "assistant" }> =>
            item.type === "assistant" && item.content.trim().length > 0
        );

    const title = session?.title?.trim().length
        ? session.title.trim()
        : "Copilot finished working";
    const body = latestAssistant !== undefined
        ? sanitizeNotificationText(latestAssistant.content)
        : "Open Copilot Mobile to review the latest session output.";

    void notifySessionCompleted({ sessionId, title, body });
}

export function initializeAppRuntime(): () => void {
    if (runtimeInitialized) {
        return () => undefined;
    }

    runtimeInitialized = true;
    void initializeNotifications();
    if (currentAppState === "active") {
        void prepareNotificationPermissions();
    }
    void (async () => {
        await hydrateMobileState();
        await tryResumeFromStoredCredentials();
    })();
    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
        subscription.remove();
        runtimeInitialized = false;
    };
}

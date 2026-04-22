import { useSessionStore } from "../stores/session-store";
import { isAppActive } from "./app-visibility";
import { notifySessionCompleted } from "./notifications";

const MAX_TRACKED_BACKGROUND_SESSIONS = 100;
const pendingCompletionSessions = new Set<string>();
const latestAssistantContentBySession = new Map<string, string>();
const notifiedCompletionSessions = new Set<string>();

function trimOldestTrackedSession(): void {
    const oldestPending = pendingCompletionSessions.values().next().value;
    if (typeof oldestPending === "string") {
        pendingCompletionSessions.delete(oldestPending);
        latestAssistantContentBySession.delete(oldestPending);
        notifiedCompletionSessions.delete(oldestPending);
        return;
    }

    const oldestPreview = latestAssistantContentBySession.keys().next().value;
    if (typeof oldestPreview === "string") {
        latestAssistantContentBySession.delete(oldestPreview);
        pendingCompletionSessions.delete(oldestPreview);
        notifiedCompletionSessions.delete(oldestPreview);
    }
}

function enforceTrackedSessionLimit(): void {
    while (
        pendingCompletionSessions.size > MAX_TRACKED_BACKGROUND_SESSIONS
        || latestAssistantContentBySession.size > MAX_TRACKED_BACKGROUND_SESSIONS
        || notifiedCompletionSessions.size > MAX_TRACKED_BACKGROUND_SESSIONS
    ) {
        trimOldestTrackedSession();
    }
}

function sanitizeNotificationText(input: string): string {
    const singleLine = input.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 160) {
        return singleLine;
    }
    return `${singleLine.slice(0, 157)}...`;
}

export function armBackgroundCompletion(sessionId: string): void {
    if (!isAppActive() && !notifiedCompletionSessions.has(sessionId)) {
        pendingCompletionSessions.add(sessionId);
        enforceTrackedSessionLimit();
    }
}

export function clearBackgroundCompletion(sessionId?: string): void {
    if (sessionId === undefined) {
        pendingCompletionSessions.clear();
        latestAssistantContentBySession.clear();
        notifiedCompletionSessions.clear();
        return;
    }

    pendingCompletionSessions.delete(sessionId);
    latestAssistantContentBySession.delete(sessionId);
    notifiedCompletionSessions.delete(sessionId);
}

export function replaceBackgroundCompletionPreview(sessionId: string, content: string): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return;
    }

    latestAssistantContentBySession.set(sessionId, trimmed);
    enforceTrackedSessionLimit();
}

export function appendBackgroundCompletionPreview(sessionId: string, delta: string): void {
    if (delta.length === 0) {
        return;
    }

    const nextContent = `${latestAssistantContentBySession.get(sessionId) ?? ""}${delta}`.trim();
    if (nextContent.length === 0) {
        return;
    }

    latestAssistantContentBySession.set(sessionId, nextContent);
    enforceTrackedSessionLimit();
}

export function notifyIfBackgroundCompletion(sessionId: string): void {
    if (isAppActive() || !pendingCompletionSessions.has(sessionId)) {
        return;
    }

    pendingCompletionSessions.delete(sessionId);
    notifiedCompletionSessions.add(sessionId);
    enforceTrackedSessionLimit();

    const sessionStore = useSessionStore.getState();
    const session = sessionStore.sessions.find((item) => item.id === sessionId);
    const cachedAssistantContent = latestAssistantContentBySession.get(sessionId);
    const latestAssistant = sessionStore.activeSessionId === sessionId
        ? [...sessionStore.chatItems]
            .reverse()
            .find((item): item is Extract<(typeof sessionStore.chatItems)[number], { type: "assistant" }> =>
                item.type === "assistant" && item.content.trim().length > 0
            )
        : undefined;

    const title = session?.title?.trim().length
        ? session.title.trim()
        : "Session finished";
    const body = latestAssistant !== undefined
        ? sanitizeNotificationText(latestAssistant.content)
        : cachedAssistantContent !== undefined
            ? sanitizeNotificationText(cachedAssistantContent)
        : "Open Code Companion to review the latest session output.";

    latestAssistantContentBySession.delete(sessionId);

    void notifySessionCompleted({ sessionId, title, body });
}

export function notifyBackgroundCompletionFailure(sessionId: string, errorMessage: string): void {
    if (isAppActive() || !pendingCompletionSessions.has(sessionId)) {
        return;
    }

    pendingCompletionSessions.delete(sessionId);
    latestAssistantContentBySession.delete(sessionId);
    notifiedCompletionSessions.add(sessionId);
    enforceTrackedSessionLimit();

    const sessionStore = useSessionStore.getState();
    const session = sessionStore.sessions.find((item) => item.id === sessionId);
    const title = session?.title?.trim().length
        ? session.title.trim()
        : "Session failed";
    const body = sanitizeNotificationText(errorMessage);

    void notifySessionCompleted({ sessionId, title, body });
}

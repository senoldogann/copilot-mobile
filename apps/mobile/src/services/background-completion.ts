import { AppState } from "react-native";
import { useSessionStore } from "../stores/session-store";
import { notifySessionCompleted } from "./notifications";

const pendingCompletionSessions = new Set<string>();
const latestAssistantContentBySession = new Map<string, string>();

function sanitizeNotificationText(input: string): string {
    const singleLine = input.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 160) {
        return singleLine;
    }
    return `${singleLine.slice(0, 157)}...`;
}

function isAppInForeground(): boolean {
    return AppState.currentState === "active";
}

export function armBackgroundCompletion(sessionId: string): void {
    if (!isAppInForeground()) {
        pendingCompletionSessions.add(sessionId);
    }
}

export function clearBackgroundCompletion(sessionId?: string): void {
    if (sessionId === undefined) {
        pendingCompletionSessions.clear();
        latestAssistantContentBySession.clear();
        return;
    }

    pendingCompletionSessions.delete(sessionId);
    latestAssistantContentBySession.delete(sessionId);
}

export function replaceBackgroundCompletionPreview(sessionId: string, content: string): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return;
    }

    latestAssistantContentBySession.set(sessionId, trimmed);
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
}

export function notifyIfBackgroundCompletion(sessionId: string): void {
    if (isAppInForeground() || !pendingCompletionSessions.has(sessionId)) {
        return;
    }

    pendingCompletionSessions.delete(sessionId);

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
        : "Copilot finished working";
    const body = latestAssistant !== undefined
        ? sanitizeNotificationText(latestAssistant.content)
        : cachedAssistantContent !== undefined
            ? sanitizeNotificationText(cachedAssistantContent)
        : "Open Copilot Mobile to review the latest session output.";

    latestAssistantContentBySession.delete(sessionId);

    void notifySessionCompleted({ sessionId, title, body });
}

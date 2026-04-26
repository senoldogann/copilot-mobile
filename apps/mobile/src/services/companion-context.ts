import { loadCredentials } from "./credentials";
import {
    getCompanionScopeKey,
    getCurrentCompanionScopeKey,
    setCurrentCompanionScopeKey,
} from "./companion-scope";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceDirectoryStore } from "../stores/workspace-directory-store";
import { useWorkspaceStore } from "../stores/workspace-store";

export async function initializeCompanionContextFromStoredCredentials(): Promise<void> {
    const credentials = await loadCredentials();
    const scopeKey = getCompanionScopeKey(credentials?.deviceId ?? null);
    setCurrentCompanionScopeKey(scopeKey);
    await Promise.all([
        useChatHistoryStore.getState().switchScope(scopeKey),
        useWorkspaceDirectoryStore.getState().switchScope(scopeKey),
    ]);
}

export async function switchToAuthenticatedCompanion(deviceId: string): Promise<void> {
    const nextScopeKey = getCompanionScopeKey(deviceId);
    if (nextScopeKey === getCurrentCompanionScopeKey()) {
        return;
    }

    setCurrentCompanionScopeKey(nextScopeKey);
    useSessionStore.getState().reset();
    useWorkspaceStore.getState().resetWorkspace();
    useConnectionStore.getState().setError(null);

    await Promise.all([
        useChatHistoryStore.getState().switchScope(nextScopeKey),
        useWorkspaceDirectoryStore.getState().switchScope(nextScopeKey),
    ]);
}

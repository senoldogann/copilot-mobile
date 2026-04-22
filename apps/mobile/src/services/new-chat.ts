import { useChatHistoryStore } from "../stores/chat-history-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceDirectoryStore } from "../stores/workspace-directory-store";
import { useWorkspaceStore } from "../stores/workspace-store";

export function startDraftConversation(workspaceRoot: string | null): void {
    const sessionStore = useSessionStore.getState();
    const historyStore = useChatHistoryStore.getState();

    if (historyStore.activeConversationId !== null) {
        historyStore.setConversationItems(historyStore.activeConversationId, sessionStore.chatItems);
    }

    const conversationId = historyStore.createConversation(null, workspaceRoot);
    if (workspaceRoot !== null) {
        useWorkspaceDirectoryStore.getState().touchDirectory(workspaceRoot);
    }
    sessionStore.deferActivePrompts();
    useWorkspaceStore.getState().resetWorkspace();

    sessionStore.replaceChatItems([]);
    sessionStore.setActiveSession(null);
    sessionStore.setSessionLoading(false);
    sessionStore.setAssistantTyping(false);
    sessionStore.setPlanExitPrompt(null);
    useConnectionStore.getState().setError(null);

    historyStore.setActiveConversation(conversationId);
}

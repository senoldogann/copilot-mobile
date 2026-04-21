import { useChatHistoryStore } from "../stores/chat-history-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { respondPermission, respondUserInput } from "./bridge";

export function startDraftConversation(): void {
    const sessionStore = useSessionStore.getState();

    if (sessionStore.permissionPrompt !== null) {
        void respondPermission(sessionStore.permissionPrompt.requestId, false);
    }
    if (sessionStore.userInputPrompt !== null) {
        void respondUserInput(sessionStore.userInputPrompt.requestId, "");
    }

    sessionStore.clearChatItems();
    sessionStore.setActiveSession(null);
    sessionStore.setSessionLoading(false);
    sessionStore.setPermissionPrompt(null);
    sessionStore.setUserInputPrompt(null);
    sessionStore.setPlanExitPrompt(null);
    useConnectionStore.getState().setError(null);

    useChatHistoryStore.getState().createConversation(null);
}
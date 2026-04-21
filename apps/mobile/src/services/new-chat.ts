import { useChatHistoryStore } from "../stores/chat-history-store";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { respondPermission, respondUserInput } from "./bridge";

export function startDraftConversation(workspaceRoot: string | null): void {
    const sessionStore = useSessionStore.getState();
    const pendingPermissionRequestId = sessionStore.permissionPrompt?.requestId ?? null;
    const pendingUserInputRequestId = sessionStore.userInputPrompt?.requestId ?? null;

    sessionStore.clearChatItems();
    sessionStore.setActiveSession(null);
    sessionStore.setSessionLoading(false);
    sessionStore.clearPermissionPrompts();
    sessionStore.setUserInputPrompt(null);
    sessionStore.setPlanExitPrompt(null);
    useConnectionStore.getState().setError(null);

    if (pendingPermissionRequestId !== null) {
        void respondPermission(pendingPermissionRequestId, false);
    }
    if (pendingUserInputRequestId !== null) {
        void respondUserInput(pendingUserInputRequestId, "");
    }

    useChatHistoryStore.getState().createConversation(null, workspaceRoot);
}

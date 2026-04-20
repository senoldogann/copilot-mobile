// Bridge message dispatcher — routes ServerMessages to Zustand stores

import type { ServerMessage, SessionHistoryItem } from "@copilot-mobile/shared";
import { useConnectionStore } from "../stores/connection-store";
import type { ChatItem } from "../stores/session-store";
import { useSessionStore } from "../stores/session-store";
import { useChatHistoryStore } from "../stores/chat-history-store";

function collectPermissionDetails(metadata: Record<string, unknown>): Array<string> {
    const details: Array<string> = [];

    const intention = metadata["intention"];
    if (typeof intention === "string" && intention.trim().length > 0) {
        details.push(intention.trim());
    }

    const path = metadata["path"];
    if (typeof path === "string" && path.trim().length > 0) {
        details.push(path.trim());
    }

    const url = metadata["url"];
    if (typeof url === "string" && url.trim().length > 0) {
        details.push(url.trim());
    }

    return details;
}

function mapHistoryItemToChatItem(item: SessionHistoryItem): ChatItem {
    switch (item.type) {
        case "user":
            return item;

        case "assistant":
            return {
                ...item,
                isStreaming: false,
            };

        case "thinking":
            return {
                ...item,
                isStreaming: false,
            };

        case "tool":
            return item;
    }
}

function mergeHistoryIntoExistingItems(
    currentItems: ReadonlyArray<ChatItem>,
    historyItems: ReadonlyArray<SessionHistoryItem>
): Array<ChatItem> {
    const nextItems = [...currentItems];

    for (const historyItem of historyItems) {
        if (historyItem.type === "user" || historyItem.type === "assistant" || historyItem.type === "thinking") {
            const alreadyExists = nextItems.some((item) =>
                item.type === historyItem.type && item.content === historyItem.content
            );
            if (!alreadyExists) {
                nextItems.push(mapHistoryItemToChatItem(historyItem));
            }
            continue;
        }

        const existingIndex = nextItems.findIndex((item) =>
            item.type === "tool" && item.requestId === historyItem.requestId
        );

        if (existingIndex === -1) {
            nextItems.push(historyItem);
            continue;
        }

        const existingItem = nextItems[existingIndex];
        if (existingItem !== undefined && existingItem.type === "tool") {
            nextItems[existingIndex] = {
                ...existingItem,
                status: historyItem.status,
                ...(historyItem.argumentsText !== undefined
                    ? { argumentsText: historyItem.argumentsText }
                    : {}),
                ...(historyItem.progressMessage !== undefined
                    ? { progressMessage: historyItem.progressMessage }
                    : {}),
                ...(historyItem.partialOutput !== undefined
                    ? { partialOutput: historyItem.partialOutput }
                    : {}),
            };
        }
    }

    return [...nextItems].sort((left, right) => left.timestamp - right.timestamp);
}

function formatToolArguments(
    args: Record<string, unknown> | undefined
): string | undefined {
    if (args === undefined) {
        return undefined;
    }

    const keys = Object.keys(args);
    if (keys.length === 0) {
        return undefined;
    }

    return JSON.stringify(args, null, 2);
}

// Derleme zamanı exhaustiveness kontrolü — runtime'da çökme yerine uyarı verir
function assertExhaustive(_value: never, type: string): void {
    console.warn("Unknown server message:", type);
}

export function handleServerMessage(message: ServerMessage): void {
    const connectionStore = useConnectionStore.getState();
    const sessionStore = useSessionStore.getState();

    // Aktif oturum kontrolü — çapraz oturum veri karışmasını engeller
    const isActiveSession = (sessionId: string | undefined): boolean => {
        if (sessionId === undefined) return true; // Bazı mesajlarda sessionId yoktur
        const { activeSessionId } = useSessionStore.getState();
        return activeSessionId !== null && activeSessionId === sessionId;
    };

    switch (message.type) {
        case "pairing.success": {
            connectionStore.setDeviceId(message.payload.deviceId);
            connectionStore.setState("authenticated");
            break;
        }

        case "session.created": {
            sessionStore.setSessionLoading(false);
            sessionStore.setActiveSession(message.payload.session.id);
            sessionStore.upsertSession(message.payload.session);

            // Link active conversation to this session.
            const chatHistoryStore = useChatHistoryStore.getState();
            const activeConvId = chatHistoryStore.activeConversationId;
            if (activeConvId !== null) {
                chatHistoryStore.linkConversationToSession(
                    activeConvId,
                    message.payload.session.id
                );
            }
            break;
        }

        case "session.resumed": {
            sessionStore.setSessionLoading(false);
            sessionStore.setActiveSession(message.payload.session.id);
            sessionStore.upsertSession(message.payload.session);
            break;
        }

        case "session.idle": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setAssistantTyping(false);
            sessionStore.finalizeThinking();
            break;
        }

        case "session.list": {
            sessionStore.setSessions(message.payload.sessions);
            break;
        }

        case "session.history": {
            const { activeSessionId } = useSessionStore.getState();
            if (activeSessionId === null || activeSessionId !== message.payload.sessionId) {
                console.warn("[MessageHandler] session.history: sessionId eşleşmiyor, yoksayılıyor");
                break;
            }
            if (sessionStore.chatItems.length > 0) {
                sessionStore.replaceChatItems(
                    mergeHistoryIntoExistingItems(sessionStore.chatItems, message.payload.items)
                );
                break;
            }
            sessionStore.replaceChatItems(
                message.payload.items.map(mapHistoryItemToChatItem)
            );
            break;
        }

        case "assistant.message": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.finalizeAssistantMessage(message.payload.content);
            break;
        }

        case "assistant.message_delta": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setAssistantTyping(true);
            sessionStore.appendAssistantDelta(message.payload.delta);
            break;
        }

        case "assistant.reasoning": {
            if (!isActiveSession(message.payload.sessionId)) break;
            // Full reasoning message — finalize thinking stream
            sessionStore.finalizeThinking();
            break;
        }

        case "assistant.reasoning_delta": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.appendThinkingDelta(message.payload.delta);
            break;
        }

        case "tool.execution_start": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.addToolStart(
                message.payload.requestId,
                message.payload.toolName,
                formatToolArguments(message.payload.arguments),
            );
            break;
        }

        case "tool.execution_partial_result": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.appendToolPartialOutput(
                message.payload.requestId,
                message.payload.partialOutput
            );
            break;
        }

        case "tool.execution_progress": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.updateToolProgress(
                message.payload.requestId,
                message.payload.progressMessage
            );
            break;
        }

        case "tool.execution_complete": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.updateToolStatus(
                message.payload.requestId,
                message.payload.success ? "completed" : "failed"
            );
            break;
        }

        case "permission.request": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setPermissionPrompt({
                sessionId: message.payload.sessionId,
                requestId: message.payload.requestId,
                kind: message.payload.kind,
                toolName: message.payload.toolName ?? null,
                fileName: message.payload.fileName ?? null,
                commandText: message.payload.fullCommandText ?? null,
                details: collectPermissionDetails(message.payload.metadata),
            });
            break;
        }

        case "user_input.request": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setUserInputPrompt({
                sessionId: message.payload.sessionId,
                requestId: message.payload.requestId,
                prompt: message.payload.prompt,
            });
            break;
        }

        case "models.list": {
            sessionStore.setModels(message.payload.models);
            break;
        }

        case "error": {
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            // Hata durumunda açık dialog'ları temizle — ekranda takılı kalmasın
            sessionStore.setPermissionPrompt(null);
            sessionStore.setUserInputPrompt(null);
            connectionStore.setError(
                `[${message.payload.code}] ${message.payload.message}`
            );
            break;
        }

        case "connection.status": {
            // Connection status is informational
            break;
        }

        case "token.refresh": {
            // Token handled at ws-client level, no store update needed
            break;
        }

        case "reconnect.ready": {
            break;
        }

        case "capabilities.state": {
            sessionStore.setHostCapabilities(message.payload.host);
            sessionStore.setBridgeSettings(message.payload.bridge);
            break;
        }

        case "session.error": {
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            sessionStore.setPermissionPrompt(null);
            sessionStore.setUserInputPrompt(null);
            connectionStore.setError(
                `[${message.payload.errorType}] ${message.payload.message}`
            );
            break;
        }

        case "session.title_changed": {
            const sessionId = message.payload.sessionId;
            const title = message.payload.title;
            if (sessionId !== undefined && title !== undefined) {
                const updated = sessionStore.sessions.map((s) =>
                    s.id === sessionId ? { ...s, title } : s
                );
                sessionStore.setSessions(updated);
            }
            break;
        }

        case "assistant.intent": {
            sessionStore.setCurrentIntent(message.payload.intent);
            break;
        }

        default: {
            assertExhaustive(message, (message as { type: string }).type);
            break;
        }
    }
}

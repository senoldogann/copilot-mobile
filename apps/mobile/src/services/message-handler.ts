// Bridge message dispatcher — routes ServerMessages to Zustand stores

import type { ServerMessage, SessionHistoryItem } from "@copilot-mobile/shared";
import { useConnectionStore } from "../stores/connection-store";
import type { ChatItem } from "../stores/session-store";
import { useSessionStore } from "../stores/session-store";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import {
    armBackgroundCompletion,
    clearBackgroundCompletion,
    notifyIfBackgroundCompletion,
} from "./app-runtime";
import { dispatchWorkspaceFileResponse, dispatchWorkspaceDiffResponse } from "./workspace-events";

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

function mapHistoryItemWithStreamingState(
    historyItem: Extract<SessionHistoryItem, { type: "assistant" | "thinking" }>,
    matchedItem: Extract<ChatItem, { type: "assistant" | "thinking" }> | undefined
): ChatItem {
    const mappedItem = mapHistoryItemToChatItem(historyItem);
    if (mappedItem.type !== "assistant" && mappedItem.type !== "thinking") {
        return mappedItem;
    }

    return {
        ...mappedItem,
        isStreaming: matchedItem?.isStreaming === true,
    };
}

function mergeHistoryIntoExistingItems(
    currentItems: ReadonlyArray<ChatItem>,
    historyItems: ReadonlyArray<SessionHistoryItem>
): Array<ChatItem> {
    const matchedIndexes = new Set<number>();
    const mergedItems: Array<ChatItem> = [];

    function areAttachmentsEquivalent(
        left: SessionHistoryItem & { type: "user" },
        right: Extract<ChatItem, { type: "user" }>
    ): boolean {
        const leftAttachments = left.attachments ?? [];
        const rightAttachments = right.attachments ?? [];

        if (leftAttachments.length !== rightAttachments.length) {
            return false;
        }

        return leftAttachments.every((attachment, index) => {
            const rightAttachment = rightAttachments[index];
            return rightAttachment !== undefined
                && attachment.mimeType === rightAttachment.mimeType
                && attachment.displayName === rightAttachment.displayName
                && attachment.data === rightAttachment.data;
        });
    }

    function isExactHistoryMessageMatch(
        historyItem: Extract<SessionHistoryItem, { type: "user" | "assistant" | "thinking" }>,
        existingItem: Extract<ChatItem, { type: "user" | "assistant" | "thinking" }>
    ): boolean {
        if (existingItem.type !== historyItem.type) {
            return false;
        }

        if (existingItem.id === historyItem.id) {
            return true;
        }

        if (existingItem.content !== historyItem.content) {
            return false;
        }

        if (historyItem.type === "user" && existingItem.type === "user") {
            return areAttachmentsEquivalent(historyItem, existingItem);
        }

        return true;
    }

    function findStreamingHistoryMatchIndex(
        historyItem: Extract<SessionHistoryItem, { type: "assistant" | "thinking" }>
    ): number {
        for (let index = currentItems.length - 1; index >= 0; index -= 1) {
            if (matchedIndexes.has(index)) {
                continue;
            }

            const item = currentItems[index];
            if (
                item === undefined
                || item.type !== historyItem.type
                || item.isStreaming !== true
            ) {
                continue;
            }

            if (historyItem.content.startsWith(item.content)) {
                return index;
            }
        }

        return -1;
    }

    for (const historyItem of historyItems) {
        if (historyItem.type === "user" || historyItem.type === "assistant" || historyItem.type === "thinking") {
            let existingIndex = currentItems.findIndex((item, index) =>
                !matchedIndexes.has(index)
                && (item.type === "user" || item.type === "assistant" || item.type === "thinking")
                && isExactHistoryMessageMatch(historyItem, item)
            );

            if (
                existingIndex === -1
                && (historyItem.type === "assistant" || historyItem.type === "thinking")
            ) {
                existingIndex = findStreamingHistoryMatchIndex(historyItem);
            }

            if (existingIndex === -1) {
                mergedItems.push(mapHistoryItemToChatItem(historyItem));
            } else {
                matchedIndexes.add(existingIndex);
                const matchedItem = currentItems[existingIndex];
                if (
                    (historyItem.type === "assistant" || historyItem.type === "thinking")
                    && matchedItem !== undefined
                    && (matchedItem.type === "assistant" || matchedItem.type === "thinking")
                ) {
                    mergedItems.push(mapHistoryItemWithStreamingState(historyItem, matchedItem));
                } else {
                    mergedItems.push(mapHistoryItemToChatItem(historyItem));
                }
            }
            continue;
        }

        const existingIndex = currentItems.findIndex((item, index) =>
            !matchedIndexes.has(index)
            && item.type === "tool"
            && item.requestId === historyItem.requestId
        );

        if (existingIndex === -1) {
            mergedItems.push(historyItem);
            continue;
        }

        const existingItem = currentItems[existingIndex];
        if (existingItem !== undefined && existingItem.type === "tool") {
            matchedIndexes.add(existingIndex);
            mergedItems.push({
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
            });
        }
    }

    for (const [index, item] of currentItems.entries()) {
        if (!matchedIndexes.has(index)) {
            mergedItems.push(item);
        }
    }

    return mergedItems;
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
            clearBackgroundCompletion(message.payload.session.id);

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
            clearBackgroundCompletion(message.payload.session.id);
            break;
        }

        case "session.idle": {
            notifyIfBackgroundCompletion(message.payload.sessionId);
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
            armBackgroundCompletion(message.payload.sessionId);
            sessionStore.setAssistantTyping(true);
            sessionStore.appendAssistantDelta(message.payload.delta, message.payload.index);
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
            armBackgroundCompletion(message.payload.sessionId);
            sessionStore.appendThinkingDelta(message.payload.delta, message.payload.index);
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
                ...(message.payload.choices !== undefined ? { choices: message.payload.choices } : {}),
                ...(message.payload.allowFreeform !== undefined
                    ? { allowFreeform: message.payload.allowFreeform }
                    : {}),
            });
            break;
        }

        case "models.list": {
            sessionStore.setModels(message.payload.models);
            break;
        }

        case "error": {
            clearBackgroundCompletion();
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            // Hata durumunda açık dialog'ları temizle — ekranda takılı kalmasın
            sessionStore.setPermissionPrompt(null);
            sessionStore.setUserInputPrompt(null);
            sessionStore.setPlanExitPrompt(null);
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

        case "skills.list.response": {
            sessionStore.setSkills(message.payload.skills);
            break;
        }

        case "session.state": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setAgentMode(message.payload.agentMode);
            sessionStore.setPermissionLevel(message.payload.permissionLevel);
            sessionStore.setRuntimeMode(message.payload.runtimeMode);
            if (message.payload.runtimeMode !== "plan") {
                sessionStore.setPlanExitPrompt(null);
            }
            break;
        }

        case "session.error": {
            clearBackgroundCompletion(message.payload.sessionId);
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            sessionStore.setPermissionPrompt(null);
            sessionStore.setUserInputPrompt(null);
            sessionStore.setPlanExitPrompt(null);
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

        case "plan.exit.request": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setPlanExitPrompt({
                sessionId: message.payload.sessionId,
                requestId: message.payload.requestId,
                summary: message.payload.summary,
                planContent: message.payload.planContent,
                actions: message.payload.actions,
                recommendedAction: message.payload.recommendedAction,
            });
            break;
        }

        case "workspace.tree": {
            if (!isActiveSession(message.payload.sessionId)) break;
            const workspaceStore = useWorkspaceStore.getState();
            workspaceStore.setWorkspaceTree(message.payload);
            workspaceStore.setTreeLoading(message.payload.rootPath, false);
            workspaceStore.setTreeLoading("__root__", false);
            break;
        }

        case "workspace.git.summary": {
            if (!isActiveSession(message.payload.sessionId)) break;
            const workspaceStore = useWorkspaceStore.getState();
            workspaceStore.setWorkspaceGitSummary(message.payload);
            break;
        }

        case "workspace.pull.result":
        case "workspace.push.result": {
            if (!isActiveSession(message.payload.sessionId)) break;
            const workspaceStore = useWorkspaceStore.getState();
            workspaceStore.setWorkspaceOperationResult(message.payload);
            break;
        }

        case "workspace.file.response": {
            const { path, content, mimeType, truncated, error } = message.payload;
            dispatchWorkspaceFileResponse(path, {
                content,
                mimeType,
                truncated,
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        case "workspace.diff.response": {
            const { path, diff, error } = message.payload;
            dispatchWorkspaceDiffResponse(path, {
                diff,
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        case "workspace.diff.response": {
            const { path, diff, error } = message.payload;
            dispatchWorkspaceDiffResponse(path, {
                diff,
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        case "skills.list.response": {
            useSessionStore.getState().setSkills(message.payload.skills);
            break;
        }

        default: {
            assertExhaustive(message, (message as { type: string }).type);
            break;
        }
    }
}

// Bridge message dispatcher — routes ServerMessages to Zustand stores

import type { ServerMessage, SessionHistoryItem } from "@copilot-mobile/shared";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import type { AgentTodo, ChatItem, TodoItemStatus } from "../stores/session-store-types";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useWorkspaceDirectoryStore } from "../stores/workspace-directory-store";
import {
    armBackgroundCompletion,
    appendBackgroundCompletionPreview,
    clearBackgroundCompletion,
    notifyBackgroundCompletionFailure,
    notifyIfBackgroundCompletion,
    replaceBackgroundCompletionPreview,
} from "./background-completion";
import { isAppActive } from "./app-visibility";
import { notifySessionActionRequired } from "./notifications";
import {
    dispatchWorkspaceDiffResponse,
    dispatchWorkspaceFileResponse,
    dispatchWorkspaceResolveResponse,
    dispatchWorkspaceSearchResponse,
} from "./workspace-events";

let transientConnectionErrorTimer: ReturnType<typeof setTimeout> | null = null;
const STREAM_DELTA_BATCH_WINDOW_MS = 48;
const assistantDeltaBuffers = new Map<string, string>();
const assistantDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();
const thinkingDeltaBuffers = new Map<string, string>();
const thinkingDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleTransientConnectionErrorClear(expectedMessage: string): void {
    if (transientConnectionErrorTimer !== null) {
        clearTimeout(transientConnectionErrorTimer);
        transientConnectionErrorTimer = null;
    }

    transientConnectionErrorTimer = setTimeout(() => {
        const connectionStore = useConnectionStore.getState();
        if (connectionStore.error === expectedMessage) {
            connectionStore.setError(null);
        }
        transientConnectionErrorTimer = null;
    }, 4000);
}

function clearBufferedStreamTimer(
    timers: Map<string, ReturnType<typeof setTimeout>>,
    sessionId: string
): void {
    const timer = timers.get(sessionId);
    if (timer === undefined) {
        return;
    }

    clearTimeout(timer);
    timers.delete(sessionId);
}

function flushAssistantDeltaBuffer(sessionId: string): void {
    clearBufferedStreamTimer(assistantDeltaTimers, sessionId);
    const delta = assistantDeltaBuffers.get(sessionId);
    assistantDeltaBuffers.delete(sessionId);

    if (delta === undefined || delta.length === 0) {
        return;
    }

    appendBackgroundCompletionPreview(sessionId, delta);

    const sessionStore = useSessionStore.getState();
    if (sessionStore.activeSessionId !== sessionId) {
        return;
    }

    armBackgroundCompletion(sessionId);
    sessionStore.setAssistantTyping(true);
    sessionStore.appendAssistantDelta(delta, 0);
}

function flushThinkingDeltaBuffer(sessionId: string): void {
    clearBufferedStreamTimer(thinkingDeltaTimers, sessionId);
    const delta = thinkingDeltaBuffers.get(sessionId);
    thinkingDeltaBuffers.delete(sessionId);

    if (delta === undefined || delta.length === 0) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    if (sessionStore.activeSessionId !== sessionId) {
        return;
    }

    armBackgroundCompletion(sessionId);
    sessionStore.appendThinkingDelta(delta, 0);
}

function scheduleAssistantDeltaFlush(sessionId: string, delta: string): void {
    if (delta.length === 0) {
        return;
    }

    assistantDeltaBuffers.set(sessionId, `${assistantDeltaBuffers.get(sessionId) ?? ""}${delta}`);
    if (assistantDeltaTimers.has(sessionId)) {
        return;
    }

    assistantDeltaTimers.set(sessionId, setTimeout(() => {
        flushAssistantDeltaBuffer(sessionId);
    }, STREAM_DELTA_BATCH_WINDOW_MS));
}

function scheduleThinkingDeltaFlush(sessionId: string, delta: string): void {
    if (delta.length === 0) {
        return;
    }

    thinkingDeltaBuffers.set(sessionId, `${thinkingDeltaBuffers.get(sessionId) ?? ""}${delta}`);
    if (thinkingDeltaTimers.has(sessionId)) {
        return;
    }

    thinkingDeltaTimers.set(sessionId, setTimeout(() => {
        flushThinkingDeltaBuffer(sessionId);
    }, STREAM_DELTA_BATCH_WINDOW_MS));
}

function flushSessionStreamBuffers(sessionId: string): void {
    flushAssistantDeltaBuffer(sessionId);
    flushThinkingDeltaBuffer(sessionId);
}

function isNonFatalProtocolError(code: string): boolean {
    return code === "RATE_LIMIT" || code === "VALIDATION_ERROR" || code === "INVALID_JSON";
}

function collectPermissionDetails(metadata: Record<string, unknown>): Array<string> {
    const keys = ["intention", "path", "url"] as const;

    return keys
        .map((key) => metadata[key])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim());
}

function rememberWorkspaceDirectory(workspaceRoot: string | undefined): void {
    if (workspaceRoot === undefined || workspaceRoot.length === 0) {
        return;
    }

    useWorkspaceDirectoryStore.getState().addDirectory(workspaceRoot);
}

function readSessionNotificationTitle(sessionId: string, fallback: string): string {
    const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    if (session?.title?.trim().length) {
        return session.title.trim();
    }

    const conversation = useChatHistoryStore.getState().conversations.find((item) => item.sessionId === sessionId);
    if (
        conversation?.title?.trim().length
        && conversation.title.trim() !== "New Chat"
    ) {
        return conversation.title.trim();
    }

    return fallback;
}

function mapHistoryItemToChatItem(item: SessionHistoryItem): ChatItem {
    switch (item.type) {
        case "user":
            return {
                ...item,
                deliveryState: "sent",
            };

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
    let currentCursor = 0;

    function appendPendingCurrentItemsBefore(targetIndex: number): void {
        while (currentCursor < targetIndex) {
            const item = currentItems[currentCursor];
            if (item !== undefined && !matchedIndexes.has(currentCursor)) {
                mergedItems.push(item);
            }
            currentCursor += 1;
        }
    }

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
                appendPendingCurrentItemsBefore(existingIndex);
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
            appendPendingCurrentItemsBefore(existingIndex);
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
                ...(historyItem.errorMessage !== undefined
                    ? { errorMessage: historyItem.errorMessage }
                    : {}),
            });
        }
    }

    for (const [index, item] of currentItems.entries()) {
        if (index < currentCursor) {
            continue;
        }

        if (!matchedIndexes.has(index)) {
            mergedItems.push(item);
        }
    }

    return mergedItems;
}

function formatToolArguments(
    args: Record<string, unknown> | undefined
): string | undefined {
    if (args === undefined || Object.keys(args).length === 0) {
        return undefined;
    }

    return JSON.stringify(args, null, 2);
}

// Compile-time exhaustiveness check that falls back to a warning at runtime.
function assertExhaustive(_value: never, type: string): void {
    console.warn("Unknown server message:", type);
}

// Tool name patterns that signal a todo write operation (Claude Code's TodoWrite tool)
const TODO_WRITE_TOOL_NAMES = new Set(["TodoWrite", "todowrite", "todo_write", "todos_write"]);

function isTodoWriteToolName(name: string): boolean {
    return TODO_WRITE_TOOL_NAMES.has(name) || name.toLowerCase().includes("todowrite");
}

function parseTodoWriteArguments(args: Record<string, unknown>): ReadonlyArray<AgentTodo> | null {
    // Claude Code format: { todos: [{ id, content, status, priority }] }
    const raw = args["todos"] ?? args["items"] ?? args["todo_list"];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const todos: Array<AgentTodo> = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null) continue;
        const entry = item as Record<string, unknown>;
        const id = String(entry["id"] ?? entry["taskId"] ?? todos.length + 1);
        const content = String(entry["content"] ?? entry["description"] ?? entry["task"] ?? entry["title"] ?? "");
        if (content.length === 0) continue;
        const rawStatus = String(entry["status"] ?? "pending").toLowerCase();
        const status: TodoItemStatus =
            rawStatus === "completed" || rawStatus === "done" ? "completed"
                : rawStatus === "in_progress" || rawStatus === "in progress" ? "in_progress"
                    : "pending";
        const rawPriority = String(entry["priority"] ?? "").toLowerCase();
        const priority = rawPriority === "high" ? "high" as const
            : rawPriority === "low" ? "low" as const
                : rawPriority === "medium" ? "medium" as const
                    : undefined;
        todos.push({ id, content, status, ...(priority !== undefined ? { priority } : {}) });
    }
    return todos.length > 0 ? todos : null;
}

function restoreCachedConversationForMissingSession(missingSessionId: string): boolean {
    const connectionStore = useConnectionStore.getState();
    const sessionStore = useSessionStore.getState();
    const chatHistoryStore = useChatHistoryStore.getState();
    const linkedConversation = chatHistoryStore.conversations.find(
        (conversation) => conversation.sessionId === missingSessionId
    );

    if (linkedConversation === undefined) {
        return false;
    }

    clearBackgroundCompletion(missingSessionId);
    sessionStore.setSessionLoading(false);
    sessionStore.setAssistantTyping(false);
    sessionStore.clearPermissionPrompts();
    sessionStore.setUserInputPrompt(null);
    sessionStore.setPlanExitPrompt(null);
    chatHistoryStore.setActiveConversation(linkedConversation.id);
    sessionStore.replaceChatItems(
        chatHistoryStore.getConversationItems(linkedConversation.id)
    );
    sessionStore.removeSession(missingSessionId);
    connectionStore.setError(null);
    return true;
}

export function handleServerMessage(message: ServerMessage): void {
    const connectionStore = useConnectionStore.getState();
    const sessionStore = useSessionStore.getState();

    // Guard against cross-session state updates.
    const isActiveSession = (sessionId: string | undefined): boolean => {
        if (sessionId === undefined) return true; // Some message types do not include sessionId.
        const { activeSessionId } = useSessionStore.getState();
        return activeSessionId !== null && activeSessionId === sessionId;
    };

    const isWorkspaceLoadError = (code: string): boolean => {
        if (code === "WORKSPACE_TREE_FAILED" || code === "WORKSPACE_GIT_FAILED") {
            return true;
        }

        if (code !== "SESSION_NOT_FOUND") {
            return false;
        }

        const workspaceState = useWorkspaceStore.getState();
        return workspaceState.isLoadingGit || Object.keys(workspaceState.loadingTreePaths).length > 0;
    };

    switch (message.type) {
        case "auth.authenticated": {
            connectionStore.setDeviceId(message.payload.deviceId);
            connectionStore.setState("authenticated");
            break;
        }

        case "session.created": {
            sessionStore.setSessionLoading(false);
            sessionStore.setActiveSession(message.payload.session.id);
            sessionStore.setAbortRequested(false);
            sessionStore.upsertSession(message.payload.session);
            clearBackgroundCompletion(message.payload.session.id);

            // Link active conversation to this session.
            const chatHistoryStore = useChatHistoryStore.getState();
            const activeConvId = chatHistoryStore.activeConversationId;
            const workspaceRoot = message.payload.session.context?.workspaceRoot ?? null;
            rememberWorkspaceDirectory(message.payload.session.context?.workspaceRoot);
            if (activeConvId !== null) {
                chatHistoryStore.linkConversationToSession(
                    activeConvId,
                    message.payload.session.id,
                    workspaceRoot
                );
                chatHistoryStore.markConversationSynced(activeConvId, Date.now());
            } else {
                const conversationId = chatHistoryStore.createConversation(
                    message.payload.session.id,
                    workspaceRoot
                );
                chatHistoryStore.setActiveConversation(conversationId);
            }
            break;
        }

        case "session.resumed": {
            sessionStore.setSessionLoading(false);
            sessionStore.setActiveSession(message.payload.session.id);
            sessionStore.setAbortRequested(false);
            sessionStore.upsertSession(message.payload.session);
            clearBackgroundCompletion(message.payload.session.id);
            void import("./bridge").then(({ syncSessionPreferences }) =>
                syncSessionPreferences(message.payload.session.id)
            );

            const chatHistoryStore = useChatHistoryStore.getState();
            const linkedConversation = chatHistoryStore.conversations.find(
                (item) => item.sessionId === message.payload.session.id
            );
            const workspaceRoot = message.payload.session.context?.workspaceRoot ?? null;
            rememberWorkspaceDirectory(message.payload.session.context?.workspaceRoot);
            const conversationId = linkedConversation?.id
                ?? chatHistoryStore.createConversation(message.payload.session.id, workspaceRoot);

            chatHistoryStore.setActiveConversation(conversationId);
            chatHistoryStore.markConversationSynced(conversationId, Date.now());
            const localItems = chatHistoryStore.getConversationItems(conversationId);
            if (localItems.length > 0) {
                sessionStore.replaceChatItems(localItems);
            }
            break;
        }

        case "session.idle": {
            flushSessionStreamBuffers(message.payload.sessionId);
            notifyIfBackgroundCompletion(message.payload.sessionId);
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setAbortRequested(false);
            sessionStore.setAssistantTyping(false);
            sessionStore.finalizeThinking();
            break;
        }

        case "session.list": {
            sessionStore.setSessions(message.payload.sessions);
            for (const session of message.payload.sessions) {
                rememberWorkspaceDirectory(session.context?.workspaceRoot);
            }
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
            flushAssistantDeltaBuffer(message.payload.sessionId);
            replaceBackgroundCompletionPreview(message.payload.sessionId, message.payload.content);
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.finalizeAssistantMessage(message.payload.content);
            break;
        }

        case "assistant.message_delta": {
            scheduleAssistantDeltaFlush(message.payload.sessionId, message.payload.delta);
            break;
        }

        case "assistant.reasoning": {
            flushThinkingDeltaBuffer(message.payload.sessionId);
            if (!isActiveSession(message.payload.sessionId)) break;
            armBackgroundCompletion(message.payload.sessionId);
            sessionStore.finalizeThinking(message.payload.content);
            break;
        }

        case "assistant.reasoning_delta": {
            scheduleThinkingDeltaFlush(message.payload.sessionId, message.payload.delta);
            break;
        }

        case "tool.execution_start": {
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setAssistantTyping(true);
            sessionStore.addToolStart(
                message.payload.requestId,
                message.payload.toolName,
                formatToolArguments(message.payload.arguments),
            );
            // Detect TodoWrite — extract the todo list and surface it above the input
            if (isTodoWriteToolName(message.payload.toolName) && message.payload.arguments !== undefined) {
                const parsed = parseTodoWriteArguments(message.payload.arguments);
                if (parsed !== null) {
                    sessionStore.setAgentTodos(parsed);
                }
            }
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
                message.payload.completionStatus
                ?? (message.payload.success ? "completed" : "failed"),
                message.payload.errorMessage,
            );
            break;
        }

        case "permission.request": {
            sessionStore.receivePermissionPrompt({
                sessionId: message.payload.sessionId,
                requestId: message.payload.requestId,
                kind: message.payload.kind,
                toolName: message.payload.toolName ?? null,
                fileName: message.payload.fileName ?? null,
                commandText: message.payload.fullCommandText ?? null,
                details: collectPermissionDetails(message.payload.metadata),
            });
            if (!isAppActive()) {
                const promptSummary = message.payload.fullCommandText
                    ?? message.payload.fileName
                    ?? message.payload.toolName
                    ?? message.payload.kind;
                void notifySessionActionRequired({
                    sessionId: message.payload.sessionId,
                    requestId: message.payload.requestId,
                    title: readSessionNotificationTitle(message.payload.sessionId, "Copilot needs approval"),
                    body: `Approval needed: ${promptSummary}`,
                });
            }
            break;
        }

        case "user_input.request": {
            sessionStore.receiveUserInputPrompt({
                sessionId: message.payload.sessionId,
                requestId: message.payload.requestId,
                prompt: message.payload.prompt,
                ...(message.payload.choices !== undefined ? { choices: message.payload.choices } : {}),
                ...(message.payload.allowFreeform !== undefined
                    ? { allowFreeform: message.payload.allowFreeform }
                    : {}),
            });
            if (!isAppActive()) {
                void notifySessionActionRequired({
                    sessionId: message.payload.sessionId,
                    requestId: message.payload.requestId,
                    title: readSessionNotificationTitle(message.payload.sessionId, "Copilot needs input"),
                    body: `Input needed: ${message.payload.prompt}`,
                });
            }
            break;
        }

        case "models.list": {
            sessionStore.setModels(message.payload.models);
            break;
        }

        case "error": {
            if (
                message.payload.code === "SESSION_NOT_FOUND"
                && sessionStore.activeSessionId !== null
                && restoreCachedConversationForMissingSession(sessionStore.activeSessionId)
            ) {
                break;
            }

            if (
                message.payload.code === "SESSION_NOT_FOUND"
                && sessionStore.activeSessionId === null
            ) {
                clearBackgroundCompletion();
                sessionStore.setSessionLoading(false);
                sessionStore.setAssistantTyping(false);
                sessionStore.clearPermissionPrompts();
                sessionStore.setUserInputPrompt(null);
                sessionStore.setPlanExitPrompt(null);
                connectionStore.setError(null);
                break;
            }

            if (isWorkspaceLoadError(message.payload.code)) {
                const workspaceStore = useWorkspaceStore.getState();
                workspaceStore.clearRequestLoadingState();
                workspaceStore.setError(`[${message.payload.code}] ${message.payload.message}`);
                break;
            }

            if (isNonFatalProtocolError(message.payload.code)) {
                const errorMessage = `[${message.payload.code}] ${message.payload.message}`;
                sessionStore.setAbortRequested(false);
                connectionStore.setError(errorMessage);
                scheduleTransientConnectionErrorClear(errorMessage);
                break;
            }

            clearBackgroundCompletion();
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            sessionStore.setAbortRequested(false);
            // Clear open dialogs after a fatal error so they do not stay stuck onscreen.
            sessionStore.clearPermissionPrompts();
            sessionStore.setUserInputPrompt(null);
            sessionStore.setPlanExitPrompt(null);
            const errorMessage = `[${message.payload.code}] ${message.payload.message}`;
            connectionStore.setError(errorMessage);
            break;
        }

        case "connection.status": {
            // Connection status is informational
            break;
        }

        case "auth.session_token": {
            // Token handled at ws-client level, no store update needed
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
            sessionStore.syncRemoteSessionState({
                agentMode: message.payload.agentMode,
                permissionLevel: message.payload.permissionLevel,
                runtimeMode: message.payload.runtimeMode,
            });
            if (message.payload.runtimeMode !== "plan") {
                sessionStore.setPlanExitPrompt(null);
            }
            // Bridge is the source of truth for "agent is working" so the stop button
            // is restored after reconnect/restart if a turn is still in progress.
            if (message.payload.busy !== undefined) {
                if (message.payload.busy) {
                    armBackgroundCompletion(message.payload.sessionId);
                } else {
                    flushSessionStreamBuffers(message.payload.sessionId);
                    notifyIfBackgroundCompletion(message.payload.sessionId);
                    sessionStore.setAbortRequested(false);
                }
                sessionStore.setAssistantTyping(message.payload.busy);
            }
            break;
        }

        case "session.error": {
            flushSessionStreamBuffers(message.payload.sessionId);
            notifyBackgroundCompletionFailure(
                message.payload.sessionId,
                `[${message.payload.errorType}] ${message.payload.message}`
            );
            clearBackgroundCompletion(message.payload.sessionId);
            sessionStore.clearSessionPrompts(message.payload.sessionId);
            if (sessionStore.activeSessionId === message.payload.sessionId) {
                sessionStore.setActiveSession(null);
            }
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            sessionStore.setAbortRequested(false);
            sessionStore.clearPermissionPrompts();
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
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.setCurrentIntent(message.payload.intent);
            break;
        }

        case "session.usage": {
            sessionStore.setSessionUsage(message.payload);
            break;
        }

        case "plan.exit.request": {
            sessionStore.receivePlanExitPrompt({
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
            workspaceStore.setTreeLoading(message.payload.requestedWorkspaceRelativePath, false);
            workspaceStore.setTreeLoading("__root__", false);
            break;
        }

        case "workspace.git.summary": {
            if (!isActiveSession(message.payload.sessionId)) break;
            const workspaceStore = useWorkspaceStore.getState();
            workspaceStore.setWorkspaceGitSummary(message.payload);
            sessionStore.setSessions(
                sessionStore.sessions.map((session) => {
                    if (session.id !== message.payload.sessionId) {
                        return session;
                    }

                    const nextContext = {
                        ...(session.context ?? message.payload.context),
                        ...message.payload.context,
                        ...(message.payload.gitRoot !== null ? { gitRoot: message.payload.gitRoot } : {}),
                        ...(message.payload.repository !== undefined ? { repository: message.payload.repository } : {}),
                        ...(message.payload.branch !== undefined ? { branch: message.payload.branch } : {}),
                    };

                    return {
                        ...session,
                        context: nextContext,
                    };
                })
            );
            break;
        }

        case "workspace.branch.switch.result": {
            if (!isActiveSession(message.payload.sessionId)) break;
            const workspaceStore = useWorkspaceStore.getState();
            workspaceStore.setWorkspaceBranchSwitchResult(message.payload);
            if (message.payload.success) {
                void import("./bridge").then(({ requestWorkspaceGitSummary }) =>
                    requestWorkspaceGitSummary(message.payload.sessionId, 10)
                );
            }
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
            const { sessionId, workspaceRelativePath, content, mimeType, truncated, error } = message.payload;
            dispatchWorkspaceFileResponse(sessionId, workspaceRelativePath, {
                content,
                mimeType,
                truncated,
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        case "workspace.diff.response": {
            const { sessionId, workspaceRelativePath, diff, error } = message.payload;
            dispatchWorkspaceDiffResponse(sessionId, workspaceRelativePath, {
                diff,
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        case "workspace.resolve.response": {
            const { sessionId, rawPath, resolvedWorkspaceRelativePath, matches, error } = message.payload;
            dispatchWorkspaceResolveResponse(sessionId, rawPath, {
                rawPath,
                ...(resolvedWorkspaceRelativePath !== undefined
                    ? { resolvedWorkspaceRelativePath }
                    : {}),
                ...(matches !== undefined ? { matches } : {}),
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        case "workspace.search.response": {
            const { requestKey, query, matches, error } = message.payload;
            dispatchWorkspaceSearchResponse(requestKey, {
                query,
                matches,
                ...(error !== undefined ? { error } : {}),
            });
            break;
        }

        default: {
            assertExhaustive(message, (message as { type: string }).type);
            break;
        }
    }
}

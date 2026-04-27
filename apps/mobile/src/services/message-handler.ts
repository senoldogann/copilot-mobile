// Bridge message dispatcher — routes ServerMessages to Zustand stores

import type {
    AgentMode,
    PermissionLevel,
    ServerMessage,
    SessionHistoryItem,
} from "@copilot-mobile/shared";
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
import { switchToAuthenticatedCompanion } from "./companion-context";
import { notifySessionActionRequired } from "./notifications";
import {
    dispatchWorkspaceDiffResponse,
    dispatchWorkspaceFileResponse,
    dispatchWorkspaceResolveResponse,
    dispatchWorkspaceSearchResponse,
} from "./workspace-events";
import {
    clearSessionPrefetch,
    consumeSessionPrefetchHistory,
    consumeSessionPrefetchResume,
} from "./session-prefetch";
import {
    deriveSubagentRunsFromItems,
    extractAgentTodosFromArgumentsText,
    getSubagentDisplayName,
    isSubagentToolName,
} from "../utils/tool-introspection";

let transientConnectionErrorTimer: ReturnType<typeof setTimeout> | null = null;
const ASSISTANT_DELTA_BATCH_WINDOW_MS = 40;
const THINKING_DELTA_BATCH_WINDOW_MS = 18;
const TOOL_PARTIAL_OUTPUT_BATCH_WINDOW_MS = 96;
const assistantDeltaBuffers = new Map<string, string>();
const assistantDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();
const thinkingDeltaBuffers = new Map<string, string>();
const thinkingDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();
const toolPartialOutputBuffers = new Map<string, string>();
const toolPartialOutputTimers = new Map<string, ReturnType<typeof setTimeout>>();
const assistantStreamStarted = new Set<string>();
const thinkingStreamStarted = new Set<string>();
const toolPartialStreamStarted = new Set<string>();
type AssistantSystemNotificationBuffer = {
    collecting: boolean;
    content: string;
};

type AssistantInternalExtraction = {
    visibleContent: string;
    systemNotifications: ReadonlyArray<string>;
};

type MergeCandidateBucket = {
    indexes: number[];
    cursor: number;
};

type IndexedMergeCandidates = {
    messageById: Map<string, MergeCandidateBucket>;
    messageBySignature: Map<string, MergeCandidateBucket>;
    toolByRequestId: Map<string, MergeCandidateBucket>;
    streamingAssistantIndexes: number[];
    streamingThinkingIndexes: number[];
};

type SessionBehaviorPreferences = {
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
};

const assistantSystemNotificationState = new Map<string, AssistantSystemNotificationBuffer>();
const emittedSystemNotificationKeys = new Map<string, Set<string>>();
const historySyncVersions = new Map<string, number>();
const pendingHistoryRefreshRequests = new Set<string>();

function normalizeSystemNotification(content: string): string {
    return content
        .replace(/<\/?system_notification\b[^>]*>/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeAssistantIntent(intent: string): string {
    const trimmed = intent.trim();
    if (trimmed.length === 0) {
        return trimmed;
    }

    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return trimmed;
    }

    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const candidate = (parsed as { intent?: unknown; intention?: unknown; text?: unknown }).intent
                ?? (parsed as { intent?: unknown; intention?: unknown; text?: unknown }).intention
                ?? (parsed as { intent?: unknown; intention?: unknown; text?: unknown }).text;
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
    } catch {
        return trimmed;
    }

    return trimmed;
}

function readEmittedSystemNotificationKeys(sessionId: string): Set<string> {
    const existingKeys = emittedSystemNotificationKeys.get(sessionId);
    if (existingKeys !== undefined) {
        return existingKeys;
    }

    const keys = new Set<string>();
    emittedSystemNotificationKeys.set(sessionId, keys);
    return keys;
}

function addSystemNotificationForActiveSession(sessionId: string, content: string): void {
    const normalizedContent = normalizeSystemNotification(content);
    if (normalizedContent.length === 0) {
        return;
    }

    const keys = readEmittedSystemNotificationKeys(sessionId);
    if (keys.has(normalizedContent)) {
        return;
    }
    keys.add(normalizedContent);

    const sessionStore = useSessionStore.getState();
    if (sessionStore.activeSessionId !== sessionId) {
        return;
    }

    sessionStore.addSystemNotification(normalizedContent);
}

function clearSystemNotificationStreamState(sessionId: string): void {
    assistantSystemNotificationState.delete(sessionId);
    emittedSystemNotificationKeys.delete(sessionId);
}

function createToolPartialBufferKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
}

function extractAssistantInternalContent(content: string): AssistantInternalExtraction {
    const systemNotifications: Array<string> = [];
    let visibleContent = "";
    let cursor = 0;
    const taggedPattern = /<system_notification\b[^>]*>([\s\S]*?)<\/system_notification>/gi;
    let taggedMatch: RegExpExecArray | null;

    while ((taggedMatch = taggedPattern.exec(content)) !== null) {
        visibleContent += content.slice(cursor, taggedMatch.index);
        systemNotifications.push(normalizeSystemNotification(taggedMatch[1] ?? ""));
        cursor = taggedMatch.index + taggedMatch[0].length;
    }

    visibleContent += content.slice(cursor);
    visibleContent = visibleContent.replace(
        /^Agent\s+"[^"]+"\s+\([^)]+\)\s+has completed successfully\.\s+Use\s+read_agent[^\n]*?full results\.\s*$/gmi,
        (match) => {
            systemNotifications.push(normalizeSystemNotification(match));
            return "";
        }
    );

    return {
        visibleContent: visibleContent
            .replace(/<\/?system_notification\b[^>]*>/gi, "")
            .replace(/<\/?thinking\b[^>]*>/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trimStart(),
        systemNotifications: systemNotifications.filter((item) => item.length > 0),
    };
}

function stripAssistantInternalMarkup(content: string): string {
    return extractAssistantInternalContent(content).visibleContent;
}

function filterAssistantDelta(sessionId: string, delta: string): string {
    let remaining = delta;
    let visible = "";
    const existingBuffer = assistantSystemNotificationState.get(sessionId);
    let suppressing = existingBuffer?.collecting === true;
    let notificationContent = existingBuffer?.content ?? "";

    while (remaining.length > 0) {
        if (suppressing) {
            const closeMatch = /<\/system_notification>/i.exec(remaining);
            if (closeMatch === null) {
                assistantSystemNotificationState.set(sessionId, {
                    collecting: true,
                    content: notificationContent + remaining,
                });
                return visible;
            }

            notificationContent += remaining.slice(0, closeMatch.index);
            addSystemNotificationForActiveSession(sessionId, notificationContent);
            remaining = remaining.slice(closeMatch.index + closeMatch[0].length);
            suppressing = false;
            notificationContent = "";
            continue;
        }

        const openMatch = /<system_notification\b[^>]*>/i.exec(remaining);
        if (openMatch === null) {
            visible += remaining;
            remaining = "";
            continue;
        }

        visible += remaining.slice(0, openMatch.index);
        remaining = remaining.slice(openMatch.index + openMatch[0].length);
        suppressing = true;
        notificationContent = "";
    }

    if (suppressing) {
        assistantSystemNotificationState.set(sessionId, {
            collecting: true,
            content: notificationContent,
        });
    } else {
        assistantSystemNotificationState.delete(sessionId);
    }

    return stripAssistantInternalMarkup(visible);
}

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
    const rawDelta = assistantDeltaBuffers.get(sessionId);
    assistantDeltaBuffers.delete(sessionId);

    if (rawDelta === undefined || rawDelta.length === 0) {
        return;
    }

    const delta = filterAssistantDelta(sessionId, rawDelta);
    if (delta.length === 0) {
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
    sessionStore.setAssistantTyping(true);
    sessionStore.appendThinkingDelta(delta, 0);
}

function flushToolPartialOutputBuffer(sessionId: string, requestId: string): void {
    const bufferKey = createToolPartialBufferKey(sessionId, requestId);
    clearBufferedStreamTimer(toolPartialOutputTimers, bufferKey);
    const partialOutput = toolPartialOutputBuffers.get(bufferKey);
    toolPartialOutputBuffers.delete(bufferKey);

    if (partialOutput === undefined || partialOutput.length === 0) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    if (sessionStore.activeSessionId !== sessionId) {
        return;
    }

    armBackgroundCompletion(sessionId);
    sessionStore.appendToolPartialOutput(requestId, partialOutput);
}

function scheduleAssistantDeltaFlush(sessionId: string, delta: string): void {
    if (delta.length === 0) {
        return;
    }

    const shouldFlushImmediately = !assistantStreamStarted.has(sessionId)
        && !assistantDeltaTimers.has(sessionId)
        && !assistantDeltaBuffers.has(sessionId);
    assistantDeltaBuffers.set(sessionId, `${assistantDeltaBuffers.get(sessionId) ?? ""}${delta}`);
    if (shouldFlushImmediately) {
        assistantStreamStarted.add(sessionId);
        flushAssistantDeltaBuffer(sessionId);
        return;
    }

    if (assistantDeltaTimers.has(sessionId)) {
        return;
    }

    assistantDeltaTimers.set(sessionId, setTimeout(() => {
        flushAssistantDeltaBuffer(sessionId);
    }, ASSISTANT_DELTA_BATCH_WINDOW_MS));
}

function scheduleThinkingDeltaFlush(sessionId: string, delta: string): void {
    if (delta.length === 0) {
        return;
    }

    const shouldFlushImmediately = !thinkingStreamStarted.has(sessionId)
        && !thinkingDeltaTimers.has(sessionId)
        && !thinkingDeltaBuffers.has(sessionId);
    thinkingDeltaBuffers.set(sessionId, `${thinkingDeltaBuffers.get(sessionId) ?? ""}${delta}`);
    if (shouldFlushImmediately) {
        thinkingStreamStarted.add(sessionId);
        flushThinkingDeltaBuffer(sessionId);
        return;
    }

    if (thinkingDeltaTimers.has(sessionId)) {
        return;
    }

    thinkingDeltaTimers.set(sessionId, setTimeout(() => {
        flushThinkingDeltaBuffer(sessionId);
    }, THINKING_DELTA_BATCH_WINDOW_MS));
}

function scheduleToolPartialOutputFlush(sessionId: string, requestId: string, partialOutput: string): void {
    if (partialOutput.length === 0) {
        return;
    }

    const bufferKey = createToolPartialBufferKey(sessionId, requestId);
    const shouldFlushImmediately = !toolPartialStreamStarted.has(bufferKey)
        && !toolPartialOutputTimers.has(bufferKey)
        && !toolPartialOutputBuffers.has(bufferKey);
    toolPartialOutputBuffers.set(
        bufferKey,
        `${toolPartialOutputBuffers.get(bufferKey) ?? ""}${partialOutput}`
    );
    if (shouldFlushImmediately) {
        toolPartialStreamStarted.add(bufferKey);
        flushToolPartialOutputBuffer(sessionId, requestId);
        return;
    }

    if (toolPartialOutputTimers.has(bufferKey)) {
        return;
    }

    toolPartialOutputTimers.set(bufferKey, setTimeout(() => {
        flushToolPartialOutputBuffer(sessionId, requestId);
    }, TOOL_PARTIAL_OUTPUT_BATCH_WINDOW_MS));
}

function flushToolPartialOutputBuffersForSession(sessionId: string): void {
    for (const bufferKey of [...toolPartialOutputBuffers.keys()]) {
        if (!bufferKey.startsWith(`${sessionId}:`)) {
            continue;
        }

        const requestId = bufferKey.slice(sessionId.length + 1);
        flushToolPartialOutputBuffer(sessionId, requestId);
        toolPartialStreamStarted.delete(bufferKey);
    }
}

function flushSessionStreamBuffers(sessionId: string): void {
    flushAssistantDeltaBuffer(sessionId);
    flushThinkingDeltaBuffer(sessionId);
    flushToolPartialOutputBuffersForSession(sessionId);
    assistantStreamStarted.delete(sessionId);
    thinkingStreamStarted.delete(sessionId);
    clearSystemNotificationStreamState(sessionId);
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

function requestWorkspaceSnapshot(sessionId: string): void {
    void import("./bridge").then(({
        refreshWorkspaceGitSummary,
        requestWorkspaceTree,
    }) => Promise.all([
        refreshWorkspaceGitSummary(sessionId, 10),
        requestWorkspaceTree(sessionId, undefined, 2, 0, 200),
    ]));
}

function isAbortInFlightForSession(sessionId: string): boolean {
    const sessionStore = useSessionStore.getState();
    return sessionStore.isAbortRequested && sessionStore.activeSessionId === sessionId;
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
                content: stripAssistantInternalMarkup(item.content),
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

function buildAttachmentSignature(
    attachments: ReadonlyArray<{ mimeType: string; displayName?: string }>
): string {
    if (attachments.length === 0) {
        return "";
    }

    return attachments
        .map((attachment) => `${attachment.mimeType}:${attachment.displayName ?? ""}`)
        .join("|");
}

function createCurrentMessageSignature(
    item: Extract<ChatItem, { type: "user" | "assistant" | "thinking" }>
): string {
    const content = item.type === "assistant"
        ? stripAssistantInternalMarkup(item.content)
        : item.content;
    const attachmentSignature = item.type === "user"
        ? buildAttachmentSignature(item.attachments ?? [])
        : "";
    return `${item.type}:${content}:${attachmentSignature}`;
}

function createHistoryMessageSignature(
    item: Extract<SessionHistoryItem, { type: "user" | "assistant" | "thinking" }>
): string {
    const content = item.type === "assistant"
        ? stripAssistantInternalMarkup(item.content)
        : item.content;
    const attachmentSignature = item.type === "user"
        ? buildAttachmentSignature(item.attachments ?? [])
        : "";
    return `${item.type}:${content}:${attachmentSignature}`;
}

function getOrCreateMergeCandidateBucket(
    buckets: Map<string, MergeCandidateBucket>,
    key: string
): MergeCandidateBucket {
    const existing = buckets.get(key);
    if (existing !== undefined) {
        return existing;
    }

    const created: MergeCandidateBucket = {
        indexes: [],
        cursor: 0,
    };
    buckets.set(key, created);
    return created;
}

function takeNextUnmatchedBucketIndex(
    bucket: MergeCandidateBucket | undefined,
    matchedIndexes: ReadonlySet<number>
): number {
    if (bucket === undefined) {
        return -1;
    }

    while (bucket.cursor < bucket.indexes.length) {
        const index = bucket.indexes[bucket.cursor];
        bucket.cursor += 1;
        if (index !== undefined && !matchedIndexes.has(index)) {
            return index;
        }
    }

    return -1;
}

function buildIndexedMergeCandidates(
    currentItems: ReadonlyArray<ChatItem>
): IndexedMergeCandidates {
    const messageById = new Map<string, MergeCandidateBucket>();
    const messageBySignature = new Map<string, MergeCandidateBucket>();
    const toolByRequestId = new Map<string, MergeCandidateBucket>();
    const streamingAssistantIndexes: number[] = [];
    const streamingThinkingIndexes: number[] = [];

    currentItems.forEach((item, index) => {
        if (item.type === "user" || item.type === "assistant" || item.type === "thinking") {
            getOrCreateMergeCandidateBucket(messageById, `${item.type}:${item.id}`).indexes.push(index);
            getOrCreateMergeCandidateBucket(
                messageBySignature,
                createCurrentMessageSignature(item)
            ).indexes.push(index);

            if (item.type === "assistant" && item.isStreaming) {
                streamingAssistantIndexes.push(index);
            } else if (item.type === "thinking" && item.isStreaming) {
                streamingThinkingIndexes.push(index);
            }
            return;
        }

        if (item.type === "tool") {
            getOrCreateMergeCandidateBucket(toolByRequestId, item.requestId).indexes.push(index);
        }
    });

    return {
        messageById,
        messageBySignature,
        toolByRequestId,
        streamingAssistantIndexes,
        streamingThinkingIndexes,
    };
}

function mergeHistoryIntoExistingItems(
    currentItems: ReadonlyArray<ChatItem>,
    historyItems: ReadonlyArray<SessionHistoryItem>
): Array<ChatItem> {
    const matchedIndexes = new Set<number>();
    const mergedItems: Array<ChatItem> = [];
    let currentCursor = 0;
    const indexedCandidates = buildIndexedMergeCandidates(currentItems);

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
            if (
                rightAttachment === undefined
                || attachment.mimeType !== rightAttachment.mimeType
                || attachment.displayName !== rightAttachment.displayName
            ) {
                return false;
            }

            if (attachment.type === "upload_ref" || rightAttachment.type === "upload_ref") {
                return true;
            }

            return attachment.data === rightAttachment.data;
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

        const historyContent = historyItem.type === "assistant"
            ? stripAssistantInternalMarkup(historyItem.content)
            : historyItem.content;
        if (existingItem.content !== historyContent) {
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
        const streamingIndexes = historyItem.type === "assistant"
            ? indexedCandidates.streamingAssistantIndexes
            : indexedCandidates.streamingThinkingIndexes;

        for (let cursor = streamingIndexes.length - 1; cursor >= 0; cursor -= 1) {
            const index = streamingIndexes[cursor];
            if (index === undefined) {
                continue;
            }
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
            let existingIndex = takeNextUnmatchedBucketIndex(
                indexedCandidates.messageById.get(`${historyItem.type}:${historyItem.id}`),
                matchedIndexes
            );

            if (existingIndex === -1) {
                existingIndex = takeNextUnmatchedBucketIndex(
                    indexedCandidates.messageBySignature.get(createHistoryMessageSignature(historyItem)),
                    matchedIndexes
                );
            }

            if (existingIndex !== -1) {
                const candidate = currentItems[existingIndex];
                if (
                    candidate === undefined
                    || (candidate.type !== "user" && candidate.type !== "assistant" && candidate.type !== "thinking")
                    || !isExactHistoryMessageMatch(historyItem, candidate)
                ) {
                    existingIndex = -1;
                }
            }

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

        const existingIndex = takeNextUnmatchedBucketIndex(
            indexedCandidates.toolByRequestId.get(historyItem.requestId),
            matchedIndexes
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

export const __testables = {
    mergeHistoryIntoExistingItems,
    readSessionBehaviorPreferences,
};

function readSessionBehaviorPreferences(): SessionBehaviorPreferences {
    const sessionStore = useSessionStore.getState();
    return {
        agentMode: sessionStore.agentMode,
        permissionLevel: sessionStore.permissionLevel,
    };
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
    sessionStore.setSessionBusy(missingSessionId, false);
    sessionStore.setAgentTodos([]);
    sessionStore.clearSubagentRuns();
    sessionStore.clearSessionPrompts(missingSessionId);
    chatHistoryStore.setActiveConversation(linkedConversation.id);
    const restoredItems = chatHistoryStore.getConversationItems(linkedConversation.id);
    sessionStore.replaceChatItems(restoredItems);
    sessionStore.setSubagentRuns(deriveSubagentRunsFromItems(restoredItems, false));
    sessionStore.removeSession(missingSessionId);
    connectionStore.setError(null);
    return true;
}

function clearPendingHistoryRefresh(sessionId: string): void {
    pendingHistoryRefreshRequests.delete(sessionId);
}

function markSessionHistorySynced(sessionId: string): void {
    clearPendingHistoryRefresh(sessionId);
    const remoteSession = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    historySyncVersions.set(sessionId, remoteSession?.lastActiveAt ?? Date.now());
}

function requestActiveSessionHistoryRefresh(sessionId: string): void {
    if (pendingHistoryRefreshRequests.has(sessionId)) {
        return;
    }

    pendingHistoryRefreshRequests.add(sessionId);
    void import("./bridge")
        .then(({ requestSessionHistory }) => requestSessionHistory(sessionId))
        .catch(() => {
            clearPendingHistoryRefresh(sessionId);
        });
}

function refreshActiveSessionHistoryIfStale(): void {
    if (!isAppActive()) {
        return;
    }

    const sessionStore = useSessionStore.getState();
    const activeSessionId = sessionStore.activeSessionId;
    if (activeSessionId === null) {
        return;
    }

    if (sessionStore.busySessions[activeSessionId] === true || sessionStore.isAssistantTyping) {
        return;
    }

    const remoteSession = sessionStore.sessions.find((item) => item.id === activeSessionId);
    if (remoteSession === undefined) {
        return;
    }

    const lastKnownHistoryVersion = historySyncVersions.get(activeSessionId) ?? 0;
    if (remoteSession.lastActiveAt <= lastKnownHistoryVersion) {
        return;
    }

    requestActiveSessionHistoryRefresh(activeSessionId);
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

    const clearLoadingForActiveSession = (sessionId: string): void => {
        if (isActiveSession(sessionId)) {
            sessionStore.setSessionLoading(false);
        }
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
            if (connectionStore.deviceId !== message.payload.deviceId) {
                void switchToAuthenticatedCompanion(message.payload.deviceId);
            }
            connectionStore.setDeviceId(message.payload.deviceId);
            connectionStore.setState("authenticated");
            break;
        }

        case "session.created": {
            clearPendingHistoryRefresh(message.payload.session.id);
            sessionStore.setSessionLoading(false);
            sessionStore.setActiveSession(message.payload.session.id);
            sessionStore.setAbortRequested(false);
            sessionStore.clearSessionBusy(message.payload.session.id);
            sessionStore.upsertSession(message.payload.session);
            sessionStore.clearSubagentRuns();
            clearBackgroundCompletion(message.payload.session.id);
            clearSystemNotificationStreamState(message.payload.session.id);

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
            requestWorkspaceSnapshot(message.payload.session.id);
            break;
        }

        case "session.resumed": {
            pendingHistoryRefreshRequests.add(message.payload.session.id);
            if (consumeSessionPrefetchResume(message.payload.session.id)) {
                sessionStore.upsertSession(message.payload.session);
                rememberWorkspaceDirectory(message.payload.session.context?.workspaceRoot);
                break;
            }

            const behaviorPreferences = readSessionBehaviorPreferences();
            sessionStore.setActiveSession(message.payload.session.id);
            sessionStore.setAbortRequested(false);
            sessionStore.upsertSession(message.payload.session);
            clearBackgroundCompletion(message.payload.session.id);
            clearSystemNotificationStreamState(message.payload.session.id);
            void import("./bridge").then(({ syncSessionPreferences }) =>
                syncSessionPreferences(message.payload.session.id, behaviorPreferences)
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
            sessionStore.setSessionLoading(localItems.length === 0);
            if (localItems.length > 0) {
                sessionStore.replaceChatItems(localItems);
                sessionStore.setSubagentRuns(deriveSubagentRunsFromItems(localItems, false));
            } else {
                sessionStore.clearSubagentRuns();
            }
            requestWorkspaceSnapshot(message.payload.session.id);
            break;
        }

        case "session.idle": {
            flushSessionStreamBuffers(message.payload.sessionId);
            sessionStore.setSessionBusy(message.payload.sessionId, false);
            const abortInFlight = isAbortInFlightForSession(message.payload.sessionId);
            if (abortInFlight) {
                clearBackgroundCompletion(message.payload.sessionId);
            } else {
                notifyIfBackgroundCompletion(message.payload.sessionId);
            }
            if (!isActiveSession(message.payload.sessionId)) {
                useChatHistoryStore.getState().finalizeStreamingForSession(message.payload.sessionId);
                break;
            }
            sessionStore.setAssistantTyping(false);
            if (abortInFlight) {
                sessionStore.stopActiveTurn();
            } else {
                sessionStore.setAbortRequested(false);
                sessionStore.setAgentTodos([]);
                sessionStore.settleRunningTools("completed");
                sessionStore.finalizeThinking();
            }
            sessionStore.clearSubagentRuns();
            break;
        }

        case "session.list": {
            const nextSessionIds = new Set(message.payload.sessions.map((session) => session.id));
            for (const existingSession of sessionStore.sessions) {
                if (!nextSessionIds.has(existingSession.id)) {
                    sessionStore.removeSession(existingSession.id);
                }
            }
            sessionStore.setSessions(message.payload.sessions);
            for (const session of message.payload.sessions) {
                rememberWorkspaceDirectory(session.context?.workspaceRoot);
            }
            refreshActiveSessionHistoryIfStale();
            break;
        }

        case "session.history": {
            if (consumeSessionPrefetchHistory(message.payload.sessionId)) {
                const chatHistoryStore = useChatHistoryStore.getState();
                const linkedConversation = chatHistoryStore.conversations.find(
                    (conversation) => conversation.sessionId === message.payload.sessionId
                );

                if (linkedConversation !== undefined) {
                    chatHistoryStore.setConversationItems(
                        linkedConversation.id,
                        message.payload.items.map(mapHistoryItemToChatItem)
                    );
                    chatHistoryStore.markConversationSynced(linkedConversation.id, Date.now());
                }
                markSessionHistorySynced(message.payload.sessionId);
                break;
            }

            const { activeSessionId } = useSessionStore.getState();
            if (activeSessionId === null || activeSessionId !== message.payload.sessionId) {
                clearPendingHistoryRefresh(message.payload.sessionId);
                console.warn("[MessageHandler] Ignoring session.history for an inactive session");
                break;
            }
            if (sessionStore.chatItems.length > 0) {
                const mergedItems = mergeHistoryIntoExistingItems(sessionStore.chatItems, message.payload.items);
                sessionStore.replaceChatItems(mergedItems);
                sessionStore.setSessionLoading(false);
                sessionStore.setSubagentRuns(
                    deriveSubagentRunsFromItems(mergedItems, sessionStore.isAssistantTyping)
                );
                const linkedConversation = useChatHistoryStore.getState().conversations.find(
                    (conversation) => conversation.sessionId === message.payload.sessionId
                );
                if (linkedConversation !== undefined) {
                    useChatHistoryStore.getState().setConversationItems(linkedConversation.id, mergedItems);
                }
                markSessionHistorySynced(message.payload.sessionId);
                break;
            }
            const historyItems = message.payload.items.map(mapHistoryItemToChatItem);
            sessionStore.replaceChatItems(historyItems);
            sessionStore.setSessionLoading(false);
            sessionStore.setSubagentRuns(
                deriveSubagentRunsFromItems(historyItems, sessionStore.isAssistantTyping)
            );
            const linkedConversation = useChatHistoryStore.getState().conversations.find(
                (conversation) => conversation.sessionId === message.payload.sessionId
            );
            if (linkedConversation !== undefined) {
                useChatHistoryStore.getState().setConversationItems(linkedConversation.id, historyItems);
            }
            markSessionHistorySynced(message.payload.sessionId);
            break;
        }

        case "assistant.message": {
            flushAssistantDeltaBuffer(message.payload.sessionId);
            const extractedContent = extractAssistantInternalContent(message.payload.content);
            for (const notification of extractedContent.systemNotifications) {
                addSystemNotificationForActiveSession(message.payload.sessionId, notification);
            }
            const content = extractedContent.visibleContent;
            replaceBackgroundCompletionPreview(message.payload.sessionId, content);
            if (!isActiveSession(message.payload.sessionId)) break;
            clearLoadingForActiveSession(message.payload.sessionId);
            sessionStore.finalizeAssistantMessage(content);
            break;
        }

        case "assistant.message_delta": {
            clearLoadingForActiveSession(message.payload.sessionId);
            scheduleAssistantDeltaFlush(message.payload.sessionId, message.payload.delta);
            break;
        }

        case "assistant.reasoning": {
            flushThinkingDeltaBuffer(message.payload.sessionId);
            if (!isActiveSession(message.payload.sessionId)) break;
            armBackgroundCompletion(message.payload.sessionId);
            clearLoadingForActiveSession(message.payload.sessionId);
            sessionStore.finalizeThinking(message.payload.content);
            break;
        }

        case "assistant.reasoning_delta": {
            clearLoadingForActiveSession(message.payload.sessionId);
            scheduleThinkingDeltaFlush(message.payload.sessionId, message.payload.delta);
            break;
        }

        case "tool.execution_start": {
            if (!isActiveSession(message.payload.sessionId)) break;
            clearLoadingForActiveSession(message.payload.sessionId);
            sessionStore.setAssistantTyping(true);
            const formattedArguments = formatToolArguments(message.payload.arguments);
            sessionStore.addToolStart(
                message.payload.requestId,
                message.payload.toolName,
                formattedArguments,
            );
            if (isSubagentToolName(message.payload.toolName)) {
                sessionStore.upsertSubagentRun({
                    requestId: message.payload.requestId,
                    title: getSubagentDisplayName({
                        toolName: message.payload.toolName,
                        ...(formattedArguments !== undefined ? { argumentsText: formattedArguments } : {}),
                    }),
                    status: "running",
                });
            }
            const parsedTodos = extractAgentTodosFromArgumentsText(
                formattedArguments
            );
            if (parsedTodos !== null) {
                sessionStore.setAgentTodos(parsedTodos);
            }
            break;
        }

        case "tool.execution_partial_result": {
            if (!isActiveSession(message.payload.sessionId)) break;
            scheduleToolPartialOutputFlush(
                message.payload.sessionId,
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
            flushToolPartialOutputBuffer(message.payload.sessionId, message.payload.requestId);
            toolPartialStreamStarted.delete(
                createToolPartialBufferKey(message.payload.sessionId, message.payload.requestId)
            );
            if (!isActiveSession(message.payload.sessionId)) break;
            sessionStore.updateSubagentRunStatus(
                message.payload.requestId,
                (message.payload.completionStatus ?? (message.payload.success ? "completed" : "failed")) === "failed"
                    ? "failed"
                    : "completed"
            );
            sessionStore.updateToolStatus(
                message.payload.requestId,
                message.payload.completionStatus
                ?? (message.payload.success ? "completed" : "failed"),
                message.payload.errorMessage,
            );
            break;
        }

        case "permission.request": {
            clearLoadingForActiveSession(message.payload.sessionId);
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
                    title: readSessionNotificationTitle(message.payload.sessionId, "Approval needed"),
                    body: `Approval needed: ${promptSummary}`,
                    eventType: "permission_prompt",
                });
            }
            break;
        }

        case "user_input.request": {
            clearLoadingForActiveSession(message.payload.sessionId);
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
                    title: readSessionNotificationTitle(message.payload.sessionId, "Input needed"),
                    body: `Input needed: ${message.payload.prompt}`,
                    eventType: "user_input_prompt",
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
                sessionStore.setAgentTodos([]);
                sessionStore.clearSubagentRuns();
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
                if (sessionStore.activeSessionId !== null) {
                    sessionStore.setSessionBusy(sessionStore.activeSessionId, false);
                }
                connectionStore.setError(errorMessage);
                scheduleTransientConnectionErrorClear(errorMessage);
                break;
            }

            clearBackgroundCompletion();
            sessionStore.setSessionLoading(false);
            sessionStore.setAssistantTyping(false);
            sessionStore.setAbortRequested(false);
            if (sessionStore.activeSessionId !== null) {
                sessionStore.setSessionBusy(sessionStore.activeSessionId, false);
            }
            sessionStore.setAgentTodos([]);
            sessionStore.clearSubagentRuns();
            // Clear open dialogs after a fatal error so they do not stay stuck onscreen.
            sessionStore.clearPermissionPrompts();
            sessionStore.setUserInputPrompt(null);
            sessionStore.setPlanExitPrompt(null);
            const errorMessage = `[${message.payload.code}] ${message.payload.message}`;
            connectionStore.setError(errorMessage);
            break;
        }

        case "message.abort.result": {
            if (message.payload.success) {
                clearBackgroundCompletion(message.payload.sessionId);
                if (isActiveSession(message.payload.sessionId)) {
                    sessionStore.stopActiveTurn();
                }
                break;
            }

            if (isActiveSession(message.payload.sessionId)) {
                sessionStore.setAbortRequested(false);
            }
            connectionStore.setError(
                message.payload.error !== undefined && message.payload.error.length > 0
                    ? `Failed to stop message: ${message.payload.error}`
                    : "Failed to stop message"
            );
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

        case "skills.list.response":
        case "commands.list.response": {
            break;
        }

        case "session.state": {
            if (message.payload.busy !== undefined) {
                const wasBusy = useSessionStore.getState().busySessions[message.payload.sessionId] === true;
                sessionStore.setSessionBusy(message.payload.sessionId, message.payload.busy);
                if (message.payload.busy && !wasBusy) {
                    emittedSystemNotificationKeys.delete(message.payload.sessionId);
                }
            }

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
                    const abortInFlight = isAbortInFlightForSession(message.payload.sessionId);
                    flushSessionStreamBuffers(message.payload.sessionId);
                    if (abortInFlight) {
                        clearBackgroundCompletion(message.payload.sessionId);
                        sessionStore.stopActiveTurn();
                    } else {
                        notifyIfBackgroundCompletion(message.payload.sessionId);
                        sessionStore.setAbortRequested(false);
                        sessionStore.setAgentTodos([]);
                        sessionStore.settleRunningTools("completed");
                        sessionStore.finalizeThinking();
                        sessionStore.clearSubagentRuns();
                    }
                }
                sessionStore.setAssistantTyping(message.payload.busy);
            }
            break;
        }

        case "session.error": {
            clearPendingHistoryRefresh(message.payload.sessionId);
            clearSessionPrefetch(message.payload.sessionId);
            flushSessionStreamBuffers(message.payload.sessionId);
            sessionStore.setSessionBusy(message.payload.sessionId, false);
            const formattedError = `[${message.payload.errorType}] ${message.payload.message}`;
            notifyBackgroundCompletionFailure(
                message.payload.sessionId,
                formattedError
            );
            clearBackgroundCompletion(message.payload.sessionId);
            sessionStore.clearSessionPrompts(message.payload.sessionId);
            if (sessionStore.activeSessionId === message.payload.sessionId) {
                sessionStore.settleRunningTools("failed", message.payload.message);
                sessionStore.setSessionLoading(false);
                sessionStore.setAssistantTyping(false);
                sessionStore.setAbortRequested(false);
                sessionStore.setAgentTodos([]);
                sessionStore.clearSubagentRuns();
                addSystemNotificationForActiveSession(message.payload.sessionId, formattedError);
            }
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
            sessionStore.setCurrentIntent(normalizeAssistantIntent(message.payload.intent));
            break;
        }

        case "session.usage": {
            sessionStore.setSessionUsage(message.payload);
            break;
        }

        case "session.history.compact.response": {
            if (!isActiveSession(message.payload.sessionId)) break;

            const content = message.payload.success
                ? `Conversation compacted. Removed ${message.payload.messagesRemoved} messages and freed ${message.payload.tokensRemoved} tokens.`
                : `Could not compact conversation: ${message.payload.error ?? "Unknown error"}`;
            sessionStore.finalizeAssistantMessage(content);
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
                requestWorkspaceSnapshot(message.payload.sessionId);
            }
            break;
        }

        case "workspace.commit.result":
        case "workspace.pull.result":
        case "workspace.push.result": {
            if (!isActiveSession(message.payload.sessionId)) break;
            const workspaceStore = useWorkspaceStore.getState();
            workspaceStore.setWorkspaceOperationResult(message.payload);
            if (message.payload.success) {
                requestWorkspaceSnapshot(message.payload.sessionId);
            }
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
            const { sessionId, workspaceRelativePath, commitHash, diff, error } = message.payload;
            dispatchWorkspaceDiffResponse(sessionId, workspaceRelativePath, commitHash, {
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

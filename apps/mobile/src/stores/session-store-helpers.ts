import { saveSessionPreferences } from "../services/credentials";
import type {
    AgentMode,
    PermissionLevel,
    ReasoningEffortLevel,
    SessionInfo,
    ModelInfo,
} from "@copilot-mobile/shared";
import type { ChatItem } from "./session-store-types";

let itemCounter = 0;

export const reasoningEffortValues: ReadonlyArray<ReasoningEffortLevel> = ["low", "medium", "high", "xhigh"];

export function persistSessionPreferences(state: {
    selectedModel: string;
    reasoningEffort: ReasoningEffortLevel | null;
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
    autoApproveReads: boolean;
}): void {
    void saveSessionPreferences({
        selectedModel: state.selectedModel,
        reasoningEffort: state.reasoningEffort,
        agentMode: state.agentMode,
        permissionLevel: state.permissionLevel,
        autoApproveReads: state.autoApproveReads,
    }).catch((error: unknown) => {
        console.warn("Failed to persist session preferences", error);
    });
}

export function createItemId(): string {
    itemCounter += 1;
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    return `item-${Date.now()}-${itemCounter}-${randomSuffix}`;
}

export function appendDeferredPrompt<T extends { requestId: string }>(
    prompts: ReadonlyArray<T> | undefined,
    prompt: T
): Array<T> {
    if (prompts?.some((item) => item.requestId === prompt.requestId) === true) {
        return [...prompts];
    }

    return [...(prompts ?? []), prompt];
}

export function removeDeferredPromptByRequestId<T extends { requestId: string }>(
    prompts: ReadonlyArray<T> | undefined,
    requestId: string
): Array<T> {
    return (prompts ?? []).filter((item) => item.requestId !== requestId);
}

export function pruneDeferredPromptEntries<T>(
    promptEntries: ReadonlyArray<readonly [string, ReadonlyArray<T>]>
): Record<string, ReadonlyArray<T>> {
    return Object.fromEntries(
        promptEntries.filter((entry): entry is [string, ReadonlyArray<T>] => entry[1].length > 0)
    );
}

function findTrailingAssistantInsertIndex(items: ReadonlyArray<ChatItem>): number {
    let index = items.length;

    while (index > 0) {
        const item = items[index - 1];
        if (item === undefined || item.type !== "assistant" || item.isStreaming) {
            break;
        }
        index -= 1;
    }

    return index < items.length ? index : -1;
}

export function insertChatItemBeforeTrailingAssistant(
    items: ReadonlyArray<ChatItem>,
    nextItem: ChatItem
): Array<ChatItem> {
    const insertIndex = findTrailingAssistantInsertIndex(items);
    if (insertIndex === -1) {
        return [...items, nextItem];
    }

    return [
        ...items.slice(0, insertIndex),
        nextItem,
        ...items.slice(insertIndex),
    ];
}

export function findLastStreamingThinkingIndex(items: ReadonlyArray<ChatItem>): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item !== undefined && item.type === "thinking" && item.isStreaming) {
            return index;
        }
    }

    return -1;
}

export function sortSessionsByActivity(sessions: ReadonlyArray<SessionInfo>): Array<SessionInfo> {
    return [...sessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
}

export function dedupeSessionsById(sessions: ReadonlyArray<SessionInfo>): Array<SessionInfo> {
    const byId = new Map<string, SessionInfo>();

    for (const session of sessions) {
        const existing = byId.get(session.id);
        if (existing === undefined || session.lastActiveAt > existing.lastActiveAt) {
            byId.set(session.id, session);
        }
    }

    return [...byId.values()];
}

export function deriveAvailableReasoningEfforts(
    model: ModelInfo | undefined
): {
    options: ReadonlyArray<ReasoningEffortLevel>;
    supported: boolean;
    listKnown: boolean;
} {
    if (model === undefined) {
        return { options: [], supported: false, listKnown: false };
    }

    if (model.supportsReasoningEffort !== true) {
        return { options: [], supported: false, listKnown: false };
    }

    const explicit = model.supportedReasoningEfforts;
    if (explicit !== undefined && explicit.length > 0) {
        return {
            options: explicit,
            supported: true,
            listKnown: true,
        };
    }

    return { options: [], supported: true, listKnown: false };
}

export function reconcileReasoningEffort(
    currentEffort: ReasoningEffortLevel | null,
    nextModel: ModelInfo | undefined
): ReasoningEffortLevel | null {
    const derived = deriveAvailableReasoningEfforts(nextModel);

    if (!derived.supported) {
        return null;
    }

    if (derived.listKnown) {
        if (
            currentEffort !== null &&
            derived.options.includes(currentEffort)
        ) {
            return currentEffort;
        }
        if (
            nextModel?.defaultReasoningEffort !== undefined &&
            derived.options.includes(nextModel.defaultReasoningEffort)
        ) {
            return nextModel.defaultReasoningEffort;
        }
        return derived.options[0] ?? null;
    }

    if (nextModel?.defaultReasoningEffort !== undefined) {
        return nextModel.defaultReasoningEffort;
    }
    return null;
}

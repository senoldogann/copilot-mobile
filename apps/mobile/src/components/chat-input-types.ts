export type ImageAttachment = {
    uri: string;
    width: number;
    height: number;
    fileName: string;
    mimeType: string;
    base64Data: string;
};

export type SendMode = "send" | "queue" | "steer";

export type QueuedDraft = {
    id: string;
    sessionId: string | null;
    content: string;
    images: ReadonlyArray<ImageAttachment>;
};

export type ChatInputProps = {
    onSend: (content: string, images: ReadonlyArray<ImageAttachment>, mode: SendMode) => void;
    onRunUsage: () => void;
    onRunCompact: () => void;
    onStartNewChat: () => void;
    onOpenSettings: () => void;
    onAbort: () => void;
    onLockedPress: () => void;
    isTyping: boolean;
    isAbortPending: boolean;
    disabled: boolean;
    isComposerLocked: boolean;
    inputPlaceholder: string;
    queuedDrafts: ReadonlyArray<QueuedDraft>;
    editingDraft: QueuedDraft | null;
    onEditingDraftConsumed: () => void;
    onEditQueuedDraft: (draftId: string) => void;
    onRemoveQueuedDraft: (draftId: string) => void;
    onSteerQueuedDraft: (draftId: string) => void;
};

export type SlashCommand = {
    command: string;
    description: string;
    category: string;
};

export type AutocompleteToken =
    | { kind: "context"; query: string; start: number; end: number }
    | { kind: "mention"; query: string; start: number; end: number }
    | { kind: "slash"; query: string; start: number; end: number }
    | null;

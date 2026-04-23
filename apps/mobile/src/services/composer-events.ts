type ComposerInsertMode = "replace-selection" | "append";

type ComposerInsertRequest = {
    text: string;
    mode: ComposerInsertMode;
};

type ComposerInsertListener = (request: ComposerInsertRequest) => boolean;

const listeners = new Set<ComposerInsertListener>();

export function subscribeComposerInsert(listener: ComposerInsertListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function insertIntoComposer(request: ComposerInsertRequest): boolean {
    let handled = false;

    for (const listener of listeners) {
        handled = listener(request) || handled;
    }

    return handled;
}

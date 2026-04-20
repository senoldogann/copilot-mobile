// Tiny publish/subscribe for workspace.file.response — avoids circular deps
// between bridge.ts and message-handler.ts.

type FileResponsePayload = {
    content: string;
    mimeType: string;
    truncated: boolean;
    error?: string;
};

type FileResponseListener = (payload: FileResponsePayload) => void;

const listeners = new Map<string, Array<FileResponseListener>>();

export function onWorkspaceFileResponse(path: string, cb: FileResponseListener): () => void {
    const list = listeners.get(path) ?? [];
    list.push(cb);
    listeners.set(path, list);
    return () => {
        const current = listeners.get(path);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? listeners.delete(path) : listeners.set(path, updated);
        }
    };
}

export function dispatchWorkspaceFileResponse(path: string, payload: FileResponsePayload): void {
    const list = listeners.get(path);
    if (list !== undefined) {
        for (const cb of list) {
            cb(payload);
        }
    }
}

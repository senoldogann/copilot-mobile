// Tiny publish/subscribe for workspace.file.response and workspace.diff.response —
// avoids circular deps between bridge.ts and message-handler.ts.

type FileResponsePayload = {
    content: string;
    mimeType: string;
    truncated: boolean;
    error?: string;
};

type DiffResponsePayload = {
    diff: string;
    error?: string;
};

type FileResponseListener = (payload: FileResponsePayload) => void;
type DiffResponseListener = (payload: DiffResponsePayload) => void;

const fileListeners = new Map<string, Array<FileResponseListener>>();
const diffListeners = new Map<string, Array<DiffResponseListener>>();

export type WorkspaceFilePayload = FileResponsePayload;
export type WorkspaceDiffPayload = DiffResponsePayload;

export function onWorkspaceFileResponse(path: string, cb: FileResponseListener): () => void {
    const list = fileListeners.get(path) ?? [];
    list.push(cb);
    fileListeners.set(path, list);
    return () => {
        const current = fileListeners.get(path);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? fileListeners.delete(path) : fileListeners.set(path, updated);
        }
    };
}

export function dispatchWorkspaceFileResponse(path: string, payload: FileResponsePayload): void {
    const list = fileListeners.get(path);
    if (list !== undefined) {
        for (const cb of list) {
            cb(payload);
        }
    }
}

export function onWorkspaceDiffResponse(path: string, cb: DiffResponseListener): () => void {
    const list = diffListeners.get(path) ?? [];
    list.push(cb);
    diffListeners.set(path, list);
    return () => {
        const current = diffListeners.get(path);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? diffListeners.delete(path) : diffListeners.set(path, updated);
        }
    };
}

export function dispatchWorkspaceDiffResponse(path: string, payload: DiffResponsePayload): void {
    const list = diffListeners.get(path);
    if (list !== undefined) {
        for (const cb of list) {
            cb(payload);
        }
    }
}

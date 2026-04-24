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

type ResolveResponsePayload = {
    rawPath: string;
    resolvedWorkspaceRelativePath?: string;
    matches?: ReadonlyArray<string>;
    error?: string;
};

type SearchResponsePayload = {
    query: string;
    matches: ReadonlyArray<{
        path: string;
        displayPath: string;
        name: string;
    }>;
    error?: string;
};

type FileResponseListener = (payload: FileResponsePayload) => void;
type DiffResponseListener = (payload: DiffResponsePayload) => void;
type ResolveResponseListener = (payload: ResolveResponsePayload) => void;
type SearchResponseListener = (payload: SearchResponsePayload) => void;

const fileListeners = new Map<string, Array<FileResponseListener>>();
const diffListeners = new Map<string, Array<DiffResponseListener>>();
const resolveListeners = new Map<string, Array<ResolveResponseListener>>();
const searchListeners = new Map<string, Array<SearchResponseListener>>();

export type WorkspaceFilePayload = FileResponsePayload;
export type WorkspaceDiffPayload = DiffResponsePayload;
export type WorkspaceResolvePayload = ResolveResponsePayload;
export type WorkspaceSearchPayload = SearchResponsePayload;

function createWorkspaceEventKey(sessionId: string, workspaceRelativePath: string): string {
    return `${sessionId}\u0000${workspaceRelativePath}`;
}

function createWorkspaceDiffEventKey(
    sessionId: string,
    workspaceRelativePath: string,
    commitHash: string | undefined
): string {
    return `${sessionId}\u0000${workspaceRelativePath}\u0000${commitHash ?? ""}`;
}

export function onWorkspaceFileResponse(
    sessionId: string,
    workspaceRelativePath: string,
    cb: FileResponseListener
): () => void {
    const key = createWorkspaceEventKey(sessionId, workspaceRelativePath);
    const list = fileListeners.get(key) ?? [];
    list.push(cb);
    fileListeners.set(key, list);
    return () => {
        const current = fileListeners.get(key);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? fileListeners.delete(key) : fileListeners.set(key, updated);
        }
    };
}

export function dispatchWorkspaceFileResponse(
    sessionId: string,
    workspaceRelativePath: string,
    payload: FileResponsePayload
): void {
    const list = fileListeners.get(createWorkspaceEventKey(sessionId, workspaceRelativePath));
    if (list !== undefined) {
        for (const cb of list) {
            cb(payload);
        }
    }
}

export function onWorkspaceDiffResponse(
    sessionId: string,
    workspaceRelativePath: string,
    commitHash: string | undefined,
    cb: DiffResponseListener
): () => void {
    const key = createWorkspaceDiffEventKey(sessionId, workspaceRelativePath, commitHash);
    const list = diffListeners.get(key) ?? [];
    list.push(cb);
    diffListeners.set(key, list);
    return () => {
        const current = diffListeners.get(key);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? diffListeners.delete(key) : diffListeners.set(key, updated);
        }
    };
}

export function dispatchWorkspaceDiffResponse(
    sessionId: string,
    workspaceRelativePath: string,
    commitHash: string | undefined,
    payload: DiffResponsePayload
): void {
    const exactKey = createWorkspaceDiffEventKey(sessionId, workspaceRelativePath, commitHash);
    const exactList = diffListeners.get(exactKey);
    if (exactList !== undefined) {
        for (const cb of exactList) {
            cb(payload);
        }
        return;
    }

    if (commitHash === undefined) {
        const legacyPrefix = `${sessionId}\u0000${workspaceRelativePath}\u0000`;
        for (const [key, listeners] of diffListeners.entries()) {
            if (key.startsWith(legacyPrefix)) {
                for (const cb of listeners) {
                    cb(payload);
                }
            }
        }
    }
}

export function onWorkspaceResolveResponse(
    sessionId: string,
    rawPath: string,
    cb: ResolveResponseListener
): () => void {
    const key = createWorkspaceEventKey(sessionId, rawPath);
    const list = resolveListeners.get(key) ?? [];
    list.push(cb);
    resolveListeners.set(key, list);
    return () => {
        const current = resolveListeners.get(key);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? resolveListeners.delete(key) : resolveListeners.set(key, updated);
        }
    };
}

export function dispatchWorkspaceResolveResponse(
    sessionId: string,
    rawPath: string,
    payload: ResolveResponsePayload
): void {
    const list = resolveListeners.get(createWorkspaceEventKey(sessionId, rawPath));
    if (list !== undefined) {
        for (const cb of list) {
            cb(payload);
        }
    }
}

export function onWorkspaceSearchResponse(
    requestKey: string,
    cb: SearchResponseListener
): () => void {
    const list = searchListeners.get(requestKey) ?? [];
    list.push(cb);
    searchListeners.set(requestKey, list);
    return () => {
        const current = searchListeners.get(requestKey);
        if (current !== undefined) {
            const updated = current.filter((fn) => fn !== cb);
            updated.length === 0 ? searchListeners.delete(requestKey) : searchListeners.set(requestKey, updated);
        }
    };
}

export function dispatchWorkspaceSearchResponse(
    requestKey: string,
    payload: SearchResponsePayload
): void {
    const list = searchListeners.get(requestKey);
    if (list !== undefined) {
        for (const cb of list) {
            cb(payload);
        }
    }
}

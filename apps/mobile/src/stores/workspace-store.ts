// Workspace explorer state — git changes, files tree, pull/push status

import { create } from "zustand";
import type {
    GitCommitSummary,
    GitFileChange,
    SessionContext,
    WorkspaceOperation,
    WorkspaceTreeNode,
    WorkspaceGitSummaryMessage,
    WorkspaceTreeMessage,
    WorkspaceOperationResultPayload,
} from "@copilot-mobile/shared";

export type WorkspaceTab = "changes" | "files";

export type WorkspaceStore = {
    sessionId: string | null;
    context: SessionContext | null;
    rootPath: string | null;
    requestedPath: string | null;
    tree: WorkspaceTreeNode | null;
    treeTruncated: boolean;
    gitRoot: string | null;
    repository: string | null;
    branch: string | null;
    uncommittedChanges: ReadonlyArray<GitFileChange>;
    recentCommits: ReadonlyArray<GitCommitSummary>;
    gitTruncated: boolean;
    tab: WorkspaceTab;
    expandedPaths: Record<string, boolean>;
    loadingTreePaths: Record<string, boolean>;
    isLoadingGit: boolean;
    isPulling: boolean;
    isPushing: boolean;
    operationMessage: string | null;
    error: string | null;
    setTab: (tab: WorkspaceTab) => void;
    beginWorkspaceSession: (sessionId: string) => void;
    resetWorkspace: () => void;
    ensureExpanded: (path: string) => void;
    toggleExpanded: (path: string) => void;
    setTreeLoading: (path: string, loading: boolean) => void;
    setGitLoading: (loading: boolean) => void;
    setWorkspaceTree: (payload: WorkspaceTreeMessage["payload"]) => void;
    setWorkspaceGitSummary: (payload: WorkspaceGitSummaryMessage["payload"]) => void;
    setWorkspaceOperationState: (
        operation: WorkspaceOperation,
        loading: boolean,
        message?: string | null
    ) => void;
    setWorkspaceOperationResult: (payload: WorkspaceOperationResultPayload) => void;
    setError: (error: string | null) => void;
};

type WorkspaceState = Pick<
    WorkspaceStore,
    | "sessionId"
    | "context"
    | "rootPath"
    | "requestedPath"
    | "tree"
    | "treeTruncated"
    | "gitRoot"
    | "repository"
    | "branch"
    | "uncommittedChanges"
    | "recentCommits"
    | "gitTruncated"
    | "tab"
    | "expandedPaths"
    | "loadingTreePaths"
    | "isLoadingGit"
    | "isPulling"
    | "isPushing"
    | "operationMessage"
    | "error"
>;

const initialState: WorkspaceState = {
    sessionId: null,
    context: null,
    rootPath: null,
    requestedPath: null,
    tree: null,
    treeTruncated: false,
    gitRoot: null,
    repository: null,
    branch: null,
    uncommittedChanges: [],
    recentCommits: [],
    gitTruncated: false,
    tab: "changes" as WorkspaceTab,
    expandedPaths: {},
    loadingTreePaths: {},
    isLoadingGit: false,
    isPulling: false,
    isPushing: false,
    operationMessage: null,
    error: null,
};

function replaceTreeNode(
    node: WorkspaceTreeNode,
    targetPath: string,
    replacement: WorkspaceTreeNode
): WorkspaceTreeNode {
    if (node.path === targetPath) {
        return replacement;
    }

    if (node.children === undefined || node.children.length === 0) {
        return node;
    }

    let didChange = false;
    const nextChildren = node.children.map((child) => {
        const nextChild = replaceTreeNode(child, targetPath, replacement);
        if (nextChild !== child) {
            didChange = true;
        }
        return nextChild;
    });

    if (!didChange) {
        return node;
    }

    return {
        ...node,
        children: nextChildren,
    };
}

function mergeWorkspaceTree(
    currentTree: WorkspaceTreeNode | null,
    requestedPath: string,
    nextTree: WorkspaceTreeNode
): WorkspaceTreeNode {
    if (currentTree === null || currentTree.path === requestedPath) {
        return nextTree;
    }

    return replaceTreeNode(currentTree, requestedPath, nextTree);
}

function setPathFlag(
    flags: Record<string, boolean>,
    path: string,
    value: boolean
): Record<string, boolean> {
    if (value) {
        return { ...flags, [path]: true };
    }

    if (!Object.prototype.hasOwnProperty.call(flags, path)) {
        return flags;
    }

    const nextFlags = { ...flags };
    delete nextFlags[path];
    return nextFlags;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
    ...initialState,

    setTab: (tab) => set({ tab }),

    beginWorkspaceSession: (sessionId) =>
        set((state) => ({
            ...initialState,
            sessionId,
            tab: state.tab,
        })),

    resetWorkspace: () => set({ ...initialState }),

    ensureExpanded: (path) =>
        set((state) => ({
            expandedPaths: { ...state.expandedPaths, [path]: true },
        })),

    toggleExpanded: (path) =>
        set((state) => ({
            expandedPaths: {
                ...state.expandedPaths,
                [path]: !state.expandedPaths[path],
            },
        })),

    setTreeLoading: (path, loading) =>
        set((state) => ({
            loadingTreePaths: setPathFlag(state.loadingTreePaths, path, loading),
        })),

    setGitLoading: (loading) => set({ isLoadingGit: loading }),

    setWorkspaceTree: (payload) =>
        set((state) => ({
            sessionId: payload.sessionId,
            context: payload.context,
            rootPath: payload.rootPath,
            requestedPath: payload.requestedPath,
            tree: mergeWorkspaceTree(state.tree, payload.requestedPath, payload.tree),
            treeTruncated: payload.truncated,
            expandedPaths: {
                ...state.expandedPaths,
                [payload.rootPath]: true,
                [payload.requestedPath]: true,
            },
            loadingTreePaths: setPathFlag(state.loadingTreePaths, payload.requestedPath, false),
            error: null,
        })),

    setWorkspaceGitSummary: (payload) =>
        set((state) => ({
            sessionId: payload.sessionId,
            context: payload.context,
            rootPath: payload.rootPath,
            gitRoot: payload.gitRoot,
            repository: payload.repository ?? null,
            branch: payload.branch ?? null,
            uncommittedChanges: payload.uncommittedChanges,
            recentCommits: payload.recentCommits,
            gitTruncated: payload.truncated,
            isLoadingGit: false,
            error: null,
            expandedPaths: {
                ...state.expandedPaths,
                [payload.rootPath]: true,
            },
        })),

    setWorkspaceOperationState: (operation, loading, message) =>
        set((state) => ({
            isPulling: operation === "pull" ? loading : state.isPulling,
            isPushing: operation === "push" ? loading : state.isPushing,
            operationMessage: loading ? null : (message !== undefined ? message : null),
            ...(loading ? { error: null } : {}),
        })),

    setWorkspaceOperationResult: (payload) =>
        set((state) => ({
            sessionId: payload.sessionId,
            context: payload.context,
            isPulling: payload.operation === "pull" ? false : state.isPulling,
            isPushing: payload.operation === "push" ? false : state.isPushing,
            operationMessage: payload.success
                ? (payload.message ?? `${payload.operation} completed`)
                : null,
            error: payload.success ? null : (payload.message ?? "Workspace operation failed"),
        })),

    setError: (error) => set({ error }),
}));

// Workspace explorer state — git changes, files tree, pull/push status

import { create } from "zustand";
import type {
    GitBranchSummary,
    GitCommitSummary,
    GitFileChange,
    SessionContext,
    WorkspaceOperation,
    WorkspaceBranchSwitchResultPayload,
    WorkspaceTreeNode,
    WorkspaceGitSummaryMessage,
    WorkspaceTreeMessage,
    WorkspaceOperationResultPayload,
} from "@copilot-mobile/shared";

export type WorkspaceTab = "changes" | "files";

export type WorkspaceStore = {
    sessionId: string | null;
    context: SessionContext | null;
    workspaceRoot: string | null;
    requestedWorkspaceRelativePath: string | null;
    tree: WorkspaceTreeNode | null;
    treeTruncated: boolean;
    gitRoot: string | null;
    repository: string | null;
    branch: string | null;
    branches: ReadonlyArray<GitBranchSummary>;
    uncommittedChanges: ReadonlyArray<GitFileChange>;
    recentCommits: ReadonlyArray<GitCommitSummary>;
    gitTruncated: boolean;
    tab: WorkspaceTab;
    expandedPaths: Record<string, boolean>;
    loadingTreePaths: Record<string, boolean>;
    isLoadingGit: boolean;
    isPulling: boolean;
    isPushing: boolean;
    isSwitchingBranch: boolean;
    operationMessage: string | null;
    error: string | null;
    setTab: (tab: WorkspaceTab) => void;
    beginWorkspaceSession: (sessionId: string) => void;
    resetWorkspace: () => void;
    ensureExpanded: (path: string) => void;
    toggleExpanded: (path: string) => void;
    setTreeLoading: (path: string, loading: boolean) => void;
    setGitLoading: (loading: boolean) => void;
    clearRequestLoadingState: () => void;
    setWorkspaceTree: (payload: WorkspaceTreeMessage["payload"]) => void;
    setWorkspaceGitSummary: (payload: WorkspaceGitSummaryMessage["payload"]) => void;
    setBranchSwitching: (loading: boolean) => void;
    setWorkspaceOperationState: (
        operation: WorkspaceOperation,
        loading: boolean,
        message?: string | null
    ) => void;
    setWorkspaceOperationResult: (payload: WorkspaceOperationResultPayload) => void;
    setWorkspaceBranchSwitchResult: (payload: WorkspaceBranchSwitchResultPayload) => void;
    setError: (error: string | null) => void;
};

type WorkspaceState = Pick<
    WorkspaceStore,
    | "sessionId"
    | "context"
    | "workspaceRoot"
    | "requestedWorkspaceRelativePath"
    | "tree"
    | "treeTruncated"
    | "gitRoot"
    | "repository"
    | "branch"
    | "branches"
    | "uncommittedChanges"
    | "recentCommits"
    | "gitTruncated"
    | "tab"
    | "expandedPaths"
    | "loadingTreePaths"
    | "isLoadingGit"
    | "isPulling"
    | "isPushing"
    | "isSwitchingBranch"
    | "operationMessage"
    | "error"
>;

const initialState: WorkspaceState = {
    sessionId: null,
    context: null,
    workspaceRoot: null,
    requestedWorkspaceRelativePath: null,
    tree: null,
    treeTruncated: false,
    gitRoot: null,
    repository: null,
    branch: null,
    branches: [],
    uncommittedChanges: [],
    recentCommits: [],
    gitTruncated: false,
    tab: "changes" as WorkspaceTab,
    expandedPaths: {},
    loadingTreePaths: {},
    isLoadingGit: false,
    isPulling: false,
    isPushing: false,
    isSwitchingBranch: false,
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
    requestedWorkspaceRelativePath: string,
    nextTree: WorkspaceTreeNode
): WorkspaceTreeNode {
    if (currentTree === null || currentTree.path === requestedWorkspaceRelativePath) {
        return nextTree;
    }

    return replaceTreeNode(currentTree, requestedWorkspaceRelativePath, nextTree);
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
    clearRequestLoadingState: () =>
        set({
            loadingTreePaths: {},
            isLoadingGit: false,
        }),

    setWorkspaceTree: (payload) =>
        set((state) => ({
            sessionId: payload.sessionId,
            context: payload.context,
            workspaceRoot: payload.workspaceRoot,
            requestedWorkspaceRelativePath: payload.requestedWorkspaceRelativePath,
            tree: mergeWorkspaceTree(
                state.tree,
                payload.requestedWorkspaceRelativePath,
                payload.tree
            ),
            treeTruncated: payload.truncated,
            expandedPaths: {
                ...state.expandedPaths,
                [payload.workspaceRoot]: true,
                [payload.requestedWorkspaceRelativePath]: true,
            },
            loadingTreePaths: setPathFlag(
                state.loadingTreePaths,
                payload.requestedWorkspaceRelativePath,
                false
            ),
            error: null,
        })),

    setWorkspaceGitSummary: (payload) =>
        set((state) => ({
            sessionId: payload.sessionId,
            context: payload.context,
            workspaceRoot: payload.workspaceRoot,
            gitRoot: payload.gitRoot,
            repository: payload.repository ?? null,
            branch: payload.branch ?? null,
            branches: payload.branches,
            uncommittedChanges: payload.uncommittedChanges,
            recentCommits: payload.recentCommits,
            gitTruncated: payload.truncated,
            isLoadingGit: false,
            error: null,
            expandedPaths: {
                ...state.expandedPaths,
                [payload.workspaceRoot]: true,
            },
        })),

    setBranchSwitching: (loading) =>
        set({
            isSwitchingBranch: loading,
            ...(loading ? { error: null, operationMessage: null } : {}),
        }),

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

    setWorkspaceBranchSwitchResult: (payload) =>
        set((state) => ({
            sessionId: payload.sessionId,
            context: payload.context,
            branch: payload.success ? payload.branchName : state.branch,
            isSwitchingBranch: false,
            operationMessage: payload.success
                ? (payload.message ?? `Switched to ${payload.branchName}`)
                : null,
            error: payload.success ? null : (payload.message ?? `Failed to switch to ${payload.branchName}`),
        })),

    setError: (error) => set({ error }),
}));

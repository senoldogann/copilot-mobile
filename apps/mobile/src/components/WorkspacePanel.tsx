// Workspace explorer bottom sheet — GitHub Mobile style Changes / Files view.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, TextInput, Keyboard } from "react-native";
import type { GitCommitSummary } from "@copilot-mobile/shared";
import { BottomSheet } from "./BottomSheet";
import { useAppTheme, type AppTheme } from "../theme/theme-context";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import {
    commitWorkspace,
    createWorkspaceBranch,
    pullWorkspace,
    pushWorkspace,
    refreshWorkspaceGitSummary,
    requestWorkspaceTree,
    requestWorkspaceDiff,
    requestWorkspaceFile,
    switchWorkspaceBranch,
    onWorkspaceDiffResponse,
    onWorkspaceFileResponse,
} from "../services/bridge";
import type { WorkspaceDiffPayload, WorkspaceFilePayload } from "../services/workspace-events";
import {
    GitBranchIcon,
    GitHubIcon,
    GitPullRequestIcon,
    GitPushIcon,
    HistoryIcon,
    FolderFilledIcon,
    FileTypeIcon,
    MoreVerticalIcon,
    RefreshIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    AlignLeftIcon,
    DiffIcon,
    ListTreeIcon,
    MenuListIcon,
} from "./ProviderIcon";
import { formatRelativeTimestamp } from "../view-models/provider-metadata";

type Props = {
    visible: boolean;
    onClose: () => void;
};

function basename(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? path;
}

function dirname(path: string): string | null {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return null;
    return normalized.slice(0, idx);
}

function formatCommitTimestamp(timestamp: number, now: number): string {
    return formatRelativeTimestamp(timestamp, now).replace(" ago", "");
}

type ViewMode = "paragraph" | "diff" | "tree";
const INITIAL_TREE_DEPTH = 2;
const DIRECTORY_TREE_DEPTH = 2;
const TREE_PAGE_SIZE = 200;
const WORKSPACE_LOAD_TIMEOUT_MS = 12_000;
const WORKSPACE_VIEWER_CACHE_TTL_MS = 30_000;
const WORKSPACE_GIT_POLL_INTERVAL_MS = 6_000;
const COMMIT_TIME_TICK_MS = 60_000;

type InlineLoadState =
    | { status: "loading" }
    | { status: "ready"; body: string; truncated: boolean }
    | { status: "error"; message: string };

type ViewerCacheEntry = Extract<InlineLoadState, { status: "ready" }> & {
    expiresAt: number;
};

const workspaceViewerCache = new Map<string, ViewerCacheEntry>();

type WorkspaceViewer = {
    path: string;
    workspaceRoot: string;
    mode: "file" | "diff";
    commitHash?: string;
};

function createViewerCacheKey(sessionId: string, viewer: WorkspaceViewer): string {
    return `${sessionId}:${viewer.workspaceRoot}:${viewer.mode}:${viewer.commitHash ?? "working-tree"}:${viewer.path}`;
}

function readViewerCache(key: string): Extract<InlineLoadState, { status: "ready" }> | null {
    const entry = workspaceViewerCache.get(key);
    if (entry === undefined) {
        return null;
    }

    if (entry.expiresAt <= Date.now()) {
        workspaceViewerCache.delete(key);
        return null;
    }

    return {
        status: "ready",
        body: entry.body,
        truncated: entry.truncated,
    };
}

function writeViewerCache(key: string, payload: Extract<InlineLoadState, { status: "ready" }>): void {
    workspaceViewerCache.set(key, {
        ...payload,
        expiresAt: Date.now() + WORKSPACE_VIEWER_CACHE_TTL_MS,
    });
}

function clearViewerCacheForSession(sessionId: string): void {
    for (const key of workspaceViewerCache.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
            workspaceViewerCache.delete(key);
        }
    }
}

function WorkspacePanelComponent({ visible, onClose }: Props) {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const sheetStyles = useMemo(() => createSheetStyles(theme), [theme]);
    const treeStyles = useMemo(() => createTreeStyles(theme), [theme]);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const sessions = useSessionStore((s) => s.sessions);
    const connectionState = useConnectionStore((s) => s.state);
    const isConnected = connectionState === "authenticated";
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    const activeContext = activeSession?.context;

    const workspace = useWorkspaceStore(
        useShallow((s) => ({
            sessionId: s.sessionId,
            workspaceRoot: s.workspaceRoot,
            tree: s.tree,
            treeTruncated: s.treeTruncated,
            gitRoot: s.gitRoot,
            repository: s.repository,
            branch: s.branch,
            branches: s.branches,
            uncommittedChanges: s.uncommittedChanges,
            recentCommits: s.recentCommits,
            tab: s.tab,
            expandedPaths: s.expandedPaths,
            loadingTreePaths: s.loadingTreePaths,
            isLoadingGit: s.isLoadingGit,
            isCommitting: s.isCommitting,
            isPulling: s.isPulling,
            isPushing: s.isPushing,
            isSwitchingBranch: s.isSwitchingBranch,
            operationMessage: s.operationMessage,
            error: s.error,
        })),
    );

    const [viewMode, setViewMode] = useState<ViewMode>("diff");
    const [branchMenuOpen, setBranchMenuOpen] = useState<boolean>(false);
    const [branchComposerOpen, setBranchComposerOpen] = useState<boolean>(false);
    const [newBranchName, setNewBranchName] = useState("");
    const [commitMenuOpen, setCommitMenuOpen] = useState<boolean>(false);
    const [commitComposerOpen, setCommitComposerOpen] = useState<boolean>(false);
    const [commitMessage, setCommitMessage] = useState("");
    const [changesFilter, setChangesFilter] = useState<"uncommitted" | "recent">("uncommitted");
    const [changesFilterMenuOpen, setChangesFilterMenuOpen] = useState<boolean>(false);
    const [viewer, setViewer] = useState<WorkspaceViewer | null>(null);
    const [selectedCommit, setSelectedCommit] = useState<GitCommitSummary | null>(null);
    const [inlineLoad, setInlineLoad] = useState<InlineLoadState>({ status: "loading" });
    const [commitListNow, setCommitListNow] = useState(Date.now());
    const workspaceLoadingSignature = useMemo(
        () => Object.keys(workspace.loadingTreePaths).sort().join("|"),
        [workspace.loadingTreePaths],
    );
    const workspaceContentSignature = useMemo(
        () => JSON.stringify({
            branch: workspace.branch,
            uncommitted: workspace.uncommittedChanges.map((change) => `${change.status}:${change.path}`),
            commits: workspace.recentCommits.map((commit) => `${commit.hash}:${commit.committedAt}`),
        }),
        [workspace.branch, workspace.recentCommits, workspace.uncommittedChanges],
    );

    const openViewer = useCallback(
        (viewerInput: Omit<WorkspaceViewer, "workspaceRoot">) => {
            const workspaceRoot = workspace.workspaceRoot;
            if (workspaceRoot === null) {
                return;
            }

            setViewer({
                ...viewerInput,
                workspaceRoot,
            });
        },
        [workspace.workspaceRoot],
    );

    // Load diff/file whenever viewer changes
    useEffect(() => {
        if (viewer === null || activeSessionId === null) return;

        const cacheKey = createViewerCacheKey(activeSessionId, viewer);
        const cached = readViewerCache(cacheKey);
        if (cached !== null) {
            setInlineLoad(cached);
            return;
        }

        setInlineLoad({ status: "loading" });

        const timeout = setTimeout(() => {
            setInlineLoad({ status: "error", message: "Timed out." });
        }, 10_000);

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
        };

        if (viewer.mode === "diff") {
            const unsub = onWorkspaceDiffResponse(activeSessionId, viewer.path, viewer.commitHash, (payload: WorkspaceDiffPayload) => {
                finish();
                unsub();
                if (payload.error !== undefined) {
                    setInlineLoad({ status: "error", message: payload.error });
                } else {
                    const nextState: Extract<InlineLoadState, { status: "ready" }> = {
                        status: "ready",
                        body: payload.diff.length > 0 ? payload.diff : "(No changes)",
                        truncated: false,
                    };
                    writeViewerCache(cacheKey, nextState);
                    setInlineLoad(nextState);
                }
            });
            void requestWorkspaceDiff(activeSessionId, viewer.path, viewer.commitHash);
            return () => { finish(); unsub(); };
        } else {
            const unsub = onWorkspaceFileResponse(activeSessionId, viewer.path, (payload: WorkspaceFilePayload) => {
                finish();
                unsub();
                if (payload.error !== undefined) {
                    setInlineLoad({ status: "error", message: payload.error });
                } else {
                    const nextState: Extract<InlineLoadState, { status: "ready" }> = {
                        status: "ready",
                        body: payload.content,
                        truncated: payload.truncated,
                    };
                    writeViewerCache(cacheKey, nextState);
                    setInlineLoad(nextState);
                }
            });
            void requestWorkspaceFile(activeSessionId, viewer.path);
            return () => { finish(); unsub(); };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewer?.path, viewer?.workspaceRoot, viewer?.mode, viewer?.commitHash, activeSessionId]);

    useEffect(() => {
        if (!visible) return;

        setViewMode("diff");
        setChangesFilter("uncommitted");
        useWorkspaceStore.getState().setBranchSwitching(false);
        setBranchMenuOpen(false);
        setBranchComposerOpen(false);
        setNewBranchName("");
        setCommitMenuOpen(false);
        setCommitComposerOpen(false);
        setCommitMessage("");
        setChangesFilterMenuOpen(false);
        setViewer(null);
        setSelectedCommit(null);
        setInlineLoad({ status: "loading" });

        if (activeSessionId === null) {
            useWorkspaceStore.getState().resetWorkspace();
            return;
        }

        const store = useWorkspaceStore.getState();
        if (store.sessionId !== activeSessionId) {
            store.beginWorkspaceSession(activeSessionId);
        }

        if (!isConnected) return;

        void requestWorkspaceTree(activeSessionId, undefined, INITIAL_TREE_DEPTH, 0, TREE_PAGE_SIZE);
        void refreshWorkspaceGitSummary(activeSessionId, 10);
    }, [visible, activeSessionId, isConnected]);

    useEffect(() => {
        if (
            !visible
            || activeSessionId === null
            || !isConnected
            || workspace.tab !== "changes"
            || changesFilter === "recent"
        ) {
            return;
        }

        const interval = setInterval(() => {
            void refreshWorkspaceGitSummary(activeSessionId, 10);
        }, WORKSPACE_GIT_POLL_INTERVAL_MS);

        return () => {
            clearInterval(interval);
        };
    }, [activeSessionId, changesFilter, isConnected, visible, workspace.tab]);

    useEffect(() => {
        if (!visible || workspace.tab !== "changes" || changesFilter !== "recent") {
            return;
        }

        setCommitListNow(Date.now());
        const interval = setInterval(() => {
            setCommitListNow(Date.now());
        }, COMMIT_TIME_TICK_MS);

        return () => {
            clearInterval(interval);
        };
    }, [changesFilter, visible, workspace.tab]);

    useEffect(() => {
        if (activeSessionId === null) {
            return;
        }

        clearViewerCacheForSession(activeSessionId);
    }, [activeSessionId, workspaceContentSignature]);

    useEffect(() => {
        if (!visible || activeSessionId === null || !isConnected) {
            return;
        }

        const hasPendingWorkspaceLoad =
            workspace.isLoadingGit || Object.keys(workspace.loadingTreePaths).length > 0;
        if (!hasPendingWorkspaceLoad) {
            return;
        }

        const timeout = setTimeout(() => {
            const store = useWorkspaceStore.getState();
            const isSameSession = store.sessionId === activeSessionId || store.sessionId === null;
            const stillLoading = store.isLoadingGit || Object.keys(store.loadingTreePaths).length > 0;
            if (!isSameSession || !stillLoading) {
                return;
            }

            store.clearRequestLoadingState();
            store.setError("Workspace refresh timed out. Try again.");
        }, WORKSPACE_LOAD_TIMEOUT_MS);

        return () => {
            clearTimeout(timeout);
        };
    }, [
        activeSessionId,
        isConnected,
        visible,
        workspace.isLoadingGit,
        workspace.sessionId,
        workspaceLoadingSignature,
    ]);

    const hasRepo = workspace.gitRoot !== null;
    const treeRoot = workspace.tree;
    const rootTreeLoading = workspace.loadingTreePaths["__root__"] === true;
    const canRefresh = activeSessionId !== null && isConnected;

    const refreshWorkspace = useCallback(() => {
        if (activeSessionId === null) {
            useWorkspaceStore
                .getState()
                .setError("Open or resume a session first to inspect the workspace.");
            return;
        }
        if (!isConnected) {
            useWorkspaceStore
                .getState()
                .setError("Reconnect to the bridge to refresh workspace changes and files.");
            return;
        }
        clearViewerCacheForSession(activeSessionId);
        void requestWorkspaceTree(activeSessionId, undefined, INITIAL_TREE_DEPTH, 0, TREE_PAGE_SIZE);
        void refreshWorkspaceGitSummary(activeSessionId, 10);
    }, [activeSessionId, isConnected]);

    const handlePull = useCallback(() => {
        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        setCommitComposerOpen(false);
        if (activeSessionId === null || !isConnected) return;
        void pullWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const handlePush = useCallback(() => {
        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        setCommitComposerOpen(false);
        if (activeSessionId === null || !isConnected) return;
        void pushWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const handleOpenCommitComposer = useCallback(() => {
        if (activeSessionId === null || !isConnected || !hasRepo || workspace.uncommittedChanges.length === 0) {
            return;
        }

        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        setChangesFilterMenuOpen(false);
        setCommitComposerOpen(true);
    }, [activeSessionId, hasRepo, isConnected, workspace.uncommittedChanges.length]);

    const handleCancelCommitComposer = useCallback(() => {
        setCommitComposerOpen(false);
        setCommitMessage("");
        Keyboard.dismiss();
    }, []);

    const handleSubmitCommit = useCallback(() => {
        const trimmedMessage = commitMessage.trim();
        if (
            trimmedMessage.length === 0
            || activeSessionId === null
            || !isConnected
            || workspace.isCommitting
        ) {
            return;
        }

        void commitWorkspace(activeSessionId, trimmedMessage);
        setCommitComposerOpen(false);
        setCommitMessage("");
        Keyboard.dismiss();
    }, [activeSessionId, commitMessage, isConnected, workspace.isCommitting]);

    const handleToggleBranchMenu = useCallback(() => {
        if (activeSessionId === null || !isConnected || !hasRepo) {
            return;
        }

        setCommitMenuOpen(false);
        setChangesFilterMenuOpen(false);
        setBranchMenuOpen((value) => {
            const nextValue = !value;
            if (!nextValue) {
                setBranchComposerOpen(false);
                setNewBranchName("");
            }
            return nextValue;
        });
    }, [activeSessionId, hasRepo, isConnected]);

    const handleToggleCommitMenu = useCallback(() => {
        if (activeSessionId === null || !isConnected || !hasRepo) {
            return;
        }

        setBranchMenuOpen(false);
        setBranchComposerOpen(false);
        setNewBranchName("");
        setCommitComposerOpen(false);
        setChangesFilterMenuOpen(false);
        setCommitMenuOpen((value) => !value);
    }, [activeSessionId, hasRepo, isConnected]);

    const handleToggleChangesFilterMenu = useCallback(() => {
        setBranchMenuOpen(false);
        setBranchComposerOpen(false);
        setNewBranchName("");
        setCommitMenuOpen(false);
        setChangesFilterMenuOpen((value) => !value);
    }, []);

    const handleSwitchBranch = useCallback((branchName: string) => {
        if (activeSessionId === null || !isConnected || workspace.isSwitchingBranch) {
            return;
        }

        setBranchMenuOpen(false);
        setBranchComposerOpen(false);
        setNewBranchName("");
        void switchWorkspaceBranch(activeSessionId, branchName);
    }, [activeSessionId, isConnected, workspace.isSwitchingBranch]);

    const handleOpenBranchComposer = useCallback(() => {
        if (activeSessionId === null || !isConnected || !hasRepo || workspace.isSwitchingBranch) {
            return;
        }

        setCommitMenuOpen(false);
        setCommitComposerOpen(false);
        setChangesFilterMenuOpen(false);
        setBranchComposerOpen(true);
    }, [activeSessionId, hasRepo, isConnected, workspace.isSwitchingBranch]);

    const handleCancelBranchComposer = useCallback(() => {
        setBranchComposerOpen(false);
        setNewBranchName("");
        Keyboard.dismiss();
    }, []);

    const handleSubmitBranchCreate = useCallback(() => {
        const trimmedBranchName = newBranchName.trim();
        if (
            trimmedBranchName.length === 0
            || activeSessionId === null
            || !isConnected
            || workspace.isSwitchingBranch
        ) {
            return;
        }

        void createWorkspaceBranch(activeSessionId, trimmedBranchName);
        setBranchMenuOpen(false);
        setBranchComposerOpen(false);
        setNewBranchName("");
        Keyboard.dismiss();
    }, [activeSessionId, isConnected, newBranchName, workspace.isSwitchingBranch]);

    const hasGitContext = workspace.gitRoot !== null || activeContext?.gitRoot !== undefined;
    const branchLabel = workspace.branch ?? activeContext?.branch ?? (hasGitContext ? "main" : "workspace");
    const canCommit = hasRepo && isConnected && workspace.uncommittedChanges.length > 0;
    const rootLabel = useMemo(() => {
        const rp = workspace.workspaceRoot ?? activeContext?.workspaceRoot ?? null;
        if (rp === null) return "Workspace";
        return basename(rp) || rp;
    }, [workspace.workspaceRoot, activeContext?.workspaceRoot]);

    const isInitialGitLoading =
        isConnected &&
        activeSessionId !== null &&
        workspace.isLoadingGit &&
        workspace.uncommittedChanges.length === 0;

    const isInitialTreeLoading =
        isConnected && activeSessionId !== null && treeRoot === null && rootTreeLoading;
    const segmentTitleColor = theme.resolvedScheme === "light"
        ? theme.colors.textAssistant
        : theme.colors.textPrimary;
    const renderChangeRow = useCallback((change: (typeof workspace.uncommittedChanges)[number]) => {
        const name = basename(change.path);
        const dir = dirname(change.path);
        const additions = change.additions ?? 0;
        const deletions = change.deletions ?? 0;
        const isUntracked = change.status === "untracked" || change.status === "added";
        const hasStats = additions > 0 || deletions > 0;

        return (
            <Pressable
                key={change.path}
                style={({ pressed }) => [styles.changeRow, pressed && styles.changeRowPressed]}
                onPress={() => openViewer({ path: change.path, mode: "diff" })}
            >
                <View style={styles.changeIconWrap}>
                    <FileTypeIcon name={name} size={18} />
                </View>
                <View style={styles.changeText}>
                    <Text style={styles.changeName} numberOfLines={1}>
                        {name}
                    </Text>
                    {dir !== null && (
                        <Text style={styles.changePath} numberOfLines={1}>
                            {dir}
                        </Text>
                    )}
                </View>
                <View style={styles.changeRight}>
                    {isUntracked && (
                        <View style={styles.newBadge}>
                            <Text style={styles.newBadgeText}>New</Text>
                        </View>
                    )}
                    {hasStats && (
                        <View style={styles.diffStats}>
                            <Text style={styles.diffAdd}>+{additions}</Text>
                            <Text style={styles.diffDel}>-{deletions}</Text>
                        </View>
                    )}
                </View>
            </Pressable>
        );
    }, [openViewer, styles]);

    const renderTreeNode = useCallback(
        (node: NonNullable<typeof workspace.tree>, depth: number): React.ReactNode => {
            const isDirectory = node.type === "directory";
            const isExpanded = depth === 0 || workspace.expandedPaths[node.path] === true;
            const isLoading =
                workspace.loadingTreePaths[node.path] === true ||
                (depth === 0 && workspace.loadingTreePaths["__root__"] === true);

            const handlePress = () => {
                if (isDirectory) {
                    const nextExpanded = !isExpanded;
                    useWorkspaceStore.getState().toggleExpanded(node.path);
                    if (
                        nextExpanded &&
                        node.children === undefined &&
                        activeSessionId !== null &&
                        isConnected
                    ) {
                        void requestWorkspaceTree(activeSessionId, node.path, DIRECTORY_TREE_DEPTH, 0, TREE_PAGE_SIZE);
                    }
                } else {
                    openViewer({ path: node.path, mode: "file" });
                }
            };

            const handleLoadMore = () => {
                if (
                    !isDirectory
                    || node.nextOffset === undefined
                    || activeSessionId === null
                    || !isConnected
                ) {
                    return;
                }

                void requestWorkspaceTree(
                    activeSessionId,
                    node.path,
                    1,
                    node.nextOffset,
                    TREE_PAGE_SIZE
                );
            };

            return (
                <View key={node.path}>
                    <Pressable
                        style={({ pressed }) => [
                            treeStyles.row,
                            { paddingLeft: theme.spacing.lg + depth * 16 },
                            pressed && treeStyles.rowPressed,
                        ]}
                        onPress={handlePress}
                    >
                        <View style={treeStyles.chevronWrap}>
                            {isDirectory ? (
                                isExpanded ? (
                                    <ChevronDownIcon size={12} color={theme.colors.textTertiary} />
                                ) : (
                                    <ChevronRightIcon size={12} color={theme.colors.textTertiary} />
                                )
                            ) : null}
                        </View>
                        <View style={treeStyles.iconWrap}>
                            {isDirectory ? (
                                <FolderFilledIcon size={16} color={theme.colors.textSecondary} />
                            ) : (
                                <FileTypeIcon name={node.name} size={16} />
                            )}
                        </View>
                        <Text style={treeStyles.fileName} numberOfLines={1}>
                            {node.name}
                        </Text>
                        {isLoading ? (
                            <Text style={treeStyles.loading}>…</Text>
                        ) : (
                            <Pressable style={treeStyles.moreBtn} hitSlop={8}>
                                <MoreVerticalIcon size={16} color={theme.colors.textTertiary} />
                            </Pressable>
                        )}
                    </Pressable>
                    {isDirectory &&
                        isExpanded &&
                        node.children !== undefined &&
                        node.children.map((child) => renderTreeNode(child, depth + 1))}
                    {isDirectory && isExpanded && node.nextOffset !== undefined && (
                        <Pressable
                            style={({ pressed }) => [
                                treeStyles.loadMoreRow,
                                { paddingLeft: theme.spacing.lg + (depth + 1) * 16 },
                                pressed && treeStyles.rowPressed,
                            ]}
                            onPress={handleLoadMore}
                        >
                            <Text style={treeStyles.loadMoreText}>
                                Load more
                                {node.totalChildren !== undefined
                                    ? ` (${Math.min(node.nextOffset, node.totalChildren)}/${node.totalChildren})`
                                    : ""}
                            </Text>
                        </Pressable>
                    )}
                </View>
            );
        },
        [
            activeSessionId,
            isConnected,
            openViewer,
            theme.colors,
            theme.spacing.lg,
            treeStyles,
            workspace.expandedPaths,
            workspace.loadingTreePaths,
        ],
    );

    // ---------- Changes tab content ----------
    const changesContent = (
        <View style={styles.content}>
            {/* Branch + Commit pill */}
            <View style={[styles.branchRow, (branchMenuOpen || commitMenuOpen) && styles.rowWithOverlay]}>
                <View style={[styles.menuAnchor, styles.branchAnchor, branchMenuOpen && styles.menuAnchorActive]}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.branchPicker,
                            pressed && styles.pressed,
                            (!hasRepo || !isConnected || workspace.isSwitchingBranch) && styles.branchPickerDisabled,
                        ]}
                        onPress={handleToggleBranchMenu}
                        disabled={!hasRepo || !isConnected || workspace.isSwitchingBranch}
                    >
                        <View style={styles.branchLeft}>
                            <GitBranchIcon size={15} color={theme.colors.textSecondary} />
                            <Text style={styles.branchName} numberOfLines={1}>
                                {branchLabel}
                            </Text>
                            <ChevronDownIcon size={12} color={theme.colors.textTertiary} />
                        </View>
                    </Pressable>
                    {branchMenuOpen && (
                        <View style={[styles.popover, styles.anchoredPopover, styles.branchPopover]}>
                            {workspace.branches.length === 0 ? (
                                <View style={styles.branchEmptyState}>
                                    <Text style={styles.branchEmptyText}>No local branches found.</Text>
                                </View>
                            ) : workspace.branches.flatMap((branchItem, index) => {
                                const rows: Array<React.ReactNode> = [
                                    <Pressable
                                        key={branchItem.name}
                                        style={({ pressed }) => [
                                            styles.popoverItem,
                                            pressed && !branchItem.current && styles.popoverItemPressed,
                                            branchItem.current && styles.branchPopoverItemCurrent,
                                        ]}
                                        onPress={() => handleSwitchBranch(branchItem.name)}
                                        disabled={branchItem.current || workspace.isSwitchingBranch}
                                    >
                                        <GitBranchIcon
                                            size={14}
                                            color={branchItem.current ? theme.colors.textPrimary : theme.colors.textTertiary}
                                        />
                                        <Text style={styles.popoverLabel}>{branchItem.name}</Text>
                                        {branchItem.current && (
                                            <Text style={styles.branchCurrentLabel}>Current</Text>
                                        )}
                                    </Pressable>,
                                ];

                                if (index < workspace.branches.length - 1) {
                                    rows.push(<View key={`${branchItem.name}_sep`} style={styles.popoverSep} />);
                                }

                                return rows;
                            })}
                            {workspace.branches.length > 0 && <View style={styles.popoverSep} />}
                            {!branchComposerOpen ? (
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.popoverItem,
                                        pressed && styles.popoverItemPressed,
                                    ]}
                                    onPress={handleOpenBranchComposer}
                                    disabled={workspace.isSwitchingBranch}
                                >
                                    <GitBranchIcon size={14} color={theme.colors.textPrimary} />
                                    <Text style={styles.popoverLabel}>Create and checkout new branch</Text>
                                </Pressable>
                            ) : (
                                <View style={styles.branchComposer}>
                                    <Text style={styles.branchComposerTitle}>Create branch</Text>
                                    <Text style={styles.branchComposerHint}>
                                        A new local branch will be created and checked out immediately.
                                    </Text>
                                    <TextInput
                                        style={styles.branchComposerInput}
                                        value={newBranchName}
                                        onChangeText={setNewBranchName}
                                        placeholder="feature/my-branch"
                                        placeholderTextColor={theme.colors.textTertiary}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        returnKeyType="done"
                                        onSubmitEditing={handleSubmitBranchCreate}
                                        editable={!workspace.isSwitchingBranch}
                                    />
                                    <View style={styles.branchComposerActions}>
                                        <Pressable
                                            style={({ pressed }) => [
                                                styles.branchComposerSecondaryButton,
                                                pressed && styles.pressed,
                                            ]}
                                            onPress={handleCancelBranchComposer}
                                        >
                                            <Text style={styles.branchComposerSecondaryText}>Cancel</Text>
                                        </Pressable>
                                        <Pressable
                                            style={({ pressed }) => [
                                                styles.branchComposerPrimaryButton,
                                                (newBranchName.trim().length === 0 || workspace.isSwitchingBranch)
                                                    && styles.commitButtonDisabled,
                                                pressed
                                                    && newBranchName.trim().length > 0
                                                    && !workspace.isSwitchingBranch
                                                    && styles.pressed,
                                            ]}
                                            onPress={handleSubmitBranchCreate}
                                            disabled={newBranchName.trim().length === 0 || workspace.isSwitchingBranch}
                                        >
                                            <Text style={styles.branchComposerPrimaryText}>
                                                {workspace.isSwitchingBranch ? "Creating…" : "Create branch"}
                                            </Text>
                                        </Pressable>
                                    </View>
                                </View>
                            )}
                        </View>
                    )}
                </View>

                <View style={[styles.menuAnchor, styles.commitAnchor, commitMenuOpen && styles.menuAnchorActive]}>
                    <View style={styles.commitGroup}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.commitButton,
                                pressed && styles.pressed,
                                !canCommit && styles.commitButtonDisabled,
                            ]}
                            onPress={handleOpenCommitComposer}
                            disabled={!canCommit || workspace.isCommitting}
                        >
                            <GitHubIcon size={14} color={theme.colors.textPrimary} />
                            <Text style={styles.commitButtonText}>
                                {workspace.isCommitting ? "Committing…" : "Commit"}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [
                                styles.commitCaret,
                                pressed && styles.pressed,
                            ]}
                            onPress={handleToggleCommitMenu}
                            disabled={!hasRepo || !isConnected}
                        >
                            <ChevronDownIcon size={12} color={theme.colors.textPrimary} />
                        </Pressable>
                    </View>

                    {commitMenuOpen && (
                        <View style={[styles.popover, styles.anchoredPopover, styles.commitPopover]}>
                            <Pressable
                                style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
                                onPress={handlePull}
                            >
                                <GitPullRequestIcon size={14} color={theme.colors.textPrimary} />
                                <Text style={styles.popoverLabel}>
                                    {workspace.isPulling ? "Pulling…" : "Pull"}
                                </Text>
                            </Pressable>
                            <View style={styles.popoverSep} />
                            <Pressable
                                style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
                                onPress={handlePush}
                            >
                                <GitPushIcon size={14} color={theme.colors.textPrimary} />
                                <Text style={styles.popoverLabel}>
                                    {workspace.isPushing ? "Pushing…" : "Push"}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            </View>

            {commitComposerOpen && (
                <View style={styles.commitComposer}>
                    <Text style={styles.commitComposerTitle}>Create commit</Text>
                    <Text style={styles.commitComposerHint}>
                        All workspace changes will be staged and committed together.
                    </Text>
                    <TextInput
                        style={styles.commitComposerInput}
                        value={commitMessage}
                        onChangeText={setCommitMessage}
                        placeholder="Commit message"
                        placeholderTextColor={theme.colors.textTertiary}
                        returnKeyType="done"
                        onSubmitEditing={handleSubmitCommit}
                        editable={!workspace.isCommitting}
                    />
                    <View style={styles.commitComposerActions}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.commitComposerSecondaryButton,
                                pressed && styles.pressed,
                            ]}
                            onPress={handleCancelCommitComposer}
                        >
                            <Text style={styles.commitComposerSecondaryText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [
                                styles.commitComposerPrimaryButton,
                                (commitMessage.trim().length === 0 || workspace.isCommitting) && styles.commitButtonDisabled,
                                pressed && commitMessage.trim().length > 0 && !workspace.isCommitting && styles.pressed,
                            ]}
                            onPress={handleSubmitCommit}
                            disabled={commitMessage.trim().length === 0 || workspace.isCommitting}
                        >
                            <Text style={styles.commitComposerPrimaryText}>
                                {workspace.isCommitting ? "Saving…" : "Commit now"}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {/* Uncommitted segmented header */}
            <View style={[styles.segmentRow, changesFilterMenuOpen && styles.rowWithOverlay]}>
                <View style={[styles.menuAnchor, styles.segmentAnchor, changesFilterMenuOpen && styles.menuAnchorActive]}>
                    <Pressable
                        style={styles.segmentLeft}
                        hitSlop={4}
                        onPress={handleToggleChangesFilterMenu}
                    >
                        {changesFilter === "uncommitted" ? (
                            <DiffIcon size={14} color={segmentTitleColor} />
                        ) : (
                            <HistoryIcon size={14} color={segmentTitleColor} />
                        )}
                        <Text style={styles.segmentTitle}>
                            {changesFilter === "uncommitted" ? "Uncommitted" : "Recent commits"}
                        </Text>
                        <ChevronDownIcon size={12} color={theme.colors.textSecondary} />
                    </Pressable>

                    {changesFilterMenuOpen && (
                        <View style={[styles.popover, styles.anchoredPopover, styles.filterPopover]}>
                            <Pressable
                                style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
                                onPress={() => { setChangesFilter("uncommitted"); setChangesFilterMenuOpen(false); }}
                            >
                                <DiffIcon size={14} color={theme.colors.textPrimary} />
                                <Text style={styles.popoverLabel}>Uncommitted</Text>
                            </Pressable>
                            <View style={styles.popoverSep} />
                            <Pressable
                                style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
                                onPress={() => { setChangesFilter("recent"); setChangesFilterMenuOpen(false); }}
                            >
                                <HistoryIcon size={14} color={theme.colors.textPrimary} />
                                <Text style={styles.popoverLabel}>Recent commits</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
                <View style={styles.segmentRight}>
                    <ViewModeBtn active={viewMode === "paragraph"} onPress={() => setViewMode("paragraph")}>
                        <AlignLeftIcon size={14} color={viewMode === "paragraph" ? theme.colors.textPrimary : theme.colors.textTertiary} />
                    </ViewModeBtn>
                    <ViewModeBtn active={viewMode === "diff"} onPress={() => setViewMode("diff")}>
                        <DiffIcon size={14} color={viewMode === "diff" ? theme.colors.textPrimary : theme.colors.textTertiary} />
                    </ViewModeBtn>
                    <ViewModeBtn active={viewMode === "tree"} onPress={() => setViewMode("tree")}>
                        <ListTreeIcon size={14} color={viewMode === "tree" ? theme.colors.textPrimary : theme.colors.textTertiary} />
                    </ViewModeBtn>
                </View>
            </View>

            {workspace.error !== null && <Banner tone="error" text={workspace.error} />}

            {activeSessionId === null ? (
                <EmptyState
                    title="No active session"
                    text="Open or resume a session first. Workspace changes attach to the currently active session."
                />
            ) : !isConnected ? (
                <EmptyState
                    title="Bridge disconnected"
                    text="Reconnect to your bridge to load the latest workspace changes."
                />
            ) : isInitialGitLoading ? (
                <EmptyState text="Loading changes…" />
            ) : !hasRepo ? (
                <EmptyState title="No git repository" text={`${rootLabel} is not a git working tree.`} />
            ) : changesFilter === "recent" ? (
                workspace.recentCommits.length === 0 ? (
                    <EmptyState text="No recent commits." />
                ) : (
                    <View style={styles.changesList}>
                        {workspace.recentCommits.map((commit) => {
                            const fileCount = commit.files.length;

                            return (
                                <View key={commit.hash} style={styles.commitRow}>
                                    <View style={styles.commitIconWrap}>
                                        <HistoryIcon size={15} color={theme.colors.textSecondary} />
                                    </View>
                                    <View style={styles.commitBody}>
                                        <View style={styles.commitHeaderRow}>
                                            <Text style={styles.commitSubject} numberOfLines={2}>
                                                {commit.subject}
                                            </Text>
                                            <Text style={styles.commitTime} numberOfLines={1}>
                                                {formatCommitTimestamp(commit.committedAt, commitListNow)}
                                            </Text>
                                        </View>
                                        <Text style={styles.commitMeta} numberOfLines={1}>
                                            {commit.shortHash} · {commit.author}
                                        </Text>
                                        <View style={styles.commitFooterRow}>
                                            <Text style={styles.commitFileCount}>
                                                {fileCount} file{fileCount === 1 ? "" : "s"}
                                            </Text>
                                            <Pressable
                                                style={({ pressed }) => [
                                                    styles.commitFilesButton,
                                                    pressed && styles.pressed,
                                                ]}
                                                onPress={() => setSelectedCommit(commit)}
                                            >
                                                <MenuListIcon size={13} color={theme.colors.textPrimary} />
                                                <Text style={styles.commitFilesButtonText}>See files</Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )
            ) : workspace.uncommittedChanges.length === 0 ? (
                <EmptyState title="Working tree clean" text="No uncommitted changes in this branch." />
            ) : viewMode === "tree" ? (
                <View style={styles.changesList}>
                    {renderChangesAsTree(
                        workspace.uncommittedChanges,
                        (path) => openViewer({ path, mode: "diff" }),
                        styles,
                        treeStyles,
                        theme,
                    )}
                </View>
            ) : (
                <View style={styles.changesList}>
                    {workspace.uncommittedChanges.map(renderChangeRow)}
                </View>
            )}
        </View>
    );

    // ---------- Files tab content ----------
    const filesContent = (
        <View style={styles.content}>
            <View style={styles.filesHeader}>
                <Pressable style={styles.sortBtn} hitSlop={4}>
                    <Text style={styles.sortLabel}>Name</Text>
                    <ChevronDownIcon size={12} color={theme.colors.textSecondary} />
                </Pressable>
                <Pressable
                    style={[styles.refreshBtn, !canRefresh && styles.refreshBtnDisabled]}
                    onPress={refreshWorkspace}
                    disabled={!canRefresh}
                    hitSlop={6}
                >
                    <RefreshIcon size={15} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            {activeSessionId === null ? (
                <EmptyState
                    title="No active session"
                    text="Open or resume a session first. The Files tab mirrors the active session workspace."
                />
            ) : !isConnected ? (
                <EmptyState
                    title="Bridge disconnected"
                    text="Reconnect to your bridge to browse the workspace tree."
                />
            ) : isInitialTreeLoading ? (
                <EmptyState text="Loading files…" />
            ) : treeRoot === null ? (
                <EmptyState text="Open a workspace to load files" />
            ) : (
                <View style={treeStyles.tree}>
                    {workspace.treeTruncated && (
                        <Text style={styles.inlineTruncatedNotice}>
                            Large folders now load in pages. Expand a folder or tap Load more to continue browsing.
                        </Text>
                    )}
                    {renderTreeNode(treeRoot, 0)}
                </View>
            )}
        </View>
    );

    const headerSubtitle = `${rootLabel} · ${branchLabel}`;

    // Inline viewer content — shown instead of tabs when a file is selected
    const inlineViewerContent = viewer !== null ? (
        <View style={styles.inlineViewer}>
            {/* Back header */}
            <Pressable
                style={({ pressed }) => [styles.inlineBack, pressed && { opacity: 0.6 }]}
                onPress={() => setViewer(null)}
            >
                <ChevronRightIcon size={14} color={theme.colors.textSecondary} />
                <Text style={styles.inlineBackLabel}>Back</Text>
                <Text style={styles.inlineBackFile} numberOfLines={1}>
                    {basename(viewer.path)}
                </Text>
            </Pressable>
            {/* Content */}
            {inlineLoad.status === "loading" && (
                <View style={styles.inlineCentered}>
                    <ActivityIndicator color={theme.colors.textSecondary} size="small" />
                    <Text style={styles.inlineLoadingText}>Loading…</Text>
                </View>
            )}
            {inlineLoad.status === "error" && (
                <View style={styles.inlineCentered}>
                    <Text style={styles.inlineErrorText}>{inlineLoad.message}</Text>
                </View>
            )}
            {inlineLoad.status === "ready" && (
                <ScrollView horizontal={false}>
                    {inlineLoad.truncated && viewer.mode === "file" && (
                        <Text style={styles.inlineTruncatedNotice}>Showing first 256 KB</Text>
                    )}
                    {viewer.mode === "diff"
                        ? inlineLoad.body.split("\n").map((line, idx) => {
                            const { color, bg } = classifyDiffLine(line, theme);
                            return (
                                <Text
                                    key={idx}
                                    selectable
                                    style={[
                                        styles.diffLine,
                                        { color },
                                        bg !== null ? { backgroundColor: bg } : null,
                                    ]}
                                >
                                    {line.length === 0 ? " " : line}
                                </Text>
                            );
                        })
                        : inlineLoad.body.split("\n").map((line, idx) => (
                            <View key={idx} style={styles.codeLine}>
                                <Text style={styles.lineNum} selectable={false}>
                                    {String(idx + 1).padStart(4, " ")}
                                </Text>
                                <Text style={styles.codeText} selectable>
                                    {line.length === 0 ? " " : line}
                                </Text>
                            </View>
                        ))}
                </ScrollView>
            )}
        </View>
    ) : null;

    const commitFilesContent = selectedCommit !== null ? (
        <View style={styles.content}>
            <Pressable
                style={({ pressed }) => [styles.inlineBack, pressed && { opacity: 0.6 }]}
                onPress={() => setSelectedCommit(null)}
            >
                <ChevronRightIcon size={14} color={theme.colors.textSecondary} />
                <Text style={styles.inlineBackLabel}>Back</Text>
                <Text style={styles.inlineBackFile} numberOfLines={1}>
                    {selectedCommit.shortHash}
                </Text>
            </Pressable>
            <View style={styles.commitFilesSheetHeader}>
                <Text style={styles.commitFilesSheetTitle} numberOfLines={2}>
                    {selectedCommit.subject}
                </Text>
                <Text style={styles.commitFilesSheetMeta}>
                    {selectedCommit.shortHash} · {selectedCommit.files.length} file{selectedCommit.files.length === 1 ? "" : "s"}
                </Text>
            </View>
            <View style={styles.changesList}>
                {selectedCommit.files.map((filePath) => {
                    const directory = dirname(filePath);
                    const fileChange = selectedCommit.fileChanges?.find((change) => change.path === filePath);
                    const additions = fileChange?.additions ?? 0;
                    const deletions = fileChange?.deletions ?? 0;
                    const hasStats = additions > 0 || deletions > 0;

                    return (
                        <Pressable
                            key={`${selectedCommit.hash}:${filePath}`}
                            style={({ pressed }) => [styles.changeRow, pressed && styles.changeRowPressed]}
                            onPress={() => {
                                setSelectedCommit(null);
                                openViewer({ path: filePath, mode: "diff", commitHash: selectedCommit.hash });
                            }}
                        >
                            <View style={styles.changeIconWrap}>
                                <FileTypeIcon name={filePath} size={18} />
                            </View>
                            <View style={styles.changeText}>
                                <Text style={styles.changeName} numberOfLines={1}>
                                    {basename(filePath)}
                                </Text>
                                {directory !== null && (
                                    <Text style={styles.changePath} numberOfLines={1}>
                                        {directory}
                                    </Text>
                                )}
                            </View>
                            {hasStats && (
                                <View style={styles.diffStats}>
                                    <Text style={styles.diffAdd}>+{additions}</Text>
                                    <Text style={styles.diffDel}>-{deletions}</Text>
                                </View>
                            )}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    ) : null;

    return (
        <>
            <BottomSheet
                visible={visible}
                onClose={() => {
                    setViewer(null);
                    setSelectedCommit(null);
                    setBranchMenuOpen(false);
                    setBranchComposerOpen(false);
                    setNewBranchName("");
                    setCommitMenuOpen(false);
                    setCommitComposerOpen(false);
                    setCommitMessage("");
                    setChangesFilterMenuOpen(false);
                    onClose();
                }}
                iconNode={
                    selectedCommit !== null
                        ? <HistoryIcon size={14} color={theme.colors.textSecondary} />
                        : undefined
                }
                {...(selectedCommit === null ? { iconName: "folder" as const } : {})}
                title={selectedCommit !== null ? "Commit files" : "Workspace"}
                subtitle={selectedCommit !== null ? selectedCommit.shortHash : headerSubtitle}
                stickyHeader={
                    viewer === null && selectedCommit === null ? (
                        <View style={sheetStyles.tabBar}>
                            <TabButton
                                label="Changes"
                                active={workspace.tab === "changes"}
                                renderIcon={(color) => <DiffIcon size={14} color={color} />}
                                onPress={() => useWorkspaceStore.getState().setTab("changes")}
                            />
                            <TabButton
                                label="Files"
                                active={workspace.tab === "files"}
                                renderIcon={(color) => <FolderFilledIcon size={14} color={color} />}
                                onPress={() => useWorkspaceStore.getState().setTab("files")}
                            />
                        </View>
                    ) : undefined
                }
            >
                {selectedCommit !== null
                    ? commitFilesContent
                    : viewer !== null
                    ? inlineViewerContent
                    : workspace.tab === "changes" ? changesContent : filesContent}
            </BottomSheet>
        </>
    );
}

// Değişen dosyaları klasör ağacı olarak grupla — tree view modu için.
function renderChangesAsTree(
    changes: ReadonlyArray<{ path: string; status: string; additions?: number | undefined; deletions?: number | undefined }>,
    onPick: (path: string) => void,
    styles: ReturnType<typeof createStyles>,
    treeStyles: ReturnType<typeof createTreeStyles>,
    theme: AppTheme,
): React.ReactNode {
    const grouped = new Map<string, Array<typeof changes[number]>>();
    for (const c of changes) {
        const dir = dirname(c.path) ?? "(root)";
        const list = grouped.get(dir) ?? [];
        list.push(c);
        grouped.set(dir, list);
    }
    const dirs = Array.from(grouped.keys()).sort();
    return dirs.map((dir) => (
        <View key={dir}>
            <View style={styles.treeDirLabel}>
                <FolderFilledIcon size={14} color={theme.colors.textSecondary} />
                <Text style={styles.treeDirText} numberOfLines={1}>{dir}</Text>
            </View>
            {(grouped.get(dir) ?? []).map((change) => {
                const name = basename(change.path);
                const additions = change.additions ?? 0;
                const deletions = change.deletions ?? 0;
                const isUntracked = change.status === "untracked" || change.status === "added";
                const hasStats = additions > 0 || deletions > 0;
                return (
                    <Pressable
                        key={change.path}
                        style={({ pressed }) => [styles.changeRow, styles.changeRowIndented, pressed && styles.changeRowPressed]}
                        onPress={() => onPick(change.path)}
                    >
                        <View style={styles.changeIconWrap}>
                            <FileTypeIcon name={name} size={18} />
                        </View>
                        <View style={styles.changeText}>
                            <Text style={styles.changeName} numberOfLines={1}>{name}</Text>
                        </View>
                        <View style={styles.changeRight}>
                            {isUntracked && (
                                <View style={styles.newBadge}><Text style={styles.newBadgeText}>New</Text></View>
                            )}
                            {hasStats && (
                                <View style={styles.diffStats}>
                                    <Text style={styles.diffAdd}>+{additions}</Text>
                                    <Text style={styles.diffDel}>-{deletions}</Text>
                                </View>
                            )}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    ));
}

function TabButton({
    label,
    active,
    renderIcon,
    onPress,
}: {
    label: string;
    active: boolean;
    renderIcon: (color: string) => React.ReactNode;
    onPress: () => void;
}) {
    const theme = useAppTheme();
    const sheetStyles = useMemo(() => createSheetStyles(theme), [theme]);
    const iconColor = active ? theme.colors.textPrimary : theme.colors.textTertiary;

    return (
        <Pressable
            style={({ pressed }) => [
                sheetStyles.tabButton,
                active && sheetStyles.tabButtonActive,
                pressed && sheetStyles.tabButtonPressed,
            ]}
            onPress={onPress}
        >
            <View style={sheetStyles.tabContent}>
                {renderIcon(iconColor)}
                <Text style={[sheetStyles.tabLabel, active && sheetStyles.tabLabelActive]}>
                    {label}
                </Text>
            </View>
        </Pressable>
    );
}

function ViewModeBtn({
    active,
    onPress,
    children,
}: {
    active: boolean;
    onPress: () => void;
    children: React.ReactNode;
}) {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    return (
        <Pressable
            style={({ pressed }) => [
                styles.viewModeBtn,
                active && styles.viewModeBtnActive,
                pressed && styles.pressed,
            ]}
            onPress={onPress}
            hitSlop={4}
        >
            {children}
        </Pressable>
    );
}

function EmptyState({ title, text }: { title?: string; text: string }) {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    return (
        <View style={styles.emptyState}>
            {title !== undefined && <Text style={styles.emptyStateTitle}>{title}</Text>}
            <Text style={styles.emptyStateText}>{text}</Text>
        </View>
    );
}

function Banner({ tone, text }: { tone: "success" | "error"; text: string }) {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    return (
        <View style={[styles.banner, tone === "success" ? styles.bannerSuccess : styles.bannerError]}>
            <Text
                style={[
                    styles.bannerText,
                    tone === "success" ? styles.bannerTextSuccess : styles.bannerTextError,
                ]}
            >
                {text}
            </Text>
        </View>
    );
}

export const WorkspacePanel = React.memo(WorkspacePanelComponent);

function classifyDiffLine(line: string, theme: AppTheme): { color: string; bg: string | null } {
    if (line.startsWith("+++") || line.startsWith("---")) return { color: theme.colors.textPrimary, bg: null };
    if (line.startsWith("@@")) return { color: theme.colors.textSecondary, bg: null };
    if (line.startsWith("+")) return { color: "#3fb950", bg: "rgba(63,185,80,0.10)" };
    if (line.startsWith("-")) return { color: "#f85149", bg: "rgba(248,81,73,0.10)" };
    return { color: theme.colors.textPrimary, bg: null };
}

// ---------- Styles ----------
function createSheetStyles(theme: AppTheme) {
const isAmoled = theme.variant === "amoled";
const sheetSurface = isAmoled ? theme.colors.bg : theme.colors.bgTertiary;
const sheetActiveSurface = isAmoled ? theme.colors.bg : theme.colors.bgElevated;
return StyleSheet.create({
    tabBar: {
        flexDirection: "row",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.borderMuted,
    },
    tabButton: {
        flex: 1,
        paddingVertical: 10,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.borderRadius.full,
        backgroundColor: sheetSurface,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    tabButtonActive: {
        backgroundColor: sheetActiveSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    tabButtonPressed: { opacity: 0.85 },
    tabLabel: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
        fontWeight: "600",
    },
    tabContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
    },
    tabLabelActive: { color: theme.colors.textPrimary },
});
}

function createTreeStyles(theme: AppTheme) {
const emphasisTextColor = theme.resolvedScheme === "light"
    ? "#1b1b18"
    : "#f4f7f5";

return StyleSheet.create({
    tree: { gap: 0, paddingBottom: theme.spacing.sm },
    row: {
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingRight: theme.spacing.md,
        borderRadius: theme.borderRadius.sm,
    },
    rowPressed: { backgroundColor: theme.colors.bgTertiary },
    chevronWrap: {
        width: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    iconWrap: { width: 18, alignItems: "center", justifyContent: "center" },
    fileName: {
        flex: 1,
        fontSize: theme.fontSize.sm,
        color: emphasisTextColor,
        fontWeight: "500",
    },
    loading: { fontSize: theme.fontSize.xs, color: theme.colors.textTertiary, paddingHorizontal: 8 },
    moreBtn: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    loadMoreRow: {
        minHeight: 32,
        justifyContent: "center",
        borderRadius: theme.borderRadius.sm,
        paddingRight: theme.spacing.md,
    },
    loadMoreText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textSecondary,
        fontWeight: "600",
    },
});
}

function createStyles(theme: AppTheme) {
const emphasizedLabelColor = theme.resolvedScheme === "light"
    ? "#1b1b18"
    : "#f4f7f5";
const supportingLabelColor = theme.resolvedScheme === "light"
    ? "#5a5a54"
    : "#c9d1d9";
const isAmoled = theme.variant === "amoled";
const chromeSurface = isAmoled ? theme.colors.bg : theme.colors.bgElevated;
const secondaryChromeSurface = isAmoled ? theme.colors.bg : theme.colors.bgSecondary;
const tertiaryChromeSurface = isAmoled ? theme.colors.bg : theme.colors.bgTertiary;
const successBadgeBg = theme.resolvedScheme === "light"
    ? theme.colors.successMuted
    : "#1b3f2a";
const successBadgeBorder = theme.resolvedScheme === "light"
    ? theme.colors.success
    : "#2d5c3f";
const inlineViewerBackground = theme.resolvedScheme === "light"
    ? theme.colors.bgSecondary
    : theme.colors.bg;

return StyleSheet.create({
    content: { gap: theme.spacing.sm },
    pressed: { opacity: 0.8 },
    rowWithOverlay: { zIndex: 30 },
    menuAnchor: {
        position: "relative",
    },
    menuAnchorActive: {
        zIndex: 40,
    },
    branchAnchor: {
        flex: 1,
    },
    commitAnchor: {
        flexShrink: 0,
    },
    segmentAnchor: {
        alignSelf: "flex-start",
    },

    // Branch / Commit header row
    branchRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
    },
    branchPicker: {
        flex: 1,
        minHeight: 36,
        justifyContent: "center",
    },
    branchPickerDisabled: { opacity: 0.55 },
    branchLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
    branchName: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    commitGroup: {
        flexDirection: "row",
        alignItems: "stretch",
        borderRadius: theme.borderRadius.full,
        overflow: "hidden",
        backgroundColor: chromeSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    commitButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 18,
        paddingVertical: 9,
        justifyContent: "center",
    },
    commitButtonDisabled: { opacity: 0.55 },
    commitButtonText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    commitCaret: {
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        borderLeftWidth: 1,
        borderLeftColor: theme.colors.borderMuted,
    },
    commitComposer: {
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: secondaryChromeSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    commitComposerTitle: {
        fontSize: theme.fontSize.md,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    commitComposerHint: {
        fontSize: theme.fontSize.sm,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    commitComposerInput: {
        minHeight: 44,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: chromeSurface,
        color: theme.colors.textPrimary,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        fontSize: theme.fontSize.sm,
    },
    commitComposerActions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: theme.spacing.sm,
    },
    commitComposerSecondaryButton: {
        minHeight: 38,
        borderRadius: theme.borderRadius.full,
        justifyContent: "center",
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: chromeSurface,
    },
    commitComposerSecondaryText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    commitComposerPrimaryButton: {
        minHeight: 38,
        borderRadius: theme.borderRadius.full,
        justifyContent: "center",
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.colors.textLink,
    },
    commitComposerPrimaryText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.textOnAccent,
    },

    // Pull/Push popover
    popover: {
        minWidth: 150,
        paddingVertical: 6,
        borderRadius: theme.borderRadius.md,
        backgroundColor: chromeSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowColor: "#000000",
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    anchoredPopover: {
        position: "absolute",
        top: "100%",
        marginTop: 6,
    },
    branchPopover: {
        left: 0,
        minWidth: 220,
    },
    commitPopover: {
        right: 0,
    },
    filterPopover: {
        left: 0,
    },
    popoverItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 9,
        paddingHorizontal: theme.spacing.md,
    },
    branchPopoverItemCurrent: { opacity: 0.72 },
    popoverItemPressed: { backgroundColor: tertiaryChromeSurface },
    popoverLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textPrimary, fontWeight: "500" },
    popoverSep: { height: 1, backgroundColor: theme.colors.border, marginHorizontal: theme.spacing.sm },
    branchCurrentLabel: {
        marginLeft: "auto",
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
    },
    branchEmptyState: {
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
    },
    branchEmptyText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
    },
    branchComposer: {
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
    },
    branchComposerTitle: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    branchComposerHint: {
        fontSize: theme.fontSize.xs,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    branchComposerInput: {
        minHeight: 42,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
        backgroundColor: secondaryChromeSurface,
        color: theme.colors.textPrimary,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        fontSize: theme.fontSize.sm,
    },
    branchComposerActions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: theme.spacing.sm,
    },
    branchComposerSecondaryButton: {
        minHeight: 36,
        borderRadius: theme.borderRadius.full,
        justifyContent: "center",
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: secondaryChromeSurface,
    },
    branchComposerSecondaryText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    branchComposerPrimaryButton: {
        minHeight: 36,
        borderRadius: theme.borderRadius.full,
        justifyContent: "center",
        paddingHorizontal: theme.spacing.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: chromeSurface,
    },
    branchComposerPrimaryText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },

    // Segmented "Uncommitted ▾" header
    segmentRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: theme.spacing.sm,
        paddingBottom: 4,
    },
    segmentLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
    segmentTitle: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: emphasizedLabelColor,
        textTransform: "none",
    },
    segmentRight: { flexDirection: "row", alignItems: "center", gap: 4 },
    viewModeBtn: {
        width: 30,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.borderRadius.sm,
    },
    viewModeBtnActive: {
        backgroundColor: chromeSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },

    // Change rows
    changesList: { gap: 2 },
    changeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 4,
    },
    changeRowPressed: {
        opacity: 0.6,
    },
    changeRowIndented: {
        paddingLeft: 20,
    },
    treeDirLabel: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingTop: 8,
        paddingBottom: 2,
    },
    treeDirText: {
        fontSize: theme.fontSize.xs,
        color: supportingLabelColor,
        fontWeight: "600",
    },
    changeIconWrap: {
        width: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    changeText: { flex: 1, gap: 2 },
    changeName: {
        fontSize: theme.fontSize.sm,
        color: emphasizedLabelColor,
        fontWeight: "600",
    },
    commitRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 4,
    },
    commitIconWrap: {
        width: 22,
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 2,
    },
    commitBody: {
        flex: 1,
        gap: 4,
    },
    commitHeaderRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    commitSubject: {
        flex: 1,
        fontSize: theme.fontSize.sm,
        color: emphasizedLabelColor,
        fontWeight: "600",
        lineHeight: 19,
    },
    commitTime: {
        flexShrink: 0,
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        fontWeight: "600",
    },
    commitMeta: {
        fontSize: theme.fontSize.xs,
        color: supportingLabelColor,
    },
    commitFooterRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingTop: 2,
    },
    commitFileCount: {
        flex: 1,
        fontSize: theme.fontSize.xs,
        color: theme.colors.textSecondary,
    },
    commitFilesButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: theme.borderRadius.full,
        backgroundColor: chromeSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    commitFilesButtonText: {
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    commitFilesSheetHeader: {
        gap: 4,
        paddingBottom: theme.spacing.sm,
    },
    commitFilesSheetTitle: {
        fontSize: theme.fontSize.sm,
        lineHeight: 20,
        color: emphasizedLabelColor,
        fontWeight: "700",
    },
    commitFilesSheetMeta: {
        fontSize: theme.fontSize.xs,
        color: supportingLabelColor,
    },
    changePath: { fontSize: theme.fontSize.xs, color: supportingLabelColor },
    changeRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
    diffStats: { flexDirection: "row", alignItems: "center", gap: 6 },
    diffAdd: {
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
        color: theme.colors.success,
        fontVariant: ["tabular-nums"],
    },
    diffDel: {
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
        color: theme.colors.error,
        fontVariant: ["tabular-nums"],
    },
    newBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: theme.borderRadius.full,
        backgroundColor: successBadgeBg,
        borderWidth: 1,
        borderColor: successBadgeBorder,
    },
    newBadgeText: {
        fontSize: 10,
        fontWeight: "700",
        color: theme.colors.success,
        letterSpacing: 0.3,
    },

    // Files tab header
    filesHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: theme.spacing.xs,
        paddingHorizontal: 2,
    },
    sortBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
    sortLabel: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: emphasizedLabelColor,
    },
    refreshBtn: {
        width: 32,
        height: 32,
        borderRadius: theme.borderRadius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.bgTertiary,
    },
    refreshBtnDisabled: { opacity: 0.5 },

    // Banners + empty states
    banner: {
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 10,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
    },
    bannerSuccess: {
        backgroundColor: "#14321d",
        borderColor: "#245a36",
    },
    bannerError: {
        backgroundColor: "#3a1b1b",
        borderColor: "#5c2626",
    },
    bannerText: { fontSize: theme.fontSize.sm, lineHeight: 18 },
    bannerTextSuccess: { color: theme.colors.success },
    bannerTextError: { color: theme.colors.error },

    emptyState: {
        paddingVertical: theme.spacing.xl,
        paddingHorizontal: theme.spacing.lg,
        alignItems: "center",
        gap: 6,
    },
    emptyStateTitle: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textPrimary,
        fontWeight: "600",
        textAlign: "center",
    },
    emptyStateText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
        textAlign: "center",
    },

    // Inline file/diff viewer
    inlineViewer: {
        flex: 1,
        backgroundColor: inlineViewerBackground,
    },
    inlineBack: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.borderMuted,
        marginBottom: theme.spacing.sm,
    },
    inlineBackLabel: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
    },
    inlineBackFile: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textPrimary,
        fontWeight: "600",
        flex: 1,
    },
    inlineCentered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: theme.spacing.xl,
    },
    inlineLoadingText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
        marginTop: theme.spacing.sm,
    },
    inlineErrorText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.error,
        textAlign: "center",
        paddingHorizontal: theme.spacing.md,
    },
    inlineTruncatedNotice: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.warning,
        fontWeight: "600",
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
    },
    diffLine: {
        flexDirection: "row",
        minHeight: 20,
        fontSize: 11,
        fontFamily: "Courier",
        lineHeight: 20,
        color: theme.colors.textPrimary,
    },
    lineNum: {
        width: 36,
        fontSize: 11,
        color: theme.colors.textTertiary,
        textAlign: "right",
        paddingRight: 8,
        fontFamily: "Courier",
        lineHeight: 20,
        flexShrink: 0,
    },
    codeLine: {
        flex: 1,
        flexDirection: "row",
        fontSize: 11,
        fontFamily: "Courier",
        lineHeight: 20,
        backgroundColor: inlineViewerBackground,
    },
    codeText: {
        fontSize: 11,
        fontFamily: "Courier",
        lineHeight: 20,
        color: theme.colors.textPrimary,
    },
});
}

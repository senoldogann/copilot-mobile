// Workspace explorer bottom sheet — GitHub Mobile style Changes / Files view.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { useAppTheme, type AppTheme } from "../theme/theme-context";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import {
    pullWorkspace,
    pushWorkspace,
    requestWorkspaceGitSummary,
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
    GitCommitIcon,
    GitHubIcon,
    GitPullRequestIcon,
    GitPushIcon,
    FolderFilledIcon,
    FileTypeIcon,
    MoreVerticalIcon,
    RefreshIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    AlignLeftIcon,
    DiffIcon,
    ListTreeIcon,
} from "./ProviderIcon";

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

type ViewMode = "paragraph" | "diff" | "tree";
const INITIAL_TREE_DEPTH = 2;
const DIRECTORY_TREE_DEPTH = 2;
const TREE_PAGE_SIZE = 200;

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
            isPulling: s.isPulling,
            isPushing: s.isPushing,
            isSwitchingBranch: s.isSwitchingBranch,
            operationMessage: s.operationMessage,
            error: s.error,
        })),
    );

    const [viewMode, setViewMode] = useState<ViewMode>("diff");
    const [branchMenuOpen, setBranchMenuOpen] = useState<boolean>(false);
    const [commitMenuOpen, setCommitMenuOpen] = useState<boolean>(false);
    const [changesFilter, setChangesFilter] = useState<"uncommitted" | "recent">("uncommitted");
    const [changesFilterMenuOpen, setChangesFilterMenuOpen] = useState<boolean>(false);
    const [viewer, setViewer] = useState<{ path: string; mode: "file" | "diff" } | null>(null);
    // Inline viewer load state — avoids nested Modal problem on iOS
    type InlineLoadState =
        | { status: "loading" }
        | { status: "ready"; body: string; truncated: boolean }
        | { status: "error"; message: string };
    const [inlineLoad, setInlineLoad] = useState<InlineLoadState>({ status: "loading" });

    // Load diff/file whenever viewer changes
    useEffect(() => {
        if (viewer === null || activeSessionId === null) return;
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
            const unsub = onWorkspaceDiffResponse(activeSessionId, viewer.path, (payload: WorkspaceDiffPayload) => {
                finish();
                unsub();
                if (payload.error !== undefined) {
                    setInlineLoad({ status: "error", message: payload.error });
                } else {
                    setInlineLoad({
                        status: "ready",
                        body: payload.diff.length > 0 ? payload.diff : "(No changes)",
                        truncated: false,
                    });
                }
            });
            void requestWorkspaceDiff(activeSessionId, viewer.path);
            return () => { finish(); unsub(); };
        } else {
            const unsub = onWorkspaceFileResponse(activeSessionId, viewer.path, (payload: WorkspaceFilePayload) => {
                finish();
                unsub();
                if (payload.error !== undefined) {
                    setInlineLoad({ status: "error", message: payload.error });
                } else {
                    setInlineLoad({
                        status: "ready",
                        body: payload.content,
                        truncated: payload.truncated,
                    });
                }
            });
            void requestWorkspaceFile(activeSessionId, viewer.path);
            return () => { finish(); unsub(); };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewer?.path, viewer?.mode, activeSessionId]);

    useEffect(() => {
        if (!visible) return;

        setViewMode("diff");
        setChangesFilter("uncommitted");
        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        setChangesFilterMenuOpen(false);

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
        void requestWorkspaceGitSummary(activeSessionId, 10);
    }, [visible, activeSessionId, isConnected]);

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
        void requestWorkspaceTree(activeSessionId, undefined, INITIAL_TREE_DEPTH, 0, TREE_PAGE_SIZE);
        void requestWorkspaceGitSummary(activeSessionId, 10);
    }, [activeSessionId, isConnected]);

    const handlePull = useCallback(() => {
        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        if (activeSessionId === null || !isConnected) return;
        void pullWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const handlePush = useCallback(() => {
        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        if (activeSessionId === null || !isConnected) return;
        void pushWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const handleToggleBranchMenu = useCallback(() => {
        if (activeSessionId === null || !isConnected || !hasRepo) {
            return;
        }

        setCommitMenuOpen(false);
        setChangesFilterMenuOpen(false);
        setBranchMenuOpen((value) => !value);
    }, [activeSessionId, hasRepo, isConnected]);

    const handleToggleCommitMenu = useCallback(() => {
        if (activeSessionId === null || !isConnected || !hasRepo) {
            return;
        }

        setBranchMenuOpen(false);
        setChangesFilterMenuOpen(false);
        setCommitMenuOpen((value) => !value);
    }, [activeSessionId, hasRepo, isConnected]);

    const handleToggleChangesFilterMenu = useCallback(() => {
        setBranchMenuOpen(false);
        setCommitMenuOpen(false);
        setChangesFilterMenuOpen((value) => !value);
    }, []);

    const handleSwitchBranch = useCallback((branchName: string) => {
        if (activeSessionId === null || !isConnected || workspace.isSwitchingBranch) {
            return;
        }

        setBranchMenuOpen(false);
        void switchWorkspaceBranch(activeSessionId, branchName);
    }, [activeSessionId, isConnected, workspace.isSwitchingBranch]);

    const hasGitContext = workspace.gitRoot !== null || activeContext?.gitRoot !== undefined;
    const branchLabel = workspace.branch ?? activeContext?.branch ?? (hasGitContext ? "main" : "workspace");
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
        const hasStats = additions > 0 || deletions > 0 || isUntracked;
        const showStats = viewMode !== "paragraph";

        return (
            <Pressable
                key={change.path}
                style={({ pressed }) => [styles.changeRow, pressed && styles.changeRowPressed]}
                onPress={() => setViewer({ path: change.path, mode: "diff" })}
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
                    {showStats && hasStats && !isUntracked && (
                        <View style={styles.diffStats}>
                            <Text style={styles.diffAdd}>+{additions}</Text>
                            <Text style={styles.diffDel}>-{deletions}</Text>
                        </View>
                    )}
                </View>
            </Pressable>
        );
    }, [viewMode]);

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
                    setViewer({ path: node.path, mode: "file" });
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
        [activeSessionId, isConnected, workspace.expandedPaths, workspace.loadingTreePaths],
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
                        </View>
                    )}
                </View>

                <View style={[styles.menuAnchor, styles.commitAnchor, commitMenuOpen && styles.menuAnchorActive]}>
                    <View style={styles.commitGroup}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.commitButton,
                                pressed && styles.pressed,
                                !hasRepo && styles.commitButtonDisabled,
                            ]}
                            disabled={!hasRepo || workspace.uncommittedChanges.length === 0}
                        >
                            <GitHubIcon size={14} color={theme.colors.textPrimary} />
                            <Text style={styles.commitButtonText}>Commit</Text>
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
                            <GitCommitIcon size={14} color={segmentTitleColor} />
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
                                <GitCommitIcon size={14} color={theme.colors.textPrimary} />
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

            {workspace.operationMessage !== null && (
                <Banner tone="success" text={workspace.operationMessage} />
            )}
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
                        {workspace.recentCommits.map((commit) => (
                            <View key={commit.hash} style={styles.changeRow}>
                                <View style={styles.changeIconWrap}>
                                    <GitCommitIcon size={14} color={theme.colors.textSecondary} />
                                </View>
                                <View style={styles.changeText}>
                                    <Text style={styles.changeName} numberOfLines={1}>
                                        {commit.subject}
                                    </Text>
                                    <Text style={styles.changePath} numberOfLines={1}>
                                        {commit.shortHash} · {commit.author}
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )
            ) : workspace.uncommittedChanges.length === 0 ? (
                <EmptyState title="Working tree clean" text="No uncommitted changes in this branch." />
            ) : viewMode === "tree" ? (
                <View style={styles.changesList}>
                    {renderChangesAsTree(
                        workspace.uncommittedChanges,
                        (path) => setViewer({ path, mode: "diff" }),
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

    return (
        <BottomSheet
            visible={visible}
            onClose={() => {
                setViewer(null);
                setBranchMenuOpen(false);
                setCommitMenuOpen(false);
                setChangesFilterMenuOpen(false);
                onClose();
            }}
            iconName="folder"
            title="Workspace"
            subtitle={headerSubtitle}
            stickyHeader={
                viewer === null ? (
                    <View style={sheetStyles.tabBar}>
                        <TabButton
                            label="Changes"
                            active={workspace.tab === "changes"}
                            onPress={() => useWorkspaceStore.getState().setTab("changes")}
                        />
                        <TabButton
                            label="Files"
                            active={workspace.tab === "files"}
                            onPress={() => useWorkspaceStore.getState().setTab("files")}
                        />
                    </View>
                ) : undefined
            }
        >
            {viewer !== null
                ? inlineViewerContent
                : workspace.tab === "changes" ? changesContent : filesContent}
        </BottomSheet>
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
                            {isUntracked ? (
                                <View style={styles.newBadge}><Text style={styles.newBadgeText}>New</Text></View>
                            ) : (
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
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    const theme = useAppTheme();
    const sheetStyles = useMemo(() => createSheetStyles(theme), [theme]);

    return (
        <Pressable
            style={({ pressed }) => [
                sheetStyles.tabButton,
                active && sheetStyles.tabButtonActive,
                pressed && sheetStyles.tabButtonPressed,
            ]}
            onPress={onPress}
        >
            <Text style={[sheetStyles.tabLabel, active && sheetStyles.tabLabelActive]}>
                {label}
            </Text>
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
    if (line.startsWith("+++") || line.startsWith("---")) return { color: theme.colors.textTertiary, bg: null };
    if (line.startsWith("@@")) return { color: theme.colors.textSecondary, bg: null };
    if (line.startsWith("+")) return { color: "#3fb950", bg: "rgba(63,185,80,0.10)" };
    if (line.startsWith("-")) return { color: "#f85149", bg: "rgba(248,81,73,0.10)" };
    return { color: theme.colors.textPrimary, bg: null };
}

// ---------- Styles ----------
function createSheetStyles(theme: AppTheme) {
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
        backgroundColor: theme.colors.bgTertiary,
    },
    tabButtonActive: {
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    tabButtonPressed: { opacity: 0.85 },
    tabLabel: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
        fontWeight: "600",
    },
    tabLabelActive: { color: theme.colors.textPrimary },
});
}

function createTreeStyles(theme: AppTheme) {
const emphasisTextColor = theme.resolvedScheme === "light"
    ? theme.colors.textAssistant
    : theme.colors.textPrimary;

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
    ? theme.colors.textAssistant
    : theme.colors.textPrimary;
const supportingLabelColor = theme.resolvedScheme === "light"
    ? theme.colors.textSecondary
    : theme.colors.textTertiary;

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
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
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

    // Pull/Push popover
    popover: {
        minWidth: 150,
        paddingVertical: 6,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
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
    popoverItemPressed: { backgroundColor: theme.colors.bgTertiary },
    popoverLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textPrimary, fontWeight: "500" },
    popoverSep: { height: 1, backgroundColor: theme.colors.borderMuted, marginHorizontal: theme.spacing.sm },
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
    viewModeBtnActive: { backgroundColor: theme.colors.bgElevated },

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
    changePath: { fontSize: theme.fontSize.xs, color: supportingLabelColor },
    changeRight: { flexDirection: "row", alignItems: "center", gap: 6 },
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
        backgroundColor: "#1b3f2a",
        borderWidth: 1,
        borderColor: "#2d5c3f",
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
        backgroundColor: theme.colors.bg,
    },
    codeText: {
        fontSize: 11,
        fontFamily: "Courier",
        lineHeight: 20,
        color: theme.colors.textPrimary,
    },
});
}

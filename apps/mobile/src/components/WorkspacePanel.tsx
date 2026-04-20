// Workspace explorer bottom sheet — GitHub Mobile style Changes / Files view.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { colors, spacing, fontSize, borderRadius } from "../theme/colors";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import {
    pullWorkspace,
    pushWorkspace,
    requestWorkspaceGitSummary,
    requestWorkspaceTree,
} from "../services/bridge";
import {
    GitBranchIcon,
    FolderFilledIcon,
    FileTypeIcon,
    MoreVerticalIcon,
    RefreshIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ArrowDownIcon,
    ArrowUpIcon,
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

function WorkspacePanelComponent({ visible, onClose }: Props) {
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const sessions = useSessionStore((s) => s.sessions);
    const connectionState = useConnectionStore((s) => s.state);
    const isConnected = connectionState === "authenticated";
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    const activeContext = activeSession?.context;

    const workspace = useWorkspaceStore(
        useShallow((s) => ({
            sessionId: s.sessionId,
            rootPath: s.rootPath,
            tree: s.tree,
            treeTruncated: s.treeTruncated,
            gitRoot: s.gitRoot,
            repository: s.repository,
            branch: s.branch,
            uncommittedChanges: s.uncommittedChanges,
            recentCommits: s.recentCommits,
            tab: s.tab,
            expandedPaths: s.expandedPaths,
            loadingTreePaths: s.loadingTreePaths,
            isLoadingGit: s.isLoadingGit,
            isPulling: s.isPulling,
            isPushing: s.isPushing,
            operationMessage: s.operationMessage,
            error: s.error,
        })),
    );

    const [viewMode, setViewMode] = useState<ViewMode>("paragraph");
    const [commitMenuOpen, setCommitMenuOpen] = useState<boolean>(false);

    useEffect(() => {
        if (!visible) return;

        if (activeSessionId === null) {
            useWorkspaceStore.getState().resetWorkspace();
            return;
        }

        const store = useWorkspaceStore.getState();
        if (store.sessionId !== activeSessionId) {
            store.beginWorkspaceSession(activeSessionId);
        }

        if (!isConnected) return;

        void requestWorkspaceTree(activeSessionId, undefined, 4);
        void requestWorkspaceGitSummary(activeSessionId, 10);
    }, [visible, activeSessionId, isConnected]);

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
        void requestWorkspaceTree(activeSessionId, undefined, 4);
        void requestWorkspaceGitSummary(activeSessionId, 10);
    }, [activeSessionId, isConnected]);

    const handlePull = useCallback(() => {
        setCommitMenuOpen(false);
        if (activeSessionId === null || !isConnected) return;
        void pullWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const handlePush = useCallback(() => {
        setCommitMenuOpen(false);
        if (activeSessionId === null || !isConnected) return;
        void pushWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const hasRepo = workspace.gitRoot !== null;
    const treeRoot = workspace.tree;
    const rootTreeLoading = workspace.loadingTreePaths["__root__"] === true;
    const canRefresh = activeSessionId !== null && isConnected;

    const branchLabel = workspace.branch ?? activeContext?.branch ?? "main";
    const rootLabel = useMemo(() => {
        const rp = workspace.rootPath ?? activeContext?.cwd ?? null;
        if (rp === null) return "Workspace";
        return basename(rp) || rp;
    }, [workspace.rootPath, activeContext?.cwd]);

    const isInitialGitLoading =
        isConnected &&
        activeSessionId !== null &&
        workspace.isLoadingGit &&
        workspace.uncommittedChanges.length === 0;

    const isInitialTreeLoading =
        isConnected && activeSessionId !== null && treeRoot === null && rootTreeLoading;

    const renderChangeRow = useCallback((change: (typeof workspace.uncommittedChanges)[number]) => {
        const name = basename(change.path);
        const dir = dirname(change.path);
        const additions = change.additions ?? 0;
        const deletions = change.deletions ?? 0;
        const isUntracked = change.status === "untracked" || change.status === "added";
        const hasStats = additions > 0 || deletions > 0 || isUntracked;

        return (
            <View key={change.path} style={styles.changeRow}>
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
                    {hasStats && !isUntracked && (
                        <View style={styles.diffStats}>
                            <Text style={styles.diffAdd}>+{additions}</Text>
                            <Text style={styles.diffDel}>-{deletions}</Text>
                        </View>
                    )}
                </View>
            </View>
        );
    }, []);

    const renderTreeNode = useCallback(
        (node: NonNullable<typeof workspace.tree>, depth: number): React.ReactNode => {
            const isDirectory = node.type === "directory";
            const isExpanded = depth === 0 || workspace.expandedPaths[node.path] === true;
            const isLoading =
                workspace.loadingTreePaths[node.path] === true ||
                (depth === 0 && workspace.loadingTreePaths["__root__"] === true);

            const handlePress = () => {
                if (!isDirectory) return;
                const nextExpanded = !isExpanded;
                useWorkspaceStore.getState().toggleExpanded(node.path);
                if (
                    nextExpanded &&
                    node.children === undefined &&
                    activeSessionId !== null &&
                    isConnected
                ) {
                    void requestWorkspaceTree(activeSessionId, node.path, 4);
                }
            };

            return (
                <View key={node.path}>
                    <Pressable
                        style={({ pressed }) => [
                            treeStyles.row,
                            { paddingLeft: spacing.lg + depth * 16 },
                            pressed && treeStyles.rowPressed,
                        ]}
                        onPress={isDirectory ? handlePress : undefined}
                    >
                        <View style={treeStyles.chevronWrap}>
                            {isDirectory ? (
                                isExpanded ? (
                                    <ChevronDownIcon size={12} color={colors.textTertiary} />
                                ) : (
                                    <ChevronRightIcon size={12} color={colors.textTertiary} />
                                )
                            ) : null}
                        </View>
                        <View style={treeStyles.iconWrap}>
                            {isDirectory ? (
                                <FolderFilledIcon size={16} color={colors.textSecondary} />
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
                                <MoreVerticalIcon size={16} color={colors.textTertiary} />
                            </Pressable>
                        )}
                    </Pressable>
                    {isDirectory &&
                        isExpanded &&
                        node.children !== undefined &&
                        node.children.map((child) => renderTreeNode(child, depth + 1))}
                </View>
            );
        },
        [activeSessionId, isConnected, workspace.expandedPaths, workspace.loadingTreePaths],
    );

    // ---------- Changes tab content ----------
    const changesContent = (
        <View style={styles.content}>
            {/* Branch + Commit pill */}
            <View style={styles.branchRow}>
                <View style={styles.branchLeft}>
                    <GitBranchIcon size={15} color={colors.textSecondary} />
                    <Text style={styles.branchName} numberOfLines={1}>
                        {branchLabel}
                    </Text>
                </View>
                <View style={styles.commitGroup}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.commitButton,
                            pressed && styles.pressed,
                            !hasRepo && styles.commitButtonDisabled,
                        ]}
                        disabled={!hasRepo || workspace.uncommittedChanges.length === 0}
                    >
                        <Text style={styles.commitButtonText}>Commit</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [
                            styles.commitCaret,
                            pressed && styles.pressed,
                        ]}
                        onPress={() => setCommitMenuOpen((v) => !v)}
                    >
                        <ChevronDownIcon size={12} color={colors.textPrimary} />
                    </Pressable>
                </View>
            </View>

            {commitMenuOpen && (
                <View style={styles.popover}>
                    <Pressable
                        style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
                        onPress={handlePull}
                    >
                        <ArrowDownIcon size={14} color={colors.textPrimary} />
                        <Text style={styles.popoverLabel}>
                            {workspace.isPulling ? "Pulling…" : "Pull"}
                        </Text>
                    </Pressable>
                    <View style={styles.popoverSep} />
                    <Pressable
                        style={({ pressed }) => [styles.popoverItem, pressed && styles.popoverItemPressed]}
                        onPress={handlePush}
                    >
                        <ArrowUpIcon size={14} color={colors.textPrimary} />
                        <Text style={styles.popoverLabel}>
                            {workspace.isPushing ? "Pushing…" : "Push"}
                        </Text>
                    </Pressable>
                </View>
            )}

            {/* Uncommitted segmented header */}
            <View style={styles.segmentRow}>
                <Pressable style={styles.segmentLeft} hitSlop={4}>
                    <Text style={styles.segmentTitle}>Uncommitted</Text>
                    <ChevronDownIcon size={12} color={colors.textSecondary} />
                </Pressable>
                <View style={styles.segmentRight}>
                    <ViewModeBtn active={viewMode === "paragraph"} onPress={() => setViewMode("paragraph")}>
                        <AlignLeftIcon size={14} color={viewMode === "paragraph" ? colors.textPrimary : colors.textTertiary} />
                    </ViewModeBtn>
                    <ViewModeBtn active={viewMode === "diff"} onPress={() => setViewMode("diff")}>
                        <DiffIcon size={14} color={viewMode === "diff" ? colors.textPrimary : colors.textTertiary} />
                    </ViewModeBtn>
                    <ViewModeBtn active={viewMode === "tree"} onPress={() => setViewMode("tree")}>
                        <ListTreeIcon size={14} color={viewMode === "tree" ? colors.textPrimary : colors.textTertiary} />
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
            ) : workspace.uncommittedChanges.length === 0 ? (
                <EmptyState title="Working tree clean" text="No uncommitted changes in this branch." />
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
                    <ChevronDownIcon size={12} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                    style={[styles.refreshBtn, !canRefresh && styles.refreshBtnDisabled]}
                    onPress={refreshWorkspace}
                    disabled={!canRefresh}
                    hitSlop={6}
                >
                    <RefreshIcon size={15} color={colors.textSecondary} />
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
                <View style={treeStyles.tree}>{renderTreeNode(treeRoot, 0)}</View>
            )}
        </View>
    );

    const headerSubtitle =
        workspace.repository !== null
            ? `${workspace.repository} · ${branchLabel}`
            : activeContext?.repository !== undefined
              ? `${activeContext.repository} · ${branchLabel}`
              : `${rootLabel} · ${branchLabel}`;

    return (
        <BottomSheet
            visible={visible}
            onClose={() => {
                setCommitMenuOpen(false);
                onClose();
            }}
            iconName="folder"
            title="Workspace"
            subtitle={headerSubtitle}
        >
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

            {workspace.tab === "changes" ? changesContent : filesContent}
        </BottomSheet>
    );
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
    return (
        <View style={styles.emptyState}>
            {title !== undefined && <Text style={styles.emptyStateTitle}>{title}</Text>}
            <Text style={styles.emptyStateText}>{text}</Text>
        </View>
    );
}

function Banner({ tone, text }: { tone: "success" | "error"; text: string }) {
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

// ---------- Styles ----------
const sheetStyles = StyleSheet.create({
    tabBar: {
        flexDirection: "row",
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderMuted,
    },
    tabButton: {
        flex: 1,
        paddingVertical: 10,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: borderRadius.full,
        backgroundColor: colors.bgTertiary,
    },
    tabButtonActive: {
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    tabButtonPressed: { opacity: 0.85 },
    tabLabel: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        fontWeight: "600",
    },
    tabLabelActive: { color: colors.textPrimary },
});

const treeStyles = StyleSheet.create({
    tree: { gap: 0, paddingBottom: spacing.sm },
    row: {
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingRight: spacing.md,
        borderRadius: borderRadius.sm,
    },
    rowPressed: { backgroundColor: colors.bgTertiary },
    chevronWrap: {
        width: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    iconWrap: { width: 18, alignItems: "center", justifyContent: "center" },
    fileName: {
        flex: 1,
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "500",
    },
    loading: { fontSize: fontSize.xs, color: colors.textTertiary, paddingHorizontal: 8 },
    moreBtn: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
});

const styles = StyleSheet.create({
    content: { gap: spacing.sm },
    pressed: { opacity: 0.8 },

    // Branch / Commit header row
    branchRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
        paddingVertical: spacing.xs,
    },
    branchLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
    branchName: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    commitGroup: {
        flexDirection: "row",
        alignItems: "stretch",
        borderRadius: borderRadius.full,
        overflow: "hidden",
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    commitButton: {
        paddingHorizontal: 18,
        paddingVertical: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    commitButtonDisabled: { opacity: 0.55 },
    commitButtonText: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    commitCaret: {
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        borderLeftWidth: 1,
        borderLeftColor: colors.borderMuted,
    },

    // Pull/Push popover
    popover: {
        alignSelf: "flex-end",
        minWidth: 150,
        paddingVertical: 6,
        borderRadius: borderRadius.md,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.borderMuted,
        marginTop: -spacing.xs,
    },
    popoverItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 9,
        paddingHorizontal: spacing.md,
    },
    popoverItemPressed: { backgroundColor: colors.bgTertiary },
    popoverLabel: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: "500" },
    popoverSep: { height: 1, backgroundColor: colors.borderMuted, marginHorizontal: spacing.sm },

    // Segmented "Uncommitted ▾" header
    segmentRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: spacing.sm,
        paddingBottom: 4,
    },
    segmentLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
    segmentTitle: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textSecondary,
        textTransform: "none",
    },
    segmentRight: { flexDirection: "row", alignItems: "center", gap: 4 },
    viewModeBtn: {
        width: 30,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: borderRadius.sm,
    },
    viewModeBtnActive: { backgroundColor: colors.bgElevated },

    // Change rows
    changesList: { gap: 2 },
    changeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 4,
    },
    changeIconWrap: {
        width: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    changeText: { flex: 1, gap: 2 },
    changeName: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "600",
    },
    changePath: { fontSize: fontSize.xs, color: colors.textTertiary },
    changeRight: { flexDirection: "row", alignItems: "center", gap: 6 },
    diffStats: { flexDirection: "row", alignItems: "center", gap: 6 },
    diffAdd: {
        fontSize: fontSize.xs,
        fontWeight: "600",
        color: colors.success,
        fontVariant: ["tabular-nums"],
    },
    diffDel: {
        fontSize: fontSize.xs,
        fontWeight: "600",
        color: colors.error,
        fontVariant: ["tabular-nums"],
    },
    newBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: borderRadius.full,
        backgroundColor: "#1b3f2a",
        borderWidth: 1,
        borderColor: "#2d5c3f",
    },
    newBadgeText: {
        fontSize: 10,
        fontWeight: "700",
        color: colors.success,
        letterSpacing: 0.3,
    },

    // Files tab header
    filesHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: spacing.xs,
        paddingHorizontal: 2,
    },
    sortBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
    sortLabel: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textSecondary,
    },
    refreshBtn: {
        width: 32,
        height: 32,
        borderRadius: borderRadius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bgTertiary,
    },
    refreshBtnDisabled: { opacity: 0.5 },

    // Banners + empty states
    banner: {
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        borderRadius: borderRadius.md,
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
    bannerText: { fontSize: fontSize.sm, lineHeight: 18 },
    bannerTextSuccess: { color: colors.success },
    bannerTextError: { color: colors.error },

    emptyState: {
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
        alignItems: "center",
        gap: 6,
    },
    emptyStateTitle: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "600",
        textAlign: "center",
    },
    emptyStateText: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        textAlign: "center",
    },
});

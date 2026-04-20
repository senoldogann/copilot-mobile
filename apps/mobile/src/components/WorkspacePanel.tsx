// Workspace explorer bottom sheet — Copilot-style changes/files panel

import React, { useCallback, useEffect, useMemo } from "react";
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

type Props = {
    visible: boolean;
    onClose: () => void;
};

function formatDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function basename(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? path;
}

function formatChangeStatus(status: string): string {
    switch (status) {
        case "added":
            return "Added";
        case "modified":
            return "Modified";
        case "deleted":
            return "Deleted";
        case "renamed":
            return "Renamed";
        case "copied":
            return "Copied";
        case "untracked":
            return "Untracked";
        case "conflicted":
            return "Conflicted";
        case "type_changed":
            return "Type changed";
        default:
            return "Unknown";
    }
}

function getChangeTone(status: string): { backgroundColor: string; color: string } {
    switch (status) {
        case "added":
        case "copied":
            return { backgroundColor: colors.successMuted, color: colors.success };
        case "modified":
            return { backgroundColor: colors.copilotPurpleMuted, color: colors.copilotPurple };
        case "deleted":
        case "conflicted":
            return { backgroundColor: colors.errorMuted, color: colors.error };
        case "renamed":
        case "type_changed":
        case "untracked":
        default:
            return { backgroundColor: colors.bgOverlay, color: colors.textSecondary };
    }
}

function getTreeIcon(type: "file" | "directory" | "symlink"): string {
    switch (type) {
        case "directory":
            return "▦";
        case "symlink":
            return "↗";
        case "file":
        default:
            return "◦";
    }
}

function WorkspacePanelComponent({ visible, onClose }: Props) {
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const connectionState = useConnectionStore((s) => s.state);
    const isConnected = connectionState === "authenticated";

    const workspace = useWorkspaceStore(useShallow((s) => ({
        sessionId: s.sessionId,
        context: s.context,
        rootPath: s.rootPath,
        tree: s.tree,
        treeTruncated: s.treeTruncated,
        gitRoot: s.gitRoot,
        repository: s.repository,
        branch: s.branch,
        uncommittedChanges: s.uncommittedChanges,
        recentCommits: s.recentCommits,
        gitTruncated: s.gitTruncated,
        tab: s.tab,
        expandedPaths: s.expandedPaths,
        loadingTreePaths: s.loadingTreePaths,
        isLoadingGit: s.isLoadingGit,
        isPulling: s.isPulling,
        isPushing: s.isPushing,
        operationMessage: s.operationMessage,
        error: s.error,
    })));

    useEffect(() => {
        if (!visible) {
            return;
        }

        if (activeSessionId === null) {
            useWorkspaceStore.getState().resetWorkspace();
            return;
        }

        const store = useWorkspaceStore.getState();
        if (store.sessionId !== activeSessionId) {
            store.beginWorkspaceSession(activeSessionId);
        }

        if (!isConnected) {
            return;
        }

        void requestWorkspaceTree(activeSessionId, undefined, 4);
        void requestWorkspaceGitSummary(activeSessionId, 8);
    }, [visible, activeSessionId, isConnected]);

    const refreshWorkspace = useCallback(() => {
        if (!isConnected || activeSessionId === null) {
            return;
        }

        void requestWorkspaceTree(activeSessionId, undefined, 4);
        void requestWorkspaceGitSummary(activeSessionId, 8);
    }, [activeSessionId, isConnected]);

    const handlePull = useCallback(() => {
        if (activeSessionId === null || !isConnected) {
            return;
        }
        void pullWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const handlePush = useCallback(() => {
        if (activeSessionId === null || !isConnected) {
            return;
        }
        void pushWorkspace(activeSessionId);
    }, [activeSessionId, isConnected]);

    const hasRepo = workspace.gitRoot !== null;
    const treeRoot = workspace.tree;

    const summarySubtitle = useMemo(() => {
        if (workspace.repository !== null && workspace.branch !== null) {
            return `${workspace.repository} · ${workspace.branch}`;
        }
        if (workspace.repository !== null) {
            return workspace.repository;
        }
        if (workspace.branch !== null) {
            return workspace.branch;
        }
        return workspace.rootPath ?? "Workspace";
    }, [workspace.branch, workspace.repository, workspace.rootPath]);

    const renderTreeNode = useCallback(
        (node: NonNullable<typeof workspace.tree>, depth: number): React.ReactNode => {
            const isDirectory = node.type === "directory";
            const isExpanded = depth === 0 || workspace.expandedPaths[node.path] === true;
            const isLoading = workspace.loadingTreePaths[node.path] === true
                || (depth === 0 && workspace.loadingTreePaths["__root__"] === true);

            const handlePress = () => {
                if (!isDirectory) {
                    return;
                }

                const nextExpanded = !isExpanded;
                useWorkspaceStore.getState().toggleExpanded(node.path);

                if (nextExpanded && node.children === undefined && activeSessionId !== null && isConnected) {
                    void requestWorkspaceTree(activeSessionId, node.path, 4);
                }
            };

            return (
                <View key={node.path}>
                    <Pressable
                        style={({ pressed }) => [
                            treeStyles.row,
                            { paddingLeft: spacing.lg + depth * 14 },
                            pressed && treeStyles.rowPressed,
                        ]}
                        onPress={isDirectory ? handlePress : undefined}
                    >
                        <Text style={treeStyles.chevron}>
                            {isDirectory ? (isExpanded ? "▾" : "▸") : " "}
                        </Text>
                        <Text style={treeStyles.icon}>{getTreeIcon(node.type)}</Text>
                        <View style={treeStyles.rowText}>
                            <Text style={treeStyles.fileName} numberOfLines={1}>
                                {node.name}
                            </Text>
                            {node.type === "directory" && node.children !== undefined && (
                                <Text style={treeStyles.fileMeta} numberOfLines={1}>
                                    {node.children.length} item{node.children.length === 1 ? "" : "s"}
                                    {node.path === workspace.rootPath ? " · root" : ""}
                                </Text>
                            )}
                        </View>
                        {isLoading && <Text style={treeStyles.loading}>···</Text>}
                    </Pressable>

                    {isDirectory && isExpanded && node.children !== undefined && node.children.map((child) => renderTreeNode(child, depth + 1))}
                    {isDirectory && isExpanded && node.children === undefined && isLoading && (
                        <View style={[treeStyles.loadingRow, { paddingLeft: spacing.lg + (depth + 1) * 14 }]}>
                            <Text style={treeStyles.loadingText}>Loading children…</Text>
                        </View>
                    )}
                </View>
            );
        },
        [activeSessionId, isConnected, workspace.expandedPaths, workspace.loadingTreePaths, workspace.rootPath]
    );

    const changesContent = (
        <View style={styles.content}>
            <View style={styles.headerCard}>
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.headerIcon}>⟡</Text>
                        <View style={styles.headerText}>
                            <Text style={styles.title}>{workspace.repository ?? "Workspace changes"}</Text>
                            <Text style={styles.subtitle} numberOfLines={1}>
                                {summarySubtitle}
                            </Text>
                        </View>
                    </View>
                    <Pressable style={styles.refreshButton} onPress={refreshWorkspace}>
                        <Text style={styles.refreshButtonText}>↻</Text>
                    </Pressable>
                </View>

                <View style={styles.statsRow}>
                    <StatChip label="Uncommitted" value={String(workspace.uncommittedChanges.length)} />
                    <StatChip label="Recent" value={String(workspace.recentCommits.length)} />
                    <StatChip
                        label="Status"
                        value={workspace.gitRoot !== null ? "Connected" : "Local"}
                        tone={workspace.gitRoot !== null ? "success" : "neutral"}
                    />
                </View>

                {workspace.operationMessage !== null && (
                    <Banner tone="success" text={workspace.operationMessage} />
                )}
                {workspace.error !== null && (
                    <Banner tone="error" text={workspace.error} />
                )}
            </View>

            {hasRepo && (
                <View style={styles.actionRow}>
                    <ActionButton
                        label="Pull"
                        icon="↓"
                        onPress={handlePull}
                        loading={workspace.isPulling}
                    />
                    <ActionButton
                        label="Push"
                        icon="↑"
                        onPress={handlePush}
                        loading={workspace.isPushing}
                    />
                </View>
            )}

            <SectionHeader title="Uncommitted changes" count={workspace.uncommittedChanges.length} />
            {workspace.isLoadingGit && workspace.uncommittedChanges.length === 0 ? (
                <EmptyState text="Loading changes…" />
            ) : workspace.uncommittedChanges.length === 0 ? (
                <EmptyState text={hasRepo ? "Working tree clean" : "No git repository connected"} />
            ) : (
                <View style={styles.list}>
                    {workspace.uncommittedChanges.map((change) => {
                        const tone = getChangeTone(change.status);
                        return (
                            <View key={change.path} style={styles.changeRow}>
                                <View style={styles.changeText}>
                                    <Text style={styles.changePath} numberOfLines={1}>
                                        {change.path}
                                    </Text>
                                    <Text style={styles.changeMeta} numberOfLines={1}>
                                        {change.worktreeStatus} · {change.indexStatus}
                                        {change.originalPath !== undefined ? ` · from ${change.originalPath}` : ""}
                                    </Text>
                                </View>
                                <View style={[styles.changeBadge, { backgroundColor: tone.backgroundColor }]}>
                                    <Text style={[styles.changeBadgeText, { color: tone.color }]}>
                                        {formatChangeStatus(change.status)}
                                    </Text>
                                </View>
                            </View>
                        );
                    })}
                </View>
            )}

            <SectionHeader title="Recent commits" count={workspace.recentCommits.length} />
            {workspace.isLoadingGit && workspace.recentCommits.length === 0 ? (
                <EmptyState text="Loading commits…" />
            ) : workspace.recentCommits.length === 0 ? (
                <EmptyState text={hasRepo ? "No recent commits" : "Recent commits unavailable"} />
            ) : (
                <View style={styles.list}>
                    {workspace.recentCommits.map((commit) => (
                        <View key={commit.hash} style={styles.commitRow}>
                            <View style={styles.commitDot} />
                            <View style={styles.commitText}>
                                <Text style={styles.commitSubject} numberOfLines={2}>
                                    {commit.subject}
                                </Text>
                                <Text style={styles.commitMeta} numberOfLines={1}>
                                    {commit.author} · {commit.shortHash} · {commit.files.length} file{commit.files.length === 1 ? "" : "s"}
                                </Text>
                                <Text style={styles.commitTime} numberOfLines={1}>
                                    {formatDateTime(commit.committedAt)}
                                </Text>
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );

    const filesContent = (
        <View style={styles.content}>
            <View style={styles.headerCard}>
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.headerIcon}>⌘</Text>
                        <View style={styles.headerText}>
                            <Text style={styles.title}>Files</Text>
                            <Text style={styles.subtitle} numberOfLines={1}>
                                {workspace.rootPath ?? "Workspace tree"}
                            </Text>
                        </View>
                    </View>
                    <Pressable style={styles.refreshButton} onPress={refreshWorkspace}>
                        <Text style={styles.refreshButtonText}>↻</Text>
                    </Pressable>
                </View>
                <View style={styles.statsRow}>
                    <StatChip label="Depth" value={workspace.treeTruncated ? "Truncated" : "Full"} />
                    <StatChip label="Root" value={workspace.rootPath !== null ? basename(workspace.rootPath) : "—"} />
                </View>
            </View>

            {workspace.tree === null ? (
                <EmptyState
                    text={isConnected
                        ? "Open a workspace to load files"
                        : "Connect to a workspace to browse files"}
                />
            ) : (
                <View style={treeStyles.tree}>
                    {treeRoot !== null ? renderTreeNode(treeRoot, 0) : null}
                </View>
            )}
        </View>
    );

    const headerSubtitle = workspace.repository !== null || workspace.branch !== null
        || workspace.rootPath !== null
        ? summarySubtitle
        : activeSessionId === null
            ? "No active session"
            : isConnected
                ? "Loading workspace…"
                : "Disconnected";

    return (
        <BottomSheet
            visible={visible}
            onClose={onClose}
            icon="▣"
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
            <Text style={[sheetStyles.tabLabel, active && sheetStyles.tabLabelActive]}>{label}</Text>
        </Pressable>
    );
}

function StatChip({
    label,
    value,
    tone = "neutral",
}: {
    label: string;
    value: string;
    tone?: "neutral" | "success";
}) {
    return (
        <View style={[styles.statChip, tone === "success" && styles.statChipSuccess]}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionCount}>{count}</Text>
        </View>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>{text}</Text>
        </View>
    );
}

function Banner({ tone, text }: { tone: "success" | "error"; text: string }) {
    return (
        <View style={[styles.banner, tone === "success" ? styles.bannerSuccess : styles.bannerError]}>
            <Text style={[styles.bannerText, tone === "success" ? styles.bannerTextSuccess : styles.bannerTextError]}>
                {text}
            </Text>
        </View>
    );
}

function ActionButton({
    label,
    icon,
    onPress,
    loading,
}: {
    label: string;
    icon: string;
    onPress: () => void;
    loading?: boolean;
}) {
    return (
        <Pressable
            style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
                loading === true && styles.actionButtonDisabled,
            ]}
            onPress={onPress}
            disabled={loading === true}
        >
            <Text style={styles.actionIcon}>{loading === true ? "···" : icon}</Text>
            <Text style={styles.actionLabel}>{label}</Text>
        </Pressable>
    );
}

export const WorkspacePanel = React.memo(WorkspacePanelComponent);

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
        backgroundColor: colors.copilotPurpleMuted,
        borderWidth: 1,
        borderColor: colors.copilotPurpleBorder,
    },
    tabButtonPressed: {
        opacity: 0.85,
    },
    tabLabel: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        fontWeight: "600",
    },
    tabLabelActive: {
        color: colors.textPrimary,
    },
});

const treeStyles = StyleSheet.create({
    tree: {
        gap: 2,
        paddingBottom: spacing.sm,
    },
    row: {
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingRight: spacing.lg,
        borderRadius: borderRadius.sm,
    },
    rowPressed: {
        backgroundColor: colors.sidebarItemHover,
    },
    chevron: {
        width: 14,
        fontSize: fontSize.base,
        color: colors.textTertiary,
        textAlign: "center",
    },
    icon: {
        width: 16,
        fontSize: fontSize.base,
        color: colors.textSecondary,
        textAlign: "center",
    },
    rowText: {
        flex: 1,
        minHeight: 30,
        justifyContent: "center",
    },
    fileName: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "500",
    },
    fileMeta: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        marginTop: 2,
    },
    loading: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    loadingRow: {
        minHeight: 28,
        justifyContent: "center",
    },
    loadingText: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
});

const styles = StyleSheet.create({
    content: {
        gap: spacing.md,
    },
    headerCard: {
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        backgroundColor: colors.bgSecondary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
    },
    headerLeft: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
    },
    headerIcon: {
        fontSize: fontSize.xl,
        color: colors.copilotPurple,
    },
    headerText: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: fontSize.base,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    subtitle: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    refreshButton: {
        width: 34,
        height: 34,
        borderRadius: borderRadius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bgTertiary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    refreshButtonText: {
        fontSize: fontSize.base,
        color: colors.textSecondary,
    },
    statsRow: {
        flexDirection: "row",
        gap: spacing.sm,
    },
    statChip: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: borderRadius.md,
        backgroundColor: colors.bgTertiary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
        gap: 2,
    },
    statChipSuccess: {
        backgroundColor: colors.successMuted,
        borderColor: colors.successMuted,
    },
    statLabel: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    statValue: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    banner: {
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        borderRadius: borderRadius.md,
        borderWidth: 1,
    },
    bannerSuccess: {
        backgroundColor: colors.successMuted,
        borderColor: colors.successMuted,
    },
    bannerError: {
        backgroundColor: colors.errorBackground,
        borderColor: colors.errorMuted,
    },
    bannerText: {
        fontSize: fontSize.sm,
        lineHeight: 18,
    },
    bannerTextSuccess: {
        color: colors.success,
    },
    bannerTextError: {
        color: colors.error,
    },
    actionRow: {
        flexDirection: "row",
        gap: spacing.sm,
    },
    actionButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 10,
        borderRadius: borderRadius.full,
        backgroundColor: colors.bgTertiary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    actionButtonPressed: {
        opacity: 0.85,
    },
    actionButtonDisabled: {
        opacity: 0.55,
    },
    actionIcon: {
        fontSize: fontSize.base,
        color: colors.textSecondary,
    },
    actionLabel: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "600",
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: spacing.xs,
        paddingHorizontal: 2,
    },
    sectionTitle: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    sectionCount: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    list: {
        gap: 8,
    },
    changeRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        backgroundColor: colors.bgSecondary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    changeText: {
        flex: 1,
        gap: 3,
    },
    changePath: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "500",
    },
    changeMeta: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    changeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: borderRadius.full,
    },
    changeBadgeText: {
        fontSize: fontSize.xs,
        fontWeight: "600",
    },
    commitRow: {
        flexDirection: "row",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        backgroundColor: colors.bgSecondary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
    },
    commitDot: {
        width: 8,
        height: 8,
        marginTop: 6,
        borderRadius: 4,
        backgroundColor: colors.copilotPurple,
    },
    commitText: {
        flex: 1,
        gap: 3,
    },
    commitSubject: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
        fontWeight: "500",
        lineHeight: 18,
    },
    commitMeta: {
        fontSize: fontSize.xs,
        color: colors.textSecondary,
    },
    commitTime: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    emptyState: {
        padding: spacing.lg,
        borderRadius: borderRadius.lg,
        backgroundColor: colors.bgSecondary,
        borderWidth: 1,
        borderColor: colors.borderMuted,
        alignItems: "center",
    },
    emptyStateText: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        textAlign: "center",
    },
});

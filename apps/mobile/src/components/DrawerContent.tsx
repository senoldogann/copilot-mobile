// Yan panel — sohbet geçmişi, yeni sohbet, ayarlar

import React, { useState, useMemo } from "react";
import {
    View,
    Text,
    Pressable,
    ScrollView,
    StyleSheet,
    Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import type { SessionInfo } from "@copilot-mobile/shared";
import { MODEL_UNKNOWN } from "@copilot-mobile/shared";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import {
    deleteSession,
    resumeSession,
    respondPermission,
    respondUserInput,
} from "../services/bridge";
import { colors, spacing, fontSize, borderRadius } from "../theme/colors";

// Workspace grouping — sessions grouped by cwd folder
type WorkspaceGroup = {
    workspace: string;
    displayName: string;
    sessions: ReadonlyArray<SessionInfo>;
};

function extractWorkspaceName(cwd: string): string {
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? cwd;
}

function groupByWorkspace(
    sessions: ReadonlyArray<SessionInfo>
): ReadonlyArray<WorkspaceGroup> {
    const workspaceMap = new Map<string, Array<SessionInfo>>();
    const noWorkspace: Array<SessionInfo> = [];

    for (const session of sessions) {
        const cwd = session.context?.cwd;
        if (cwd !== undefined && cwd.length > 0) {
            const existing = workspaceMap.get(cwd);
            if (existing !== undefined) {
                existing.push(session);
            } else {
                workspaceMap.set(cwd, [session]);
            }
        } else {
            noWorkspace.push(session);
        }
    }

    const result: Array<WorkspaceGroup> = [];
    for (const [cwd, groupSessions] of workspaceMap) {
        result.push({
            workspace: cwd,
            displayName: extractWorkspaceName(cwd),
            sessions: groupSessions,
        });
    }

    // Sort workspaces by most recent activity
    result.sort((a, b) => {
        const aMax = Math.max(...a.sessions.map((s) => s.lastActiveAt));
        const bMax = Math.max(...b.sessions.map((s) => s.lastActiveAt));
        return bMax - aMax;
    });

    if (noWorkspace.length > 0) {
        result.push({
            workspace: "__none__",
            displayName: "Other",
            sessions: noWorkspace,
        });
    }

    return result;
}

function formatSessionTitle(session: SessionInfo): string {
    if (session.summary !== undefined && session.summary.trim().length > 0) {
        return session.summary;
    }

    // Show first user message content if available (set via chat-history-store)
    // Fallback to repository or branch name
    if (session.context?.repository !== undefined) {
        return session.context.repository;
    }

    if (session.context?.branch !== undefined) {
        return session.context.branch;
    }

    return "New Chat";
}

function formatSessionPreview(session: SessionInfo): string {
    const previewParts = [
        session.context?.branch,
        session.model !== MODEL_UNKNOWN ? session.model : null,
    ].filter((value): value is string => value !== undefined && value !== null && value.length > 0);

    return previewParts.join(" · ");
}

export default function DrawerContent(props: DrawerContentComponentProps) {
    const router = useRouter();
    const sessions = useSessionStore((s) => s.sessions);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const connectionState = useConnectionStore((s) => s.state);
    const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set());

    const groups = useMemo(() => groupByWorkspace(sessions), [sessions]);

    const toggleWorkspace = (workspace: string) => {
        setCollapsedWorkspaces((prev) => {
            const next = new Set(prev);
            if (next.has(workspace)) {
                next.delete(workspace);
            } else {
                next.add(workspace);
            }
            return next;
        });
    };

    const handleNewChat = () => {
        const sessionStore = useSessionStore.getState();
        if (sessionStore.permissionPrompt !== null) {
            void respondPermission(sessionStore.permissionPrompt.requestId, false);
        }
        if (sessionStore.userInputPrompt !== null) {
            void respondUserInput(sessionStore.userInputPrompt.requestId, "");
        }
        sessionStore.clearChatItems();
        sessionStore.setActiveSession(null);
        sessionStore.setSessionLoading(false);
        sessionStore.setPermissionPrompt(null);
        sessionStore.setUserInputPrompt(null);
        useConnectionStore.getState().setError(null);
        props.navigation.closeDrawer();
    };

    const handleSelectSession = (sessionId: string) => {
        const sessionStore = useSessionStore.getState();
        if (sessionStore.permissionPrompt !== null) {
            void respondPermission(sessionStore.permissionPrompt.requestId, false);
        }
        if (sessionStore.userInputPrompt !== null) {
            void respondUserInput(sessionStore.userInputPrompt.requestId, "");
        }
        sessionStore.clearChatItems();
        sessionStore.setActiveSession(sessionId);
        sessionStore.setSessionLoading(true);
        sessionStore.setPermissionPrompt(null);
        sessionStore.setUserInputPrompt(null);
        useConnectionStore.getState().setError(null);
        void resumeSession(sessionId);
        props.navigation.closeDrawer();
    };

    const handleDeleteSession = (sessionId: string) => {
        Alert.alert(
            "Oturumu Sil",
            "Bu oturumu silmek istediğinize emin misiniz?",
            [
                { text: "İptal", style: "cancel" },
                {
                    text: "Sil",
                    style: "destructive",
                    onPress: () => {
                        const sessionStore = useSessionStore.getState();
                        sessionStore.removeSession(sessionId);
                        if (sessionStore.activeSessionId === sessionId) {
                            sessionStore.clearChatItems();
                            sessionStore.setSessionLoading(false);
                        }
                        void deleteSession(sessionId);
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerIcon}>
                    <Text style={styles.headerIconText}>✦</Text>
                </View>
                <Text style={styles.headerTitle}>GitHub Copilot</Text>
            </View>

            {/* New chat button */}
            <Pressable
                style={({ pressed }) => [
                    styles.newChatButton,
                    pressed && styles.newChatButtonPressed,
                ]}
                onPress={handleNewChat}
                accessibilityLabel="Yeni oturum"
            >
                <Text style={styles.newChatIcon}>＋</Text>
                <Text style={styles.newChatText}>New Chat</Text>
            </Pressable>

            {/* Chat history — workspace grouped */}
            <ScrollView
                style={styles.conversationList}
                showsVerticalScrollIndicator={false}
            >
                {groups.length === 0 && (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>
                            No Copilot sessions yet
                        </Text>
                    </View>
                )}

                {groups.map((group) => {
                    const isCollapsed = collapsedWorkspaces.has(group.workspace);
                    return (
                        <View key={group.workspace} style={styles.workspaceGroup}>
                            <Pressable
                                style={styles.workspaceHeader}
                                onPress={() => toggleWorkspace(group.workspace)}
                            >
                                <Text style={styles.workspaceChevron}>
                                    {isCollapsed ? "▸" : "▾"}
                                </Text>
                                <Text style={styles.workspaceIcon}>📁</Text>
                                <Text
                                    style={styles.workspaceName}
                                    numberOfLines={1}
                                >
                                    {group.displayName}
                                </Text>
                                <Text style={styles.workspaceCount}>
                                    {group.sessions.length}
                                </Text>
                            </Pressable>
                            {!isCollapsed &&
                                group.sessions.map((session) => (
                                    <Pressable
                                        key={session.id}
                                        style={({ pressed }) => [
                                            styles.conversationItem,
                                            activeSessionId === session.id &&
                                            styles.conversationItemActive,
                                            pressed && styles.conversationItemPressed,
                                        ]}
                                        onPress={() =>
                                            handleSelectSession(session.id)
                                        }
                                        onLongPress={() =>
                                            handleDeleteSession(session.id)
                                        }
                                        accessibilityLabel={formatSessionTitle(session) || "Oturum"}
                                    >
                                        <Text
                                            style={[
                                                styles.conversationTitle,
                                                activeSessionId === session.id &&
                                                styles.conversationTitleActive,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {formatSessionTitle(session)}
                                        </Text>
                                        {formatSessionPreview(session).length > 0 && (
                                            <Text
                                                style={styles.conversationPreview}
                                                numberOfLines={1}
                                            >
                                                {formatSessionPreview(session)}
                                            </Text>
                                        )}
                                    </Pressable>
                                ))}
                        </View>
                    );
                })}
            </ScrollView>

            {/* Footer — settings and connection status */}
            <View style={styles.footer}>
                <View style={styles.footerDivider} />

                <Pressable
                    style={({ pressed }) => [
                        styles.footerItem,
                        pressed && styles.footerItemPressed,
                    ]}
                    onPress={() => {
                        router.push("/settings");
                        props.navigation.closeDrawer();
                    }}
                >
                    <Text style={styles.footerItemIcon}>⚙</Text>
                    <Text style={styles.footerItemText}>Settings</Text>
                </Pressable>

                <View style={styles.connectionRow}>
                    <View
                        style={[
                            styles.statusDot,
                            connectionState === "authenticated"
                                ? styles.dotConnected
                                : styles.dotDisconnected,
                        ]}
                    />
                    <Text style={styles.connectionText}>
                        {connectionState === "authenticated"
                            ? "Connected"
                            : connectionState === "connecting" ||
                                connectionState === "connected"
                                ? "Connecting..."
                                : "Disconnected"}
                    </Text>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bgSecondary,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingTop: spacing.sm,
        paddingBottom: spacing.lg,
        gap: 10,
    },
    headerIcon: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: colors.copilotPurpleMuted,
        borderWidth: 1,
        borderColor: colors.copilotPurpleBorder,
        justifyContent: "center",
        alignItems: "center",
    },
    headerIconText: {
        color: colors.copilotPurple,
        fontSize: fontSize.base,
    },
    headerTitle: {
        fontSize: 15,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    newChatButton: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: spacing.md,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    newChatButtonPressed: {
        backgroundColor: colors.bgTertiary,
    },
    newChatIcon: {
        fontSize: fontSize.lg,
        color: colors.textPrimary,
        fontWeight: "300",
    },
    newChatText: {
        fontSize: fontSize.md,
        color: colors.textPrimary,
        fontWeight: "500",
    },
    conversationList: {
        flex: 1,
        paddingHorizontal: spacing.sm,
    },
    emptyState: {
        paddingVertical: 32,
        alignItems: "center",
    },
    emptyText: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
    },
    workspaceGroup: {
        marginBottom: spacing.xs,
    },
    workspaceHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: 7,
        gap: 6,
    },
    workspaceChevron: {
        fontSize: 10,
        color: colors.textTertiary,
        width: 12,
    },
    workspaceIcon: {
        fontSize: fontSize.sm,
    },
    workspaceName: {
        flex: 1,
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    workspaceCount: {
        fontSize: 10,
        color: colors.textTertiary,
        backgroundColor: colors.bgElevated,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: borderRadius.xs,
        overflow: "hidden",
    },
    conversationItem: {
        paddingVertical: 7,
        paddingHorizontal: spacing.md,
        paddingLeft: 30,
        borderRadius: borderRadius.sm,
        marginBottom: 1,
    },
    conversationItemActive: {
        backgroundColor: colors.bgElevated,
    },
    conversationItemPressed: {
        backgroundColor: colors.bgSecondary,
    },
    conversationTitle: {
        fontSize: fontSize.md,
        color: colors.textPrimary,
        fontWeight: "400",
    },
    conversationTitleActive: {
        color: colors.textPrimary,
        fontWeight: "500",
    },
    conversationPreview: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        marginTop: 2,
    },
    footer: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    footerDivider: {
        height: 1,
        backgroundColor: colors.border,
        marginBottom: spacing.sm,
    },
    footerItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.sm,
        gap: spacing.sm,
    },
    footerItemPressed: {
        backgroundColor: colors.bgElevated,
    },
    footerItemIcon: {
        fontSize: fontSize.base,
        color: colors.textTertiary,
    },
    footerItemText: {
        fontSize: fontSize.md,
        color: colors.textPrimary,
        fontWeight: "400",
    },
    connectionRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: 6,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    dotConnected: {
        backgroundColor: colors.success,
    },
    dotDisconnected: {
        backgroundColor: colors.textTertiary,
    },
    connectionText: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
});

// Yan panel — sohbet geçmişi, yeni sohbet, ayarlar

import React, { useEffect, useMemo, useState } from "react";
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
import { Feather, Ionicons } from "@expo/vector-icons";
import { useDrawerStatus } from "@react-navigation/drawer";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { useConnectionStore } from "../stores/connection-store";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { useSessionStore } from "../stores/session-store";
import {
    deleteSession,
    listSessions,
    resumeSession,
    respondPermission,
    respondUserInput,
} from "../services/bridge";
import { startDraftConversation } from "../services/new-chat";
import { colors, spacing, fontSize, borderRadius } from "../theme/colors";
import { buildWorkspaceGroups } from "./drawer-session-groups";

export default function DrawerContent(props: DrawerContentComponentProps) {
    const router = useRouter();
    const drawerStatus = useDrawerStatus();
    const sessions = useSessionStore((s) => s.sessions);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const conversations = useChatHistoryStore((s) => s.conversations);
    const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
    const connectionState = useConnectionStore((s) => s.state);
    const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());

    useEffect(() => {
        const refreshSessions = () => {
            if (useConnectionStore.getState().state === "authenticated") {
                void listSessions();
            }
        };

        if (connectionState === "authenticated" && drawerStatus === "open") {
            refreshSessions();
        }

    }, [connectionState, drawerStatus]);

    const groups = useMemo(() => buildWorkspaceGroups(sessions), [sessions]);
    const draftConversations = useMemo(
        () => conversations
            .filter((conversation) => conversation.sessionId === null && !conversation.archived)
            .sort((left, right) => right.updatedAt - left.updatedAt),
        [conversations],
    );
    const archivedConversations = useMemo(
        () => conversations
            .filter((conversation) => conversation.archived)
            .sort((left, right) => right.updatedAt - left.updatedAt),
        [conversations],
    );
    const [archivedExpanded, setArchivedExpanded] = useState(false);

    const toggleWorkspace = (workspace: string) => {
        setExpandedWorkspaces((prev) => {
            const next = new Set(prev);
            if (next.has(workspace)) {
                next.delete(workspace);
            } else {
                next.add(workspace);
            }
            return next;
        });
    };

    const handleNewChat = (workspaceRoot: string | null) => {
        startDraftConversation(workspaceRoot);
        props.navigation.closeDrawer();
    };

    const handleSelectDraft = (conversationId: string) => {
        const sessionStore = useSessionStore.getState();
        const pendingPermissionRequestId = sessionStore.permissionPrompt?.requestId ?? null;
        const pendingUserInputRequestId = sessionStore.userInputPrompt?.requestId ?? null;

        sessionStore.clearChatItems();
        sessionStore.setActiveSession(null);
        sessionStore.setSessionLoading(false);
        sessionStore.clearPermissionPrompts();
        sessionStore.setUserInputPrompt(null);
        sessionStore.setPlanExitPrompt(null);
        useConnectionStore.getState().setError(null);
        if (pendingPermissionRequestId !== null) {
            void respondPermission(pendingPermissionRequestId, false);
        }
        if (pendingUserInputRequestId !== null) {
            void respondUserInput(pendingUserInputRequestId, "");
        }
        useChatHistoryStore.getState().setActiveConversation(conversationId);
        props.navigation.closeDrawer();
    };

    const handleSelectSession = (sessionId: string) => {
        const sessionStore = useSessionStore.getState();
        const pendingPermissionRequestId = sessionStore.permissionPrompt?.requestId ?? null;
        const pendingUserInputRequestId = sessionStore.userInputPrompt?.requestId ?? null;
        sessionStore.clearChatItems();
        sessionStore.setActiveSession(sessionId);
        sessionStore.setSessionLoading(true);
        sessionStore.clearPermissionPrompts();
        sessionStore.setUserInputPrompt(null);
        sessionStore.setPlanExitPrompt(null);
        useConnectionStore.getState().setError(null);
        if (pendingPermissionRequestId !== null) {
            void respondPermission(pendingPermissionRequestId, false);
        }
        if (pendingUserInputRequestId !== null) {
            void respondUserInput(pendingUserInputRequestId, "");
        }

        const historyStore = useChatHistoryStore.getState();
        const linkedConversation = historyStore.conversations.find((item) => item.sessionId === sessionId);
        if (linkedConversation !== undefined) {
            historyStore.setActiveConversation(linkedConversation.id);
        } else {
            historyStore.createConversation(sessionId, null);
        }

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
                        useChatHistoryStore.getState().removeBySessionId(sessionId);
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

    // VS Code tarzı üç-noktalı menü: Archive / Delete
    const openSessionMenu = (sessionId: string, conversationId: string | null, title: string) => {
        Alert.alert(
            title.length > 0 ? title : "Sohbet",
            undefined,
            [
                {
                    text: "Arşivle",
                    onPress: () => {
                        if (conversationId !== null) {
                            useChatHistoryStore.getState().archiveConversation(conversationId);
                        }
                    },
                },
                {
                    text: "Sil",
                    style: "destructive",
                    onPress: () => handleDeleteSession(sessionId),
                },
                { text: "İptal", style: "cancel" },
            ]
        );
    };

    const openDraftMenu = (conversationId: string, title: string) => {
        Alert.alert(
            title.length > 0 ? title : "Taslak",
            undefined,
            [
                {
                    text: "Arşivle",
                    onPress: () => useChatHistoryStore.getState().archiveConversation(conversationId),
                },
                {
                    text: "Sil",
                    style: "destructive",
                    onPress: () => useChatHistoryStore.getState().deleteConversation(conversationId),
                },
                { text: "İptal", style: "cancel" },
            ]
        );
    };

    const openArchivedMenu = (conversationId: string, title: string) => {
        Alert.alert(
            title.length > 0 ? title : "Arşivlenmiş",
            undefined,
            [
                {
                    text: "Geri Yükle",
                    onPress: () => useChatHistoryStore.getState().unarchiveConversation(conversationId),
                },
                {
                    text: "Kalıcı Olarak Sil",
                    style: "destructive",
                    onPress: () => useChatHistoryStore.getState().deleteConversation(conversationId),
                },
                { text: "İptal", style: "cancel" },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerIcon}>
                    <Ionicons name="sparkles" size={14} color={colors.copilotPurple} />
                </View>
                <Text style={styles.headerTitle}>GitHub Copilot</Text>
            </View>

            {/* New chat button */}
            <Pressable
                style={({ pressed }) => [
                    styles.newChatButton,
                    pressed && styles.newChatButtonPressed,
                ]}
                onPress={() => handleNewChat(null)}
                accessibilityLabel="Yeni oturum"
            >
                <Feather name="plus" size={16} color={colors.textPrimary} />
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

                {draftConversations.length > 0 && (
                    <View style={styles.workspaceGroup}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionHeaderText}>Drafts</Text>
                        </View>
                        {draftConversations.map((conversation) => (
                            <View key={conversation.id} style={styles.conversationRow}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.conversationItem,
                                        styles.conversationItemFlex,
                                        activeSessionId === null && activeConversationId === conversation.id && styles.conversationItemActive,
                                        pressed && styles.conversationItemPressed,
                                    ]}
                                    onPress={() => handleSelectDraft(conversation.id)}
                                    onLongPress={() => openDraftMenu(conversation.id, conversation.title)}
                                    accessibilityLabel={conversation.title}
                                >
                                    <Text
                                        style={[
                                            styles.conversationTitle,
                                            activeSessionId === null && activeConversationId === conversation.id && styles.conversationTitleActive,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {conversation.title}
                                    </Text>
                                    <Text style={styles.conversationPreview} numberOfLines={1}>
                                        {conversation.preview.length > 0 ? conversation.preview : "Empty draft"}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
                                    onPress={() => openDraftMenu(conversation.id, conversation.title)}
                                    hitSlop={8}
                                    accessibilityLabel="Daha fazla"
                                >
                                    <Feather name="more-horizontal" size={14} color={colors.textTertiary} />
                                </Pressable>
                            </View>
                        ))}
                    </View>
                )}

                {groups.map((group) => {
                    const isExpanded = expandedWorkspaces.has(group.workspace);
                    const workspaceRootForNewChat =
                        group.workspace === "__none__" ? null : group.workspace;
                    return (
                        <View key={group.workspace} style={styles.workspaceGroup}>
                            <View style={styles.workspaceHeaderRow}>
                                <Pressable
                                    style={styles.workspaceHeader}
                                    onPress={() => toggleWorkspace(group.workspace)}
                                >
                                    <Feather
                                        name={isExpanded ? "chevron-down" : "chevron-right"}
                                        size={12}
                                        color={colors.textTertiary}
                                    />
                                    <Feather name="folder" size={14} color={colors.textTertiary} />
                                    <Text
                                        style={styles.workspaceName}
                                        numberOfLines={1}
                                    >
                                        {group.displayName}
                                    </Text>
                                    <Text style={styles.workspaceCount}>
                                        {group.totalSessions === group.entries.length
                                            ? String(group.totalSessions)
                                            : `${group.entries.length}/${group.totalSessions}`}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.workspaceAddBtn,
                                        pressed && styles.workspaceAddBtnPressed,
                                    ]}
                                    onPress={() => handleNewChat(workspaceRootForNewChat)}
                                    hitSlop={8}
                                    accessibilityLabel={`${group.displayName} için yeni sohbet`}
                                >
                                    <Feather name="plus" size={14} color={colors.textSecondary} />
                                </Pressable>
                            </View>
                            {isExpanded &&
                                group.entries.map((entry) => {
                                    const linkedConv = conversations.find(
                                        (c) => c.sessionId === entry.primarySession.id
                                    );
                                    const linkedId = linkedConv?.id ?? null;
                                    return (
                                        <View key={entry.key} style={styles.conversationRow}>
                                            <Pressable
                                                style={({ pressed }) => [
                                                    styles.conversationItem,
                                                    styles.conversationItemFlex,
                                                    activeSessionId === entry.primarySession.id &&
                                                    styles.conversationItemActive,
                                                    pressed && styles.conversationItemPressed,
                                                ]}
                                                onPress={() =>
                                                    handleSelectSession(entry.primarySession.id)
                                                }
                                                onLongPress={() =>
                                                    openSessionMenu(entry.primarySession.id, linkedId, entry.title)
                                                }
                                                accessibilityLabel={entry.title.length > 0 ? entry.title : "Oturum"}
                                            >
                                                <View style={styles.conversationTitleRow}>
                                                    <Text
                                                        style={[
                                                            styles.conversationTitle,
                                                            activeSessionId === entry.primarySession.id &&
                                                            styles.conversationTitleActive,
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {entry.title}
                                                    </Text>
                                                    {entry.duplicateCount > 0 && (
                                                        <Text style={styles.conversationDuplicateCount}>
                                                            ×{entry.duplicateCount + 1}
                                                        </Text>
                                                    )}
                                                </View>
                                                {(entry.preview.length > 0 || entry.duplicateCount > 0) && (
                                                    <Text
                                                        style={styles.conversationPreview}
                                                        numberOfLines={1}
                                                    >
                                                        {entry.preview.length > 0
                                                            ? entry.preview
                                                            : `${entry.duplicateCount + 1} similar sessions`}
                                                    </Text>
                                                )}
                                            </Pressable>
                                            <Pressable
                                                style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
                                                onPress={() => openSessionMenu(entry.primarySession.id, linkedId, entry.title)}
                                                hitSlop={8}
                                                accessibilityLabel="Daha fazla"
                                            >
                                                <Feather name="more-horizontal" size={14} color={colors.textTertiary} />
                                            </Pressable>
                                        </View>
                                    );
                                })}
                        </View>
                    );
                })}

                {archivedConversations.length > 0 && (
                    <View style={styles.workspaceGroup}>
                        <Pressable
                            style={styles.workspaceHeader}
                            onPress={() => setArchivedExpanded((prev) => !prev)}
                        >
                            <Feather
                                name={archivedExpanded ? "chevron-down" : "chevron-right"}
                                size={12}
                                color={colors.textTertiary}
                            />
                            <Feather name="archive" size={14} color={colors.textTertiary} />
                            <Text style={styles.workspaceName} numberOfLines={1}>
                                Archived
                            </Text>
                            <Text style={styles.workspaceCount}>
                                {archivedConversations.length}
                            </Text>
                        </Pressable>
                        {archivedExpanded &&
                            archivedConversations.map((conversation) => (
                                <View key={conversation.id} style={styles.conversationRow}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.conversationItem,
                                            styles.conversationItemFlex,
                                            styles.conversationItemArchived,
                                            pressed && styles.conversationItemPressed,
                                        ]}
                                        onPress={() => {
                                            if (conversation.sessionId !== null) {
                                                handleSelectSession(conversation.sessionId);
                                            } else {
                                                handleSelectDraft(conversation.id);
                                            }
                                        }}
                                        onLongPress={() => openArchivedMenu(conversation.id, conversation.title)}
                                        accessibilityLabel={conversation.title}
                                    >
                                        <Text style={styles.conversationTitle} numberOfLines={1}>
                                            {conversation.title}
                                        </Text>
                                        {conversation.preview.length > 0 && (
                                            <Text style={styles.conversationPreview} numberOfLines={1}>
                                                {conversation.preview}
                                            </Text>
                                        )}
                                    </Pressable>
                                    <Pressable
                                        style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
                                        onPress={() => openArchivedMenu(conversation.id, conversation.title)}
                                        hitSlop={8}
                                        accessibilityLabel="Daha fazla"
                                    >
                                        <Feather name="more-horizontal" size={14} color={colors.textTertiary} />
                                    </Pressable>
                                </View>
                            ))}
                    </View>
                )}
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
                    <Feather name="settings" size={15} color={colors.textTertiary} />
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
    sectionHeader: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.xs,
        paddingBottom: 6,
    },
    sectionHeaderText: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    workspaceHeader: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: 7,
        gap: 6,
    },
    workspaceHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    workspaceAddBtn: {
        width: 26,
        height: 26,
        borderRadius: borderRadius.sm,
        alignItems: "center",
        justifyContent: "center",
        marginRight: spacing.sm,
    },
    workspaceAddBtnPressed: {
        backgroundColor: colors.bgElevated,
    },
    workspaceChevron: {
        width: 12,
    },
    workspaceIcon: {
        width: 14,
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
    conversationItemFlex: {
        flex: 1,
    },
    conversationItemArchived: {
        opacity: 0.6,
    },
    conversationRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    moreBtn: {
        width: 28,
        height: 28,
        borderRadius: borderRadius.sm,
        alignItems: "center",
        justifyContent: "center",
        marginRight: spacing.sm,
    },
    moreBtnPressed: {
        backgroundColor: colors.bgElevated,
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
    conversationTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
    },
    conversationTitleActive: {
        color: colors.textPrimary,
        fontWeight: "500",
    },
    conversationDuplicateCount: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        backgroundColor: colors.bgElevated,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: borderRadius.xs,
        overflow: "hidden",
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
        width: 16,
        alignItems: "center",
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

// Side panel — chat history, new chat, settings

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    View,
    Text,
    Pressable,
    ScrollView,
    StyleSheet,
    Alert,
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useDrawerStatus } from "@react-navigation/drawer";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { useConnectionStore } from "../stores/connection-store";
import { useChatHistoryStore, type Conversation } from "../stores/chat-history-store";
import { useSessionStore } from "../stores/session-store";
import {
    deleteSessions,
    listSessions,
    resumeSession,
} from "../services/bridge";
import { startDraftConversation } from "../services/new-chat";
import { useAppTheme, type AppTheme } from "../theme/theme-context";
import { buildWorkspaceGroups, type WorkspaceGroup } from "./drawer-session-groups";
import {
    buildArchivedConversationMetadata,
    buildCloudConversationMetadata,
    formatRelativeTimestamp,
    isRecentCloudSync,
    type DrawerMetadataChip,
    type DrawerMetadataChipTone,
    type DrawerProviderMetadata,
    type DrawerResumeResult,
} from "../view-models/provider-metadata";
import { useWorkspaceDirectoryStore } from "../stores/workspace-directory-store";
import { WorkspacePickerModal } from "./WorkspacePickerModal";
import {
    ArchiveIcon,
    CloseIcon,
    CirclePlusIcon,
    FileTextIcon,
    FolderIcon,
    PencilIcon,
    RefreshIcon,
    TrashIcon,
    ChevronDownIcon,
} from "./ProviderIcon";

type CloudConversationGroup = {
    workspace: string;
    displayName: string;
    conversations: ReadonlyArray<Conversation>;
};

type CloudFilter = "all" | "recent" | "stale";
type RenameTarget = {
    conversationId: string | null;
    sessionId: string | null;
    title: string;
    preview: string;
    workspaceRoot: string | null;
};

type ChatActionMenuItem = {
    key: string;
    label: string;
    tone: "default" | "danger";
    icon: React.ReactNode;
    onPress: () => void;
};

type ChatActionMenuState = {
    title: string;
    subtitle: string | null;
    showHeaderDivider: boolean;
    items: ReadonlyArray<ChatActionMenuItem>;
    anchor?: { x: number; y: number };
};

function basenamePath(value: string): string {
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? value;
}

function makeWorkspaceSectionKey(provider: "local" | "copilot" | "cloud", workspace: string): string {
    return `${provider}:${workspace}`;
}

function buildProviderWorkspaceKeys(
    provider: "local" | "copilot" | "cloud",
    workspaces: ReadonlyArray<string>
): ReadonlyArray<string> {
    return workspaces.map((workspace) => makeWorkspaceSectionKey(provider, workspace));
}

function matchesWorkspaceScope(workspaceKey: string, workspaceRoot: string | null): boolean {
    if (workspaceKey === "__none__") {
        return workspaceRoot === null;
    }

    return workspaceRoot === workspaceKey;
}

function buildCloudConversationGroups(
    conversations: ReadonlyArray<Conversation>,
    liveSessionIds: ReadonlySet<string>
): ReadonlyArray<CloudConversationGroup> {
    const grouped = new Map<string, Array<Conversation>>();

    for (const conversation of conversations) {
        if (conversation.archived || conversation.sessionId === null || liveSessionIds.has(conversation.sessionId)) {
            continue;
        }

        const workspaceKey = conversation.workspaceRoot ?? "__cloud__";
        const items = grouped.get(workspaceKey) ?? [];
        items.push(conversation);
        grouped.set(workspaceKey, items);
    }

    return [...grouped.entries()]
        .sort((left, right) => right[1][0]!.updatedAt - left[1][0]!.updatedAt)
        .map(([workspace, entries]) => ({
            workspace,
            displayName: workspace === "__cloud__" ? "Cloud chats" : basenamePath(workspace),
            conversations: [...entries].sort((left, right) => right.updatedAt - left.updatedAt),
        }));
}

function matchesCloudFilter(
    conversation: Conversation,
    filter: CloudFilter,
    now: number
): boolean {
    if (filter === "all") {
        return true;
    }

    const recent = isRecentCloudSync(conversation.lastSyncedAt, now);
    return filter === "recent" ? recent : !recent;
}

export default function DrawerContent(props: DrawerContentComponentProps) {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const router = useRouter();
    const drawerStatus = useDrawerStatus();
    const sessions = useSessionStore((s) => s.sessions);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const busySessions = useSessionStore((s) => s.busySessions);
    const conversations = useChatHistoryStore((s) => s.conversations);
    const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
    const connectionState = useConnectionStore((s) => s.state);
    const savedWorkspaceDirectories = useWorkspaceDirectoryStore((s) => s.directories);
    const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [workspaceSelectionMode, setWorkspaceSelectionMode] = useState<string | null>(null);
    const [selectedWorkspaceEntryKeys, setSelectedWorkspaceEntryKeys] = useState<Set<string>>(new Set());
    const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
    const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
    const [resumeResultsBySessionId, setResumeResultsBySessionId] = useState<Readonly<Record<string, DrawerResumeResult>>>({});
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [chatActionMenu, setChatActionMenu] = useState<ChatActionMenuState | null>(null);
    const refreshInFlightRef = useRef(false);

    const closeChatActionMenu = () => {
        setChatActionMenu(null);
    };

    const openChatActionMenu = (nextMenu: ChatActionMenuState) => {
        Keyboard.dismiss();
        setChatActionMenu(nextMenu);
    };

    const linkedConversationBySessionId = useMemo(
        () => new Map(
            conversations
                .filter((conversation) => conversation.sessionId !== null)
                .map((conversation) => [conversation.sessionId as string, conversation])
        ),
        [conversations],
    );
    const visibleLiveSessions = useMemo(
        () => sessions.filter((session) => {
            const linkedConversation = linkedConversationBySessionId.get(session.id);
            return linkedConversation?.archived !== true;
        }),
        [linkedConversationBySessionId, sessions],
    );

    const refreshDrawerData = React.useCallback(async (showFeedback: boolean) => {
        if (connectionState !== "authenticated") {
            if (showFeedback) {
                Alert.alert("Not connected", "Reconnect to refresh sessions.");
            }
            return;
        }

        if (refreshInFlightRef.current) {
            return;
        }

        if (showFeedback) {
            setIsRefreshing(true);
        }

        refreshInFlightRef.current = true;
        try {
            await listSessions();
            if (showFeedback) {
                // A second explicit pull helps when remote session metadata updates slightly later.
                await listSessions();
            }
        } finally {
            refreshInFlightRef.current = false;
            if (showFeedback) {
                setTimeout(() => setIsRefreshing(false), 300);
            }
        }
    }, [connectionState]);

    useEffect(() => {
        if (connectionState !== "authenticated" || drawerStatus !== "open") {
            return;
        }

        void refreshDrawerData(false);
        const timerId = setInterval(() => {
            void refreshDrawerData(false);
        }, 30000);

        return () => clearInterval(timerId);
    }, [connectionState, drawerStatus, refreshDrawerData]);

    const copilotCliGroups = useMemo(
        () => buildWorkspaceGroups(
            visibleLiveSessions,
            savedWorkspaceDirectories.map((directory) => directory.path),
        ),
        [savedWorkspaceDirectories, visibleLiveSessions],
    );
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
    const liveSessionIds = useMemo(
        () => new Set(visibleLiveSessions.map((session) => session.id)),
        [visibleLiveSessions],
    );
    const cloudConversationGroups = useMemo(
        () => buildCloudConversationGroups(conversations, liveSessionIds),
        [conversations, liveSessionIds],
    );
    const now = Date.now();
    const filteredCloudConversationGroups = useMemo(
        () => cloudConversationGroups
            .map((group) => ({
                ...group,
                conversations: group.conversations.filter((conversation) =>
                    matchesCloudFilter(conversation, cloudFilter, now)
                ),
            }))
            .filter((group) => group.conversations.length > 0),
        [cloudConversationGroups, cloudFilter, now],
    );
    const cloudConversationCount = useMemo(
        () => filteredCloudConversationGroups.reduce((total, group) => total + group.conversations.length, 0),
        [filteredCloudConversationGroups],
    );
    const [archivedExpanded, setArchivedExpanded] = useState(false);
    const showCloudSection = false;

    const allExpandableWorkspaceKeys = useMemo(
        () => [
            ...copilotCliGroups.map((group) => makeWorkspaceSectionKey("copilot", group.workspace)),
            ...(showCloudSection
                ? filteredCloudConversationGroups.map((group) => makeWorkspaceSectionKey("cloud", group.workspace))
                : []),
        ],
        [copilotCliGroups, filteredCloudConversationGroups, showCloudSection],
    );

    const allWorkspacesExpanded = allExpandableWorkspaceKeys.length > 0
        && allExpandableWorkspaceKeys.every((key) => expandedWorkspaces.has(key));

    const cloudWorkspaceKeys = useMemo(
        () => buildProviderWorkspaceKeys("cloud", filteredCloudConversationGroups.map((group) => group.workspace)),
        [filteredCloudConversationGroups],
    );

    const toggleAllWorkspaces = () => {
        cancelWorkspaceSelectionMode();
        if (allWorkspacesExpanded) {
            setExpandedWorkspaces(new Set());
            return;
        }
        setExpandedWorkspaces(new Set(allExpandableWorkspaceKeys));
    };

    const areWorkspaceKeysExpanded = (workspaceKeys: ReadonlyArray<string>) =>
        workspaceKeys.length > 0 && workspaceKeys.every((key) => expandedWorkspaces.has(key));

    const toggleProviderWorkspaces = (workspaceKeys: ReadonlyArray<string>) => {
        if (workspaceKeys.length === 0) {
            return;
        }

        cancelWorkspaceSelectionMode();
        const shouldCollapse = areWorkspaceKeysExpanded(workspaceKeys);
        setExpandedWorkspaces((prev) => {
            const next = new Set(prev);
            for (const workspaceKey of workspaceKeys) {
                if (shouldCollapse) {
                    next.delete(workspaceKey);
                } else {
                    next.add(workspaceKey);
                }
            }
            return next;
        });
    };

    const cancelWorkspaceSelectionMode = () => {
        setWorkspaceSelectionMode(null);
        setSelectedWorkspaceEntryKeys(new Set());
    };

    const setResumeResult = (sessionId: string, result: DrawerResumeResult) => {
        setResumeResultsBySessionId((state) => ({
            ...state,
            [sessionId]: result,
        }));
    };

    const startWorkspaceSelectionMode = (workspaceKey: string) => {
        setWorkspaceSelectionMode(workspaceKey);
        setSelectedWorkspaceEntryKeys(new Set());
        setExpandedWorkspaces((prev) => new Set(prev).add(workspaceKey));
    };

    const applyDeletedSessionsLocally = (sessionIds: ReadonlyArray<string>): void => {
        const sessionStore = useSessionStore.getState();
        const historyStore = useChatHistoryStore.getState();

        for (const sessionId of sessionIds) {
            const isActiveSession = sessionStore.activeSessionId === sessionId;
            sessionStore.removeSession(sessionId);
            historyStore.removeBySessionId(sessionId);
            if (isActiveSession) {
                sessionStore.clearChatItems();
                sessionStore.setSessionLoading(false);
            }
        }
    };

    const deleteSessionsBulk = async (
        sessionIds: ReadonlyArray<string>,
        options?: { showPartialFailureAlert?: boolean }
    ): Promise<{
        deletedSessionIds: ReadonlyArray<string>;
        failedSessionIds: ReadonlyArray<string>;
    }> => {
        const uniqueSessionIds = [...new Set(sessionIds)];
        if (uniqueSessionIds.length === 0) {
            return { deletedSessionIds: [], failedSessionIds: [] };
        }

        const result = await deleteSessions(uniqueSessionIds);
        applyDeletedSessionsLocally(result.deletedSessionIds);

        if (result.failedSessionIds.length > 0 && options?.showPartialFailureAlert !== false) {
            Alert.alert(
                "Partial failure",
                `${result.failedSessionIds.length} sessions could not be deleted remotely and were kept in the sidebar.`
            );
        }

        return result;
    };

    const deleteDraftConversationsByWorkspace = (workspaceKey: string) => {
        const historyStore = useChatHistoryStore.getState();
        const draftIds = historyStore.conversations
            .filter((conversation) => {
                if (conversation.sessionId !== null) {
                    return false;
                }

                if (workspaceKey === "__none__") {
                    return conversation.workspaceRoot === null;
                }

                return conversation.workspaceRoot === workspaceKey;
            })
            .map((conversation) => conversation.id);

        for (const conversationId of draftIds) {
            historyStore.deleteConversation(conversationId);
        }
    };

    const handleDeleteWorkspace = (group: WorkspaceGroup) => {
        const matchingConversations = conversations.filter((conversation) =>
            matchesWorkspaceScope(group.workspace, conversation.workspaceRoot)
        );
        const sessionIds = [
            ...group.entries.flatMap((entry) => entry.sessions.map((session) => session.id)),
            ...matchingConversations
                .map((conversation) => conversation.sessionId)
                .filter((sessionId): sessionId is string => sessionId !== null),
        ];
        const localConversationIds = matchingConversations
            .filter((conversation) => conversation.sessionId === null)
            .map((conversation) => conversation.id);
        const linkedConversationCount = matchingConversations.length - localConversationIds.length;
        const workspaceSectionKey = makeWorkspaceSectionKey("copilot", group.workspace);

        Alert.alert(
            "Remove workspace",
            `Delete ${sessionIds.length} sessions and ${matchingConversations.length} local chats under ${group.displayName}?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        cancelWorkspaceSelectionMode();
                        const deleteResult = await deleteSessionsBulk(sessionIds, {
                            showPartialFailureAlert: false,
                        });
                        if (localConversationIds.length > 0) {
                            const historyStore = useChatHistoryStore.getState();
                            for (const conversationId of localConversationIds) {
                                historyStore.deleteConversation(conversationId);
                            }
                        }
                        if (sessionIds.length === 0 && linkedConversationCount === 0) {
                            deleteDraftConversationsByWorkspace(group.workspace);
                        }
                        if (deleteResult.failedSessionIds.length === 0) {
                            setExpandedWorkspaces((prev) => {
                                const next = new Set(prev);
                                next.delete(workspaceSectionKey);
                                return next;
                            });
                            if (group.workspace !== "__none__") {
                                useWorkspaceDirectoryStore.getState().removeDirectory(group.workspace);
                            }
                            return;
                        }

                        Alert.alert(
                            "Workspace kept",
                            `${deleteResult.failedSessionIds.length} chats are still on your Mac, so ${group.displayName} was not removed from the workspace list.`
                        );
                    },
                },
            ]
        );
    };

    const toggleWorkspaceEntrySelection = (entryKey: string) => {
        setSelectedWorkspaceEntryKeys((prev) => {
            const next = new Set(prev);
            if (next.has(entryKey)) {
                next.delete(entryKey);
            } else {
                next.add(entryKey);
            }
            return next;
        });
    };

    const deleteSelectedWorkspaceEntries = (group: WorkspaceGroup) => {
        const selectedEntries = group.entries.filter((entry) => selectedWorkspaceEntryKeys.has(entry.key));
        if (selectedEntries.length === 0) {
            Alert.alert("No selection", "Select at least one chat to delete.");
            return;
        }

        const sessionIds = selectedEntries.flatMap((entry) => entry.sessions.map((session) => session.id));
        Alert.alert(
            "Delete selected chats",
            `Delete ${selectedEntries.length} selected chat items (${sessionIds.length} sessions) from ${group.displayName}?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                        void deleteSessionsBulk(sessionIds);
                        cancelWorkspaceSelectionMode();
                    },
                },
            ]
        );
    };

    const handleDeleteAllDrafts = () => {
        const historyStore = useChatHistoryStore.getState();
        const draftIds = historyStore.conversations
            .filter((conversation) => conversation.sessionId === null && !conversation.archived)
            .map((conversation) => conversation.id);

        for (const conversationId of draftIds) {
            historyStore.deleteConversation(conversationId);
        }
    };

    const handleDeleteAllArchived = () => {
        const historyStore = useChatHistoryStore.getState();
        const archived = historyStore.conversations.filter((conversation) => conversation.archived);
        const archivedSessionIds = archived
            .map((conversation) => conversation.sessionId)
            .filter((sessionId): sessionId is string => sessionId !== null);
        const archivedDraftIds = archived
            .filter((conversation) => conversation.sessionId === null)
            .map((conversation) => conversation.id);

        for (const conversationId of archivedDraftIds) {
            historyStore.deleteConversation(conversationId);
        }

        void deleteSessionsBulk(archivedSessionIds);
    };

    const handleDeleteAllChats = () => {
        const allSessionIds = sessions.map((session) => session.id);
        const historyStore = useChatHistoryStore.getState();
        const draftConversationIds = historyStore.conversations
            .filter((conversation) => conversation.sessionId === null)
            .map((conversation) => conversation.id);

        for (const conversationId of draftConversationIds) {
            historyStore.deleteConversation(conversationId);
        }

        void deleteSessionsBulk(allSessionIds);
    };

    const openWorkspaceMenu = (group: WorkspaceGroup, anchor?: { x: number; y: number }) => {
        if (workspaceSelectionMode !== null && workspaceSelectionMode !== group.workspace) {
            cancelWorkspaceSelectionMode();
        }

        const canSelectChats = group.entries.length > 0;
        const workspaceRoot = group.workspace === "__none__" ? null : group.workspace;

        openChatActionMenu({
            title: group.displayName,
            subtitle: "Workspace actions",
            showHeaderDivider: false,
            ...(anchor ? { anchor } : {}),
            items: [
                {
                    key: "new-chat",
                    label: "New chat",
                    tone: "default",
                    icon: <CirclePlusIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => handleNewChat(workspaceRoot),
                },
                ...(canSelectChats
                    ? [{
                        key: "select-delete",
                        label: "Select chats to delete",
                        tone: "default" as const,
                        icon: <TrashIcon size={15} color={theme.colors.textSecondary} />,
                        onPress: () => startWorkspaceSelectionMode(group.workspace),
                    }]
                    : []),
                {
                    key: "remove-workspace",
                    label: "Remove workspace",
                    tone: "danger",
                    icon: <TrashIcon size={15} color={theme.colors.error} />,
                    onPress: () => handleDeleteWorkspace(group),
                },
            ],
        });
    };

    const openGlobalDrawerMenu = (anchor?: { x: number; y: number }) => {
        openChatActionMenu({
            title: "Chat actions",
            subtitle: "Projects panel actions",
            showHeaderDivider: true,
            ...(anchor ? { anchor } : {}),
            items: [
                {
                    key: "refresh-chats",
                    label: "Refresh chats",
                    tone: "default",
                    icon: <RefreshIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => {
                        void refreshDrawerData(true);
                    },
                },
                {
                    key: "toggle-workspaces",
                    label: allWorkspacesExpanded ? "Collapse all workspaces" : "Expand all workspaces",
                    tone: "default",
                    icon: <ChevronDownIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => toggleAllWorkspaces(),
                },
                {
                    key: "delete-drafts",
                    label: `Delete drafts (${draftConversations.length})`,
                    tone: "default",
                    icon: <FileTextIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => handleDeleteAllDrafts(),
                },
                {
                    key: "delete-archived",
                    label: `Delete archived (${archivedConversations.length})`,
                    tone: "default",
                    icon: <ArchiveIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => handleDeleteAllArchived(),
                },
                {
                    key: "delete-all",
                    label: `Delete all chats (${sessions.length + draftConversations.length})`,
                    tone: "danger",
                    icon: <TrashIcon size={15} color={theme.colors.error} />,
                    onPress: () => {
                        Alert.alert(
                            "Delete all chats",
                            "This will remove all sessions and drafts.",
                            [
                                { text: "Cancel", style: "cancel" },
                                {
                                    text: "Delete",
                                    style: "destructive",
                                    onPress: () => handleDeleteAllChats(),
                                },
                            ]
                        );
                    },
                },
            ],
        });
    };

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

    const handleAddWorkspace = (workspacePath: string) => {
        useWorkspaceDirectoryStore.getState().addDirectory(workspacePath);
        setExpandedWorkspaces((prev) => new Set(prev).add(makeWorkspaceSectionKey("copilot", workspacePath)));
        setWorkspacePickerOpen(false);
        handleNewChat(workspacePath);
    };

    const getConversationPresentation = (
        entry: WorkspaceGroup["entries"][number],
        linkedConversation: Conversation | undefined
    ): { title: string; preview: string } => {
        if (linkedConversation === undefined) {
            return {
                title: entry.title,
                preview: entry.preview,
            };
        }

        const linkedTitle = linkedConversation.title.trim();
        const linkedPreview = linkedConversation.preview.trim();

        return {
            title: linkedTitle.length > 0 && linkedTitle !== "New Chat" ? linkedTitle : entry.title,
            preview: linkedPreview.length > 0 ? linkedPreview : entry.preview,
        };
    };

    const clearPendingPrompts = () => {
        const sessionStore = useSessionStore.getState();
        sessionStore.deferActivePrompts();
        sessionStore.setPlanExitPrompt(null);
        useConnectionStore.getState().setError(null);
    };

    const closeRenameModal = () => {
        Keyboard.dismiss();
        setRenameTarget(null);
        setRenameValue("");
    };

    const ensureConversationForSession = (
        sessionId: string,
        fallbackTitle: string,
        fallbackPreview: string,
        fallbackWorkspaceRoot: string | null
    ): Conversation => {
        const historyStore = useChatHistoryStore.getState();
        const existingConversation = historyStore.conversations.find((item) => item.sessionId === sessionId);
        if (existingConversation !== undefined) {
            return existingConversation;
        }

        const previousActiveConversationId = historyStore.activeConversationId;
        const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
        const workspaceRoot = session?.context?.workspaceRoot ?? fallbackWorkspaceRoot;
        const conversationId = historyStore.createConversation(sessionId, workspaceRoot);
        historyStore.updateConversation(
            conversationId,
            fallbackTitle.trim().length > 0 ? fallbackTitle : "Chat",
            fallbackPreview
        );
        historyStore.setActiveConversation(previousActiveConversationId);

        const createdConversation = useChatHistoryStore.getState().conversations.find((item) => item.id === conversationId);
        if (createdConversation === undefined) {
            throw new Error(`Conversation cache missing after creating session link for ${sessionId}`);
        }

        return createdConversation;
    };

    const openRenameModal = (target: RenameTarget) => {
        setRenameTarget(target);
        setRenameValue(target.title.trim().length > 0 ? target.title : "New Chat");
    };

    const submitRename = () => {
        if (renameTarget === null) {
            return;
        }

        const nextTitle = renameValue.trim();
        if (nextTitle.length === 0) {
            Alert.alert("Rename chat", "Title cannot be empty.");
            return;
        }

        const historyStore = useChatHistoryStore.getState();
        if (renameTarget.conversationId !== null) {
            const existingConversation = historyStore.conversations.find((item) => item.id === renameTarget.conversationId);
            if (existingConversation === undefined) {
                Alert.alert("Rename failed", "This chat is no longer available.");
                return;
            }

            historyStore.updateConversation(
                existingConversation.id,
                nextTitle,
                existingConversation.preview.length > 0 ? existingConversation.preview : renameTarget.preview
            );
            closeRenameModal();
            return;
        }

        if (renameTarget.sessionId === null) {
            Alert.alert("Rename failed", "This chat cannot be renamed right now.");
            return;
        }

        const conversation = ensureConversationForSession(
            renameTarget.sessionId,
            renameTarget.title,
            renameTarget.preview,
            renameTarget.workspaceRoot
        );
        historyStore.updateConversation(
            conversation.id,
            nextTitle,
            conversation.preview.length > 0 ? conversation.preview : renameTarget.preview
        );
        closeRenameModal();
    };

    const handleSelectDraft = (conversationId: string) => {
        const sessionStore = useSessionStore.getState();
        const historyStore = useChatHistoryStore.getState();

        if (historyStore.activeConversationId !== null) {
            historyStore.setConversationItems(historyStore.activeConversationId, sessionStore.chatItems);
        }

        clearPendingPrompts();

        historyStore.setActiveConversation(conversationId);
        sessionStore.replaceChatItems(historyStore.getConversationItems(conversationId));
        sessionStore.setActiveSession(null);
        sessionStore.setSessionLoading(false);
        props.navigation.closeDrawer();
    };

    const handleSelectCloudConversation = (conversationId: string, sessionId: string | null) => {
        const sessionStore = useSessionStore.getState();
        const historyStore = useChatHistoryStore.getState();

        if (historyStore.activeConversationId !== null) {
            historyStore.setConversationItems(historyStore.activeConversationId, sessionStore.chatItems);
        }

        clearPendingPrompts();

        historyStore.setActiveConversation(conversationId);
        sessionStore.replaceChatItems(historyStore.getConversationItems(conversationId));
        sessionStore.setActiveSession(null);
        sessionStore.setSessionLoading(false);
        props.navigation.closeDrawer();

        if (sessionId !== null && connectionState === "authenticated" && liveSessionIds.has(sessionId)) {
            sessionStore.setSessionLoading(true);
            setResumeResult(sessionId, "idle");
            void resumeSession(sessionId)
                .then(() => {
                    setResumeResult(sessionId, "success");
                })
                .catch(() => {
                    setResumeResult(sessionId, "failed");
                    useSessionStore.getState().setSessionLoading(false);
                });
        }
    };

    const handleSelectSession = (sessionId: string) => {
        const sessionStore = useSessionStore.getState();
        const historyStore = useChatHistoryStore.getState();

        if (historyStore.activeConversationId !== null) {
            historyStore.setConversationItems(historyStore.activeConversationId, sessionStore.chatItems);
        }

        clearPendingPrompts();

        const linkedConversation = historyStore.conversations.find((item) => item.sessionId === sessionId);
        const existingSession = sessionStore.sessions.find((item) => item.id === sessionId);
        const workspaceRoot = existingSession?.context?.workspaceRoot ?? null;
        if (workspaceRoot !== null) {
            useWorkspaceDirectoryStore.getState().touchDirectory(workspaceRoot);
        }
        const conversationId = linkedConversation?.id
            ?? historyStore.createConversation(sessionId, workspaceRoot);

        historyStore.setActiveConversation(conversationId);
        sessionStore.replaceChatItems(
            linkedConversation !== undefined
                ? historyStore.getConversationItems(conversationId)
                : sessionStore.activeSessionId === sessionId
                    ? sessionStore.chatItems
                    : []
        );
        sessionStore.setActiveSession(sessionId);
        sessionStore.setSessionLoading(true);
        setResumeResult(sessionId, "idle");

        void resumeSession(sessionId)
            .then(() => {
                setResumeResult(sessionId, "success");
            })
            .catch(() => {
                setResumeResult(sessionId, "failed");
                useSessionStore.getState().setSessionLoading(false);
            });
        props.navigation.closeDrawer();
    };

    const handleDeleteSession = (sessionId: string) => {
        Alert.alert(
            "Delete session",
            "Are you sure you want to delete this session?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const deleteResult = await deleteSessionsBulk([sessionId], {
                                showPartialFailureAlert: false,
                            });
                            if (deleteResult.failedSessionIds.length > 0) {
                                Alert.alert("Delete failed", "Could not delete session remotely.");
                            }
                        } catch {
                            Alert.alert("Delete failed", "Could not delete session remotely.");
                        }
                    },
                },
            ]
        );
    };

    const archiveSessionConversation = (
        sessionId: string,
        conversationId: string | null,
        title: string,
        preview: string,
        workspaceRoot: string | null
    ) => {
        const historyStore = useChatHistoryStore.getState();
        const targetConversation = conversationId !== null
            ? historyStore.conversations.find((item) => item.id === conversationId)
            : ensureConversationForSession(sessionId, title, preview, workspaceRoot);

        if (targetConversation === undefined) {
            Alert.alert("Archive failed", "This chat could not be archived.");
            return;
        }

        historyStore.archiveConversation(targetConversation.id);
    };

    // VS Code style three-dot menu: Archive / Delete
    const openSessionMenu = (
        sessionId: string,
        conversationId: string | null,
        title: string,
        preview: string,
        workspaceRoot: string | null,
        anchor?: { x: number; y: number }
    ) => {
        openChatActionMenu({
            title: title.length > 0 ? title : "Chat",
            subtitle: "Chat actions",
            showHeaderDivider: false,
            ...(anchor ? { anchor } : {}),
            items: [
                {
                    key: "rename",
                    label: "Rename",
                    tone: "default",
                    icon: <PencilIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => openRenameModal({
                        conversationId,
                        sessionId,
                        title,
                        preview,
                        workspaceRoot,
                    }),
                },
                {
                    key: "archive",
                    label: "Archive",
                    tone: "default",
                    icon: <ArchiveIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => archiveSessionConversation(sessionId, conversationId, title, preview, workspaceRoot),
                },
                {
                    key: "delete",
                    label: "Delete",
                    tone: "danger",
                    icon: <TrashIcon size={15} color={theme.colors.error} />,
                    onPress: () => handleDeleteSession(sessionId),
                },
            ],
        });
    };

    const openArchivedMenu = (
        conversationId: string,
        sessionId: string | null,
        title: string,
        preview: string,
        workspaceRoot: string | null,
        anchor?: { x: number; y: number }
    ) => {
        openChatActionMenu({
            title: title.length > 0 ? title : "Archived",
            subtitle: "Archived chat actions",
            showHeaderDivider: false,
            ...(anchor ? { anchor } : {}),
            items: [
                {
                    key: "rename",
                    label: "Rename",
                    tone: "default",
                    icon: <PencilIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => openRenameModal({
                        conversationId,
                        sessionId,
                        title,
                        preview,
                        workspaceRoot,
                    }),
                },
                {
                    key: "restore",
                    label: "Restore",
                    tone: "default",
                    icon: <RefreshIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => useChatHistoryStore.getState().unarchiveConversation(conversationId),
                },
                {
                    key: "delete",
                    label: "Delete permanently",
                    tone: "danger",
                    icon: <TrashIcon size={15} color={theme.colors.error} />,
                    onPress: () => useChatHistoryStore.getState().deleteConversation(conversationId),
                },
            ],
        });
    };

    const openCloudConversationMenu = (
        conversationId: string,
        sessionId: string | null,
        title: string,
        preview: string,
        workspaceRoot: string | null,
        anchor?: { x: number; y: number }
    ) => {
        openChatActionMenu({
            title: title.length > 0 ? title : "Cloud conversation",
            subtitle: "Cloud chat actions",
            showHeaderDivider: false,
            ...(anchor ? { anchor } : {}),
            items: [
                {
                    key: "rename",
                    label: "Rename",
                    tone: "default",
                    icon: <PencilIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => openRenameModal({
                        conversationId,
                        sessionId,
                        title,
                        preview,
                        workspaceRoot,
                    }),
                },
                {
                    key: "open-cached",
                    label: "Open cached copy",
                    tone: "default",
                    icon: <FileTextIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => handleSelectCloudConversation(conversationId, null),
                },
                ...(sessionId !== null && connectionState === "authenticated"
                    ? [{
                        key: "reconnect",
                        label: "Try reconnect",
                        tone: "default" as const,
                        icon: <RefreshIcon size={15} color={theme.colors.textSecondary} />,
                        onPress: () => handleSelectCloudConversation(conversationId, sessionId),
                    }]
                    : []),
                {
                    key: "archive",
                    label: "Archive",
                    tone: "default",
                    icon: <ArchiveIcon size={15} color={theme.colors.textSecondary} />,
                    onPress: () => useChatHistoryStore.getState().archiveConversation(conversationId),
                },
                {
                    key: "delete-cached",
                    label: "Delete cached copy",
                    tone: "danger",
                    icon: <TrashIcon size={15} color={theme.colors.error} />,
                    onPress: () => useChatHistoryStore.getState().deleteConversation(conversationId),
                },
            ],
        });
    };

    const getChipStyle = (tone: DrawerMetadataChipTone) => {
        switch (tone) {
            case "success":
                return [styles.metadataChip, styles.metadataChipSuccess, styles.metadataChipTextSuccess] as const;
            case "warning":
                return [styles.metadataChip, styles.metadataChipWarning, styles.metadataChipTextWarning] as const;
            case "danger":
                return [styles.metadataChip, styles.metadataChipDanger, styles.metadataChipTextDanger] as const;
            case "neutral":
            default:
                return [styles.metadataChip, styles.metadataChipNeutral, styles.metadataChipTextNeutral] as const;
        }
    };

    const renderMetadataChips = (chips: ReadonlyArray<DrawerMetadataChip>) => (
        chips.length === 0
            ? null
            : (
                <View style={styles.metadataChipRow}>
                    {chips.map((chip) => {
                        const [chipStyle, toneStyle, textToneStyle] = getChipStyle(chip.tone);
                        return (
                            <View key={`${chip.label}:${chip.tone}`} style={[chipStyle, toneStyle]}>
                                <Text style={[styles.metadataChipText, textToneStyle]}>{chip.label}</Text>
                            </View>
                        );
                    })}
                </View>
            )
    );

    const renderConversationBody = (params: {
        title: string;
        active: boolean;
        preview: string;
        emptyPreview: string;
        metadata: DrawerProviderMetadata;
        duplicateCount?: number;
    }) => (
        <>
            <View style={styles.conversationTitleRow}>
                <View style={styles.conversationTitleGroup}>
                    <Text
                        style={[
                            styles.conversationTitle,
                            params.active && styles.conversationTitleActive,
                        ]}
                        numberOfLines={1}
                    >
                        {params.title}
                    </Text>
                    {params.duplicateCount !== undefined && params.duplicateCount > 0 && (
                        <Text style={styles.conversationDuplicateCount}>
                            ×{params.duplicateCount + 1}
                        </Text>
                    )}
                </View>
                {params.metadata.lastSyncText !== null && (
                    <Text style={styles.providerConversationMeta} numberOfLines={1}>
                        {params.metadata.lastSyncText}
                    </Text>
                )}
            </View>
            <Text style={styles.conversationPreview} numberOfLines={1}>
                {params.preview.length > 0 ? params.preview : params.emptyPreview}
            </Text>
            {renderMetadataChips(params.metadata.chips)}
        </>
    );

    const renderProjectConversationBody = (params: {
        title: string;
        active: boolean;
        running: boolean;
        lastActiveAt: number;
        resumeResult: DrawerResumeResult;
    }) => (
        <View style={styles.projectConversationContent}>
            <View style={[
                styles.projectConversationState,
                params.running && styles.projectConversationStateRunning,
            ]}>
                {params.running ? (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : params.resumeResult === "failed" ? (
                    <Feather name="alert-circle" size={13} color={theme.colors.error} />
                ) : null}
            </View>
            <Text
                style={[
                    styles.projectConversationTitle,
                    params.active && styles.projectConversationTitleActive,
                ]}
                numberOfLines={1}
            >
                {params.title}
            </Text>
            <Text style={styles.projectConversationTime} numberOfLines={1}>
                {formatRelativeTimestamp(params.lastActiveAt, now).replace(" ago", "")}
            </Text>
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <Text style={styles.headerTitle}>Projects</Text>
                </View>
                <View style={styles.headerActions}>
                    <Pressable
                        style={({ pressed }) => [styles.headerRefreshButton, pressed && styles.headerRefreshButtonPressed]}
                        onPress={() => {
                            openGlobalDrawerMenu();
                        }}
                        disabled={isRefreshing}
                        hitSlop={8}
                        accessibilityLabel="Project actions"
                    >
                        {isRefreshing ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <Feather name="filter" size={16} color={theme.colors.textTertiary} />
                        )}
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.headerRefreshButton, pressed && styles.headerRefreshButtonPressed]}
                        onPress={() => setWorkspacePickerOpen(true)}
                        hitSlop={8}
                        accessibilityLabel="Add workspace"
                    >
                        <Feather name="folder-plus" size={17} color={theme.colors.textTertiary} />
                    </Pressable>
                </View>
            </View>

            {/* Chat history — workspace grouped */}
            <ScrollView
                style={styles.conversationList}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.providerSection}>
                    {copilotCliGroups.length === 0 && (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyText}>
                                No local sessions yet
                            </Text>
                        </View>
                    )}

                    {copilotCliGroups.map((group) => {
                        const expansionKey = makeWorkspaceSectionKey("copilot", group.workspace);
                        const isExpanded = expandedWorkspaces.has(expansionKey);
                        return (
                            <View key={group.workspace} style={styles.workspaceGroup}>
                                <View style={styles.workspaceHeaderRow}>
                                    <Pressable
                                        style={styles.workspaceHeader}
                                        onPress={() => toggleWorkspace(expansionKey)}
                                        onLongPress={() => openWorkspaceMenu(group)}
                                    >
                                        <Feather name={isExpanded ? "folder" : "folder"} size={13} color={theme.colors.textSecondary} />
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
                                        onPress={() => openWorkspaceMenu(group)}
                                        hitSlop={8}
                                        accessibilityLabel={`${group.displayName} menu`}
                                    >
                                        <Feather name="more-horizontal" size={14} color={theme.colors.textSecondary} />
                                    </Pressable>
                                </View>
                                {workspaceSelectionMode === group.workspace && (
                                    <View style={styles.selectionActionsRow}>
                                        <Text style={styles.selectionCountText}>
                                            {selectedWorkspaceEntryKeys.size} selected
                                        </Text>
                                        <Pressable
                                            style={({ pressed }) => [
                                                styles.selectionActionBtn,
                                                pressed && styles.workspaceAddBtnPressed,
                                            ]}
                                            onPress={() => deleteSelectedWorkspaceEntries(group)}
                                            accessibilityLabel="Delete selected chats"
                                        >
                                            <Text style={styles.selectionActionDeleteText}>Delete selected</Text>
                                        </Pressable>
                                        <Pressable
                                            style={({ pressed }) => [
                                                styles.selectionActionBtn,
                                                pressed && styles.workspaceAddBtnPressed,
                                            ]}
                                            onPress={cancelWorkspaceSelectionMode}
                                            accessibilityLabel="Cancel selection"
                                        >
                                            <Text style={styles.selectionActionText}>Cancel</Text>
                                        </Pressable>
                                    </View>
                                )}
                                {isExpanded &&
                                    group.entries.map((entry) => {
                                        const linkedConv = conversations.find(
                                            (c) => c.sessionId === entry.primarySession.id
                                        );
                                        const presentation = getConversationPresentation(entry, linkedConv);
                                        const linkedId = linkedConv?.id ?? null;
                                        const isEntrySelected = selectedWorkspaceEntryKeys.has(entry.key);
                                        const resumeResult = resumeResultsBySessionId[entry.primarySession.id] ?? "idle";
                                        const isRunning = busySessions[entry.primarySession.id] === true;
                                        return (
                                            <View key={entry.key} style={styles.conversationRow}>
                                                {workspaceSelectionMode === group.workspace && (
                                                    <Pressable
                                                        style={({ pressed }) => [
                                                            styles.selectionCheckBtn,
                                                            pressed && styles.workspaceAddBtnPressed,
                                                        ]}
                                                        onPress={() => toggleWorkspaceEntrySelection(entry.key)}
                                                        accessibilityLabel={isEntrySelected ? "Unselect chat" : "Select chat"}
                                                    >
                                                        <Feather
                                                            name={isEntrySelected ? "check-square" : "square"}
                                                            size={14}
                                                            color={isEntrySelected ? theme.colors.textPrimary : theme.colors.textTertiary}
                                                        />
                                                    </Pressable>
                                                )}
                                                <Pressable
                                                    style={({ pressed }) => [
                                                        styles.conversationItem,
                                                        styles.conversationItemFlex,
                                                        activeSessionId === entry.primarySession.id &&
                                                        styles.conversationItemActive,
                                                        workspaceSelectionMode === group.workspace &&
                                                        isEntrySelected && styles.conversationItemSelected,
                                                        pressed && styles.conversationItemPressed,
                                                    ]}
                                                    onPress={() =>
                                                        workspaceSelectionMode === group.workspace
                                                            ? toggleWorkspaceEntrySelection(entry.key)
                                                            : handleSelectSession(entry.primarySession.id)
                                                    }
                                                    onLongPress={() =>
                                                        workspaceSelectionMode === group.workspace
                                                            ? toggleWorkspaceEntrySelection(entry.key)
                                                            : openSessionMenu(
                                                                entry.primarySession.id,
                                                                linkedId,
                                                                presentation.title,
                                                                presentation.preview,
                                                                group.workspace === "__none__" ? null : group.workspace,
                                                            )
                                                    }
                                                    accessibilityLabel={entry.title.length > 0 ? entry.title : "Session"}
                                                >
                                                    {renderProjectConversationBody({
                                                        title: presentation.title,
                                                        active: activeSessionId === entry.primarySession.id,
                                                        running: isRunning,
                                                        lastActiveAt: entry.primarySession.lastActiveAt,
                                                        resumeResult,
                                                    })}
                                                </Pressable>
                                                {workspaceSelectionMode !== group.workspace && (
                                                    <Pressable
                                                        style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
                                                        onPress={() => openSessionMenu(
                                                            entry.primarySession.id,
                                                            linkedId,
                                                            presentation.title,
                                                            presentation.preview,
                                                            group.workspace === "__none__" ? null : group.workspace,
                                                        )}
                                                        hitSlop={8}
                                                        accessibilityLabel="More actions"
                                                    >
                                                        <Feather name="more-horizontal" size={14} color={theme.colors.textTertiary} />
                                                    </Pressable>
                                                )}
                                            </View>
                                        );
                                    })}
                            </View>
                        );
                    })}
                </View>

                {showCloudSection && (
                    <View style={styles.providerSection}>
                        <View style={styles.providerHeaderRow}>
                            <View style={styles.providerHeaderLeft}>
                                <Feather name="cloud" size={14} color={theme.colors.textSecondary} />
                                <Text style={styles.providerHeaderText}>Cloud</Text>
                            </View>
                            <View style={styles.providerHeaderRight}>
                                <Text style={styles.providerHeaderMeta}>
                                    {cloudConversationCount} chats
                                </Text>
                                {cloudWorkspaceKeys.length > 0 && (
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.providerHeaderAction,
                                            pressed && styles.providerHeaderActionPressed,
                                        ]}
                                        onPress={() => toggleProviderWorkspaces(cloudWorkspaceKeys)}
                                        hitSlop={8}
                                    >
                                        <Text style={styles.providerHeaderActionText}>
                                            {areWorkspaceKeysExpanded(cloudWorkspaceKeys) ? "Collapse" : "Expand"}
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>

                        <View style={styles.cloudFilterRow}>
                            {[
                                { key: "all", label: "All" },
                                { key: "recent", label: "Recently synced" },
                                { key: "stale", label: "Stale cache" },
                            ].map((option) => {
                                const isSelected = cloudFilter === option.key;
                                return (
                                    <Pressable
                                        key={option.key}
                                        style={({ pressed }) => [
                                            styles.cloudFilterPill,
                                            isSelected && styles.cloudFilterPillSelected,
                                            pressed && styles.cloudFilterPillPressed,
                                        ]}
                                        onPress={() => setCloudFilter(option.key as CloudFilter)}
                                        accessibilityLabel={`Filter cloud chats by ${option.label}`}
                                    >
                                        <Text
                                            style={[
                                                styles.cloudFilterPillText,
                                                isSelected && styles.cloudFilterPillTextSelected,
                                            ]}
                                        >
                                            {option.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {filteredCloudConversationGroups.length === 0 && (
                            <View style={styles.inlineEmptyState}>
                                <Text style={styles.inlineEmptyText}>
                                    {cloudFilter === "all"
                                        ? "No cached cloud conversations yet."
                                        : "No cloud conversations match this filter."}
                                </Text>
                            </View>
                        )}

                        {filteredCloudConversationGroups.map((group) => {
                            const expansionKey = makeWorkspaceSectionKey("cloud", group.workspace);
                            const isExpanded = expandedWorkspaces.has(expansionKey);
                            return (
                                <View key={group.workspace} style={styles.workspaceGroup}>
                                    <View style={styles.workspaceHeaderRow}>
                                        <Pressable
                                            style={styles.workspaceHeader}
                                            onPress={() => toggleWorkspace(expansionKey)}
                                        >
                                            <Feather
                                                name={isExpanded ? "chevron-down" : "chevron-right"}
                                                size={12}
                                                color={theme.colors.textTertiary}
                                            />
                                            <Feather name="cloud" size={14} color={theme.colors.textTertiary} />
                                            <Text style={styles.workspaceName} numberOfLines={1}>
                                                {group.displayName}
                                            </Text>
                                            <Text style={styles.workspaceCount}>
                                                {group.conversations.length}
                                            </Text>
                                        </Pressable>
                                    </View>

                                    {isExpanded && group.conversations.map((conversation) => {
                                        const remoteSessionAvailable = conversation.sessionId !== null
                                            && liveSessionIds.has(conversation.sessionId);
                                        const metadata = buildCloudConversationMetadata(
                                            conversation.lastSyncedAt,
                                            conversation.sessionId,
                                            remoteSessionAvailable,
                                            conversation.sessionId !== null
                                                ? (resumeResultsBySessionId[conversation.sessionId] ?? "idle")
                                                : "idle",
                                            now,
                                        );

                                        return (
                                            <View key={conversation.id} style={styles.conversationRow}>
                                                <Pressable
                                                    style={({ pressed }) => [
                                                        styles.conversationItem,
                                                        styles.conversationItemFlex,
                                                        activeConversationId === conversation.id && activeSessionId === null && styles.conversationItemActive,
                                                        pressed && styles.conversationItemPressed,
                                                    ]}
                                                    onPress={() => handleSelectCloudConversation(
                                                        conversation.id,
                                                        remoteSessionAvailable ? conversation.sessionId : null,
                                                    )}
                                                    onLongPress={() => openCloudConversationMenu(
                                                        conversation.id,
                                                        remoteSessionAvailable ? conversation.sessionId : null,
                                                        conversation.title,
                                                        conversation.preview,
                                                        conversation.workspaceRoot,
                                                    )}
                                                    accessibilityLabel={conversation.title}
                                                >
                                                    {renderConversationBody({
                                                        title: conversation.title,
                                                        active: activeConversationId === conversation.id && activeSessionId === null,
                                                        preview: conversation.preview,
                                                        emptyPreview: "Cached cloud conversation",
                                                        metadata,
                                                    })}
                                                </Pressable>
                                                <Pressable
                                                    style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
                                                    onPress={(e) => openCloudConversationMenu(
                                                        conversation.id,
                                                        remoteSessionAvailable ? conversation.sessionId : null,
                                                        conversation.title,
                                                        conversation.preview,
                                                        conversation.workspaceRoot,
                                                        { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }
                                                    )}
                                                    hitSlop={8}
                                                    accessibilityLabel="More actions"
                                                >
                                                    <Feather name="more-horizontal" size={14} color={theme.colors.textTertiary} />
                                                </Pressable>
                                            </View>
                                        );
                                    })}
                                </View>
                            );
                        })}
                    </View>
                )}

                {archivedConversations.length > 0 && (
                    <View style={styles.workspaceGroup}>
                        <Pressable
                            style={styles.workspaceHeader}
                            onPress={() => setArchivedExpanded((prev) => !prev)}
                        >
                            <Feather
                                name={archivedExpanded ? "chevron-down" : "chevron-right"}
                                size={12}
                                color={theme.colors.textTertiary}
                            />
                            <Feather name="archive" size={14} color={theme.colors.textTertiary} />
                            <Text style={styles.workspaceName} numberOfLines={1}>
                                Archived
                            </Text>
                            <Text style={styles.workspaceCount}>
                                {archivedConversations.length}
                            </Text>
                        </Pressable>
                        {archivedExpanded &&
                            archivedConversations.map((conversation) => {
                                const metadata = buildArchivedConversationMetadata(
                                    conversation.sessionId,
                                    conversation.workspaceRoot,
                                    conversation.lastSyncedAt,
                                    connectionState,
                                    conversation.sessionId !== null
                                        ? (resumeResultsBySessionId[conversation.sessionId] ?? "idle")
                                        : "idle",
                                    now,
                                );

                                return (
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
                                            onLongPress={(e) => openArchivedMenu(
                                                conversation.id,
                                                conversation.sessionId,
                                                conversation.title,
                                                conversation.preview,
                                                conversation.workspaceRoot,
                                                { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }
                                            )}
                                            accessibilityLabel={conversation.title}
                                        >
                                            {renderConversationBody({
                                                title: conversation.title,
                                                active: false,
                                                preview: conversation.preview,
                                                emptyPreview: "Archived conversation",
                                                metadata,
                                            })}
                                        </Pressable>
                                        <Pressable
                                            style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
                                            onPress={(e) => openArchivedMenu(
                                                conversation.id,
                                                conversation.sessionId,
                                                conversation.title,
                                                conversation.preview,
                                                conversation.workspaceRoot,
                                                { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }
                                            )}
                                            hitSlop={8}
                                            accessibilityLabel="More actions"
                                        >
                                            <Feather name="more-horizontal" size={14} color={theme.colors.textTertiary} />
                                        </Pressable>
                                    </View>
                                );
                            })}
                    </View>
                )}
            </ScrollView>

            {/* Footer — settings and workspace actions */}
            <View style={styles.footer}>
                <View style={styles.footerDivider} />

                <View style={styles.footerActions}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.footerItem,
                            styles.footerItemCompact,
                            pressed && styles.footerItemPressed,
                        ]}
                        onPress={() => {
                            router.push("/settings");
                            props.navigation.closeDrawer();
                        }}
                    >
                        <Feather name="settings" size={15} color={theme.colors.textTertiary} />
                        <Text style={styles.footerItemText}>Settings</Text>
                    </Pressable>
                </View>
            </View>

            <Modal
                visible={chatActionMenu !== null}
                transparent
                animationType="fade"
                onRequestClose={closeChatActionMenu}
            >
                <Pressable
                    style={[styles.actionMenuOverlay, chatActionMenu?.anchor ? { backgroundColor: "transparent" } : undefined]}
                    onPress={closeChatActionMenu}
                >
                    <Pressable
                        style={[
                            styles.actionMenuCard,
                            chatActionMenu?.anchor ? {
                                position: "absolute",
                                top: Math.min(chatActionMenu.anchor.y + 10, 600),
                                left: Math.max(10, chatActionMenu.anchor.x - 240),
                            } : undefined
                        ]}
                        onPress={(event) => event.stopPropagation()}
                    >
                        <View
                            style={[
                                styles.actionMenuHeader,
                                !(chatActionMenu?.showHeaderDivider ?? false) && styles.actionMenuHeaderNoDivider,
                            ]}
                        >
                            <View style={styles.actionMenuHeaderLeft}>
                                <View style={styles.actionMenuIconBadge}>
                                    <FolderIcon size={16} color={theme.colors.textSecondary} />
                                </View>
                                <View style={styles.actionMenuHeaderText}>
                                    <Text style={styles.actionMenuTitle} numberOfLines={1}>
                                        {chatActionMenu?.title ?? "Chat"}
                                    </Text>
                                    {chatActionMenu?.subtitle !== null && chatActionMenu?.subtitle !== undefined && (
                                        <Text style={styles.actionMenuSubtitle} numberOfLines={1}>
                                            {chatActionMenu.subtitle}
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.actionMenuCloseButton,
                                    pressed && styles.actionMenuCloseButtonPressed,
                                ]}
                                onPress={closeChatActionMenu}
                                hitSlop={8}
                                accessibilityLabel="Close chat actions"
                            >
                                <CloseIcon size={14} color={theme.colors.textTertiary} />
                            </Pressable>
                        </View>

                        <View style={styles.actionMenuList}>
                            {(chatActionMenu?.items ?? []).map((item, index) => (
                                <React.Fragment key={item.key}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.actionMenuItem,
                                            pressed && styles.actionMenuItemPressed,
                                        ]}
                                        onPress={() => {
                                            closeChatActionMenu();
                                            item.onPress();
                                        }}
                                    >
                                        <View style={[
                                            styles.actionMenuItemIconWrap,
                                            item.tone === "danger" && styles.actionMenuItemIconWrapDanger,
                                        ]}>
                                            {item.icon}
                                        </View>
                                        <Text style={[
                                            styles.actionMenuItemText,
                                            item.tone === "danger" && styles.actionMenuItemTextDanger,
                                        ]}>
                                            {item.label}
                                        </Text>
                                    </Pressable>
                                    {index < (chatActionMenu?.items.length ?? 0) - 1 && (
                                        <View style={styles.actionMenuSeparator} />
                                    )}
                                </React.Fragment>
                            ))}
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>

            <Modal
                visible={renameTarget !== null}
                transparent
                animationType="fade"
                onRequestClose={closeRenameModal}
            >
                <Pressable style={styles.renameOverlay} onPress={closeRenameModal}>
                    <KeyboardAvoidingView
                        style={styles.renameKeyboardLayer}
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
                    >
                        <Pressable style={styles.renameCard} onPress={(event) => event.stopPropagation()}>
                            <Text style={styles.renameTitle}>Rename chat</Text>
                            <Text style={styles.renameSubtitle} numberOfLines={2}>
                                {renameTarget?.preview.trim().length
                                    ? renameTarget.preview
                                    : "Choose a shorter, clearer title for this chat."}
                            </Text>
                            <TextInput
                                style={styles.renameInput}
                                value={renameValue}
                                onChangeText={setRenameValue}
                                placeholder="Chat title"
                                placeholderTextColor={theme.colors.textPlaceholder}
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={submitRename}
                            />
                            <View style={styles.renameActions}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.renameSecondaryButton,
                                        pressed && styles.renameSecondaryButtonPressed,
                                    ]}
                                    onPress={closeRenameModal}
                                >
                                    <Text style={styles.renameSecondaryButtonText}>Cancel</Text>
                                </Pressable>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.renamePrimaryButton,
                                        pressed && styles.renamePrimaryButtonPressed,
                                    ]}
                                    onPress={submitRename}
                                >
                                    <Text style={styles.renamePrimaryButtonText}>Save</Text>
                                </Pressable>
                            </View>
                        </Pressable>
                    </KeyboardAvoidingView>
                </Pressable>
            </Modal>

            <WorkspacePickerModal
                visible={workspacePickerOpen}
                onClose={() => setWorkspacePickerOpen(false)}
                onSelect={handleAddWorkspace}
            />
        </SafeAreaView>
    );
}

function createStyles(theme: AppTheme) {
    const isAmoled = theme.variant === "amoled";
    const badgeSurface = isAmoled ? theme.colors.bgTertiary : theme.colors.bgElevated;

    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.sidebarBg,
        },
        header: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.lg,
        },
        headerLeft: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        headerTitle: {
            fontSize: 16,
            fontWeight: "600",
            color: theme.colors.textSecondary,
        },
        headerRefreshButton: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
        },
        headerRefreshButtonPressed: {
            backgroundColor: theme.colors.bgElevated,
        },
        headerActions: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
        },
        conversationList: {
            flex: 1,
            paddingHorizontal: 12,
        },
        providerSection: {
            marginBottom: theme.spacing.sm,
        },
        providerHeaderRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.xs,
        },
        providerHeaderLeft: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.xs,
        },
        providerHeaderRight: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
        },
        providerHeaderText: {
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
            color: theme.colors.textPrimary,
        },
        providerHeaderMeta: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            fontWeight: "600",
        },
        providerHeaderAction: {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 4,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        providerHeaderActionPressed: {
            opacity: 0.8,
        },
        providerHeaderActionText: {
            fontSize: theme.fontSize.xs,
            fontWeight: "700",
            color: theme.colors.textSecondary,
        },
        cloudFilterRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.xs,
            paddingHorizontal: theme.spacing.md,
            paddingBottom: theme.spacing.xs,
            flexWrap: "wrap",
        },
        cloudFilterPill: {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 6,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        cloudFilterPillSelected: {
            backgroundColor: theme.colors.bgTertiary,
            borderColor: theme.colors.textSecondary,
        },
        cloudFilterPillPressed: {
            opacity: 0.8,
        },
        cloudFilterPillText: {
            fontSize: theme.fontSize.xs,
            fontWeight: "600",
            color: theme.colors.textTertiary,
        },
        cloudFilterPillTextSelected: {
            color: theme.colors.textPrimary,
        },
        emptyState: {
            paddingVertical: 32,
            alignItems: "center",
        },
        emptyText: {
            fontSize: theme.fontSize.sm,
            color: theme.colors.textTertiary,
        },
        inlineEmptyState: {
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
        },
        inlineEmptyText: {
            fontSize: theme.fontSize.sm,
            color: theme.colors.textTertiary,
        },
        workspaceGroup: {
            marginBottom: theme.spacing.xs,
        },
        sectionHeader: {
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.xs,
            paddingBottom: 6,
        },
        sectionHeaderText: {
            fontSize: theme.fontSize.xs,
            fontWeight: "700",
            color: theme.colors.textTertiary,
            textTransform: "uppercase",
            letterSpacing: 0.5,
        },
        workspaceHeader: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 9,
            gap: 10,
        },
        workspaceHeaderRow: {
            flexDirection: "row",
            alignItems: "center",
        },
        workspaceAddBtn: {
            width: 26,
            height: 26,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
            marginRight: theme.spacing.sm,
        },
        workspaceAddBtnPressed: {
            backgroundColor: theme.colors.bgElevated,
        },
        workspaceChevron: {
            width: 12,
        },
        workspaceIcon: {
            width: 14,
        },
        workspaceName: {
            flex: 1,
            fontSize: theme.fontSize.sm,
            fontWeight: "500",
            color: theme.colors.textSecondary,
        },
        workspaceCount: {
            fontSize: 10,
            color: theme.colors.textTertiary,
            backgroundColor: badgeSurface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: 5,
            paddingVertical: 1,
            borderRadius: theme.borderRadius.xs,
            overflow: "hidden",
        },
        conversationItem: {
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderRadius: 14,
            marginBottom: 2,
            marginLeft: 20,
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
        selectionCheckBtn: {
            width: 24,
            height: 24,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
            marginLeft: theme.spacing.sm,
        },
        selectionActionsRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            paddingBottom: theme.spacing.xs,
        },
        selectionCountText: {
            flex: 1,
            fontSize: theme.fontSize.xs,
            color: theme.colors.textSecondary,
            fontWeight: "600",
        },
        selectionActionBtn: {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 6,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: theme.colors.bgElevated,
        },
        selectionActionText: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textSecondary,
            fontWeight: "600",
        },
        selectionActionDeleteText: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.error,
            fontWeight: "700",
        },
        moreBtn: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
            marginRight: theme.spacing.sm,
        },
        moreBtnPressed: {
            backgroundColor: theme.colors.bgElevated,
        },
        conversationItemActive: {
            backgroundColor: theme.colors.sidebarItemActive,
        },
        conversationItemSelected: {
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        conversationItemPressed: {
            backgroundColor: theme.colors.sidebarItemHover,
        },
        projectConversationContent: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
        },
        projectConversationState: {
            width: 18,
            height: 18,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
        },
        projectConversationStateRunning: {
            backgroundColor: "transparent",
            borderWidth: 0,
        },
        projectConversationTitle: {
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            lineHeight: 21,
            color: theme.colors.textPrimary,
            fontWeight: "500",
        },
        projectConversationTitleActive: {
            fontWeight: "700",
        },
        projectConversationTime: {
            flexShrink: 0,
            minWidth: 32,
            textAlign: "right",
            fontSize: 13,
            fontWeight: "700",
            color: theme.colors.textTertiary,
        },
        conversationTitle: {
            flex: 1,
            fontSize: theme.fontSize.sm,
            color: theme.colors.textPrimary,
            fontWeight: "500",
        },
        conversationTitleRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
        },
        conversationTitleGroup: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.xs,
            minWidth: 0,
        },
        conversationTitleActive: {
            color: theme.colors.textPrimary,
            fontWeight: "600",
        },
        conversationDuplicateCount: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            backgroundColor: badgeSurface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: 5,
            paddingVertical: 1,
            borderRadius: theme.borderRadius.xs,
            overflow: "hidden",
        },
        conversationPreview: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            marginTop: 2,
        },
        providerConversationMeta: {
            flexShrink: 0,
            maxWidth: "42%",
            fontSize: 11,
            color: theme.colors.textSecondary,
            textAlign: "right",
        },
        metadataChipRow: {
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: theme.spacing.xs,
            marginTop: 4,
        },
        metadataChip: {
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: theme.borderRadius.xs,
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        metadataChipNeutral: {
            backgroundColor: theme.colors.bgElevated,
            borderColor: theme.colors.border,
        },
        metadataChipSuccess: {
            backgroundColor: theme.colors.successMuted,
            borderColor: theme.colors.success,
        },
        metadataChipWarning: {
            backgroundColor: theme.colors.accentMuted,
            borderColor: theme.colors.warning,
        },
        metadataChipDanger: {
            backgroundColor: theme.colors.errorMuted,
            borderColor: theme.colors.error,
        },
        metadataChipText: {
            fontSize: 10,
            fontWeight: "700",
            color: theme.colors.textSecondary,
        },
        metadataChipTextNeutral: {
            color: theme.colors.textSecondary,
        },
        metadataChipTextSuccess: {
            color: theme.colors.success,
        },
        metadataChipTextWarning: {
            color: theme.colors.warning,
        },
        metadataChipTextDanger: {
            color: theme.colors.error,
        },
        footer: {
            paddingHorizontal: theme.spacing.md,
            paddingBottom: theme.spacing.sm,
        },
        footerDivider: {
            height: 1,
            backgroundColor: theme.colors.border,
            marginBottom: theme.spacing.sm,
        },
        footerActions: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: theme.spacing.sm,
        },
        footerItem: {
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 10,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.borderRadius.sm,
            gap: theme.spacing.sm,
        },
        footerItemCompact: {
            flex: 1,
        },
        footerItemPressed: {
            backgroundColor: theme.colors.bgElevated,
        },
        footerItemIcon: {
            width: 16,
            alignItems: "center",
        },
        footerItemText: {
            fontSize: theme.fontSize.md,
            color: theme.colors.textPrimary,
            fontWeight: "400",
        },
        actionMenuOverlay: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: theme.colors.overlay,
            justifyContent: "flex-start",
            paddingHorizontal: theme.spacing.md,
            paddingTop: 72,
        },
        actionMenuCard: {
            width: 260,
            alignSelf: "center",
            maxHeight: 420,
            borderRadius: theme.borderRadius.lg,
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
            overflow: "hidden",
            shadowColor: "#000",
            shadowOpacity: theme.resolvedScheme === "light" ? 0.08 : 0.24,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 14,
        },
        actionMenuHeader: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.sm,
            backgroundColor: theme.colors.bgElevated,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.borderMuted,
        },
        actionMenuHeaderNoDivider: {
            borderBottomWidth: 0,
        },
        actionMenuHeaderLeft: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
        },
        actionMenuIconBadge: {
            width: 30,
            height: 30,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.bgTertiary,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
        },
        actionMenuHeaderText: {
            flex: 1,
            minWidth: 0,
        },
        actionMenuTitle: {
            fontSize: theme.fontSize.base,
            fontWeight: "700",
            color: theme.colors.textPrimary,
        },
        actionMenuSubtitle: {
            marginTop: 2,
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
        },
        actionMenuCloseButton: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.bgTertiary,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
        },
        actionMenuCloseButtonPressed: {
            opacity: 0.82,
        },
        actionMenuList: {
            paddingVertical: theme.spacing.xs,
        },
        actionMenuItem: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 13,
        },
        actionMenuItemPressed: {
            backgroundColor: theme.colors.bgSecondary,
        },
        actionMenuItemIconWrap: {
            width: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
        },
        actionMenuItemIconWrapDanger: {
            opacity: 0.92,
        },
        actionMenuItemText: {
            flex: 1,
            fontSize: theme.fontSize.md,
            fontWeight: "600",
            color: theme.colors.textPrimary,
        },
        actionMenuItemTextDanger: {
            color: theme.colors.error,
        },
        actionMenuSeparator: {
            height: StyleSheet.hairlineWidth,
            marginLeft: theme.spacing.md + 16 + theme.spacing.sm,
            backgroundColor: theme.colors.borderMuted,
        },
        renameOverlay: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: theme.colors.overlay,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: theme.spacing.lg,
        },
        renameKeyboardLayer: {
            width: "100%",
            alignItems: "center",
        },
        renameCard: {
            width: "100%",
            maxWidth: 420,
            borderRadius: theme.borderRadius.lg,
            backgroundColor: theme.colors.bgSecondary,
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
            shadowColor: theme.colors.bg,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
        },
        renameTitle: {
            fontSize: theme.fontSize.base,
            fontWeight: "700",
            color: theme.colors.textPrimary,
        },
        renameSubtitle: {
            fontSize: theme.fontSize.sm,
            color: theme.colors.textSecondary,
            lineHeight: 20,
        },
        renameInput: {
            minHeight: 46,
            borderRadius: theme.borderRadius.sm,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bg,
            color: theme.colors.textPrimary,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 10,
            fontSize: theme.fontSize.base,
        },
        renameActions: {
            flexDirection: "row",
            gap: theme.spacing.sm,
        },
        renameSecondaryButton: {
            flex: 1,
            minHeight: 44,
            borderRadius: theme.borderRadius.sm,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bg,
            alignItems: "center",
            justifyContent: "center",
        },
        renameSecondaryButtonPressed: {
            backgroundColor: theme.colors.bgElevated,
        },
        renameSecondaryButtonText: {
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
            color: theme.colors.textSecondary,
        },
        renamePrimaryButton: {
            flex: 1,
            minHeight: 44,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
        },
        renamePrimaryButtonPressed: {
            backgroundColor: theme.colors.accentPressed,
        },
        renamePrimaryButtonText: {
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
            color: theme.colors.textOnAccent,
        },
    });
}

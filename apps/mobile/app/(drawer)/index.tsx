// Ana sohbet ekranı — mesaj akışı, düşünme, araçlar, izin ve giriş yönetimi

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import {
    View,
    Text,
    Pressable,
    KeyboardAvoidingView,
    Keyboard,
    InteractionManager,
    Platform,
    Modal,
    StyleSheet,
    TouchableWithoutFeedback,
    AppState,
    ActivityIndicator,
    Animated,
    TextInput,
} from "react-native";
import type { NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRouter } from "expo-router";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import type { ParamListBase } from "@react-navigation/native";
import {
    GitBranchIcon,
    DiffIcon,
    MoreVerticalIcon,
    ChevronDownIcon,
    CirclePlusIcon,
    SettingsIcon,
    WifiOffIcon,
    GitHubIcon,
    GitPullRequestIcon,
    GitPushIcon,
    CheckIcon,
} from "../../src/components/ProviderIcon";
import { useSessionStore } from "../../src/stores/session-store";
import type { AgentTodo, ChatItem } from "../../src/stores/session-store-types";
import { useWorkspaceStore } from "../../src/stores/workspace-store";
import { WorkspacePanel } from "../../src/components/WorkspacePanel";
import { useConnectionStore } from "../../src/stores/connection-store";
import { useChatHistoryStore } from "../../src/stores/chat-history-store";
import { ChatMessageItem } from "../../src/components/ChatMessageItem";
import { ChatInput } from "../../src/components/ChatInput";
import type { ImageAttachment, QueuedDraft, SendMode } from "../../src/components/chat-input-types";
import { EmptyChat } from "../../src/components/EmptyChat";
import { ActivityDots } from "../../src/components/ActivityDots";
import { SubagentPanel, type SubagentRun } from "../../src/components/SubagentPanel";
import { TodoPanel } from "../../src/components/TodoPanel";
import { PermissionDialog, PlanExitDialog, UserInputDialog } from "../../src/components/Dialogs";
import { useAppTheme, type AppTheme } from "../../src/theme/theme-context";
import type { SessionConfig, SessionMessageAttachment } from "@copilot-mobile/shared";
import {
    sendMessage,
    abortMessage,
    createSessionWithInitialMessage,
    respondPermission,
    respondUserInput,
    listModels,
    listSessions,
    requestCapabilities,
    requestWorkspaceGitSummary,
    requestSkillsList,
    disconnect,
    commitWorkspace,
    pullWorkspace,
    pushWorkspace,
} from "../../src/services/bridge";
import { startDraftConversation } from "../../src/services/new-chat";
import {
    deriveAgentTodosFromItems,
    getActiveAgentItems,
    getSubagentDisplayName,
    isSubagentToolName,
} from "../../src/utils/tool-introspection";

const CHAT_LIST_DRAW_DISTANCE = 320;

function basename(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? path;
}

function isTaskCompleteTool(toolName: string): boolean {
    return toolName.trim().toLowerCase() === "task_complete";
}

function getChatItemType(item: ChatItem): string {
    if (item.type === "assistant") {
        return item.isStreaming ? "assistant_streaming" : "assistant";
    }

    if (item.type === "thinking") {
        return item.isStreaming ? "thinking_streaming" : "thinking";
    }

    if (item.type !== "tool") {
        return item.type;
    }

    if (isTaskCompleteTool(item.toolName)) {
        return "tool_task_complete";
    }

    if (item.status === "running") {
        return "tool_running";
    }

    if (item.status === "failed") {
        return "tool_failed";
    }

    if (item.status === "no_results") {
        return "tool_no_results";
    }

    if ((item.progressMessages?.length ?? 0) > 0 || item.partialOutput !== undefined) {
        return "tool_detailed";
    }

    return "tool";
}

function buildSubagentRuns(
    currentTurnItems: ReadonlyArray<ChatItem>,
    isAssistantTyping: boolean
): ReadonlyArray<SubagentRun> {
    const runMap = new Map<string, SubagentRun>();

    for (const item of currentTurnItems) {
        if (item.type !== "tool" || !isSubagentToolName(item.toolName)) {
            continue;
        }

        runMap.set(item.requestId, {
            requestId: item.requestId,
            title: getSubagentDisplayName(item),
            status: item.status === "failed"
                ? "failed"
                : isAssistantTyping
                    ? "running"
                    : item.status === "completed" || item.status === "no_results"
                        ? "completed"
                        : "running",
        });
    }

    const runs = [...runMap.values()];
    const hasRunningRun = runs.some((run) => run.status === "running");

    if (hasRunningRun || (isAssistantTyping && runs.length > 0)) {
        return runs;
    }

    return [];
}

function areSubagentRunsEqual(
    left: ReadonlyArray<SubagentRun>,
    right: ReadonlyArray<SubagentRun>
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((run, index) => {
        const candidate = right[index];
        return candidate !== undefined
            && candidate.requestId === run.requestId
            && candidate.title === run.title
            && candidate.status === run.status;
    });
}

function areAgentTodosEqual(
    left: ReadonlyArray<AgentTodo>,
    right: ReadonlyArray<AgentTodo>
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((todo, index) => {
        const candidate = right[index];
        return candidate !== undefined
            && candidate.id === todo.id
            && candidate.content === todo.content
            && candidate.status === todo.status
            && candidate.priority === todo.priority;
    });
}

// Özel başlık — GitHub Copilot mobil stili üst bar
const ChatHeader = React.memo(function ChatHeader() {
    const theme = useAppTheme();
    const headerStyles = useMemo(() => createHeaderStyles(theme), [theme]);
    const navigation = useNavigation<DrawerNavigationProp<ParamListBase>>("/(drawer)");
    const router = useRouter();
    const sessions = useSessionStore((s) => s.sessions);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const conversations = useChatHistoryStore((s) => s.conversations);
    const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
    const connectionState = useConnectionStore((s) => s.state);
    const branch = useWorkspaceStore((s) => s.branch);
    const gitRoot = useWorkspaceStore((s) => s.gitRoot);
    const repository = useWorkspaceStore((s) => s.repository);
    const workspaceRoot = useWorkspaceStore((s) => s.workspaceRoot);
    const workspaceSessionId = useWorkspaceStore((s) => s.sessionId);
    const uncommittedChanges = useWorkspaceStore((s) => s.uncommittedChanges);
    const isCommitting = useWorkspaceStore((s) => s.isCommitting);
    const isPulling = useWorkspaceStore((s) => s.isPulling);
    const isPushing = useWorkspaceStore((s) => s.isPushing);
    const insets = useSafeAreaInsets();
    const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [gitMenuOpen, setGitMenuOpen] = React.useState(false);
    const [gitCommitComposerOpen, setGitCommitComposerOpen] = React.useState(false);
    const [gitCommitMessage, setGitCommitMessage] = React.useState("");
    const handleCloseWorkspace = React.useCallback(() => setWorkspaceOpen(false), []);
    const isConnected = connectionState === "authenticated";

    const handleCloseGitMenu = React.useCallback(() => {
        setGitMenuOpen(false);
        setGitCommitComposerOpen(false);
        setGitCommitMessage("");
        Keyboard.dismiss();
    }, []);

    const handleNewChat = React.useCallback(() => {
        setMenuOpen(false);
        handleCloseGitMenu();
        startDraftConversation(
            workspaceSessionId !== null && workspaceSessionId === activeSessionId ? workspaceRoot : null
        );
    }, [activeSessionId, handleCloseGitMenu, workspaceRoot, workspaceSessionId]);

    const handleOpenSettings = React.useCallback(() => {
        setMenuOpen(false);
        handleCloseGitMenu();
        router.push("/settings");
    }, [handleCloseGitMenu, router]);

    const handleDisconnect = React.useCallback(() => {
        setMenuOpen(false);
        handleCloseGitMenu();
        disconnect();
        router.replace("/scan");
    }, [handleCloseGitMenu, router]);

    const handleOpenWorkspaceChanges = React.useCallback(() => {
        handleCloseGitMenu();
        useWorkspaceStore.getState().setTab("changes");
        setWorkspaceOpen(true);
    }, [handleCloseGitMenu]);

    const activeSession = sessions.find((s) => s.id === activeSessionId);
    const activeConversation = activeConversationId !== null
        ? conversations.find((conversation) => conversation.id === activeConversationId)
        : undefined;
    const draftWorkspaceRoot = activeSessionId === null ? (activeConversation?.workspaceRoot ?? null) : null;
    const hasBoundWorkspaceSession = workspaceSessionId !== null && workspaceSessionId === activeSessionId;
    const hasRepo = hasBoundWorkspaceSession && gitRoot !== null;
    const currentWorkspaceBranch = hasBoundWorkspaceSession ? branch : null;
    const currentWorkspaceRoot = hasBoundWorkspaceSession ? workspaceRoot : null;
    const currentRepository = hasBoundWorkspaceSession ? repository : null;
    const hasGitContext =
        (hasBoundWorkspaceSession && repository !== null)
        || activeSession?.context?.gitRoot !== undefined;
    const branchName =
        currentWorkspaceBranch
        ?? activeSession?.context?.branch
        ?? (draftWorkspaceRoot !== null ? "new chat" : (hasGitContext ? "main" : "workspace"));
    const repoName = currentWorkspaceRoot !== null
        ? basename(currentWorkspaceRoot)
        : draftWorkspaceRoot !== null
            ? basename(draftWorkspaceRoot)
        : activeSession?.context?.workspaceRoot !== undefined
            ? basename(activeSession.context.workspaceRoot)
            : currentRepository ?? "workspace";
    const summaryChanges = hasBoundWorkspaceSession ? uncommittedChanges : [];
    const changeTotals = useMemo(() => (
        summaryChanges.reduce(
            (totals, change) => ({
                additions: totals.additions + (change.additions ?? 0),
                deletions: totals.deletions + (change.deletions ?? 0),
            }),
            { additions: 0, deletions: 0 },
        )
    ), [summaryChanges]);
    const hasVisibleDiffTotals = changeTotals.additions > 0 || changeTotals.deletions > 0;
    const gitActionBusy = isCommitting || isPulling || isPushing;
    const canOpenGitMenu = hasRepo && isConnected;
    const canCommit = canOpenGitMenu && uncommittedChanges.length > 0;

    const handleToggleGitMenu = React.useCallback(() => {
        if (!canOpenGitMenu) {
            return;
        }

        setMenuOpen(false);
        setWorkspaceOpen(false);
        setGitMenuOpen((value) => !value);
        setGitCommitComposerOpen(false);
        setGitCommitMessage("");
    }, [canOpenGitMenu]);

    const handleOpenGitCommitComposer = React.useCallback(() => {
        if (!canCommit || isCommitting) {
            return;
        }

        setGitCommitComposerOpen(true);
    }, [canCommit, isCommitting]);

    const handleCancelGitCommitComposer = React.useCallback(() => {
        setGitCommitComposerOpen(false);
        setGitCommitMessage("");
        Keyboard.dismiss();
    }, []);

    const handleSubmitGitCommit = React.useCallback(() => {
        const trimmedMessage = gitCommitMessage.trim();
        if (trimmedMessage.length === 0 || activeSessionId === null || !canCommit || isCommitting) {
            return;
        }

        void commitWorkspace(activeSessionId, trimmedMessage);
        handleCloseGitMenu();
    }, [activeSessionId, canCommit, gitCommitMessage, handleCloseGitMenu, isCommitting]);

    const handleGitPull = React.useCallback(() => {
        if (activeSessionId === null || !canOpenGitMenu || isPulling) {
            return;
        }

        void pullWorkspace(activeSessionId);
        handleCloseGitMenu();
    }, [activeSessionId, canOpenGitMenu, handleCloseGitMenu, isPulling]);

    const handleGitPush = React.useCallback(() => {
        if (activeSessionId === null || !canOpenGitMenu || isPushing) {
            return;
        }

        void pushWorkspace(activeSessionId);
        handleCloseGitMenu();
    }, [activeSessionId, canOpenGitMenu, handleCloseGitMenu, isPushing]);

    React.useEffect(() => {
        if (!isConnected || activeSessionId === null) {
            return;
        }

        void requestWorkspaceGitSummary(activeSessionId, 10);
    }, [activeSessionId, isConnected]);

    React.useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") {
                return;
            }

            setMenuOpen(false);
            handleCloseGitMenu();
            setWorkspaceOpen(false);
        });

        return () => {
            subscription.remove();
        };
    }, [handleCloseGitMenu]);

    React.useEffect(() => {
        handleCloseGitMenu();
        setWorkspaceOpen(false);
        setMenuOpen(false);
    }, [activeSessionId, handleCloseGitMenu]);

    return (
        <>
            <View style={headerStyles.container}>
                <Pressable
                    style={headerStyles.menuButton}
                    onPress={() => navigation.openDrawer()}
                    hitSlop={12}
                >
                    <View style={headerStyles.menuLine} />
                    <View style={[headerStyles.menuLine, headerStyles.menuLineShort]} />
                    <View style={headerStyles.menuLine} />
                </Pressable>

                <Pressable
                    style={({ pressed }) => [
                        headerStyles.branchContainer,
                        pressed && headerStyles.branchContainerPressed,
                    ]}
                    onPress={handleOpenWorkspaceChanges}
                    hitSlop={8}
                    accessibilityLabel="Open workspace branch menu"
                >
                    <View style={headerStyles.branchRow}>
                        <GitBranchIcon size={12} color={theme.colors.textTertiary} />
                        <Text style={headerStyles.branchText} numberOfLines={1}>{branchName}</Text>
                        <ChevronDownIcon size={11} color={theme.colors.textTertiary} />
                    </View>
                    <Text style={headerStyles.repoText} numberOfLines={1}>{repoName}</Text>
                </Pressable>

                <View style={headerStyles.rightContainer}>
                    <Pressable
                        style={({ pressed }) => [
                            headerStyles.changesButton,
                            pressed && headerStyles.iconButtonPressed,
                        ]}
                        onPress={() => setWorkspaceOpen(true)}
                        hitSlop={10}
                        accessibilityLabel="Open workspace changes"
                    >
                        <DiffIcon size={17} color={theme.colors.textSecondary} />
                        <Text style={headerStyles.diffButtonText}>Diff</Text>
                        {hasVisibleDiffTotals && (
                            <View style={headerStyles.diffTotals}>
                                <Text style={headerStyles.diffAddText}>+{changeTotals.additions}</Text>
                                <Text style={headerStyles.diffDeleteText}>-{changeTotals.deletions}</Text>
                            </View>
                        )}
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [
                            headerStyles.gitButton,
                            gitMenuOpen && headerStyles.iconButtonActive,
                            !canOpenGitMenu && headerStyles.iconButtonDisabled,
                            pressed && canOpenGitMenu && headerStyles.iconButtonPressed,
                        ]}
                        onPress={handleToggleGitMenu}
                        hitSlop={10}
                        accessibilityLabel="Open Git actions"
                        disabled={!canOpenGitMenu}
                    >
                        {gitActionBusy ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <GitHubIcon size={15} color={theme.colors.textSecondary} />
                        )}
                        <Text style={headerStyles.gitButtonText}>Git</Text>
                        <ChevronDownIcon size={11} color={theme.colors.textTertiary} />
                    </Pressable>
                    <Pressable
                        style={headerStyles.iconButton}
                        onPress={() => {
                            handleCloseGitMenu();
                            setMenuOpen(true);
                        }}
                        hitSlop={10}
                        accessibilityLabel="More options"
                    >
                        <MoreVerticalIcon size={17} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            </View>

            <WorkspacePanel
                visible={workspaceOpen}
                onClose={handleCloseWorkspace}
            />

            <Modal
                visible={menuOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setMenuOpen(false)}
            >
                <Pressable
                    style={[headerStyles.menuOverlay, { paddingTop: insets.top + 64 }]}
                    onPress={() => setMenuOpen(false)}
                >
                    <Pressable
                        style={headerStyles.menuCard}
                        onPress={(e) => e.stopPropagation()}
                    >
                        <Pressable style={headerStyles.menuItem} onPress={handleNewChat}>
                            <CirclePlusIcon size={16} color={theme.colors.textSecondary} />
                            <Text style={headerStyles.menuItemText}>New chat</Text>
                        </Pressable>
                        <View style={headerStyles.menuSep} />
                        <Pressable style={headerStyles.menuItem} onPress={handleOpenSettings}>
                            <SettingsIcon size={16} color={theme.colors.textSecondary} />
                            <Text style={headerStyles.menuItemText}>Settings</Text>
                        </Pressable>
                        <View style={headerStyles.menuSep} />
                        <Pressable style={headerStyles.menuItem} onPress={handleDisconnect}>
                            <WifiOffIcon size={16} color={theme.colors.error} />
                            <Text style={[headerStyles.menuItemText, headerStyles.menuItemDanger]}>
                                Disconnect
                            </Text>
                        </Pressable>
                    </Pressable>
                </Pressable>
            </Modal>

            <Modal
                visible={gitMenuOpen}
                transparent
                animationType="fade"
                onRequestClose={handleCloseGitMenu}
            >
                <Pressable
                    style={[headerStyles.menuOverlay, headerStyles.gitMenuOverlay, { paddingTop: insets.top + 64 }]}
                    onPress={handleCloseGitMenu}
                >
                    <Pressable
                        style={headerStyles.gitMenuCard}
                        onPress={(e) => e.stopPropagation()}
                    >
                        <Pressable
                            style={({ pressed }) => [
                                headerStyles.menuItem,
                                (!canCommit || isCommitting) && headerStyles.menuItemDisabled,
                                pressed && canCommit && !isCommitting && headerStyles.menuItemPressed,
                            ]}
                            onPress={handleOpenGitCommitComposer}
                            disabled={!canCommit || isCommitting}
                        >
                            <GitHubIcon size={16} color={theme.colors.textSecondary} />
                            <Text style={headerStyles.menuItemText}>
                                {isCommitting ? "Committing…" : "Commit"}
                            </Text>
                        </Pressable>
                        <View style={headerStyles.menuSep} />
                        <Pressable
                            style={({ pressed }) => [
                                headerStyles.menuItem,
                                isPulling && headerStyles.menuItemDisabled,
                                pressed && !isPulling && headerStyles.menuItemPressed,
                            ]}
                            onPress={handleGitPull}
                            disabled={isPulling}
                        >
                            <GitPullRequestIcon size={15} color={theme.colors.textSecondary} />
                            <Text style={headerStyles.menuItemText}>
                                {isPulling ? "Pulling…" : "Pull"}
                            </Text>
                        </Pressable>
                        <View style={headerStyles.menuSep} />
                        <Pressable
                            style={({ pressed }) => [
                                headerStyles.menuItem,
                                isPushing && headerStyles.menuItemDisabled,
                                pressed && !isPushing && headerStyles.menuItemPressed,
                            ]}
                            onPress={handleGitPush}
                            disabled={isPushing}
                        >
                            <GitPushIcon size={15} color={theme.colors.textSecondary} />
                            <Text style={headerStyles.menuItemText}>
                                {isPushing ? "Pushing…" : "Push"}
                            </Text>
                        </Pressable>

                        {gitCommitComposerOpen && (
                            <>
                                <View style={headerStyles.menuSep} />
                                <View style={headerStyles.gitComposer}>
                                    <Text style={headerStyles.gitComposerTitle}>Create commit</Text>
                                    <Text style={headerStyles.gitComposerHint}>
                                        All workspace changes will be staged together.
                                    </Text>
                                    <TextInput
                                        style={headerStyles.gitComposerInput}
                                        value={gitCommitMessage}
                                        onChangeText={setGitCommitMessage}
                                        placeholder="Commit message"
                                        placeholderTextColor={theme.colors.textTertiary}
                                        returnKeyType="done"
                                        onSubmitEditing={handleSubmitGitCommit}
                                        editable={!isCommitting}
                                    />
                                    <View style={headerStyles.gitComposerActions}>
                                        <Pressable
                                            style={({ pressed }) => [
                                                headerStyles.gitComposerSecondaryButton,
                                                pressed && headerStyles.iconButtonPressed,
                                            ]}
                                            onPress={handleCancelGitCommitComposer}
                                        >
                                            <Text style={headerStyles.gitComposerSecondaryText}>Cancel</Text>
                                        </Pressable>
                                        <Pressable
                                            style={({ pressed }) => [
                                                headerStyles.gitComposerPrimaryButton,
                                                (gitCommitMessage.trim().length === 0 || isCommitting) && headerStyles.iconButtonDisabled,
                                                pressed && gitCommitMessage.trim().length > 0 && !isCommitting && headerStyles.iconButtonPressed,
                                            ]}
                                            onPress={handleSubmitGitCommit}
                                            disabled={gitCommitMessage.trim().length === 0 || isCommitting}
                                        >
                                            <Text style={headerStyles.gitComposerPrimaryText}>
                                                {isCommitting ? "Saving…" : "Commit now"}
                                            </Text>
                                        </Pressable>
                                    </View>
                                </View>
                            </>
                        )}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
});

const WorkspaceOperationToast = React.memo(function WorkspaceOperationToast() {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const operationMessage = useWorkspaceStore((s) => s.operationMessage);
    const [visibleMessage, setVisibleMessage] = useState<string | null>(null);
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(-10)).current;
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current !== null) {
                clearTimeout(hideTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (operationMessage === null) {
            return;
        }

        if (hideTimeoutRef.current !== null) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
        }

        setVisibleMessage(operationMessage);
        opacity.stopAnimation();
        translateY.stopAnimation();
        opacity.setValue(0);
        translateY.setValue(-10);

        Animated.parallel([
            Animated.timing(opacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 0,
                duration: 180,
                useNativeDriver: true,
            }),
        ]).start();

        hideTimeoutRef.current = setTimeout(() => {
            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 0,
                    duration: 220,
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: -8,
                    duration: 220,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setVisibleMessage((current) => (current === operationMessage ? null : current));
            });
        }, 3_000);
    }, [opacity, operationMessage, translateY]);

    if (visibleMessage === null) {
        return null;
    }

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                styles.workspaceToast,
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            <View style={styles.workspaceToastIcon}>
                <CheckIcon size={15} color={theme.colors.success} />
            </View>
            <View style={styles.workspaceToastContent}>
                <Text style={styles.workspaceToastLabel}>Repository updated</Text>
                <Text style={styles.workspaceToastText} numberOfLines={2}>
                    {visibleMessage}
                </Text>
            </View>
        </Animated.View>
    );
});

const MAX_TOTAL_ATTACHMENT_BASE64_CHARS = 700_000;
const STREAMING_PERSIST_DELAY_MS = 5_000;
const TYPING_PERSIST_DELAY_MS = 2_200;
const IDLE_PERSIST_DELAY_MS = 1_200;

function toSessionMessageAttachments(
    images: ReadonlyArray<ImageAttachment>
): ReadonlyArray<SessionMessageAttachment> | undefined {
    if (images.length === 0) {
        return undefined;
    }

    return images.map((image) => ({
        type: "blob",
        data: image.base64Data,
        mimeType: image.mimeType,
        displayName: image.fileName,
    }));
}

export default function ChatScreen() {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const flatListRef = useRef<FlashListRef<ChatItem>>(null);
    const isNearBottomRef = useRef(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [queuedDrafts, setQueuedDrafts] = useState<Array<QueuedDraft>>([]);
    const [editingDraft, setEditingDraft] = useState<QueuedDraft | null>(null);
    const prevSessionIdRef = useRef<string | null>(null);
    const autoSentQueuedDraftIdRef = useRef<string | null>(null);
    const persistChatItemsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistInteractionRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
    const stableSubagentRunsRef = useRef<ReadonlyArray<SubagentRun>>([]);
    const stableAgentTodosRef = useRef<ReadonlyArray<AgentTodo>>([]);
    const stablePanelSessionIdRef = useRef<string | null>(null);

    // Store'lardan state
    const chatItems = useSessionStore((s) => s.chatItems);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const sessions = useSessionStore((s) => s.sessions);
    const isSessionLoading = useSessionStore((s) => s.isSessionLoading);
    const isTyping = useSessionStore((s) => s.isAssistantTyping);
    const isAbortPending = useSessionStore((s) => s.isAbortRequested);
    const busySessions = useSessionStore((s) => s.busySessions);
    const chatCurrentIntent = useSessionStore((s) => s.currentIntent);
    const models = useSessionStore((s) => s.models);
    const selectedModel = useSessionStore((s) => s.selectedModel);
    const reasoningEffort = useSessionStore((s) => s.reasoningEffort);
    const agentMode = useSessionStore((s) => s.agentMode);
    const permissionLevel = useSessionStore((s) => s.permissionLevel);
    const permissionPrompt = useSessionStore((s) => s.permissionPrompt);
    const userInputPrompt = useSessionStore((s) => s.userInputPrompt);
    const planExitPrompt = useSessionStore((s) => s.planExitPrompt);
    const agentTodos = useSessionStore((s) => s.agentTodos);
    const setAbortRequested = useSessionStore((s) => s.setAbortRequested);
    const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
    const workspaceSessionId = useWorkspaceStore((s) => s.sessionId);
    const workspaceRoot = useWorkspaceStore((s) => s.workspaceRoot);

    if (stablePanelSessionIdRef.current !== activeSessionId) {
        stablePanelSessionIdRef.current = activeSessionId;
        stableSubagentRunsRef.current = [];
        stableAgentTodosRef.current = [];
    }

    const connectionState = useConnectionStore((s) => s.state);
    const connectionError = useConnectionStore((s) => s.error);
    const isConnected = connectionState === "authenticated";
    const isConnecting =
        connectionState === "connecting" || connectionState === "connected";
    const inputDisabled = !isConnected || isSessionLoading;
    const isActiveSessionBusy = activeSessionId !== null && busySessions[activeSessionId] === true;
    const visibleQueuedDrafts = queuedDrafts.filter((draft) => draft.sessionId === activeSessionId);
    const activeAgentItems = useMemo(
        () => getActiveAgentItems(chatItems, isTyping),
        [chatItems, isTyping],
    );
    const subagentRunsSignature = useMemo(() => (
        activeAgentItems
            .filter((item): item is Extract<ChatItem, { type: "tool" }> =>
                item.type === "tool" && isSubagentToolName(item.toolName)
            )
            .map((item) => `${item.requestId}:${item.status}:${item.toolName}:${item.argumentsText ?? ""}`)
            .join("|")
    ), [activeAgentItems]);
    const nextSubagentRuns = useMemo(
        () => buildSubagentRuns(activeAgentItems, isTyping),
        [isTyping, subagentRunsSignature],
    );
    if (!areSubagentRunsEqual(stableSubagentRunsRef.current, nextSubagentRuns)) {
        stableSubagentRunsRef.current = nextSubagentRuns;
    }
    const subagentRuns = stableSubagentRunsRef.current;
    const hasRunningToolInCurrentTurn = useMemo(
        () => activeAgentItems.some((item) => item.type === "tool" && item.status === "running"),
        [activeAgentItems],
    );
    const nextVisibleAgentTodos = useMemo(() => {
        const hasActiveTurn = isActiveSessionBusy || isTyping || hasRunningToolInCurrentTurn;
        if (!hasActiveTurn) {
            return [];
        }

        const derivedTodos = deriveAgentTodosFromItems(activeAgentItems);
        if (derivedTodos.length > 0) {
            return derivedTodos;
        }

        return agentTodos;
    }, [activeAgentItems, agentTodos, hasRunningToolInCurrentTurn, isActiveSessionBusy, isTyping]);
    if (!areAgentTodosEqual(stableAgentTodosRef.current, nextVisibleAgentTodos)) {
        stableAgentTodosRef.current = nextVisibleAgentTodos;
    }
    const visibleAgentTodos = stableAgentTodosRef.current;

    useEffect(() => {
        if (permissionPrompt !== null || userInputPrompt !== null || planExitPrompt !== null) {
            Keyboard.dismiss();
        }
    }, [permissionPrompt, userInputPrompt, planExitPrompt]);

    useEffect(() => {
        if (isConnected) {
            listSessions();
            listModels();
            requestCapabilities();
            requestSkillsList();
        }
    }, [isConnected]);

    useEffect(() => {
        if (activeConversationId === null) {
            return;
        }

        if (persistChatItemsTimeoutRef.current !== null) {
            clearTimeout(persistChatItemsTimeoutRef.current);
        }

        if (persistInteractionRef.current !== null) {
            persistInteractionRef.current.cancel();
            persistInteractionRef.current = null;
        }

        const hasStreamingContent = chatItems.some((item) => (
            (item.type === "assistant" || item.type === "thinking") && item.isStreaming
        )) || chatItems.some((item) => item.type === "tool" && item.status === "running");

        const persistDelay = hasStreamingContent
            ? STREAMING_PERSIST_DELAY_MS
            : isTyping
                ? TYPING_PERSIST_DELAY_MS
                : IDLE_PERSIST_DELAY_MS;

        persistChatItemsTimeoutRef.current = setTimeout(() => {
            persistInteractionRef.current = InteractionManager.runAfterInteractions(() => {
                useChatHistoryStore.getState().setConversationItems(activeConversationId, chatItems);
                persistInteractionRef.current = null;
            });
            persistChatItemsTimeoutRef.current = null;
        }, persistDelay);

        return () => {
            if (persistChatItemsTimeoutRef.current !== null) {
                clearTimeout(persistChatItemsTimeoutRef.current);
                persistChatItemsTimeoutRef.current = null;
            }
            if (persistInteractionRef.current !== null) {
                persistInteractionRef.current.cancel();
                persistInteractionRef.current = null;
            }
        };
    }, [activeConversationId, chatItems, isTyping]);

    useEffect(() => {
        if (!isConnected) {
            useSessionStore.getState().setSessionLoading(false);
        }
    }, [isConnected]);

    useEffect(() => {
        if (connectionError !== null) {
            useSessionStore.getState().setSessionLoading(false);
            useSessionStore.getState().setAssistantTyping(false);
        }
    }, [activeSessionId, connectionError]);

    // When the active session changes, jump to the newest content once.
    useEffect(() => {
        if (prevSessionIdRef.current !== activeSessionId) {
            prevSessionIdRef.current = activeSessionId;
            isNearBottomRef.current = true;
            setShowScrollToBottom(false);
            const tid = setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: false });
            }, 60);
            return () => clearTimeout(tid);
        }
    }, [activeSessionId]);

    useEffect(() => {
        if (!isNearBottomRef.current) {
            return;
        }

        const tid = setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: isTyping });
        }, 40);

        return () => clearTimeout(tid);
    }, [chatItems, isTyping]);

    // Track scroll position so the list only auto-follows while the user stays near the bottom.
    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
        const nearBottom = distanceFromBottom < 100;
        isNearBottomRef.current = nearBottom;
        setShowScrollToBottom(!nearBottom && distanceFromBottom > 250);
    }, []);

    const handleScrollToBottom = useCallback(() => {
        isNearBottomRef.current = true;
        setShowScrollToBottom(false);
        flatListRef.current?.scrollToEnd({ animated: true });
    }, []);

    const enableAutoFollow = useCallback(() => {
        isNearBottomRef.current = true;
        setShowScrollToBottom(false);
    }, []);

    const handleBackgroundPress = useCallback(() => {
        Keyboard.dismiss();
    }, []);

    // Send message
    const handleSend = useCallback(
        (content: string, images: ReadonlyArray<ImageAttachment>, mode: SendMode) => {
            const attachments = toSessionMessageAttachments(images);
            const totalAttachmentChars = images.reduce(
                (sum, image) => sum + image.base64Data.length,
                0
            );

            if (totalAttachmentChars > MAX_TOTAL_ATTACHMENT_BASE64_CHARS) {
                useConnectionStore.getState().setError(
                    "Seçilen görseller bridge aktarım limitini aşıyor. Daha küçük veya daha az görsel seçin."
                );
                return;
            }

            enableAutoFollow();

            // "steer" mode sends inline without interrupting assistant
            if (mode === "steer" && activeSessionId !== null) {
                sendMessage(activeSessionId, content, attachments);
                return;
            }

            if (mode === "queue") {
                setQueuedDrafts((prev) => [
                    ...prev,
                    {
                        id: `queued-${Date.now()}-${prev.length + 1}`,
                        sessionId: activeSessionId,
                        content,
                        images: [...images],
                    },
                ]);
                return;
            }

            const hasBlockingTurn = activeSessionId !== null && (
                isActiveSessionBusy
                || isTyping
                || permissionPrompt !== null
                || userInputPrompt !== null
                || planExitPrompt !== null
            );

            if (mode === "send" && hasBlockingTurn && activeSessionId !== null) {
                setQueuedDrafts((prev) => [
                    ...prev,
                    {
                        id: `queued-${Date.now()}-${prev.length + 1}`,
                        sessionId: activeSessionId,
                        content,
                        images: [...images],
                    },
                ]);
                if (!isAbortPending) {
                    setAbortRequested(true);
                    void abortMessage(activeSessionId).catch(() => {
                        useSessionStore.getState().setAbortRequested(false);
                    });
                }
                return;
            }

            const historyStore = useChatHistoryStore.getState();
            const previousActiveConversationId = historyStore.activeConversationId;
            const activeSession = sessions.find((session) => session.id === activeSessionId);
            const workspaceRootForConversation =
                activeSessionId !== null && workspaceSessionId === activeSessionId
                    ? workspaceRoot
                    : activeSession?.context?.workspaceRoot ?? null;
            const activeConversationId =
                previousActiveConversationId
                ?? historyStore.createConversation(activeSessionId, workspaceRootForConversation);
            const conversation = previousActiveConversationId === null
                ? undefined
                : historyStore.conversations.find(
                    (item) => item.id === previousActiveConversationId
                );
            const shouldUpdateConversation =
                previousActiveConversationId === null ||
                (conversation !== undefined && conversation.title === "New Chat");

            if (shouldUpdateConversation) {
                const title =
                    content.length > 40
                        ? content.slice(0, 40) + "..."
                        : content;
                historyStore.updateConversation(activeConversationId, title, content);
            }

            if (activeSessionId === null) {
                const store = useSessionStore.getState();
                const requestedModelId = models.some((model) => model.id === selectedModel)
                    ? selectedModel
                    : models[0]?.id ?? selectedModel;
                const requestedModel = models.find((m) => m.id === requestedModelId);
                const draftWorkspaceRoot = historyStore.conversations.find(
                    (conversationItem) => conversationItem.id === activeConversationId
                )?.workspaceRoot ?? null;
                const localItemId = store.addUserMessage(content, attachments);
                store.setSessionLoading(true);
                store.setAssistantTyping(true);
                const config: SessionConfig = {
                    model: requestedModelId,
                    streaming: true,
                    agentMode,
                    permissionLevel,
                    ...(draftWorkspaceRoot !== null ? { workspaceRoot: draftWorkspaceRoot } : {}),
                };
                if (
                    requestedModel?.supportsReasoningEffort === true &&
                    reasoningEffort !== null
                ) {
                    config.reasoningEffort = reasoningEffort;
                }
                void createSessionWithInitialMessage(
                    config,
                    attachments !== undefined && attachments.length > 0
                        ? { prompt: content, attachments }
                        : { prompt: content }
                )
                    .then(() => {
                        store.updateUserMessageDeliveryState(localItemId, "sent");
                    })
                    .catch(() => {
                        store.updateUserMessageDeliveryState(localItemId, "failed");
                        store.setAssistantTyping(false);
                    });
                return;
            }

            sendMessage(activeSessionId, content, attachments);
        },
        [
            activeSessionId,
            agentMode,
            enableAutoFollow,
            isActiveSessionBusy,
            isAbortPending,
            isTyping,
            models,
            permissionPrompt,
            permissionLevel,
            planExitPrompt,
            reasoningEffort,
            selectedModel,
            setAbortRequested,
            sessions,
            userInputPrompt,
            workspaceRoot,
            workspaceSessionId,
        ]
    );

    // Abort message
    const handleAbort = useCallback(() => {
        if (activeSessionId !== null && !isAbortPending) {
            setAbortRequested(true);
            void abortMessage(activeSessionId).catch(() => {
                useSessionStore.getState().setAbortRequested(false);
            });
        }
    }, [activeSessionId, isAbortPending, setAbortRequested]);

    const handleEditQueuedDraft = useCallback((draftId: string) => {
        const draft = queuedDrafts.find((item) => item.id === draftId) ?? null;
        if (draft !== null) {
            setEditingDraft(draft);
        }
        setQueuedDrafts((prev) => prev.filter((item) => item.id !== draftId));
    }, [queuedDrafts]);

    const handleRemoveQueuedDraft = useCallback((draftId: string) => {
        setQueuedDrafts((prev) => prev.filter((item) => item.id !== draftId));
    }, []);

    const handleSteerQueuedDraft = useCallback((draftId: string) => {
        const draft = queuedDrafts.find((item) => item.id === draftId);
        if (draft === undefined || inputDisabled || draft.sessionId !== activeSessionId) {
            return;
        }

        handleSend(draft.content, draft.images, "steer");
        setQueuedDrafts((prev) => prev.filter((item) => item.id !== draftId));
    }, [activeSessionId, handleSend, inputDisabled, queuedDrafts]);

    const handleEditingDraftConsumed = useCallback(() => {
        setEditingDraft(null);
    }, []);

    useEffect(() => {
        if (
            activeSessionId === null
            || isActiveSessionBusy
            || isTyping
            || inputDisabled
            || isAbortPending
            || permissionPrompt !== null
            || userInputPrompt !== null
            || planExitPrompt !== null
        ) {
            return;
        }

        const nextDraft = queuedDrafts.find((draft) => draft.sessionId === activeSessionId);
        if (nextDraft === undefined) {
            autoSentQueuedDraftIdRef.current = null;
            return;
        }

        if (autoSentQueuedDraftIdRef.current === nextDraft.id) {
            return;
        }

        autoSentQueuedDraftIdRef.current = nextDraft.id;
        handleSend(nextDraft.content, nextDraft.images, "send");
        setQueuedDrafts((prev) => prev.filter((draft) => draft.id !== nextDraft.id));
    }, [
        activeSessionId,
        handleSend,
        isActiveSessionBusy,
        inputDisabled,
        isAbortPending,
        isTyping,
        permissionPrompt,
        planExitPrompt,
        queuedDrafts,
        userInputPrompt,
    ]);

    // Respond to permission
    const handlePermissionRespond = useCallback(
        (requestId: string, approved: boolean) => {
            respondPermission(requestId, approved);
        },
        []
    );

    // User input response
    const handleUserInputRespond = useCallback(
        (requestId: string, value: string) => {
            respondUserInput(requestId, value);
        },
        []
    );

    const activityFooter = useMemo(
        () => <ActivityDots active={isTyping} intent={chatCurrentIntent} />,
        [chatCurrentIntent, isTyping]
    );

    // Chat list renders
    const renderItem = useCallback(
        ({ item }: { item: ChatItem }) => <ChatMessageItem item={item} />,
        []
    );

    const keyExtractor = useCallback((item: ChatItem) => item.id, []);

    return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
            <View style={styles.headerStack}>
                <ChatHeader />
                <WorkspaceOperationToast />
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                keyboardVerticalOffset={0}
            >
                <TouchableWithoutFeedback
                    accessible={false}
                    onPress={handleBackgroundPress}
                >
                    <View style={styles.flex}>
                        {chatItems.length === 0 ? (
                            <EmptyChat
                                isConnected={isConnected}
                                isConnecting={isConnecting}
                                onSuggestionPress={(text) => {
                                    handleSend(text, [], "send");
                                }}
                            />
                        ) : (
                            <View style={styles.flex}>
                                <FlashList
                                    ref={flatListRef}
                                    data={chatItems as ChatItem[]}
                                    renderItem={renderItem}
                                    keyExtractor={keyExtractor}
                                    getItemType={getChatItemType}
                                    style={styles.messageList}
                                    contentContainerStyle={styles.messageListContent}
                                    onScroll={handleScroll}
                                    onScrollBeginDrag={handleBackgroundPress}
                                    scrollEventThrottle={32}
                                    canCancelContentTouches
                                    keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                                    keyboardShouldPersistTaps="always"
                                    ListFooterComponent={activityFooter}
                                    drawDistance={CHAT_LIST_DRAW_DISTANCE}
                                />
                                {showScrollToBottom && (
                                    <Pressable
                                        style={styles.scrollToBottomBtn}
                                        onPress={handleScrollToBottom}
                                    >
                                        <ChevronDownIcon size={16} color={theme.colors.textPrimary} />
                                    </Pressable>
                                )}
                            </View>
                        )}
                    </View>
                </TouchableWithoutFeedback>

                {/* Permission and input dialogs */}
                {permissionPrompt !== null && (
                    <PermissionDialog
                        prompt={permissionPrompt}
                        onRespond={handlePermissionRespond}
                    />
                )}
                {userInputPrompt !== null && (
                    <UserInputDialog
                        prompt={userInputPrompt}
                        onRespond={handleUserInputRespond}
                    />
                )}
                {planExitPrompt !== null && (
                    <PlanExitDialog
                        prompt={planExitPrompt}
                    />
                )}

                {connectionError !== null && (
                    <View style={styles.errorBanner}>
                        <Text style={styles.errorBannerText}>{connectionError}</Text>
                    </View>
                )}

                {subagentRuns.length > 0 && (
                    <SubagentPanel runs={subagentRuns} />
                )}

                {visibleAgentTodos.length > 0 && (
                    <TodoPanel todos={visibleAgentTodos} />
                )}

                <ChatInput
                    onSend={handleSend}
                    onAbort={handleAbort}
                    isTyping={isTyping}
                    isAbortPending={isAbortPending}
                    disabled={inputDisabled}
                    queuedDrafts={visibleQueuedDrafts}
                    editingDraft={editingDraft}
                    onEditingDraftConsumed={handleEditingDraftConsumed}
                    onEditQueuedDraft={handleEditQueuedDraft}
                    onRemoveQueuedDraft={handleRemoveQueuedDraft}
                    onSteerQueuedDraft={handleSteerQueuedDraft}
                />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

// Başlık stilleri — GitHub Copilot mobil stili
function createHeaderStyles(theme: AppTheme) {
return StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        backgroundColor: theme.colors.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.borderMuted,
    },
    menuButton: {
        width: 36,
        height: 36,
        justifyContent: "center",
        alignItems: "center",
        gap: 5,
    },
    menuLine: {
        width: 18,
        height: 1.5,
        borderRadius: 1,
        backgroundColor: theme.colors.textSecondary,
    },
    menuLineShort: {
        width: 12,
    },
    branchContainer: {
        flex: 1,
        paddingLeft: theme.spacing.sm,
    },
    branchContainerPressed: {
        opacity: 0.78,
    },
    branchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    branchText: {
        fontSize: 14,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    repoText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textTertiary,
        marginTop: 1,
    },
    rightContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    iconButtonActive: {
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bgElevated,
    },
    iconButtonDisabled: {
        opacity: 0.5,
    },
    iconButton: {
        width: 34,
        height: 34,
        justifyContent: "center",
        alignItems: "center",
    },
    iconButtonPressed: {
        opacity: 0.75,
    },
    changesButton: {
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.bgSecondary,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    gitButton: {
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.bgSecondary,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    gitButtonText: {
        fontSize: theme.fontSize.xs,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    diffTotals: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    diffButtonText: {
        fontSize: theme.fontSize.xs,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    diffAddText: {
        fontSize: theme.fontSize.xs,
        fontWeight: "700",
        color: theme.colors.success,
    },
    diffDeleteText: {
        fontSize: theme.fontSize.xs,
        fontWeight: "700",
        color: theme.colors.error,
    },
    menuOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.35)",
        paddingTop: 56,
        paddingRight: theme.spacing.md,
        alignItems: "flex-end",
    }, // paddingTop overridden inline with insets.top + 64
    gitMenuOverlay: {
        paddingRight: theme.spacing.xl + 8,
    },
    menuCard: {
        minWidth: 180,
        backgroundColor: theme.colors.bgElevated,
        borderRadius: theme.borderRadius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.borderMuted,
        overflow: "hidden",
    },
    menuItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 12,
    },
    menuItemPressed: {
        backgroundColor: theme.colors.bgSecondary,
    },
    menuItemDisabled: {
        opacity: 0.58,
    },
    menuItemText: {
        fontSize: theme.fontSize.md,
        color: theme.colors.textPrimary,
    },
    menuItemDanger: {
        color: theme.colors.error,
    },
    gitMenuCard: {
        minWidth: 232,
        maxWidth: 280,
        backgroundColor: theme.colors.bgElevated,
        borderRadius: theme.borderRadius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: theme.resolvedScheme === "light" ? 0.08 : 0.26,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    gitMenuHeader: {
        gap: 5,
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        backgroundColor: theme.colors.bgSecondary,
    },
    gitMenuTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    gitMenuTitle: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    gitMenuSubtitle: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
    },
    gitComposer: {
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md,
    },
    gitComposerTitle: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    gitComposerHint: {
        fontSize: theme.fontSize.xs,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    gitComposerInput: {
        minHeight: 42,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
        paddingHorizontal: theme.spacing.md,
        color: theme.colors.textPrimary,
        fontSize: theme.fontSize.md,
    },
    gitComposerActions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: theme.spacing.sm,
    },
    gitComposerSecondaryButton: {
        minHeight: 34,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: theme.borderRadius.full,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.bgSecondary,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    gitComposerSecondaryText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: theme.colors.textSecondary,
    },
    gitComposerPrimaryButton: {
        minHeight: 34,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: theme.borderRadius.full,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.textPrimary,
    },
    gitComposerPrimaryText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.bg,
    },
    menuSep: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.borderMuted,
    },
});
}

// Ana ekran stilleri — GitHub Copilot koyu tema
function createStyles(theme: AppTheme) {
return StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.bg,
    },
    headerStack: {
        position: "relative",
        zIndex: 12,
    },
    flex: {
        flex: 1,
    },
    messageList: {
        flex: 1,
    },
    messageListContent: {
        paddingVertical: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
    },
    errorBanner: {
        marginHorizontal: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 10,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.errorMuted,
        backgroundColor: theme.colors.errorBackground,
    },
    errorBannerText: {
        fontSize: theme.fontSize.md,
        lineHeight: 18,
        color: theme.colors.error,
    },
    workspaceToast: {
        position: "absolute",
        top: 76,
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        zIndex: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 0,
        backgroundColor: theme.resolvedScheme === "light" ? theme.colors.bgSecondary : theme.colors.bgSecondary,
        shadowColor: "#000",
        shadowOpacity: theme.resolvedScheme === "light" ? 0.08 : 0.22,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    workspaceToastIcon: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.successMuted,
    },
    workspaceToastContent: {
        flex: 1,
        gap: 2,
    },
    workspaceToastLabel: {
        fontSize: theme.fontSize.xs,
        fontWeight: "700",
        color: theme.colors.success,
    },
    workspaceToastText: {
        fontSize: theme.fontSize.sm,
        lineHeight: 18,
        fontWeight: "600",
        color: theme.colors.textAssistant,
    },
    scrollToBottomBtn: {
        position: "absolute",
        bottom: 12,
        alignSelf: "center",
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.border,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
});
}

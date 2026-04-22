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
} from "react-native";
import type { NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRouter } from "expo-router";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import type { ParamListBase } from "@react-navigation/native";
import { GitBranchIcon, DiffIcon, MoreVerticalIcon, ChevronDownIcon, CirclePlusIcon, SettingsIcon, WifiOffIcon } from "../../src/components/ProviderIcon";
import { useSessionStore } from "../../src/stores/session-store";
import type { ChatItem } from "../../src/stores/session-store-types";
import { useWorkspaceStore } from "../../src/stores/workspace-store";
import { WorkspacePanel } from "../../src/components/WorkspacePanel";
import { useConnectionStore } from "../../src/stores/connection-store";
import { useChatHistoryStore } from "../../src/stores/chat-history-store";
import { ChatMessageItem } from "../../src/components/ChatMessageItem";
import { ChatInput } from "../../src/components/ChatInput";
import type { ImageAttachment, QueuedDraft, SendMode } from "../../src/components/chat-input-types";
import { EmptyChat } from "../../src/components/EmptyChat";
import { ActivityDots } from "../../src/components/ActivityDots";
import { TodoPanel } from "../../src/components/TodoPanel";
import { PermissionDialog, PlanExitDialog, UserInputDialog } from "../../src/components/Dialogs";
import { useAppTheme, type AppTheme } from "../../src/theme/theme-context";
import type { SessionConfig, SessionMessageAttachment } from "@copilot-mobile/shared";
import {
    sendMessage,
    sendQueuedMessage,
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
} from "../../src/services/bridge";
import { startDraftConversation } from "../../src/services/new-chat";

function basename(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? path;
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
    const repository = useWorkspaceStore((s) => s.repository);
    const workspaceRoot = useWorkspaceStore((s) => s.workspaceRoot);
    const workspaceSessionId = useWorkspaceStore((s) => s.sessionId);
    const uncommittedChanges = useWorkspaceStore((s) => s.uncommittedChanges);
    const insets = useSafeAreaInsets();
    const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const handleCloseWorkspace = React.useCallback(() => setWorkspaceOpen(false), []);
    const isConnected = connectionState === "authenticated";

    const handleNewChat = React.useCallback(() => {
        setMenuOpen(false);
        startDraftConversation(
            workspaceSessionId !== null && workspaceSessionId === activeSessionId ? workspaceRoot : null
        );
    }, [activeSessionId, workspaceRoot, workspaceSessionId]);

    const handleOpenSettings = React.useCallback(() => {
        setMenuOpen(false);
        router.push("/settings");
    }, [router]);

    const handleDisconnect = React.useCallback(() => {
        setMenuOpen(false);
        disconnect();
        router.replace("/scan");
    }, [router]);

    const handleOpenWorkspaceChanges = React.useCallback(() => {
        useWorkspaceStore.getState().setTab("changes");
        setWorkspaceOpen(true);
    }, []);

    const activeSession = sessions.find((s) => s.id === activeSessionId);
    const activeConversation = activeConversationId !== null
        ? conversations.find((conversation) => conversation.id === activeConversationId)
        : undefined;
    const draftWorkspaceRoot = activeSessionId === null ? (activeConversation?.workspaceRoot ?? null) : null;
    const hasBoundWorkspaceSession = workspaceSessionId !== null && workspaceSessionId === activeSessionId;
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
            : currentRepository ?? "copilot-mobile";
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

    React.useEffect(() => {
        if (!isConnected || activeSessionId === null) {
            return;
        }

        void requestWorkspaceGitSummary(activeSessionId, 10);
    }, [activeSessionId, isConnected]);

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
                        {hasVisibleDiffTotals && (
                            <View style={headerStyles.diffTotals}>
                                <Text style={headerStyles.diffAddText}>+{changeTotals.additions}</Text>
                                <Text style={headerStyles.diffDeleteText}>-{changeTotals.deletions}</Text>
                            </View>
                        )}
                    </Pressable>
                    <Pressable
                        style={headerStyles.iconButton}
                        onPress={() => setMenuOpen(true)}
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
        </>
    );
});

const MAX_TOTAL_ATTACHMENT_BASE64_CHARS = 700_000;

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
    const persistChatItemsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistInteractionRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

    // Store'lardan state
    const chatItems = useSessionStore((s) => s.chatItems);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const sessions = useSessionStore((s) => s.sessions);
    const isSessionLoading = useSessionStore((s) => s.isSessionLoading);
    const isTyping = useSessionStore((s) => s.isAssistantTyping);
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
    const activeConversationId = useChatHistoryStore((s) => s.activeConversationId);
    const workspaceSessionId = useWorkspaceStore((s) => s.sessionId);
    const workspaceRoot = useWorkspaceStore((s) => s.workspaceRoot);

    const connectionState = useConnectionStore((s) => s.state);
    const connectionError = useConnectionStore((s) => s.error);
    const isConnected = connectionState === "authenticated";
    const isConnecting =
        connectionState === "connecting" || connectionState === "connected";
    const inputDisabled = !isConnected || isSessionLoading;
    const visibleQueuedDrafts = queuedDrafts.filter((draft) => draft.sessionId === activeSessionId);

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

        const persistDelay = hasStreamingContent ? 2600 : isTyping ? 1600 : 900;

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

            // "send" mode — abort current turn (if any) then send
            if (mode === "send" && activeSessionId !== null && isTyping) {
                abortMessage(activeSessionId);
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
            isTyping,
            models,
            permissionLevel,
            reasoningEffort,
            selectedModel,
            sessions,
            workspaceRoot,
            workspaceSessionId,
        ]
    );

    // Abort message
    const handleAbort = useCallback(() => {
        if (activeSessionId !== null) {
            abortMessage(activeSessionId);
        }
    }, [activeSessionId]);

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
            <ChatHeader />

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
                                    getItemType={(item) => item.type}
                                    style={styles.messageList}
                                    contentContainerStyle={styles.messageListContent}
                                    onScroll={handleScroll}
                                    onContentSizeChange={() => {
                                        if (!isNearBottomRef.current) {
                                            return;
                                        }
                                        flatListRef.current?.scrollToEnd({ animated: isTyping });
                                    }}
                                    onScrollBeginDrag={handleBackgroundPress}
                                    scrollEventThrottle={32}
                                    canCancelContentTouches
                                    keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                                    keyboardShouldPersistTaps="always"
                                    ListFooterComponent={activityFooter}
                                    drawDistance={600}
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

                {agentTodos.length > 0 && (
                    <TodoPanel todos={agentTodos} />
                )}

                <ChatInput
                    onSend={handleSend}
                    onAbort={handleAbort}
                    isTyping={isTyping}
                    disabled={inputDisabled}
                    queuedDrafts={visibleQueuedDrafts}
                    editingDraft={editingDraft}
                    onEditingDraftConsumed={() => setEditingDraft(null)}
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
    diffTotals: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
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
    menuItemText: {
        fontSize: theme.fontSize.md,
        color: theme.colors.textPrimary,
    },
    menuItemDanger: {
        color: theme.colors.error,
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

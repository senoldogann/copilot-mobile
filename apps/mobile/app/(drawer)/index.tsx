// Ana sohbet ekranı — mesaj akışı, düşünme, araçlar, izin ve giriş yönetimi

import React, { useRef, useEffect, useCallback, useState } from "react";
import {
    View,
    Text,
    Pressable,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Modal,
    StyleSheet,
} from "react-native";
import type { NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRouter } from "expo-router";
import type { DrawerNavigationProp } from "@react-navigation/drawer";
import type { ParamListBase } from "@react-navigation/native";
import { GitBranchIcon, FolderIcon, MoreVerticalIcon, ChevronDownIcon } from "../../src/components/ProviderIcon";
import { useSessionStore } from "../../src/stores/session-store";
import type { ChatItem } from "../../src/stores/session-store";
import { useWorkspaceStore } from "../../src/stores/workspace-store";
import { WorkspacePanel } from "../../src/components/WorkspacePanel";
import { useConnectionStore } from "../../src/stores/connection-store";
import { useChatHistoryStore } from "../../src/stores/chat-history-store";
import { ChatMessageItem } from "../../src/components/ChatMessageItem";
import { ChatInput } from "../../src/components/ChatInput";
import type { ImageAttachment, SendMode } from "../../src/components/ChatInput";
import { EmptyChat } from "../../src/components/EmptyChat";
import { ActivityDots } from "../../src/components/ActivityDots";
import { TodoPanel } from "../../src/components/TodoPanel";
import { PermissionDialog, PlanExitDialog, UserInputDialog } from "../../src/components/Dialogs";
import { colors, spacing, fontSize, borderRadius } from "../../src/theme/colors";
import type { SessionConfig, SessionMessageAttachment } from "@copilot-mobile/shared";
import {
    sendMessage,
    sendQueuedMessage,
    abortMessage,
    createSession,
    respondPermission,
    respondUserInput,
    listModels,
    listSessions,
    requestCapabilities,
    requestSkillsList,
    disconnect,
} from "../../src/services/bridge";

// Özel başlık — GitHub Copilot mobil stili üst bar
function ChatHeader() {
    const navigation = useNavigation<DrawerNavigationProp<ParamListBase>>("/(drawer)");
    const router = useRouter();
    const isTyping = useSessionStore((s) => s.isAssistantTyping);
    const isSessionLoading = useSessionStore((s) => s.isSessionLoading);
    const sessions = useSessionStore((s) => s.sessions);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const currentIntent = useSessionStore((s) => s.currentIntent);
    const branch = useWorkspaceStore((s) => s.branch);
    const repository = useWorkspaceStore((s) => s.repository);
    const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const handleCloseWorkspace = React.useCallback(() => setWorkspaceOpen(false), []);

    const handleNewChat = React.useCallback(() => {
        setMenuOpen(false);
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
    }, []);

    const handleOpenSettings = React.useCallback(() => {
        setMenuOpen(false);
        router.push("/settings");
    }, [router]);

    const handleDisconnect = React.useCallback(() => {
        setMenuOpen(false);
        disconnect();
        router.replace("/scan");
    }, [router]);

    const activeSession = sessions.find((s) => s.id === activeSessionId);
    const sessionTitle = currentIntent
        ?? activeSession?.title
        ?? (activeSessionId !== null && isSessionLoading ? "Syncing session..." : null);
    const branchName = branch ?? "main";
    const repoName = repository ?? "copilot-mobile";

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

                <View style={headerStyles.branchContainer}>
                    <View style={headerStyles.branchRow}>
                        <GitBranchIcon size={12} color={colors.textTertiary} />
                        <Text style={headerStyles.branchText} numberOfLines={1}>{branchName}</Text>
                    </View>
                    <Text style={headerStyles.repoText} numberOfLines={1}>{repoName}</Text>
                </View>

                <View style={headerStyles.rightContainer}>
                    <Pressable
                        style={headerStyles.iconButton}
                        onPress={() => setWorkspaceOpen(true)}
                        hitSlop={10}
                        accessibilityLabel="Open workspace"
                    >
                        <FolderIcon size={17} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                        style={headerStyles.iconButton}
                        onPress={() => setMenuOpen(true)}
                        hitSlop={10}
                        accessibilityLabel="More options"
                    >
                        <MoreVerticalIcon size={17} color={colors.textSecondary} />
                    </Pressable>
                </View>
            </View>

            {sessionTitle !== null && (
                <View style={headerStyles.intentBar}>
                    <ActivityDots active={isTyping} />
                    <Text style={headerStyles.intentText} numberOfLines={1}>{sessionTitle}</Text>
                    <ChevronDownIcon size={12} color={colors.textTertiary} />
                </View>
            )}

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
                <Pressable style={headerStyles.menuOverlay} onPress={() => setMenuOpen(false)}>
                    <Pressable
                        style={headerStyles.menuCard}
                        onPress={(e) => e.stopPropagation()}
                    >
                        <Pressable style={headerStyles.menuItem} onPress={handleNewChat}>
                            <Text style={headerStyles.menuItemText}>New chat</Text>
                        </Pressable>
                        <View style={headerStyles.menuSep} />
                        <Pressable style={headerStyles.menuItem} onPress={handleOpenSettings}>
                            <Text style={headerStyles.menuItemText}>Settings</Text>
                        </Pressable>
                        <View style={headerStyles.menuSep} />
                        <Pressable style={headerStyles.menuItem} onPress={handleDisconnect}>
                            <Text style={[headerStyles.menuItemText, headerStyles.menuItemDanger]}>
                                Disconnect
                            </Text>
                        </Pressable>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

type QueuedMessage = {
    content: string;
    targetSessionId: string | null;
    attachments?: ReadonlyArray<SessionMessageAttachment>;
};

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
    const flatListRef = useRef<FlatList>(null);
    const queuedMessagesRef = useRef<Array<QueuedMessage>>([]);
    const sessionRequestInFlightRef = useRef(false);
    const isNearBottomRef = useRef(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const prevSessionIdRef = useRef<string | null>(null);

    // Store'lardan state
    const chatItems = useSessionStore((s) => s.chatItems);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
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

    const connectionState = useConnectionStore((s) => s.state);
    const connectionError = useConnectionStore((s) => s.error);
    const isConnected = connectionState === "authenticated";
    const isConnecting =
        connectionState === "connecting" || connectionState === "connected";

    useEffect(() => {
        if (isConnected) {
            listSessions();
            listModels();
            requestCapabilities();
            requestSkillsList();
        }
    }, [isConnected]);

    useEffect(() => {
        if (!isConnected) {
            sessionRequestInFlightRef.current = false;
            useSessionStore.getState().setSessionLoading(false);
        }
    }, [isConnected]);

    useEffect(() => {
        if (connectionError !== null) {
            useSessionStore.getState().setSessionLoading(false);
        }

        if (activeSessionId === null && connectionError !== null) {
            sessionRequestInFlightRef.current = false;
            queuedMessagesRef.current = queuedMessagesRef.current.filter((queuedMessage) =>
                queuedMessage.targetSessionId !== null
            );
        }
    }, [activeSessionId, connectionError]);

    useEffect(() => {
        if (activeSessionId === null || isTyping) {
            return;
        }

        const shouldConsumePendingNewSession = sessionRequestInFlightRef.current;
        sessionRequestInFlightRef.current = false;

        if (!shouldConsumePendingNewSession) {
            queuedMessagesRef.current = queuedMessagesRef.current.filter((queuedMessage) =>
                queuedMessage.targetSessionId !== null
            );
        }

        const nextQueuedMessage = queuedMessagesRef.current.find((queuedMessage) =>
            queuedMessage.targetSessionId === activeSessionId
            || (queuedMessage.targetSessionId === null && shouldConsumePendingNewSession)
        );
        if (nextQueuedMessage === undefined) {
            return;
        }
        queuedMessagesRef.current = queuedMessagesRef.current.filter((queuedMessage) =>
            queuedMessage !== nextQueuedMessage
        );

        void (async () => {
            await sendQueuedMessage(
                activeSessionId,
                nextQueuedMessage.content,
                nextQueuedMessage.attachments
            );
        })();
    }, [activeSessionId, isTyping]);

    // Oturum değişince en alta scroll reset yap
    useEffect(() => {
        if (prevSessionIdRef.current !== activeSessionId) {
            prevSessionIdRef.current = activeSessionId;
            isNearBottomRef.current = true;
            setShowScrollToBottom(false);
        }
    }, [activeSessionId]);

    // Kullanıcı sohbetin sonuna yakınsa otomatik kaydır
    useEffect(() => {
        if (chatItems.length > 0 && isNearBottomRef.current) {
            const timerId = setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: chatItems.length <= 2 });
            }, 80);
            return () => clearTimeout(timerId);
        }
    }, [chatItems]);

    // Scroll konumunu takip et
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

            // "steer" mode sends inline without interrupting assistant
            if (mode === "steer" && activeSessionId !== null) {
                sendMessage(activeSessionId, content, attachments);
                return;
            }

            // "queue" mode adds message to the queue to be sent after current turn
            if (mode === "queue" && activeSessionId !== null) {
                const store = useSessionStore.getState();
                store.addUserMessage(content, attachments);
                queuedMessagesRef.current = [
                    ...queuedMessagesRef.current,
                    {
                        content,
                        targetSessionId: activeSessionId,
                        ...(attachments !== undefined ? { attachments } : {}),
                    },
                ];
                return;
            }

            // "send" mode — abort current turn (if any) then send
            if (mode === "send" && activeSessionId !== null && isTyping) {
                abortMessage(activeSessionId);
            }

            const historyStore = useChatHistoryStore.getState();
            const previousActiveConversationId = historyStore.activeConversationId;
            const activeConversationId =
                previousActiveConversationId ?? historyStore.createConversation(null);
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
                store.addUserMessage(content, attachments);
                store.setSessionLoading(true);
                queuedMessagesRef.current = [
                    ...queuedMessagesRef.current,
                    {
                        content,
                        targetSessionId: null,
                        ...(attachments !== undefined ? { attachments } : {}),
                    },
                ];

                if (!sessionRequestInFlightRef.current) {
                    sessionRequestInFlightRef.current = true;
                    const config: SessionConfig = {
                        model: requestedModelId,
                        streaming: true,
                        agentMode,
                        permissionLevel,
                    };
                    if (
                        requestedModel?.supportsReasoningEffort === true &&
                        reasoningEffort !== null
                    ) {
                        config.reasoningEffort = reasoningEffort;
                    }
                    void createSession(config).catch(() => {
                        sessionRequestInFlightRef.current = false;
                    });
                }
                return;
            }

            sendMessage(activeSessionId, content, attachments);
        },
        [activeSessionId, models, selectedModel, reasoningEffort, isTyping, agentMode, permissionLevel]
    );

    // Abort message
    const handleAbort = useCallback(() => {
        if (activeSessionId !== null) {
            abortMessage(activeSessionId);
        }
    }, [activeSessionId]);

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

    // FlatList renders
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
                        <FlatList
                            ref={flatListRef}
                            data={chatItems as ChatItem[]}
                            renderItem={renderItem}
                            keyExtractor={keyExtractor}
                            style={styles.messageList}
                            contentContainerStyle={styles.messageListContent}
                            removeClippedSubviews={false}
                            maxToRenderPerBatch={15}
                            windowSize={21}
                            onScroll={handleScroll}
                            scrollEventThrottle={80}
                            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                            ListFooterComponent={
                                <ActivityDots active={isTyping} intent={chatCurrentIntent} />
                            }
                        />
                        {showScrollToBottom && (
                            <Pressable
                                style={styles.scrollToBottomBtn}
                                onPress={handleScrollToBottom}
                            >
                                <ChevronDownIcon size={16} color={colors.textPrimary} />
                            </Pressable>
                        )}
                    </View>
                )}

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
                    disabled={!isConnected || isSessionLoading}
                />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

// Başlık stilleri — GitHub Copilot mobil stili
const headerStyles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        backgroundColor: colors.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderMuted,
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
        backgroundColor: colors.textSecondary,
    },
    menuLineShort: {
        width: 12,
    },
    branchContainer: {
        flex: 1,
        paddingLeft: spacing.sm,
    },
    branchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    branchText: {
        fontSize: 14,
        fontWeight: "700",
        color: colors.textPrimary,
    },
    repoText: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        marginTop: 1,
    },
    rightContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    iconButton: {
        width: 34,
        height: 34,
        justifyContent: "center",
        alignItems: "center",
    },
    intentBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: 7,
        backgroundColor: colors.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderMuted,
        gap: spacing.sm,
    },
    intentText: {
        flex: 1,
        fontSize: fontSize.sm,
        color: colors.textSecondary,
    },
    menuOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.35)",
        paddingTop: 56,
        paddingRight: spacing.md,
        alignItems: "flex-end",
    },
    menuCard: {
        minWidth: 180,
        backgroundColor: colors.bgElevated,
        borderRadius: borderRadius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderMuted,
        overflow: "hidden",
    },
    menuItem: {
        paddingHorizontal: spacing.md,
        paddingVertical: 12,
    },
    menuItemText: {
        fontSize: fontSize.md,
        color: colors.textPrimary,
    },
    menuItemDanger: {
        color: colors.error,
    },
    menuSep: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.borderMuted,
    },
});

// Ana ekran stilleri — GitHub Copilot koyu tema
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg,
    },
    flex: {
        flex: 1,
    },
    messageList: {
        flex: 1,
    },
    messageListContent: {
        paddingVertical: spacing.md,
        paddingBottom: spacing.sm,
    },
    errorBanner: {
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        borderColor: colors.errorMuted,
        backgroundColor: colors.errorBackground,
    },
    errorBannerText: {
        fontSize: fontSize.md,
        lineHeight: 18,
        color: colors.error,
    },
    scrollToBottomBtn: {
        position: "absolute",
        bottom: 12,
        alignSelf: "center",
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
});

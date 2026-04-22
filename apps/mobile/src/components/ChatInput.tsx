// Message input bar — GitHub Copilot mobile style with model/effort selectors, image attachments, and send modes

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
    View,
    TextInput,
    Pressable,
    Text,
    InteractionManager,
    Modal,
    Image,
    ScrollView,
    Alert,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { useSessionStore } from "../stores/session-store";
import { deriveAvailableReasoningEfforts } from "../stores/session-store-helpers";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useConnectionStore } from "../stores/connection-store";
import type { WorkspaceTreeNode } from "@copilot-mobile/shared";
import type { AgentMode, ModelInfo, PermissionLevel, ReasoningEffortLevel } from "@copilot-mobile/shared";
import { MODEL_UNKNOWN } from "@copilot-mobile/shared";
import { requestWorkspaceTree, updatePermissionLevel, updateSessionMode } from "../services/bridge";
import { useAppTheme, useThemedStyles } from "../theme/theme-context";
import type {
    AutocompleteToken,
    ChatInputProps,
    ImageAttachment,
    SendMode,
    SlashCommand,
} from "./chat-input-types";
import {
    createAttachmentStyles,
    createAutocompleteStyles,
    createContextStyles,
    createDropdownStyles,
    createQueuedDraftStyles,
    createStyles,
    createToolbarStyles,
} from "./chat-input-styles";
import {
    ProviderIcon,
    detectProvider,
    ArrowUpIcon,
    ChevronDownIcon,
    CheckIcon,
    CloseIcon,
    SlidersIcon,
    CirclePlusIcon,
    MenuListIcon,
    HelpCircleIcon,
    ShieldIcon,
    ShieldCheckIcon,
    ZapIcon,
} from "./ProviderIcon";
import { ReasoningEffortIcon } from "./Icons";

// --- Effort labels ---

const effortLabels: Record<ReasoningEffortLevel, { label: string; description: string }> = {
    low: { label: "Low", description: "Faster responses with less reasoning" },
    medium: { label: "Medium", description: "Balanced reasoning and speed" },
    high: { label: "High", description: "Greater reasoning depth but slower" },
    xhigh: { label: "Extra High", description: "Maximum reasoning depth" },
};

// --- Dropdown component ---

function DropdownModal({
    visible,
    onClose,
    title,
    children,
}: {
    visible: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}) {
    const theme = useAppTheme();
    const dropdownStyles = useThemedStyles(createDropdownStyles);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={dropdownStyles.overlay} onPress={onClose}>
                <Pressable
                    style={dropdownStyles.container}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={dropdownStyles.header}>
                        <Text style={dropdownStyles.title}>{title}</Text>
                        <Pressable onPress={onClose} hitSlop={8}>
                            <CloseIcon size={18} color={theme.colors.textTertiary} />
                        </Pressable>
                    </View>
                    <ScrollView
                        style={dropdownStyles.scroll}
                        contentContainerStyle={dropdownStyles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {children}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

// --- Model selector dropdown ---

function ModelSelectorContent({
    models,
    selectedModel,
    onSelect,
}: {
    models: ReadonlyArray<ModelInfo>;
    selectedModel: string;
    onSelect: (modelId: string) => void;
}) {
    const theme = useAppTheme();
    const dropdownStyles = useThemedStyles(createDropdownStyles);
    const [search, setSearch] = useState("");

    const filtered = search.trim().length > 0
        ? models.filter(
            (m) =>
                m.name.toLowerCase().includes(search.toLowerCase()) ||
                m.id.toLowerCase().includes(search.toLowerCase())
        )
        : models;

    return (
        <View>
            <View style={dropdownStyles.searchContainer}>
                <TextInput
                    style={dropdownStyles.searchInput}
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search models"
                    placeholderTextColor={theme.colors.textPlaceholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
            </View>
            <ScrollView
                style={dropdownStyles.list}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
            >
                {(filtered as ModelInfo[]).map((item) => {
                    const isSelected = item.id === selectedModel;
                    const isDisabled = item.policyState === "disabled";
                    const badges: Array<string> = [];
                    if (item.defaultReasoningEffort !== undefined) {
                        badges.push(effortLabels[item.defaultReasoningEffort]?.label ?? item.defaultReasoningEffort);
                    }
                    if (item.billingMultiplier !== undefined && item.billingMultiplier !== 1) {
                        badges.push(`${item.billingMultiplier}×`);
                    }
                    if (item.supportsReasoningEffort === true) {
                        badges.push("›");
                    }
                    return (
                        <Pressable
                            key={item.id}
                            style={[
                                dropdownStyles.item,
                                isSelected && dropdownStyles.itemSelected,
                                isDisabled && dropdownStyles.itemDisabled,
                            ]}
                            onPress={() => {
                                if (!isDisabled) onSelect(item.id);
                            }}
                            disabled={isDisabled}
                        >
                            <View style={dropdownStyles.itemLeft}>
                                {isSelected && <Text style={dropdownStyles.checkmark}>✓</Text>}
                                <Text
                                    style={[
                                        dropdownStyles.itemText,
                                        isSelected && dropdownStyles.itemTextSelected,
                                        isDisabled && dropdownStyles.itemTextDisabled,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.name}
                                </Text>
                            </View>
                            {badges.length > 0 && (
                                <Text style={dropdownStyles.badgeText}>
                                    {badges.join(" · ")}
                                </Text>
                            )}
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

// --- Effort selector dropdown ---

function EffortSelectorContent({
    agentMode,
    onSelectAgentMode,
    permissionLevel,
    onSelectPermissionLevel,
    options,
    current,
    defaultEffort,
    onSelect,
}: {
    agentMode: AgentMode;
    onSelectAgentMode: (mode: AgentMode) => void;
    permissionLevel: PermissionLevel;
    onSelectPermissionLevel: (level: PermissionLevel) => void;
    options: ReadonlyArray<ReasoningEffortLevel>;
    current: ReasoningEffortLevel | null;
    defaultEffort: ReasoningEffortLevel | undefined;
    onSelect: (level: ReasoningEffortLevel) => void;
}) {
    const theme = useAppTheme();
    const dropdownStyles = useThemedStyles(createDropdownStyles);

    return (
        <View style={dropdownStyles.effortList}>
            <Text style={dropdownStyles.sectionLabel}>Agent Mode</Text>
            {(["agent", "plan", "ask"] as const).map((mode) => {
                const cfg = agentModeConfig[mode];
                const isSelected = agentMode === mode;

                return (
                    <Pressable
                        key={mode}
                        style={[
                            dropdownStyles.effortItem,
                            isSelected && dropdownStyles.effortItemSelected,
                        ]}
                        onPress={() => onSelectAgentMode(mode)}
                    >
                        <View style={dropdownStyles.effortItemLeft}>
                            <View style={dropdownStyles.checkmarkSlot}>
                                {isSelected && <CheckIcon size={13} color={theme.colors.textPrimary} />}
                            </View>
                            <View>
                                <Text style={[
                                    dropdownStyles.effortLabel,
                                    isSelected && dropdownStyles.effortLabelSelected,
                                ]}>
                                    {cfg.label}
                                </Text>
                                <Text style={dropdownStyles.effortDesc}>
                                    {cfg.desc}
                                </Text>
                            </View>
                        </View>
                        <cfg.Icon
                            size={18}
                            color={isSelected ? theme.colors.textPrimary : theme.colors.textTertiary}
                        />
                    </Pressable>
                );
            })}

            {options.length > 0 && <View style={dropdownStyles.sectionDivider} />}
            {options.length > 0 && <Text style={dropdownStyles.sectionLabel}>Thinking Effort</Text>}
            {options.map((level) => {
                const isSelected = current === level;
                const isDefault = defaultEffort === level;
                const info = effortLabels[level];

                return (
                    <Pressable
                        key={level}
                        style={[
                            dropdownStyles.effortItem,
                            isSelected && dropdownStyles.effortItemSelected,
                        ]}
                        onPress={() => onSelect(level)}
                    >
                        <View style={dropdownStyles.effortItemLeft}>
                            <View style={dropdownStyles.checkmarkSlot}>
                                {isSelected && <CheckIcon size={13} color={theme.colors.textPrimary} />}
                            </View>
                            <View>
                                <Text style={[
                                    dropdownStyles.effortLabel,
                                    isSelected && dropdownStyles.effortLabelSelected,
                                ]}>
                                    {info.label}{isDefault ? " (default)" : ""}
                                </Text>
                                <Text style={dropdownStyles.effortDesc}>
                                    {info.description}
                                </Text>
                            </View>
                        </View>
                        <View style={dropdownStyles.trailingSlot}>
                            <ReasoningEffortIcon
                                level={level}
                                size={18}
                                color={isSelected ? theme.colors.textPrimary : theme.colors.textTertiary}
                            />
                        </View>
                    </Pressable>
                );
            })}

            <View style={dropdownStyles.sectionDivider} />
            <Text style={dropdownStyles.sectionLabel}>Permission Level</Text>
            {(["default", "bypass", "autopilot"] as const).map((level) => {
                const cfg = permissionLevelConfig[level];
                const isSelected = permissionLevel === level;

                return (
                    <Pressable
                        key={level}
                        style={[
                            dropdownStyles.effortItem,
                            isSelected && dropdownStyles.effortItemSelected,
                        ]}
                        onPress={() => onSelectPermissionLevel(level)}
                    >
                        <View style={dropdownStyles.effortItemLeft}>
                            <View style={dropdownStyles.checkmarkSlot}>
                                {isSelected && <CheckIcon size={13} color={theme.colors.textPrimary} />}
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[
                                    dropdownStyles.effortLabel,
                                    isSelected && dropdownStyles.effortLabelSelected,
                                ]}>
                                    {cfg.label}
                                </Text>
                                <Text style={dropdownStyles.effortDesc}>{cfg.desc}</Text>
                            </View>
                        </View>
                        <cfg.Icon
                            size={18}
                            color={isSelected ? theme.colors.textPrimary : theme.colors.textTertiary}
                        />
                    </Pressable>
                );
            })}
        </View>
    );
}

// --- Send mode menu ---

function SendModeMenu({
    visible,
    onSelect,
}: {
    visible: boolean;
    onSelect: (mode: SendMode) => void;
}) {
    const toolbarStyles = useThemedStyles(createToolbarStyles);

    if (!visible) {
        return null;
    }

    return (
        <View style={toolbarStyles.sendMenuPopover}>
            <Pressable
                style={toolbarStyles.sendModeItem}
                onPress={() => onSelect("send")}
            >
                <Text style={toolbarStyles.sendModeIcon}>→</Text>
                <Text style={toolbarStyles.sendModeText}>Stop and Send</Text>
            </Pressable>
            <Pressable
                style={toolbarStyles.sendModeItem}
                onPress={() => onSelect("queue")}
            >
                <Text style={toolbarStyles.sendModeIcon}>＋</Text>
                <View style={toolbarStyles.sendModeRight}>
                    <Text style={toolbarStyles.sendModeText}>Add to Queue</Text>
                    <Text style={toolbarStyles.sendModeShortcut}>Enter</Text>
                </View>
            </Pressable>
            <Pressable
                style={toolbarStyles.sendModeItem}
                onPress={() => onSelect("steer")}
            >
                <Text style={toolbarStyles.sendModeIcon}>↑</Text>
                <View style={toolbarStyles.sendModeRight}>
                    <Text style={toolbarStyles.sendModeText}>Steer with Message</Text>
                    <Text style={toolbarStyles.sendModeShortcut}>⌥Enter</Text>
                </View>
            </Pressable>
        </View>
    );
}

// --- Image attachment chip ---

function AttachmentChip({
    image,
    onRemove,
}: {
    image: ImageAttachment;
    onRemove: () => void;
}) {
    const attachStyles = useThemedStyles(createAttachmentStyles);

    return (
        <View style={attachStyles.chip}>
            <Pressable style={attachStyles.chipClose} onPress={onRemove} hitSlop={4}>
                <Text style={attachStyles.chipCloseText}>✕</Text>
            </Pressable>
            <Image source={{ uri: image.uri }} style={attachStyles.chipImage} />
            <Text style={attachStyles.chipName} numberOfLines={1}>
                {image.fileName}
            </Text>
        </View>
    );
}

const agentModeConfig: Record<AgentMode, {
    label: string;
    pillLabel: string;
    desc: string;
    Icon: React.FC<{ size?: number; color?: string }>;
}> = {
    agent: {
        label: "Agent",
        pillLabel: "Agent",
        desc: "Use tools and make changes in the workspace.",
        Icon: CirclePlusIcon,
    },
    plan: {
        label: "Plan",
        pillLabel: "Plan",
        desc: "Draft a plan first, then continue when it looks right.",
        Icon: MenuListIcon,
    },
    ask: {
        label: "Ask",
        pillLabel: "Ask",
        desc: "Read-only analysis for questions and explanations.",
        Icon: HelpCircleIcon,
    },
};

const permissionLevelConfig: Record<PermissionLevel, {
    label: string;
    pillLabel: string;
    desc: string;
    Icon: React.FC<{ size?: number; color?: string }>;
}> = {
    default: {
        label: "Default Approvals",
        pillLabel: "Default Approvals",
        desc: "Prompt when approval is needed. Safe reads can auto-approve.",
        Icon: ShieldIcon,
    },
    bypass: {
        label: "Bypass Approvals",
        pillLabel: "Bypass Approvals",
        desc: "Skip approval prompts but still allow follow-up questions.",
        Icon: ShieldCheckIcon,
    },
    autopilot: {
        label: "Autopilot (Preview)",
        pillLabel: "Autopilot",
        desc: "Auto-approve actions and continue until the task is done.",
        Icon: ZapIcon,
    },
};

// --- Main ChatInput component ---

// Convert model context window size to a human-readable format.
function formatCtxWindow(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
    return String(tokens);
}

const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
    // Chat management
    { command: "/clear", description: "Start new chat, archive current", category: "chat" },
    { command: "/compact", description: "Compact conversation to save context", category: "chat" },
    { command: "/fork", description: "Fork conversation into a new session", category: "chat" },
    { command: "/rename", description: "Rename this chat", category: "chat" },
    // Code actions
    { command: "/explain", description: "Explain selected code", category: "code" },
    { command: "/fix", description: "Suggest a fix for the current issue", category: "code" },
    { command: "/doc", description: "Add documentation to code", category: "code" },
    { command: "/new", description: "Start a new session", category: "code" },
    { command: "/tests", description: "Generate tests", category: "code" },
    { command: "/newNotebook", description: "Create a new notebook", category: "code" },
    { command: "/setupTests", description: "Set up the test framework", category: "code" },
    // Copilot configuration
    { command: "/agents", description: "Configure custom agents", category: "config" },
    { command: "/debug", description: "Show chat debug view", category: "config" },
    { command: "/hooks", description: "Configure hooks", category: "config" },
    { command: "/instructions", description: "Configure instructions", category: "config" },
    { command: "/models", description: "Open the model picker", category: "config" },
    { command: "/plugins", description: "Manage plugins", category: "config" },
    { command: "/prompts", description: "Configure prompt files", category: "config" },
    { command: "/skills", description: "Configure skills", category: "config" },
    { command: "/tools", description: "Configure tools", category: "config" },
    // Session permissions
    { command: "/autoApprove", description: "Set permissions to bypass approvals", category: "session" },
    { command: "/autopilot", description: "Set permissions to autopilot mode", category: "session" },
    { command: "/yolo", description: "Set permissions to bypass approvals", category: "session" },
    { command: "/disableAutoApprove", description: "Set permissions back to default", category: "session" },
    { command: "/disableYolo", description: "Set permissions back to default", category: "session" },
    { command: "/exitAutopilot", description: "Set permissions back to default", category: "session" },
    // Help
    { command: "/help", description: "Show help and available commands", category: "help" },
];

// Detect @file or /command token by scanning backward from cursor position.
function detectAutocompleteToken(text: string, cursor: number): AutocompleteToken {
    if (cursor <= 0) return null;
    let i = cursor - 1;
    while (i >= 0) {
        const ch = text[i];
        if (ch === undefined) break;
        if (ch === " " || ch === "\n" || ch === "\t") return null;
        if (ch === "@") {
            // Accept @ start only at line/word boundaries.
            const prev = i > 0 ? text[i - 1] : undefined;
            if (prev !== undefined && prev !== " " && prev !== "\n" && prev !== "\t") return null;
            return { kind: "file", query: text.slice(i + 1, cursor), start: i, end: cursor };
        }
        if (ch === "/") {
            const prev = i > 0 ? text[i - 1] : undefined;
            if (prev !== undefined && prev !== " " && prev !== "\n" && prev !== "\t") return null;
            return { kind: "slash", query: text.slice(i + 1, cursor), start: i, end: cursor };
        }
        i -= 1;
    }
    return null;
}

// Collect all file paths from the workspace tree.
function collectFilePaths(node: WorkspaceTreeNode | null, out: Array<string>): void {
    if (node === null) return;
    if (node.type === "file") {
        out.push(node.path);
    }
    if (node.children !== undefined) {
        for (const child of node.children) collectFilePaths(child, out);
    }
}

function pathMatchesQuery(path: string, query: string): boolean {
    if (query.length === 0) {
        return true;
    }

    const normalizedPath = path.toLowerCase();
    if (normalizedPath.includes(query)) {
        return true;
    }

    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    return fileName.includes(query);
}

export function ChatInput({
    onSend,
    onAbort,
    isTyping,
    disabled,
    queuedDrafts,
    editingDraft,
    onEditingDraftConsumed,
    onEditQueuedDraft,
    onRemoveQueuedDraft,
    onSteerQueuedDraft,
}: ChatInputProps) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const toolbarStyles = useThemedStyles(createToolbarStyles);
    const attachStyles = useThemedStyles(createAttachmentStyles);
    const autocompleteStyles = useThemedStyles(createAutocompleteStyles);
    const queuedDraftStyles = useThemedStyles(createQueuedDraftStyles);
    const contextStyles = useThemedStyles(createContextStyles);
    const [input, setInput] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [images, setImages] = useState<Array<ImageAttachment>>([]);
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [showEffortPicker, setShowEffortPicker] = useState(false);
    const [showSendMenu, setShowSendMenu] = useState(false);
    const [showContextWindowSheet, setShowContextWindowSheet] = useState(false);
    const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const lastSendSignatureRef = React.useRef<{ signature: string; sentAt: number } | null>(null);
    const workspaceTree = useWorkspaceStore((s) => s.tree);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const connectionState = useConnectionStore((s) => s.state);
    const agentMode = useSessionStore((s) => s.agentMode);
    const setAgentMode = useSessionStore((s) => s.setAgentMode);
    const permissionLevel = useSessionStore((s) => s.permissionLevel);
    const setPermissionLevel = useSessionStore((s) => s.setPermissionLevel);

    const models = useSessionStore((s) => s.models);
    const sessions = useSessionStore((s) => s.sessions);
    const selectedModel = useSessionStore((s) => s.selectedModel);
    const setSelectedModel = useSessionStore((s) => s.setSelectedModel);
    const reasoningEffort = useSessionStore((s) => s.reasoningEffort);
    const setReasoningEffort = useSessionStore((s) => s.setReasoningEffort);
    const skills = useSessionStore((s) => s.skills);
    const sessionUsage = useSessionStore((s) =>
        s.activeSessionId !== null ? s.sessionUsage[s.activeSessionId] : undefined
    );
    const currentModel = models.find((m) => m.id === selectedModel);
    const effortInfo = deriveAvailableReasoningEfforts(currentModel);

    const handleSend = useCallback(
        (mode: SendMode) => {
            const trimmed = input.trim();
            if (trimmed.length === 0 || disabled) return;

            const attachmentSignature = images.map((image) => (
                `${image.fileName}:${image.base64Data.length}:${image.width}x${image.height}`
            )).join("|");
            const sendSignature = `${mode}::${trimmed}::${attachmentSignature}`;
            const now = Date.now();
            const previousSend = lastSendSignatureRef.current;
            if (
                previousSend !== null
                && previousSend.signature === sendSignature
                && now - previousSend.sentAt < 1200
            ) {
                return;
            }

            lastSendSignatureRef.current = {
                signature: sendSignature,
                sentAt: now,
            };
            const currentImages = [...images];
            setInput("");
            setImages([]);
            onSend(trimmed, currentImages, mode);
        },
        [input, disabled, images, onSend]
    );

    useEffect(() => {
        if (editingDraft === null) {
            return;
        }

        setInput(editingDraft.content);
        setImages([...editingDraft.images]);
        const nextCursor = editingDraft.content.length;
        setSelection({ start: nextCursor, end: nextCursor });
        onEditingDraftConsumed();
    }, [editingDraft, onEditingDraftConsumed]);

    const handleDefaultSend = useCallback(() => {
        if (isTyping) {
            handleSend("queue");
        } else {
            handleSend("send");
        }
    }, [isTyping, handleSend]);

    // Autocomplete tokeni: @file veya /command.
    const activeToken = useMemo<AutocompleteToken>(
        () => detectAutocompleteToken(input, selection.start),
        [input, selection.start]
    );

    // File path list from workspace tree for @files autocomplete.
    const filePaths = useMemo<ReadonlyArray<string>>(() => {
        const out: Array<string> = [];
        collectFilePaths(workspaceTree, out);
        return out;
    }, [workspaceTree]);

    useEffect(() => {
        if (activeToken?.kind !== "file") {
            return;
        }
        if (activeSessionId === null || connectionState !== "authenticated") {
            return;
        }
        if (workspaceTree !== null || filePaths.length > 0) {
            return;
        }
        void requestWorkspaceTree(activeSessionId, undefined, 5);
    }, [activeToken?.kind, activeSessionId, connectionState, workspaceTree, filePaths.length]);

    // Suggestions filtered by token type (including slash + skill commands).
    const suggestions = useMemo<ReadonlyArray<{ label: string; value: string; hint?: string }>>(() => {
        if (activeToken === null) return [];
        const query = activeToken.query.toLowerCase();
        if (activeToken.kind === "file") {
            return filePaths
                .filter((p) => pathMatchesQuery(p, query))
                .slice(0, 8)
                .map((p) => ({ label: p, value: `@${p} ` }));
        }
        // Slash mode: static commands first, then skill-derived commands.
        const staticMatches = SLASH_COMMANDS
            .filter((c) => c.command.slice(1).toLowerCase().startsWith(query))
            .map((c) => ({ label: c.command, value: `${c.command} `, hint: c.description }));

        const skillMatches = skills
            .filter((s) => s.name.toLowerCase().startsWith(query))
            .map((s) => ({
                label: `/${s.name}`,
                value: `/${s.name} `,
                hint: s.description.length > 0 ? s.description : "Agent skill",
            }));

        return [...staticMatches, ...skillMatches].slice(0, 10);
    }, [activeToken, filePaths, skills]);

    // Apply selected suggestion: replace token and move cursor to end.
    const applySuggestion = useCallback((value: string) => {
        if (activeToken === null) return;
        const before = input.slice(0, activeToken.start);
        const after = input.slice(activeToken.end);
        const next = `${before}${value}${after}`;
        setInput(next);
        const nextCursor = before.length + value.length;
        setSelection({ start: nextCursor, end: nextCursor });
    }, [activeToken, input]);

    const handlePickImage = useCallback(async () => {
        try {
            const existingPermission = await ImagePicker.getMediaLibraryPermissionsAsync();
            const permission = existingPermission.granted
                ? existingPermission
                : await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (!permission.granted) {
                Alert.alert(
                    "Photo Access Required",
                    "Enable photo library access to attach images to your Copilot message.",
                );
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: true,
                quality: 0.8,
                base64: true,
            });

            if (result.canceled) {
                return;
            }

            const newImages: Array<ImageAttachment> = result.assets.flatMap((asset) => {
                if (asset.base64 === undefined || asset.base64 === null) {
                    console.warn("[ChatInput] Skipped selected image because base64 data was missing");
                    return [];
                }

                return [{
                    uri: asset.uri,
                    width: asset.width,
                    height: asset.height,
                    fileName: asset.fileName ?? `image-${Date.now()}.jpg`,
                    mimeType: asset.mimeType ?? "image/jpeg",
                    base64Data: asset.base64,
                }];
            });

            if (newImages.length === 0) {
                Alert.alert(
                    "Attachment unavailable",
                    "The selected image could not be attached. Please try another image.",
                );
                return;
            }

            setImages((prev) => [...prev, ...newImages]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Alert.alert("Could not open photo library", message);
        }
    }, []);

    const handleAttachImage = useCallback(() => {
        InteractionManager.runAfterInteractions(() => {
            void handlePickImage();
        });
    }, [handlePickImage]);

    const removeImage = useCallback((index: number) => {
        setImages((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleModelSelect = useCallback(
        (modelId: string) => {
            setSelectedModel(modelId);
            setShowModelPicker(false);
        },
        [setSelectedModel]
    );

    const handleAgentModeSelect = useCallback(
        async (mode: AgentMode) => {
            setAgentMode(mode);
            if (activeSessionId !== null) {
                await updateSessionMode(activeSessionId, mode);
            }
        },
        [activeSessionId, setAgentMode]
    );

    const handlePermissionLevelSelect = useCallback(
        async (level: PermissionLevel) => {
            setPermissionLevel(level);
            if (activeSessionId !== null) {
                await updatePermissionLevel(activeSessionId, level);
            }
        },
        [activeSessionId, setPermissionLevel]
    );

    const handleSendModeSelect = useCallback(
        (mode: SendMode) => {
            setShowSendMenu(false);
            handleSend(mode);
        },
        [handleSend]
    );

    useEffect(() => {
        if (!isTyping) {
            setShowSendMenu(false);
        }
    }, [isTyping]);

    const canSend = input.trim().length > 0 && !disabled;

    // Model display label — truncate to keep pill compact
    const modelDisplayName = (() => {
        const name = currentModel?.name ?? selectedModel ?? "Model";
        return name.length > 18 ? name.slice(0, 16) + "…" : name;
    })();
    const effortSuffix = reasoningEffort !== null && effortInfo.supported
        ? ` · ${effortLabels[reasoningEffort]?.label ?? reasoningEffort}`
        : "";
    const resolvedAutoModelLabel = useMemo(() => {
        const normalizedSelectedModel = selectedModel.trim().toLowerCase();
        const isAutoSelected = normalizedSelectedModel === "auto"
            || currentModel?.id.trim().toLowerCase() === "auto"
            || currentModel?.name.trim().toLowerCase() === "auto";

        if (!isAutoSelected || isTyping || activeSessionId === null) {
            return null;
        }

        const activeSession = sessions.find((session) => session.id === activeSessionId);
        if (activeSession === undefined || activeSession.model === MODEL_UNKNOWN) {
            return null;
        }

        const resolvedModel = models.find((model) => model.id === activeSession.model);
        const resolvedModelName = resolvedModel?.name ?? activeSession.model;
        return `Used ${resolvedModelName}`;
    }, [activeSessionId, currentModel?.id, currentModel?.name, isTyping, models, selectedModel, sessions]);

    const supportsVision = currentModel?.supportsVision === true;
    // Live context usage takes priority over static model limit.
    const contextUsageLabel: { primary: string; percent: number } | null = (() => {
        if (sessionUsage !== undefined && sessionUsage.tokenLimit > 0) {
            const pct = Math.min(100, Math.round((sessionUsage.currentTokens / sessionUsage.tokenLimit) * 100));
            return {
                primary: `${formatCtxWindow(sessionUsage.currentTokens)} / ${formatCtxWindow(sessionUsage.tokenLimit)}`,
                percent: pct,
            };
        }
        return null;
    })();
    const contextWindowLabel = currentModel?.contextWindowTokens !== undefined
        ? formatCtxWindow(currentModel.contextWindowTokens)
        : null;
    const contextLimit = sessionUsage?.tokenLimit ?? currentModel?.contextWindowTokens ?? null;
    const contextCurrent = sessionUsage?.currentTokens ?? null;
    const contextPercent = contextLimit !== null && contextCurrent !== null && contextLimit > 0
        ? Math.min(100, Math.round((contextCurrent / contextLimit) * 100))
        : null;
    const reservedPercent = contextLimit !== null && contextCurrent !== null && contextLimit > 0
        ? Math.max(0, Math.round(((contextLimit - contextCurrent) / contextLimit) * 100))
        : null;
    const toolResultsTokens =
        sessionUsage !== undefined
            ? Math.max(
                0,
                sessionUsage.currentTokens
                - (sessionUsage.systemTokens ?? 0)
                - (sessionUsage.conversationTokens ?? 0)
                - (sessionUsage.toolDefinitionsTokens ?? 0)
            )
            : undefined;
    const detailPercent = (value: number | undefined): string => {
        if (value === undefined || contextLimit === null || contextLimit <= 0) {
            return "—";
        }
        return `${((value / contextLimit) * 100).toFixed(1)}%`;
    };

    const contextMeterPercent = contextPercent ?? 0;
    const contextMeterRadius = 6.5;
    const contextMeterCircumference = 2 * Math.PI * contextMeterRadius;
    const contextMeterStroke = (contextMeterPercent / 100) * contextMeterCircumference;

    return (
        <View style={styles.container}>
            {queuedDrafts.length > 0 && (
                <View style={queuedDraftStyles.container}>
                    {queuedDrafts.map((draft) => (
                        <View key={draft.id} style={queuedDraftStyles.item}>
                            <Pressable
                                style={queuedDraftStyles.body}
                                onPress={() => onEditQueuedDraft(draft.id)}
                                accessibilityLabel="Edit queued message"
                            >
                                <View style={queuedDraftStyles.badge}>
                                    <Text style={queuedDraftStyles.badgeText}>Queued</Text>
                                </View>
                                <Text
                                    style={queuedDraftStyles.content}
                                    numberOfLines={2}
                                >
                                    {draft.content}
                                </Text>
                                {draft.images.length > 0 && (
                                    <Text style={queuedDraftStyles.meta}>
                                        {draft.images.length} image{draft.images.length > 1 ? "s" : ""}
                                    </Text>
                                )}
                            </Pressable>
                            <Pressable
                                style={queuedDraftStyles.actionButton}
                                onPress={() => onSteerQueuedDraft(draft.id)}
                                accessibilityLabel="Send queued message as steer"
                            >
                                <ArrowUpIcon size={14} color={theme.colors.textPrimary} />
                            </Pressable>
                            <Pressable
                                style={queuedDraftStyles.actionButton}
                                onPress={() => onRemoveQueuedDraft(draft.id)}
                                accessibilityLabel="Remove queued message"
                            >
                                <CloseIcon size={14} color={theme.colors.textTertiary} />
                            </Pressable>
                        </View>
                    ))}
                </View>
            )}

            {/* Image attachments */}
            {images.length > 0 && (
                <ScrollView
                    horizontal
                    style={attachStyles.row}
                    contentContainerStyle={attachStyles.rowContent}
                    showsHorizontalScrollIndicator={false}
                >
                    {images.map((img, idx) => (
                        <AttachmentChip
                            key={img.uri}
                            image={img}
                            onRemove={() => removeImage(idx)}
                        />
                    ))}
                </ScrollView>
            )}

            {/* Input card — text area + toolbar in one unified rounded container */}
            {suggestions.length > 0 && (
                <View style={autocompleteStyles.popover}>
                    {/* Model and context window info in slash mode */}
                    {activeToken?.kind === "slash" && currentModel !== undefined && (
                        <View style={autocompleteStyles.ctxHeader}>
                            <ProviderIcon
                                provider={detectProvider(currentModel.id)}
                                size={11}
                                color={theme.colors.textTertiary}
                            />
                            <Text style={autocompleteStyles.ctxModelName} numberOfLines={1}>
                                {currentModel.name}
                            </Text>
                            {currentModel.contextWindowTokens !== undefined && (
                                <Text style={autocompleteStyles.ctxSize}>
                                    · {formatCtxWindow(currentModel.contextWindowTokens)} ctx
                                </Text>
                            )}
                        </View>
                    )}
                    <ScrollView
                        style={autocompleteStyles.list}
                        keyboardShouldPersistTaps="always"
                        showsVerticalScrollIndicator={true}
                        nestedScrollEnabled={true}
                    >
                        {suggestions.map((s) => (
                            <Pressable
                                key={s.value}
                                style={({ pressed }) => [
                                    autocompleteStyles.item,
                                    pressed && autocompleteStyles.itemPressed,
                                ]}
                                onPress={() => applySuggestion(s.value)}
                            >
                                <Text style={autocompleteStyles.label} numberOfLines={1}>{s.label}</Text>
                                {s.hint !== undefined && (
                                    <Text style={autocompleteStyles.hint} numberOfLines={1}>{s.hint}</Text>
                                )}
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            )}
            <View style={[
                styles.inputCard,
                isFocused && styles.inputCardFocused,
            ]}>
                {showSendMenu && canSend && (
                    <Pressable
                        style={toolbarStyles.sendMenuBackdrop}
                        onPress={() => setShowSendMenu(false)}
                        accessibilityLabel="Close send options"
                    />
                )}
                <TextInput
                    style={styles.textInput}
                    value={input}
                    onChangeText={setInput}
                    selection={selection}
                    onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                    placeholder="Message, @files, /commands"
                    placeholderTextColor={theme.colors.textTertiary}
                    multiline
                    maxLength={10000}
                    returnKeyType="send"
                    onSubmitEditing={handleDefaultSend}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    blurOnSubmit={false}
                    editable={!disabled}
                    accessibilityLabel="Write message"
                />

                {/* Thin separator */}
                <View style={styles.inputSeparator} />

                {/* Single toolbar row: attach | model | session-controls | spacer | context-meter | send */}
                <View style={toolbarStyles.row}>
                    <Pressable
                        style={toolbarStyles.toolBtn}
                        onPress={handleAttachImage}
                        disabled={disabled}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        accessibilityLabel="Attach image"
                    >
                        <CirclePlusIcon size={16} color={theme.colors.textSecondary} />
                    </Pressable>

                    {/* Model selector pill */}
                    <Pressable
                        style={toolbarStyles.modelPill}
                        onPress={() => setShowModelPicker(true)}
                        disabled={disabled}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        accessibilityLabel="Select model"
                    >
                        <ProviderIcon
                            provider={detectProvider(currentModel?.id ?? selectedModel)}
                            size={13}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={toolbarStyles.modelText} numberOfLines={1}>
                            {modelDisplayName}{effortSuffix}
                        </Text>
                        <ChevronDownIcon size={10} color={theme.colors.textTertiary} />
                    </Pressable>

                    <Pressable
                        style={toolbarStyles.toolBtn}
                        onPress={() => setShowEffortPicker(true)}
                        disabled={disabled}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        accessibilityLabel="Session controls"
                    >
                        <SlidersIcon size={15} color={theme.colors.textSecondary} />
                    </Pressable>

                    <View style={toolbarStyles.spacer} />

                    {(contextUsageLabel !== null || contextWindowLabel !== null) && (
                        <Pressable
                            style={toolbarStyles.contextMeterBtn}
                            onPress={() => setShowContextWindowSheet(true)}
                            accessibilityLabel="Show context window details"
                        >
                            <Svg width={18} height={18} viewBox="0 0 18 18">
                                <Circle
                                    cx={9}
                                    cy={9}
                                    r={contextMeterRadius}
                                    stroke={theme.colors.border}
                                    strokeWidth={1.8}
                                    fill="none"
                                />
                                <Circle
                                    cx={9}
                                    cy={9}
                                    r={contextMeterRadius}
                                    stroke={theme.colors.textPrimary}
                                    strokeWidth={1.8}
                                    fill="none"
                                    strokeDasharray={`${contextMeterStroke} ${contextMeterCircumference}`}
                                    transform="rotate(-90 9 9)"
                                    strokeLinecap="round"
                                />
                            </Svg>
                        </Pressable>
                    )}

                    {/* Send / Abort / Queue */}
                    {isTyping ? (
                        <View style={toolbarStyles.sendControlWrap}>
                            <Pressable
                                style={styles.abortButton}
                                onPress={onAbort}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityLabel="Stop request"
                            >
                                <View style={styles.abortIcon} />
                            </Pressable>

                            {canSend ? (
                                <View style={toolbarStyles.sendGroup}>
                                    <Pressable
                                        style={styles.sendButton}
                                        onPress={handleDefaultSend}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        accessibilityLabel="Send message"
                                    >
                                        <ArrowUpIcon size={16} color={theme.colors.textOnAccent} />
                                    </Pressable>
                                    <Pressable
                                        style={toolbarStyles.sendMenuButton}
                                        onPress={() => setShowSendMenu((prev) => !prev)}
                                        hitSlop={4}
                                        accessibilityLabel="Send options"
                                    >
                                        <ChevronDownIcon size={12} color={theme.colors.textPrimary} />
                                    </Pressable>
                                </View>
                            ) : (
                                <View style={[styles.sendButton, styles.sendButtonDisabled]}>
                                    <ArrowUpIcon size={16} color={theme.colors.textTertiary} />
                                </View>
                            )}

                            <SendModeMenu
                                visible={showSendMenu && canSend}
                                onSelect={handleSendModeSelect}
                            />
                        </View>
                    ) : canSend ? (
                        <Pressable
                            style={styles.sendButton}
                            onPress={() => handleSend("send")}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Send message"
                        >
                            <ArrowUpIcon size={16} color={theme.colors.textOnAccent} />
                        </Pressable>
                    ) : (
                        <View style={[styles.sendButton, styles.sendButtonDisabled]}>
                            <ArrowUpIcon size={16} color={theme.colors.textTertiary} />
                        </View>
                    )}
                </View>
            </View>

            {/* Model picker modal */}
            <DropdownModal
                visible={showModelPicker}
                onClose={() => setShowModelPicker(false)}
                title="Search models"
            >
                <ModelSelectorContent
                    models={models}
                    selectedModel={selectedModel}
                    onSelect={handleModelSelect}
                />
            </DropdownModal>

            {/* Session controls picker */}
            <DropdownModal
                visible={showEffortPicker}
                onClose={() => setShowEffortPicker(false)}
                title="Session Controls"
            >
                <EffortSelectorContent
                    agentMode={agentMode}
                    onSelectAgentMode={(mode) => {
                        void handleAgentModeSelect(mode);
                    }}
                    permissionLevel={permissionLevel}
                    onSelectPermissionLevel={(level) => {
                        void handlePermissionLevelSelect(level);
                    }}
                    options={effortInfo.options as ReasoningEffortLevel[]}
                    current={reasoningEffort}
                    defaultEffort={currentModel?.defaultReasoningEffort}
                    onSelect={(level) => {
                        setReasoningEffort(level);
                    }}
                />
            </DropdownModal>

            <DropdownModal
                visible={showContextWindowSheet}
                onClose={() => setShowContextWindowSheet(false)}
                title="Context Window"
            >
                <View style={contextStyles.container}>
                    <View style={contextStyles.heroCard}>
                        <View style={contextStyles.summaryRow}>
                            <Text style={contextStyles.eyebrow}>Window Usage</Text>
                            {contextPercent !== null ? (
                                <Text style={contextStyles.summaryPercent}>{contextPercent}%</Text>
                            ) : null}
                        </View>
                        <Text style={contextStyles.summaryText}>
                            {contextUsageLabel !== null
                                ? contextUsageLabel.primary
                                : contextWindowLabel !== null
                                    ? `${contextWindowLabel} tokens`
                                    : "Context unavailable"}
                        </Text>
                        {reservedPercent !== null ? (
                            <View style={contextStyles.reservePill}>
                                <Text style={contextStyles.reservePillText}>
                                    Reserved for response · {reservedPercent}%
                                </Text>
                            </View>
                        ) : null}
                        {contextPercent !== null ? (
                            <View style={contextStyles.progressTrack}>
                                <View style={[contextStyles.progressFill, { width: `${contextPercent}%` }]} />
                            </View>
                        ) : null}
                    </View>

                    <View style={contextStyles.sectionCard}>
                        <Text style={contextStyles.sectionTitle}>System</Text>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>System Instructions</Text>
                            <Text style={contextStyles.metricValue}>{detailPercent(sessionUsage?.systemTokens)}</Text>
                        </View>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>Tool Definitions</Text>
                            <Text style={contextStyles.metricValue}>{detailPercent(sessionUsage?.toolDefinitionsTokens)}</Text>
                        </View>
                    </View>

                    <View style={contextStyles.sectionCard}>
                        <Text style={contextStyles.sectionTitle}>User Context</Text>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>Messages</Text>
                            <Text style={contextStyles.metricValue}>{detailPercent(sessionUsage?.conversationTokens)}</Text>
                        </View>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>Tool Results</Text>
                            <Text style={contextStyles.metricValue}>{detailPercent(toolResultsTokens)}</Text>
                        </View>
                    </View>

                    <Pressable
                        style={contextStyles.compactButton}
                        onPress={() => {
                            setShowContextWindowSheet(false);
                            // Send /compact directly so the user does not need to type it manually.
                            // Once processed by the SDK slash command handler, the stream shows "Compacting conversation…".
                            if (!disabled) {
                                onSend("/compact", [], "send");
                            }
                        }}
                        disabled={disabled}
                    >
                        <Text style={contextStyles.compactButtonText}>Compact Conversation</Text>
                    </Pressable>
                </View>
            </DropdownModal>
            {resolvedAutoModelLabel !== null && (
                <Text style={styles.resolvedModelLabel}>{resolvedAutoModelLabel}</Text>
            )}
        </View>
    );
}

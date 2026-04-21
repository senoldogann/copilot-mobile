// Mesaj giriş çubuğu — GitHub Copilot mobil stili model/effort seçiciler, resim ekleme, gönderim modları

import React, { useState, useCallback, useMemo } from "react";
import {
    View,
    TextInput,
    Pressable,
    Text,
    StyleSheet,
    Platform,
    Modal,
    Image,
    ScrollView,
    Alert,
    InteractionManager,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSessionStore, deriveAvailableReasoningEfforts } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import type { WorkspaceTreeNode } from "@copilot-mobile/shared";
import { colors, spacing, fontSize as fs, borderRadius } from "../theme/colors";
import type { AgentMode, ModelInfo, PermissionLevel, ReasoningEffortLevel } from "@copilot-mobile/shared";
import { updatePermissionLevel, updateSessionMode } from "../services/bridge";
import { startVoiceDictation, isVoiceAvailable, type DictationHandle } from "../services/voice-dictation";
import {
    ProviderIcon,
    detectProvider,
    PaperclipIcon,
    MicIcon,
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
    RefreshIcon,
} from "./ProviderIcon";

// --- Types ---

export type ImageAttachment = {
    uri: string;
    width: number;
    height: number;
    fileName: string;
    mimeType: string;
    base64Data: string;
};

export type SendMode = "send" | "queue" | "steer";

type Props = {
    onSend: (content: string, images: ReadonlyArray<ImageAttachment>, mode: SendMode) => void;
    onAbort: () => void;
    isTyping: boolean;
    disabled: boolean;
};

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
                            <CloseIcon size={18} color={colors.textTertiary} />
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
                    placeholderTextColor={colors.textPlaceholder}
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
    options,
    current,
    defaultEffort,
    onSelect,
}: {
    options: ReadonlyArray<ReasoningEffortLevel>;
    current: ReasoningEffortLevel | null;
    defaultEffort: ReasoningEffortLevel | undefined;
    onSelect: (level: ReasoningEffortLevel) => void;
}) {
    return (
        <View style={dropdownStyles.effortList}>
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
                            {isSelected && <Text style={dropdownStyles.checkmark}>✓</Text>}
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
                    </Pressable>
                );
            })}
        </View>
    );
}

// --- Send mode menu ---

function SendModeMenu({
    visible,
    onClose,
    onSelect,
}: {
    visible: boolean;
    onClose: () => void;
    onSelect: (mode: SendMode) => void;
}) {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={dropdownStyles.overlay} onPress={onClose}>
                <Pressable
                    style={[dropdownStyles.container, dropdownStyles.sendModeContainer]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <Pressable
                        style={dropdownStyles.sendModeItem}
                        onPress={() => onSelect("send")}
                    >
                        <Text style={dropdownStyles.sendModeIcon}>→</Text>
                        <Text style={dropdownStyles.sendModeText}>Stop and Send</Text>
                    </Pressable>
                    <Pressable
                        style={dropdownStyles.sendModeItem}
                        onPress={() => onSelect("queue")}
                    >
                        <Text style={dropdownStyles.sendModeIcon}>＋</Text>
                        <View style={dropdownStyles.sendModeRight}>
                            <Text style={dropdownStyles.sendModeText}>Add to Queue</Text>
                            <Text style={dropdownStyles.sendModeShortcut}>Enter</Text>
                        </View>
                    </Pressable>
                    <Pressable
                        style={dropdownStyles.sendModeItem}
                        onPress={() => onSelect("steer")}
                    >
                        <Text style={dropdownStyles.sendModeIcon}>↑</Text>
                        <View style={dropdownStyles.sendModeRight}>
                            <Text style={dropdownStyles.sendModeText}>Steer with Message</Text>
                            <Text style={dropdownStyles.sendModeShortcut}>⌥Enter</Text>
                        </View>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
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
    color: string;
}> = {
    agent: {
        label: "Agent",
        pillLabel: "Agent",
        desc: "Use tools and make changes in the workspace.",
        Icon: CirclePlusIcon,
        color: colors.copilotPurple,
    },
    plan: {
        label: "Plan",
        pillLabel: "Plan",
        desc: "Draft a plan first, then continue when it looks right.",
        Icon: MenuListIcon,
        color: colors.warning,
    },
    ask: {
        label: "Ask",
        pillLabel: "Ask",
        desc: "Read-only analysis for questions and explanations.",
        Icon: HelpCircleIcon,
        color: colors.textLink,
    },
};

const permissionLevelConfig: Record<PermissionLevel, {
    label: string;
    pillLabel: string;
    desc: string;
    Icon: React.FC<{ size?: number; color?: string }>;
    color: string;
}> = {
    default: {
        label: "Default Approvals",
        pillLabel: "Default Approvals",
        desc: "Prompt when approval is needed. Safe reads can auto-approve.",
        Icon: ShieldIcon,
        color: colors.textSecondary,
    },
    bypass: {
        label: "Bypass Approvals",
        pillLabel: "Bypass Approvals",
        desc: "Skip approval prompts but still allow follow-up questions.",
        Icon: ShieldCheckIcon,
        color: colors.success,
    },
    autopilot: {
        label: "Autopilot (Preview)",
        pillLabel: "Autopilot",
        desc: "Auto-approve actions and continue until the task is done.",
        Icon: ZapIcon,
        color: colors.accent,
    },
};

// --- Main ChatInput component ---

// Model bağlam penceresi boyutunu insan okunabilir formata çevir.
function formatCtxWindow(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
    return String(tokens);
}

// Statik slash komutları — VS Code Copilot chat palet komutlarıyla uyumlu.
type SlashCommand = { command: string; description: string; category: string };

const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
    // Sohbet yönetimi
    { command: "/clear", description: "Start new chat, archive current", category: "chat" },
    { command: "/compact", description: "Compact conversation to save context", category: "chat" },
    { command: "/fork", description: "Fork conversation into a new session", category: "chat" },
    { command: "/rename", description: "Rename this chat", category: "chat" },
    // Kod eylemleri
    { command: "/explain", description: "Explain selected code", category: "code" },
    { command: "/fix", description: "Suggest a fix for the current issue", category: "code" },
    { command: "/doc", description: "Add documentation to code", category: "code" },
    { command: "/new", description: "Start a new session", category: "code" },
    { command: "/tests", description: "Generate tests", category: "code" },
    { command: "/newNotebook", description: "Create a new notebook", category: "code" },
    { command: "/setupTests", description: "Set up the test framework", category: "code" },
    // Copilot yapılandırma
    { command: "/agents", description: "Configure custom agents", category: "config" },
    { command: "/debug", description: "Show chat debug view", category: "config" },
    { command: "/hooks", description: "Configure hooks", category: "config" },
    { command: "/instructions", description: "Configure instructions", category: "config" },
    { command: "/models", description: "Open the model picker", category: "config" },
    { command: "/plugins", description: "Manage plugins", category: "config" },
    { command: "/prompts", description: "Configure prompt files", category: "config" },
    { command: "/skills", description: "Configure skills", category: "config" },
    { command: "/tools", description: "Configure tools", category: "config" },
    // Oturum izinleri
    { command: "/autoApprove", description: "Set permissions to bypass approvals", category: "session" },
    { command: "/autopilot", description: "Set permissions to autopilot mode", category: "session" },
    { command: "/yolo", description: "Set permissions to bypass approvals", category: "session" },
    { command: "/disableAutoApprove", description: "Set permissions back to default", category: "session" },
    { command: "/disableYolo", description: "Set permissions back to default", category: "session" },
    { command: "/exitAutopilot", description: "Set permissions back to default", category: "session" },
    // Yardım
    { command: "/help", description: "Show help and available commands", category: "help" },
];

type AutocompleteToken =
    | { kind: "file"; query: string; start: number; end: number }
    | { kind: "slash"; query: string; start: number; end: number }
    | null;

// İmleç konumundan geriye doğru @file veya /command tokeni tespit et.
function detectAutocompleteToken(text: string, cursor: number): AutocompleteToken {
    if (cursor <= 0) return null;
    let i = cursor - 1;
    while (i >= 0) {
        const ch = text[i];
        if (ch === undefined) break;
        if (ch === " " || ch === "\n" || ch === "\t") return null;
        if (ch === "@") {
            // @ başlangıcı yalnızca satır/ kelime başında kabul et.
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

// Workspace ağacından tüm dosya yollarını çıkar.
function collectFilePaths(node: WorkspaceTreeNode | null, out: Array<string>): void {
    if (node === null) return;
    if (node.type === "file") {
        out.push(node.path);
    }
    if (node.children !== undefined) {
        for (const child of node.children) collectFilePaths(child, out);
    }
}

export function ChatInput({ onSend, onAbort, isTyping, disabled }: Props) {
    const [input, setInput] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [images, setImages] = useState<Array<ImageAttachment>>([]);
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [showPermissionPicker, setShowPermissionPicker] = useState(false);
    const [showEffortPicker, setShowEffortPicker] = useState(false);
    const [showPlusMenu, setShowPlusMenu] = useState(false);
    const [showSendMenu, setShowSendMenu] = useState(false);
    const [voiceHandle, setVoiceHandle] = useState<DictationHandle | null>(null);
    const voiceSupported = isVoiceAvailable();
    const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const workspaceTree = useWorkspaceStore((s) => s.tree);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const agentMode = useSessionStore((s) => s.agentMode);
    const setAgentMode = useSessionStore((s) => s.setAgentMode);
    const permissionLevel = useSessionStore((s) => s.permissionLevel);
    const setPermissionLevel = useSessionStore((s) => s.setPermissionLevel);

    const models = useSessionStore((s) => s.models);
    const selectedModel = useSessionStore((s) => s.selectedModel);
    const setSelectedModel = useSessionStore((s) => s.setSelectedModel);
    const reasoningEffort = useSessionStore((s) => s.reasoningEffort);
    const setReasoningEffort = useSessionStore((s) => s.setReasoningEffort);
    const skills = useSessionStore((s) => s.skills);

    const currentModel = models.find((m) => m.id === selectedModel);
    const effortInfo = deriveAvailableReasoningEfforts(currentModel);

    const handleSend = useCallback(
        (mode: SendMode) => {
            const trimmed = input.trim();
            if (trimmed.length === 0 || disabled) return;
            const currentImages = [...images];
            setInput("");
            setImages([]);
            onSend(trimmed, currentImages, mode);
        },
        [input, disabled, images, onSend]
    );

    const handleDefaultSend = useCallback(() => {
        if (isTyping) {
            handleSend("queue");
        } else {
            handleSend("send");
        }
    }, [isTyping, handleSend]);

    const handleToggleVoice = useCallback(async () => {
        if (voiceHandle !== null) {
            voiceHandle.stop();
            setVoiceHandle(null);
            return;
        }
        try {
            const handle = await startVoiceDictation(
                (transcript) => {
                    setInput((prev) => (prev.length === 0 ? transcript : `${prev} ${transcript}`));
                    setVoiceHandle(null);
                },
                (message) => {
                    Alert.alert("Voice error", message);
                    setVoiceHandle(null);
                }
            );
            setVoiceHandle(handle);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Alert.alert(
                "Voice unavailable",
                `Voice dictation requires a development build with expo-speech-recognition.\n\n${message}`
            );
        }
    }, [voiceHandle]);

    // Autocomplete tokeni: @file veya /command.
    const activeToken = useMemo<AutocompleteToken>(
        () => detectAutocompleteToken(input, selection.start),
        [input, selection.start]
    );

    // @files için workspace tree'den dosya yolu listesi.
    const filePaths = useMemo<ReadonlyArray<string>>(() => {
        const out: Array<string> = [];
        collectFilePaths(workspaceTree, out);
        return out;
    }, [workspaceTree]);

    // Token tipine göre filtrelenmiş öneriler (slash + skill komutları dahil).
    const suggestions = useMemo<ReadonlyArray<{ label: string; value: string; hint?: string }>>(() => {
        if (activeToken === null) return [];
        const query = activeToken.query.toLowerCase();
        if (activeToken.kind === "file") {
            return filePaths
                .filter((p) => p.toLowerCase().includes(query))
                .slice(0, 8)
                .map((p) => ({ label: p, value: `@${p} ` }));
        }
        // Slash: önce statik komutlar, sonra skill türetilmiş komutlar.
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

    // Seçilen öneriyi input'a uygula: tokeni değiştirip imleci sona taşı.
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
                    console.warn("[ChatInput] Seçilen görsel base64 verisi içermediği için atlandı");
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
        setShowPlusMenu(false);
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

    const canSend = input.trim().length > 0 && !disabled;

    // Model display label — truncate to keep pill compact
    const modelDisplayName = (() => {
        const name = currentModel?.name ?? selectedModel ?? "Model";
        return name.length > 18 ? name.slice(0, 16) + "…" : name;
    })();
    const effortSuffix = reasoningEffort !== null && effortInfo.supported
        ? ` · ${effortLabels[reasoningEffort]?.label ?? reasoningEffort}`
        : "";

    const supportsVision = currentModel?.supportsVision === true;
    const contextWindowLabel = currentModel?.contextWindowTokens !== undefined
        ? formatCtxWindow(currentModel.contextWindowTokens)
        : null;

    return (
        <View style={styles.container}>
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
                    {/* Slash modunda model ve bağlam penceresi bilgisi */}
                    {activeToken?.kind === "slash" && currentModel !== undefined && (
                        <View style={autocompleteStyles.ctxHeader}>
                            <ProviderIcon
                                provider={detectProvider(currentModel.id)}
                                size={11}
                                color={colors.textTertiary}
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
                <TextInput
                    style={styles.textInput}
                    value={input}
                    onChangeText={setInput}
                    selection={selection}
                    onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                    placeholder="Message, @files, /commands"
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    maxLength={10000}
                    returnKeyType="send"
                    onSubmitEditing={handleDefaultSend}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    blurOnSubmit={false}
                    editable={!disabled}
                    accessibilityLabel="Mesaj yaz"
                />

                {/* Thin separator */}
                <View style={styles.inputSeparator} />

                {/* Single toolbar row: + | model | sliders | spacer | permission-icon | mic | send */}
                <View style={toolbarStyles.row}>
                    {/* + button — opens agent mode + attach menu */}
                    <Pressable
                        style={toolbarStyles.plusBtn}
                        onPress={() => setShowPlusMenu(true)}
                        disabled={disabled}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel="Eylem menüsü"
                    >
                        <Text style={toolbarStyles.plusText}>+</Text>
                    </Pressable>

                    {/* Model selector pill */}
                    <Pressable
                        style={toolbarStyles.modelPill}
                        onPress={() => setShowModelPicker(true)}
                        disabled={disabled}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        accessibilityLabel="Model seç"
                    >
                        <ProviderIcon provider={detectProvider(currentModel?.id ?? selectedModel)} size={13} color={colors.textSecondary} />
                        <Text style={toolbarStyles.modelText} numberOfLines={1}>
                            {modelDisplayName}{effortSuffix}
                        </Text>
                        <ChevronDownIcon size={10} color={colors.textTertiary} />
                    </Pressable>

                    {contextWindowLabel !== null && (
                        <View style={toolbarStyles.ctxBadge}>
                            <Text style={toolbarStyles.ctxBadgeText}>
                                {contextWindowLabel} ctx
                            </Text>
                        </View>
                    )}

                    {/* Thinking effort */}
                    {effortInfo.supported && (
                        <Pressable
                            style={toolbarStyles.toolBtn}
                            onPress={() => setShowEffortPicker(true)}
                            disabled={disabled}
                            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                            accessibilityLabel="Düşünme çabası"
                        >
                            <SlidersIcon size={15} color={colors.textSecondary} />
                        </Pressable>
                    )}

                    <View style={toolbarStyles.spacer} />

                    {/* Permission icon only */}
                    <Pressable
                        style={toolbarStyles.toolBtn}
                        onPress={() => setShowPermissionPicker(true)}
                        disabled={disabled}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                        accessibilityLabel="İzin seviyesi"
                    >
                        {(() => {
                            const cfg = permissionLevelConfig[permissionLevel];
                            return <cfg.Icon size={16} color={colors.textSecondary} />;
                        })()}
                    </Pressable>

                    {/* Mic — only shown when native module is registered (dev build) */}
                    {voiceSupported && (
                        <Pressable
                            style={[toolbarStyles.toolBtn, voiceHandle !== null && toolbarStyles.toolBtnActive]}
                            onPress={handleToggleVoice}
                            disabled={disabled}
                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                            accessibilityLabel={voiceHandle !== null ? "Sesli dikte durdur" : "Sesli dikte başlat"}
                        >
                            <MicIcon size={16} color={voiceHandle !== null ? colors.accent : colors.textSecondary} />
                        </Pressable>
                    )}

                    {/* Send / Abort / Queue */}
                    {isTyping && canSend ? (
                        <View style={toolbarStyles.sendGroup}>
                            <Pressable
                                style={styles.sendButton}
                                onPress={handleDefaultSend}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityLabel="Mesaj gönder"
                            >
                                <ArrowUpIcon size={16} color={colors.textOnAccent} />
                            </Pressable>
                            <Pressable
                                style={toolbarStyles.sendMenuButton}
                                onPress={() => setShowSendMenu(true)}
                                hitSlop={4}
                            >
                                <ChevronDownIcon size={12} color={colors.textPrimary} />
                            </Pressable>
                        </View>
                    ) : isTyping ? (
                        <Pressable
                            style={styles.abortButton}
                            onPress={onAbort}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="İsteği durdur"
                        >
                            <View style={styles.abortIcon} />
                        </Pressable>
                    ) : canSend ? (
                        <Pressable
                            style={styles.sendButton}
                            onPress={() => handleSend("send")}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Mesaj gönder"
                        >
                            <ArrowUpIcon size={16} color={colors.textOnAccent} />
                        </Pressable>
                    ) : (
                        <View style={[styles.sendButton, styles.sendButtonDisabled]}>
                            <ArrowUpIcon size={16} color={colors.textTertiary} />
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

            {/* + menu: agent mode + attach image */}
            <DropdownModal
                visible={showPlusMenu}
                onClose={() => setShowPlusMenu(false)}
                title="Mode & Actions"
            >
                <Text style={dropdownStyles.sectionLabel}>Agent Mode</Text>
                <View style={dropdownStyles.effortList}>
                    {(["agent", "plan", "ask"] as const).map((mode) => {
                        const cfg = agentModeConfig[mode];
                        const isSelected = agentMode === mode;
                        return (
                            <Pressable
                                key={mode}
                                style={[dropdownStyles.effortItem, isSelected && dropdownStyles.effortItemSelected]}
                                onPress={() => {
                                    void handleAgentModeSelect(mode);
                                    setShowPlusMenu(false);
                                }}
                            >
                                <View style={dropdownStyles.effortItemLeft}>
                                    <View style={dropdownStyles.checkmarkSlot}>
                                        {isSelected && <CheckIcon size={13} color={colors.textPrimary} />}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[
                                            dropdownStyles.effortLabel,
                                            isSelected && { color: colors.textPrimary, fontWeight: "600" },
                                        ]}>
                                            {cfg.label}
                                        </Text>
                                        <Text style={dropdownStyles.effortDesc}>{cfg.desc}</Text>
                                    </View>
                                </View>
                                <cfg.Icon size={18} color={isSelected ? colors.textSecondary : colors.textTertiary} />
                            </Pressable>
                        );
                    })}
                </View>
                <>
                    <View style={dropdownStyles.sectionDivider} />
                    <Text style={dropdownStyles.sectionLabel}>Attach</Text>
                    <Pressable
                        style={dropdownStyles.effortItem}
                        onPress={handleAttachImage}
                    >
                        <View style={dropdownStyles.effortItemLeft}>
                            <View style={dropdownStyles.checkmarkSlot} />
                            <View style={{ flex: 1 }}>
                                <Text style={dropdownStyles.effortLabel}>Attach Image</Text>
                                <Text style={dropdownStyles.effortDesc}>Pick a photo from your library</Text>
                            </View>
                        </View>
                        <PaperclipIcon size={18} color={colors.textTertiary} />
                    </Pressable>
                </>
            </DropdownModal>

            {/* Permission level picker */}
            <DropdownModal
                visible={showPermissionPicker}
                onClose={() => setShowPermissionPicker(false)}
                title="Permission Level"
            >
                <View style={dropdownStyles.effortList}>
                    {(["default", "bypass", "autopilot"] as const).map((level) => {
                        const cfg = permissionLevelConfig[level];
                        const isSelected = permissionLevel === level;
                        return (
                            <Pressable
                                key={level}
                                style={[dropdownStyles.effortItem, isSelected && dropdownStyles.effortItemSelected]}
                                onPress={() => { void handlePermissionLevelSelect(level); }}
                            >
                                <View style={dropdownStyles.effortItemLeft}>
                                    <View style={dropdownStyles.checkmarkSlot}>
                                        {isSelected && <CheckIcon size={13} color={cfg.color} />}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[
                                            dropdownStyles.effortLabel,
                                            isSelected && { color: cfg.color, fontWeight: "700" },
                                        ]}>
                                            {cfg.label}
                                        </Text>
                                        <Text style={dropdownStyles.effortDesc}>{cfg.desc}</Text>
                                    </View>
                                </View>
                                <cfg.Icon size={18} color={isSelected ? cfg.color : colors.textTertiary} />
                            </Pressable>
                        );
                    })}
                </View>
            </DropdownModal>

            {/* Thinking effort picker */}
            {effortInfo.supported && (
                <DropdownModal
                    visible={showEffortPicker}
                    onClose={() => setShowEffortPicker(false)}
                    title="Thinking Effort"
                >
                    <EffortSelectorContent
                        options={effortInfo.options as ReasoningEffortLevel[]}
                        current={reasoningEffort}
                        defaultEffort={currentModel?.defaultReasoningEffort}
                        onSelect={(level) => {
                            setReasoningEffort(level);
                            setShowEffortPicker(false);
                        }}
                    />
                </DropdownModal>
            )}

            {/* Send mode menu */}
            <SendModeMenu
                visible={showSendMenu}
                onClose={() => setShowSendMenu(false)}
                onSelect={handleSendModeSelect}
            />
        </View>
    );
}

// --- Açılır menü stilleri ---

const dropdownStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: "flex-end",
    },
    container: {
        backgroundColor: colors.bg,
        borderTopLeftRadius: borderRadius.xl,
        borderTopRightRadius: borderRadius.xl,
        maxHeight: "85%",
        paddingBottom: Platform.OS === "ios" ? 34 : 16,
    },
    scroll: {
        maxHeight: 600,
    },
    scrollContent: {
        paddingBottom: spacing.sm,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    title: {
        color: colors.textPrimary,
        fontSize: fs.base,
        fontWeight: "600",
    },
    closeIcon: {
        color: colors.textTertiary,
        fontSize: fs.lg,
    },
    searchContainer: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    searchInput: {
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        fontSize: fs.md,
        color: colors.textPrimary,
    },
    list: {
        maxHeight: 300,
    },
    item: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    itemSelected: {
        backgroundColor: colors.accentMuted,
    },
    itemDisabled: {
        opacity: 0.4,
    },
    itemLeft: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
    },
    checkmark: {
        color: colors.accent,
        fontSize: fs.base,
        fontWeight: "700",
        marginRight: spacing.sm,
        width: 18,
    },
    itemText: {
        color: colors.textPrimary,
        fontSize: fs.base,
    },
    itemTextSelected: {
        color: colors.textOnAccent,
        fontWeight: "600",
    },
    itemTextDisabled: {
        color: colors.textTertiary,
    },
    badgeText: {
        color: colors.textTertiary,
        fontSize: fs.sm,
        marginLeft: spacing.sm,
    },
    sectionLabel: {
        color: colors.textTertiary,
        fontSize: fs.sm,
        fontWeight: "600",
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: 6,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    sectionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginTop: spacing.sm,
        marginHorizontal: spacing.lg,
    },
    effortList: {
        paddingBottom: spacing.sm,
    },
    effortItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    effortItemSelected: {
        backgroundColor: colors.accentMuted,
    },
    effortItemLeft: {
        flexDirection: "row",
        alignItems: "flex-start",
        flex: 1,
    },
    checkmarkSlot: {
        width: 22,
        alignItems: "center",
        marginTop: 2,
    },
    effortLabel: {
        color: colors.textPrimary,
        fontSize: fs.base,
        fontWeight: "500",
    },
    effortLabelSelected: {
        color: colors.textOnAccent,
        fontWeight: "600",
    },
    effortDesc: {
        color: colors.textTertiary,
        fontSize: fs.sm,
        marginTop: 2,
    },
    sendModeContainer: {
        maxHeight: undefined,
        borderTopLeftRadius: borderRadius.lg,
        borderTopRightRadius: borderRadius.lg,
    },
    sendModeItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    sendModeIcon: {
        color: colors.textPrimary,
        fontSize: fs.lg,
        width: 28,
    },
    sendModeRight: {
        flex: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    sendModeText: {
        color: colors.textPrimary,
        fontSize: fs.base,
    },
    sendModeShortcut: {
        color: colors.textTertiary,
        fontSize: fs.sm,
    },
});

// --- Ek dosya stilleri ---

const attachStyles = StyleSheet.create({
    row: {
        maxHeight: 72,
        marginBottom: 6,
    },
    rowContent: {
        paddingHorizontal: 4,
        gap: spacing.sm,
    },
    chip: {
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        maxWidth: 200,
    },
    chipClose: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.bgElevated,
        justifyContent: "center",
        alignItems: "center",
    },
    chipCloseText: {
        color: colors.textPrimary,
        fontSize: 9,
        fontWeight: "700",
    },
    chipImage: {
        width: 32,
        height: 32,
        borderRadius: 4,
    },
    chipName: {
        color: colors.textPrimary,
        fontSize: fs.xs,
        maxWidth: 120,
    },
});

// --- Araç çubuğu stilleri ---

const toolbarStyles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        minHeight: 36,
        gap: 4,
        overflow: "hidden",
    },
    plusBtn: {
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
    },
    plusText: {
        color: colors.textSecondary,
        fontSize: 22,
        fontWeight: "300",
        lineHeight: 24,
        includeFontPadding: false,
    },
    toolBtn: {
        width: 32,
        height: 32,
        borderRadius: borderRadius.md,
        justifyContent: "center",
        alignItems: "center",
    },
    toolBtnDimmed: {
        opacity: 0.3,
    },
    toolBtnActive: {
        backgroundColor: colors.accentMuted,
    },
    modelPill: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: borderRadius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: "transparent",
        gap: 4,
        flexShrink: 1,
        minWidth: 0,
    },
    modelText: {
        color: colors.textSecondary,
        fontSize: fs.sm,
        fontWeight: "500",
        flexShrink: 1,
    },
    ctxBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: borderRadius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
    },
    ctxBadgeText: {
        color: colors.textTertiary,
        fontSize: fs.xs,
        fontWeight: "600",
    },
    spacer: {
        flex: 1,
    },
    sendGroup: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    sendMenuButton: {
        width: 22,
        height: 32,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: borderRadius.sm,
    },
});

// --- Ana giriş stilleri ---

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: Platform.OS === "ios" ? 12 : 12,
        backgroundColor: colors.bg,
    },
    inputCard: {
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
    },
    inputCardFocused: {
        borderColor: colors.accent,
    },
    inputSeparator: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginHorizontal: -spacing.md,
        marginTop: spacing.xs,
        marginBottom: 0,
    },
    textInput: {
        fontSize: fs.base,
        color: colors.textPrimary,
        maxHeight: 120,
        minHeight: 36,
        paddingVertical: Platform.OS === "ios" ? 6 : 4,
        textAlignVertical: "top",
    },
    sendButton: {
        width: 30,
        height: 30,
        borderRadius: borderRadius.md,
        backgroundColor: colors.accent,
        justifyContent: "center",
        alignItems: "center",
    },
    sendButtonDisabled: {
        backgroundColor: colors.bgElevated,
    },
    abortButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: colors.error,
        justifyContent: "center",
        alignItems: "center",
    },
    abortIcon: {
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: colors.textOnAccent,
    },
});

const autocompleteStyles = StyleSheet.create({
    popover: {
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: borderRadius.md,
        marginBottom: 6,
        overflow: "hidden",
        // Fixed height so keyboard stays visible and menu is scrollable
        maxHeight: 220,
    },
    list: {
        // Makes the list area scrollable when items overflow maxHeight
        flexShrink: 1,
    },
    ctxHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: spacing.md,
        paddingVertical: 7,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    list: {
        maxHeight: 240,
    },
    },
    ctxModelName: {
        fontSize: fs.xs,
        color: colors.textTertiary,
        fontWeight: "500",
        flexShrink: 1,
    },
    ctxSize: {
        fontSize: fs.xs,
        color: colors.textTertiary,
    },
    item: {
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    itemPressed: {
        backgroundColor: colors.bgOverlay,
    },
    label: {
        fontSize: fs.sm,
        color: colors.textPrimary,
        fontWeight: "500",
    },
    hint: {
        fontSize: fs.xs,
        color: colors.textTertiary,
        marginTop: 2,
    },
});

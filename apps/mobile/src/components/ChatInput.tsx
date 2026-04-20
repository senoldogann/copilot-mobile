// Mesaj giriş çubuğu — GitHub Copilot mobil stili model/effort seçiciler, resim ekleme, gönderim modları

import React, { useState, useCallback } from "react";
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
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSessionStore, deriveAvailableReasoningEfforts } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import type { WorkspaceTreeNode } from "@copilot-mobile/shared";
import { colors, spacing, fontSize as fs, borderRadius } from "../theme/colors";
import type { AgentMode, ModelInfo, PermissionLevel, ReasoningEffortLevel } from "@copilot-mobile/shared";
import { Feather, Ionicons } from "@expo/vector-icons";
import { updatePermissionLevel, updateSessionMode } from "../services/bridge";
import { startVoiceDictation, type DictationHandle } from "../services/voice-dictation";
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
    desc: string;
    iconName: React.ComponentProps<typeof Feather>["name"];
    color: string;
}> = {
    agent: {
        label: "Agent",
        desc: "Use tools and make changes in the workspace.",
        iconName: "cpu",
        color: colors.copilotPurple,
    },
    plan: {
        label: "Plan",
        desc: "Draft a plan first, then continue when it looks right.",
        iconName: "list",
        color: colors.warning,
    },
    ask: {
        label: "Ask",
        desc: "Read-only analysis for questions and explanations.",
        iconName: "help-circle",
        color: colors.textLink,
    },
};

const permissionLevelConfig: Record<PermissionLevel, {
    label: string;
    desc: string;
    iconName: React.ComponentProps<typeof Ionicons>["name"];
    color: string;
}> = {
    default: {
        label: "Default",
        desc: "Prompt when approval is needed. Safe reads can auto-approve.",
        iconName: "shield-outline",
        color: colors.textSecondary,
    },
    bypass: {
        label: "Bypass",
        desc: "Skip approval prompts but still allow follow-up questions.",
        iconName: "shield-checkmark-outline",
        color: colors.success,
    },
    autopilot: {
        label: "Autopilot",
        desc: "Auto-approve actions and continue until the task is done.",
        iconName: "flash-outline",
        color: colors.accent,
    },
};

// --- Main ChatInput component ---

// Statik slash komutları.
const SLASH_COMMANDS: ReadonlyArray<{ command: string; description: string }> = [
    { command: "/clear", description: "Clear conversation" },
    { command: "/help", description: "Show help" },
    { command: "/explain", description: "Explain selected code" },
    { command: "/fix", description: "Suggest a fix" },
    { command: "/tests", description: "Generate tests" },
    { command: "/new", description: "Start a new session" },
    { command: "/doc", description: "Add documentation" },
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
    const [showAgentPicker, setShowAgentPicker] = useState(false);
    const [showSendMenu, setShowSendMenu] = useState(false);
    const [voiceHandle, setVoiceHandle] = useState<DictationHandle | null>(null);
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

    const handlePickImage = useCallback(async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsMultipleSelection: true,
            quality: 0.8,
            base64: true,
        });

        if (result.canceled) return;

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
        setImages((prev) => [...prev, ...newImages]);
    }, []);

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
            setShowAgentPicker(false);
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

    // Model display label
    const modelDisplayName = currentModel?.name ?? selectedModel ?? "Model";
    const effortSuffix = reasoningEffort !== null && effortInfo.supported
        ? ` · ${effortLabels[reasoningEffort]?.label ?? reasoningEffort}`
        : "";

    const supportsVision = currentModel?.supportsVision === true;

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
        <View style={[
            styles.inputCard,
            isFocused && styles.inputCardFocused,
        ]}>
            <TextInput
                style={styles.textInput}
                value={input}
                onChangeText={setInput}
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

            {/* Toolbar row inside the card */}
            <View style={toolbarStyles.row}>
                {/* Attach / image button */}
                <Pressable
                    style={[
                        toolbarStyles.toolBtn,
                        !supportsVision && toolbarStyles.toolBtnDimmed,
                    ]}
                    onPress={handlePickImage}
                    disabled={disabled || !supportsVision}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Fotoğraf ekle"
                >
                    <PaperclipIcon size={16} color={colors.textSecondary} />
                </Pressable>

                {/* Model selector pill */}
                <Pressable
                    style={toolbarStyles.modelPill}
                    onPress={() => setShowModelPicker(true)}
                    disabled={disabled}
                    hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                    accessibilityLabel="Model seç"
                >
                    <ProviderIcon provider={detectProvider(currentModel?.id ?? selectedModel)} size={13} color={colors.textPrimary} />
                    <Text style={toolbarStyles.modelText} numberOfLines={1}>
                        {modelDisplayName}{effortSuffix}
                    </Text>
                    <ChevronDownIcon size={11} color={colors.textTertiary} />
                </Pressable>

                {/* Session settings: agent + permission + effort */}
                <Pressable
                    style={toolbarStyles.toolBtn}
                    onPress={() => setShowAgentPicker(true)}
                    disabled={disabled}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    accessibilityLabel="Session ayarları"
                >
                    <SlidersIcon size={16} color={colors.textSecondary} />
                </Pressable>

                <View style={toolbarStyles.spacer} />

                {/* Mic — sesli dikte */}
                <Pressable
                    style={[toolbarStyles.toolBtn, voiceHandle !== null && toolbarStyles.toolBtnActive]}
                    onPress={handleToggleVoice}
                    disabled={disabled}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    accessibilityLabel={voiceHandle !== null ? "Sesli dikte durdur" : "Sesli dikte başlat"}
                >
                    <MicIcon size={16} color={voiceHandle !== null ? colors.accent : colors.textSecondary} />
                </Pressable>

                {/* Send / Abort / Queue button */}
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

            {/* Combined session settings: agent + permission + effort */}
            <DropdownModal
                visible={showAgentPicker}
                onClose={() => setShowAgentPicker(false)}
                title="Session Settings"
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
                                }}
                            >
                                <View style={dropdownStyles.effortItemLeft}>
                                    <View style={dropdownStyles.checkmarkSlot}>
                                        {isSelected && <Feather name="check" size={13} color={cfg.color} />}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={[
                                                dropdownStyles.effortLabel,
                                                isSelected && { color: cfg.color, fontWeight: "700" },
                                            ]}
                                        >
                                            {cfg.label}
                                        </Text>
                                        <Text style={dropdownStyles.effortDesc}>{cfg.desc}</Text>
                                    </View>
                                </View>
                                <Feather name={cfg.iconName} size={18} color={isSelected ? cfg.color : colors.textTertiary} />
                            </Pressable>
                        );
                    })}
                </View>
                <View style={dropdownStyles.sectionDivider} />
                <Text style={dropdownStyles.sectionLabel}>Permissions</Text>
                <View style={dropdownStyles.effortList}>
                    {(["default", "bypass", "autopilot"] as const).map((level) => {
                        const cfg = permissionLevelConfig[level];
                        const isSelected = permissionLevel === level;
                        return (
                            <Pressable
                                key={level}
                                style={[dropdownStyles.effortItem, isSelected && dropdownStyles.effortItemSelected]}
                                onPress={() => {
                                    void handlePermissionLevelSelect(level);
                                }}
                            >
                                <View style={dropdownStyles.effortItemLeft}>
                                    <View style={dropdownStyles.checkmarkSlot}>
                                        {isSelected && <Feather name="check" size={13} color={cfg.color} />}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={[
                                                dropdownStyles.effortLabel,
                                                isSelected && { color: cfg.color, fontWeight: "700" },
                                            ]}
                                        >
                                            {cfg.label}
                                        </Text>
                                        <Text style={dropdownStyles.effortDesc}>{cfg.desc}</Text>
                                    </View>
                                </View>
                                <Ionicons name={cfg.iconName} size={18} color={isSelected ? cfg.color : colors.textTertiary} />
                            </Pressable>
                        );
                    })}
                </View>
                {effortInfo.supported && (
                    <>
                        <View style={dropdownStyles.sectionDivider} />
                        <Text style={dropdownStyles.sectionLabel}>Thinking Effort</Text>
                        <EffortSelectorContent
                            options={effortInfo.options as ReasoningEffortLevel[]}
                            current={reasoningEffort}
                            defaultEffort={currentModel?.defaultReasoningEffort}
                            onSelect={(level) => {
                                setReasoningEffort(level);
                                setShowAgentPicker(false);
                            }}
                        />
                    </>
                )}
            </DropdownModal>

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
        minHeight: 38,
        gap: 4,
    },
    toolBtn: {
        width: 34,
        height: 34,
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
    attachIcon: {
        fontSize: 16,
    },
    gearIcon: {
        color: colors.textSecondary,
        fontSize: fs.base,
    },
    modelPill: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: "transparent",
        gap: 4,
        maxWidth: 180,
    },
    modelText: {
        color: colors.textSecondary,
        fontSize: fs.sm,
        fontWeight: "500",
        flex: 1,
    },
    selectorPill: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
        gap: 4,
        maxWidth: 160,
    },
    selectorPillText: {
        color: colors.textSecondary,
        fontSize: fs.sm,
        fontWeight: "500",
        flex: 1,
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
        height: 34,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: borderRadius.sm,
    },
    sendMenuChevron: {
        color: colors.textPrimary,
        fontSize: fs.sm,
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

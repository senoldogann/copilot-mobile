// Mesaj giriş çubuğu — GitHub Copilot mobil stili model/effort seçiciler, resim ekleme, gönderim modları

import React, { useState, useCallback, useRef } from "react";
import {
    View,
    TextInput,
    Pressable,
    Text,
    StyleSheet,
    Platform,
    Modal,
    FlatList,
    Image,
    ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSessionStore, deriveAvailableReasoningEfforts } from "../stores/session-store";
import { colors, spacing, fontSize as fs, borderRadius } from "../theme/colors";
import type { ModelInfo, ReasoningEffortLevel } from "@copilot-mobile/shared";

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
                            <Text style={dropdownStyles.closeIcon}>✕</Text>
                        </Pressable>
                    </View>
                    {children}
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

    const renderModel = useCallback(
        ({ item }: { item: ModelInfo }) => {
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
        },
        [selectedModel, onSelect]
    );

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
            <FlatList
                data={filtered as ModelInfo[]}
                renderItem={renderModel}
                keyExtractor={(item) => item.id}
                style={dropdownStyles.list}
                keyboardShouldPersistTaps="handled"
            />
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
            <Text style={dropdownStyles.sectionLabel}>Thinking Effort</Text>
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

// --- Main ChatInput component ---

export function ChatInput({ onSend, onAbort, isTyping, disabled }: Props) {
    const [input, setInput] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [images, setImages] = useState<Array<ImageAttachment>>([]);
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [showEffortPicker, setShowEffortPicker] = useState(false);
    const [showSendMenu, setShowSendMenu] = useState(false);

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

    const handleEffortSelect = useCallback(
        (level: ReasoningEffortLevel) => {
            setReasoningEffort(level);
            setShowEffortPicker(false);
        },
        [setReasoningEffort]
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

            {/* Input area */}
            <View style={[
                styles.inputRow,
                isFocused && styles.inputRowFocused,
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
            </View>

            {/* Toolbar row */}
            <View style={toolbarStyles.row}>
                {/* + attach button */}
                <Pressable
                    style={[
                        toolbarStyles.iconButton,
                        !supportsVision && toolbarStyles.iconButtonDimmed,
                    ]}
                    onPress={handlePickImage}
                    disabled={disabled || !supportsVision}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Fotoğraf ekle"
                >
                    <Text style={toolbarStyles.iconText}>＋</Text>
                </Pressable>

                {/* Mode label */}
                <View style={toolbarStyles.modePill}>
                    <Text style={toolbarStyles.modeIcon}>◇</Text>
                    <Text style={toolbarStyles.modeText}>Agent</Text>
                </View>

                {/* Model + Effort selector */}
                <Pressable
                    style={toolbarStyles.modelPill}
                    onPress={() => setShowModelPicker(true)}
                    disabled={disabled}
                    accessibilityLabel="Model seç"
                >
                    <Text style={toolbarStyles.modelText} numberOfLines={1}>
                        {modelDisplayName}{effortSuffix}
                    </Text>
                    <Text style={toolbarStyles.chevron}>⌄</Text>
                </Pressable>

                {/* Effort toggle (if supported) */}
                {effortInfo.supported && effortInfo.listKnown && (
                    <Pressable
                        style={toolbarStyles.iconButton}
                        onPress={() => setShowEffortPicker(true)}
                        disabled={disabled}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel="Çaba seviyesi seç"
                    >
                        <Text style={toolbarStyles.iconText}>⚙</Text>
                    </Pressable>
                )}

                <View style={toolbarStyles.spacer} />

                {/* Send / Abort / Queue button */}
                {isTyping && canSend ? (
                    <View style={toolbarStyles.sendGroup}>
                        <Pressable
                            style={styles.sendButton}
                            onPress={handleDefaultSend}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Mesaj gönder"
                        >
                            <Text style={styles.sendIcon}>↑</Text>
                        </Pressable>
                        <Pressable
                            style={toolbarStyles.sendMenuButton}
                            onPress={() => setShowSendMenu(true)}
                            hitSlop={4}
                        >
                            <Text style={toolbarStyles.sendMenuChevron}>⌄</Text>
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
                        <Text style={styles.sendIcon}>↑</Text>
                    </Pressable>
                ) : (
                    <View style={[styles.sendButton, styles.sendButtonDisabled]}>
                        <Text style={[styles.sendIcon, styles.sendIconDisabled]}>↑</Text>
                    </View>
                )}
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

            {/* Effort picker modal */}
            <DropdownModal
                visible={showEffortPicker}
                onClose={() => setShowEffortPicker(false)}
                title="Thinking Effort"
            >
                <EffortSelectorContent
                    options={effortInfo.options as ReasoningEffortLevel[]}
                    current={reasoningEffort}
                    defaultEffort={currentModel?.defaultReasoningEffort}
                    onSelect={handleEffortSelect}
                />
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
        maxHeight: "60%",
        paddingBottom: Platform.OS === "ios" ? 34 : 16,
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
    effortList: {
        paddingBottom: spacing.sm,
    },
    effortItem: {
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
        paddingTop: 6,
        gap: 6,
    },
    iconButton: {
        width: 28,
        height: 28,
        borderRadius: borderRadius.sm,
        justifyContent: "center",
        alignItems: "center",
    },
    iconButtonDimmed: {
        opacity: 0.3,
    },
    iconText: {
        color: colors.textSecondary,
        fontSize: fs.lg,
    },
    modePill: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        gap: 4,
    },
    modeIcon: {
        color: colors.textSecondary,
        fontSize: fs.sm,
    },
    modeText: {
        color: colors.textSecondary,
        fontSize: fs.sm,
        fontWeight: "500",
    },
    modelPill: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        gap: 4,
        maxWidth: 200,
    },
    modelText: {
        color: colors.textSecondary,
        fontSize: fs.sm,
    },
    chevron: {
        color: colors.textTertiary,
        fontSize: fs.sm,
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
        height: 30,
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
        paddingBottom: Platform.OS === "ios" ? 8 : 10,
        backgroundColor: colors.bg,
    },
    inputRow: {
        flexDirection: "row",
        alignItems: "flex-end",
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.lg,
        paddingVertical: 6,
    },
    inputRowFocused: {
        borderColor: colors.accent,
    },
    textInput: {
        flex: 1,
        fontSize: fs.base,
        color: colors.textPrimary,
        maxHeight: 120,
        minHeight: 36,
        paddingVertical: Platform.OS === "ios" ? 8 : 6,
        textAlignVertical: "center",
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
    sendIcon: {
        color: colors.textOnAccent,
        fontSize: fs.lg,
        fontWeight: "700",
        marginTop: -1,
    },
    sendIconDisabled: {
        color: colors.textTertiary,
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

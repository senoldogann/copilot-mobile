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
    AppState,
    Keyboard,
    Platform,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useSessionStore } from "../stores/session-store";
import { deriveAvailableReasoningEfforts } from "../stores/session-store-helpers";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useConnectionStore } from "../stores/connection-store";
import type { WorkspaceTreeNode } from "@copilot-mobile/shared";
import type { AgentMode, ModelInfo, PermissionLevel, ReasoningEffortLevel } from "@copilot-mobile/shared";
import { MODEL_UNKNOWN } from "@copilot-mobile/shared";
import {
    requestWorkspaceTree,
    searchWorkspaceFiles,
    updatePermissionLevel,
    updateSessionMode,
} from "../services/bridge";
import { subscribeComposerInsert } from "../services/composer-events";
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
    AgentIcon,
    MicrophoneIcon,
    HashIcon,
    AtIcon,
    FileTextIcon,
    TerminalIcon,
    GitHubIcon,
} from "./ProviderIcon";
import { ReasoningEffortIcon } from "./Icons";
import {
    MAX_MESSAGE_IMAGE_ATTACHMENTS,
} from "../utils/attachment-upload";
import {
    shouldAutoStopVoiceCapture,
    shouldDismissVoiceInputError,
} from "../utils/voice-input";
import { openFeedbackEmail } from "../services/feedback";

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
    iconNode,
    children,
}: {
    visible: boolean;
    onClose: () => void;
    title: string;
    iconNode?: React.ReactNode;
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
                        <View style={dropdownStyles.headerLeft}>
                            {iconNode !== undefined && (
                                <View style={dropdownStyles.headerIconBadge}>
                                    {iconNode}
                                </View>
                            )}
                            <Text style={dropdownStyles.title}>{title}</Text>
                        </View>
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

function DropdownSectionLabel({
    label,
    iconNode,
}: {
    label: string;
    iconNode: React.ReactNode;
}) {
    const dropdownStyles = useThemedStyles(createDropdownStyles);

    return (
        <View style={dropdownStyles.sectionLabelRow}>
            <View style={dropdownStyles.sectionLabelIcon}>
                {iconNode}
            </View>
            <Text style={dropdownStyles.sectionLabel}>{label}</Text>
        </View>
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
            <DropdownSectionLabel
                label="Agent Mode"
                iconNode={<AgentIcon size={14} color={theme.colors.textTertiary} />}
            />
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
            {options.length > 0 && (
                <DropdownSectionLabel
                    label="Thinking Effort"
                    iconNode={<SlidersIcon size={14} color={theme.colors.textTertiary} />}
                />
            )}
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
            <DropdownSectionLabel
                label="Permission Level"
                iconNode={<ShieldIcon size={14} color={theme.colors.textTertiary} />}
            />
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

type AutocompleteSuggestion = {
    label: string;
    value: string;
    hint?: string;
    category?: string;
    icon: React.ReactNode;
};

type InputSelection = {
    start: number;
    end: number;
};

type VoiceCaptureState = {
    active: boolean;
    baseInput: string;
    baseSelection: InputSelection;
    transcript: string;
};

const PARTICIPANT_SUGGESTIONS: ReadonlyArray<AutocompleteSuggestion> = [
    {
        label: "@workspace",
        value: "@workspace ",
        hint: "Ask about your project, files, and code structure",
        category: "Participant",
        icon: <AtIcon size={14} color="#a0a3a2" />,
    },
    {
        label: "@terminal",
        value: "@terminal ",
        hint: "Focus the prompt on terminal output and shell work",
        category: "Participant",
        icon: <TerminalIcon size={14} color="#f78166" />,
    },
    {
        label: "@github",
        value: "@github ",
        hint: "Use GitHub-aware context for issues, PRs, and repository questions",
        category: "Participant",
        icon: <GitHubIcon size={14} color="#a0a3a2" />,
    },
];

const CONTEXT_SUGGESTIONS: ReadonlyArray<AutocompleteSuggestion> = [
    {
        label: "#codebase",
        value: "#codebase ",
        hint: "Reference the wider workspace instead of a single file",
        category: "Context",
        icon: <HashIcon size={14} color="#a0a3a2" />,
    },
    {
        label: "#terminal",
        value: "#terminal ",
        hint: "Include recent terminal context in the next prompt",
        category: "Context",
        icon: <TerminalIcon size={14} color="#f78166" />,
    },
];

const VOICE_CONTEXTUAL_STRINGS: ReadonlyArray<string> = [
    "TypeScript",
    "JavaScript",
    "React Native",
    "Expo",
    "pnpm",
    "tsx",
    "props",
    "state",
    "component",
    "workspace",
];

const DEFAULT_SPEECH_LOCALE = "en-US";
const MAX_ATTACHMENT_LONGEST_EDGE = 1600;
const COMPATIBLE_ATTACHMENT_MAX_BASE64_CHARS = 120_000;
const COMPATIBLE_ATTACHMENT_ATTEMPTS: ReadonlyArray<{ longestEdge: number; compress: number }> = [
    { longestEdge: 1280, compress: 0.72 },
    { longestEdge: 1024, compress: 0.66 },
    { longestEdge: 800, compress: 0.58 },
    { longestEdge: 640, compress: 0.5 },
    { longestEdge: 512, compress: 0.48 },
    { longestEdge: 384, compress: 0.46 },
    { longestEdge: 256, compress: 0.42 },
];

const PREFERRED_SPEECH_LOCALES: Readonly<Record<string, string>> = {
    en: "en-US",
    tr: "tr-TR",
};

type SpeechLocaleResolution = {
    requestedLocale: string;
    resolvedLocale: string;
    usedFallback: boolean;
};

function normalizeSpeechLocale(locale: string): string {
    const normalizedLocale = locale.trim().replaceAll("_", "-");
    return normalizedLocale.length > 0 ? normalizedLocale : DEFAULT_SPEECH_LOCALE;
}

function getRequestedSpeechLocale(): string {
    return normalizeSpeechLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}

function findSupportedSpeechLocale(
    requestedLocale: string,
    supportedLocales: ReadonlyArray<string>
): string | null {
    const exactMatch = supportedLocales.find((locale) => locale.toLowerCase() === requestedLocale.toLowerCase());
    if (exactMatch !== undefined) {
        return exactMatch;
    }

    const languageCode = requestedLocale.split("-")[0]?.toLowerCase() ?? "";
    if (languageCode.length === 0) {
        return null;
    }

    const preferredLocale = PREFERRED_SPEECH_LOCALES[languageCode];
    if (preferredLocale !== undefined) {
        const preferredMatch = supportedLocales.find((locale) => locale.toLowerCase() === preferredLocale.toLowerCase());
        if (preferredMatch !== undefined) {
            return preferredMatch;
        }
    }

    const territoryDefaultLocale = `${languageCode}-${languageCode.toUpperCase()}`;
    const territoryDefaultMatch = supportedLocales.find((locale) => (
        locale.toLowerCase() === territoryDefaultLocale.toLowerCase()
    ));
    if (territoryDefaultMatch !== undefined) {
        return territoryDefaultMatch;
    }

    const languageMatch = supportedLocales.find((locale) => (
        locale.toLowerCase() === languageCode || locale.toLowerCase().startsWith(`${languageCode}-`)
    ));
    if (languageMatch !== undefined) {
        return languageMatch;
    }

    const defaultMatch = supportedLocales.find((locale) => locale.toLowerCase() === DEFAULT_SPEECH_LOCALE.toLowerCase());
    return defaultMatch ?? null;
}

function resolveSpeechLocale(
    requestedLocale: string,
    supportedLocales: ReadonlyArray<string>
): SpeechLocaleResolution {
    if (supportedLocales.length === 0) {
        return {
            requestedLocale,
            resolvedLocale: requestedLocale,
            usedFallback: false,
        };
    }

    const supportedLocale = findSupportedSpeechLocale(requestedLocale, supportedLocales);
    if (supportedLocale === null) {
        return {
            requestedLocale,
            resolvedLocale: requestedLocale,
            usedFallback: false,
        };
    }

    return {
        requestedLocale,
        resolvedLocale: supportedLocale,
        usedFallback: supportedLocale.toLowerCase() !== requestedLocale.toLowerCase(),
    };
}

function getUniqueSpeechLocales(locales: ReadonlyArray<string>): ReadonlyArray<string> {
    return [...new Set(locales.map((locale) => normalizeSpeechLocale(locale)))];
}

function isUnsupportedSpeechLocaleMessage(message: string): boolean {
    const normalizedMessage = message.toLowerCase();
    return normalizedMessage.includes("is not supported by the speech recognizer")
        || (
            normalizedMessage.includes("available locales")
            && normalizedMessage.includes("locale")
        );
}

function getVoiceInputErrorMessage(errorCode: string, rawMessage: string): string {
    if (errorCode === "not-allowed") {
        return "Enable microphone and speech recognition to dictate prompts.";
    }

    if (isUnsupportedSpeechLocaleMessage(rawMessage)) {
        return "Speech recognition is not available for the current device language. Try Turkish or English in your device language settings.";
    }

    return rawMessage;
}

function replaceSelectionText(
    input: string,
    selection: InputSelection,
    insertedText: string
): { text: string; selection: InputSelection } {
    const start = Math.max(0, Math.min(selection.start, input.length));
    const end = Math.max(start, Math.min(selection.end, input.length));
    const nextText = `${input.slice(0, start)}${insertedText}${input.slice(end)}`;
    const nextCursor = start + insertedText.length;
    return {
        text: nextText,
        selection: { start: nextCursor, end: nextCursor },
    };
}

function appendComposerText(currentInput: string, text: string): { text: string; selection: InputSelection } {
    const prefix = currentInput.trim().length === 0
        ? ""
        : currentInput.endsWith("\n")
            ? "\n"
            : "\n\n";
    const nextText = `${currentInput}${prefix}${text}`;
    const nextCursor = nextText.length;
    return {
        text: nextText,
        selection: { start: nextCursor, end: nextCursor },
    };
}

function ensureJpegFileName(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, "").concat(".jpg");
}

function createAttachmentFileName(fileName: string | null | undefined, fallbackPrefix: string): string {
    if (fileName !== undefined && fileName !== null && fileName.trim().length > 0) {
        return fileName;
    }

    return `${fallbackPrefix}-${Date.now()}.jpg`;
}

function createResizeActions(
    width: number,
    height: number,
    targetLongestEdge: number
): Array<{ resize: { width?: number; height?: number } }> {
    const longestEdge = Math.max(width, height, 1);
    if (targetLongestEdge >= longestEdge) {
        return [];
    }

    if (width >= height) {
        return [{ resize: { width: targetLongestEdge } }];
    }

    return [{ resize: { height: targetLongestEdge } }];
}

async function loadBase64Attachment(uri: string): Promise<string> {
    return new File(uri).base64();
}

async function prepareImageAttachment(
    asset: ImagePicker.ImagePickerAsset
): Promise<{ attachment: ImageAttachment; wasCompressed: boolean }> {
    const originalFileName = createAttachmentFileName(asset.fileName, "image");
    const longestEdge = Math.max(asset.width, asset.height, 1);

    const compressionAttempts = [
        ...(longestEdge <= MAX_ATTACHMENT_LONGEST_EDGE
            ? [{ longestEdge, compress: 0.78 }]
            : []),
        ...COMPATIBLE_ATTACHMENT_ATTEMPTS,
    ];

    for (const attempt of compressionAttempts) {
        const result = await ImageManipulator.manipulateAsync(
            asset.uri,
            createResizeActions(asset.width, asset.height, attempt.longestEdge),
            {
                base64: true,
                compress: attempt.compress,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );
        const base64Data = result.base64 ?? await loadBase64Attachment(result.uri);
        if (base64Data.length <= COMPATIBLE_ATTACHMENT_MAX_BASE64_CHARS) {
            return {
                attachment: {
                    uri: result.uri,
                    width: result.width,
                    height: result.height,
                    fileName: ensureJpegFileName(originalFileName),
                    mimeType: "image/jpeg",
                    base64Data,
                },
                wasCompressed: longestEdge > MAX_ATTACHMENT_LONGEST_EDGE || attempt.longestEdge !== longestEdge,
            };
        }
    }

    const finalAttempt = COMPATIBLE_ATTACHMENT_ATTEMPTS[COMPATIBLE_ATTACHMENT_ATTEMPTS.length - 1];
    if (finalAttempt === undefined) {
        throw new Error("No compatible attachment attempts configured.");
    }
    const fallbackResult = await ImageManipulator.manipulateAsync(
        asset.uri,
        createResizeActions(asset.width, asset.height, finalAttempt.longestEdge),
        {
            base64: true,
            compress: finalAttempt.compress,
            format: ImageManipulator.SaveFormat.JPEG,
        }
    );
    const fallbackBase64 = fallbackResult.base64 ?? await loadBase64Attachment(fallbackResult.uri);
    return {
        attachment: {
            uri: fallbackResult.uri,
            width: fallbackResult.width,
            height: fallbackResult.height,
            fileName: ensureJpegFileName(originalFileName),
            mimeType: "image/jpeg",
            base64Data: fallbackBase64,
        },
        wasCompressed: true,
    };
}

function isLegacyFileMentionQuery(query: string): boolean {
    return query.includes("/")
        || query.includes(".")
        || query.startsWith("..")
        || query.startsWith("./");
}

const APP_SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
    { command: "/new", description: "Start a new chat", category: "chat" },
    { command: "/models", description: "Open the model picker", category: "config" },
    { command: "/settings", description: "Open app settings", category: "app" },
    { command: "/usage", description: "Show current session usage", category: "session" },
    { command: "/compact", description: "Compact conversation to save context", category: "session" },
    { command: "/app-feedback", description: "Send app feedback by email", category: "app" },
];

function shouldSearchWorkspaceFiles(token: AutocompleteToken): boolean {
    if (token === null) {
        return false;
    }

    if (token.kind === "context") {
        return true;
    }

    if (token.kind === "mention") {
        return isLegacyFileMentionQuery(token.query);
    }

    return false;
}

// Detect #context, @participant, or /command token by scanning backward from cursor position.
function detectAutocompleteToken(text: string, cursor: number): AutocompleteToken {
    if (cursor <= 0) return null;
    let i = cursor - 1;
    while (i >= 0) {
        const ch = text[i];
        if (ch === undefined) break;
        if (ch === " " || ch === "\n" || ch === "\t") return null;
        if (ch === "#") {
            const prev = i > 0 ? text[i - 1] : undefined;
            if (prev !== undefined && prev !== " " && prev !== "\n" && prev !== "\t") return null;
            return { kind: "context", query: text.slice(i + 1, cursor), start: i, end: cursor };
        }
        if (ch === "@") {
            const prev = i > 0 ? text[i - 1] : undefined;
            if (prev !== undefined && prev !== " " && prev !== "\n" && prev !== "\t") return null;
            return { kind: "mention", query: text.slice(i + 1, cursor), start: i, end: cursor };
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

type ToolbarSendControlsProps = {
    canSend: boolean;
    isComposerLocked: boolean;
    isTyping: boolean;
    isAbortPending: boolean;
    onAbort: () => void;
    onDefaultSend: () => void;
    onDirectSend: () => void;
    onLockedPress: () => void;
    onToggleSendMenu: () => void;
    onSelectSendMode: (mode: SendMode) => void;
    showSendMenu: boolean;
};

function areToolbarSendControlsEqual(
    previousProps: ToolbarSendControlsProps,
    nextProps: ToolbarSendControlsProps
): boolean {
    return previousProps.canSend === nextProps.canSend
        && previousProps.isComposerLocked === nextProps.isComposerLocked
        && previousProps.isTyping === nextProps.isTyping
        && previousProps.isAbortPending === nextProps.isAbortPending
        && previousProps.onAbort === nextProps.onAbort
        && previousProps.onDefaultSend === nextProps.onDefaultSend
        && previousProps.onDirectSend === nextProps.onDirectSend
        && previousProps.onLockedPress === nextProps.onLockedPress
        && previousProps.onToggleSendMenu === nextProps.onToggleSendMenu
        && previousProps.onSelectSendMode === nextProps.onSelectSendMode
        && previousProps.showSendMenu === nextProps.showSendMenu;
}

const ToolbarSendControls = React.memo(function ToolbarSendControls({
    canSend,
    isComposerLocked,
    isTyping,
    isAbortPending,
    onAbort,
    onDefaultSend,
    onDirectSend,
    onLockedPress,
    onToggleSendMenu,
    onSelectSendMode,
    showSendMenu,
}: ToolbarSendControlsProps) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const toolbarStyles = useThemedStyles(createToolbarStyles);

    if (isTyping) {
        return (
            <View style={toolbarStyles.sendControlWrap}>
                <Pressable
                    style={[
                        styles.abortButton,
                        isAbortPending && styles.abortButtonPending,
                    ]}
                    onPress={onAbort}
                    disabled={isAbortPending}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={isAbortPending ? "Stopping request" : "Stop request"}
                >
                    <View style={styles.abortIcon} />
                </Pressable>

                {canSend ? (
                    <View style={toolbarStyles.sendGroup}>
                        <Pressable
                            style={styles.sendButton}
                            onPress={onDefaultSend}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Send message"
                        >
                            <ArrowUpIcon size={16} color={theme.colors.textOnAccent} />
                        </Pressable>
                        <Pressable
                            style={toolbarStyles.sendMenuButton}
                            onPress={onToggleSendMenu}
                            hitSlop={4}
                            accessibilityLabel="Send options"
                        >
                            <ChevronDownIcon size={12} color={theme.colors.textPrimary} />
                        </Pressable>
                    </View>
                ) : isComposerLocked ? (
                    <Pressable
                        style={[styles.sendButton, styles.sendButtonDisabled]}
                        onPress={onLockedPress}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel="Subscribe to continue chatting"
                    >
                        <ArrowUpIcon size={16} color={theme.colors.textTertiary} />
                    </Pressable>
                ) : (
                    <View style={[styles.sendButton, styles.sendButtonDisabled]}>
                        <ArrowUpIcon size={16} color={theme.colors.textTertiary} />
                    </View>
                )}

                <SendModeMenu
                    visible={showSendMenu && canSend}
                    onSelect={onSelectSendMode}
                />
            </View>
        );
    }

    if (canSend) {
        return (
            <Pressable
                style={styles.sendButton}
                onPress={onDirectSend}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Send message"
            >
                <ArrowUpIcon size={16} color={theme.colors.textOnAccent} />
            </Pressable>
        );
    }

    if (isComposerLocked) {
        return (
            <Pressable
                style={[styles.sendButton, styles.sendButtonDisabled]}
                onPress={onLockedPress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Subscribe to continue chatting"
            >
                <ArrowUpIcon size={16} color={theme.colors.textTertiary} />
            </Pressable>
        );
    }

    return (
        <View style={[styles.sendButton, styles.sendButtonDisabled]}>
            <ArrowUpIcon size={16} color={theme.colors.textTertiary} />
        </View>
    );
}, areToolbarSendControlsEqual);

function areQueuedDraftListsEqual(
    previousDrafts: ReadonlyArray<ChatInputProps["queuedDrafts"][number]>,
    nextDrafts: ReadonlyArray<ChatInputProps["queuedDrafts"][number]>
): boolean {
    if (previousDrafts.length !== nextDrafts.length) {
        return false;
    }

    return previousDrafts.every((draft, index) => {
        const nextDraft = nextDrafts[index];
        return nextDraft !== undefined
            && nextDraft.id === draft.id
            && nextDraft.sessionId === draft.sessionId
            && nextDraft.content === draft.content
            && nextDraft.images.length === draft.images.length;
    });
}

function areChatInputPropsEqual(
    previousProps: ChatInputProps,
    nextProps: ChatInputProps
): boolean {
    const previousEditingDraft = previousProps.editingDraft;
    const nextEditingDraft = nextProps.editingDraft;

    const editingDraftsEqual = previousEditingDraft === nextEditingDraft
        || (
            previousEditingDraft !== null
            && nextEditingDraft !== null
            && previousEditingDraft.id === nextEditingDraft.id
            && previousEditingDraft.content === nextEditingDraft.content
            && previousEditingDraft.sessionId === nextEditingDraft.sessionId
            && previousEditingDraft.images.length === nextEditingDraft.images.length
        );

    return previousProps.onSend === nextProps.onSend
        && previousProps.onRunUsage === nextProps.onRunUsage
        && previousProps.onRunCompact === nextProps.onRunCompact
        && previousProps.onStartNewChat === nextProps.onStartNewChat
        && previousProps.onOpenSettings === nextProps.onOpenSettings
        && previousProps.onAbort === nextProps.onAbort
        && previousProps.onLockedPress === nextProps.onLockedPress
        && previousProps.isTyping === nextProps.isTyping
        && previousProps.isAbortPending === nextProps.isAbortPending
        && previousProps.disabled === nextProps.disabled
        && previousProps.isComposerLocked === nextProps.isComposerLocked
        && previousProps.inputPlaceholder === nextProps.inputPlaceholder
        && previousProps.onEditingDraftConsumed === nextProps.onEditingDraftConsumed
        && previousProps.onEditQueuedDraft === nextProps.onEditQueuedDraft
        && previousProps.onRemoveQueuedDraft === nextProps.onRemoveQueuedDraft
        && previousProps.onSteerQueuedDraft === nextProps.onSteerQueuedDraft
        && editingDraftsEqual
        && areQueuedDraftListsEqual(previousProps.queuedDrafts, nextProps.queuedDrafts);
}

function ChatInputComponent({
    onSend,
    onRunUsage,
    onRunCompact,
    onStartNewChat,
    onOpenSettings,
    onAbort,
    onLockedPress,
    isTyping,
    isAbortPending,
    disabled,
    isComposerLocked,
    inputPlaceholder,
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
    const inputRef = React.useRef<TextInput>(null);
    const [input, setInput] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [images, setImages] = useState<Array<ImageAttachment>>([]);
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [showEffortPicker, setShowEffortPicker] = useState(false);
    const [showSendMenu, setShowSendMenu] = useState(false);
    const [showContextWindowSheet, setShowContextWindowSheet] = useState(false);
    const [selection, setSelection] = useState<InputSelection>({ start: 0, end: 0 });
    const [workspaceFileMatches, setWorkspaceFileMatches] = useState<ReadonlyArray<string>>([]);
    const [voiceState, setVoiceState] = useState<"idle" | "starting" | "recording">("idle");
    const lastSendSignatureRef = React.useRef<{ signature: string; sentAt: number } | null>(null);
    const imagesRef = React.useRef<ReadonlyArray<ImageAttachment>>([]);
    const inputRefState = React.useRef("");
    const selectionRef = React.useRef<InputSelection>({ start: 0, end: 0 });
    const voiceStartPendingRef = React.useRef(false);
    const voiceHeardSpeechRef = React.useRef(false);
    const supportedSpeechLocalesRef = React.useRef<ReadonlyArray<string> | null>(null);
    const voiceLocaleResolutionRef = React.useRef<SpeechLocaleResolution | null>(null);
    const voiceCaptureRef = React.useRef<VoiceCaptureState>({
        active: false,
        baseInput: "",
        baseSelection: { start: 0, end: 0 },
        transcript: "",
    });
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
    const sessionUsage = useSessionStore((s) =>
        s.activeSessionId !== null ? s.sessionUsage[s.activeSessionId] : undefined
    );
    const currentModel = models.find((m) => m.id === selectedModel);
    const activeSession = activeSessionId !== null
        ? sessions.find((session) => session.id === activeSessionId)
        : undefined;
    const resolvedSessionModelName = (() => {
        if (activeSession === undefined || activeSession.model === MODEL_UNKNOWN) {
            return null;
        }
        const resolvedModel = models.find((model) => model.id === activeSession.model);
        return resolvedModel?.name ?? activeSession.model;
    })();
    const effortInfo = deriveAvailableReasoningEfforts(currentModel);
    const voiceAvailable = useMemo(() => ExpoSpeechRecognitionModule.isRecognitionAvailable(), []);

    useEffect(() => {
        inputRefState.current = input;
    }, [input]);

    useEffect(() => {
        imagesRef.current = images;
    }, [images]);

    useEffect(() => {
        selectionRef.current = selection;
    }, [selection]);

    const resetVoiceCapture = useCallback(() => {
        voiceStartPendingRef.current = false;
        voiceHeardSpeechRef.current = false;
        voiceLocaleResolutionRef.current = null;
        voiceCaptureRef.current = {
            active: false,
            baseInput: "",
            baseSelection: { start: 0, end: 0 },
            transcript: "",
        };
        setVoiceState("idle");
    }, []);

    const stopVoiceCapture = useCallback((showErrorAlert: boolean) => {
        if (voiceState === "idle" && !voiceStartPendingRef.current) {
            return;
        }

        try {
            ExpoSpeechRecognitionModule.abort();
            resetVoiceCapture();
        } catch (error) {
            resetVoiceCapture();
            if (!showErrorAlert) {
                return;
            }

            const message = error instanceof Error ? error.message : String(error);
            Alert.alert("Could not stop voice input", message);
        }
    }, [resetVoiceCapture, voiceState]);

    const handleSend = useCallback(
        (mode: SendMode) => {
            const trimmed = input.trim();
            if (trimmed.length === 0 || disabled || isComposerLocked) return;

            void (async () => {
                const normalized = trimmed.toLowerCase();
                if (normalized === "/app-feedback" || normalized.startsWith("/app-feedback ")) {
                    stopVoiceCapture(false);
                    const feedbackMessage = trimmed.slice("/app-feedback".length).trim();
                    const opened = await openFeedbackEmail(feedbackMessage, activeSessionId);
                    if (!opened) {
                        return;
                    }

                    setInput("");
                    setImages([]);
                    return;
                }

                if (normalized === "/usage") {
                    stopVoiceCapture(false);
                    setInput("");
                    setImages([]);
                    onRunUsage();
                    return;
                }

                if (normalized === "/compact") {
                    stopVoiceCapture(false);
                    setInput("");
                    setImages([]);
                    onRunCompact();
                    return;
                }

                if (normalized === "/new") {
                    stopVoiceCapture(false);
                    setInput("");
                    setImages([]);
                    onStartNewChat();
                    return;
                }

                if (normalized === "/settings") {
                    stopVoiceCapture(false);
                    setInput("");
                    setImages([]);
                    onOpenSettings();
                    return;
                }

                if (normalized === "/models") {
                    stopVoiceCapture(false);
                    setInput("");
                    setImages([]);
                    Keyboard.dismiss();
                    setShowModelPicker(true);
                    return;
                }

                const attachmentSignature = images.map((image) => (
                    `${image.fileName}:${image.mimeType}:${image.base64Data.length}:${image.width}x${image.height}`
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

                stopVoiceCapture(false);
                const currentImages = [...images];
                setInput("");
                setImages([]);
                onSend(trimmed, currentImages, mode);
            })();
        },
        [activeSessionId, input, disabled, images, isComposerLocked, onOpenSettings, onRunCompact, onRunUsage, onSend, onStartNewChat, stopVoiceCapture]
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

    const handleDirectSend = useCallback(() => {
        handleSend("send");
    }, [handleSend]);

    const handleToggleSendMenu = useCallback(() => {
        setShowSendMenu((previous) => !previous);
    }, []);

    const applyComposerInsert = useCallback((request: { text: string; mode: "replace-selection" | "append" }) => {
        const currentInput = inputRefState.current;
        const currentSelection = selectionRef.current;
        const nextState = request.mode === "append"
            ? appendComposerText(currentInput, request.text)
            : replaceSelectionText(currentInput, currentSelection, request.text);
        setInput(nextState.text);
        setSelection(nextState.selection);
        InteractionManager.runAfterInteractions(() => {
            inputRef.current?.focus();
        });
        return true;
    }, []);

    useEffect(() => {
        return subscribeComposerInsert(applyComposerInsert);
    }, [applyComposerInsert]);

    const applyVoiceTranscript = useCallback((transcript: string) => {
        const capture = voiceCaptureRef.current;
        if (!capture.active) {
            return;
        }

        voiceCaptureRef.current = { ...capture, transcript };
        const nextState = replaceSelectionText(capture.baseInput, capture.baseSelection, transcript);
        setInput(nextState.text);
        setSelection(nextState.selection);
    }, []);

    const resolveActiveSpeechLocale = useCallback(async (): Promise<SpeechLocaleResolution> => {
        const requestedLocale = getRequestedSpeechLocale();
        const cachedSupportedLocales = supportedSpeechLocalesRef.current;
        if (cachedSupportedLocales !== null) {
            return resolveSpeechLocale(requestedLocale, cachedSupportedLocales);
        }

        try {
            const supportedLocales = await ExpoSpeechRecognitionModule.getSupportedLocales({});
            const normalizedLocales = getUniqueSpeechLocales(supportedLocales.locales);
            supportedSpeechLocalesRef.current = normalizedLocales;
            return resolveSpeechLocale(requestedLocale, normalizedLocales);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("[ChatInput] Failed to load supported speech locales", {
                error: message,
                requestedLocale,
            });
            return {
                requestedLocale,
                resolvedLocale: requestedLocale,
                usedFallback: false,
            };
        }
    }, []);

    useSpeechRecognitionEvent("start", () => {
        if (!voiceCaptureRef.current.active) {
            return;
        }

        voiceStartPendingRef.current = false;
        setVoiceState("recording");
    });

    useSpeechRecognitionEvent("speechstart", () => {
        voiceHeardSpeechRef.current = true;
    });

    useSpeechRecognitionEvent("result", (event) => {
        const transcript = event.results.map((result) => result.transcript).join(" ").trim();
        applyVoiceTranscript(transcript);
        if (shouldAutoStopVoiceCapture(event.isFinal, transcript)) {
            stopVoiceCapture(false);
        }
    });

    useSpeechRecognitionEvent("end", () => {
        resetVoiceCapture();
    });

    useSpeechRecognitionEvent("error", (event) => {
        const capture = voiceCaptureRef.current;
        const wasActive = capture.active;
        const voiceLocaleResolution = voiceLocaleResolutionRef.current;
        const heardSpeech = voiceHeardSpeechRef.current;
        resetVoiceCapture();
        if (wasActive && !shouldDismissVoiceInputError(event.error, capture.transcript, heardSpeech)) {
            if (voiceLocaleResolution?.usedFallback === true && isUnsupportedSpeechLocaleMessage(event.message)) {
                Alert.alert(
                    "Voice input stopped",
                    "Speech recognition is not available for the selected fallback language on this device."
                );
                return;
            }

            Alert.alert("Voice input stopped", getVoiceInputErrorMessage(event.error, event.message));
        }
    });

    const startVoiceInput = useCallback(async () => {
        if (disabled || isAbortPending || voiceState !== "idle" || voiceStartPendingRef.current) {
            return;
        }

        if (!voiceAvailable) {
            Alert.alert("Voice input unavailable", "Speech recognition is not available on this device.");
            return;
        }

        voiceStartPendingRef.current = true;
        setVoiceState("starting");

        try {
            const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            if (!permission.granted) {
                voiceStartPendingRef.current = false;
                setVoiceState("idle");
                Alert.alert(
                    "Microphone access required",
                    "Enable microphone and speech recognition to dictate prompts."
                );
                return;
            }

            const localeResolution = await resolveActiveSpeechLocale();
            voiceLocaleResolutionRef.current = localeResolution;
            voiceCaptureRef.current = {
                active: true,
                baseInput: inputRefState.current,
                baseSelection: selectionRef.current,
                transcript: "",
            };
            voiceHeardSpeechRef.current = false;
            inputRef.current?.focus();
            ExpoSpeechRecognitionModule.start({
                lang: localeResolution.resolvedLocale,
                interimResults: true,
                maxAlternatives: 1,
                continuous: Platform.OS !== "android" || Platform.Version >= 31,
                addsPunctuation: true,
                contextualStrings: [...VOICE_CONTEXTUAL_STRINGS],
            });
        } catch (error) {
            resetVoiceCapture();
            const rawMessage = error instanceof Error ? error.message : String(error);
            const message = getVoiceInputErrorMessage("start_failed", rawMessage);
            Alert.alert("Could not start voice input", message);
        }
    }, [disabled, isAbortPending, resetVoiceCapture, resolveActiveSpeechLocale, voiceAvailable, voiceState]);

    const handleVoiceToggle = useCallback(() => {
        if (voiceState === "idle") {
            void startVoiceInput();
            return;
        }

        stopVoiceCapture(true);
    }, [startVoiceInput, stopVoiceCapture, voiceState]);

    const activeToken = useMemo<AutocompleteToken>(
        () => detectAutocompleteToken(input, selection.start),
        [input, selection.start]
    );

    const filePaths = useMemo<ReadonlyArray<string>>(() => {
        const out: Array<string> = [];
        collectFilePaths(workspaceTree, out);
        return out;
    }, [workspaceTree]);

    useEffect(() => {
        if (!shouldSearchWorkspaceFiles(activeToken)) {
            setWorkspaceFileMatches([]);
            return;
        }
        if (activeToken === null) {
            setWorkspaceFileMatches([]);
            return;
        }
        if (activeSessionId === null || connectionState !== "authenticated") {
            return;
        }
        if (workspaceTree !== null || filePaths.length > 0) {
            return;
        }
        void requestWorkspaceTree(activeSessionId, undefined, 5);
    }, [activeSessionId, activeToken, connectionState, filePaths.length, workspaceTree]);

    useEffect(() => {
        if (!shouldSearchWorkspaceFiles(activeToken)) {
            setWorkspaceFileMatches([]);
            return;
        }
        if (activeToken === null) {
            setWorkspaceFileMatches([]);
            return;
        }

        if (activeSessionId === null || connectionState !== "authenticated") {
            setWorkspaceFileMatches([]);
            return;
        }

        let cancelled = false;
        const timeoutId = setTimeout(() => {
            void searchWorkspaceFiles(activeSessionId, activeToken.query, 12)
                .then((matches) => {
                    if (cancelled) {
                        return;
                    }

                    setWorkspaceFileMatches(matches.map((match) => match.path));
                })
                .catch(() => {
                    if (!cancelled) {
                        setWorkspaceFileMatches([]);
                    }
                });
        }, activeToken.query.trim().length === 0 ? 0 : 120);

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }, [activeSessionId, activeToken, connectionState]);

    const suggestions = useMemo<ReadonlyArray<AutocompleteSuggestion>>(() => {
        if (activeToken === null) {
            return [];
        }

        const query = activeToken.query.toLowerCase();
        if (activeToken.kind === "context") {
            const contextMatches = CONTEXT_SUGGESTIONS.filter((item) =>
                item.label.slice(1).toLowerCase().includes(query)
            );
            const matchingContextFilePaths = [...new Set([
                ...filePaths.filter((p) => pathMatchesQuery(p, query)),
                ...workspaceFileMatches,
            ])];
            const fileMatches = matchingContextFilePaths
                .slice(0, query.length === 0 ? matchingContextFilePaths.length : 8)
                .map((p) => ({
                    label: `#${p}`,
                    value: `#${p} `,
                    hint: "Reference this file in the next prompt",
                    category: "File",
                    icon: <FileTextIcon size={14} color={theme.colors.textTertiary} />,
                }));
            const combinedContextMatches = [...contextMatches, ...fileMatches];
            if (query.length === 0) {
                return combinedContextMatches;
            }
            return combinedContextMatches.slice(0, 10);
        }

        if (activeToken.kind === "mention") {
            const participantMatches = PARTICIPANT_SUGGESTIONS.filter((item) =>
                item.label.slice(1).toLowerCase().includes(query)
            );
            const shouldIncludeLegacyFileMatches = query.length === 0 || isLegacyFileMentionQuery(activeToken.query);
            const matchingMentionFilePaths = [...new Set([
                ...filePaths.filter((p) => pathMatchesQuery(p, query)),
                ...workspaceFileMatches,
            ])];
            const legacyFileMatches = !shouldIncludeLegacyFileMatches
                ? []
                : matchingMentionFilePaths
                    .slice(0, query.length === 0 ? matchingMentionFilePaths.length : 8)
                    .map((p) => ({
                        label: `@${p}`,
                        value: `@${p} `,
                        hint: "Legacy file reference",
                        category: "File",
                        icon: <FileTextIcon size={14} color={theme.colors.textTertiary} />,
                    }));
            const combinedMentionMatches = [...participantMatches, ...legacyFileMatches];
            if (query.length === 0) {
                return combinedMentionMatches;
            }
            return combinedMentionMatches.slice(0, 10);
        }

        const staticMatches = APP_SLASH_COMMANDS
            .filter((c) => c.command.slice(1).toLowerCase().startsWith(query))
            .map((c) => ({
                label: c.command,
                value: `${c.command} `,
                hint: c.description,
                category: "Command",
                icon: <SlidersIcon size={13} color={theme.colors.textTertiary} />,
            }));
        if (query.length === 0) {
            return staticMatches;
        }
        return staticMatches.slice(0, 10);
    }, [activeToken, filePaths, theme.colors.textTertiary, workspaceFileMatches]);

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
                    "Enable photo library access to attach images to your message.",
                );
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: true,
                quality: 1,
                base64: false,
            });

            if (result.canceled) {
                return;
            }

            const availableSlots = Math.max(0, MAX_MESSAGE_IMAGE_ATTACHMENTS - imagesRef.current.length);
            if (availableSlots === 0) {
                Alert.alert(
                    "Attachment limit reached",
                    `You can attach up to ${MAX_MESSAGE_IMAGE_ATTACHMENTS} images per message.`,
                );
                return;
            }

            const selectedAssets = result.assets.slice(0, availableSlots);
            const skippedForCount = result.assets.length - selectedAssets.length;
            const newImages: Array<ImageAttachment> = [];
            let skippedCount = 0;

            for (const asset of selectedAssets) {
                const preparedAttachment = await prepareImageAttachment(asset);
                newImages.push(preparedAttachment.attachment);
            }

            if (newImages.length === 0) {
                Alert.alert(
                    "Attachment unavailable",
                    "The selected image could not be prepared for upload. Choose another image and try again.",
                );
                return;
            }

            setImages((prev) => [...prev, ...newImages]);
            if (skippedCount > 0 || skippedForCount > 0) {
                const notices: Array<string> = [];
                if (skippedCount > 0) {
                    notices.push(`${skippedCount} image${skippedCount > 1 ? "s could not" : " could not"} be prepared.`);
                }
                if (skippedForCount > 0) {
                    notices.push(`Only ${MAX_MESSAGE_IMAGE_ATTACHMENTS} images can be attached to one message.`);
                }
                Alert.alert("Some images were skipped", notices.join(" "));
            }
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

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") {
                return;
            }

            Keyboard.dismiss();
            setShowModelPicker(false);
            setShowEffortPicker(false);
            setShowSendMenu(false);
            setShowContextWindowSheet(false);
            setIsFocused(false);
            if (voiceCaptureRef.current.active) {
                ExpoSpeechRecognitionModule.abort();
                resetVoiceCapture();
            }
        });

        return () => {
            subscription.remove();
            if (voiceCaptureRef.current.active) {
                ExpoSpeechRecognitionModule.abort();
                resetVoiceCapture();
            }
        };
    }, [resetVoiceCapture]);

    const isInputDisabled = disabled || isComposerLocked;
    const canSend = input.trim().length > 0 && !disabled && !isComposerLocked;

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

        if (activeSession === undefined || activeSession.model === MODEL_UNKNOWN) {
            return null;
        }

        return `Used ${resolvedSessionModelName ?? activeSession.model}`;
    }, [activeSession, activeSessionId, currentModel?.id, currentModel?.name, isTyping, resolvedSessionModelName, selectedModel]);

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
    const remainingTokens = contextLimit !== null && contextCurrent !== null
        ? Math.max(0, contextLimit - contextCurrent)
        : null;
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
    const formatUsageValue = (value: number | null | undefined): string => {
        if (value === null || value === undefined) {
            return "—";
        }
        return formatCtxWindow(value);
    };
    const messageCountLabel = sessionUsage?.messagesLength !== undefined
        ? String(sessionUsage.messagesLength)
        : "—";

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
                <View>
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
                </View>
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
                                <View style={autocompleteStyles.itemIcon}>
                                    {s.icon}
                                </View>
                                <View style={autocompleteStyles.itemBody}>
                                    <Text style={autocompleteStyles.label} numberOfLines={1}>{s.label}</Text>
                                    {s.hint !== undefined && (
                                        <Text style={autocompleteStyles.hint} numberOfLines={1}>{s.hint}</Text>
                                    )}
                                </View>
                                {s.category !== undefined && (
                                    <Text style={autocompleteStyles.category} numberOfLines={1}>{s.category}</Text>
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
                    ref={inputRef}
                    style={styles.textInput}
                    value={input}
                    onChangeText={setInput}
                    onPressIn={() => {
                        if (isComposerLocked) {
                            onLockedPress();
                        }
                    }}
                    selection={selection}
                    onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                    placeholder={inputPlaceholder}
                    placeholderTextColor={theme.colors.textTertiary}
                    multiline
                    maxLength={10000}
                    returnKeyType="send"
                    onSubmitEditing={handleDefaultSend}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    blurOnSubmit={false}
                    editable={!isInputDisabled}
                    accessibilityLabel="Write message"
                />

                {/* Thin separator */}
                <View style={styles.inputSeparator} />

                {/* Single toolbar row: attach | model | session-controls | spacer | context-meter | send */}
                <View style={toolbarStyles.row}>
                    <Pressable
                        style={toolbarStyles.toolBtn}
                        onPress={handleAttachImage}
                        disabled={isInputDisabled}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        accessibilityLabel="Attach image"
                    >
                        <CirclePlusIcon size={16} color={theme.colors.textSecondary} />
                    </Pressable>

                    <Pressable
                        style={[
                            toolbarStyles.toolBtn,
                            voiceState !== "idle" && toolbarStyles.toolBtnRecording,
                            (!voiceAvailable || isAbortPending) && toolbarStyles.toolBtnDimmed,
                        ]}
                        onPress={handleVoiceToggle}
                        disabled={isInputDisabled || !voiceAvailable || isAbortPending}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        accessibilityLabel={voiceState === "idle" ? "Start voice input" : "Stop voice input"}
                    >
                        <MicrophoneIcon
                            size={15}
                            color={voiceState !== "idle" ? theme.colors.textOnAccent : theme.colors.textSecondary}
                        />
                    </Pressable>

                    {/* Model selector pill */}
                    <Pressable
                        style={toolbarStyles.modelPill}
                        onPress={() => setShowModelPicker(true)}
                        disabled={isInputDisabled}
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
                        disabled={isInputDisabled}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        accessibilityLabel="Session controls"
                    >
                        <SlidersIcon size={15} color={theme.colors.textSecondary} />
                    </Pressable>

                    <View style={toolbarStyles.spacer} />

                    <View style={toolbarStyles.trailingControls}>
                        <View style={toolbarStyles.contextMeterSlot}>
                            {(contextUsageLabel !== null || contextWindowLabel !== null) && (
                                <Pressable
                                    style={toolbarStyles.contextMeterBtn}
                                    onPress={() => setShowContextWindowSheet(true)}
                                    accessibilityLabel="Show usage center"
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
                        </View>

                        <View style={toolbarStyles.sendControlSlot}>
                            {/* Send / Abort / Queue */}
                            <ToolbarSendControls
                                canSend={canSend}
                                isComposerLocked={isComposerLocked}
                                isTyping={isTyping}
                                isAbortPending={isAbortPending}
                                onAbort={onAbort}
                                onDefaultSend={handleDefaultSend}
                                onDirectSend={handleDirectSend}
                                onLockedPress={onLockedPress}
                                onToggleSendMenu={handleToggleSendMenu}
                                onSelectSendMode={handleSendModeSelect}
                                showSendMenu={showSendMenu}
                            />
                        </View>
                    </View>
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
                title="Chat Actions"
                iconNode={<SlidersIcon size={15} color={theme.colors.textSecondary} />}
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
                title="Usage Center"
                iconNode={<HashIcon size={15} color={theme.colors.textSecondary} />}
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
                        <Text style={contextStyles.summaryMeta}>
                            {resolvedSessionModelName ?? (currentModel?.name ?? "Current model")}
                            {sessionUsage?.messagesLength !== undefined
                                ? ` · ${sessionUsage.messagesLength} messages`
                                : ""}
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

                    <View style={contextStyles.statGrid}>
                        <View style={contextStyles.statCard}>
                            <Text style={contextStyles.statLabel}>Used</Text>
                            <Text style={contextStyles.statValue}>{formatUsageValue(contextCurrent)}</Text>
                        </View>
                        <View style={contextStyles.statCard}>
                            <Text style={contextStyles.statLabel}>Remaining</Text>
                            <Text style={contextStyles.statValue}>{formatUsageValue(remainingTokens)}</Text>
                        </View>
                        <View style={contextStyles.statCard}>
                            <Text style={contextStyles.statLabel}>Messages</Text>
                            <Text style={contextStyles.statValue}>{messageCountLabel}</Text>
                        </View>
                    </View>

                    <View style={contextStyles.sectionCard}>
                        <Text style={contextStyles.sectionTitle}>System</Text>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>System Instructions</Text>
                            <Text style={contextStyles.metricValue}>
                                {formatUsageValue(sessionUsage?.systemTokens)} · {detailPercent(sessionUsage?.systemTokens)}
                            </Text>
                        </View>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>Tool Definitions</Text>
                            <Text style={contextStyles.metricValue}>
                                {formatUsageValue(sessionUsage?.toolDefinitionsTokens)} · {detailPercent(sessionUsage?.toolDefinitionsTokens)}
                            </Text>
                        </View>
                    </View>

                    <View style={contextStyles.sectionCard}>
                        <Text style={contextStyles.sectionTitle}>User Context</Text>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>Messages</Text>
                            <Text style={contextStyles.metricValue}>
                                {formatUsageValue(sessionUsage?.conversationTokens)} · {detailPercent(sessionUsage?.conversationTokens)}
                            </Text>
                        </View>
                        <View style={contextStyles.metricRow}>
                            <Text style={contextStyles.metricLabel}>Tool Results</Text>
                            <Text style={contextStyles.metricValue}>
                                {formatUsageValue(toolResultsTokens)} · {detailPercent(toolResultsTokens)}
                            </Text>
                        </View>
                    </View>

                    <View style={contextStyles.actionRow}>
                        <Pressable
                            style={[contextStyles.actionButton, contextStyles.secondaryActionButton]}
                            onPress={() => {
                                setShowContextWindowSheet(false);
                                if (!disabled) {
                                    onRunUsage();
                                }
                            }}
                            disabled={disabled}
                        >
                            <Text style={contextStyles.secondaryActionButtonText}>Run /usage</Text>
                        </Pressable>
                        <Pressable
                            style={[contextStyles.actionButton, contextStyles.primaryActionButton]}
                            onPress={() => {
                                setShowContextWindowSheet(false);
                                if (!disabled) {
                                    onRunCompact();
                                }
                            }}
                            disabled={disabled}
                        >
                            <Text style={contextStyles.primaryActionButtonText}>Compact Conversation</Text>
                        </Pressable>
                    </View>
                </View>
            </DropdownModal>
            {resolvedAutoModelLabel !== null && (
                <Text style={styles.resolvedModelLabel}>{resolvedAutoModelLabel}</Text>
            )}
        </View>
    );
}

export const ChatInput = React.memo(ChatInputComponent, areChatInputPropsEqual);

// İzin ve kullanıcı girişi diyalogları — modal overlay

import React, { useState } from "react";
import {
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    ScrollView,
    KeyboardAvoidingView,
    Keyboard,
    Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSessionStore } from "../stores/session-store";
import type { PermissionPrompt, PlanExitPrompt, UserInputPrompt } from "../stores/session-store-types";
import { updatePermissionLevel, updateSessionMode } from "../services/bridge";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";

// Permission approval dialog
type PermissionProps = {
    prompt: PermissionPrompt;
    onRespond: (requestId: string, approved: boolean) => void;
};

export function PermissionDialog({ prompt, onRespond }: PermissionProps) {
    const styles = useThemedStyles(createStyles);
    const primaryDescription =
        prompt.details.find((d) => d.trim().length > 0)
        ?? prompt.commandText
        ?? prompt.fileName
        ?? (prompt.toolName !== null ? `${prompt.toolName} is requesting access` : "This operation requires permission");

    const secondaryDetails = [
        prompt.toolName !== null ? `Tool: ${prompt.toolName}` : null,
        prompt.fileName !== null ? `File: ${prompt.fileName}` : null,
        prompt.commandText !== null ? `Command: ${prompt.commandText}` : null,
    ].filter((d): d is string => d !== null && d.trim().length > 0);

    return (
        <View style={styles.overlay}>
            <View style={styles.card}>
                {/* Header — always visible */}
                <View style={styles.cardHeader}>
                    <View style={styles.kindBadge}>
                        <Text style={styles.kindBadgeText}>{prompt.kind}</Text>
                    </View>
                    <Text style={styles.cardTitle}>Permission Request</Text>
                </View>

                {/* Scrollable content area — won't push buttons off screen */}
                <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <Text style={styles.description}>{primaryDescription}</Text>
                    {secondaryDetails.length > 0 && (
                        <View style={styles.detailList}>
                            {secondaryDetails.map((detail, i) => (
                                <Text key={i} style={styles.detailText} numberOfLines={3}>
                                    {detail}
                                </Text>
                            ))}
                        </View>
                    )}
                </ScrollView>

                {/* Buttons — always pinned at bottom */}
                <View style={styles.actions}>
                    <Pressable
                        style={({ pressed }) => [styles.denyButton, pressed && styles.denyButtonPressed]}
                        onPress={() => onRespond(prompt.requestId, false)}
                    >
                        <Text style={styles.denyText}>Deny</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.approveButton, pressed && styles.approveButtonPressed]}
                        onPress={() => onRespond(prompt.requestId, true)}
                    >
                        <Text style={styles.approveText}>Approve</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

// User input dialog
type InputProps = {
    prompt: UserInputPrompt;
    onRespond: (requestId: string, value: string) => void;
};

export function UserInputDialog({ prompt, onRespond }: InputProps) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const [value, setValue] = useState("");
    const hasText = value.trim().length > 0;
    const sendResponse = () => {
        if (!hasText) {
            return;
        }

        onRespond(prompt.requestId, value.trim());
        setValue("");
        Keyboard.dismiss();
    };

    return (
        <Pressable style={styles.overlay} onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView
                style={styles.keyboardAvoidingLayer}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
            >
                <Pressable style={[styles.card, styles.inputCard]} onPress={(event) => event.stopPropagation()}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>Input Request</Text>
                    </View>
                    <ScrollView
                        style={styles.scrollArea}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        <Text style={styles.description}>{prompt.prompt}</Text>
                        {prompt.choices !== undefined && prompt.choices.length > 0 && (
                            <View style={styles.choiceList}>
                                {prompt.choices.map((choice) => (
                                    <Pressable
                                        key={choice}
                                        style={styles.choiceButton}
                                        onPress={() => {
                                            onRespond(prompt.requestId, choice);
                                            setValue("");
                                            Keyboard.dismiss();
                                        }}
                                    >
                                        <Text style={styles.choiceButtonText}>{choice}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        )}
                    </ScrollView>
                    <View style={styles.inputActionGroup}>
                        <TextInput
                            style={styles.inputField}
                            value={value}
                            onChangeText={setValue}
                            placeholder="Your response..."
                            placeholderTextColor={theme.colors.textPlaceholder}
                            returnKeyType="send"
                            blurOnSubmit
                            onSubmitEditing={sendResponse}
                        />
                        <Pressable
                            style={({ pressed }) => [
                                styles.inputSubmitButton,
                                !hasText && styles.inputSubmitButtonDisabled,
                                pressed && hasText && styles.approveButtonPressed,
                            ]}
                            onPress={sendResponse}
                            disabled={!hasText}
                            accessibilityLabel="Send input response"
                        >
                            <View style={styles.inputSubmitButtonContent}>
                                <Text style={styles.inputSubmitButtonText}>Send</Text>
                                <Feather
                                    name="arrow-up"
                                    size={14}
                                    color={styles.inputSubmitButtonText.color}
                                />
                            </View>
                        </Pressable>
                    </View>
                </Pressable>
            </KeyboardAvoidingView>
        </Pressable>
    );
}

type PlanExitProps = {
    prompt: PlanExitPrompt;
};

export function PlanExitDialog({ prompt }: PlanExitProps) {
    const styles = useThemedStyles(createStyles);
    const setAgentMode = useSessionStore((s) => s.setAgentMode);
    const setPermissionLevel = useSessionStore((s) => s.setPermissionLevel);
    const setPlanExitPrompt = useSessionStore((s) => s.setPlanExitPrompt);

    const dismiss = () => {
        setPlanExitPrompt(null);
    };

    const continueWithAgent = async () => {
        setAgentMode("agent");
        dismiss();
        await updateSessionMode(prompt.sessionId, "agent");
    };

    const switchToAutopilot = async () => {
        setAgentMode("agent");
        setPermissionLevel("autopilot");
        dismiss();
        await updatePermissionLevel(prompt.sessionId, "autopilot");
        await updateSessionMode(prompt.sessionId, "agent");
    };

    return (
        <View style={styles.overlay}>
            <View style={[styles.card, styles.planCard]}>
                <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Plan Ready</Text>
                </View>
                <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <Text style={styles.description}>{prompt.summary}</Text>
                    <View style={styles.planBlock}>
                        <Text style={styles.planBlockTitle}>Plan</Text>
                        <Text style={styles.planBlockText}>{prompt.planContent}</Text>
                    </View>
                </ScrollView>
                <View style={styles.actions}>
                    <Pressable
                        style={({ pressed }) => [styles.denyButton, pressed && styles.denyButtonPressed]}
                        onPress={dismiss}
                    >
                        <Text style={styles.denyText}>Keep Planning</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
                        onPress={() => { void continueWithAgent(); }}
                    >
                        <Text style={styles.secondaryButtonText}>Continue</Text>
                    </Pressable>
                </View>
                {prompt.actions.includes("autopilot") && (
                    <Pressable
                        style={({ pressed }) => [styles.approveButton, styles.fullWidthButton, pressed && styles.approveButtonPressed]}
                        onPress={() => { void switchToAutopilot(); }}
                    >
                        <Text style={styles.approveText}>Continue in Autopilot</Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.overlay,
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
        paddingHorizontal: theme.spacing.lg,
    },
    card: {
        backgroundColor: theme.colors.bgSecondary,
        borderRadius: theme.borderRadius.lg,
        padding: 20,
        width: "100%",
        maxWidth: 420,
        maxHeight: "70%",
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowColor: theme.colors.bg,
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    },
    inputCard: {
        maxHeight: "86%",
        minHeight: 380,
    },
    keyboardAvoidingLayer: {
        width: "100%",
        alignItems: "center",
    },
    cardHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
    },
    kindBadge: {
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.borderRadius.xs,
        backgroundColor: theme.colors.bg,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    kindBadgeText: {
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
        color: theme.colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    cardTitle: {
        fontSize: theme.fontSize.base,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    scrollArea: {
        flexShrink: 1,
        flexGrow: 1,
        marginBottom: theme.spacing.md,
    },
    scrollContent: {
        gap: theme.spacing.sm,
    },
    description: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textPrimary,
        lineHeight: 20,
    },
    detailList: {
        gap: 4,
    },
    detailText: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        lineHeight: 16,
        fontFamily: "monospace",
    },
    actions: {
        flexDirection: "row",
        gap: theme.spacing.sm,
    },
    denyButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: theme.borderRadius.sm,
        alignItems: "center",
        backgroundColor: theme.colors.bg,
        borderWidth: 1,
        borderColor: theme.colors.errorMuted,
    },
    denyButtonPressed: {
        backgroundColor: theme.colors.errorBackground,
    },
    denyText: {
        color: theme.colors.error,
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
    },
    approveButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: theme.borderRadius.sm,
        alignItems: "center",
        backgroundColor: theme.colors.accent,
    },
    approveButtonPressed: {
        backgroundColor: theme.colors.accentPressed,
    },
    approveText: {
        color: theme.colors.textOnAccent,
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
    },
    inputField: {
        backgroundColor: theme.colors.bg,
        borderRadius: theme.borderRadius.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 10,
        fontSize: theme.fontSize.base,
        color: theme.colors.textPrimary,
        borderWidth: 1,
        borderColor: theme.colors.border,
        fontFamily: "monospace",
    },
    inputActionGroup: {
        gap: theme.spacing.md,
    },
    inputSubmitButton: {
        minHeight: 46,
        borderRadius: theme.borderRadius.sm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.accent,
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.accentPressed,
    },
    inputSubmitButtonDisabled: {
        opacity: 0.55,
    },
    inputSubmitButtonContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.xs,
    },
    inputSubmitButtonText: {
        color: "#ffffff",
        fontSize: theme.fontSize.base,
        fontWeight: "700",
        textAlign: "center",
    },
    choiceList: {
        gap: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
    },
    choiceButton: {
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        minHeight: 52,
        justifyContent: "center",
    },
    choiceButtonText: {
        color: theme.colors.textPrimary,
        fontSize: theme.fontSize.base,
        fontWeight: "500",
    },
    planCard: {
        // inherits maxHeight from card
    },
    planBlock: {
        borderRadius: theme.borderRadius.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
    },
    planBlockTitle: {
        color: theme.colors.textSecondary,
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    planBlockText: {
        color: theme.colors.textPrimary,
        fontSize: theme.fontSize.sm,
        lineHeight: 20,
    },
    secondaryButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: theme.borderRadius.sm,
        alignItems: "center",
        backgroundColor: theme.colors.bg,
        borderWidth: 1,
        borderColor: theme.colors.borderActive,
    },
    secondaryButtonPressed: {
        backgroundColor: theme.colors.bgTertiary,
    },
    secondaryButtonText: {
        color: theme.colors.textPrimary,
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
    },
    fullWidthButton: {
        marginTop: theme.spacing.sm,
    },
});

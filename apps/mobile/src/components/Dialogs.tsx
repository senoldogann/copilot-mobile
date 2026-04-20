// İzin ve kullanıcı girişi diyalogları — modal overlay

import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from "react-native";
import type { PermissionPrompt, PlanExitPrompt, UserInputPrompt } from "../stores/session-store";
import { useSessionStore } from "../stores/session-store";
import { updatePermissionLevel, updateSessionMode } from "../services/bridge";
import { colors, spacing, fontSize as fs, borderRadius } from "../theme/colors";

// Permission approval dialog
type PermissionProps = {
    prompt: PermissionPrompt;
    onRespond: (requestId: string, approved: boolean) => void;
};

export function PermissionDialog({ prompt, onRespond }: PermissionProps) {
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
    const [value, setValue] = useState("");

    return (
        <View style={styles.overlay}>
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Input Request</Text>
                </View>
                <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <Text style={styles.description}>{prompt.prompt}</Text>
                    {prompt.choices !== undefined && prompt.choices.length > 0 && (
                        <View style={styles.choiceList}>
                            {prompt.choices.map((choice) => (
                                <Pressable
                                    key={choice}
                                    style={styles.choiceButton}
                                    onPress={() => { onRespond(prompt.requestId, choice); setValue(""); }}
                                >
                                    <Text style={styles.choiceButtonText}>{choice}</Text>
                                </Pressable>
                            ))}
                        </View>
                    )}
                </ScrollView>
                <TextInput
                    style={styles.inputField}
                    value={value}
                    onChangeText={setValue}
                    placeholder="Your response..."
                    placeholderTextColor={colors.textPlaceholder}
                    autoFocus
                />
                <Pressable
                    style={({ pressed }) => [styles.approveButton, pressed && styles.approveButtonPressed]}
                    onPress={() => { onRespond(prompt.requestId, value); setValue(""); }}
                >
                    <Text style={styles.approveText}>Send</Text>
                </Pressable>
            </View>
        </View>
    );
}

type PlanExitProps = {
    prompt: PlanExitPrompt;
};

export function PlanExitDialog({ prompt }: PlanExitProps) {
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

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
        paddingHorizontal: spacing.lg,
    },
    card: {
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.lg,
        padding: 20,
        width: "100%",
        maxWidth: 420,
        maxHeight: "70%",
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.bg,
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    },
    cardHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    kindBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.xs,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
    },
    kindBadgeText: {
        fontSize: fs.xs,
        fontWeight: "600",
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    cardTitle: {
        fontSize: fs.base,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    scrollArea: {
        flexShrink: 1,
        marginBottom: spacing.md,
    },
    scrollContent: {
        gap: spacing.sm,
    },
    description: {
        fontSize: fs.sm,
        color: colors.textPrimary,
        lineHeight: 20,
    },
    detailList: {
        gap: 4,
    },
    detailText: {
        fontSize: fs.xs,
        color: colors.textTertiary,
        lineHeight: 16,
        fontFamily: "monospace",
    },
    actions: {
        flexDirection: "row",
        gap: spacing.sm,
    },
    denyButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: borderRadius.sm,
        alignItems: "center",
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.errorMuted,
    },
    denyButtonPressed: {
        backgroundColor: colors.errorBackground,
    },
    denyText: {
        color: colors.error,
        fontSize: fs.sm,
        fontWeight: "600",
    },
    approveButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: borderRadius.sm,
        alignItems: "center",
        backgroundColor: colors.accent,
    },
    approveButtonPressed: {
        backgroundColor: colors.accentPressed,
    },
    approveText: {
        color: colors.textOnAccent,
        fontSize: fs.sm,
        fontWeight: "600",
    },
    inputField: {
        backgroundColor: colors.bg,
        borderRadius: borderRadius.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        fontSize: fs.base,
        color: colors.textPrimary,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
        fontFamily: "monospace",
    },
    choiceList: {
        gap: spacing.sm,
    },
    choiceButton: {
        borderRadius: borderRadius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    choiceButtonText: {
        color: colors.textPrimary,
        fontSize: fs.base,
        fontWeight: "500",
    },
    planCard: {
        // inherits maxHeight from card
    },
    planBlock: {
        borderRadius: borderRadius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        padding: spacing.md,
        gap: spacing.sm,
    },
    planBlockTitle: {
        color: colors.textSecondary,
        fontSize: fs.sm,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    planBlockText: {
        color: colors.textPrimary,
        fontSize: fs.sm,
        lineHeight: 20,
    },
    secondaryButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: borderRadius.sm,
        alignItems: "center",
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.borderActive,
    },
    secondaryButtonPressed: {
        backgroundColor: colors.bgTertiary,
    },
    secondaryButtonText: {
        color: colors.textPrimary,
        fontSize: fs.sm,
        fontWeight: "600",
    },
    fullWidthButton: {
        marginTop: spacing.sm,
    },
});

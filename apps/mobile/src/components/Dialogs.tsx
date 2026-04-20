// İzin ve kullanıcı girişi diyalogları — modal overlay

import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import type { PermissionPrompt, UserInputPrompt } from "../stores/session-store";
import { colors, spacing, fontSize as fs, borderRadius } from "../theme/colors";

// Permission approval dialog
type PermissionProps = {
    prompt: PermissionPrompt;
    onRespond: (requestId: string, approved: boolean) => void;
};

export function PermissionDialog({ prompt, onRespond }: PermissionProps) {
    const metadataDetails = prompt.details.filter((detail) => detail.trim().length > 0);
    const primaryDescription =
        metadataDetails[0]
        ?? prompt.commandText
        ?? prompt.fileName
        ?? (prompt.toolName !== null ? `${prompt.toolName} is requesting access` : "This operation requires permission to continue");
    const secondaryDetails = [
        prompt.toolName !== null ? `Tool: ${prompt.toolName}` : null,
        prompt.fileName !== null ? `File: ${prompt.fileName}` : null,
        prompt.commandText !== null ? `Command: ${prompt.commandText}` : null,
        ...metadataDetails.slice(1),
    ].filter((detail): detail is string => detail !== null && detail.trim().length > 0);

    return (
        <View style={styles.overlay}>
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.kindBadge}>
                        <Text style={styles.kindBadgeText}>{prompt.kind}</Text>
                    </View>
                    <Text style={styles.cardTitle}>Permission Request</Text>
                </View>
                <Text style={styles.description}>{primaryDescription}</Text>
                {secondaryDetails.length > 0 && (
                    <View style={styles.detailList}>
                        {secondaryDetails.map((detail, index) => (
                            <Text key={`${index}-${detail}`} style={styles.detailText}>
                                {detail}
                            </Text>
                        ))}
                    </View>
                )}
                <View style={styles.actions}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.denyButton,
                            pressed && styles.denyButtonPressed,
                        ]}
                        onPress={() => onRespond(prompt.requestId, false)}
                    >
                        <Text style={styles.denyText}>Deny</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [
                            styles.approveButton,
                            pressed && styles.approveButtonPressed,
                        ]}
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
                <Text style={styles.description}>{prompt.prompt}</Text>
                <TextInput
                    style={styles.inputField}
                    value={value}
                    onChangeText={setValue}
                    placeholder="Your response..."
                    placeholderTextColor={colors.textPlaceholder}
                    autoFocus
                />
                <Pressable
                    style={({ pressed }) => [
                        styles.approveButton,
                        pressed && styles.approveButtonPressed,
                    ]}
                    onPress={() => {
                        onRespond(prompt.requestId, value);
                        setValue("");
                    }}
                >
                    <Text style={styles.approveText}>Send</Text>
                </Pressable>
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
    },
    card: {
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.lg,
        padding: 20,
        width: "88%",
        maxWidth: 420,
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
        marginBottom: spacing.md,
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
    description: {
        fontSize: fs.base,
        color: colors.textPrimary,
        lineHeight: 21,
        marginBottom: spacing.md,
    },
    detailList: {
        gap: 6,
        marginBottom: spacing.lg,
    },
    detailText: {
        fontSize: fs.sm,
        color: colors.textTertiary,
        lineHeight: 17,
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
        fontSize: fs.md,
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
        fontSize: fs.md,
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
});

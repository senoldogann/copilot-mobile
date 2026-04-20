// Ayarlar ekranı — GitHub Copilot mobil stili model seçimi, akıl yürütme eforu, bağlantı bilgileri

import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useConnectionStore } from "../src/stores/connection-store";
import { colors, spacing, fontSize as fs, borderRadius } from "../src/theme/colors";

function ConnectionInfo() {
    const serverUrl = useConnectionStore((s) => s.serverUrl);
    const fingerprint = useConnectionStore((s) => s.certFingerprint);
    const deviceId = useConnectionStore((s) => s.deviceId);
    const connectionError = useConnectionStore((s) => s.error);

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connection Info</Text>
            <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Server</Text>
                <Text style={styles.infoValue}>{serverUrl ?? "—"}</Text>
            </View>
            <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device ID</Text>
                <Text style={styles.infoValue}>{deviceId ?? "—"}</Text>
            </View>
            <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Certificate</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                    {fingerprint !== null ? `${fingerprint.slice(0, 16)}...` : "Local network WS connection"}
                </Text>
            </View>
            {connectionError !== null && (
                <Text style={styles.errorText}>{connectionError}</Text>
            )}
        </View>
    );
}

function ApprovalSettings() {
    return null;
}

export default function SettingsScreen() {
    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <ConnectionInfo />

            <View style={styles.footer}>
                <Text style={styles.footerText}>Copilot Mobile v0.1.0</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg,
    },
    content: {
        paddingHorizontal: spacing.lg,
        paddingVertical: 24,
    },
    section: {
        marginBottom: 32,
    },
    sectionHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: spacing.md,
    },
    sectionTitle: {
        fontSize: fs.md,
        fontWeight: "600",
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: spacing.md,
    },
    refreshText: {
        fontSize: fs.md,
        color: colors.accent,
    },
    segmentedControl: {
        flexDirection: "row",
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.md,
        padding: 2,
        borderWidth: 1,
        borderColor: colors.border,
    },
    segment: {
        flex: 1,
        paddingVertical: 10,
        alignItems: "center",
        borderRadius: borderRadius.sm,
    },
    segmentActive: {
        backgroundColor: colors.accent,
    },
    segmentText: {
        fontSize: fs.sm,
        color: colors.textTertiary,
        fontWeight: "500",
    },
    segmentTextActive: {
        color: colors.textPrimary,
        fontWeight: "600",
    },
    modelItem: {
        paddingVertical: spacing.md,
        paddingHorizontal: 14,
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.md,
        marginBottom: spacing.xs,
        borderWidth: 1,
        borderColor: colors.border,
    },
    modelItemActive: {
        borderColor: colors.accent,
        backgroundColor: colors.accentMuted,
    },
    modelItemDisabled: {
        opacity: 0.4,
    },
    modelHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    modelName: {
        fontSize: fs.md,
        color: colors.textPrimary,
        fontWeight: "500",
    },
    modelNameActive: {
        color: colors.textPrimary,
    },
    modelNameDisabled: {
        color: colors.textTertiary,
    },
    modelProvider: {
        fontSize: fs.xs,
        color: colors.textTertiary,
        marginTop: 2,
    },
    modelProviderDisabled: {
        color: colors.textTertiary,
    },
    modelMeta: {
        fontSize: fs.xs,
        color: colors.accent,
        marginTop: spacing.xs,
    },
    policyBadge: {
        backgroundColor: colors.errorBackground,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: borderRadius.xs,
    },
    policyBadgeText: {
        fontSize: 10,
        fontWeight: "600",
        color: colors.error,
    },
    emptyText: {
        fontSize: fs.md,
        color: colors.textTertiary,
    },
    toggleCard: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.lg,
        padding: 14,
        borderRadius: borderRadius.md,
        backgroundColor: colors.bgSecondary,
        borderWidth: 1,
        borderColor: colors.border,
    },
    toggleTextGroup: {
        flex: 1,
        gap: spacing.xs,
    },
    toggleTitle: {
        fontSize: fs.md,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    toggleDescription: {
        fontSize: fs.sm,
        lineHeight: 17,
        color: colors.textTertiary,
    },
    errorText: {
        marginTop: spacing.md,
        fontSize: fs.sm,
        color: colors.error,
        lineHeight: 17,
    },
    infoRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    infoLabel: {
        fontSize: fs.md,
        color: colors.textTertiary,
    },
    infoValue: {
        fontSize: fs.md,
        color: colors.textPrimary,
        maxWidth: "60%",
    },
    footer: {
        marginTop: 32,
        alignItems: "center",
    },
    footerText: {
        fontSize: fs.xs,
        color: colors.textTertiary,
    },
});

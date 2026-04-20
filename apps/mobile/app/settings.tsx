// Ayarlar ekranı — GitHub Copilot mobil stili model seçimi, akıl yürütme eforu, bağlantı bilgileri

import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Switch } from "react-native";
import { useSessionStore, deriveAvailableReasoningEfforts } from "../src/stores/session-store";
import { useConnectionStore } from "../src/stores/connection-store";
import { listModels, updateSettings } from "../src/services/bridge";
import { colors, spacing, fontSize as fs, borderRadius } from "../src/theme/colors";
import type { ReasoningEffortLevel } from "@copilot-mobile/shared";

// Readable labels for reasoning effort levels
const effortLabels: Record<ReasoningEffortLevel, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
};

function effortLabel(level: ReasoningEffortLevel): string {
    return effortLabels[level];
}

function ReasoningEffortPicker() {
    const current = useSessionStore((s) => s.reasoningEffort);
    const setEffort = useSessionStore((s) => s.setReasoningEffort);
    const models = useSessionStore((s) => s.models);
    const selectedModelId = useSessionStore((s) => s.selectedModel);

    const selectedModel = models.find((m) => m.id === selectedModelId);
    const { options, supported, listKnown } = deriveAvailableReasoningEfforts(selectedModel);

    // Hide picker if model does not support effort parameter.
    if (!supported) {
        return null;
    }

    // Support exists but host did not report level list — show picker disabled.
    if (!listKnown) {
        return (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reasoning Effort</Text>
                <Text style={styles.emptyText}>
                    This model supports reasoning effort but the host did not report available levels.
                    {current !== null ? `\nCurrent: ${current}` : ""}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reasoning Effort</Text>
            <View style={styles.segmentedControl}>
                {options.map((level) => (
                    <Pressable
                        key={level}
                        style={[
                            styles.segment,
                            current === level && styles.segmentActive,
                        ]}
                        onPress={() => setEffort(level)}
                    >
                        <Text
                            style={[
                                styles.segmentText,
                                current === level && styles.segmentTextActive,
                            ]}
                        >
                            {effortLabel(level)}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

function formatContextWindow(tokens: number | undefined): string | null {
    if (tokens === undefined || tokens <= 0) return null;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M ctx`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K ctx`;
    return `${tokens} ctx`;
}

function ModelPicker() {
    const models = useSessionStore((s) => s.models);
    const selected = useSessionStore((s) => s.selectedModel);
    const setModel = useSessionStore((s) => s.setSelectedModel);

    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Model</Text>
                <Pressable onPress={() => listModels()}>
                    <Text style={styles.refreshText}>Refresh</Text>
                </Pressable>
            </View>
            {models.length === 0 ? (
                <Text style={styles.emptyText}>Could not load model list</Text>
            ) : (
                models.map((model) => {
                    const isDisabled = model.policyState === "disabled";
                    const isSelected = selected === model.id;
                    const badges: Array<string> = [];

                    if (model.supportsVision === true) badges.push("👁 Vision");
                    const ctxLabel = formatContextWindow(model.contextWindowTokens);
                    if (ctxLabel !== null) badges.push(ctxLabel);
                    if (model.billingMultiplier !== undefined && model.billingMultiplier !== 1) {
                        badges.push(`${model.billingMultiplier}× cost`);
                    }

                    return (
                        <Pressable
                            key={model.id}
                            style={[
                                styles.modelItem,
                                isSelected && styles.modelItemActive,
                                isDisabled && styles.modelItemDisabled,
                            ]}
                            onPress={() => {
                                if (!isDisabled) setModel(model.id);
                            }}
                            disabled={isDisabled}
                        >
                            <View style={styles.modelHeader}>
                                <Text
                                    style={[
                                        styles.modelName,
                                        isSelected && styles.modelNameActive,
                                        isDisabled && styles.modelNameDisabled,
                                    ]}
                                >
                                    {model.name}
                                </Text>
                                {isDisabled && (
                                    <View style={styles.policyBadge}>
                                        <Text style={styles.policyBadgeText}>Disabled</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={[
                                styles.modelProvider,
                                isDisabled && styles.modelProviderDisabled,
                            ]}>
                                {model.provider}
                            </Text>
                            {badges.length > 0 && (
                                <Text style={styles.modelMeta}>
                                    {badges.join(" · ")}
                                </Text>
                            )}
                        </Pressable>
                    );
                })
            )}
        </View>
    );
}

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
    const autoApproveReads = useSessionStore((s) => s.autoApproveReads);
    const setAutoApproveReads = useSessionStore((s) => s.setAutoApproveReads);
    const readApprovalsConfigurable = useSessionStore(
        (s) => s.bridgeSettings.readApprovalsConfigurable
    );

    // Do not show toggle if bridge does not support read approval configuration.
    if (!readApprovalsConfigurable) {
        return null;
    }

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Default Approvals</Text>
            <View style={styles.toggleCard}>
                <View style={styles.toggleTextGroup}>
                    <Text style={styles.toggleTitle}>Auto-approve read permissions</Text>
                    <Text style={styles.toggleDescription}>
                        Applies to the Default approval level. Read-only file access is approved without interrupting the session.
                    </Text>
                </View>
                <Switch
                    value={autoApproveReads}
                    onValueChange={(value) => {
                        setAutoApproveReads(value);
                        void updateSettings({ autoApproveReads: value });
                    }}
                    trackColor={{ false: colors.bgOverlay, true: colors.accent }}
                    thumbColor={colors.textOnAccent}
                />
            </View>
            <View style={[styles.toggleCard, { marginTop: 8, alignItems: "flex-start" }]}>
                <View style={styles.toggleTextGroup}>
                    <Text style={styles.toggleTitle}>Session permission levels</Text>
                    <Text style={styles.toggleDescription}>
                        Choose Default, Bypass, or Autopilot from the composer. Those levels are session controls, not global settings.
                    </Text>
                </View>
            </View>
        </View>
    );
}

export default function SettingsScreen() {
    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <ModelPicker />
            <ReasoningEffortPicker />
            <ApprovalSettings />
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

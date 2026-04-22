import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";

import { useConnectionStore } from "../src/stores/connection-store";
import { type ThemeMode, type ThemeVariant } from "../src/theme/colors";
import { useAppTheme, useThemedStyles, type AppTheme } from "../src/theme/theme-context";
import { useThemeStore } from "../src/theme/theme-store";
import { buildConnectionDiagnosticsMetadata } from "../src/view-models/provider-metadata";

const THEME_MODES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
];

const THEME_VARIANTS: ReadonlyArray<{ value: ThemeVariant; label: string; swatch: string }> = [
    { value: "zinc", label: "Zinc", swatch: "#8b8b92" },
    { value: "midnight", label: "Midnight", swatch: "#4f8cff" },
    { value: "claude", label: "Claude", swatch: "#f78166" },
    { value: "ghostty", label: "Ghostty", swatch: "#8fb2ff" },
];

function ConnectionInfo() {
    const styles = useThemedStyles(createStyles);
    const theme = useAppTheme();
    const serverUrl = useConnectionStore((state) => state.serverUrl);
    const fingerprint = useConnectionStore((state) => state.certFingerprint);
    const deviceId = useConnectionStore((state) => state.deviceId);
    const connectionError = useConnectionStore((state) => state.error);
    const connectionState = useConnectionStore((state) => state.state);
    const metadata = buildConnectionDiagnosticsMetadata(serverUrl, connectionState, Date.now());

    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Connection</Text>
            <View style={styles.metadataChipRow}>
                {metadata.chips.map((chip) => (
                    <View key={`${chip.label}:${chip.tone}`} style={styles.metadataChip}>
                        <Text style={styles.metadataChipText}>{chip.label}</Text>
                    </View>
                ))}
            </View>
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
                    {fingerprint !== null ? `${fingerprint.slice(0, 16)}…` : "Relay / local ws"}
                </Text>
            </View>
            {connectionError !== null && (
                <Text style={[styles.errorText, { color: theme.colors.error }]}>
                    {connectionError}
                </Text>
            )}
        </View>
    );
}

function ThemeSettings() {
    const styles = useThemedStyles(createStyles);
    const themeMode = useThemeStore((state) => state.mode);
    const themeVariant = useThemeStore((state) => state.variant);

    const applyThemeSelection = async (mode: ThemeMode, variant: ThemeVariant) => {
        try {
            await useThemeStore.getState().setThemePreferences(mode, variant);
        } catch (error) {
            Alert.alert(
                "Theme update failed",
                error instanceof Error ? error.message : String(error),
            );
        }
    };

    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Theme</Text>
            <Text style={styles.cardDescription}>
                Choose how the app should render and which palette to use.
            </Text>

            <View style={styles.segmentedControl}>
                {THEME_MODES.map((item) => {
                    const active = themeMode === item.value;

                    return (
                        <Pressable
                            key={item.value}
                            style={[styles.segment, active && styles.segmentActive]}
                            onPress={() => {
                                void applyThemeSelection(item.value, themeVariant);
                            }}
                        >
                            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                                {item.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <View style={styles.variantList}>
                {THEME_VARIANTS.map((item) => {
                    const active = themeVariant === item.value;

                    return (
                        <Pressable
                            key={item.value}
                            style={[styles.variantRow, active && styles.variantRowActive]}
                            onPress={() => {
                                void applyThemeSelection(themeMode, item.value);
                            }}
                        >
                            <View style={[styles.variantSwatch, { backgroundColor: item.swatch }]} />
                            <Text style={styles.variantLabel}>{item.label}</Text>
                            {active && <Text style={styles.variantCheck}>✓</Text>}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

export default function SettingsScreen() {
    const styles = useThemedStyles(createStyles);
    const appVersion = Constants.expoConfig?.version ?? "0.1.0";

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <ConnectionInfo />
            <ThemeSettings />

            <View style={styles.card}>
                <Text style={styles.cardTitle}>Version</Text>
                <Text style={styles.versionText}>v{appVersion}</Text>
            </View>
        </ScrollView>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.bg,
        },
        content: {
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: 24,
            gap: theme.spacing.lg,
        },
        card: {
            backgroundColor: theme.colors.bgSecondary,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
        },
        cardTitle: {
            fontSize: theme.fontSize.xl,
            fontWeight: "700",
            color: theme.colors.textPrimary,
        },
        cardDescription: {
            fontSize: theme.fontSize.md,
            lineHeight: 18,
            color: theme.colors.textSecondary,
        },
        infoRow: {
            flexDirection: "row",
            justifyContent: "space-between",
            gap: theme.spacing.md,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderMuted,
        },
        infoLabel: {
            fontSize: theme.fontSize.md,
            color: theme.colors.textTertiary,
        },
        infoValue: {
            flex: 1,
            fontSize: theme.fontSize.md,
            color: theme.colors.textPrimary,
            textAlign: "right",
        },
        errorText: {
            fontSize: theme.fontSize.sm,
        },
        metadataChipRow: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.xs,
        },
        metadataChip: {
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgTertiary,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 4,
        },
        metadataChipText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            fontWeight: "600",
        },
        segmentedControl: {
            flexDirection: "row",
            gap: theme.spacing.sm,
        },
        segment: {
            flex: 1,
            minHeight: 40,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.bgTertiary,
        },
        segmentActive: {
            backgroundColor: theme.colors.accentMuted,
            borderColor: theme.colors.accent,
        },
        segmentText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.md,
            fontWeight: "600",
        },
        segmentTextActive: {
            color: theme.colors.textPrimary,
        },
        variantList: {
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            overflow: "hidden",
        },
        variantRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            backgroundColor: theme.colors.bgTertiary,
            borderTopWidth: 1,
            borderTopColor: theme.colors.borderMuted,
        },
        variantRowActive: {
            backgroundColor: theme.colors.bgElevated,
        },
        variantSwatch: {
            width: 18,
            height: 18,
            borderRadius: theme.borderRadius.full,
        },
        variantLabel: {
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.lg,
            fontWeight: "600",
        },
        variantCheck: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.lg,
            fontWeight: "700",
        },
        versionText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.lg,
            fontWeight: "600",
        },
    });
}

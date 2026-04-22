import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";

import { type ThemeMode, type ThemeVariant } from "../src/theme/colors";
import { useThemedStyles, type AppTheme } from "../src/theme/theme-context";
import { useThemeStore } from "../src/theme/theme-store";
import { prepareNotificationPermissions } from "../src/services/notifications";
import { syncRemoteNotificationRegistration } from "../src/services/bridge";

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
    const router = useRouter();

    async function handleEnableNotifications(): Promise<void> {
        try {
            const granted = await prepareNotificationPermissions();
            await syncRemoteNotificationRegistration({
                allowPrompt: false,
                force: true,
            });
            Alert.alert(
                granted ? "Notifications enabled" : "Notifications not enabled",
                granted
                    ? "Background session alerts are now available."
                    : "You can enable notifications later from iPhone Settings."
            );
        } catch (error) {
            Alert.alert(
                "Notification setup failed",
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <ThemeSettings />

            <View style={styles.card}>
                <Text style={styles.cardTitle}>Getting Started</Text>
                <Text style={styles.cardDescription}>
                    Replay the onboarding slider, review the Mac companion steps, or enable notifications for background approvals and completion alerts.
                </Text>
                <Pressable style={styles.actionButton} onPress={() => router.push("/onboarding")}>
                    <Text style={styles.actionButtonText}>Open onboarding</Text>
                </Pressable>
                <Pressable
                    style={[styles.actionButton, styles.secondaryActionButton]}
                    onPress={() => {
                        void handleEnableNotifications();
                    }}
                >
                    <Text style={[styles.actionButtonText, styles.secondaryActionButtonText]}>
                        Enable notifications
                    </Text>
                </Pressable>
            </View>

            <View style={styles.card}>
                <Text style={styles.cardTitle}>Version</Text>
                <View style={styles.versionPill}>
                    <Text style={styles.versionText}>v{appVersion}</Text>
                </View>
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
        actionButton: {
            minHeight: 44,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.md,
        },
        secondaryActionButton: {
            backgroundColor: theme.colors.bgTertiary,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        actionButtonText: {
            color: theme.colors.textOnAccent,
            fontSize: theme.fontSize.md,
            fontWeight: "700",
        },
        secondaryActionButtonText: {
            color: theme.colors.textPrimary,
        },
        versionText: {
            color: theme.colors.textPrimary,
            fontSize: 18,
            fontWeight: "800",
            letterSpacing: 0.2,
        },
        versionPill: {
            alignSelf: "flex-start",
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgTertiary,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
        },
    });
}

import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";

import { type ThemeMode, type ThemeVariant } from "../src/theme/colors";
import { useThemedStyles, type AppTheme, useAppTheme } from "../src/theme/theme-context";
import { useThemeStore } from "../src/theme/theme-store";
import { prepareNotificationPermissions } from "../src/services/notifications";
import { syncRemoteNotificationRegistration } from "../src/services/bridge";
import {
    PaletteIcon,
    MoonIcon,
    SunIcon,
    SmartphoneIcon,
    BookOpenIcon,
    BellIcon,
    DesktopIcon,
    ChevronRightIcon,
    CheckIcon,
    ArrowLeftIcon,
} from "../src/components/ProviderIcon";

const THEME_MODES: ReadonlyArray<{ value: ThemeMode; label: string; icon: (props: any) => React.ReactNode }> = [
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "System", icon: SmartphoneIcon },
];

const THEME_VARIANTS: ReadonlyArray<{ value: ThemeVariant; label: string; swatch: string }> = [
    { value: "zinc", label: "Zinc", swatch: "#8b8b92" },
    { value: "midnight", label: "Midnight", swatch: "#4f8cff" },
    { value: "claude", label: "Claude", swatch: "#f78166" },
    { value: "ghostty", label: "Ghostty", swatch: "#8fb2ff" },
];

function SettingsGroup({
    title,
    children,
    footer,
}: {
    title?: string;
    children: React.ReactNode;
    footer?: string;
}) {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.groupContainer}>
            {title && <Text style={styles.groupTitle}>{title.toUpperCase()}</Text>}
            <View style={styles.groupCard}>{children}</View>
            {footer && <Text style={styles.groupFooter}>{footer}</Text>}
        </View>
    );
}

function SettingsRow({
    icon,
    iconBackgroundColor,
    label,
    value,
    rightElement,
    onPress,
    isLast = false,
}: {
    icon: (props: any) => React.ReactNode;
    iconBackgroundColor?: string;
    label: string;
    value?: string;
    rightElement?: React.ReactNode;
    onPress?: () => void;
    isLast?: boolean;
}) {
    const styles = useThemedStyles(createStyles);
    const theme = useThemeStore((state) => state.variant);
    const content = (
        <View style={[styles.rowContent, !isLast && styles.rowBorder]}>
            <View style={styles.rowLeft}>
                <View style={[styles.iconWrap, { backgroundColor: iconBackgroundColor ?? "#8b8b92" }]}>
                    {icon({ size: 16, color: "#ffffff" })}
                </View>
                <Text style={styles.rowLabel}>{label}</Text>
            </View>
            <View style={styles.rowRight}>
                {value ? <Text style={styles.rowValue}>{value}</Text> : null}
                {rightElement ? (
                    rightElement
                ) : onPress ? (
                    <ChevronRightIcon size={14} color="#8b8b92" />
                ) : null}
            </View>
        </View>
    );

    if (onPress) {
        return (
            <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={onPress}
            >
                {content}
            </Pressable>
        );
    }

    return <View style={styles.row}>{content}</View>;
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
        <SettingsGroup
            title="Appearance"
            footer="Choose your preferred theme mode and accent color. The accent color changes the primary highlights across the app."
        >
            <View style={styles.segmentedRow}>
                <View style={styles.segmentedControl}>
                    {THEME_MODES.map((item) => {
                        const active = themeMode === item.value;
                        const Icon = item.icon;
                        return (
                            <Pressable
                                key={item.value}
                                style={[styles.segment, active && styles.segmentActive]}
                                onPress={() => {
                                    void applyThemeSelection(item.value, themeVariant);
                                }}
                            >
                                <Icon size={14} color={active ? "#ffffff" : "#8b8b92"} />
                                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                                    {item.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            {THEME_VARIANTS.map((item, index) => {
                const active = themeVariant === item.value;
                const isLast = index === THEME_VARIANTS.length - 1;

                return (
                    <SettingsRow
                        key={item.value}
                        icon={PaletteIcon}
                        iconBackgroundColor={item.swatch}
                        label={item.label}
                        isLast={isLast}
                        onPress={() => {
                            void applyThemeSelection(themeMode, item.value);
                        }}
                        rightElement={
                            active ? (
                                <CheckIcon size={16} color={item.swatch} />
                            ) : undefined
                        }
                    />
                );
            })}
        </SettingsGroup>
    );
}

export default function SettingsScreen() {
    const theme = useAppTheme();
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
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <ScrollView style={styles.container} contentContainerStyle={styles.content}>
                <View style={styles.pageHeader}>
                    <Pressable 
                        style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]} 
                        onPress={() => router.back()}
                        hitSlop={20}
                    >
                        <ArrowLeftIcon size={22} color={theme.colors.textPrimary} />
                    </Pressable>
                    <Text style={styles.pageTitle}>Settings</Text>
                </View>

                <ThemeSettings />

            <SettingsGroup
                title="App Settings"
                footer="Enable notifications to receive background completion alerts."
            >
                <SettingsRow
                    icon={BookOpenIcon}
                    iconBackgroundColor="#34C759"
                    label="Setup Guide"
                    onPress={() => router.push("/onboarding")}
                />
                <SettingsRow
                    icon={BellIcon}
                    iconBackgroundColor="#FF3B30"
                    label="Notifications"
                    isLast={true}
                    onPress={() => {
                        void handleEnableNotifications();
                    }}
                />
            </SettingsGroup>

            <SettingsGroup title="About">
                <SettingsRow
                    icon={DesktopIcon}
                    iconBackgroundColor="#8b8b92"
                    label="Version"
                    value={`v${appVersion}`}
                    isLast={true}
                />
            </SettingsGroup>
        </ScrollView>
        </>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.bgSecondary,
        },
        content: {
            paddingTop: Constants.statusBarHeight + 16,
            paddingBottom: 48,
        },
        pageHeader: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            gap: 12,
        },
        backButton: {
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: theme.colors.bgTertiary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
        },
        pageTitle: {
            fontSize: 26,
            lineHeight: 40,
            fontWeight: "700",
            color: theme.colors.textPrimary,
        },
        groupContainer: {
            marginBottom: theme.spacing.xl,
        },
        groupTitle: {
            fontSize: 12,
            fontWeight: "600",
            color: theme.colors.textTertiary,
            marginLeft: theme.spacing.lg,
            marginBottom: 6,
            letterSpacing: 0.3,
        },
        groupFooter: {
            fontSize: 13,
            color: theme.colors.textTertiary,
            marginHorizontal: theme.spacing.lg,
            marginTop: 8,
            lineHeight: 18,
        },
        groupCard: {
            backgroundColor: theme.colors.bgTertiary,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
        },
        row: {
            backgroundColor: theme.colors.bgTertiary,
            flexDirection: "row",
            alignItems: "stretch",
            paddingLeft: theme.spacing.md,
        },
        rowPressed: {
            backgroundColor: theme.colors.bgElevated,
        },
        rowContent: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 12,
            paddingRight: theme.spacing.md,
        },
        rowBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.borderMuted,
        },
        rowLeft: {
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
        },
        iconWrap: {
            width: 30,
            height: 30,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
        },
        rowLabel: {
            fontSize: 15,
            color: theme.colors.textPrimary,
            fontWeight: "500",
        },
        rowRight: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        rowValue: {
            fontSize: 15,
            color: theme.colors.textSecondary,
        },
        segmentedRow: {
            padding: theme.spacing.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgTertiary,
        },
        segmentedControl: {
            flexDirection: "row",
            backgroundColor: theme.colors.bgSecondary,
            padding: 3,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.borderMuted,
        },
        segment: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 8,
            borderRadius: 6,
        },
        segmentActive: {
            backgroundColor: theme.colors.accent,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.1,
            shadowRadius: 2,
            elevation: 2,
        },
        segmentText: {
            fontSize: 13,
            fontWeight: "600",
            color: theme.colors.textSecondary,
        },
        segmentTextActive: {
            color: "#ffffff",
        },
    });
}

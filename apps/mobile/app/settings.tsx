import React from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { SubscriptionPaywallSheet } from "../src/components/SubscriptionPaywallSheet";

import { type ThemeMode, type ThemeVariant } from "../src/theme/colors";
import { useThemedStyles, type AppTheme, useAppTheme } from "../src/theme/theme-context";
import { useThemeStore } from "../src/theme/theme-store";
import { APP_FONT_OPTIONS, type AppFontPreference } from "../src/theme/typography";
import { prepareNotificationPermissions } from "../src/services/notifications";
import { syncRemoteNotificationRegistration } from "../src/services/bridge";
import { POLICY_URL } from "../src/services/legal";
import {
    initializeRevenueCat,
    openSubscriptionManagement,
    restoreRevenueCatPurchases,
} from "../src/services/revenuecat";
import { useSubscriptionStore } from "../src/stores/subscription-store";
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
    CircleIcon,
    AlignLeftIcon,
    ChevronDownIcon,
    PaintbrushIcon,
    TypeIcon,
    SparklesIcon,
    ShieldCheckIcon,
    RefreshIcon,
} from "../src/components/ProviderIcon";

const THEME_MODES: ReadonlyArray<{ value: ThemeMode; label: string; icon: (props: any) => React.ReactNode }> = [
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "Match iPhone", icon: SmartphoneIcon },
];

const THEME_VARIANTS: ReadonlyArray<{ value: ThemeVariant; label: string; swatch: string }> = [
    { value: "zinc", label: "Zinc", swatch: "#8b8b92" },
    { value: "midnight", label: "Midnight", swatch: "#4f8cff" },
    { value: "claude", label: "Claude", swatch: "#f78166" },
    { value: "ghostty", label: "Ghostty", swatch: "#8fb2ff" },
    { value: "amoled", label: "Amoled", swatch: "#ffffff" },
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

async function openPolicyPage(): Promise<void> {
    await Linking.openURL(POLICY_URL);
}

function SettingsRow({
    icon,
    label,
    value,
    rightElement,
    onPress,
    isLast = false,
    active = false,
    indented = false,
}: {
    icon: (props: any) => React.ReactNode;
    label: string;
    value?: string;
    rightElement?: React.ReactNode;
    onPress?: () => void;
    isLast?: boolean;
    active?: boolean;
    indented?: boolean;
}) {
    const styles = useThemedStyles(createStyles);
    const theme = useAppTheme();
    const content = (
        <View style={[styles.rowContent, !isLast && styles.rowBorder]}>
            <View style={[styles.rowLeft, indented && { paddingLeft: 24 }]}>
                {icon({ size: 20, color: theme.colors.textSecondary })}
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
                style={({ pressed }) => [
                    styles.row,
                    active && styles.rowActive,
                    pressed && styles.rowPressed
                ]}
                onPress={onPress}
            >
                {content}
            </Pressable>
        );
    }

    return <View style={[styles.row, active && styles.rowActive]}>{content}</View>;
}

function ThemeSettings() {
    const styles = useThemedStyles(createStyles);
    const theme = useAppTheme();
    const themeMode = useThemeStore((state) => state.mode);
    const themeVariant = useThemeStore((state) => state.variant);
    const fontPreference = useThemeStore((state) => state.fontPreference);

    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = React.useState(false);
    const [isFontDropdownOpen, setIsFontDropdownOpen] = React.useState(false);

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

    const applyFontSelection = async (nextFontPreference: AppFontPreference) => {
        try {
            await useThemeStore.getState().setFontPreference(nextFontPreference);
        } catch (error) {
            Alert.alert(
                "Font update failed",
                error instanceof Error ? error.message : String(error),
            );
        }
    };

    return (
        <SettingsGroup
            title="Appearance"
            footer="Choose your preferred theme mode, accent color, and font family. The selected font updates the interface across the app."
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
                                <Icon
                                    size={14}
                                    color={active ? theme.colors.textOnAccent : theme.colors.textTertiary}
                                />
                                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                                    {item.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <SettingsRow
                icon={PaintbrushIcon}
                label="Theme Color"
                value={THEME_VARIANTS.find(t => t.value === themeVariant)?.label ?? ""}
                onPress={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                rightElement={
                    <View style={isThemeDropdownOpen ? { transform: [{ rotate: "180deg" }] } : undefined}>
                        <ChevronDownIcon size={16} color={theme.colors.textTertiary} />
                    </View>
                }
                isLast={!isThemeDropdownOpen && !isFontDropdownOpen}
            />

            {isThemeDropdownOpen && THEME_VARIANTS.map((item, index) => {
                const active = themeVariant === item.value;
                const isLast = false;

                return (
                    <SettingsRow
                        key={item.value}
                        icon={CircleIcon}
                        label={item.label}
                        isLast={isLast}
                        active={active}
                        indented={true}
                        onPress={() => {
                            void applyThemeSelection(themeMode, item.value);
                            setIsThemeDropdownOpen(false);
                        }}
                        rightElement={
                            active ? (
                                <CheckIcon size={16} color={item.swatch} />
                            ) : undefined
                        }
                    />
                );
            })}

            <SettingsRow
                icon={TypeIcon}
                label="Font Style"
                value={APP_FONT_OPTIONS.find(f => f.value === fontPreference)?.label ?? ""}
                onPress={() => setIsFontDropdownOpen(!isFontDropdownOpen)}
                rightElement={
                    <View style={isFontDropdownOpen ? { transform: [{ rotate: "180deg" }] } : undefined}>
                        <ChevronDownIcon size={16} color={theme.colors.textTertiary} />
                    </View>
                }
                isLast={!isFontDropdownOpen}
            />

            {isFontDropdownOpen && APP_FONT_OPTIONS.map((item, index) => {
                const active = fontPreference === item.value;
                const isLast = index === APP_FONT_OPTIONS.length - 1;

                return (
                    <SettingsRow
                        key={item.value}
                        icon={AlignLeftIcon}
                        label={item.label}
                        isLast={isLast}
                        active={active}
                        indented={true}
                        onPress={() => {
                            void applyFontSelection(item.value);
                            setIsFontDropdownOpen(false);
                        }}
                        rightElement={
                            active ? (
                                <CheckIcon size={16} color={theme.colors.accent} />
                            ) : undefined
                        }
                    />
                );
            })}
        </SettingsGroup>
    );
}

function formatSubscriptionStatus(input: {
    initialized: boolean;
    status: "idle" | "loading" | "ready" | "error";
    hasActiveEntitlement: boolean;
    offeringIdentifier: string | null;
}): string {
    if (input.status === "loading") {
        return "Syncing";
    }

    if (input.status === "error") {
        return "Needs attention";
    }

    if (!input.initialized) {
        return "Not initialized";
    }

    if (input.hasActiveEntitlement) {
        return "Pro active";
    }

    if (input.offeringIdentifier !== null) {
        return "Ready to subscribe";
    }

    return "Waiting for offering";
}

function RevenueCatSettings() {
    const styles = useThemedStyles(createStyles);
    const initialized = useSubscriptionStore((state) => state.initialized);
    const status = useSubscriptionStore((state) => state.status);
    const hasActiveEntitlement = useSubscriptionStore((state) => state.hasActiveEntitlement);
    const offering = useSubscriptionStore((state) => state.offering);
    const lastError = useSubscriptionStore((state) => state.lastError);
    const [isSubscriptionPaywallVisible, setIsSubscriptionPaywallVisible] = React.useState(false);

    const statusLabel = formatSubscriptionStatus({
        initialized,
        status,
        hasActiveEntitlement,
        offeringIdentifier: offering?.identifier ?? null,
    });

    async function handlePrimarySubscriptionAction(): Promise<void> {
        try {
            if (hasActiveEntitlement) {
                await openSubscriptionManagement();
                return;
            }

            setIsSubscriptionPaywallVisible(true);
        } catch (error) {
            Alert.alert(
                hasActiveEntitlement ? "Subscription management failed" : "Paywall failed",
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    async function handleRestorePurchases(): Promise<void> {
        try {
            await restoreRevenueCatPurchases();
            Alert.alert("Purchases restored", "Your RevenueCat purchases were restored successfully.");
        } catch (error) {
            Alert.alert(
                "Restore failed",
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    React.useEffect(() => {
        void initializeRevenueCat().catch((error: unknown) => {
            console.warn("[RevenueCat] Settings initialization failed", {
                error,
            });
        });
    }, []);

    return (
        <SettingsGroup
            title="Subscription"
            footer={lastError ?? "Subscription status is synced automatically. Use Restore Purchases if your plan does not appear."}
        >
            <SubscriptionPaywallSheet
                visible={isSubscriptionPaywallVisible}
                onClose={() => setIsSubscriptionPaywallVisible(false)}
                headline="Unlock unlimited desktop coding chats"
                body="Subscribe to Code Companion Pro to keep chatting from iPhone after your free first message."
            />
            <SettingsRow
                icon={ShieldCheckIcon}
                label="Code Companion Pro"
                value={statusLabel}
            />
            <SettingsRow
                icon={SparklesIcon}
                label={hasActiveEntitlement ? "Manage Subscription" : "Subscribe Monthly"}
                onPress={() => {
                    void handlePrimarySubscriptionAction();
                }}
            />
            <SettingsRow
                icon={RefreshIcon}
                label="Restore Purchases"
                onPress={() => {
                    void handleRestorePurchases();
                }}
            />
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

    async function handleOpenPolicyPage(label: string): Promise<void> {
        try {
            await openPolicyPage();
        } catch (error) {
            Alert.alert(
                `${label} link failed`,
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
                <RevenueCatSettings />

                <SettingsGroup
                    title="App Settings"
                    footer="Enable notifications to receive background completion alerts. Use /feedback in chat to send bug reports or issues by email."
                >
                    <SettingsRow
                        icon={BookOpenIcon}
                        label="Setup Guide"
                        onPress={() => router.push("/onboarding")}
                    />
                    <SettingsRow
                        icon={BellIcon}
                        label="Notifications"
                        isLast={true}
                        onPress={() => {
                            void handleEnableNotifications();
                        }}
                    />
                </SettingsGroup>

                <SettingsGroup
                    title="Legal"
                    footer="Review the subscription terms and privacy policy before subscribing."
                >
                    <SettingsRow
                        icon={BookOpenIcon}
                        label="Terms of Service"
                        onPress={() => {
                            void handleOpenPolicyPage("Terms");
                        }}
                    />
                    <SettingsRow
                        icon={ShieldCheckIcon}
                        label="Privacy Policy"
                        isLast={true}
                        onPress={() => {
                            void handleOpenPolicyPage("Privacy");
                        }}
                    />
                </SettingsGroup>

                <View style={styles.footerWrap}>
                    <Text style={styles.versionText}>v{appVersion}</Text>
                </View>
            </ScrollView>
        </>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.bg,
        },
        content: {
            flexGrow: 1,
            paddingTop: Constants.statusBarHeight + 16,
            paddingBottom: 48,
        },
        pageHeader: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: theme.spacing.lg,
            gap: 12,
        },
        backButton: {
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: "transparent",
            alignItems: "center",
            justifyContent: "center",
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
            marginLeft: theme.spacing.xl,
            marginBottom: 6,
            letterSpacing: 0.3,
        },
        groupFooter: {
            fontSize: 13,
            color: theme.colors.textTertiary,
            marginHorizontal: theme.spacing.xl,
            marginTop: 8,
            lineHeight: 18,
        },
        groupCard: {
            backgroundColor: "transparent",
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.borderMuted,
        },
        row: {
            backgroundColor: "transparent",
            flexDirection: "row",
            alignItems: "stretch",
            paddingLeft: theme.spacing.xl,
        },
        rowActive: {
            backgroundColor: theme.colors.bgSecondary,
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
            gap: 16,
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
            paddingLeft: theme.spacing.xl,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.borderMuted,
            backgroundColor: "transparent",
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
            color: theme.colors.textOnAccent,
        },
        footerWrap: {
            alignItems: "center",
            marginTop: "auto",
            marginBottom: theme.spacing.lg,
        },
        versionText: {
            fontSize: 13,
            color: theme.colors.textTertiary,
            fontWeight: "500",
            letterSpacing: 0.5,
        },
    });
}

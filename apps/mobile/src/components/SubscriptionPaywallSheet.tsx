import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { AgentIcon, RefreshIcon } from "./ProviderIcon";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";
import { useSubscriptionStore } from "../stores/subscription-store";
import {
    openSubscriptionManagement,
    purchaseRevenueCatMonthlyPackage,
    restoreRevenueCatPurchases,
} from "../services/revenuecat";
import { openPolicyUrl } from "../services/legal";

type SubscriptionPaywallSheetProps = {
    visible: boolean;
    onClose: () => void;
    headline: string;
    body: string;
};

export function SubscriptionPaywallSheet({
    visible,
    onClose,
    headline,
    body,
}: SubscriptionPaywallSheetProps) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const offering = useSubscriptionStore((state) => state.offering);
    const hasActiveEntitlement = useSubscriptionStore((state) => state.hasActiveEntitlement);
    const status = useSubscriptionStore((state) => state.status);
    const lastError = useSubscriptionStore((state) => state.lastError);
    const monthlyPackage = offering?.monthly ?? null;
    const priceLabel = monthlyPackage?.product.priceString ?? null;
    const [isBusy, setIsBusy] = React.useState(false);

    async function handleSubscribe(): Promise<void> {
        try {
            setIsBusy(true);
            const purchased = await purchaseRevenueCatMonthlyPackage();
            if (!purchased) {
                return;
            }

            Alert.alert("Subscription active", "Code Companion Pro is now active.");
            onClose();
        } catch (error) {
            Alert.alert(
                "Purchase failed",
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            setIsBusy(false);
        }
    }

    async function handleRestore(): Promise<void> {
        try {
            setIsBusy(true);
            await restoreRevenueCatPurchases();
            Alert.alert("Purchases restored", "Your subscription status has been refreshed.");
            onClose();
        } catch (error) {
            Alert.alert(
                "Restore failed",
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            setIsBusy(false);
        }
    }

    async function handleManage(): Promise<void> {
        try {
            setIsBusy(true);
            await openSubscriptionManagement();
        } catch (error) {
            Alert.alert(
                "Subscription management failed",
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            setIsBusy(false);
        }
    }

    async function handleOpenPolicy(label: string): Promise<void> {
        try {
            await openPolicyUrl();
        } catch (error) {
            Alert.alert(
                `${label} link failed`,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    return (
        <BottomSheet
            visible={visible}
            onClose={onClose}
            iconNode={<AgentIcon size={16} color={theme.colors.textPrimary} />}
            title="Code Companion Pro"
            subtitle={hasActiveEntitlement ? "Subscription active" : "Monthly plan"}
            contentContainerStyle={styles.sheetContent}
        >
            <View style={styles.sheetBody}>
                <View style={styles.topSection}>
                    <View style={styles.heroCard}>
                        <View style={styles.heroTopRow}>
                            <View style={styles.heroBadge}>
                                <Text style={styles.heroBadgeText}>Pro monthly</Text>
                            </View>
                            <Text style={styles.heroStatus}>
                                {hasActiveEntitlement ? "Active" : "Ready to unlock"}
                            </Text>
                        </View>
                        <View style={styles.heroTitleRow}>
                            <View style={styles.heroIcon}>
                                <AgentIcon size={24} color={theme.colors.textPrimary} />
                            </View>
                            <View style={styles.heroCopy}>
                                <Text style={styles.heroTitle}>{headline}</Text>
                                <Text style={styles.heroBody}>{body}</Text>
                            </View>
                        </View>
                        <View style={styles.heroPills}>
                            <View style={styles.heroPill}>
                                <Text style={styles.heroPillText}>Unlimited chats</Text>
                            </View>
                            <View style={styles.heroPill}>
                                <Text style={styles.heroPillText}>Restore anytime</Text>
                            </View>
                            <View style={styles.heroPill}>
                                <Text style={styles.heroPillText}>Cancel anytime</Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.priceCard}>
                        <View style={styles.priceHeader}>
                            <Text style={styles.planLabel}>Monthly</Text>
                            <Text style={styles.priceMeta}>Billed monthly</Text>
                        </View>
                        <View style={styles.priceRow}>
                            <Text style={styles.priceValue}>
                                {priceLabel ?? "Price unavailable"}
                            </Text>
                            <Text style={styles.priceSubtext}>/ month</Text>
                        </View>
                        <Text style={styles.priceMeta}>Cancel anytime. Restore purchases from the same screen.</Text>
                    </View>

                    <View style={styles.disclosureCard}>
                        <Text style={styles.disclosureText}>
                            Subscription automatically renews unless canceled at least 24 hours before
                            the end of the current period. Payment is charged to your Apple ID account
                            at confirmation of purchase. You can manage or cancel anytime in App Store
                            account settings.
                        </Text>
                    </View>
                </View>
                {lastError !== null && (
                    <View style={styles.errorCard}>
                        <Text style={styles.errorText}>{lastError}</Text>
                    </View>
                )}

                <View style={styles.bottomSection}>
                    <View style={styles.actionCard}>
                        {hasActiveEntitlement ? (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.primaryButton,
                                    (pressed || isBusy) && styles.primaryButtonPressed,
                                ]}
                                onPress={() => {
                                    void handleManage();
                                }}
                                disabled={isBusy}
                            >
                                <Text style={styles.primaryButtonText}>Manage subscription</Text>
                            </Pressable>
                        ) : (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.primaryButton,
                                    (pressed || isBusy || monthlyPackage === null || status === "loading") && styles.primaryButtonPressed,
                                ]}
                                onPress={() => {
                                    void handleSubscribe();
                                }}
                                disabled={isBusy || monthlyPackage === null || status === "loading"}
                            >
                                <Text style={styles.primaryButtonText}>
                                    {status === "loading" ? "Checking subscription..." : "Subscribe monthly"}
                                </Text>
                            </Pressable>
                        )}

                        <Pressable
                            style={({ pressed }) => [
                                styles.secondaryButton,
                                (pressed || isBusy) && styles.secondaryButtonPressed,
                            ]}
                            onPress={() => {
                                void handleRestore();
                            }}
                            disabled={isBusy}
                        >
                            <RefreshIcon size={16} color={theme.colors.textPrimary} />
                            <Text style={styles.secondaryButtonText}>Restore purchases</Text>
                        </Pressable>
                    </View>

                    <View style={styles.footerLinks}>
                        <Pressable
                            onPress={() => {
                                void handleOpenPolicy("Terms");
                            }}
                            hitSlop={8}
                        >
                            <Text style={styles.footerLinkText}>Terms</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                void handleOpenPolicy("Privacy");
                            }}
                            hitSlop={8}
                        >
                            <Text style={styles.footerLinkText}>Privacy</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </BottomSheet>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        heroCard: {
            padding: theme.spacing.md,
            borderRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            gap: theme.spacing.sm,
        },
        heroTopRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
        },
        heroBadge: {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 5,
            borderRadius: 999,
            backgroundColor: theme.colors.bgTertiary,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
        },
        heroBadgeText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            fontWeight: "700",
            letterSpacing: 0.5,
            textTransform: "uppercase",
        },
        heroStatus: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
        },
        heroTitleRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
        },
        heroIcon: {
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgElevated,
            alignItems: "center",
            justifyContent: "center",
        },
        heroCopy: {
            flex: 1,
            gap: theme.spacing.xs,
        },
        heroTitle: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.lg,
            fontWeight: "800",
            letterSpacing: -0.2,
        },
        heroBody: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            lineHeight: 18,
        },
        heroPills: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.xs,
        },
        heroPill: {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
        },
        heroPillText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            fontWeight: "600",
        },
        priceCard: {
            marginTop: theme.spacing.sm,
            padding: theme.spacing.md,
            borderRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgTertiary,
            gap: theme.spacing.xs,
        },
        priceHeader: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
        },
        priceRow: {
            flexDirection: "row",
            alignItems: "baseline",
            gap: 6,
        },
        planLabel: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 0.6,
        },
        priceValue: {
            color: theme.colors.textPrimary,
            fontSize: 24,
            fontWeight: "800",
            letterSpacing: -0.3,
        },
        priceSubtext: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
        },
        priceMeta: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: 20,
        },
        disclosureCard: {
            padding: theme.spacing.md,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgElevated,
        },
        disclosureText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            lineHeight: 18,
        },
        sheetContent: {
            flexGrow: 1,
            justifyContent: "space-between",
        },
        sheetBody: {
            flex: 1,
            gap: theme.spacing.md,
        },
        topSection: {
            gap: theme.spacing.md,
        },
        bottomSection: {
            flexGrow: 1,
            justifyContent: "flex-end",
            gap: theme.spacing.md,
        },
        errorCard: {
            marginTop: theme.spacing.sm,
            padding: theme.spacing.md,
            borderRadius: theme.borderRadius.lg,
            backgroundColor: theme.colors.errorBackground,
            borderWidth: 1,
            borderColor: theme.colors.errorMuted,
        },
        errorText: {
            color: theme.colors.error,
            fontSize: theme.fontSize.sm,
            lineHeight: 20,
        },
        actionCard: {
            marginTop: theme.spacing.sm,
            padding: theme.spacing.sm,
            borderRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgSecondary,
            gap: theme.spacing.xs,
        },
        primaryButton: {
            minHeight: 52,
            borderRadius: theme.borderRadius.xl,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
        },
        primaryButtonPressed: {
            opacity: 0.86,
        },
        primaryButtonText: {
            color: theme.colors.textOnAccent,
            fontSize: theme.fontSize.base,
            fontWeight: "700",
        },
        secondaryButton: {
            minHeight: 46,
            borderRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgElevated,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
            flexDirection: "row",
            gap: 8,
        },
        secondaryButtonPressed: {
            opacity: 0.86,
        },
        secondaryButtonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
            fontWeight: "600",
        },
        footerLinks: {
            marginTop: theme.spacing.sm,
            flexDirection: "row",
            justifyContent: "center",
            gap: theme.spacing.lg,
            flexWrap: "wrap",
        },
        footerLinkText: {
            color: theme.colors.textLink,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
            textDecorationLine: "underline",
        },
    });
}

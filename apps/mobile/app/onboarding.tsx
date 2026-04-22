import React, { useMemo, useRef, useState } from "react";
import {
    Alert,
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { prepareNotificationPermissions } from "../src/services/notifications";
import { syncRemoteNotificationRegistration } from "../src/services/bridge";
import { saveOnboardingCompleted } from "../src/services/credentials";
import {
    CheckSquareIcon,
    ShieldCheckIcon,
    SparklesIcon,
    TerminalIcon,
    ZapIcon,
} from "../src/components/ProviderIcon";
import { useAppTheme, useThemedStyles, type AppTheme } from "../src/theme/theme-context";

type OnboardingSlide = {
    id: string;
    stepLabel: string;
    title: string;
    description: string;
    bullets?: ReadonlyArray<string>;
    commands?: ReadonlyArray<string>;
    footer?: string;
    accent: "accent" | "link" | "success";
    icon: "sparkles" | "terminal" | "zap" | "shield";
};

const slides: ReadonlyArray<OnboardingSlide> = [
    {
        id: "welcome",
        stepLabel: "Step 1",
        title: "Your Mac runs the session",
        description: "This iPhone app is a remote client. The active coding session stays on your Mac.",
        bullets: [
            "Keep your Mac powered on, signed in, and online.",
            "Your phone only mirrors the session and sends actions back.",
            "After the first pairing, reconnect works through the relay.",
        ],
        footer: "You only need to complete this guide once per install.",
        accent: "accent",
        icon: "sparkles",
    },
    {
        id: "mac-setup",
        stepLabel: "Step 2",
        title: "Install the Mac companion",
        description: "Open Terminal on the Mac you want to use, then run these commands in order.",
        commands: [
            "npm install -g code-companion",
            "code-companion login",
            "code-companion up",
        ],
        footer: "`up` starts the companion and shows the pairing QR code.",
        accent: "link",
        icon: "terminal",
    },
    {
        id: "pairing",
        stepLabel: "Step 3",
        title: "Pair this iPhone once",
        description: "When your Mac shows the QR code, scan it here to connect this phone.",
        bullets: [
            "Open the scanner from the last step of this guide.",
            "Use the QR code produced by `code-companion up`.",
            "After pairing, the app can reconnect while your Mac stays available.",
        ],
        footer: "You can reopen this setup guide any time from Settings.",
        accent: "accent",
        icon: "shield",
    },
    {
        id: "alerts",
        stepLabel: "Step 4",
        title: "Enable alerts if you want background updates",
        description: "Notifications are optional, but useful when approvals are needed or a run finishes while the app is in the background.",
        bullets: [
            "Approval requests can reach you while the phone is locked.",
            "Completed or failed runs can send a background alert.",
            "You can change this later from Settings or iPhone Settings.",
        ],
        footer: "We ask for this permission with context here instead of on first launch.",
        accent: "success",
        icon: "zap",
    },
];

function getAccentColor(theme: AppTheme, accent: OnboardingSlide["accent"]): string {
    if (accent === "link") {
        return theme.colors.textLink;
    }

    if (accent === "success") {
        return theme.colors.success;
    }

    return theme.colors.accent;
}

function SlideIcon({ icon, color }: { icon: OnboardingSlide["icon"]; color: string }) {
    if (icon === "terminal") {
        return <TerminalIcon size={22} color={color} />;
    }

    if (icon === "zap") {
        return <ZapIcon size={22} color={color} />;
    }

    if (icon === "shield") {
        return <ShieldCheckIcon size={22} color={color} />;
    }

    return <SparklesIcon size={22} color={color} />;
}

function SlideCard({
    slide,
    width,
}: {
    slide: OnboardingSlide;
    width: number;
}) {
    const styles = useThemedStyles(createStyles);
    const theme = useAppTheme();
    const accentColor = getAccentColor(theme, slide.accent);

    return (
        <View style={[styles.slidePage, { width }]}>
            <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
                <View style={styles.cardTop}>
                    <View style={styles.cardHeader}>
                        <View
                            style={[
                                styles.iconBadge,
                                {
                                    backgroundColor: `${accentColor}16`,
                                    borderColor: `${accentColor}32`,
                                },
                            ]}
                        >
                            <SlideIcon icon={slide.icon} color={accentColor} />
                        </View>
                        <View style={styles.headerTextBlock}>
                            <Text style={[styles.stepLabel, { color: accentColor }]}>
                                {slide.stepLabel}
                            </Text>
                            <Text style={styles.title}>{slide.title}</Text>
                        </View>
                    </View>

                    <Text style={styles.description}>{slide.description}</Text>

                    {slide.bullets !== undefined && (
                        <View style={styles.section}>
                            {slide.bullets.map((bullet) => (
                                <View key={bullet} style={styles.bulletRow}>
                                    <View
                                        style={[
                                            styles.bulletDot,
                                            { backgroundColor: accentColor },
                                        ]}
                                    />
                                    <Text style={styles.bulletText}>{bullet}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    {slide.commands !== undefined && (
                        <View style={styles.commandBlock}>
                            {slide.commands.map((command) => (
                                <Text key={command} style={styles.commandLine}>
                                    {command}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>

                {slide.footer !== undefined && (
                    <View style={styles.footerNote}>
                        <CheckSquareIcon size={14} color={accentColor} />
                        <Text style={styles.footerNoteText}>{slide.footer}</Text>
                    </View>
                )}
            </View>
        </View>
    );
}

export default function OnboardingScreen() {
    const styles = useThemedStyles(createStyles);
    const { width } = useWindowDimensions();
    const flatListRef = useRef<FlatList<OnboardingSlide>>(null);
    const router = useRouter();
    const [activeIndex, setActiveIndex] = useState(0);
    const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);

    const slideWidth = useMemo(() => width, [width]);
    const isFirstSlide = activeIndex === 0;
    const isLastSlide = activeIndex === slides.length - 1;

    async function finishGuide(target: "/" | "/scan"): Promise<void> {
        await saveOnboardingCompleted(true);
        router.replace(target);
    }

    async function handleEnableNotifications(): Promise<void> {
        if (isRequestingNotifications) {
            return;
        }

        try {
            setIsRequestingNotifications(true);
            const granted = await prepareNotificationPermissions();
            await syncRemoteNotificationRegistration({
                allowPrompt: false,
                force: true,
            });

            Alert.alert(
                granted ? "Notifications enabled" : "Notifications not enabled",
                granted
                    ? "Background approvals and completion alerts are now available."
                    : "You can enable notifications later from iPhone Settings."
            );
        } catch (error) {
            Alert.alert(
                "Notification setup failed",
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            setIsRequestingNotifications(false);
        }
    }

    function scrollToIndex(index: number): void {
        flatListRef.current?.scrollToIndex({
            index,
            animated: true,
        });
        setActiveIndex(index);
    }

    function handleScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>): void {
        const nextIndex = Math.round(event.nativeEvent.contentOffset.x / slideWidth);
        setActiveIndex(Math.max(0, Math.min(nextIndex, slides.length - 1)));
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={styles.headerCopy}>
                        <Text style={styles.brand}>Code Companion</Text>
                        <Text style={styles.headerTitle}>Set up your Mac companion once</Text>
                        <Text style={styles.headerSubtitle}>
                            Follow the steps, then scan the QR code from your Mac.
                        </Text>
                    </View>
                    <View style={styles.stepPill}>
                        <Text style={styles.stepPillText}>{activeIndex + 1}/{slides.length}</Text>
                    </View>
                </View>

                <FlatList
                    ref={flatListRef}
                    data={slides}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <SlideCard slide={item} width={slideWidth} />
                    )}
                    horizontal
                    pagingEnabled
                    bounces={false}
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={handleScrollEnd}
                    getItemLayout={(_, index) => ({
                        length: slideWidth,
                        offset: slideWidth * index,
                        index,
                    })}
                />

                <View style={styles.paginationRow}>
                    {slides.map((slide, index) => {
                        const active = index === activeIndex;
                        return (
                            <View
                                key={slide.id}
                                style={[
                                    styles.paginationDot,
                                    active && styles.paginationDotActive,
                                ]}
                            />
                        );
                    })}
                </View>

                <View style={styles.footer}>
                    <Pressable
                        style={({ pressed }) => [
                            styles.utilityButton,
                            pressed && styles.utilityButtonPressed,
                        ]}
                        onPress={() => {
                            void handleEnableNotifications();
                        }}
                    >
                        <Text style={styles.utilityButtonText}>
                            {isRequestingNotifications ? "Checking alerts..." : "Enable alerts"}
                        </Text>
                    </Pressable>

                    <View style={styles.actionRow}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.secondaryButton,
                                isFirstSlide && styles.secondaryButtonDisabled,
                                pressed && !isFirstSlide && styles.secondaryButtonPressed,
                            ]}
                            disabled={isFirstSlide}
                            onPress={() => scrollToIndex(activeIndex - 1)}
                        >
                            <Text
                                style={[
                                    styles.secondaryButtonText,
                                    isFirstSlide && styles.secondaryButtonTextDisabled,
                                ]}
                            >
                                Back
                            </Text>
                        </Pressable>

                        {isLastSlide ? (
                            <View style={styles.finalActions}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.secondaryButton,
                                        styles.finalSecondaryButton,
                                        pressed && styles.secondaryButtonPressed,
                                    ]}
                                    onPress={() => {
                                        void finishGuide("/");
                                    }}
                                >
                                    <Text style={styles.secondaryButtonText}>Open app</Text>
                                </Pressable>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.primaryButton,
                                        pressed && styles.primaryButtonPressed,
                                    ]}
                                    onPress={() => {
                                        void finishGuide("/scan");
                                    }}
                                >
                                    <Text style={styles.primaryButtonText}>Scan QR code</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.primaryButton,
                                    pressed && styles.primaryButtonPressed,
                                ]}
                                onPress={() => scrollToIndex(activeIndex + 1)}
                            >
                                <Text style={styles.primaryButtonText}>Next</Text>
                            </Pressable>
                        )}
                    </View>
                </View>
            </View>
        </SafeAreaView>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        safeArea: {
            flex: 1,
            backgroundColor: theme.colors.bg,
        },
        container: {
            flex: 1,
            backgroundColor: theme.colors.bg,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.sm,
        },
        header: {
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            gap: theme.spacing.md,
        },
        headerCopy: {
            flex: 1,
            gap: 4,
        },
        brand: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 0.8,
        },
        headerTitle: {
            color: theme.colors.textPrimary,
            fontSize: 24,
            lineHeight: 30,
            fontWeight: "800",
        },
        headerSubtitle: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.md,
            lineHeight: 20,
        },
        stepPill: {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 8,
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
        },
        stepPillText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
        },
        slidePage: {
            flex: 1,
            paddingHorizontal: theme.spacing.lg,
        },
        card: {
            flex: 1,
            borderRadius: 24,
            borderWidth: 1,
            backgroundColor: theme.colors.bgSecondary,
            padding: theme.spacing.lg,
            justifyContent: "space-between",
            gap: theme.spacing.md,
        },
        cardTop: {
            gap: theme.spacing.md,
        },
        cardHeader: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.md,
        },
        iconBadge: {
            width: 48,
            height: 48,
            borderRadius: 14,
            borderWidth: 1,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
        },
        headerTextBlock: {
            flex: 1,
            gap: 4,
        },
        stepLabel: {
            fontSize: theme.fontSize.xs,
            fontWeight: "800",
            textTransform: "uppercase",
            letterSpacing: 0.8,
        },
        title: {
            color: theme.colors.textPrimary,
            fontSize: 24,
            lineHeight: 30,
            fontWeight: "800",
        },
        description: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.md,
            lineHeight: 22,
        },
        section: {
            gap: 12,
        },
        bulletRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
        },
        bulletDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 7,
            flexShrink: 0,
        },
        bulletText: {
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            lineHeight: 22,
        },
        commandBlock: {
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            gap: 10,
        },
        commandLine: {
            color: theme.colors.textPrimary,
            fontFamily: "monospace",
            fontSize: theme.fontSize.md,
            lineHeight: 20,
        },
        footerNote: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
            paddingTop: theme.spacing.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
        },
        footerNoteText: {
            flex: 1,
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: 18,
        },
        paginationRow: {
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            marginTop: theme.spacing.md,
            marginBottom: theme.spacing.md,
        },
        paginationDot: {
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: theme.colors.border,
        },
        paginationDotActive: {
            width: 20,
            backgroundColor: theme.colors.accent,
        },
        footer: {
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.md,
        },
        utilityButton: {
            minHeight: 46,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
        },
        utilityButtonPressed: {
            opacity: 0.84,
        },
        utilityButtonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            fontWeight: "700",
        },
        actionRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
        },
        finalActions: {
            flex: 1,
            flexDirection: "row",
            gap: theme.spacing.md,
        },
        primaryButton: {
            flex: 1,
            minHeight: 52,
            borderRadius: theme.borderRadius.lg,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
        },
        primaryButtonPressed: {
            opacity: 0.88,
        },
        primaryButtonText: {
            color: theme.colors.textOnAccent,
            fontSize: theme.fontSize.md,
            fontWeight: "800",
        },
        secondaryButton: {
            minWidth: 92,
            minHeight: 52,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
        },
        finalSecondaryButton: {
            flex: 1,
        },
        secondaryButtonPressed: {
            opacity: 0.84,
        },
        secondaryButtonDisabled: {
            opacity: 0.4,
        },
        secondaryButtonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            fontWeight: "700",
        },
        secondaryButtonTextDisabled: {
            color: theme.colors.textTertiary,
        },
    });
}

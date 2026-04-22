import React, { useMemo, useRef, useState } from "react";
import {
    Alert,
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    ScrollView,
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
    SparklesIcon,
    TerminalIcon,
    ShieldCheckIcon,
    ZapIcon,
} from "../src/components/ProviderIcon";
import { useAppTheme, useThemedStyles, type AppTheme } from "../src/theme/theme-context";

type OnboardingSlide = {
    id: string;
    eyebrow: string;
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
        eyebrow: "How it works",
        title: "Your Mac does the work, your iPhone stays in sync",
        description: "Code Companion is a remote client for a coding session that runs on your own Mac.",
        bullets: [
            "Your iPhone does not run coding agents by itself.",
            "Keep your Mac powered on, signed in, and online while you use the app.",
            "After the first QR pairing, reconnect works over the hosted relay.",
        ],
        footer: "You only need to review this setup flow once, and you can reopen it later from Settings.",
        accent: "accent",
        icon: "sparkles",
    },
    {
        id: "mac-setup",
        eyebrow: "Mac setup",
        title: "Install the companion on your Mac",
        description: "Open Terminal on the Mac you want to pair, then run these commands in order.",
        commands: [
            "npm install -g code-companion",
            "code-companion login",
            "code-companion up",
        ],
        footer: "`login` completes sign-in. `up` starts the companion and shows the pairing QR code.",
        accent: "link",
        icon: "terminal",
    },
    {
        id: "alerts",
        eyebrow: "Stay informed",
        title: "Turn on alerts only when they help you",
        description: "Notification permission is optional, but useful when the app is in the background.",
        bullets: [
            "Get notified when approval is required.",
            "Get notified when a run finishes or fails.",
            "You can change notification access later in iPhone Settings.",
        ],
        footer: "Apple recommends asking for permission with context, so we keep this inside onboarding and Settings.",
        accent: "success",
        icon: "zap",
    },
    {
        id: "pairing",
        eyebrow: "Ready",
        title: "Scan once and start using your Mac remotely",
        description: "When your Mac shows the pairing QR code, open the scanner and connect this iPhone.",
        bullets: [
            "Scan the QR code shown by `code-companion up`.",
            "If your Mac stays available, the phone can reconnect later.",
            "You can reopen this setup slider any time from Settings.",
        ],
        footer: "Before App Store submission we still need a public support URL and privacy policy URL.",
        accent: "accent",
        icon: "shield",
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
        return <TerminalIcon size={26} color={color} />;
    }

    if (icon === "zap") {
        return <ZapIcon size={26} color={color} />;
    }

    if (icon === "shield") {
        return <ShieldCheckIcon size={26} color={color} />;
    }

    return <SparklesIcon size={26} color={color} />;
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
            <ScrollView
                style={styles.slideScroll}
                contentContainerStyle={styles.slideScrollContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
            >
                <View style={styles.slideShell}>
                    <View
                        style={[
                            styles.accentOrb,
                            {
                                backgroundColor: `${accentColor}26`,
                                shadowColor: accentColor,
                            },
                        ]}
                    />
                    <View
                        style={[
                            styles.card,
                            {
                                borderColor: `${accentColor}33`,
                            },
                        ]}
                    >
                        <View style={styles.cardHeader}>
                            <View
                                style={[
                                    styles.iconBadge,
                                    {
                                        backgroundColor: `${accentColor}18`,
                                        borderColor: `${accentColor}33`,
                                    },
                                ]}
                            >
                                <SlideIcon icon={slide.icon} color={accentColor} />
                            </View>
                            <Text style={[styles.eyebrow, { color: accentColor }]}>
                                {slide.eyebrow}
                            </Text>
                        </View>

                        <Text style={styles.title}>{slide.title}</Text>
                        <Text style={styles.description}>{slide.description}</Text>

                        {slide.bullets !== undefined && (
                            <View style={styles.bulletList}>
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
                            <View style={styles.codeBlock}>
                                {slide.commands.map((command) => (
                                    <Text key={command} style={styles.codeLine}>
                                        {command}
                                    </Text>
                                ))}
                            </View>
                        )}

                        {slide.footer !== undefined && (
                            <View style={styles.footerNote}>
                                <CheckSquareIcon size={14} color={accentColor} />
                                <Text style={styles.footerNoteText}>{slide.footer}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </ScrollView>
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
                    ? "You will receive alerts when a run finishes or your approval is needed in the background."
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
                <View style={styles.topBar}>
                    <View>
                        <Text style={styles.brand}>Code Companion</Text>
                        <Text style={styles.topBarSubtitle}>Premium setup flow</Text>
                    </View>
                    <View style={styles.progressPill}>
                        <Text style={styles.progressPillText}>
                            {activeIndex + 1}/{slides.length}
                        </Text>
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

                <View style={styles.bottomSheet}>
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
                                styles.ghostButton,
                                isFirstSlide && styles.ghostButtonDisabled,
                                pressed && !isFirstSlide && styles.ghostButtonPressed,
                            ]}
                            disabled={isFirstSlide}
                            onPress={() => scrollToIndex(activeIndex - 1)}
                        >
                            <Text
                                style={[
                                    styles.ghostButtonText,
                                    isFirstSlide && styles.ghostButtonTextDisabled,
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
            paddingTop: theme.spacing.md,
        },
        topBar: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.md,
        },
        brand: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.xl,
            fontWeight: "800",
            letterSpacing: 0.2,
        },
        topBarSubtitle: {
            marginTop: 2,
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
        },
        progressPill: {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 8,
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.bgSecondary,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        progressPillText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
        },
        slidePage: {
            flex: 1,
            paddingHorizontal: theme.spacing.lg,
        },
        slideScroll: {
            flex: 1,
        },
        slideScrollContent: {
            flexGrow: 1,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.lg,
        },
        slideShell: {
            flexGrow: 1,
            justifyContent: "center",
        },
        accentOrb: {
            position: "absolute",
            top: 24,
            right: 12,
            width: 148,
            height: 148,
            borderRadius: 74,
            opacity: 0.9,
            shadowOpacity: 0.22,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 8,
        },
        card: {
            borderRadius: 30,
            borderWidth: 1,
            backgroundColor: theme.colors.bgSecondary,
            padding: theme.spacing.xl,
            gap: theme.spacing.lg,
            overflow: "hidden",
        },
        cardHeader: {
            gap: theme.spacing.md,
        },
        iconBadge: {
            width: 60,
            height: 60,
            borderRadius: 18,
            borderWidth: 1,
            alignItems: "center",
            justifyContent: "center",
        },
        eyebrow: {
            fontSize: theme.fontSize.sm,
            fontWeight: "800",
            textTransform: "uppercase",
            letterSpacing: 0.9,
        },
        title: {
            color: theme.colors.textPrimary,
            fontSize: 30,
            lineHeight: 36,
            fontWeight: "800",
        },
        description: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.lg,
            lineHeight: 25,
        },
        bulletList: {
            gap: theme.spacing.md,
        },
        bulletRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.md,
        },
        bulletDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 8,
        },
        bulletText: {
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
            lineHeight: 22,
        },
        codeBlock: {
            borderRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderColor: theme.colors.codeBorder,
            backgroundColor: theme.colors.codeBg,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            gap: theme.spacing.sm,
        },
        codeLine: {
            color: theme.colors.codeText,
            fontSize: theme.fontSize.base,
            fontWeight: "700",
        },
        footerNote: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
            paddingTop: 2,
        },
        footerNoteText: {
            flex: 1,
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: 20,
        },
        paginationRow: {
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            marginTop: theme.spacing.sm,
            marginBottom: theme.spacing.lg,
        },
        paginationDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.border,
        },
        paginationDotActive: {
            width: 28,
            backgroundColor: theme.colors.accent,
        },
        bottomSheet: {
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.md,
        },
        utilityButton: {
            minHeight: 46,
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            alignItems: "center",
            justifyContent: "center",
        },
        utilityButtonPressed: {
            opacity: 0.88,
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
        ghostButton: {
            minHeight: 52,
            minWidth: 96,
            paddingHorizontal: theme.spacing.lg,
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            alignItems: "center",
            justifyContent: "center",
        },
        ghostButtonPressed: {
            opacity: 0.88,
        },
        ghostButtonDisabled: {
            opacity: 0.4,
        },
        ghostButtonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            fontWeight: "700",
        },
        ghostButtonTextDisabled: {
            color: theme.colors.textDisabled,
        },
        finalActions: {
            flex: 1,
            flexDirection: "row",
            gap: theme.spacing.sm,
        },
        primaryButton: {
            flex: 1,
            minHeight: 52,
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
        },
        primaryButtonPressed: {
            backgroundColor: theme.colors.accentPressed,
        },
        primaryButtonText: {
            color: theme.colors.textOnAccent,
            fontSize: theme.fontSize.md,
            fontWeight: "800",
        },
        secondaryButton: {
            flex: 1,
            minHeight: 52,
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.md,
        },
        secondaryButtonPressed: {
            opacity: 0.88,
        },
        secondaryButtonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            fontWeight: "700",
        },
    });
}

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
    Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { saveOnboardingCompleted } from "../src/services/credentials";
import { prepareNotificationPermissions } from "../src/services/notifications";
import { syncRemoteNotificationRegistration } from "../src/services/bridge";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    BellIcon,
    CheckSquareIcon,
    DesktopIcon,
    ScanIcon,
    TerminalIcon,
} from "../src/components/ProviderIcon";
import { useThemedStyles, type AppTheme } from "../src/theme/theme-context";

type OnboardingSlide = {
    id: string;
    stepLabel: string;
    title: string;
    description: string;
    points: ReadonlyArray<string>;
    note: string;
    icon: "desktop" | "terminal" | "scan";
    commands?: ReadonlyArray<string>;
};

const slides: ReadonlyArray<OnboardingSlide> = [
    {
        id: "how-it-works",
        stepLabel: "Step 1",
        title: "Your computer runs the real session",
        description: "This iPhone app is the remote control. The real GitHub Copilot session stays on your Mac or Windows PC.",
        points: [
            "Keep your computer powered on, signed in, and online.",
            "Your phone mirrors activity and sends actions back.",
        ],
        note: "You only need to scan a QR code to pair.",
        icon: "desktop",
    },
    {
        id: "install",
        stepLabel: "Step 2",
        title: "Install the desktop companion",
        description: "Run these commands on the Mac or Windows computer you want to control from your phone.",
        points: [
            "Install it globally so you can run the `code-companion` command from any terminal.",
            "The last command starts the companion and shows the pairing QR code.",
        ],
        note: "Use the same computer later when you want to resume sessions.",
        icon: "terminal",
        commands: [
            "npm install -g @senoldogann/code-companion",
            "code-companion login",
            "code-companion up",
        ],
    },
    {
        id: "pair-and-alerts",
        stepLabel: "Step 3",
        title: "Scan once and optionally enable alerts",
        description: "Scan the QR code from your computer, then allow alerts if you want approval and completion updates in the background.",
        points: [
            "Use the QR code shown by `code-companion up`.",
            "Notifications are optional and can also be enabled later in Settings.",
        ],
        note: "After pairing, reconnect works as long as your desktop companion is available.",
        icon: "scan",
    },
];

function renderSlideIcon(icon: OnboardingSlide["icon"], color: string): React.ReactNode {
    if (icon === "desktop") {
        return <DesktopIcon size={40} color={color} />;
    }

    if (icon === "terminal") {
        return <TerminalIcon size={40} color={color} />;
    }

    return <ScanIcon size={40} color={color} />;
}

function SlideCard({ item, width }: { item: OnboardingSlide; width: number }) {
    const styles = useThemedStyles(createStyles);
    const accentColor = styles.iconContainer.backgroundColor as string;

    return (
        <View style={[styles.slidePage, { width }]}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.slideSurface}
                bounces={false}
            >
                <View style={styles.iconContainer}>
                    {renderSlideIcon(item.icon, styles.iconColor.color as string)}
                </View>

                <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{item.stepLabel}</Text>
                </View>

                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.description}>{item.description}</Text>

                <View style={styles.pointsBlock}>
                    {item.points.map((point) => (
                        <View key={point} style={styles.pointRow}>
                            <View style={styles.pointDot} />
                            <Text style={styles.pointText}>{point}</Text>
                        </View>
                    ))}
                </View>

                {item.commands !== undefined ? (
                    <View style={styles.commandBlock}>
                        {item.commands.map((command) => (
                            <Text key={command} style={styles.commandLine}>
                                {command}
                            </Text>
                        ))}
                    </View>
                ) : null}

                <View style={styles.noteRow}>
                    <CheckSquareIcon size={14} color={styles.iconColor.color as string} />
                    <Text style={styles.noteText}>{item.note}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

function FooterButton({
    label,
    onPress,
    icon,
    variant,
    disabled,
}: {
    label: string;
    onPress: () => void;
    icon?: React.ReactNode;
    variant: "primary" | "secondary" | "ghost";
    disabled?: boolean;
}) {
    const styles = useThemedStyles(createStyles);
    const isPrimary = variant === "primary";
    const isGhost = variant === "ghost";

    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.buttonBase,
                isPrimary && styles.primaryButton,
                variant === "secondary" && styles.secondaryButton,
                isGhost && styles.ghostButton,
                disabled && styles.buttonDisabled,
                pressed && !disabled && styles.buttonPressed,
            ]}
        >
            <View style={styles.buttonContent}>
                {icon !== undefined ? <View style={styles.buttonIcon}>{icon}</View> : null}
                <Text
                    style={[
                        styles.buttonText,
                        isPrimary && styles.primaryButtonText,
                        isGhost && styles.ghostButtonText,
                        disabled && styles.buttonTextDisabled,
                    ]}
                >
                    {label}
                </Text>
            </View>
        </Pressable>
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


                <FlatList
                    ref={flatListRef}
                    data={slides}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => <SlideCard item={item} width={slideWidth} />}
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

                <View style={styles.progressRow}>
                    <View style={styles.paginationRow}>
                        {slides.map((slide, index) => (
                            <View
                                key={slide.id}
                                style={[
                                    styles.paginationDot,
                                    index === activeIndex && styles.paginationDotActive,
                                ]}
                            />
                        ))}
                    </View>
                </View>

                <View style={styles.footer}>
                    {isLastSlide ? (
                        <FooterButton
                            label={isRequestingNotifications ? "Checking alerts..." : "Enable alerts"}
                            onPress={() => {
                                void handleEnableNotifications();
                            }}
                            icon={<BellIcon size={16} color={styles.ghostButtonText.color} />}
                            variant="ghost"
                        />
                    ) : null}

                    <View style={styles.actionRow}>
                        {!isLastSlide && (
                            <FooterButton
                                label="Back"
                                onPress={() => scrollToIndex(activeIndex - 1)}
                                icon={<ArrowLeftIcon size={16} color={styles.buttonText.color} />}
                                variant="secondary"
                                disabled={isFirstSlide}
                            />
                        )}

                        {isLastSlide ? (
                            <View style={styles.finalActions}>
                                <FooterButton
                                    label="Open app"
                                    onPress={() => {
                                        void finishGuide("/");
                                    }}
                                    variant="secondary"
                                    icon={<DesktopIcon size={16} color={styles.buttonText.color} />}
                                />
                                <FooterButton
                                    label="Scan QR code"
                                    onPress={() => {
                                        void finishGuide("/scan");
                                    }}
                                    variant="primary"
                                    icon={<ScanIcon size={16} color={styles.primaryButtonText.color} />}
                                />
                            </View>
                        ) : (
                            <FooterButton
                                label="Next"
                                onPress={() => scrollToIndex(activeIndex + 1)}
                                variant="primary"
                                icon={<ArrowRightIcon size={16} color={styles.primaryButtonText.color} />}
                            />
                        )}
                    </View>
                </View>
            </View>
        </SafeAreaView>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        iconColor: {
            color: theme.colors.accent,
        },
        safeArea: {
            flex: 1,
            backgroundColor: theme.colors.bg,
        },
        container: {
            flex: 1,
            backgroundColor: theme.colors.bg,
            paddingTop: theme.spacing.md,
            paddingBottom: 48,
        },
        header: {
            paddingHorizontal: theme.spacing.lg,
            alignItems: "center",
            marginBottom: theme.spacing.lg,
        },
        brandRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            paddingVertical: 8,
            paddingHorizontal: 16,
            borderRadius: 100,
            backgroundColor: theme.colors.bgSecondary,
        },
        brand: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            fontWeight: "800",
            letterSpacing: 0.5,
        },
        slidePage: {
            flex: 1,
            paddingHorizontal: theme.spacing.lg,
        },
        slideSurface: {
            flexGrow: 1,
            alignItems: "center",
            paddingHorizontal: theme.spacing.sm,
            paddingBottom: theme.spacing.xl,
        },
        iconContainer: {
            width: 90,
            height: 90,
            borderRadius: 45,
            backgroundColor: theme.colors.bgSecondary,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: theme.spacing.xl,
            shadowColor: theme.colors.accent,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            elevation: 4,
        },
        stepBadge: {
            backgroundColor: theme.colors.accent + "1A", // 10% opacity roughly if hex
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 100,
            marginBottom: theme.spacing.md,
        },
        stepBadgeText: {
            color: theme.colors.accent,
            fontSize: theme.fontSize.xs,
            fontWeight: "800",
            textTransform: "uppercase",
            letterSpacing: 1,
        },
        title: {
            color: theme.colors.textPrimary,
            fontSize: 28,
            lineHeight: 34,
            fontWeight: "900",
            textAlign: "center",
            marginBottom: theme.spacing.sm,
        },
        description: {
            color: theme.colors.textSecondary,
            fontSize: 16,
            lineHeight: 24,
            textAlign: "center",
            marginBottom: theme.spacing.xl,
            paddingHorizontal: theme.spacing.md,
        },
        pointsBlock: {
            width: "100%",
            gap: theme.spacing.md,
            marginBottom: theme.spacing.xl,
        },
        pointRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.sm,
        },
        pointDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 8,
            backgroundColor: theme.colors.accent,
            flexShrink: 0,
        },
        pointText: {
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: 16,
            lineHeight: 24,
        },
        commandBlock: {
            width: "100%",
            borderRadius: 16,
            backgroundColor: theme.colors.bgSecondary,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            gap: 12,
            marginBottom: theme.spacing.xl,
        },
        commandLine: {
            color: theme.colors.textPrimary,
            fontFamily: "monospace",
            fontSize: 14,
            lineHeight: 20,
        },
        noteRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.md,
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: 12,
            width: "100%",
        },
        noteText: {
            flex: 1,
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: 20,
        },
        progressRow: {
            alignItems: "center",
            paddingVertical: theme.spacing.lg,
        },
        paginationRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
        },
        paginationDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.border,
            opacity: 0.5,
        },
        paginationDotActive: {
            width: 24,
            opacity: 1,
            backgroundColor: theme.colors.accent,
        },
        footer: {
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.md,
            marginBottom: 24,
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
        buttonBase: {
            minHeight: 52,
            borderRadius: 100,
            paddingHorizontal: theme.spacing.lg,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            flex: 1,
        },
        primaryButton: {
            backgroundColor: theme.colors.accent,
            shadowColor: theme.colors.accent,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.2,
            shadowRadius: 8,
            elevation: 4,
        },
        secondaryButton: {
            backgroundColor: theme.colors.bgSecondary,
            borderWidth: 1,
            borderColor: theme.colors.border,
            flex: 0,
            minWidth: 100,
        },
        ghostButton: {
            backgroundColor: "transparent",
        },
        buttonPressed: {
            opacity: 0.8,
            transform: [{ scale: 0.98 }],
        },
        buttonDisabled: {
            opacity: 0.4,
        },
        buttonContent: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
        },
        buttonIcon: {
            alignItems: "center",
            justifyContent: "center",
        },
        buttonText: {
            color: theme.colors.textPrimary,
            fontSize: 16,
            fontWeight: "700",
        },
        primaryButtonText: {
            color: theme.colors.textOnAccent,
        },
        ghostButtonText: {
            color: theme.colors.textSecondary,
        },
        buttonTextDisabled: {
            color: theme.colors.textTertiary,
        },
    });
}

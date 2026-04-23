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
import { AppLogoMark } from "../src/components/AppLogo";
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
        title: "Your Mac runs the coding session",
        description: "This iPhone app is the remote companion. The real session stays on your Mac.",
        points: [
            "Keep your Mac powered on, signed in, and online.",
            "Your phone mirrors activity and sends actions back.",
        ],
        note: "You only need to pair this iPhone once.",
        icon: "desktop",
    },
    {
        id: "install",
        stepLabel: "Step 2",
        title: "Install the Mac companion",
        description: "Run these commands on the Mac you want to control from your phone.",
        points: [
            "The last command starts the companion and shows the pairing QR code.",
        ],
        note: "Use the same Mac later when you want to resume sessions.",
        icon: "terminal",
        commands: [
            "npm install -g code-companion",
            "code-companion login",
            "code-companion up",
        ],
    },
    {
        id: "pair-and-alerts",
        stepLabel: "Step 3",
        title: "Scan once and optionally enable alerts",
        description: "Scan the QR code from your Mac, then allow alerts if you want approval and completion updates in the background.",
        points: [
            "Use the QR code shown by `code-companion up`.",
            "Notifications are optional and can also be enabled later in Settings.",
        ],
        note: "After pairing, reconnect works as long as your Mac companion is available.",
        icon: "scan",
    },
];

function renderSlideIcon(icon: OnboardingSlide["icon"], color: string): React.ReactNode {
    if (icon === "desktop") {
        return <DesktopIcon size={18} color={color} />;
    }

    if (icon === "terminal") {
        return <TerminalIcon size={18} color={color} />;
    }

    return <ScanIcon size={18} color={color} />;
}

function SlideCard({ item, width }: { item: OnboardingSlide; width: number }) {
    const styles = useThemedStyles(createStyles);
    const accentColor = styles.stepLabel.color;

    return (
        <View style={[styles.slidePage, { width }]}>
            <View style={styles.slideSurface}>
                <View style={styles.stepRow}>
                    <View style={styles.stepIconBox}>
                        {renderSlideIcon(item.icon, accentColor)}
                    </View>
                    <Text style={styles.stepLabel}>{item.stepLabel}</Text>
                </View>

                <View style={styles.copyBlock}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.description}>{item.description}</Text>
                </View>

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
                    <CheckSquareIcon size={13} color={accentColor} />
                    <Text style={styles.noteText}>{item.note}</Text>
                </View>
            </View>
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
                <View style={styles.header}>
                    <View style={styles.brandRow}>
                        <AppLogoMark size={26} />
                        <Text style={styles.brand}>Code Companion</Text>
                    </View>
                    <Text style={styles.headerTitle}>Set up your Mac companion</Text>
                    <Text style={styles.headerSubtitle}>
                        Three quick steps, then scan the QR code from your Mac.
                    </Text>
                </View>

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
                    <Text style={styles.progressText}>{activeIndex + 1}/{slides.length}</Text>
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
                            icon={<BellIcon size={14} color={styles.ghostButtonText.color} />}
                            variant="ghost"
                        />
                    ) : null}

                    <View style={styles.actionRow}>
                        <FooterButton
                            label="Back"
                            onPress={() => scrollToIndex(activeIndex - 1)}
                            icon={<ArrowLeftIcon size={14} color={styles.buttonText.color} />}
                            variant="secondary"
                            disabled={isFirstSlide}
                        />

                        {isLastSlide ? (
                            <View style={styles.finalActions}>
                                <FooterButton
                                    label="Open app"
                                    onPress={() => {
                                        void finishGuide("/");
                                    }}
                                    variant="secondary"
                                    icon={<DesktopIcon size={14} color={styles.buttonText.color} />}
                                />
                                <FooterButton
                                    label="Scan QR code"
                                    onPress={() => {
                                        void finishGuide("/scan");
                                    }}
                                    variant="primary"
                                    icon={<ScanIcon size={14} color={styles.primaryButtonText.color} />}
                                />
                            </View>
                        ) : (
                            <FooterButton
                                label="Next"
                                onPress={() => scrollToIndex(activeIndex + 1)}
                                variant="primary"
                                icon={<ArrowRightIcon size={14} color={styles.primaryButtonText.color} />}
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
        safeArea: {
            flex: 1,
            backgroundColor: theme.colors.bg,
        },
        container: {
            flex: 1,
            backgroundColor: theme.colors.bg,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.sm,
        },
        header: {
            paddingHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            gap: 6,
        },
        brandRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.xs,
        },
        brand: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 0.7,
        },
        headerTitle: {
            color: theme.colors.textPrimary,
            fontSize: 26,
            lineHeight: 32,
            fontWeight: "800",
        },
        headerSubtitle: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.md,
            lineHeight: 20,
            maxWidth: 320,
        },
        slidePage: {
            flex: 1,
            paddingHorizontal: theme.spacing.lg,
        },
        slideSurface: {
            flex: 1,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgSecondary,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.lg,
            gap: theme.spacing.lg,
        },
        stepRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
        },
        stepIconBox: {
            width: 34,
            height: 34,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bg,
            alignItems: "center",
            justifyContent: "center",
        },
        stepLabel: {
            color: theme.colors.accent,
            fontSize: theme.fontSize.xs,
            fontWeight: "800",
            textTransform: "uppercase",
            letterSpacing: 0.7,
        },
        copyBlock: {
            gap: theme.spacing.sm,
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
        pointsBlock: {
            gap: theme.spacing.md,
        },
        pointRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
        },
        pointDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
            marginTop: 8,
            backgroundColor: theme.colors.accent,
            flexShrink: 0,
        },
        pointText: {
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
        noteRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
            paddingTop: theme.spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
        },
        noteText: {
            flex: 1,
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: 18,
        },
        progressRow: {
            alignItems: "center",
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.sm,
        },
        progressText: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            fontWeight: "700",
        },
        paginationRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        paginationDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.border,
        },
        paginationDotActive: {
            width: 18,
            backgroundColor: theme.colors.accent,
        },
        footer: {
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.sm,
        },
        actionRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
        },
        finalActions: {
            flex: 1,
            flexDirection: "row",
            gap: theme.spacing.sm,
        },
        buttonBase: {
            minHeight: 42,
            borderRadius: theme.borderRadius.md,
            paddingHorizontal: theme.spacing.md,
            alignItems: "center",
            justifyContent: "center",
        },
        primaryButton: {
            flex: 1,
            backgroundColor: theme.colors.accent,
        },
        secondaryButton: {
            minWidth: 88,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
        },
        ghostButton: {
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bg,
        },
        buttonPressed: {
            opacity: 0.86,
        },
        buttonDisabled: {
            opacity: 0.45,
        },
        buttonContent: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
        },
        buttonIcon: {
            alignItems: "center",
            justifyContent: "center",
        },
        buttonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
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

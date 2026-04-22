// Boş sohbet ekranı — GitHub Copilot mobil stili karşılama

import React from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useRouter } from "expo-router";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";
import {
    WifiOffIcon,
    TerminalIcon,
    WrenchIcon,
    CheckSquareIcon,
    CodeIcon,
} from "./ProviderIcon";
import { CopilotBadge } from "./CopilotBadge";

type SuggestionIcon = "terminal" | "wrench" | "check" | "code";

type Props = {
    isConnected: boolean;
    isConnecting: boolean;
    onSuggestionPress?: (text: string) => void;
};

function ConnectingSpinner() {
    const theme = useAppTheme();
    const connectStyles = useThemedStyles(createConnectStyles);
    const spinAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        const loop = Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                duration: 1200,
                useNativeDriver: true,
            })
        );
        loop.start();
        return () => loop.stop();
    }, [spinAnim]);

    const rotation = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "360deg"],
    });

    return (
        <Animated.View style={[connectStyles.ring, { transform: [{ rotate: rotation }] }]} />
    );
}

const companionSetupSteps = [
    "Requires a Mac that stays powered on while you use the app.",
    "On your Mac run npm install -g copilot-mobile, then copilot-mobile login and copilot-mobile up.",
    "Scan the QR code once to pair. After that, your iPhone reconnects through the Mac companion.",
] as const;

export function EmptyChat({ isConnected, isConnecting, onSuggestionPress }: Props) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const router = useRouter();

    if (isConnecting) {
        return (
            <View style={styles.container}>
                <ConnectingSpinner />
                <Text style={styles.title}>Connecting...</Text>
                <Text style={styles.subtitle}>
                    Connecting to your Mac companion
                </Text>
            </View>
        );
    }

    if (!isConnected) {
        return (
            <View style={styles.container}>
                <View style={styles.disconnectIcon}>
                    <WifiOffIcon size={24} color={theme.colors.textTertiary} />
                </View>
                <Text style={styles.title}>Connect to your Mac companion</Text>
                <Text style={styles.subtitle}>
                    Copilot Mobile works with a Mac companion. Finish the Mac setup first, then scan the pairing QR code.
                </Text>
                <View style={styles.requirementsCard}>
                    {companionSetupSteps.map((step, index) => (
                        <View key={step} style={styles.requirementRow}>
                            <View style={styles.requirementBadge}>
                                <Text style={styles.requirementBadgeText}>{index + 1}</Text>
                            </View>
                            <Text style={styles.requirementText}>{step}</Text>
                        </View>
                    ))}
                </View>
                <Pressable
                    style={({ pressed }) => [
                        styles.scanButton,
                        pressed && styles.scanButtonPressed,
                    ]}
                    onPress={() => router.push("/scan")}
                >
                    <Text style={styles.scanButtonText}>Scan QR Code</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.logoContainer}>
                <CopilotBadge size={64} iconSize={36} />
            </View>
            <Text style={styles.title}>GitHub Copilot</Text>
            <Text style={styles.subtitle}>
                Ask about coding, debugging, and more
            </Text>

            <View style={styles.suggestions}>
                <SuggestionChip icon="terminal" text="Analyze project" {...(onSuggestionPress !== undefined ? { onPress: onSuggestionPress } : {})} />
                <SuggestionChip icon="wrench" text="Fix a bug" {...(onSuggestionPress !== undefined ? { onPress: onSuggestionPress } : {})} />
                <SuggestionChip icon="check" text="Write tests" {...(onSuggestionPress !== undefined ? { onPress: onSuggestionPress } : {})} />
                <SuggestionChip icon="code" text="Explain code" {...(onSuggestionPress !== undefined ? { onPress: onSuggestionPress } : {})} />
            </View>
        </View>
    );
}

const iconMap: Record<SuggestionIcon, React.FC<{ size?: number; color?: string }>> = {
    terminal: TerminalIcon,
    wrench: WrenchIcon,
    check: CheckSquareIcon,
    code: CodeIcon,
};

function SuggestionChip({ icon, text, onPress }: { icon: SuggestionIcon; text: string; onPress?: ((text: string) => void) | undefined }) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const IconCmp = iconMap[icon];
    return (
        <Pressable
            style={styles.chip}
            onPress={() => onPress?.(text)}
            accessibilityLabel={text}
        >
            <IconCmp size={13} color={theme.colors.accent} />
            <Text style={styles.chipText}>{text}</Text>
        </Pressable>
    );
}

function createConnectStyles(theme: AppTheme) {
    return StyleSheet.create({
        ring: {
            width: 48,
            height: 48,
            borderRadius: 24,
            borderWidth: 3,
            borderColor: "transparent",
            borderTopColor: theme.colors.accent,
            borderRightColor: theme.colors.accentMuted,
            marginBottom: 20,
        },
    });
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 32,
            paddingBottom: 80,
            backgroundColor: theme.colors.bg,
        },
        disconnectIcon: {
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 20,
        },
        logoContainer: {
            marginBottom: 20,
        },
        title: {
            fontSize: theme.fontSize.xxl,
            fontWeight: "700",
            color: theme.colors.textPrimary,
            marginBottom: theme.spacing.sm,
        },
        subtitle: {
            fontSize: theme.fontSize.base,
            color: theme.colors.textTertiary,
            textAlign: "center",
            lineHeight: 20,
            marginBottom: 28,
        },
        requirementsCard: {
            width: "100%",
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSecondary,
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.lg,
        },
        requirementRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
        },
        requirementBadge: {
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: theme.colors.accent,
            justifyContent: "center",
            alignItems: "center",
            marginTop: 1,
        },
        requirementBadgeText: {
            color: theme.colors.textOnAccent,
            fontSize: theme.fontSize.sm,
            fontWeight: "700",
        },
        requirementText: {
            flex: 1,
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: 18,
        },
        scanButton: {
            backgroundColor: theme.colors.accent,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: 28,
            borderRadius: theme.borderRadius.md,
        },
        scanButtonPressed: {
            backgroundColor: theme.colors.accentPressed,
        },
        scanButtonText: {
            color: theme.colors.textOnAccent,
            fontSize: theme.fontSize.base,
            fontWeight: "600",
        },
        suggestions: {
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: theme.spacing.sm,
            marginTop: theme.spacing.xs,
        },
        chip: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.md,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        chipText: {
            fontSize: theme.fontSize.md,
            color: theme.colors.textSecondary,
        },
    });
}

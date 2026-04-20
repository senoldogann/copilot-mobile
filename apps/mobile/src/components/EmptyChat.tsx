// Boş sohbet ekranı — GitHub Copilot mobil stili karşılama

import React from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, fontSize, borderRadius } from "../theme/colors";
import {
    WifiOffIcon,
    TerminalIcon,
    WrenchIcon,
    CheckSquareIcon,
    CodeIcon,
    CopilotIcon,
} from "./ProviderIcon";

type SuggestionIcon = "terminal" | "wrench" | "check" | "code";

type Props = {
    isConnected: boolean;
    isConnecting: boolean;
    onSuggestionPress?: (text: string) => void;
};

// Bağlantı animasyonu
function ConnectingSpinner() {
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

const connectStyles = StyleSheet.create({
    ring: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 3,
        borderColor: "transparent",
        borderTopColor: colors.accent,
        borderRightColor: colors.accentMuted,
        marginBottom: 20,
    },
});

export function EmptyChat({ isConnected, isConnecting, onSuggestionPress }: Props) {
    const router = useRouter();

    if (isConnecting) {
        return (
            <View style={styles.container}>
                <ConnectingSpinner />
                <Text style={styles.title}>Connecting...</Text>
                <Text style={styles.subtitle}>
                    Connecting to VS Code bridge server
                </Text>
            </View>
        );
    }

    if (!isConnected) {
        return (
            <View style={styles.container}>
                <View style={styles.disconnectIcon}>
                    <WifiOffIcon size={24} color={colors.textTertiary} />
                </View>
                <Text style={styles.title}>Connect to VS Code</Text>
                <Text style={styles.subtitle}>
                    Scan the QR code on your desktop{"\n"}
                    VS Code to start chatting
                </Text>
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
                <View style={styles.logo}>
                    <CopilotIcon size={36} color={colors.textPrimary} />
                </View>
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

function SuggestionChip({ icon, text, onPress }: { icon: SuggestionIcon; text: string; onPress?: ((text: string) => void) | undefined }) {
    const IconCmp =
        icon === "terminal" ? TerminalIcon :
        icon === "wrench" ? WrenchIcon :
        icon === "check" ? CheckSquareIcon :
        CodeIcon;
    return (
        <Pressable
            style={styles.chip}
            onPress={() => onPress?.(text)}
            accessibilityLabel={text}
        >
            <IconCmp size={13} color={colors.accent} />
            <Text style={styles.chipText}>{text}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 32,
        paddingBottom: 80,
    },
    disconnectIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 20,
    },
    logoContainer: {
        marginBottom: 20,
    },
    logo: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.copilotPurpleMuted,
        borderWidth: 1,
        borderColor: colors.copilotPurpleBorder,
        justifyContent: "center",
        alignItems: "center",
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: "700",
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },
    subtitle: {
        fontSize: fontSize.base,
        color: colors.textTertiary,
        textAlign: "center",
        lineHeight: 20,
        marginBottom: 28,
    },
    scanButton: {
        backgroundColor: colors.accent,
        paddingVertical: spacing.md,
        paddingHorizontal: 28,
        borderRadius: borderRadius.md,
    },
    scanButtonPressed: {
        backgroundColor: colors.accentPressed,
    },
    scanButtonText: {
        color: colors.textOnAccent,
        fontSize: fontSize.base,
        fontWeight: "600",
    },
    suggestions: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: spacing.sm,
        marginTop: spacing.xs,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: colors.bgSecondary,
        borderRadius: borderRadius.md,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: colors.border,
    },
    chipText: {
        fontSize: fontSize.md,
        color: colors.textSecondary,
    },
});

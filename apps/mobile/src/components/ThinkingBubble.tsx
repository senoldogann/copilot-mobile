// Düşünme balonu — kompakt tek satır "🧠 Thinking" + detay için bottom sheet

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import type { ThinkingItem } from "../stores/session-store";
import { BottomSheet } from "./BottomSheet";
import { Feather } from "@expo/vector-icons";
import { colors, spacing, fontSize } from "../theme/colors";

type Props = {
    item: ThinkingItem;
};

// Dönen halka animasyonu — streaming sırasında
function SpinnerRing() {
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
        <Animated.View style={[spinnerStyles.ring, { transform: [{ rotate: rotation }] }]} />
    );
}

function ThinkingBubbleComponent({ item }: Props) {
    const [showSheet, setShowSheet] = useState(false);

    const hasContent = item.content.length > 0;
    const charLabel = item.content.length > 1000
        ? `${Math.round(item.content.length / 1000)}K chars`
        : `${item.content.length} chars`;

    return (
        <>
            <Pressable
                style={styles.row}
                onPress={() => hasContent && setShowSheet(true)}
                disabled={!hasContent}
            >
                <View style={styles.iconContainer}>
                    {item.isStreaming ? (
                        <SpinnerRing />
                    ) : (
                        <Feather name="cpu" size={13} color={colors.textTertiary} />                    )}
                </View>
                <Text style={styles.label}>
                    {item.isStreaming ? "Thinking…" : "Thought"}
                </Text>
                {!item.isStreaming && hasContent && (
                    <Text style={styles.charCount}>{charLabel}</Text>
                )}
                {hasContent && (
                    <Text style={styles.chevron}>›</Text>
                )}
            </Pressable>

            <BottomSheet
                visible={showSheet}
                onClose={() => setShowSheet(false)}
                icon="🧠"
                title="Thinking"
                subtitle={!item.isStreaming && hasContent ? charLabel : ""}
            >
                <Text style={styles.content} selectable>
                    {item.content}
                    {item.isStreaming && (
                        <Text style={styles.cursor}>▌</Text>
                    )}
                </Text>
            </BottomSheet>
        </>
    );
}

export const ThinkingBubble = React.memo(ThinkingBubbleComponent);

const spinnerStyles = StyleSheet.create({
    ring: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: "transparent",
        borderTopColor: colors.accent,
        borderRightColor: colors.accentMuted,
    },
});

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        paddingHorizontal: spacing.lg,
        marginLeft: 40,
        gap: spacing.sm,
    },
    iconContainer: {
        width: 18,
        height: 18,
        justifyContent: "center",
        alignItems: "center",
    },
    icon: {
        fontSize: 13,
    },
    label: {
        fontSize: fontSize.md,
        color: colors.textSecondary,
        fontWeight: "400",
    },
    charCount: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    chevron: {
        fontSize: fontSize.base,
        color: colors.textTertiary,
        marginLeft: "auto",
    },
    content: {
        fontSize: fontSize.md,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    cursor: {
        color: colors.accent,
    },
});

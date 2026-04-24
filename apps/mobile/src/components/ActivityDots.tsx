// Aktivite göstergesi — her zaman altta görünen 3 nokta, aktifken daha canlı

import React, { useEffect, useRef } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { useThemedStyles, useAppTheme, type AppTheme } from "../theme/theme-context";
import { useAppIsActive } from "../services/app-visibility";
import { BrainIcon } from "./Icons";

type Props = {
    active: boolean;
    intent?: string | null;
};

// Each dot: when active — bounce + bright pulse; when inactive — static dim dot
function Dot({ delay, active }: { delay: number; active: boolean }) {
    const styles = useThemedStyles(createStyles);
    const anim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!active) {
            anim.stopAnimation();
            anim.setValue(0);
            return;
        }
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(anim, {
                    toValue: 1,
                    duration: 380,
                    delay,
                    useNativeDriver: true,
                }),
                Animated.timing(anim, {
                    toValue: 0,
                    duration: 380,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [active, anim, delay]);

    const opacity = active
        ? anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.0] })
        : 0.15;
    const translateY = active
        ? anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -4, 0] })
        : 0;

    return (
        <Animated.View
            style={[styles.dot, { opacity, transform: [{ translateY }] }]}
        />
    );
}

export function ActivityDots({ active, intent }: Props) {
    const styles = useThemedStyles(createStyles);
    const theme = useAppTheme();
    const appIsActive = useAppIsActive();
    if (!active) {
        return null;
    }

    const shouldAnimate = active && appIsActive;

    return (
        <View style={styles.container}>
            <View style={styles.dotsRow}>
                <Dot delay={0} active={shouldAnimate} />
                <Dot delay={160} active={shouldAnimate} />
                <Dot delay={320} active={shouldAnimate} />
            </View>
            {active && intent !== undefined && intent !== null && intent.length > 0 && (
                <View style={styles.intentCard}>
                    <View style={styles.intentIcon}>
                        <BrainIcon size={12} color={theme.colors.textSecondary} />
                    </View>
                    <View style={styles.intentBody}>
                        <Text style={styles.intentLabel}>Intent</Text>
                        <Text style={styles.intent} numberOfLines={2}>{intent}</Text>
                    </View>
                </View>
            )}
        </View>
    );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: 10,
    },
    dotsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        marginLeft: 8,
        marginTop: 4,
    },
    dot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: theme.colors.accent,
    },
    intent: {
        fontSize: theme.fontSize.sm,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    intentCard: {
        flex: 1,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
        backgroundColor: theme.colors.bgSecondary,
    },
    intentIcon: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.bgTertiary,
        marginTop: 1,
    },
    intentBody: {
        flex: 1,
        gap: 1,
    },
    intentLabel: {
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
        color: theme.colors.textTertiary,
    },
});

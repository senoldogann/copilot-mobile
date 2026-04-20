// Aktivite göstergesi — her zaman altta görünen 3 nokta, aktifken daha canlı

import React, { useEffect, useRef } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { colors, spacing, fontSize } from "../theme/colors";

type Props = {
    active: boolean;
    intent?: string | null;
};

// Her nokta bağımsız opaklık + dikey sıçrama animasyonu
function Dot({ delay, active }: { delay: number; active: boolean }) {
    const anim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const duration = active ? 380 : 900;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(anim, {
                    toValue: 1,
                    duration,
                    delay,
                    useNativeDriver: true,
                }),
                Animated.timing(anim, {
                    toValue: 0,
                    duration,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [anim, delay, active]);

    const opacity = anim.interpolate({
        inputRange: [0, 1],
        outputRange: active ? [0.35, 1.0] : [0.06, 0.18],
    });
    const translateY = anim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: active ? [0, -4, 0] : [0, 0, 0],
    });

    return (
        <Animated.View
            style={[styles.dot, { opacity, transform: [{ translateY }] }]}
        />
    );
}

export function ActivityDots({ active, intent }: Props) {
    return (
        <View style={styles.container}>
            <View style={styles.dotsRow}>
                <Dot delay={0} active={active} />
                <Dot delay={160} active={active} />
                <Dot delay={320} active={active} />
            </View>
            {active && intent !== undefined && intent !== null && intent.length > 0 && (
                <Text style={styles.intent} numberOfLines={1}>{intent}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: 10,
    },
    dotsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    dot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: colors.accent,
    },
    intent: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        flexShrink: 1,
    },
});

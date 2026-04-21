// Aktif işlem sırasında soldan sağa kayan parlama efekti — metin üzerinde kayan shimmer

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

// ─── Internal shimmer strip ───────────────────────────────────────────────────

function ShimmerStrip() {
    const translateX = useRef(new Animated.Value(-80)).current;

    useEffect(() => {
        const loop = Animated.loop(
            Animated.timing(translateX, {
                toValue: 400,
                duration: 1800,
                useNativeDriver: true,
            })
        );
        loop.start();
        return () => {
            loop.stop();
            translateX.setValue(-80);
        };
    }, [translateX]);

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                StyleSheet.absoluteFillObject,
                styles.sheen,
                { transform: [{ translateX }, { skewX: "-15deg" }] },
            ]}
        />
    );
}

// ─── ShimmerText — wraps children; shimmer is clipped to this element only ───

type ShimmerTextProps = {
    active: boolean;
    children: React.ReactNode;
};

/**
 * Wrap any text (or small element) in ShimmerText to get a left-to-right
 * shimmer that is clipped exactly to the content bounds.
 *
 * <ShimmerText active={isRunning}>
 *   <Text>Edit</Text>
 * </ShimmerText>
 */
export function ShimmerText({ active, children }: ShimmerTextProps) {
    return (
        <View style={styles.wrapper}>
            {children}
            {active && <ShimmerStrip />}
        </View>
    );
}

// ─── ShimmerHighlight (legacy — kept for backward compat) ────────────────────

type LegacyProps = { active: boolean };

/** @deprecated Use ShimmerText wrapper instead. */
export function ShimmerHighlight({ active }: LegacyProps) {
    const translateX = useRef(new Animated.Value(-180)).current;

    useEffect(() => {
        if (!active) {
            translateX.setValue(-180);
            return;
        }
        const loop = Animated.loop(
            Animated.timing(translateX, {
                toValue: 500,
                duration: 1800,
                useNativeDriver: true,
            })
        );
        loop.start();
        return () => {
            loop.stop();
            translateX.setValue(-180);
        };
    }, [active, translateX]);

    if (!active) return null;

    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.legacySheen, { transform: [{ translateX }, { skewX: "-18deg" }] }]}
        />
    );
}

const styles = StyleSheet.create({
    wrapper: {
        overflow: "hidden",
    },
    sheen: {
        width: 60,
        backgroundColor: "rgba(255,255,255,0.18)",
    },
    legacySheen: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 100,
        backgroundColor: "rgba(255,255,255,0.055)",
    },
});

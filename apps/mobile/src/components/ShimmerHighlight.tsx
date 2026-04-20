// Aktif işlem sırasında soldan sağa kayan parlama efekti

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

type Props = {
    active: boolean;
};

export function ShimmerHighlight({ active }: Props) {
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
            style={[styles.sheen, { transform: [{ translateX }, { skewX: "-18deg" }] }]}
        />
    );
}

const styles = StyleSheet.create({
    sheen: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 100,
        backgroundColor: "rgba(255,255,255,0.055)",
    },
});

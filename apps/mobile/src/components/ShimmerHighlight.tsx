import React, { useCallback, useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Mask, Rect, Stop, Text as SvgText } from "react-native-svg";
import { useAppIsActive } from "../services/app-visibility";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Kayan bant genişliği (piksel)
const BAND = 60;
// Animasyon süresi (ms)
const DURATION = 1600;

// ─── SunshineText ─────────────────────────────────────────────────────────────
// Normal Text üzerine useAnimatedStyle + Animated.View overlay ile kayan ışık bandı.
// Reanimated v4 ile uyumlu — useAnimatedProps yerine transform kullanır.

type SunshineTextProps = {
    active: boolean;
    text: string;
    textStyle: TextStyle;
    style?: ViewStyle;
    numberOfLines?: number;
};

export function SunshineText({ active, text, textStyle, style, numberOfLines }: SunshineTextProps) {
    const [dims, setDims] = useState({ width: 0, height: 0 });
    const sweepX = useSharedValue(-BAND);
    const maskId = useRef(`msk_${Math.random().toString(36).slice(2, 8)}`).current;
    const gradId = useRef(`mgr_${Math.random().toString(36).slice(2, 8)}`).current;
    const appIsActive = useAppIsActive();
    const shouldAnimate = active && appIsActive;

    useEffect(() => {
        cancelAnimation(sweepX);
        if (!shouldAnimate || dims.width <= 0) {
            sweepX.value = -BAND;
            return;
        }
        sweepX.value = -BAND;
        sweepX.value = withRepeat(
            withTiming(dims.width, { duration: DURATION, easing: Easing.linear }),
            -1,
            false,
        );
        return () => cancelAnimation(sweepX);
    }, [dims.width, shouldAnimate, sweepX]);

    const bandProps = useAnimatedProps(() => ({ x: sweepX.value }));

    const handleLayout = useCallback(
        (e: LayoutChangeEvent) => setDims({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
        }),
        [],
    );

    const fz = (textStyle.fontSize ?? 13) as number;
    const fw = String(textStyle.fontWeight ?? "normal");
    const ff = textStyle.fontFamily as string | undefined;
    const baseline = dims.height > 0 ? dims.height * 0.82 : fz;

    const sharedTextProps = {
        x: 0 as number,
        y: baseline,
        fontSize: fz,
        fontWeight: fw,
        ...(ff !== undefined ? { fontFamily: ff } : {}),
    };

    return (
        <View style={style} onLayout={handleLayout}>
            {!shouldAnimate || dims.width === 0 || dims.height === 0 ? (
                <Text style={textStyle} numberOfLines={numberOfLines ?? 1}>{text}</Text>
            ) : (
                <Svg width={dims.width} height={dims.height}>
                    <Defs>
                        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0" stopColor="black" stopOpacity="1" />
                            <Stop offset="0.25" stopColor="white" stopOpacity="0.4" />
                            <Stop offset="0.5" stopColor="white" stopOpacity="1" />
                            <Stop offset="0.75" stopColor="white" stopOpacity="0.4" />
                            <Stop offset="1" stopColor="black" stopOpacity="1" />
                        </LinearGradient>
                        <Mask id={maskId}>
                            <AnimatedRect
                                animatedProps={bandProps}
                                y={0}
                                width={BAND}
                                height={dims.height}
                                fill={`url(#${gradId})`}
                            />
                        </Mask>
                    </Defs>
                    <SvgText fill="#595B5B" {...sharedTextProps}>{text}</SvgText>
                    <SvgText fill="#a0a3a2" mask={`url(#${maskId})`} {...sharedTextProps}>{text}</SvgText>
                </Svg>
            )}
        </View>
    );
}

// ─── ShimmerText ──────────────────────────────────────────────────────────────
// Genel amaçlı overlay shimmer: herhangi bir React elemanını sarar.
// Gradient bandı children'ın üzerinden kayar.

type ShimmerTextProps = {
    active: boolean;
    /** Extra style on the container — use flex:1 when inside a row. */
    style?: ViewStyle;
    /** @deprecated no-op; kept for backward-compat. */
    fill?: boolean;
    children: React.ReactElement;
};

export function ShimmerText({ active, style, children }: ShimmerTextProps) {
    const [width, setWidth] = useState(0);
    const offsetX = useSharedValue(-BAND);
    const appIsActive = useAppIsActive();
    const shouldAnimate = active && appIsActive;

    useEffect(() => {
        cancelAnimation(offsetX);
        if (!shouldAnimate || width <= 0) {
            offsetX.value = -BAND;
            return;
        }
        offsetX.value = -BAND;
        offsetX.value = withRepeat(
            withTiming(width + BAND, { duration: DURATION, easing: Easing.linear }),
            -1,
            false,
        );
        return () => cancelAnimation(offsetX);
    }, [offsetX, shouldAnimate, width]);

    const animStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: offsetX.value }],
    }));

    return (
        <View
            style={[styles.container, style]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
            {children}
            {shouldAnimate && width > 0 && (
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, animStyle, { width: BAND }]}
                >
                    <Svg width={BAND} height="100%">
                        <Defs>
                            <LinearGradient id="shimmer_overlay" x1="0" y1="0" x2="1" y2="0">
                                <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                                <Stop offset="0.3" stopColor="#ffffff" stopOpacity="0.35" />
                                <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
                                <Stop offset="0.7" stopColor="#ffffff" stopOpacity="0.35" />
                                <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                            </LinearGradient>
                        </Defs>
                        <Rect x={0} y={0} width={BAND} height="100%" fill="url(#shimmer_overlay)" />
                    </Svg>
                </Animated.View>
            )}
        </View>
    );
}

type LegacyProps = { active: boolean };

/** @deprecated Use ShimmerText wrapper instead. */
export function ShimmerHighlight(_props: LegacyProps) {
    return null;
}

const styles = StyleSheet.create({
    container: {
        overflow: "hidden",
    },
});

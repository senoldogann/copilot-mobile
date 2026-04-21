import React, { useCallback, useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedProps,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Mask, Rect, Stop, Text as SvgText } from "react-native-svg";
import { colors } from "../theme/colors";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Kayan bant genişliği (piksel)
const BAND = 60;
// Animasyon süresi (ms)
const DURATION = 1600;

// ─── SunshineText ─────────────────────────────────────────────────────────────
// İki SVG Text katmanı:
//   1. Soluk (textTertiary) metin — her zaman görünür
//   2. Parlak (textPrimary) metin — animated Mask bandıyla kliplenir
// Böylece ışık yalnızca harf şekillerinden geçer; arka plan etkilenmez.

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
    // Her instance için çakışmayan ID'ler
    const maskId = useRef(`msk_${Math.random().toString(36).slice(2, 8)}`).current;
    const gradId = useRef(`mgr_${Math.random().toString(36).slice(2, 8)}`).current;

    useEffect(() => {
        cancelAnimation(sweepX);
        if (!active || dims.width <= 0) {
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
    }, [active, dims.width, sweepX]);

    const bandProps = useAnimatedProps(() => ({ x: sweepX.value }));

    const handleLayout = useCallback(
        (e: LayoutChangeEvent) => setDims({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }),
        [],
    );

    const fz = (textStyle.fontSize ?? 13) as number;
    const fw = String(textStyle.fontWeight ?? "normal");
    const ff = textStyle.fontFamily as string | undefined;
    // SVG Text y = baseline ≈ container yüksekliğinin %82'si
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
            {!active || dims.width === 0 || dims.height === 0 ? (
                <Text style={textStyle} numberOfLines={numberOfLines ?? 1}>{text}</Text>
            ) : (
                <Svg width={dims.width} height={dims.height}>
                    <Defs>
                        {/* Mask gradient: siyah kenarlarda, beyaz ortada → yumuşak geçiş */}
                        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0" stopColor="black" stopOpacity="1" />
                            <Stop offset="0.25" stopColor="white" stopOpacity="0.4" />
                            <Stop offset="0.5" stopColor="white" stopOpacity="1" />
                            <Stop offset="0.75" stopColor="white" stopOpacity="0.4" />
                            <Stop offset="1" stopColor="black" stopOpacity="1" />
                        </LinearGradient>
                        {/* Animated mask: gradient bant soldan sağa kayar */}
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
                    {/* Katman 1: soluk metin — her zaman görünür */}
                    <SvgText fill={colors.textTertiary} {...sharedTextProps}>{text}</SvgText>
                    {/* Katman 2: parlak metin — yalnızca mask bandında görünür */}
                    <SvgText fill={colors.textPrimary} mask={`url(#${maskId})`} {...sharedTextProps}>{text}</SvgText>
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

    useEffect(() => {
        cancelAnimation(offsetX);
        if (!active || width <= 0) {
            offsetX.value = -BAND;
            return;
        }
        offsetX.value = -BAND;
        offsetX.value = withRepeat(
            withTiming(width, { duration: DURATION, easing: Easing.linear }),
            -1,
            false,
        );
        return () => cancelAnimation(offsetX);
    }, [active, width, offsetX]);

    const animatedProps = useAnimatedProps(() => ({
        x: offsetX.value,
    }));

    return (
        <View
            style={[styles.container, style]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
            {children}
            {active && width > 0 && (
                <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Defs>
                        <LinearGradient id="shimmer_overlay" x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                            <Stop offset="0.3" stopColor="#ffffff" stopOpacity="0.35" />
                            <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
                            <Stop offset="0.7" stopColor="#ffffff" stopOpacity="0.35" />
                            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                        </LinearGradient>
                    </Defs>
                    <AnimatedRect
                        animatedProps={animatedProps}
                        y={0}
                        width={BAND}
                        height="100%"
                        fill="url(#shimmer_overlay)"
                    />
                </Svg>
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

import React, { useEffect } from "react";
import { StyleSheet, Text, useWindowDimensions } from "react-native";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSequence,
    withDelay,
    Easing,
    runOnJS
} from "react-native-reanimated";
import { AppLogoMark } from "./AppLogo";
import { useAppTheme } from "../theme/theme-context";

interface AnimatedSplashProps {
    onAnimationDone?: () => void;
}

export function AnimatedSplash({ onAnimationDone }: AnimatedSplashProps) {
    const theme = useAppTheme();
    const { width, height } = useWindowDimensions();
    
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.9);

    useEffect(() => {
        // Fade in and scale up logo
        opacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) });
        scale.value = withSequence(
            withTiming(1.05, { duration: 600, easing: Easing.out(Easing.back(1.5)) }),
            // Hold it slightly, then settle back to normal scale
            withDelay(400, withTiming(1, { duration: 400, easing: Easing.inOut(Easing.ease) }, (finished) => {
                if (finished) {
                    // Fade out the entire splash
                    opacity.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) }, (fadeOutFinished) => {
                        if (fadeOutFinished && onAnimationDone) {
                            runOnJS(onAnimationDone)();
                        }
                    });
                }
            }))
        );
    }, [opacity, scale, onAnimationDone]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: opacity.value,
        };
    });

    const logoStyle = useAnimatedStyle(() => {
        return {
            transform: [{ scale: scale.value }],
        };
    });

    return (
        <Animated.View style={[
            styles.container, 
            { backgroundColor: theme.colors.bg, width, height },
            animatedStyle
        ]} pointerEvents="none">
            <Animated.View style={[logoStyle, styles.content]}>
                <AppLogoMark size={120} />
                <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Code Companion</Text>
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 99999,
        alignItems: "center",
        justifyContent: "center",
    },
    content: {
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: "900",
        letterSpacing: 0.5,
    },
});

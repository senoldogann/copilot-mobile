// Kök layout — Stack navigator (çekmece grubu + modal ekranlar)

import "expo-dev-client";
import "../src/services/notification-background-task";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { initializeAppRuntime } from "../src/services/app-runtime";
import { loadOnboardingCompleted } from "../src/services/credentials";
import { useThemeStore } from "../src/theme/theme-store";
import { ThemeProvider, useAppTheme } from "../src/theme/theme-context";
import { AnimatedSplash } from "../src/components/AnimatedSplash";

export default function RootLayout() {
    const [themeReady, setThemeReady] = useState(false);
    const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
    const pathname = usePathname();

    useEffect(() => {
        void useThemeStore.getState().hydrate().finally(() => {
            setThemeReady(true);
        });
    }, []);

    useEffect(() => initializeAppRuntime(), []);

    useEffect(() => {
        if (!themeReady) {
            return;
        }

        let cancelled = false;

        void loadOnboardingCompleted().then((completed) => {
            if (cancelled) {
                return;
            }

            setOnboardingCompleted(completed);
        });

        return () => {
            cancelled = true;
        };
    }, [pathname, themeReady]);

    if (!themeReady || onboardingCompleted === null) {
        return null;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <ThemeProvider>
                    <RootNavigator onboardingCompleted={onboardingCompleted} />
                </ThemeProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

function RootNavigator({ onboardingCompleted }: { onboardingCompleted: boolean }) {
    const theme = useAppTheme();
    const pathname = usePathname();
    const router = useRouter();
    const [splashVisible, setSplashVisible] = useState(true);
    const semiboldFontFamily = theme.typography.sans(600, "normal");

    useEffect(() => {
        if (onboardingCompleted || pathname === "/onboarding") {
            return;
        }

        let cancelled = false;

        void loadOnboardingCompleted().then((completed) => {
            if (cancelled || completed) {
                return;
            }

            router.replace("/onboarding");
        });

        return () => {
            cancelled = true;
        };
    }, [onboardingCompleted, pathname, router]);

    return (
        <>
            <StatusBar style={theme.resolvedScheme === "light" ? "dark" : "light"} />
            <Stack
                initialRouteName="(drawer)"
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: theme.colors.bg },
                }}
            >
                <Stack.Screen
                    name="(drawer)"
                    options={{ title: "" }}
                />
                <Stack.Screen
                    name="scan"
                    options={{
                        presentation: "modal",
                        headerShown: true,
                        title: "QR Tara",
                        headerBackButtonDisplayMode: "minimal",
                        headerStyle: { backgroundColor: theme.colors.bg },
                        headerTintColor: theme.colors.textPrimary,
                        headerTitleStyle: {
                            fontWeight: "600",
                            ...(semiboldFontFamily !== undefined ? { fontFamily: semiboldFontFamily } : {}),
                        },
                    }}
                />
                <Stack.Screen
                    name="onboarding"
                    options={{
                        headerShown: true,
                        title: "Getting Started",
                        headerBackButtonDisplayMode: "minimal",
                        headerStyle: { backgroundColor: theme.colors.bg },
                        headerTintColor: theme.colors.textPrimary,
                        headerTitleStyle: {
                            fontWeight: "600",
                            ...(semiboldFontFamily !== undefined ? { fontFamily: semiboldFontFamily } : {}),
                        },
                        contentStyle: { backgroundColor: theme.colors.bg },
                    }}
                />
                <Stack.Screen
                    name="settings"
                    options={{
                        headerShown: true,
                        title: "",
                        headerBackButtonDisplayMode: "minimal",
                        headerStyle: { backgroundColor: theme.colors.bg },
                        headerTintColor: theme.colors.textPrimary,
                        headerTitleStyle: {
                            fontWeight: "600",
                            ...(semiboldFontFamily !== undefined ? { fontFamily: semiboldFontFamily } : {}),
                        },
                        contentStyle: { backgroundColor: theme.colors.bg },
                    }}
                />
            </Stack>
            {splashVisible && (
                <AnimatedSplash onAnimationDone={() => setSplashVisible(false)} />
            )}
        </>
    );
}

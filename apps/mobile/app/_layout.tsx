// Kök layout — Stack navigator (çekmece grubu + modal ekranlar)

import "expo-dev-client";
import "../src/services/notification-background-task";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { initializeAppRuntime } from "../src/services/app-runtime";
import { loadOnboardingCompleted } from "../src/services/credentials";
import { useThemeStore } from "../src/theme/theme-store";
import { ThemeProvider, useAppTheme } from "../src/theme/theme-context";

export default function RootLayout() {
    const [themeReady, setThemeReady] = useState(false);
    const [initialScreen, setInitialScreen] = useState<"(drawer)" | "onboarding" | null>(null);

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

            setInitialScreen(completed ? "(drawer)" : "onboarding");
        });

        return () => {
            cancelled = true;
        };
    }, [themeReady]);

    if (!themeReady || initialScreen === null) {
        return null;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <ThemeProvider>
                    <RootNavigator initialScreen={initialScreen} />
                </ThemeProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

function RootNavigator({ initialScreen }: { initialScreen: "(drawer)" | "onboarding" }) {
    const theme = useAppTheme();

    return (
        <>
            <StatusBar style={theme.resolvedScheme === "light" ? "dark" : "light"} />
            <Stack
                initialRouteName={initialScreen}
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
                        headerTitleStyle: { fontWeight: "600" },
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
                        headerTitleStyle: { fontWeight: "600" },
                        contentStyle: { backgroundColor: theme.colors.bg },
                    }}
                />
                <Stack.Screen
                    name="settings"
                    options={{
                        headerShown: true,
                        title: "Ayarlar",
                        headerBackButtonDisplayMode: "minimal",
                        headerStyle: { backgroundColor: theme.colors.bg },
                        headerTintColor: theme.colors.textPrimary,
                        headerTitleStyle: { fontWeight: "600" },
                        contentStyle: { backgroundColor: theme.colors.bg },
                    }}
                />
            </Stack>
        </>
    );
}

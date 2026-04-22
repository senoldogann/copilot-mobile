// Kök layout — Stack navigator (çekmece grubu + modal ekranlar)

import "expo-dev-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { initializeAppRuntime } from "../src/services/app-runtime";
import { useThemeStore } from "../src/theme/theme-store";
import { ThemeProvider, useAppTheme } from "../src/theme/theme-context";

export default function RootLayout() {
    const [themeReady, setThemeReady] = useState(false);

    useEffect(() => {
        void useThemeStore.getState().hydrate().finally(() => {
            setThemeReady(true);
        });
    }, []);

    useEffect(() => initializeAppRuntime(), []);

    if (!themeReady) {
        return null;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <ThemeProvider>
                    <RootNavigator />
                </ThemeProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

function RootNavigator() {
    const theme = useAppTheme();

    return (
        <>
            <StatusBar style={theme.resolvedScheme === "light" ? "dark" : "light"} />
            <Stack
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

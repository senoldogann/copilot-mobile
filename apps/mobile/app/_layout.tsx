// Kök layout — Stack navigator (çekmece grubu + modal ekranlar)

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React from "react";
import { colors } from "../src/theme/colors";

export default function RootLayout() {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <StatusBar style="light" />
                <Stack
                    screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: colors.bg },
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
                            headerStyle: { backgroundColor: colors.bg },
                            headerTintColor: colors.textPrimary,
                            headerTitleStyle: { fontWeight: "600" },
                        }}
                    />
                    <Stack.Screen
                        name="settings"
                        options={{
                            headerShown: true,
                            title: "Ayarlar",
                            headerBackButtonDisplayMode: "minimal",
                            headerStyle: { backgroundColor: colors.bg },
                            headerTintColor: colors.textPrimary,
                            headerTitleStyle: { fontWeight: "600" },
                            contentStyle: { backgroundColor: colors.bg },
                        }}
                    />
                </Stack>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

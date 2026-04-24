import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { APP_LOGO_BACKGROUND_COLOR, AppLogoMark } from "./AppLogo";

export function BootSplash(): React.JSX.Element {
    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <AppLogoMark size={112} />
                <Text style={styles.title}>Code Companion</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: APP_LOGO_BACKGROUND_COLOR,
        alignItems: "center",
        justifyContent: "center",
    },
    content: {
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
    },
    title: {
        color: "#ffffff",
        fontSize: 30,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
});

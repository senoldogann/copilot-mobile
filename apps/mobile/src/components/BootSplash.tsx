import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { APP_LOGO_BACKGROUND_COLOR, APP_LOGO_SOURCE } from "./AppLogo";

export function BootSplash(): React.JSX.Element {
    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Image
                    source={APP_LOGO_SOURCE}
                    defaultSource={APP_LOGO_SOURCE}
                    fadeDuration={0}
                    style={styles.logo}
                />
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
    logo: {
        width: 112,
        height: 112,
        borderRadius: 28,
        resizeMode: "cover",
    },
    title: {
        color: "#ffffff",
        fontSize: 30,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
});

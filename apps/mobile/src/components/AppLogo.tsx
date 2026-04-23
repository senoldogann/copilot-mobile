import React from "react";
import { Image, StyleSheet, View } from "react-native";

export const APP_LOGO_BACKGROUND_COLOR = "#161918";
const APP_LOGO_SOURCE = require("../../assets/icon.png");

type AppLogoMarkProps = {
    size?: number;
};

export function AppLogoMark({ size }: AppLogoMarkProps) {
    const resolvedSize = size ?? 64;

    return (
        <View
            style={[
                styles.container,
                {
                    width: resolvedSize,
                    height: resolvedSize,
                    borderRadius: Math.max(10, resolvedSize * 0.24),
                },
            ]}
        >
            <Image
                source={APP_LOGO_SOURCE}
                style={[
                    styles.image,
                    {
                        width: resolvedSize,
                        height: resolvedSize,
                        borderRadius: Math.max(10, resolvedSize * 0.24),
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        overflow: "hidden",
        backgroundColor: APP_LOGO_BACKGROUND_COLOR,
    },
    image: {
        resizeMode: "cover",
    },
});

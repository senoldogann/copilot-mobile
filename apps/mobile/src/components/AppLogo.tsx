import React from "react";
import { Image, StyleSheet } from "react-native";

export const APP_LOGO_BACKGROUND_COLOR = "#161918";
export const APP_LOGO_SOURCE = require("../../assets/icon.png");

type AppLogoMarkProps = {
    size?: number;
};

export function AppLogoMark({ size }: AppLogoMarkProps) {
    const resolvedSize = size ?? 64;

    return (
        <Image
            source={APP_LOGO_SOURCE}
            defaultSource={APP_LOGO_SOURCE}
            fadeDuration={0}
            style={[
                styles.image,
                {
                    width: resolvedSize,
                    height: resolvedSize,
                    borderRadius: Math.max(10, resolvedSize * 0.24),
                },
            ]}
        />
    );
}

const styles = StyleSheet.create({
    image: {
        resizeMode: "cover",
    },
});

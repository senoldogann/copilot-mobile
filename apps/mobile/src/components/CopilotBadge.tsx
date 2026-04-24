import React from "react";
import { View } from "react-native";
import { AppLogoMark } from "./AppLogo";

type Props = {
    size?: number;
};

export function CopilotBadge({
    size = 28,
}: Props) {
    return (
        <View
            style={[
                {
                    justifyContent: "center",
                    alignItems: "center",
                },
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                },
            ]}
        >
            <AppLogoMark size={size} />
        </View>
    );
}

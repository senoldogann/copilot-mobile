import React from "react";
import { View } from "react-native";
import { AgentIcon } from "./ProviderIcon";
import { useAppTheme } from "../theme/theme-context";

type Props = {
    size?: number;
    iconSize?: number;
};

export function CopilotBadge({ size = 28, iconSize = 16 }: Props) {
    const theme = useAppTheme();
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
            <AgentIcon size={iconSize} color={theme.colors.textPrimary} />
        </View>
    );
}

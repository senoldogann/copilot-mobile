import React from "react";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

export const APP_LOGO_BACKGROUND_COLOR = "#161918";

type AppLogoMarkProps = {
    size?: number;
};

export function AppLogoMark({ size }: AppLogoMarkProps) {
    const resolvedSize = size ?? 64;

    return (
        <Svg width={resolvedSize} height={resolvedSize} viewBox="0 0 96 96" fill="none">
            <Defs>
                <LinearGradient id="appLogoMintGlow" x1="34" y1="18" x2="76" y2="64" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#74D6B3" stopOpacity="0.08" />
                    <Stop offset="1" stopColor="#74D6B3" stopOpacity="0.38" />
                </LinearGradient>
                <LinearGradient id="appLogoAmberGlow" x1="18" y1="70" x2="54" y2="36" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#F5A95F" stopOpacity="0.08" />
                    <Stop offset="1" stopColor="#F5A95F" stopOpacity="0.34" />
                </LinearGradient>
                <LinearGradient id="appLogoCursor" x1="48" y1="34" x2="48" y2="66" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#7DE0BE" />
                    <Stop offset="1" stopColor="#6AC6A5" />
                </LinearGradient>
            </Defs>

            <Rect x="4" y="4" width="88" height="88" rx="24" fill="#0F1211" />
            <Rect x="4" y="4" width="88" height="88" rx="24" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
            <Circle cx="60" cy="42" r="24" fill="url(#appLogoMintGlow)" />
            <Circle cx="35" cy="58" r="22" fill="url(#appLogoAmberGlow)" />
            <Path
                d="M40 31L25 48L40 65"
                stroke="#F3F6F4"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path
                d="M56 31L71 48L56 65"
                stroke="#F3F6F4"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Rect x="44" y="36" width="8" height="26" rx="4" fill="url(#appLogoCursor)" />
            <Circle cx="63.5" cy="24.5" r="4.5" fill="#F5A95F" />
        </Svg>
    );
}

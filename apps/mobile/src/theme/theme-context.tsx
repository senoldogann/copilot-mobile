import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import type { TextStyle } from "react-native";

import {
    borderRadius,
    fontSize,
    resolveColorPalette,
    spacing,
    type ColorPalette,
    type ThemeMode,
    type ThemeVariant,
} from "./colors";
import { useThemeStore } from "./theme-store";
import {
    resolveMonospaceFontFamily,
    resolveSansFontFamily,
    type AppFontPreference,
} from "./typography";

export type AppTheme = {
    colors: ColorPalette;
    spacing: typeof spacing;
    fontSize: typeof fontSize;
    borderRadius: typeof borderRadius;
    mode: ThemeMode;
    variant: ThemeVariant;
    fontPreference: AppFontPreference;
    resolvedScheme: "light" | "dark";
    themeKey: string;
    typography: {
        sans: (fontWeight: TextStyle["fontWeight"], fontStyle: TextStyle["fontStyle"]) => string | undefined;
        mono: () => string;
    };
};

const ThemeContext = createContext<AppTheme | null>(null);

type ThemeProviderProps = {
    children: React.ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
    const mode = useThemeStore((state) => state.mode);
    const variant = useThemeStore((state) => state.variant);
    const fontPreference = useThemeStore((state) => state.fontPreference);
    const systemScheme = useColorScheme();

    const theme = useMemo<AppTheme>(() => {
        const resolvedScheme = mode === "system"
            ? (systemScheme === "light" ? "light" : "dark")
            : mode;

        return {
            colors: resolveColorPalette(mode, variant, systemScheme),
            spacing,
            fontSize,
            borderRadius,
            mode,
            variant,
            fontPreference,
            resolvedScheme,
            themeKey: `${mode}:${variant}:${fontPreference}:${resolvedScheme}`,
            typography: {
                sans: (fontWeight, fontStyle) => resolveSansFontFamily(fontPreference, fontWeight, fontStyle),
                mono: () => resolveMonospaceFontFamily(),
            },
        };
    }, [fontPreference, mode, systemScheme, variant]);

    return (
        <ThemeContext.Provider value={theme}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useAppTheme(): AppTheme {
    const theme = useContext(ThemeContext);
    if (theme === null) {
        throw new Error("useAppTheme must be used inside ThemeProvider");
    }
    return theme;
}

export function useThemedStyles<T>(factory: (theme: AppTheme) => T): T {
    const theme = useAppTheme();
    return useMemo(() => factory(theme), [factory, theme]);
}

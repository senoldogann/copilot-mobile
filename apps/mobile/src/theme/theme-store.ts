import { Appearance } from "react-native";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

import { applyThemeColors, type ThemeMode, type ThemeVariant } from "./colors";

const THEME_PREFERENCES_KEY = "copilot_mobile_theme_preferences";

type ThemePreferences = {
    mode: ThemeMode;
    variant: ThemeVariant;
};

type ThemeStore = ThemePreferences & {
    hydrated: boolean;
    hydrate: () => Promise<void>;
    setThemePreferences: (mode: ThemeMode, variant: ThemeVariant) => Promise<void>;
};

const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
    mode: "dark",
    variant: "claude",
};

async function persistThemePreferences(preferences: ThemePreferences): Promise<void> {
    await SecureStore.setItemAsync(
        THEME_PREFERENCES_KEY,
        JSON.stringify(preferences),
    );
}

function readThemePreferences(rawValue: string | null): ThemePreferences {
    if (rawValue === null) {
        return DEFAULT_THEME_PREFERENCES;
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
        return DEFAULT_THEME_PREFERENCES;
    }

    const value = parsed as Record<string, unknown>;
    const mode = value.mode;
    const variant = value.variant;

    if (
        (mode === "light" || mode === "dark" || mode === "system")
        && (variant === "zinc" || variant === "midnight" || variant === "claude" || variant === "ghostty")
    ) {
        return { mode, variant };
    }

    return DEFAULT_THEME_PREFERENCES;
}

export const useThemeStore = create<ThemeStore>((set) => ({
    ...DEFAULT_THEME_PREFERENCES,
    hydrated: false,

    hydrate: async () => {
        const preferences = readThemePreferences(
            await SecureStore.getItemAsync(THEME_PREFERENCES_KEY)
        );
        applyThemeColors(preferences.mode, preferences.variant, Appearance.getColorScheme());
        set({
            ...preferences,
            hydrated: true,
        });
    },

    setThemePreferences: async (mode, variant) => {
        const preferences = { mode, variant } satisfies ThemePreferences;
        applyThemeColors(preferences.mode, preferences.variant, Appearance.getColorScheme());
        set(preferences);
        await persistThemePreferences(preferences);
    },
}));

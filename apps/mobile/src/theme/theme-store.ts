import { Appearance } from "react-native";
import { create } from "zustand";

import { readLocalStateValue, writeLocalStateValue } from "../services/local-state-storage";
import { applyThemeColors, type ThemeMode, type ThemeVariant } from "./colors";
import { ensureFontAssetsLoaded, setGlobalFontPreference, type AppFontPreference } from "./typography";

const THEME_PREFERENCES_KEY = "code_companion_theme_preferences";
const LEGACY_THEME_PREFERENCES_KEY = "copilot_mobile_theme_preferences";

type ThemePreferences = {
    mode: ThemeMode;
    variant: ThemeVariant;
    fontPreference: AppFontPreference;
};

type ThemeStore = ThemePreferences & {
    hydrated: boolean;
    hydrate: () => Promise<void>;
    setThemePreferences: (mode: ThemeMode, variant: ThemeVariant) => Promise<void>;
    setFontPreference: (fontPreference: AppFontPreference) => Promise<void>;
};

const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
    mode: "system",
    variant: "claude",
    fontPreference: "system",
};

async function persistThemePreferences(preferences: ThemePreferences): Promise<void> {
    const serializedPreferences = JSON.stringify(preferences);
    await writeLocalStateValue(
        THEME_PREFERENCES_KEY,
        serializedPreferences,
    );
    await writeLocalStateValue(
        LEGACY_THEME_PREFERENCES_KEY,
        serializedPreferences,
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
    const fontPreference = value.fontPreference;

    if (
        (mode === "light" || mode === "dark" || mode === "system")
        && (
            variant === "zinc"
            || variant === "midnight"
            || variant === "claude"
            || variant === "ghostty"
            || variant === "amoled"
        )
        && (
            fontPreference === undefined
            || fontPreference === "system"
            || fontPreference === "inter"
            || fontPreference === "poppins"
            || fontPreference === "manrope"
            || fontPreference === "roboto"
        )
    ) {
        return {
            mode,
            variant,
            fontPreference: fontPreference ?? DEFAULT_THEME_PREFERENCES.fontPreference,
        };
    }

    return DEFAULT_THEME_PREFERENCES;
}

export const useThemeStore = create<ThemeStore>((set) => ({
    ...DEFAULT_THEME_PREFERENCES,
    hydrated: false,

    hydrate: async () => {
        const rawValue = await readLocalStateValue(THEME_PREFERENCES_KEY)
            ?? await readLocalStateValue(LEGACY_THEME_PREFERENCES_KEY);
        if (rawValue !== null) {
            await writeLocalStateValue(THEME_PREFERENCES_KEY, rawValue);
        }

        const preferences = readThemePreferences(rawValue);
        await ensureFontAssetsLoaded(preferences.fontPreference);
        setGlobalFontPreference(preferences.fontPreference);
        applyThemeColors(preferences.mode, preferences.variant, Appearance.getColorScheme());
        set({
            ...preferences,
            hydrated: true,
        });
    },

    setThemePreferences: async (mode, variant) => {
        const preferences = {
            mode,
            variant,
            fontPreference: useThemeStore.getState().fontPreference,
        } satisfies ThemePreferences;
        applyThemeColors(preferences.mode, preferences.variant, Appearance.getColorScheme());
        set(preferences);
        await persistThemePreferences(preferences);
    },

    setFontPreference: async (fontPreference) => {
        await ensureFontAssetsLoaded(fontPreference);
        const preferences = {
            mode: useThemeStore.getState().mode,
            variant: useThemeStore.getState().variant,
            fontPreference,
        } satisfies ThemePreferences;
        setGlobalFontPreference(fontPreference);
        set({ fontPreference });
        await persistThemePreferences(preferences);
    },
}));

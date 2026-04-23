import * as Font from "expo-font";
import { Platform, StyleSheet, type StyleProp, type TextStyle } from "react-native";
import {
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_500Medium_Italic,
    Inter_600SemiBold,
    Inter_600SemiBold_Italic,
    Inter_700Bold,
    Inter_700Bold_Italic,
    Inter_800ExtraBold,
    Inter_800ExtraBold_Italic,
} from "@expo-google-fonts/inter";
import {
    Poppins_400Regular,
    Poppins_400Regular_Italic,
    Poppins_500Medium,
    Poppins_500Medium_Italic,
    Poppins_600SemiBold,
    Poppins_600SemiBold_Italic,
    Poppins_700Bold,
    Poppins_700Bold_Italic,
    Poppins_800ExtraBold,
    Poppins_800ExtraBold_Italic,
} from "@expo-google-fonts/poppins";
import {
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import {
    Roboto_400Regular,
    Roboto_400Regular_Italic,
    Roboto_500Medium,
    Roboto_500Medium_Italic,
    Roboto_600SemiBold,
    Roboto_600SemiBold_Italic,
    Roboto_700Bold,
    Roboto_700Bold_Italic,
    Roboto_800ExtraBold,
    Roboto_800ExtraBold_Italic,
} from "@expo-google-fonts/roboto";

export type AppFontPreference = "system" | "inter" | "poppins" | "manrope" | "roboto";

type FontVariantSet = {
    regular: string;
    regularItalic: string;
    medium: string;
    mediumItalic: string;
    semibold: string;
    semiboldItalic: string;
    bold: string;
    boldItalic: string;
    heavy: string;
    heavyItalic: string;
};

export const APP_FONT_OPTIONS: ReadonlyArray<{ value: AppFontPreference; label: string }> = [
    { value: "system", label: "System" },
    { value: "inter", label: "Inter" },
    { value: "poppins", label: "Poppins" },
    { value: "manrope", label: "Manrope" },
    { value: "roboto", label: "Roboto" },
];

const FONT_ASSETS_BY_PREFERENCE: Readonly<Record<Exclude<AppFontPreference, "system">, Record<string, number>>> = {
    inter: {
        Inter_400Regular,
        Inter_400Regular_Italic,
        Inter_500Medium,
        Inter_500Medium_Italic,
        Inter_600SemiBold,
        Inter_600SemiBold_Italic,
        Inter_700Bold,
        Inter_700Bold_Italic,
        Inter_800ExtraBold,
        Inter_800ExtraBold_Italic,
    },
    poppins: {
        Poppins_400Regular,
        Poppins_400Regular_Italic,
        Poppins_500Medium,
        Poppins_500Medium_Italic,
        Poppins_600SemiBold,
        Poppins_600SemiBold_Italic,
        Poppins_700Bold,
        Poppins_700Bold_Italic,
        Poppins_800ExtraBold,
        Poppins_800ExtraBold_Italic,
    },
    manrope: {
        Manrope_400Regular,
        Manrope_500Medium,
        Manrope_600SemiBold,
        Manrope_700Bold,
        Manrope_800ExtraBold,
    },
    roboto: {
        Roboto_400Regular,
        Roboto_400Regular_Italic,
        Roboto_500Medium,
        Roboto_500Medium_Italic,
        Roboto_600SemiBold,
        Roboto_600SemiBold_Italic,
        Roboto_700Bold,
        Roboto_700Bold_Italic,
        Roboto_800ExtraBold,
        Roboto_800ExtraBold_Italic,
    },
} as const;

const FONT_VARIANTS: Readonly<Record<Exclude<AppFontPreference, "system">, FontVariantSet>> = {
    inter: {
        regular: "Inter_400Regular",
        regularItalic: "Inter_400Regular_Italic",
        medium: "Inter_500Medium",
        mediumItalic: "Inter_500Medium_Italic",
        semibold: "Inter_600SemiBold",
        semiboldItalic: "Inter_600SemiBold_Italic",
        bold: "Inter_700Bold",
        boldItalic: "Inter_700Bold_Italic",
        heavy: "Inter_800ExtraBold",
        heavyItalic: "Inter_800ExtraBold_Italic",
    },
    poppins: {
        regular: "Poppins_400Regular",
        regularItalic: "Poppins_400Regular_Italic",
        medium: "Poppins_500Medium",
        mediumItalic: "Poppins_500Medium_Italic",
        semibold: "Poppins_600SemiBold",
        semiboldItalic: "Poppins_600SemiBold_Italic",
        bold: "Poppins_700Bold",
        boldItalic: "Poppins_700Bold_Italic",
        heavy: "Poppins_800ExtraBold",
        heavyItalic: "Poppins_800ExtraBold_Italic",
    },
    manrope: {
        regular: "Manrope_400Regular",
        regularItalic: "Manrope_400Regular",
        medium: "Manrope_500Medium",
        mediumItalic: "Manrope_500Medium",
        semibold: "Manrope_600SemiBold",
        semiboldItalic: "Manrope_600SemiBold",
        bold: "Manrope_700Bold",
        boldItalic: "Manrope_700Bold",
        heavy: "Manrope_800ExtraBold",
        heavyItalic: "Manrope_800ExtraBold",
    },
    roboto: {
        regular: "Roboto_400Regular",
        regularItalic: "Roboto_400Regular_Italic",
        medium: "Roboto_500Medium",
        mediumItalic: "Roboto_500Medium_Italic",
        semibold: "Roboto_600SemiBold",
        semiboldItalic: "Roboto_600SemiBold_Italic",
        bold: "Roboto_700Bold",
        boldItalic: "Roboto_700Bold_Italic",
        heavy: "Roboto_800ExtraBold",
        heavyItalic: "Roboto_800ExtraBold_Italic",
    },
};

const MONOSPACE_FONT_FAMILIES = new Set([
    "monospace",
    "courier",
    "courier new",
    "menlo",
    "monaco",
]);

type TypographyState = {
    fontPreference: AppFontPreference;
};

const typographyState: TypographyState = {
    fontPreference: "system",
};

const loadedFontPreferences = new Set<AppFontPreference>(["system"]);

const patchRegistry = {
    ready: false,
    styleSheetCreate: StyleSheet.create,
};

function getFontAssets(fontPreference: AppFontPreference): Readonly<Record<string, number>> {
    if (fontPreference === "system") {
        return {};
    }

    return FONT_ASSETS_BY_PREFERENCE[fontPreference];
}

export async function ensureFontAssetsLoaded(fontPreference: AppFontPreference): Promise<void> {
    if (loadedFontPreferences.has(fontPreference)) {
        return;
    }

    const fontAssets = getFontAssets(fontPreference);
    if (Object.keys(fontAssets).length === 0) {
        loadedFontPreferences.add(fontPreference);
        return;
    }

    await Font.loadAsync(fontAssets);
    loadedFontPreferences.add(fontPreference);
}

function normalizeFontWeight(fontWeight: TextStyle["fontWeight"]): number {
    if (typeof fontWeight === "number") {
        return fontWeight;
    }

    if (typeof fontWeight === "string") {
        const trimmedWeight = fontWeight.trim().toLowerCase();
        if (trimmedWeight === "normal") {
            return 400;
        }

        if (trimmedWeight === "bold") {
            return 700;
        }

        const parsedWeight = Number.parseInt(trimmedWeight, 10);
        if (!Number.isNaN(parsedWeight)) {
            return parsedWeight;
        }
    }

    return 400;
}

function isMonospaceFontFamily(fontFamily: string): boolean {
    return MONOSPACE_FONT_FAMILIES.has(fontFamily.trim().toLowerCase());
}

export function resolveMonospaceFontFamily(): string {
    if (Platform.OS === "ios") {
        return "Menlo";
    }

    return "monospace";
}

export function resolveSansFontFamily(
    fontPreference: AppFontPreference,
    fontWeight: TextStyle["fontWeight"],
    fontStyle: TextStyle["fontStyle"]
): string | undefined {
    if (fontPreference === "system") {
        return undefined;
    }

    const variants = FONT_VARIANTS[fontPreference];
    const weight = normalizeFontWeight(fontWeight);
    const isItalic = fontStyle === "italic";

    if (weight >= 800) {
        return isItalic ? variants.heavyItalic : variants.heavy;
    }

    if (weight >= 700) {
        return isItalic ? variants.boldItalic : variants.bold;
    }

    if (weight >= 600) {
        return isItalic ? variants.semiboldItalic : variants.semibold;
    }

    if (weight >= 500) {
        return isItalic ? variants.mediumItalic : variants.medium;
    }

    return isItalic ? variants.regularItalic : variants.regular;
}

function resolveGlobalTextStyle(style: unknown): StyleProp<TextStyle> {
    const flattenedStyle = StyleSheet.flatten(style as StyleProp<TextStyle>);
    const fontFamily = flattenedStyle?.fontFamily;
    if (typeof fontFamily === "string") {
        if (isMonospaceFontFamily(fontFamily)) {
            return [style as StyleProp<TextStyle>, { fontFamily: resolveMonospaceFontFamily() }];
        }

        return style as StyleProp<TextStyle>;
    }

    const resolvedFontFamily = resolveSansFontFamily(
        typographyState.fontPreference,
        flattenedStyle?.fontWeight,
        flattenedStyle?.fontStyle
    );
    if (resolvedFontFamily === undefined) {
        return style as StyleProp<TextStyle>;
    }

    if (style === undefined || style === null) {
        return { fontFamily: resolvedFontFamily };
    }

    return [style as StyleProp<TextStyle>, { fontFamily: resolvedFontFamily }];
}

function styleLooksLikeTextStyle(styleName: string, styleValue: TextStyle): boolean {
    if (
        styleValue.fontSize !== undefined
        || styleValue.fontWeight !== undefined
        || styleValue.lineHeight !== undefined
        || styleValue.letterSpacing !== undefined
        || styleValue.textAlign !== undefined
        || styleValue.textTransform !== undefined
        || styleValue.textDecorationLine !== undefined
        || styleValue.fontStyle !== undefined
    ) {
        return true;
    }

    return /(text|title|label|heading|paragraph|subtitle|caption|value|meta|copy|prompt|code|time|version|footer|badge)/i.test(styleName);
}

function patchTextStyleRule(styleName: string, styleValue: TextStyle): TextStyle {
    const fontFamily = styleValue.fontFamily;
    if (typeof fontFamily === "string") {
        if (isMonospaceFontFamily(fontFamily)) {
            return {
                ...styleValue,
                fontFamily: resolveMonospaceFontFamily(),
            };
        }

        return styleValue;
    }

    if (!styleLooksLikeTextStyle(styleName, styleValue)) {
        return styleValue;
    }

    const resolvedFontFamily = resolveSansFontFamily(
        typographyState.fontPreference,
        styleValue.fontWeight,
        styleValue.fontStyle
    );
    if (resolvedFontFamily === undefined) {
        return styleValue;
    }

    return {
        ...styleValue,
        fontFamily: resolvedFontFamily,
    };
}

export function ensureGlobalTypographyPatched(): void {
    if (patchRegistry.ready) {
        return;
    }

    const originalCreate = patchRegistry.styleSheetCreate;
    StyleSheet.create = function patchedStyleSheetCreate<T extends Record<string, TextStyle>>(styles: T): T {
        const patchedEntries = Object.entries(styles).map(([styleName, styleValue]) => {
            if (styleValue === null || typeof styleValue !== "object" || Array.isArray(styleValue)) {
                return [styleName, styleValue];
            }

            return [styleName, patchTextStyleRule(styleName, styleValue)];
        });

        return originalCreate(Object.fromEntries(patchedEntries) as T);
    };

    patchRegistry.ready = true;
}

export function setGlobalFontPreference(fontPreference: AppFontPreference): void {
    typographyState.fontPreference = fontPreference;
    ensureGlobalTypographyPatched();
}

ensureGlobalTypographyPatched();

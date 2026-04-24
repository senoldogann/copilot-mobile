import type { ColorSchemeName } from "react-native";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeVariant = "zinc" | "midnight" | "claude" | "ghostty" | "amoled";

export type ColorPalette = {
    bg: string;
    bgSecondary: string;
    bgTertiary: string;
    bgElevated: string;
    bgOverlay: string;
    border: string;
    borderMuted: string;
    borderActive: string;
    textPrimary: string;
    textAssistant: string;
    textSecondary: string;
    textTertiary: string;
    textDisabled: string;
    textLink: string;
    textOnAccent: string;
    accent: string;
    accentMuted: string;
    accentPressed: string;
    copilotPurple: string;
    copilotPurpleMuted: string;
    copilotPurpleBorder: string;
    success: string;
    successMuted: string;
    warning: string;
    error: string;
    errorMuted: string;
    textPlaceholder: string;
    errorBackground: string;
    errorSurface: string;
    overlay: string;
    overlayLight: string;
    btnPrimary: string;
    btnPrimaryHover: string;
    btnSecondary: string;
    btnDanger: string;
    codeBg: string;
    codeBorder: string;
    codeText: string;
    codeInline: string;
    lineHighlightBg: string;
    lineHighlightBorder: string;
    lineHighlightText: string;
    inputBg: string;
    inputBorder: string;
    inputBorderFocus: string;
    inputPlaceholder: string;
    toolbarBg: string;
    toolbarBorder: string;
    sidebarBg: string;
    sidebarItemActive: string;
    sidebarItemHover: string;
};

const lightPalette: ColorPalette = {
    bg: "#f7f7f5",
    bgSecondary: "#ffffff",
    bgTertiary: "#f1f1ee",
    bgElevated: "#ebebe7",
    bgOverlay: "#deded8",
    border: "#dadad2",
    borderMuted: "#e8e8e1",
    borderActive: "#246bdb",
    textPrimary: "#171717",
    textAssistant: "#272727",
    textSecondary: "#5f5f5a",
    textTertiary: "#80807a",
    textDisabled: "#a9a9a3",
    textLink: "#246bdb",
    textOnAccent: "#ffffff",
    accent: "#c96d48",
    accentMuted: "#c96d4824",
    accentPressed: "#b05f3d",
    copilotPurple: "#805ad5",
    copilotPurpleMuted: "#805ad51d",
    copilotPurpleBorder: "#805ad52e",
    success: "#238b45",
    successMuted: "#238b4520",
    warning: "#9a6700",
    error: "#c62828",
    errorMuted: "#c6282820",
    textPlaceholder: "#8c8c84",
    errorBackground: "rgba(198, 40, 40, 0.12)",
    errorSurface: "#c62828",
    overlay: "rgba(0, 0, 0, 0.2)",
    overlayLight: "rgba(0, 0, 0, 0.12)",
    btnPrimary: "#238b45",
    btnPrimaryHover: "#2ca354",
    btnSecondary: "#ecece7",
    btnDanger: "#c62828",
    codeBg: "#f2f4f7",
    codeBorder: "#d5d9df",
    codeText: "#22252a",
    codeInline: "#b35c1e",
    lineHighlightBg: "#d8e9ff",
    lineHighlightBorder: "#9ac4ff",
    lineHighlightText: "#0f4c9a",
    inputBg: "#ffffff",
    inputBorder: "#d7d7d0",
    inputBorderFocus: "#246bdb",
    inputPlaceholder: "#8c8c84",
    toolbarBg: "#ffffff",
    toolbarBorder: "#e6e6df",
    sidebarBg: "#f3f3ef",
    sidebarItemActive: "#e7e7e1",
    sidebarItemHover: "#edede8",
};

const darkPalettes: Record<ThemeVariant, ColorPalette> = {
    zinc: {
        bg: "#18181b",
        bgSecondary: "#1f1f23",
        bgTertiary: "#27272c",
        bgElevated: "#2e2e35",
        bgOverlay: "#373740",
        border: "#303038",
        borderMuted: "#27272f",
        borderActive: "#60a5fa",
        textPrimary: "#f4f4f5",
        textAssistant: "#e4e4e7",
        textSecondary: "#b1b1b8",
        textTertiary: "#7a7a84",
        textDisabled: "#55555e",
        textLink: "#60a5fa",
        textOnAccent: "#ffffff",
        accent: "#71717a",
        accentMuted: "#71717a30",
        accentPressed: "#63636b",
        copilotPurple: "#a78bfa",
        copilotPurpleMuted: "#a78bfa1f",
        copilotPurpleBorder: "#a78bfa30",
        success: "#4ade80",
        successMuted: "#22c55e20",
        warning: "#fbbf24",
        error: "#f87171",
        errorMuted: "#ef444420",
        textPlaceholder: "#71717a",
        errorBackground: "rgba(248, 113, 113, 0.14)",
        errorSurface: "#ef4444",
        overlay: "rgba(0, 0, 0, 0.58)",
        overlayLight: "rgba(0, 0, 0, 0.42)",
        btnPrimary: "#3f3f46",
        btnPrimaryHover: "#52525b",
        btnSecondary: "#27272c",
        btnDanger: "#dc2626",
        codeBg: "#1d1d22",
        codeBorder: "#31313a",
        codeText: "#f4f4f5",
        codeInline: "#f59e0b",
        lineHighlightBg: "#1f3149",
        lineHighlightBorder: "#365273",
        lineHighlightText: "#93c5fd",
        inputBg: "#18181b",
        inputBorder: "#303038",
        inputBorderFocus: "#60a5fa",
        inputPlaceholder: "#71717a",
        toolbarBg: "#1f1f23",
        toolbarBorder: "#27272f",
        sidebarBg: "#18181b",
        sidebarItemActive: "#27272c",
        sidebarItemHover: "#1f1f23",
    },
    midnight: {
        bg: "#0f172a",
        bgSecondary: "#111c33",
        bgTertiary: "#16213c",
        bgElevated: "#1a2746",
        bgOverlay: "#233256",
        border: "#21314f",
        borderMuted: "#172542",
        borderActive: "#60a5fa",
        textPrimary: "#ecf2ff",
        textAssistant: "#d8e3ff",
        textSecondary: "#9fb1d7",
        textTertiary: "#697b9e",
        textDisabled: "#45526d",
        textLink: "#7cc4ff",
        textOnAccent: "#ffffff",
        accent: "#4f8cff",
        accentMuted: "#4f8cff24",
        accentPressed: "#4176d9",
        copilotPurple: "#8b7bff",
        copilotPurpleMuted: "#8b7bff20",
        copilotPurpleBorder: "#8b7bff34",
        success: "#4ade80",
        successMuted: "#16a34a20",
        warning: "#fbbf24",
        error: "#fb7185",
        errorMuted: "#fb718520",
        textPlaceholder: "#697b9e",
        errorBackground: "rgba(251, 113, 133, 0.14)",
        errorSurface: "#fb7185",
        overlay: "rgba(1, 7, 20, 0.7)",
        overlayLight: "rgba(1, 7, 20, 0.48)",
        btnPrimary: "#2563eb",
        btnPrimaryHover: "#3b82f6",
        btnSecondary: "#16213c",
        btnDanger: "#e11d48",
        codeBg: "#11192d",
        codeBorder: "#223252",
        codeText: "#edf4ff",
        codeInline: "#fbbf24",
        lineHighlightBg: "#183459",
        lineHighlightBorder: "#2f5a8f",
        lineHighlightText: "#93c5fd",
        inputBg: "#0f172a",
        inputBorder: "#21314f",
        inputBorderFocus: "#60a5fa",
        inputPlaceholder: "#697b9e",
        toolbarBg: "#111c33",
        toolbarBorder: "#172542",
        sidebarBg: "#0f172a",
        sidebarItemActive: "#16213c",
        sidebarItemHover: "#111c33",
    },
    claude: {
        bg: "#161918",
        bgSecondary: "#1d201f",
        bgTertiary: "#232726",
        bgElevated: "#2a2e2d",
        bgOverlay: "#333736",
        border: "#313236",
        borderMuted: "#25272b",
        borderActive: "#58a6ff",
        textPrimary: "#e6edf3",
        textAssistant: "#c9d1d9",
        textSecondary: "#a0a3a2",
        textTertiary: "#595B5B",
        textDisabled: "#3f4241",
        textLink: "#58a6ff",
        textOnAccent: "#ffffff",
        accent: "#f78166",
        accentMuted: "#f7816630",
        accentPressed: "#e06d55",
        copilotPurple: "#a371f7",
        copilotPurpleMuted: "#a371f720",
        copilotPurpleBorder: "#a371f730",
        success: "#3fb950",
        successMuted: "#23863620",
        warning: "#d29922",
        error: "#f85149",
        errorMuted: "#f8514920",
        textPlaceholder: "#595B5B",
        errorBackground: "rgba(248, 81, 73, 0.15)",
        errorSurface: "#f85149",
        overlay: "rgba(0, 0, 0, 0.6)",
        overlayLight: "rgba(0, 0, 0, 0.5)",
        btnPrimary: "#238636",
        btnPrimaryHover: "#2ea043",
        btnSecondary: "#232726",
        btnDanger: "#da3633",
        codeBg: "#1d201f",
        codeBorder: "#313236",
        codeText: "#e6edf3",
        codeInline: "#f0883e",
        lineHighlightBg: "#1a3a5c",
        lineHighlightBorder: "#264f78",
        lineHighlightText: "#9cdcfe",
        inputBg: "#161918",
        inputBorder: "#313236",
        inputBorderFocus: "#58a6ff",
        inputPlaceholder: "#595B5B",
        toolbarBg: "#1d201f",
        toolbarBorder: "#25272b",
        sidebarBg: "#161918",
        sidebarItemActive: "#232726",
        sidebarItemHover: "#1d201f",
    },
    ghostty: {
        bg: "#10131a",
        bgSecondary: "#141927",
        bgTertiary: "#1a2031",
        bgElevated: "#21283b",
        bgOverlay: "#2a3349",
        border: "#222b40",
        borderMuted: "#1a2235",
        borderActive: "#8fb2ff",
        textPrimary: "#edf3ff",
        textAssistant: "#dbe5ff",
        textSecondary: "#a5b4d6",
        textTertiary: "#7280a5",
        textDisabled: "#4a5675",
        textLink: "#8fb2ff",
        textOnAccent: "#ffffff",
        accent: "#7aa2f7",
        accentMuted: "#7aa2f724",
        accentPressed: "#678ad4",
        copilotPurple: "#bb9af7",
        copilotPurpleMuted: "#bb9af720",
        copilotPurpleBorder: "#bb9af734",
        success: "#9ece6a",
        successMuted: "#9ece6a20",
        warning: "#e0af68",
        error: "#f7768e",
        errorMuted: "#f7768e20",
        textPlaceholder: "#7280a5",
        errorBackground: "rgba(247, 118, 142, 0.16)",
        errorSurface: "#f7768e",
        overlay: "rgba(3, 6, 12, 0.72)",
        overlayLight: "rgba(3, 6, 12, 0.48)",
        btnPrimary: "#7aa2f7",
        btnPrimaryHover: "#8fb2ff",
        btnSecondary: "#1a2031",
        btnDanger: "#f7768e",
        codeBg: "#121725",
        codeBorder: "#232c44",
        codeText: "#edf3ff",
        codeInline: "#e0af68",
        lineHighlightBg: "#1f3154",
        lineHighlightBorder: "#35527f",
        lineHighlightText: "#a9c1ff",
        inputBg: "#10131a",
        inputBorder: "#222b40",
        inputBorderFocus: "#8fb2ff",
        inputPlaceholder: "#7280a5",
        toolbarBg: "#141927",
        toolbarBorder: "#1a2235",
        sidebarBg: "#10131a",
        sidebarItemActive: "#1a2031",
        sidebarItemHover: "#141927",
    },
    amoled: {
        bg: "#000000",
        bgSecondary: "#000000",
        bgTertiary: "#0f0f12",
        bgElevated: "#000000",
        bgOverlay: "#17171b",
        border: "#2a2a2f",
        borderMuted: "#18181c",
        borderActive: "#ffffff",
        textPrimary: "#ffffff",
        textAssistant: "#f4f4f5",
        textSecondary: "#a1a1aa",
        textTertiary: "#71717a",
        textDisabled: "#52525b",
        textLink: "#ffffff",
        textOnAccent: "#000000",
        accent: "#ffffff",
        accentMuted: "#ffffff20",
        accentPressed: "#d4d4d8",
        copilotPurple: "#c084fc",
        copilotPurpleMuted: "#c084fc20",
        copilotPurpleBorder: "#c084fc34",
        success: "#4ade80",
        successMuted: "#22c55e20",
        warning: "#fbbf24",
        error: "#f87171",
        errorMuted: "#ef444420",
        textPlaceholder: "#71717a",
        errorBackground: "rgba(248, 113, 113, 0.14)",
        errorSurface: "#ef4444",
        overlay: "rgba(0, 0, 0, 0.8)",
        overlayLight: "rgba(0, 0, 0, 0.5)",
        btnPrimary: "#ffffff",
        btnPrimaryHover: "#e4e4e7",
        btnSecondary: "#0f0f12",
        btnDanger: "#dc2626",
        codeBg: "#000000",
        codeBorder: "#2a2a2f",
        codeText: "#f4f4f5",
        codeInline: "#f59e0b",
        lineHighlightBg: "#0f0f12",
        lineHighlightBorder: "#17171b",
        lineHighlightText: "#ffffff",
        inputBg: "#000000",
        inputBorder: "#2a2a2f",
        inputBorderFocus: "#ffffff",
        inputPlaceholder: "#71717a",
        toolbarBg: "#000000",
        toolbarBorder: "#18181c",
        sidebarBg: "#000000",
        sidebarItemActive: "#0f0f12",
        sidebarItemHover: "#08080a",
    },
};

export function resolveColorPalette(
    mode: ThemeMode,
    variant: ThemeVariant,
    systemScheme: ColorSchemeName
): ColorPalette {
    const resolvedMode = mode === "system"
        ? (systemScheme === "light" ? "light" : "dark")
        : mode;

    if (resolvedMode === "light") {
        return lightPalette;
    }

    return darkPalettes[variant];
}

export const colors: ColorPalette = { ...darkPalettes.claude };

export function applyThemeColors(
    mode: ThemeMode,
    variant: ThemeVariant,
    systemScheme: ColorSchemeName
): void {
    Object.assign(colors, resolveColorPalette(mode, variant, systemScheme));
}

export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
} as const;

export const fontSize = {
    xs: 10,
    sm: 12,
    md: 13,
    base: 14,
    lg: 16,
    xl: 18,
    xxl: 22,
} as const;

export const borderRadius = {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
} as const;

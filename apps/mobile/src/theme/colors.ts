// Copilot Mobile — Tema sabitleri
// GitHub Copilot mobil uygulamasının koyu temasından alınmış renk paleti

export const colors = {
    // Arka planlar
    bg: "#161918",
    bgSecondary: "#1d201f",
    bgTertiary: "#232726",
    bgElevated: "#2a2e2d",
    bgOverlay: "#333736",

    // Kenarlıklar
    border: "#2a2e2d",
    borderMuted: "#232726",
    borderActive: "#58a6ff",

    // Metin
    textPrimary: "#e6edf3",
    textSecondary: "#a0a3a2",
    textTertiary: "#595B5B",
    textDisabled: "#3f4241",
    textLink: "#58a6ff",
    textOnAccent: "#ffffff",

    // Marka
    accent: "#f78166",
    accentMuted: "#f7816630",
    accentPressed: "#e06d55",
    copilotPurple: "#a371f7",
    copilotPurpleMuted: "#a371f720",
    copilotPurpleBorder: "#a371f730",

    // Durum renkleri
    success: "#3fb950",
    successMuted: "#23863620",
    warning: "#d29922",
    error: "#f85149",
    errorMuted: "#f8514920",

    // Yer tutucu ve hata yüzeyleri
    textPlaceholder: "#595B5B",
    errorBackground: "rgba(248, 81, 73, 0.15)",
    errorSurface: "#f85149",

    // Overlay
    overlay: "rgba(0, 0, 0, 0.6)",
    overlayLight: "rgba(0, 0, 0, 0.5)",

    // Butonlar
    btnPrimary: "#238636",
    btnPrimaryHover: "#2ea043",
    btnSecondary: "#232726",
    btnDanger: "#da3633",

    // Kod blokları
    codeBg: "#1d201f",
    codeBorder: "#2a2e2d",
    codeText: "#e6edf3",
    codeInline: "#f0883e",
    lineHighlightBg: "#1a3a5c",
    lineHighlightBorder: "#264f78",
    lineHighlightText: "#9cdcfe",

    // Giriş alanları
    inputBg: "#161918",
    inputBorder: "#2a2e2d",
    inputBorderFocus: "#58a6ff",
    inputPlaceholder: "#595B5B",

    // Araç çubuğu
    toolbarBg: "#1d201f",
    toolbarBorder: "#232726",

    // Drawer / Sidebar
    sidebarBg: "#161918",
    sidebarItemActive: "#232726",
    sidebarItemHover: "#1d201f",
} as const;

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

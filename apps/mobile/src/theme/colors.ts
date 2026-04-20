// Copilot Mobile — Tema sabitleri
// GitHub Copilot mobil uygulamasının koyu temasından alınmış renk paleti

export const colors = {
    // Arka planlar
    bg: "#0d1117",
    bgSecondary: "#161b22",
    bgTertiary: "#1c2128",
    bgElevated: "#21262d",
    bgOverlay: "#30363d",

    // Kenarlıklar
    border: "#30363d",
    borderMuted: "#21262d",
    borderActive: "#58a6ff",

    // Metin
    textPrimary: "#e6edf3",
    textSecondary: "#8b949e",
    textTertiary: "#6e7681",
    textDisabled: "#484f58",
    textLink: "#58a6ff",
    textOnAccent: "#ffffff",

    // Marka
    accent: "#f78166",
    accentMuted: "#f7816640",
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
    textPlaceholder: "#8b949e",
    errorBackground: "rgba(248, 81, 73, 0.15)",
    errorSurface: "#f85149",

    // Overlay
    overlay: "rgba(0, 0, 0, 0.6)",
    overlayLight: "rgba(0, 0, 0, 0.5)",

    // Butonlar
    btnPrimary: "#238636",
    btnPrimaryHover: "#2ea043",
    btnSecondary: "#21262d",
    btnDanger: "#da3633",

    // Kod blokları
    codeBg: "#161b22",
    codeBorder: "#30363d",
    codeText: "#e6edf3",
    codeInline: "#f0883e",
    lineHighlightBg: "#1a3a5c",
    lineHighlightBorder: "#264f78",
    lineHighlightText: "#9cdcfe",

    // Giriş alanları
    inputBg: "#0d1117",
    inputBorder: "#30363d",
    inputBorderFocus: "#58a6ff",
    inputPlaceholder: "#484f58",

    // Araç çubuğu
    toolbarBg: "#161b22",
    toolbarBorder: "#21262d",

    // Drawer / Sidebar
    sidebarBg: "#0d1117",
    sidebarItemActive: "#1c2128",
    sidebarItemHover: "#161b22",
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

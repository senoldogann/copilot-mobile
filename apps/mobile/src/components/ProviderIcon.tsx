// Provider SVG icons — Copilot, OpenAI, Anthropic, Google, xAI, Meta
// Inline SVGs so no raster assets are needed.

import React from "react";
import Svg, { Path, Circle, G, Rect } from "react-native-svg";

export type Provider = "copilot" | "openai" | "anthropic" | "google" | "xai" | "meta" | "mistral" | "generic";

export function detectProvider(modelIdOrName: string | undefined | null): Provider {
    if (modelIdOrName === null || modelIdOrName === undefined) {
        return "copilot";
    }
    const s = modelIdOrName.toLowerCase();
    if (s.includes("claude") || s.includes("anthropic")) return "anthropic";
    if (s.includes("gpt") || s.includes("o1") || s.includes("o3") || s.includes("o4") || s.includes("openai")) return "openai";
    if (s.includes("gemini") || s.includes("google")) return "google";
    if (s.includes("grok") || s.includes("xai")) return "xai";
    if (s.includes("llama") || s.includes("meta")) return "meta";
    if (s.includes("mistral") || s.includes("codestral")) return "mistral";
    return "copilot";
}

type Props = {
    provider?: Provider;
    size?: number;
    color?: string;
};

// GitHub Copilot resmi mark'ı (github.com/logos) — yuvarlak gövde + anten + gözler.
export function CopilotIcon({ size = 16, color = "#e6edf3" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M23.122 10.322a4.07 4.07 0 0 0-.278-1.042 3.22 3.22 0 0 0-1.15-1.456 3.52 3.52 0 0 0-.47-.27c.02-.1.035-.2.047-.3a5.38 5.38 0 0 0-.043-1.68 4.76 4.76 0 0 0-1.17-2.323 4.53 4.53 0 0 0-2.28-1.37 5.33 5.33 0 0 0-1.52-.17 6.25 6.25 0 0 0-1.29.17c-.41.1-.83.25-1.22.45A5.26 5.26 0 0 0 12 3.72a5.26 5.26 0 0 0-1.75-1.39 5.73 5.73 0 0 0-1.22-.45A6.25 6.25 0 0 0 7.74 1.7a5.33 5.33 0 0 0-1.52.18 4.53 4.53 0 0 0-2.28 1.37 4.76 4.76 0 0 0-1.17 2.32 5.38 5.38 0 0 0-.04 1.68c.01.1.03.2.05.3-.17.08-.32.17-.47.27A3.22 3.22 0 0 0 1.16 9.28c-.12.33-.21.68-.28 1.04a7.85 7.85 0 0 0-.1 1.2v1.56c0 .4.03.79.1 1.17.12.72.36 1.4.71 2.04.34.63.78 1.2 1.3 1.7A6.83 6.83 0 0 0 6.35 19.7c.7.18 1.42.29 2.15.31.82.03 1.65-.04 2.46-.2.37-.08.73-.18 1.08-.3.35.12.7.22 1.07.3.81.16 1.64.23 2.46.2.73-.02 1.45-.13 2.15-.3a6.83 6.83 0 0 0 3.46-1.72c.52-.5.96-1.07 1.3-1.7.35-.64.59-1.32.71-2.04.07-.39.1-.78.1-1.17v-1.56a7.85 7.85 0 0 0-.17-1.2ZM8.6 14.9a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm6.8 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Z"
                fill={color}
            />
        </Svg>
    );
}

// OpenAI knot mark
function OpenAIIcon({ size = 16, color = "#e6edf3" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M22.3 10a6 6 0 0 0-.5-5 6 6 0 0 0-6.5-2.9A6 6 0 0 0 10.6 0a6 6 0 0 0-5.7 4.2 6 6 0 0 0-4 2.9 6 6 0 0 0 .7 7.1 6 6 0 0 0 .5 5 6 6 0 0 0 6.5 2.9 6 6 0 0 0 4.7 2.1 6 6 0 0 0 5.7-4.2 6 6 0 0 0 4-2.9 6 6 0 0 0-.7-7.1ZM13.3 22.4a4.5 4.5 0 0 1-2.9-1l.1-.1 4.8-2.8c.3-.1.4-.4.4-.7V11l2 1.2v5.7c0 2.4-2 4.5-4.4 4.5ZM3.8 18.4a4.5 4.5 0 0 1-.5-3l.1.1 4.8 2.8c.3.1.6.1.8 0l5.8-3.4v2.3c0 .1 0 .1-.1.1l-4.8 2.8a4.5 4.5 0 0 1-6.1-1.7ZM2.6 8.1a4.5 4.5 0 0 1 2.3-2v5.8c0 .3.2.6.4.7l5.8 3.4-2 1.2-5 -2.9A4.5 4.5 0 0 1 2.6 8.1Zm16.8 3.9L13.6 8.6l2-1.1 4.8 2.8a4.5 4.5 0 0 1 1.4 5.6 4.5 4.5 0 0 1-2.3 2v-5.8ZM21.3 7.7l-.1-.1-4.8-2.8c-.3-.1-.6-.1-.8 0L9.8 8.2V5.9c0-.1 0-.1.1-.1l4.8-2.8a4.5 4.5 0 0 1 6.7 4.6ZM8.7 13l-2-1.1V6.1c0-2.5 2-4.5 4.5-4.5a4.5 4.5 0 0 1 2.9 1L14 3l-4.8 2.8c-.3.1-.4.4-.4.7V13Zm1.1-2.4L12 9.3l2.2 1.3v2.6L12 14.5l-2.2-1.3v-2.6Z"
                fill={color}
            />
        </Svg>
    );
}

// Anthropic mark (simplified)
function AnthropicIcon({ size = 16, color = "#da7756" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M6.5 4h3l5.5 16h-3l-1.2-3.6H7.2L6 20H3L6.5 4Zm1.5 4.6L8 8.5l-1.5 5H10L8 8.6ZM15 4h3l5.5 16h-3L15 4Z"
                fill={color}
            />
        </Svg>
    );
}

// Google Gemini gem/spark
function GoogleIcon({ size = 16, color = "#4285F4" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 2c.4 5.3 4.7 9.6 10 10-5.3.4-9.6 4.7-10 10-.4-5.3-4.7-9.6-10-10 5.3-.4 9.6-4.7 10-10Z"
                fill={color}
            />
        </Svg>
    );
}

// xAI Grok — angular X
function XaiIcon({ size = 16, color = "#e6edf3" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M3 3h4l5 7 5-7h4l-7 10 7 11h-4l-5-8-5 8H3l7-11L3 3Z" fill={color} />
        </Svg>
    );
}

// Meta (infinity)
function MetaIcon({ size = 16, color = "#0668E1" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M6.2 6C3.9 6 2 8.4 2 11.3s1.9 5.3 4.2 5.3c1.6 0 2.8-1 4.4-3.2l1.1-1.5 1.1 1.5c1.6 2.2 2.8 3.2 4.4 3.2 2.3 0 4.2-2.4 4.2-5.3S19.5 6 17.2 6c-1.6 0-2.8 1-4.4 3.2l-1.1 1.5-1.1-1.5C9 7 7.8 6 6.2 6Zm0 2c.7 0 1.3.5 2.6 2.3L10 12l-1.2 1.7c-1.3 1.8-1.9 2.3-2.6 2.3-1.1 0-2-1.6-2-3.7s.9-3.7 2-3.7Zm11 0c1.1 0 2 1.6 2 3.7s-.9 3.7-2 3.7c-.7 0-1.3-.5-2.6-2.3L13.4 12l1.2-1.7c1.3-1.8 1.9-2.3 2.6-2.3Z"
                fill={color}
            />
        </Svg>
    );
}

// Mistral — simple stylized
function MistralIcon({ size = 16, color = "#FA520F" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M3 4h3v4h3V4h3v4h3V4h3v4h3v3h-3v3h3v3h-3v3h-3v-3h-3v3H9v-3H6v3H3v-3h3v-3H3v-3h3V8H3V4Z" fill={color} />
        </Svg>
    );
}

function GenericChipIcon({ size = 16, color = "#a371f7" }: Props) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M9 3h6v2h3v2h2v6h-2v3h-3v2h-2v2h-2v-2H9v-2H7v-3H5V9h2V7h2V5h3V3Zm0 4v2h6V7H9Zm0 4v2h6v-2H9Z"
                stroke={color}
                strokeWidth={1.5}
                fill="none"
            />
        </Svg>
    );
}

export function ProviderIcon({ provider = "copilot", size = 16, color }: Props) {
    switch (provider) {
        case "openai":
            return <OpenAIIcon size={size} color={color ?? "#e6edf3"} />;
        case "anthropic":
            return <AnthropicIcon size={size} color={color ?? "#da7756"} />;
        case "google":
            return <GoogleIcon size={size} color={color ?? "#4285F4"} />;
        case "xai":
            return <XaiIcon size={size} color={color ?? "#e6edf3"} />;
        case "meta":
            return <MetaIcon size={size} color={color ?? "#0668E1"} />;
        case "mistral":
            return <MistralIcon size={size} color={color ?? "#FA520F"} />;
        case "generic":
            return <GenericChipIcon size={size} color={color ?? "#a371f7"} />;
        case "copilot":
        default:
            return <CopilotIcon size={size} color={color ?? "#e6edf3"} />;
    }
}

// --- UI icons (SVG replacements for Feather) ---

export function PaperclipIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="m21 11-8.5 8.5a5 5 0 1 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 1 1-2.8-2.8L15 8"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function AgentIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M12 8V4H8" />
                <Path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                <Path d="M2 14h2" />
                <Path d="M20 14h2" />
                <Path d="M9 13v2" />
                <Path d="M15 13v2" />
            </G>
        </Svg>
    );
}

export function ArrowUpIcon({ size = 16, color = "#ffffff" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 19V5M5 12l7-7 7 7"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function ArrowLeftIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M19 12H5m0 0 6-6m-6 6 6 6"
                stroke={color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function ArrowRightIcon({ size = 16, color = "#ffffff" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M5 12h14m0 0-6-6m6 6-6 6"
                stroke={color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function DesktopIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Rect x="3" y="4" width="18" height="12" rx="2.5" />
                <Path d="M9 20h6" />
                <Path d="M12 16v4" />
            </G>
        </Svg>
    );
}

export function ScanIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M7 3H5a2 2 0 0 0-2 2v2" />
                <Path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <Path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <Path d="M17 21h2a2 2 0 0 0 2-2v-2" />
                <Path d="M8 8h1.5v8H8zM11.25 8h4.5M11.25 12h4.5M11.25 16h4.5" />
            </G>
        </Svg>
    );
}

export function BellIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3V9Z" />
                <Path d="M10 19a2 2 0 0 0 4 0" />
            </G>
        </Svg>
    );
}

export function CopyIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Rect x="9" y="8" width="11" height="12" rx="2.5" />
                <Path d="M15 8V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v9A2.5 2.5 0 0 0 6.5 18H9" />
            </G>
        </Svg>
    );
}

export function MicrophoneIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Rect x="9" y="3" width="6" height="11" rx="3" />
                <Path d="M6 11a6 6 0 0 0 12 0" />
                <Path d="M12 17v4" />
                <Path d="M8.5 21h7" />
            </G>
        </Svg>
    );
}

export function HashIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M9 3 7 21M17 3l-2 18M4 9h18M3 15h18"
                stroke={color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function AtIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M16 12.5v-1a4 4 0 1 0-1.2 2.9c.7.7 1.6 1.1 2.6 1.1 2.1 0 3.6-1.7 3.6-4.2A9 9 0 1 0 12 21"
                stroke={color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Circle cx="12" cy="11.5" r="2.3" stroke={color} strokeWidth={1.8} />
        </Svg>
    );
}

export function GitHubIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 2C6.48 2 2 6.58 2 12.24C2 16.76 4.87 20.59 8.84 21.94C9.34 22.03 9.52 21.72 9.52 21.46C9.52 21.22 9.51 20.44 9.5 19.41C6.73 20.03 6.14 18.19 6.14 18.19C5.68 16.98 5.03 16.66 5.03 16.66C4.12 16.02 5.1 16.04 5.1 16.04C6.11 16.11 6.64 17.11 6.64 17.11C7.53 18.69 8.97 18.23 9.54 17.95C9.63 17.28 9.89 16.82 10.18 16.56C7.97 16.3 5.65 15.42 5.65 11.48C5.65 10.36 6.04 9.45 6.68 8.72C6.58 8.45 6.23 7.35 6.78 5.86C6.78 5.86 7.62 5.58 9.5 6.89C10.3 6.66 11.15 6.54 12 6.54C12.85 6.54 13.7 6.66 14.5 6.89C16.38 5.58 17.22 5.86 17.22 5.86C17.77 7.35 17.42 8.45 17.32 8.72C17.96 9.45 18.35 10.36 18.35 11.48C18.35 15.43 16.02 16.3 13.81 16.56C14.17 16.89 14.5 17.54 14.5 18.54C14.5 19.96 14.49 21.11 14.49 21.46C14.49 21.72 14.67 22.04 15.18 21.94C19.14 20.58 22 16.76 22 12.24C22 6.58 17.52 2 12 2Z"
                fill={color}
            />
        </Svg>
    );
}

export function GitPullRequestIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Circle cx="6" cy="5" r="2" />
                <Circle cx="18" cy="7" r="2" />
                <Circle cx="18" cy="19" r="2" />
                <Path d="M6 7v10a4 4 0 0 0 4 4h6" />
                <Path d="M18 9v8" />
                <Path d="M10 7h6" />
            </G>
        </Svg>
    );
}

export function GitPushIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M12 20V6" />
                <Path d="m7 11 5-5 5 5" />
                <Path d="M5 20h14" />
            </G>
        </Svg>
    );
}

export function ChevronDownIcon({ size = 12, color = "#595B5B" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="m6 9 6 6 6-6"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function CheckIcon({ size = 14, color = "#3fb950" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="m5 12 5 5L20 7"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function PencilIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 20h9"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path
                d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
        </Svg>
    );
}

export function CloseIcon({ size = 16, color = "#595B5B" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M18 6 6 18M6 6l12 12" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </Svg>
    );
}

export function TrashIcon({ size = 14, color = "#f85149" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M3 6h18" />
                <Path d="M8 6V4h8v2" />
                <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <Path d="M10 11v6M14 11v6" />
            </G>
        </Svg>
    );
}

export function ArchiveIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
                <Path d="M23 3H1v5h22V3Z" />
                <Path d="M10 12h4" />
            </G>
        </Svg>
    );
}

export function SlidersIcon({ size = 15, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round">
                <Path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </G>
        </Svg>
    );
}

export function SettingsIcon({ size = 15, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path
                d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.1a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.1a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 0 1 0 4h-.1a1 1 0 0 0-.9.6Z"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function GitBranchIcon({ size = 13, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Circle cx="6" cy="3" r="2" />
                <Circle cx="6" cy="21" r="2" />
                <Circle cx="18" cy="9" r="2" />
                <Path d="M6 5v14M18 11c0 3-3 5-6 5h-1a4 4 0 0 0-4 4" />
            </G>
        </Svg>
    );
}

export function GitCommitIcon({ size = 13, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M12 5v3M12 16v3M8 12H5M19 12h-3M9 12h6" />
                <Circle cx="12" cy="12" r="3" />
            </G>
        </Svg>
    );
}

export function HistoryIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M3 12a9 9 0 1 0 3-6.7" />
                <Path d="M3 4v5h5" />
                <Path d="M12 7v5l3 2" />
            </G>
        </Svg>
    );
}

export function FolderIcon({ size = 17, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                fill="none"
            />
        </Svg>
    );
}

export function MoreVerticalIcon({ size = 17, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G fill={color}>
                <Circle cx="12" cy="5" r="1.8" />
                <Circle cx="12" cy="12" r="1.8" />
                <Circle cx="12" cy="19" r="1.8" />
            </G>
        </Svg>
    );
}

export function TerminalIcon({ size = 13, color = "#f78166" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="m5 8 4 4-4 4M12 18h7" />
            </G>
        </Svg>
    );
}

export function WrenchIcon({ size = 13, color = "#f78166" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M20 7a4 4 0 0 1-5 5l-7 7a2 2 0 0 1-3-3l7-7a4 4 0 0 1 5-5l-2 2 2 2 2 2 2-2Z"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                fill="none"
            />
        </Svg>
    );
}

export function CheckSquareIcon({ size = 13, color = "#f78166" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="m9 11 3 3 8-8" />
                <Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </G>
        </Svg>
    );
}

export function CodeIcon({ size = 13, color = "#f78166" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
            </G>
        </Svg>
    );
}

export function WifiOffIcon({ size = 24, color = "#595B5B" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M1 1l22 22M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5c4.1-.3 8.3 1 11.3 3.8M5 12.5a10 10 0 0 1 5.2-2.8M12 20h.01" />
            </G>
        </Svg>
    );
}

export function SparklesIcon({ size = 28, color = "#a371f7" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 2.5c.4 0 .8.3.9.7l.8 2.4c.3.9.9 1.6 1.8 1.9l2.4.8c.4.1.7.5.7.9s-.3.8-.7.9l-2.4.8c-.9.3-1.6 1-1.9 1.9l-.8 2.4c-.1.4-.5.7-.9.7s-.8-.3-.9-.7l-.8-2.4a2.6 2.6 0 0 0-1.9-1.9l-2.3-.8a1 1 0 0 1-.7-.9c0-.4.3-.8.7-.9l2.3-.8c.9-.3 1.6-1 1.9-1.9l.8-2.4c.2-.4.6-.7 1-.7Z"
                fill={color}
            />
            <Path
                d="M18.5 14.5c.3 0 .5.2.6.4l.4 1.2c.2.6.6 1 1.2 1.2l1.2.4c.2.1.4.3.4.6s-.2.5-.4.6l-1.2.4c-.6.2-1 .6-1.2 1.2l-.4 1.2c-.1.2-.3.4-.6.4s-.5-.2-.6-.4l-.4-1.2a1.8 1.8 0 0 0-1.2-1.2l-1.2-.4a.6.6 0 0 1-.4-.6c0-.3.2-.5.4-.6l1.2-.4c.6-.2 1-.6 1.2-1.2l.4-1.2c.1-.2.3-.4.6-.4Z"
                fill={color}
            />
        </Svg>
    );
}

export function BrainIcon({ size = 16, color = "#a371f7" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M12 18V5" />
                <Path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
                <Path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
                <Path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
                <Path d="M18 18a4 4 0 0 0 2-7.464" />
                <Path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
                <Path d="M6 18a4 4 0 0 1-2-7.464" />
                <Path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
            </G>
        </Svg>
    );
}

export function ChevronRightIcon({ size = 12, color = "#595B5B" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="m9 6 6 6-6 6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
    );
}

export function RefreshIcon({ size = 15, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <Path d="M21 3v5h-5" />
            </G>
        </Svg>
    );
}

export function ArrowDownIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M12 4v16m0 0 6-6m-6 6-6-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
    );
}

export function BracesIcon({ size = 16, color = "#d4a015" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M8 3c-2 0-3 1-3 3v3c0 1.5-.5 2-2 2v2c1.5 0 2 .5 2 2v3c0 2 1 3 3 3" />
                <Path d="M16 3c2 0 3 1 3 3v3c0 1.5.5 2 2 2v2c-1.5 0-2 .5-2 2v3c0 2-1 3-3 3" />
            </G>
        </Svg>
    );
}

export function MarkdownIcon({ size = 16, color = "#519aba" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
                stroke={color}
                strokeWidth={1.6}
                fill="none"
            />
            <G fill={color}>
                <Path d="M6 16V9l2.2 3.5L10.4 9v7H8.9v-4.2l-.7 1.2h-.4l-.7-1.2V16H6Z" />
                <Path d="M14.5 9h1.4v4.4h1.6L15.2 16l-2.3-2.6h1.6V9Z" />
            </G>
        </Svg>
    );
}

export function FileTextIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
                <Path d="M14 3v6h6" />
                <Path d="M8 13h8M8 17h8M8 9h2" />
            </G>
        </Svg>
    );
}

export function FolderFilledIcon({ size = 17, color = "#9ca3a1" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                fill={color}
                fillOpacity={0.22}
                stroke={color}
                strokeWidth={1.4}
                strokeLinejoin="round"
            />
        </Svg>
    );
}

// File-type inference — returns the right icon component based on extension.
// Used by the workspace panel so each row shows a meaningful glyph.
export function FileTypeIcon({ name, size = 16 }: { name: string; size?: number }) {
    const lower = name.toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
    if (ext === "json" || ext === "jsonc") return <BracesIcon size={size} color="#d4a015" />;
    if (ext === "md" || ext === "mdx" || ext === "markdown") return <MarkdownIcon size={size} color="#519aba" />;
    if (ext === "ts" || ext === "tsx") return <BracesIcon size={size} color="#3178c6" />;
    if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return <BracesIcon size={size} color="#e2b341" />;
    if (ext === "yaml" || ext === "yml") return <FileTextIcon size={size} color="#a0a3a2" />;
    if (ext === "lock" || lower === "pnpm-lock.yaml" || lower === "package-lock.json") {
        return <FileTextIcon size={size} color="#6f7170" />;
    }
    return <FileTextIcon size={size} color="#a0a3a2" />;
}

export function AlignLeftIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" fill="none">
                <Path d="M3 6h18M3 12h12M3 18h18M3 24" />
            </G>
        </Svg>
    );
}

export function DiffIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M12 3v4M10 5h4M12 17v4M10 19h4M4 9l4 3-4 3M20 9l-4 3 4 3" />
            </G>
        </Svg>
    );
}

export function ListTreeIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Path d="M3 6h10M7 12h10M11 18h10M3 6v12h4" />
            </G>
        </Svg>
    );
}

// ⊕ — circle with plus inside (Agent / Ask icon in VS Code Copilot)
export function CirclePlusIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" fill="none">
                <Circle cx="12" cy="12" r="9" />
                <Path d="M12 8v8M8 12h8" />
            </G>
        </Svg>
    );
}

// ≡ — three horizontal lines (Plan icon)
export function MenuListIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" fill="none">
                <Path d="M4 6h16M4 12h16M4 18h16" />
            </G>
        </Svg>
    );
}

// ? circle — Ask mode
export function HelpCircleIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <Circle cx="12" cy="12" r="9" />
                <Path d="M9 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
                <Circle cx="12" cy="17" r="0.5" fill={color} />
            </G>
        </Svg>
    );
}

// Shield outline — Default Approvals
export function ShieldIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 2L4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4Z"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                fill="none"
            />
        </Svg>
    );
}

// Shield with check — Bypass Approvals
export function ShieldCheckIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 2L4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4Z"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                fill="none"
            />
            <Path d="m9 12 2 2 4-4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}

// Zap / Flash — Autopilot
export function ZapIcon({ size = 14, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
        </Svg>
    );
}

export function PaletteIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M4 10.5V11a7 7 0 0 0 14 0v-.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M12 21v-8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M12 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M7.5 5.5l1.5 1.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M16.5 5.5l-1.5 1.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx="12" cy="13" r="1" fill={color} />
        </Svg>
    );
}

export function MoonIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}

export function SunIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M12 2v2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M12 20v2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M4.93 4.93l1.41 1.41" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M17.66 17.66l1.41 1.41" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M2 12h2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M20 12h2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M4.93 19.07l1.41-1.41" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M17.66 6.34l1.41-1.41" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}

export function SmartphoneIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Rect x="5" y="2" width="14" height="20" rx="2" ry="2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M12 18h.01" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}

export function BookOpenIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
    );
}


export function CircleIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="12" r="8" stroke={color} strokeWidth={2} />
        </Svg>
    );
}

export function TypeIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m4 7V4h16v3" />
                <Path d="M9 20h6" />
                <Path d="M12 4v16" />
            </G>
        </Svg>
    );
}

export function PaintbrushIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                <Path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
            </G>
        </Svg>
    );
}


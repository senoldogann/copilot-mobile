// Provider SVG icons — Copilot, OpenAI, Anthropic, Google, xAI, Meta
// Inline SVGs so no raster assets are needed.

import React from "react";
import Svg, { Path, Circle, G } from "react-native-svg";

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

// GitHub Copilot sparkles mark
function CopilotIcon({ size = 16, color = "#e6edf3" }: Props) {
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

export function MicIcon({ size = 16, color = "#a0a3a2" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z"
                fill={color}
            />
            <Path
                d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
            />
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

export function CloseIcon({ size = 16, color = "#595B5B" }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M18 6 6 18M6 6l12 12" stroke={color} strokeWidth={2} strokeLinecap="round" />
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

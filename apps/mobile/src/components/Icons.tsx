// Merkezi ikon kütüphanesi — @expo/vector-icons Feather + Ionicons

import React from "react";
import { Feather, Ionicons } from "@expo/vector-icons";
import Svg, { Path, Circle, Rect } from "react-native-svg";
import { colors } from "../theme/colors";
import { AgentIcon } from "./ProviderIcon";

export type FeatherName = React.ComponentProps<typeof Feather>["name"];
type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

export type AgentMode = "agent" | "plan" | "ask";

const SIZE_MAP: Record<IconSize, number> = {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 20,
};

export function FeatherIcon({
    name,
    size = "md",
    color = colors.textSecondary,
    px,
}: {
    name: FeatherName;
    size?: IconSize | number;
    color?: string;
    px?: number;
}) {
    const sz = typeof size === "number" ? size : SIZE_MAP[size];
    return <Feather name={name} size={px ?? sz} color={color} />;
}

export function IonIcon({
    name,
    size = "md",
    color = colors.textSecondary,
    px,
}: {
    name: IoniconsName;
    size?: IconSize | number;
    color?: string;
    px?: number;
}) {
    const sz = typeof size === "number" ? size : SIZE_MAP[size];
    return <Ionicons name={name} size={px ?? sz} color={color} />;
}

// ─── Custom SVG icons ────────────────────────────────────────────────────────

/** Bot kafası — subagent çağrısını temsil eder */
export function SubagentIcon({ size = 14, color = colors.textSecondary }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Rect x="4" y="7" width="16" height="12" rx="2.5" stroke={color} strokeWidth="1.5" />
            <Circle cx="9.5" cy="13" r="1.5" fill={color} />
            <Circle cx="14.5" cy="13" r="1.5" fill={color} />
            <Path d="M9.5 16.5h5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
            <Path d="M12 7V4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
            <Circle cx="12" cy="3.5" r="1.2" fill={color} />
        </Svg>
    );
}

/** Şimşek cıvatası — skill / yetenek çağrısını temsil eder */
export function SkillIcon({ size = 14, color = colors.textSecondary }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M13 2L3 14L12 14L11 22L21 10L12 10Z"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </Svg>
    );
}

/** Beyin — thinking / thought araçlarını temsil eder (sol: circuit, sağ: organik) */
export function BrainIcon({ size = 14, color = colors.textSecondary }: { size?: number; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            {/* Sağ lob dış kontur — organik kıvrımlı */}
            <Path
                d="M12 4.5C13.2 3.5 14.8 3 16.2 3.4C17.9 3.9 19.2 5.3 19.7 7C20.5 7.1 21.2 7.8 21.4 8.6C21.7 9.7 21.2 10.9 20.3 11.5C20.9 12.2 21.1 13.2 20.8 14.1C20.5 15 19.7 15.7 18.8 15.9C18.9 16.7 18.5 17.6 17.8 18.1C17.1 18.6 16.1 18.7 15.3 18.3C14.8 19.1 13.9 19.6 12.9 19.6C12.6 19.6 12.3 19.5 12 19.4"
                stroke={color}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Sağ lob iç kıvrımlar */}
            <Path
                d="M16 7.5C16.8 8 17.2 9 16.9 9.9"
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
            />
            <Path
                d="M17.5 12C17.8 12.6 17.6 13.4 17 13.8"
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
            />
            <Path
                d="M15 15.5C15.5 15.8 15.7 16.5 15.4 17"
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
            />
            {/* Sol lob dış kontur */}
            <Path
                d="M12 4.5C10.8 3.5 9.2 3 7.8 3.4C6.1 3.9 4.8 5.3 4.3 7C3.5 7.1 2.8 7.8 2.6 8.6C2.3 9.7 2.8 10.9 3.7 11.5C3.1 12.2 2.9 13.2 3.2 14.1C3.5 15 4.3 15.7 5.2 15.9C5.1 16.7 5.5 17.6 6.2 18.1C6.9 18.6 7.9 18.7 8.7 18.3C9.2 19.1 10.1 19.6 11.1 19.6C11.4 19.6 11.7 19.5 12 19.4"
                stroke={color}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Merkez çizgi */}
            <Path
                d="M12 4.5V19.4"
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeDasharray="1 2"
            />
            {/* Sol lob — circuit devre çizgileri */}
            <Path
                d="M9 8H7M7 8V11M7 11H5"
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path
                d="M9.5 11.5H7.5M7.5 11.5V13.5M7.5 13.5H6"
                stroke={color}
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Devre düğümleri (circle) */}
            <Circle cx="7" cy="8" r="0.9" fill={color} />
            <Circle cx="7" cy="11" r="0.9" fill={color} />
            <Circle cx="7.5" cy="13.5" r="0.9" fill={color} />
        </Svg>
    );
}

// ─── Tool-specific icons ──────────────────────────────────────────────────────

export function ToolIcon({ toolName, size = 12, color = colors.textTertiary }: { toolName: string; size?: number; color?: string }) {
    const lower = toolName.toLowerCase();
    if (lower === "task" || lower.includes("subagent")) {
        return <SubagentIcon size={size} color={color} />;
    }
    if (lower === "skill") {
        return <SkillIcon size={size} color={color} />;
    }
    if (lower.includes("shell") || lower.includes("bash") || lower.includes("terminal") || lower.includes("exec")) {
        return <Feather name="terminal" size={size} color={color} />;
    }
    if (lower.includes("read") || lower.includes("view") || lower.includes("file")) {
        return <Feather name="eye" size={size} color={color} />;
    }
    if (lower.includes("edit") || lower.includes("write") || lower.includes("create")) {
        return <Feather name="edit-2" size={size} color={color} />;
    }
    if (lower.includes("grep") || lower.includes("search") || lower.includes("find") || lower.includes("glob")) {
        return <Feather name="search" size={size} color={color} />;
    }
    if (lower.includes("think") || lower.includes("thought")) {
        return <BrainIcon size={size} color={color} />;
    }
    if (lower.includes("web") || lower.includes("fetch") || lower.includes("browse")) {
        return <Feather name="globe" size={size} color={color} />;
    }
    if (lower.includes("git")) {
        return <Feather name="git-branch" size={size} color={color} />;
    }
    return <Feather name="tool" size={size} color={color} />;
}

// Mode icons for Agent/Plan/Ask
export function AgentModeIcon({ mode, size = 14, color = colors.textSecondary }: { mode: AgentMode; size?: number; color?: string }) {
    switch (mode) {
        case "agent":
            return <AgentIcon size={size} color={color} />;
        case "plan":
            return <Feather name="list" size={size} color={color} />;
        case "ask":
            return <Feather name="help-circle" size={size} color={color} />;
    }
}

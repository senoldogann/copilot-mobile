// Merkezi ikon kütüphanesi — @expo/vector-icons Feather + Ionicons

import React from "react";
import { Feather, Ionicons } from "@expo/vector-icons";
import Svg, { Path, Circle, Rect, G } from "react-native-svg";
import type { ReasoningEffortLevel } from "@copilot-mobile/shared";
import { useAppTheme } from "../theme/theme-context";
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
    color,
    px,
}: {
    name: FeatherName;
    size?: IconSize | number;
    color?: string;
    px?: number;
}) {
    const theme = useAppTheme();
    const sz = typeof size === "number" ? size : SIZE_MAP[size];
    return <Feather name={name} size={px ?? sz} color={color ?? theme.colors.textSecondary} />;
}

export function IonIcon({
    name,
    size = "md",
    color,
    px,
}: {
    name: IoniconsName;
    size?: IconSize | number;
    color?: string;
    px?: number;
}) {
    const theme = useAppTheme();
    const sz = typeof size === "number" ? size : SIZE_MAP[size];
    return <Ionicons name={name} size={px ?? sz} color={color ?? theme.colors.textSecondary} />;
}

// ─── Custom SVG icons ────────────────────────────────────────────────────────

/** Bot kafası — subagent çağrısını temsil eder */
export function SubagentIcon({ size = 14, color }: { size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Rect x="4" y="7" width="16" height="12" rx="2.5" stroke={resolvedColor} strokeWidth="1.5" />
            <Circle cx="9.5" cy="13" r="1.5" fill={resolvedColor} />
            <Circle cx="14.5" cy="13" r="1.5" fill={resolvedColor} />
            <Path d="M9.5 16.5h5" stroke={resolvedColor} strokeWidth="1.2" strokeLinecap="round" />
            <Path d="M12 7V4.5" stroke={resolvedColor} strokeWidth="1.5" strokeLinecap="round" />
            <Circle cx="12" cy="3.5" r="1.2" fill={resolvedColor} />
        </Svg>
    );
}

/** Şimşek cıvatası — skill / yetenek çağrısını temsil eder */
export function SkillIcon({ size = 14, color }: { size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M13 2L3 14L12 14L11 22L21 10L12 10Z"
                stroke={resolvedColor}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </Svg>
    );
}

export function PluginIcon({ size = 14, color }: { size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M9 5.5A2.5 2.5 0 1 1 14 5.5V8H16.5A2.5 2.5 0 1 1 16.5 13H14V16.5A2.5 2.5 0 1 1 9 16.5V13H6.5A2.5 2.5 0 1 1 6.5 8H9V5.5Z"
                stroke={resolvedColor}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
}

export function McpIcon({ size = 14, color }: { size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Rect x="4" y="5" width="6" height="6" rx="1.5" stroke={resolvedColor} strokeWidth="1.5" />
            <Rect x="14" y="5" width="6" height="6" rx="1.5" stroke={resolvedColor} strokeWidth="1.5" />
            <Rect x="9" y="14" width="6" height="6" rx="1.5" stroke={resolvedColor} strokeWidth="1.5" />
            <Path d="M10 8H14" stroke={resolvedColor} strokeWidth="1.5" strokeLinecap="round" />
            <Path d="M7 11V14" stroke={resolvedColor} strokeWidth="1.5" strokeLinecap="round" />
            <Path d="M17 11V14" stroke={resolvedColor} strokeWidth="1.5" strokeLinecap="round" />
            <Path d="M7 14H17" stroke={resolvedColor} strokeWidth="1.5" strokeLinecap="round" />
        </Svg>
    );
}

/** Beyin — thinking / thought araçlarını temsil eder (Lucide brain) */
export function BrainIcon({ size = 14, color }: { size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <G stroke={resolvedColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
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

// ─── Tool-specific icons ──────────────────────────────────────────────────────

export function ToolIcon({ toolName, size = 12, color }: { toolName: string; size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textTertiary;
    const lower = toolName.toLowerCase();
    if (lower === "task" || lower.includes("subagent")) {
        return <SubagentIcon size={size} color={resolvedColor} />;
    }
    if (lower === "skill") {
        return <SkillIcon size={size} color={resolvedColor} />;
    }
    if (lower.includes("shell") || lower.includes("bash") || lower.includes("terminal") || lower.includes("exec")) {
        return <Feather name="terminal" size={size} color={resolvedColor} />;
    }
    if (lower.includes("read") || lower.includes("view") || lower.includes("file")) {
        return <Feather name="eye" size={size} color={resolvedColor} />;
    }
    if (lower.includes("edit") || lower.includes("write") || lower.includes("create")) {
        return <Feather name="edit-2" size={size} color={resolvedColor} />;
    }
    if (lower.includes("grep") || lower.includes("search") || lower.includes("find") || lower.includes("glob")) {
        return <Feather name="search" size={size} color={resolvedColor} />;
    }
    if (lower.includes("think") || lower.includes("thought")) {
        return <BrainIcon size={size} color={resolvedColor} />;
    }
    if (lower.includes("web") || lower.includes("fetch") || lower.includes("browse")) {
        return <Feather name="globe" size={size} color={resolvedColor} />;
    }
    if (lower.includes("git")) {
        return <Feather name="git-branch" size={size} color={resolvedColor} />;
    }
    return <Feather name="tool" size={size} color={resolvedColor} />;
}

// Mode icons for Agent/Plan/Ask
export function AgentModeIcon({ mode, size = 14, color }: { mode: AgentMode; size?: number; color?: string }) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    switch (mode) {
        case "agent":
            return <AgentIcon size={size} color={resolvedColor} />;
        case "plan":
            return <Feather name="list" size={size} color={resolvedColor} />;
        case "ask":
            return <Feather name="help-circle" size={size} color={resolvedColor} />;
    }
}

export function ReasoningEffortIcon({
    level,
    size = 16,
    color,
}: {
    level: ReasoningEffortLevel;
    size?: number;
    color?: string;
}) {
    const theme = useAppTheme();
    const resolvedColor = color ?? theme.colors.textSecondary;
    const barWidth = 3;
    const barGap = 2;
    const startX = 5;

    const heights: Record<ReasoningEffortLevel, ReadonlyArray<number>> = {
        low: [6],
        medium: [6, 10],
        high: [6, 10, 14],
        xhigh: [6, 10, 14, 18],
    };

    const bars = heights[level];

    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path
                d="M4 19.5h16"
                stroke={resolvedColor}
                strokeWidth={1.6}
                strokeLinecap="round"
                opacity={0.45}
            />
            {bars.map((height, index) => {
                const x = startX + index * (barWidth + barGap);
                const y = 19 - height;

                return (
                    <Rect
                        key={`${level}:${height}:${index}`}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={height}
                        rx={1.2}
                        fill={resolvedColor}
                    />
                );
            })}
        </Svg>
    );
}

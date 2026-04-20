// Merkezi ikon kütüphanesi — @expo/vector-icons Feather + Ionicons

import React from "react";
import { Feather, Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

export type AgentMode = "agent" | "plan" | "autopilot";

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

// Tool-specific icons
export function ToolIcon({ toolName, size = 12, color = colors.textTertiary }: { toolName: string; size?: number; color?: string }) {
    const lower = toolName.toLowerCase();
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
    if (lower.includes("think")) {
        return <Feather name="cpu" size={size} color={color} />;
    }
    if (lower.includes("web") || lower.includes("fetch") || lower.includes("browse")) {
        return <Feather name="globe" size={size} color={color} />;
    }
    if (lower.includes("git")) {
        return <Feather name="git-branch" size={size} color={color} />;
    }
    return <Feather name="tool" size={size} color={color} />;
}

// Mode icons for Agent/Plan/Autopilot
export function AgentModeIcon({ mode, size = 14, color = colors.textSecondary }: { mode: AgentMode; size?: number; color?: string }) {
    switch (mode) {
        case "agent":
            return <Ionicons name="shield" size={size} color={color} />;
        case "plan":
            return <Ionicons name="shield-checkmark" size={size} color={color} />;
        case "autopilot":
            return <Ionicons name="shield-half" size={size} color={color} />;
    }
}

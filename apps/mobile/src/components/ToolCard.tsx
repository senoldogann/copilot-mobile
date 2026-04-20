// Araç yürütme kartı — kompakt tek satır terminal stili ile SVG ikonlar

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ToolItem } from "../stores/session-store";
import { BottomSheet } from "./BottomSheet";
import { ToolIcon } from "./Icons";
import type { FeatherName } from "./Icons";
import { colors, spacing, fontSize } from "../theme/colors";

type Props = {
    item: ToolItem;
};

// Araç tipinin kısa etiketi
function getToolLabel(toolName: string): string {
    const lower = toolName.toLowerCase();
    if (lower.includes("shell") || lower.includes("bash") || lower.includes("exec")) return "Shell";
    if (lower.includes("read") || lower.includes("view")) return "View";
    if (lower.includes("edit")) return "Edit";
    if (lower.includes("write")) return "Write";
    if (lower.includes("create")) return "Create";
    if (lower.includes("grep") || lower.includes("search")) return "Search";
    if (lower.includes("glob") || lower.includes("find")) return "Find";
    if (lower.includes("think")) return "Thought";
    if (lower.includes("web") || lower.includes("fetch")) return "Fetch";
    if (lower.includes("git")) return "Git";
    return toolName
        .replace(/[_-]/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
        .split(" ")[0] ?? toolName;
}

// Returns the Feather icon name for a given tool
function getToolIconName(toolName: string): FeatherName {
    const lower = toolName.toLowerCase();
    if (lower.includes("shell") || lower.includes("bash") || lower.includes("exec")) return "terminal";
    if (lower.includes("read") || lower.includes("view")) return "eye";
    if (lower.includes("edit")) return "edit-2";
    if (lower.includes("write") || lower.includes("create")) return "file-plus";
    if (lower.includes("grep") || lower.includes("search") || lower.includes("find") || lower.includes("glob")) return "search";
    if (lower.includes("think")) return "cpu";
    if (lower.includes("web") || lower.includes("fetch")) return "globe";
    if (lower.includes("git")) return "git-branch";
    return "tool";
}

// argumentsText'ten gösterilecek kısa metni çıkar
function extractDisplayArg(item: ToolItem): string | null {
    if (item.argumentsText === undefined) return null;
    try {
        const parsed: unknown = JSON.parse(item.argumentsText);
        if (parsed !== null && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            for (const key of ["command", "path", "file", "query", "content", "description"]) {
                if (typeof obj[key] === "string" && (obj[key] as string).length > 0) {
                    return obj[key] as string;
                }
            }
            const firstStr = Object.values(obj).find((v) => typeof v === "string" && (v as string).length > 0);
            if (typeof firstStr === "string") return firstStr;
        }
    } catch {
        // Not JSON
    }
    return item.argumentsText;
}

// Extract the shell command from argumentsText
function extractCommand(item: ToolItem): string | null {
    if (item.argumentsText === undefined) return null;
    try {
        const parsed: unknown = JSON.parse(item.argumentsText);
        if (parsed !== null && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj["command"] === "string") return obj["command"] as string;
        }
    } catch {
        // Not JSON
    }
    return null;
}

// Dönen animasyon — çalışırken
function ToolSpinner() {
    const spinAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        const loop = Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                duration: 900,
                useNativeDriver: true,
            })
        );
        loop.start();
        return () => loop.stop();
    }, [spinAnim]);

    const rotation = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "360deg"],
    });

    return (
        <Animated.View style={[spinnerStyles.ring, { transform: [{ rotate: rotation }] }]} />
    );
}

// Terminal-style output block for shell commands
function TerminalBlock({ command, output }: { command: string | null; output: string | undefined }) {
    return (
        <View style={terminalStyles.container}>
            {command !== null && (
                <View style={terminalStyles.promptRow}>
                    <Text style={terminalStyles.prompt}>$</Text>
                    <Text style={terminalStyles.command} selectable>{command}</Text>
                </View>
            )}
            {output !== undefined && output.trim().length > 0 && (
                <View style={terminalStyles.outputBlock}>
                    {output.trim().split("\n").map((line, i) => (
                        <Text key={i} style={terminalStyles.outputLine} selectable>
                            {"> "}{line}
                        </Text>
                    ))}
                </View>
            )}
        </View>
    );
}

// Generic detail block (non-shell)
function DetailSection({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={[styles.detailBlockValue, mono === true && styles.detailMono]} selectable>
                {value}
            </Text>
        </View>
    );
}

function ToolCardComponent({ item }: Props) {
    const [showSheet, setShowSheet] = useState(false);
    const isRunning = item.status === "running";
    const isFailed = item.status === "failed";
    const label = getToolLabel(item.toolName);
    const iconName = getToolIconName(item.toolName);

    const lower = item.toolName.toLowerCase();
    const isShell = lower.includes("shell") || lower.includes("bash") || lower.includes("exec");

    const displayArg = extractDisplayArg(item)
        ?? item.progressMessage
        ?? (item.partialOutput !== undefined && item.partialOutput.trim().length > 0
            ? "Streaming output…"
            : isRunning
                ? "Running…"
                : isFailed
                    ? "Failed"
                    : "Completed");

    const command = extractCommand(item);
    const statusText = isRunning ? "running" : isFailed ? "failed" : "completed";

    return (
        <>
            <Pressable
                style={styles.row}
                onPress={() => setShowSheet(true)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
                {/* SVG ikon kutusu */}
                <View style={[styles.iconBox, isFailed && styles.iconBoxFailed]}>
                    {isRunning ? (
                        <ToolSpinner />
                    ) : (
                        <ToolIcon
                            toolName={item.toolName}
                            size={11}
                            color={isFailed ? colors.error : colors.textTertiary}
                        />
                    )}
                </View>

                {/* Kısa araç tipi etiketi */}
                <Text style={[styles.label, isFailed && styles.labelFailed]} numberOfLines={1}>
                    {label}
                </Text>

                {/* Argüman / komut metni */}
                <Text style={styles.argText} numberOfLines={1}>
                    {displayArg}
                </Text>

                <Feather name="chevron-right" size={12} color={colors.textTertiary} />
            </Pressable>

            <BottomSheet
                visible={showSheet}
                onClose={() => setShowSheet(false)}
                iconName={iconName}
                title={label}
                subtitle={statusText}
            >
                {isShell ? (
                    /* Terminal-style output for shell commands */
                    <View style={styles.detailContainer}>
                        <TerminalBlock
                            command={command ?? displayArg}
                            output={item.partialOutput ?? item.progressMessage}
                        />
                        {item.argumentsText !== undefined && command === null && (
                            <DetailSection label="Arguments" value={item.argumentsText} mono />
                        )}
                    </View>
                ) : (
                    /* Generic detail view for non-shell tools */
                    <View style={styles.detailContainer}>
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Tool</Text>
                            <Text style={styles.detailValue}>{item.toolName}</Text>
                        </View>
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Status</Text>
                            <Text style={[
                                styles.detailValue,
                                isFailed && { color: colors.error },
                                !isFailed && !isRunning && { color: colors.success },
                            ]}>
                                {statusText}
                            </Text>
                        </View>
                        {item.argumentsText !== undefined && (
                            <DetailSection label="Arguments" value={item.argumentsText} mono />
                        )}
                        {item.progressMessage !== undefined && (
                            <DetailSection label="Progress" value={item.progressMessage} />
                        )}
                        {item.partialOutput !== undefined && item.partialOutput.trim().length > 0 && (
                            <DetailSection label="Output" value={item.partialOutput} mono />
                        )}
                    </View>
                )}
            </BottomSheet>
        </>
    );
}

export const ToolCard = React.memo(ToolCardComponent);

const spinnerStyles = StyleSheet.create({
    ring: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: "transparent",
        borderTopColor: colors.accent,
        borderRightColor: colors.accentMuted,
    },
});

const terminalStyles = StyleSheet.create({
    container: {
        backgroundColor: "#0d1117",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        gap: 6,
    },
    promptRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    prompt: {
        color: colors.success,
        fontFamily: "monospace",
        fontSize: fontSize.sm,
        lineHeight: 18,
        fontWeight: "700",
    },
    command: {
        flex: 1,
        color: colors.textPrimary,
        fontFamily: "monospace",
        fontSize: fontSize.sm,
        lineHeight: 18,
    },
    outputBlock: {
        marginTop: 4,
        gap: 2,
    },
    outputLine: {
        color: colors.textSecondary,
        fontFamily: "monospace",
        fontSize: fontSize.xs,
        lineHeight: 16,
    },
});

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 5,
        paddingHorizontal: spacing.lg,
        marginLeft: 40,
        gap: 6,
        minHeight: 28,
    },
    iconBox: {
        width: 20,
        height: 20,
        borderRadius: 5,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
    iconBoxFailed: {
        borderColor: colors.errorMuted,
        backgroundColor: colors.errorMuted,
    },
    label: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        fontWeight: "500",
        flexShrink: 0,
        minWidth: 36,
    },
    labelFailed: {
        color: colors.error,
    },
    argText: {
        flex: 1,
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        fontFamily: "monospace",
    },
    detailContainer: {
        gap: spacing.md,
    },
    detailRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    detailBlock: {
        gap: spacing.xs,
    },
    detailLabel: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        fontWeight: "600",
    },
    detailValue: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        fontWeight: "500",
        maxWidth: "60%",
        textAlign: "right",
    },
    detailMono: {
        fontFamily: "monospace",
        fontSize: fontSize.xs,
    },
    detailBlockValue: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        lineHeight: 18,
    },
});


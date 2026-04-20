// Araç yürütme kartı — kompakt tek satır "👁 Read filename" + detay için bottom sheet

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import type { ToolItem } from "../stores/session-store";
import { BottomSheet } from "./BottomSheet";
import { colors, spacing, fontSize } from "../theme/colors";

type Props = {
    item: ToolItem;
};

// Araç adına göre ikon eşleme
function getToolIcon(toolName: string): string {
    const lower = toolName.toLowerCase();
    if (lower.includes("read") || lower.includes("view") || lower.includes("file")) return "👁";
    if (lower.includes("edit") || lower.includes("write") || lower.includes("create")) return "✏️";
    if (lower.includes("shell") || lower.includes("bash") || lower.includes("terminal") || lower.includes("exec")) return "⚡";
    if (lower.includes("search") || lower.includes("grep") || lower.includes("find") || lower.includes("glob")) return "🔍";
    if (lower.includes("think")) return "🧠";
    if (lower.includes("web") || lower.includes("fetch") || lower.includes("browse")) return "🌐";
    if (lower.includes("git")) return "📦";
    return "🔧";
}

// Araç adından okunabilir etiket üret
function formatToolLabel(toolName: string): string {
    return toolName
        .replace(/[_-]/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (char) => char.toUpperCase());
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

function ToolCardComponent({ item }: Props) {
    const [showSheet, setShowSheet] = useState(false);
    const isRunning = item.status === "running";
    const isFailed = item.status === "failed";
    const icon = getToolIcon(item.toolName);
    const label = formatToolLabel(item.toolName);
    const subtitle = item.progressMessage
        ?? (item.partialOutput !== undefined && item.partialOutput.trim().length > 0
            ? "Streaming output…"
            : isRunning
                ? "Running…"
                : isFailed
                    ? "Failed"
                    : "Completed");

    return (
        <>
            <Pressable
                style={styles.row}
                onPress={() => setShowSheet(true)}
            >
                <View style={styles.iconContainer}>
                    {isRunning ? (
                        <ToolSpinner />
                    ) : (
                        <Text style={styles.icon}>{icon}</Text>
                    )}
                </View>
                <View style={styles.textContainer}>
                    <Text
                        style={[styles.label, isFailed && styles.labelFailed]}
                        numberOfLines={1}
                    >
                        {label}
                    </Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                        {subtitle}
                    </Text>
                </View>
                {isFailed && (
                    <View style={styles.failBadge}>
                        <Text style={styles.failBadgeText}>failed</Text>
                    </View>
                )}
                <Text style={styles.chevron}>›</Text>
            </Pressable>

            <BottomSheet
                visible={showSheet}
                onClose={() => setShowSheet(false)}
                icon={icon}
                title={label}
                subtitle={subtitle}
            >
                <View style={styles.detailContainer}>
                    <DetailRow label="Tool" value={item.toolName} />
                    <DetailRow
                        label="Status"
                        value={isRunning ? "running" : isFailed ? "failed" : "completed"}
                        valueColor={isFailed ? colors.error : colors.textSecondary}
                    />
                    <DetailRow
                        label="Request ID"
                        value={item.requestId}
                        mono
                    />
                    {item.argumentsText !== undefined && (
                        <DetailBlock label="Arguments" value={item.argumentsText} mono />
                    )}
                    {item.progressMessage !== undefined && (
                        <DetailBlock label="Progress" value={item.progressMessage} />
                    )}
                    {item.partialOutput !== undefined && item.partialOutput.trim().length > 0 && (
                        <DetailBlock label="Live Output" value={item.partialOutput} mono />
                    )}
                </View>
            </BottomSheet>
        </>
    );
}

function DetailRow({
    label,
    value,
    mono,
    valueColor,
}: {
    label: string;
    value: string;
    mono?: boolean;
    valueColor?: string;
}) {
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text
                style={[
                    styles.detailValue,
                    mono === true && styles.detailMono,
                    valueColor !== undefined && { color: valueColor },
                ]}
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}

function DetailBlock({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={[styles.detailBlockValue, mono === true && styles.detailMono]}>
                {value}
            </Text>
        </View>
    );
}

export const ToolCard = React.memo(ToolCardComponent);

const spinnerStyles = StyleSheet.create({
    ring: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: "transparent",
        borderTopColor: colors.accent,
        borderRightColor: colors.accentMuted,
    },
});

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        paddingHorizontal: spacing.lg,
        marginLeft: 40,
        gap: spacing.sm,
    },
    iconContainer: {
        width: 18,
        height: 18,
        justifyContent: "center",
        alignItems: "center",
    },
    icon: {
        fontSize: 13,
    },
    label: {
        fontSize: fontSize.md,
        color: colors.textSecondary,
        fontWeight: "400",
    },
    textContainer: {
        flex: 1,
        gap: 2,
    },
    subtitle: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    labelFailed: {
        color: colors.error,
    },
    failBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: colors.errorMuted,
    },
    failBadgeText: {
        fontSize: fontSize.xs,
        color: colors.error,
        fontWeight: "500",
    },
    chevron: {
        fontSize: fontSize.base,
        color: colors.textTertiary,
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

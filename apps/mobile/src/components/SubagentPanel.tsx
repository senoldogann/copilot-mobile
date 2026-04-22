import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SubagentIcon } from "./Icons";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";

export type SubagentRun = {
    requestId: string;
    title: string;
    status: "running" | "completed" | "failed";
};

type SubagentPanelProps = {
    runs: ReadonlyArray<SubagentRun>;
};

function SubagentStatusIcon({ status }: { status: SubagentRun["status"] }) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);

    if (status === "completed") {
        return (
            <View style={[styles.statusIcon, styles.statusIconCompleted]}>
                <Text style={styles.checkmark}>✓</Text>
            </View>
        );
    }

    if (status === "failed") {
        return (
            <View style={[styles.statusIcon, styles.statusIconFailed]}>
                <Text style={styles.failedMark}>×</Text>
            </View>
        );
    }

    return (
        <View style={[styles.statusIcon, styles.statusIconRunning]}>
            <View style={[styles.runningDot, { backgroundColor: theme.colors.textOnAccent }]} />
        </View>
    );
}

function areSubagentRunsEqual(
    left: ReadonlyArray<SubagentRun>,
    right: ReadonlyArray<SubagentRun>
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((run, index) => {
        const candidate = right[index];
        return candidate !== undefined
            && candidate.requestId === run.requestId
            && candidate.title === run.title
            && candidate.status === run.status;
    });
}

function SubagentPanelInner({ runs }: SubagentPanelProps) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const [expanded, setExpanded] = useState(false);

    if (runs.length === 0) {
        return null;
    }

    const completedCount = runs.filter((run) => run.status === "completed").length;
    const runningCount = runs.filter((run) => run.status === "running").length;

    return (
        <View style={styles.container}>
            <Pressable
                style={styles.header}
                onPress={() => setExpanded((value) => !value)}
                accessibilityLabel={expanded ? "Hide subagents" : "Show subagents"}
            >
                <View style={styles.headerLeft}>
                    <View style={styles.iconWrap}>
                        <SubagentIcon size={14} color={theme.colors.textLink} />
                    </View>
                    <Text style={styles.headerTitle}>Subagents</Text>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{runs.length}</Text>
                    </View>
                    {completedCount > 0 && (
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>{completedCount} done</Text>
                        </View>
                    )}
                    {runningCount > 0 && (
                        <View style={[styles.badge, styles.runningBadge]}>
                            <Text style={[styles.badgeText, styles.runningBadgeText]}>
                                {runningCount} running
                            </Text>
                        </View>
                    )}
                </View>
                <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>
            </Pressable>

            {expanded && (
                <ScrollView
                    style={styles.listScroll}
                    contentContainerStyle={styles.list}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                >
                    {runs.map((run, index) => (
                        <View
                            key={run.requestId}
                            style={[
                                styles.item,
                                index < runs.length - 1 && styles.itemBorder,
                            ]}
                        >
                            <SubagentStatusIcon status={run.status} />
                            <View style={styles.itemContent}>
                                <Text style={styles.itemTitle} numberOfLines={1}>
                                    {run.title}
                                </Text>
                                <Text style={styles.itemMeta}>
                                    {run.status === "running"
                                        ? "Running"
                                        : run.status === "failed"
                                            ? "Failed"
                                            : "Completed"}
                                </Text>
                            </View>
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

export const SubagentPanel = React.memo(
    SubagentPanelInner,
    (previousProps, nextProps) => areSubagentRunsEqual(previousProps.runs, nextProps.runs)
);

const createStyles = (theme: AppTheme) => StyleSheet.create({
    container: {
        marginHorizontal: theme.spacing.md,
        marginBottom: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: theme.colors.bgSecondary,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flex: 1,
    },
    iconWrap: {
        width: 18,
        height: 18,
        borderWidth: 1.5,
        borderColor: theme.colors.textLink,
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.textLink + "10",
    },
    headerTitle: {
        fontSize: 13,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: theme.colors.textLink + "22",
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "600",
        color: theme.colors.textLink,
    },
    runningBadge: {
        backgroundColor: theme.colors.warning + "20",
    },
    runningBadgeText: {
        color: theme.colors.warning,
    },
    chevron: {
        fontSize: 14,
        marginLeft: 8,
        color: theme.colors.textSecondary,
    },
    listScroll: {
        maxHeight: 208,
    },
    list: {
        paddingHorizontal: 12,
        paddingBottom: 6,
    },
    item: {
        flexDirection: "row",
        alignItems: "flex-start",
        paddingVertical: 6,
        gap: 10,
    },
    itemBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
    },
    statusIcon: {
        width: 18,
        height: 18,
        borderWidth: 1.5,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 1,
        flexShrink: 0,
    },
    statusIconCompleted: {
        backgroundColor: theme.colors.success,
        borderColor: theme.colors.success,
    },
    statusIconFailed: {
        backgroundColor: theme.colors.error,
        borderColor: theme.colors.error,
    },
    statusIconRunning: {
        backgroundColor: theme.colors.textLink,
        borderColor: theme.colors.textLink,
    },
    runningDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    checkmark: {
        color: theme.colors.textOnAccent,
        fontSize: 11,
        fontWeight: "700",
        lineHeight: 14,
    },
    failedMark: {
        color: theme.colors.textOnAccent,
        fontSize: 11,
        fontWeight: "700",
        lineHeight: 14,
    },
    itemContent: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textPrimary,
    },
    itemMeta: {
        marginTop: 1,
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
});

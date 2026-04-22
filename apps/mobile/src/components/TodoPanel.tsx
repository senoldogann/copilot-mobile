import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { AgentTodo } from "../stores/session-store-types";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";

interface TodoPanelProps {
    todos: ReadonlyArray<AgentTodo>;
}

function TodoStatusIcon({ status }: { status: AgentTodo["status"] }) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    if (status === "completed") {
        return (
            <View style={[styles.statusIcon, { backgroundColor: theme.colors.success, borderColor: theme.colors.success }]}>
                <Text style={styles.checkmark}>✓</Text>
            </View>
        );
    }
    if (status === "in_progress") {
        return (
            <View style={[styles.statusIcon, { backgroundColor: theme.colors.textLink, borderColor: theme.colors.textLink }]}>
                <View style={styles.dotInner} />
            </View>
        );
    }
    // pending
    return (
        <View style={[styles.statusIcon, { backgroundColor: "transparent", borderColor: theme.colors.border }]} />
    );
}

export function TodoPanel({ todos }: TodoPanelProps) {
    const styles = useThemedStyles(createStyles);
    const [expanded, setExpanded] = useState(true);

    if (todos.length === 0) return null;

    const completedCount = todos.filter((t) => t.status === "completed").length;
    const inProgressCount = todos.filter((t) => t.status === "in_progress").length;

    return (
        <View style={styles.container}>
            <Pressable
                style={styles.header}
                onPress={() => setExpanded((v) => !v)}
                accessibilityLabel={expanded ? "Todo listesini gizle" : "Todo listesini göster"}
            >
                <View style={styles.headerLeft}>
                    <View style={styles.taskIcon}>
                        <Text style={styles.taskIconText}>≡</Text>
                    </View>
                    <Text style={styles.headerTitle}>Yapılacaklar</Text>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                            {completedCount}/{todos.length}
                        </Text>
                    </View>
                    {inProgressCount > 0 && (
                        <View style={[styles.badge, styles.badgeWarning]}>
                            <Text style={[styles.badgeText, styles.badgeWarningText]}>
                                {inProgressCount} aktif
                            </Text>
                        </View>
                    )}
                </View>
                <Text style={styles.chevron}>
                    {expanded ? "▾" : "▸"}
                </Text>
            </Pressable>

            {expanded && (
                <View style={styles.list}>
                    {todos.map((todo, index) => (
                        <View
                            key={todo.id}
                            style={[
                                styles.item,
                                index < todos.length - 1 && styles.itemBorder,
                            ]}
                        >
                            <TodoStatusIcon status={todo.status} />
                            <View style={styles.itemContent}>
                                <Text
                                    style={[
                                        styles.itemText,
                                        todo.status === "completed" && styles.itemTextCompleted,
                                        todo.status === "completed" && styles.strikethrough,
                                    ]}
                                    numberOfLines={2}
                                >
                                    {todo.content}
                                </Text>
                                {todo.priority === "high" && (
                                    <Text style={styles.priorityTag}>yüksek öncelik</Text>
                                )}
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

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
    taskIcon: {
        width: 18,
        height: 18,
        borderWidth: 1.5,
        borderColor: theme.colors.textLink,
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
    },
    taskIconText: {
        fontSize: 11,
        fontWeight: "600",
        color: theme.colors.textLink,
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
    badgeWarning: {
        marginLeft: 4,
        backgroundColor: theme.colors.warning + "22",
    },
    badgeWarningText: {
        color: theme.colors.warning,
    },
    chevron: {
        fontSize: 14,
        marginLeft: 8,
        color: theme.colors.textSecondary,
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
    dotInner: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#fff",
    },
    checkmark: {
        color: "#fff",
        fontSize: 11,
        fontWeight: "700",
        lineHeight: 14,
    },
    itemContent: {
        flex: 1,
    },
    itemText: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textPrimary,
    },
    itemTextCompleted: {
        color: theme.colors.textSecondary,
    },
    strikethrough: {
        textDecorationLine: "line-through",
    },
    priorityTag: {
        fontSize: 10,
        fontWeight: "600",
        marginTop: 2,
        color: theme.colors.error,
    },
});

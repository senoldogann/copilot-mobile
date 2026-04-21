import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, spacing } from "../theme/colors";
import type { AgentTodo } from "../stores/session-store";

interface TodoPanelProps {
    todos: ReadonlyArray<AgentTodo>;
}

function TodoStatusIcon({ status }: { status: AgentTodo["status"] }) {
    if (status === "completed") {
        return (
            <View style={[styles.statusIcon, { backgroundColor: colors.success, borderColor: colors.success }]}>
                <Text style={styles.checkmark}>✓</Text>
            </View>
        );
    }
    if (status === "in_progress") {
        return (
            <View style={[styles.statusIcon, { backgroundColor: colors.textLink, borderColor: colors.textLink }]}>
                <View style={styles.dotInner} />
            </View>
        );
    }
    // pending
    return (
        <View style={[styles.statusIcon, { backgroundColor: "transparent", borderColor: colors.border }]} />
    );
}

export function TodoPanel({ todos }: TodoPanelProps) {
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

const styles = StyleSheet.create({
    container: {
        marginHorizontal: spacing.md,
        marginBottom: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: colors.bgSecondary,
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
        borderColor: colors.textLink,
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
    },
    taskIconText: {
        fontSize: 11,
        fontWeight: "600",
        color: colors.textLink,
    },
    headerTitle: {
        fontSize: 13,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: colors.textLink + "22",
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "600",
        color: colors.textLink,
    },
    badgeWarning: {
        marginLeft: 4,
        backgroundColor: colors.warning + "22",
    },
    badgeWarningText: {
        color: colors.warning,
    },
    chevron: {
        fontSize: 14,
        marginLeft: 8,
        color: colors.textSecondary,
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
        borderBottomColor: colors.border,
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
        color: colors.textPrimary,
    },
    itemTextCompleted: {
        color: colors.textSecondary,
    },
    strikethrough: {
        textDecorationLine: "line-through",
    },
    priorityTag: {
        fontSize: 10,
        fontWeight: "600",
        marginTop: 2,
        color: colors.error,
    },
});

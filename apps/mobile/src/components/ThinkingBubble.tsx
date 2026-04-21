// Düşünme balonu — akış sırasında açık, tamamlandıktan sonra gizlenebilir

import React, { useEffect, useState } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import type { ThinkingItem } from "../stores/session-store";
import { BrainIcon } from "./ProviderIcon";
import { SunshineText } from "./ShimmerHighlight";
import { colors, spacing, fontSize } from "../theme/colors";

type Props = {
    item: ThinkingItem;
};

function ThinkingBubbleComponent({ item }: Props) {
    const [expanded, setExpanded] = useState<boolean>(true);
    const hasContent = item.content.length > 0;
    const charLabel = item.content.length > 1000
        ? `${Math.round(item.content.length / 1000)}K chars`
        : `${item.content.length} chars`;
    const canToggle = hasContent && !item.isStreaming;
    const isExpanded = item.isStreaming || expanded;

    useEffect(() => {
        setExpanded(true);
    }, [item.id]);

    return (
        <View style={styles.wrapper}>
            <View style={styles.rowWrap}>
                <Pressable
                    disabled={!canToggle}
                    onPress={() => setExpanded((current) => !current)}
                    style={styles.row}
                >
                    <View style={styles.iconContainer}>
                        <BrainIcon
                            size={14}
                            color={colors.textTertiary}
                        />
                    </View>
                    <SunshineText
                        active={item.isStreaming}
                        text={item.isStreaming ? "Thinking…" : "Thought"}
                        textStyle={styles.label}
                    />
                    {hasContent && (
                        <Text style={styles.charCount}>{charLabel}</Text>
                    )}
                    {canToggle && (
                        <Text style={styles.toggleText}>{isExpanded ? "Hide" : "Show"}</Text>
                    )}
                </Pressable>
            </View>

            {hasContent && isExpanded && (
                <View style={styles.inlinePanel}>
                    <Text style={styles.content} selectable>
                        {item.content}
                        {item.isStreaming && (
                            <Text style={styles.cursor}>▌</Text>
                        )}
                    </Text>
                </View>
            )}
        </View>
    );
}

export const ThinkingBubble = React.memo(ThinkingBubbleComponent);

const styles = StyleSheet.create({
    wrapper: {
        paddingHorizontal: spacing.lg,
        paddingVertical: 2,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        gap: spacing.sm,
    },
    rowWrap: {
        overflow: "hidden",
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
        color: colors.textTertiary,
        fontWeight: "400",
    },
    charCount: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
    },
    toggleText: {
        fontSize: fontSize.xs,
        color: colors.textSecondary,
        marginLeft: "auto",
    },
    inlinePanel: {
        marginTop: 2,
        paddingLeft: 26,
        paddingRight: spacing.sm,
    },
    content: {
        fontSize: fontSize.sm,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    cursor: {
        color: colors.textSecondary,
    },
});

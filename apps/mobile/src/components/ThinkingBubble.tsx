// Düşünme balonu — akış sırasında açık, tamamlandıktan sonra gizlenebilir

import React, { useEffect, useState } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import type { ThinkingItem } from "../stores/session-store-types";
import { BrainIcon } from "./ProviderIcon";
import { SunshineText } from "./ShimmerHighlight";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";

type Props = {
    item: ThinkingItem;
};

function ThinkingBubbleComponent({ item }: Props) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const [expanded, setExpanded] = useState<boolean>(item.isStreaming);
    const hasContent = item.content.length > 0;
    const charLabel = item.content.length > 1000
        ? `${Math.round(item.content.length / 1000)}K chars`
        : `${item.content.length} chars`;
    const canToggle = hasContent && !item.isStreaming;
    const isExpanded = item.isStreaming || expanded;

    useEffect(() => {
        setExpanded(item.isStreaming);
    }, [item.id, item.isStreaming]);

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
                            color={theme.colors.textTertiary}
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
                    <Text style={styles.content}>
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

const createStyles = (theme: AppTheme) => StyleSheet.create({
    wrapper: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: 2,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        gap: theme.spacing.sm,
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
        fontSize: theme.fontSize.md,
        color: theme.colors.textSecondary,
        fontWeight: "400",
    },
    charCount: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textSecondary,
    },
    toggleText: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textAssistant,
        marginLeft: "auto",
    },
    inlinePanel: {
        marginTop: 2,
        paddingLeft: 26,
        paddingRight: theme.spacing.sm,
    },
    content: {
        fontSize: theme.fontSize.sm,
        lineHeight: 20,
        color: theme.colors.textAssistant,
    },
    cursor: {
        color: theme.colors.textAssistant,
    },
});

// Yeniden kullanılabilir alt sayfa (bottom sheet) — araç detayları, düşünme içeriği, kabuk çıktısı için
// Yarı yükseklik, tutma çubuğu, başlık (ikon + başlık + kapat butonu), kaydırılabilir içerik

import React from "react";
import {
    View,
    Text,
    Pressable,
    Modal,
    ScrollView,
    StyleSheet,
    type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { FeatherName } from "./Icons";
import { useThemedStyles, type AppTheme } from "../theme/theme-context";

type Props = {
    visible: boolean;
    onClose: () => void;
    /** Feather icon name — if provided, renders an SVG icon */
    iconName?: FeatherName;
    iconNode?: React.ReactNode;
    /** Fallback text icon (used if iconName not provided) */
    icon?: string;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    contentStyle?: ViewStyle;
    /** Rendered between the header and the scrollable content — stays pinned while content scrolls */
    stickyHeader?: React.ReactNode;
};

export function BottomSheet({
    visible,
    onClose,
    iconName,
    iconNode,
    icon,
    title,
    subtitle,
    children,
    contentStyle,
    stickyHeader,
}: Props) {
    const styles = useThemedStyles(createStyles);
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            {/* Full-screen overlay — tap here to dismiss */}
            <View style={styles.overlay} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

                {/* Sheet — plain View so it doesn't compete with inner ScrollView gestures */}
                <View style={styles.sheet}>
                    {/* Tutma çubuğu */}
                    <View style={styles.grabHandleContainer}>
                        <View style={styles.grabHandle} />
                    </View>

                    {/* Başlık */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            {iconNode !== undefined ? (
                                <View style={styles.iconBadge}>
                                    {iconNode}
                                </View>
                            ) : iconName !== undefined ? (
                                <View style={styles.iconBadge}>
                                    <Feather name={iconName} size={14} color={styles.iconTint.color} />
                                </View>
                            ) : icon !== undefined && icon.length > 0 ? (
                                <Text style={styles.headerIcon}>{icon}</Text>
                            ) : null}
                            <View style={styles.headerTextContainer}>
                                <Text style={styles.headerTitle} numberOfLines={1}>
                                    {title}
                                </Text>
                                {subtitle !== undefined && subtitle.length > 0 && (
                                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                                        {subtitle}
                                    </Text>
                                )}
                            </View>
                        </View>
                        <Pressable
                            style={styles.closeButton}
                            onPress={onClose}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Close ${title}`}
                        >
                            <Feather name="x" size={14} color={styles.iconTint.color} />
                        </Pressable>
                    </View>

                    {/* Sticky header slot — rendered below the title bar, pinned above the scroll */}
                    {stickyHeader !== undefined && stickyHeader !== null && (
                        <View>{stickyHeader}</View>
                    )}

                    {/* İçerik — flex: 1 so it fills remaining sheet space and scrolls properly */}
                    <ScrollView
                        style={[styles.content, contentStyle]}
                        contentContainerStyle={styles.contentContainer}
                        showsVerticalScrollIndicator={true}
                        scrollIndicatorInsets={{ right: 1 }}
                        keyboardShouldPersistTaps="handled"
                        nestedScrollEnabled={true}
                    >
                        {children}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: theme.colors.overlay,
            justifyContent: "flex-end",
        },
        sheet: {
            height: "75%",
            maxHeight: "85%",
            minHeight: 300,
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.borderRadius.xl,
            borderTopRightRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.border,
        },
        grabHandleContainer: {
            alignItems: "center",
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.xs,
        },
        grabHandle: {
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.bgOverlay,
        },
        header: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderMuted,
        },
        headerLeft: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            flex: 1,
        },
        iconBadge: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: theme.colors.bgTertiary,
            borderWidth: 1,
            borderColor: theme.colors.border,
            justifyContent: "center",
            alignItems: "center",
            flexShrink: 0,
        },
        headerIcon: {
            fontSize: theme.fontSize.lg,
        },
        headerTextContainer: {
            flex: 1,
        },
        headerTitle: {
            fontSize: theme.fontSize.base,
            fontWeight: "600",
            color: theme.colors.textPrimary,
        },
        headerSubtitle: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            marginTop: 2,
            textTransform: "capitalize",
        },
        closeButton: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: theme.colors.bgTertiary,
            justifyContent: "center",
            alignItems: "center",
            marginLeft: theme.spacing.sm,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        content: {
            flex: 1,
            paddingHorizontal: theme.spacing.lg,
        },
        contentContainer: {
            paddingVertical: theme.spacing.md,
            paddingBottom: 34,
        },
        iconTint: {
            color: theme.colors.textSecondary,
        },
    });
}

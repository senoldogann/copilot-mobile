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
import { colors, spacing, fontSize, borderRadius } from "../theme/colors";

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
                                    <Feather name={iconName} size={14} color={colors.textSecondary} />
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
                        >
                            <Feather name="x" size={14} color={colors.textSecondary} />
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

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: "flex-end",
    },
    sheet: {
        height: "75%",
        maxHeight: "85%",
        minHeight: 300,
        backgroundColor: colors.bg,
        borderTopLeftRadius: borderRadius.xl,
        borderTopRightRadius: borderRadius.xl,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: colors.border,
        // Note: overflow "hidden" removed — it prevents ScrollView gestures on Android
        // Border-radius clipping is handled by the borderTopRadius on iOS/Android natively
    },
    grabHandleContainer: {
        alignItems: "center",
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
    },
    grabHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.bgOverlay,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderMuted,
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        flex: 1,
    },
    iconBadge: {
        width: 28,
        height: 28,
        borderRadius: borderRadius.sm,
        backgroundColor: colors.bgTertiary,
        borderWidth: 1,
        borderColor: colors.border,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
    headerIcon: {
        fontSize: fontSize.lg,
    },
    headerTextContainer: {
        flex: 1,
    },
    headerTitle: {
        fontSize: fontSize.base,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    headerSubtitle: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        marginTop: 2,
        textTransform: "capitalize",
    },
    closeButton: {
        width: 28,
        height: 28,
        borderRadius: borderRadius.sm,
        backgroundColor: colors.bgTertiary,
        justifyContent: "center",
        alignItems: "center",
        marginLeft: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.lg,
    },
    contentContainer: {
        paddingVertical: spacing.md,
        paddingBottom: 34,
    },
});

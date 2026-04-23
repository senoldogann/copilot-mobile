import { Platform, StyleSheet } from "react-native";
import type { AppTheme } from "../theme/theme-context";

export function createDropdownStyles(theme: AppTheme) {
    return StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: theme.colors.overlay,
            justifyContent: "flex-end",
        },
        container: {
            backgroundColor: theme.colors.bgElevated,
            borderRadius: theme.borderRadius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            maxHeight: "82%",
            marginHorizontal: theme.spacing.md,
            marginBottom: Platform.OS === "ios" ? 28 : 16,
            paddingBottom: 12,
            overflow: "hidden",
            shadowColor: "#000",
            shadowOpacity: theme.resolvedScheme === "light" ? 0.08 : 0.24,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
            elevation: 14,
        },
        scroll: {
            maxHeight: 600,
        },
        scrollContent: {
            paddingBottom: theme.spacing.sm,
        },
        header: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderMuted,
            backgroundColor: theme.resolvedScheme === "light" ? theme.colors.bg : theme.colors.bgSecondary,
        },
        headerLeft: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            flex: 1,
        },
        headerIconBadge: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgTertiary,
            justifyContent: "center",
            alignItems: "center",
        },
        title: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
            fontWeight: "700",
        },
        searchContainer: {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
        },
        searchInput: {
            backgroundColor: theme.colors.bg,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            fontSize: theme.fontSize.md,
            color: theme.colors.textPrimary,
        },
        list: {
            maxHeight: 300,
        },
        item: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        itemSelected: {
            backgroundColor: theme.resolvedScheme === "light"
                ? theme.colors.accentMuted
                : theme.colors.bgElevated,
        },
        itemDisabled: {
            opacity: 0.4,
        },
        itemLeft: {
            flexDirection: "row",
            alignItems: "center",
            flex: 1,
        },
        checkmark: {
            color: theme.colors.accent,
            fontSize: theme.fontSize.base,
            fontWeight: "700",
            marginRight: theme.spacing.sm,
            width: 18,
        },
        itemText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
        },
        itemTextSelected: {
            color: theme.colors.textPrimary,
            fontWeight: "600",
        },
        itemTextDisabled: {
            color: theme.colors.textTertiary,
        },
        badgeText: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.sm,
            marginLeft: theme.spacing.sm,
        },
        sectionLabel: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 0.5,
        },
        sectionLabelRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: 6,
        },
        sectionLabelIcon: {
            width: 18,
            alignItems: "center",
            justifyContent: "center",
        },
        sectionDivider: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.colors.border,
            marginTop: theme.spacing.sm,
            marginHorizontal: theme.spacing.lg,
        },
        effortList: {
            paddingBottom: theme.spacing.sm,
        },
        effortItem: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        effortItemSelected: {
            backgroundColor: theme.resolvedScheme === "light"
                ? theme.colors.accentMuted
                : theme.colors.bgSecondary,
        },
        effortItemLeft: {
            flexDirection: "row",
            alignItems: "center",
            flex: 1,
        },
        checkmarkSlot: {
            width: 22,
            alignItems: "center",
        },
        trailingSlot: {
            width: 18,
        },
        effortLabel: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
            fontWeight: "500",
        },
        effortLabelSelected: {
            color: theme.colors.textPrimary,
            fontWeight: "600",
        },
        effortDesc: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            marginTop: 2,
        },
    });
}

export function createAttachmentStyles(theme: AppTheme) {
    return StyleSheet.create({
        row: {
            maxHeight: 72,
            marginBottom: 6,
        },
        rowContent: {
            paddingHorizontal: 4,
            gap: theme.spacing.sm,
        },
        chip: {
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            maxWidth: 200,
        },
        chipClose: {
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: theme.colors.bgElevated,
            justifyContent: "center",
            alignItems: "center",
        },
        chipCloseText: {
            color: theme.colors.textPrimary,
            fontSize: 9,
            fontWeight: "700",
        },
        chipImage: {
            width: 32,
            height: 32,
            borderRadius: 4,
        },
        chipName: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.xs,
            maxWidth: 120,
        },
    });
}

export function createToolbarStyles(theme: AppTheme) {
    return StyleSheet.create({
        row: {
            flexDirection: "row",
            alignItems: "center",
            minHeight: 36,
            gap: 4,
            overflow: "visible",
        },
        toolBtn: {
            width: 32,
            height: 32,
            borderRadius: theme.borderRadius.md,
            justifyContent: "center",
            alignItems: "center",
        },
        toolBtnDimmed: {
            opacity: 0.3,
        },
        toolBtnActive: {
            backgroundColor: theme.colors.accentMuted,
        },
        toolBtnRecording: {
            backgroundColor: theme.colors.accent,
        },
        modelPill: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 4,
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: "transparent",
            gap: 4,
            flexShrink: 1,
            minWidth: 0,
        },
        modelText: {
            color: theme.resolvedScheme === "light"
                ? theme.colors.textPrimary
                : theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: "500",
            flexShrink: 1,
        },
        spacer: {
            flex: 1,
        },
        sendGroup: {
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
        },
        sendControlWrap: {
            position: "relative",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            zIndex: 40,
        },
        sendMenuButton: {
            width: 22,
            height: 32,
            justifyContent: "center",
            alignItems: "center",
            borderRadius: theme.borderRadius.sm,
        },
        sendMenuPopover: {
            position: "absolute",
            right: 0,
            bottom: 38,
            minWidth: 196,
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            zIndex: 30,
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 12,
            overflow: "hidden",
        },
        sendMenuBackdrop: {
            ...StyleSheet.absoluteFillObject,
            zIndex: 20,
        },
        contextMeterBtn: {
            width: 22,
            height: 22,
            borderRadius: theme.borderRadius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "transparent",
        },
        sendModeItem: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 10,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        sendModeIcon: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
            width: 24,
        },
        sendModeRight: {
            flex: 1,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
        },
        sendModeText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
        },
        sendModeShortcut: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
        },
    });
}

export function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.sm,
            paddingBottom: 12,
            backgroundColor: theme.colors.bg,
        },
        inputCard: {
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.xs,
        },
        inputCardFocused: {
            borderColor: theme.colors.accent,
        },
        inputSeparator: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.colors.border,
            marginHorizontal: -theme.spacing.md,
            marginTop: theme.spacing.xs,
            marginBottom: 0,
        },
        textInput: {
            fontSize: theme.fontSize.base,
            color: theme.colors.textPrimary,
            maxHeight: 120,
            minHeight: 36,
            paddingVertical: Platform.OS === "ios" ? 6 : 4,
            textAlignVertical: "top",
        },
        sendButton: {
            width: 30,
            height: 30,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.accent,
            justifyContent: "center",
            alignItems: "center",
        },
        sendButtonDisabled: {
            backgroundColor: theme.colors.bgElevated,
        },
        abortButton: {
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: theme.colors.error,
            justifyContent: "center",
            alignItems: "center",
        },
        abortButtonPending: {
            backgroundColor: theme.colors.warning,
            opacity: 0.85,
        },
        abortIcon: {
            width: 10,
            height: 10,
            borderRadius: 2,
            backgroundColor: theme.colors.textOnAccent,
        },
        resolvedModelLabel: {
            alignSelf: "flex-end",
            marginTop: 6,
            marginRight: 4,
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            fontWeight: "500",
        },
    });
}

export function createContextStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            gap: 10,
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.sm,
        },
        heroCard: {
            gap: 6,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.bgSecondary,
        },
        eyebrow: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 0.4,
        },
        summaryRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
        },
        summaryText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.base,
            fontWeight: "600",
        },
        summaryPercent: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
        },
        progressTrack: {
            height: 5,
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.bgTertiary,
            overflow: "hidden",
        },
        progressFill: {
            height: "100%",
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.textSecondary,
        },
        reservePill: {
            alignSelf: "flex-start",
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.bgTertiary,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 3,
        },
        reservePillText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
        },
        sectionCard: {
            gap: 6,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.bgSecondary,
        },
        sectionTitle: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
        },
        metricRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
        },
        metricLabel: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
        },
        metricValue: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
        },
        compactButton: {
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.bgSecondary,
            paddingVertical: 9,
            alignItems: "center",
        },
        compactButtonText: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
            fontWeight: "600",
        },
    });
}

export function createAutocompleteStyles(theme: AppTheme) {
    return StyleSheet.create({
        popover: {
            backgroundColor: theme.colors.bgElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            marginBottom: 6,
            overflow: "hidden",
            maxHeight: 220,
        },
        list: {
            flexShrink: 1,
        },
        ctxHeader: {
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 7,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        ctxModelName: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            fontWeight: "500",
            flexShrink: 1,
        },
        ctxSize: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
        },
        item: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 10,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        itemPressed: {
            backgroundColor: theme.colors.bgOverlay,
        },
        itemIcon: {
            width: 18,
            alignItems: "center",
            justifyContent: "center",
        },
        itemBody: {
            flex: 1,
            minWidth: 0,
        },
        label: {
            fontSize: theme.fontSize.sm,
            color: theme.colors.textPrimary,
            fontWeight: "500",
        },
        hint: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            marginTop: 2,
        },
        category: {
            fontSize: theme.fontSize.xs,
            color: theme.colors.textTertiary,
            textTransform: "uppercase",
            letterSpacing: 0.4,
        },
    });
}

export function createQueuedDraftStyles(theme: AppTheme) {
    return StyleSheet.create({
        container: {
            gap: 6,
            marginBottom: 8,
        },
        item: {
            flexDirection: "row",
            alignItems: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.bgSecondary,
            paddingLeft: theme.spacing.sm,
            paddingRight: 6,
            paddingVertical: 6,
            gap: 6,
        },
        body: {
            flex: 1,
            minWidth: 0,
        },
        badge: {
            alignSelf: "flex-start",
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.accentMuted,
            marginBottom: 4,
        },
        badgeText: {
            color: theme.colors.accent,
            fontSize: theme.fontSize.xs,
            fontWeight: "700",
        },
        content: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
            lineHeight: 18,
        },
        meta: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            marginTop: 4,
        },
        actionButton: {
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            alignItems: "center",
            justifyContent: "center",
        },
    });
}

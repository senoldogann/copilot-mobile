import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import {
    searchWorkspaceDirectories,
    type WorkspaceDirectorySearchMatch,
} from "../services/bridge";
import { useWorkspaceDirectoryStore } from "../stores/workspace-directory-store";
import { useThemedStyles, type AppTheme } from "../theme/theme-context";
import { buildSavedWorkspaceMetadata } from "../view-models/provider-metadata";

type Props = {
    visible: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
};

const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_RESULT_LIMIT = 12;

export function WorkspacePickerModal({
    visible,
    onClose,
    onSelect,
}: Props) {
    const styles = useThemedStyles(createStyles);
    const [query, setQuery] = useState("");
    const [matches, setMatches] = useState<ReadonlyArray<WorkspaceDirectorySearchMatch>>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const savedDirectories = useWorkspaceDirectoryStore((state) => state.directories);

    useEffect(() => {
        if (!visible) {
            setQuery("");
            setMatches([]);
            setError(null);
            setIsLoading(false);
            return;
        }

        let active = true;
        const timeoutId = setTimeout(() => {
            setIsLoading(true);
            void searchWorkspaceDirectories(query, SEARCH_RESULT_LIMIT)
                .then((nextMatches) => {
                    if (!active) {
                        return;
                    }

                    setMatches(nextMatches);
                    setError(null);
                })
                .catch((nextError) => {
                    if (!active) {
                        return;
                    }

                    setError(nextError instanceof Error ? nextError.message : String(nextError));
                    setMatches([]);
                })
                .finally(() => {
                    if (active) {
                        setIsLoading(false);
                    }
                });
        }, query.trim().length === 0 ? 0 : SEARCH_DEBOUNCE_MS);

        return () => {
            active = false;
            clearTimeout(timeoutId);
        };
    }, [query, visible]);

    const title = useMemo(
        () => query.trim().length === 0 ? "Suggested workspaces" : "Matching directories",
        [query]
    );

    const visibleMatches = useMemo(() => {
        if (query.trim().length > 0) {
            return matches;
        }

        const suggestedMatches = savedDirectories.map((directory) => ({
            path: directory.path,
            displayPath: directory.path,
            name: directory.path.split(/[\\/]/).filter(Boolean).at(-1) ?? directory.path,
        } satisfies WorkspaceDirectorySearchMatch));

        const nextMatches = [...suggestedMatches];
        for (const match of matches) {
            if (!nextMatches.some((entry) => entry.path === match.path)) {
                nextMatches.push(match);
            }
        }

        return nextMatches.slice(0, SEARCH_RESULT_LIMIT);
    }, [matches, query, savedDirectories]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <Pressable
                    style={styles.card}
                    onPress={(event) => event.stopPropagation()}
                >
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Add workspace</Text>
                        <Pressable onPress={onClose} hitSlop={8}>
                            <Feather name="x" size={18} color={styles.iconTint.color} />
                        </Pressable>
                    </View>

                    <View style={styles.inputRow}>
                        <TextInput
                            style={styles.input}
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Type a directory path…"
                            placeholderTextColor={styles.placeholder.color}
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoFocus
                        />
                    </View>

                    <Text style={styles.sectionTitle}>{title}</Text>

                    <ScrollView
                        style={styles.results}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        {isLoading && (
                            <View style={styles.stateRow}>
                                <ActivityIndicator size="small" color={styles.stateTint.color} />
                                <Text style={styles.stateText}>Searching…</Text>
                            </View>
                        )}

                        {!isLoading && error !== null && (
                            <Text style={styles.errorText}>{error}</Text>
                        )}

                        {!isLoading && error === null && visibleMatches.length === 0 && (
                            <Text style={styles.emptyText}>No matching directories.</Text>
                        )}

                        {visibleMatches.map((match) => {
                            const savedDirectory = savedDirectories.find((directory) => directory.path === match.path);
                            const metadata = savedDirectory === undefined
                                ? null
                                : buildSavedWorkspaceMetadata(savedDirectory.lastUsedAt, Date.now());

                            return (
                                <Pressable
                                    key={match.path}
                                    style={({ pressed }) => [
                                        styles.resultItem,
                                        pressed && styles.resultItemPressed,
                                    ]}
                                    onPress={() => onSelect(match.path)}
                                >
                                    <Feather name="folder" size={16} color={styles.stateTint.color} />
                                    <View style={styles.resultTextColumn}>
                                        <Text style={styles.resultPath} numberOfLines={1}>
                                            {match.displayPath}
                                        </Text>
                                        <Text style={styles.resultName} numberOfLines={1}>
                                            {match.name}
                                        </Text>
                                        {metadata !== null && (
                                            <View style={styles.metadataChipRow}>
                                                {metadata.chips.map((chip) => (
                                                    <View key={`${match.path}:${chip.label}`} style={styles.metadataChip}>
                                                        <Text style={styles.metadataChipText}>{chip.label}</Text>
                                                    </View>
                                                ))}
                                            </View>
                                        )}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function createStyles(theme: AppTheme) {
    return StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: theme.colors.overlay,
            justifyContent: "flex-start",
            paddingTop: 72,
            paddingHorizontal: theme.spacing.lg,
        },
        card: {
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            overflow: "hidden",
            maxHeight: 380,
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
        headerTitle: {
            fontSize: theme.fontSize.md,
            fontWeight: "700",
            color: theme.colors.textPrimary,
        },
        inputRow: {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
        },
        input: {
            height: 46,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: theme.colors.inputBorder,
            backgroundColor: theme.colors.inputBg,
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            paddingHorizontal: theme.spacing.md,
        },
        sectionTitle: {
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
            fontSize: theme.fontSize.sm,
            color: theme.colors.textTertiary,
            fontWeight: "600",
        },
        results: {
            maxHeight: 260,
        },
        resultItem: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: 14,
            borderTopWidth: 1,
            borderTopColor: theme.colors.borderMuted,
        },
        resultItemPressed: {
            backgroundColor: theme.colors.sidebarItemHover,
        },
        resultTextColumn: {
            flex: 1,
            gap: 2,
        },
        resultPath: {
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.md,
            fontWeight: "600",
        },
        resultName: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
        },
        metadataChipRow: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.xs,
            marginTop: theme.spacing.xs,
        },
        metadataChip: {
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: theme.colors.borderMuted,
            backgroundColor: theme.colors.bgTertiary,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 4,
        },
        metadataChipText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            fontWeight: "600",
        },
        stateRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.lg,
        },
        stateText: {
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.md,
        },
        errorText: {
            color: theme.colors.error,
            fontSize: theme.fontSize.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
        },
        emptyText: {
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
        },
        iconTint: {
            color: theme.colors.textTertiary,
        },
        placeholder: {
            color: theme.colors.textPlaceholder,
        },
        stateTint: {
            color: theme.colors.textSecondary,
        },
    });
}

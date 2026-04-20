// Workspace dosya ve diff görüntüleyicisi — paylaşılan modal bileşen.
// Hem sohbet içi dosya linkleri hem de workspace panelindeki dosya tıklamaları için kullanılır.

import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSessionStore } from "../stores/session-store";
import {
    onWorkspaceDiffResponse,
    onWorkspaceFileResponse,
    requestWorkspaceDiff,
    requestWorkspaceFile,
} from "../services/bridge";
import type { WorkspaceDiffPayload, WorkspaceFilePayload } from "../services/workspace-events";
import { borderRadius, colors, fontSize, spacing } from "../theme/colors";

type ViewerMode = "file" | "diff";

type Props = {
    readonly path: string;
    readonly mode?: ViewerMode;
    readonly onClose: () => void;
};

type LoadState =
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly body: string; readonly truncated: boolean }
    | { readonly status: "error"; readonly message: string };

const LOAD_TIMEOUT_MS = 10_000;

function parseLineInfo(raw: string): { readonly clean: string; readonly info: string | null } {
    const clean = raw.replace(/:\d+(-\d+)?$/, "");
    const match = raw.match(/:(\d+)(?:-(\d+))?$/);
    if (match === null) {
        return { clean, info: null };
    }
    const start = match[1]!;
    const end = match[2];
    return {
        clean,
        info: end !== undefined ? `Lines ${start}-${end}` : `Line ${start}`,
    };
}

export function FileContentViewer(props: Props): React.JSX.Element {
    const { path, mode = "file", onClose } = props;
    const { clean, info } = parseLineInfo(path);
    const activeSessionId = useSessionStore((s) => s.activeSessionId);

    const [state, setState] = useState<LoadState>({ status: "loading" });

    const load = useCallback((): (() => void) | undefined => {
        if (activeSessionId === null) {
            setState({ status: "error", message: "No active session. Connect to the bridge first." });
            return undefined;
        }
        setState({ status: "loading" });

        const unsubscribe =
            mode === "diff"
                ? onWorkspaceDiffResponse(clean, (payload: WorkspaceDiffPayload) => {
                    finish();
                    if (payload.error !== undefined) {
                        setState({ status: "error", message: payload.error });
                    } else {
                        setState({
                            status: "ready",
                            body: payload.diff.length > 0 ? payload.diff : "(No changes)",
                            truncated: false,
                        });
                    }
                })
                : onWorkspaceFileResponse(clean, (payload: WorkspaceFilePayload) => {
                    finish();
                    if (payload.error !== undefined) {
                        setState({ status: "error", message: payload.error });
                    } else {
                        setState({
                            status: "ready",
                            body: payload.content,
                            truncated: payload.truncated,
                        });
                    }
                });

        const timeout = setTimeout(() => {
            unsubscribe();
            setState({ status: "error", message: "Timed out waiting for response." });
        }, LOAD_TIMEOUT_MS);

        const finish = (): void => {
            clearTimeout(timeout);
            unsubscribe();
        };

        if (mode === "diff") {
            void requestWorkspaceDiff(activeSessionId, clean);
        } else {
            void requestWorkspaceFile(activeSessionId, clean);
        }

        return () => {
            clearTimeout(timeout);
            unsubscribe();
        };
    }, [activeSessionId, clean, mode]);

    useEffect(() => {
        return load();
    }, [load]);

    const fileName = clean.split("/").pop() ?? clean;
    const titleIcon = mode === "diff" ? "±" : "📄";

    return (
        <Modal
            visible
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={viewerStyles.container}>
                <View style={viewerStyles.header}>
                    <View style={viewerStyles.headerLeft}>
                        <Text style={viewerStyles.fileIcon}>{titleIcon}</Text>
                        <View style={viewerStyles.headerText}>
                            <Text style={viewerStyles.fileName} numberOfLines={1}>
                                {fileName}
                            </Text>
                            <Text style={viewerStyles.filePath} numberOfLines={1}>
                                {clean}
                            </Text>
                        </View>
                    </View>
                    <Pressable style={viewerStyles.closeButton} onPress={onClose}>
                        <Text style={viewerStyles.closeText}>✕</Text>
                    </Pressable>
                </View>
                {info !== null && (
                    <View style={viewerStyles.lineInfo}>
                        <Text style={viewerStyles.lineInfoText}>{info}</Text>
                    </View>
                )}
                {state.status === "ready" && state.truncated && (
                    <View style={viewerStyles.truncatedBanner}>
                        <Text style={viewerStyles.truncatedText}>
                            File truncated — showing first 256 KB
                        </Text>
                    </View>
                )}
                <ScrollView style={viewerStyles.body} contentContainerStyle={viewerStyles.bodyContent}>
                    {state.status === "loading" && (
                        <View style={viewerStyles.centered}>
                            <ActivityIndicator color={colors.accent} size="small" />
                            <Text style={viewerStyles.loadingText}>Loading…</Text>
                        </View>
                    )}
                    {state.status === "error" && (
                        <View style={viewerStyles.centered}>
                            <Text style={viewerStyles.errorText}>{state.message}</Text>
                            <Pressable style={viewerStyles.retryBtn} onPress={load}>
                                <Text style={viewerStyles.retryText}>Retry</Text>
                            </Pressable>
                        </View>
                    )}
                    {state.status === "ready" &&
                        (mode === "diff" ? (
                            <DiffBody diff={state.body} />
                        ) : (
                            <Text style={viewerStyles.codeText} selectable>
                                {state.body}
                            </Text>
                        ))}
                </ScrollView>
            </View>
        </Modal>
    );
}

function classifyDiffLine(line: string): { readonly color: string; readonly bg: string | null } {
    if (line.startsWith("+++") || line.startsWith("---")) {
        return { color: colors.textTertiary, bg: null };
    }
    if (line.startsWith("@@")) {
        return { color: colors.accent, bg: null };
    }
    if (line.startsWith("+")) {
        return { color: "#3fb950", bg: "rgba(63,185,80,0.10)" };
    }
    if (line.startsWith("-")) {
        return { color: "#f85149", bg: "rgba(248,81,73,0.10)" };
    }
    return { color: colors.textPrimary, bg: null };
}

function DiffBody({ diff }: { readonly diff: string }): React.JSX.Element {
    const lines = diff.split("\n");
    return (
        <View>
            {lines.map((line, idx) => {
                const { color, bg } = classifyDiffLine(line);
                return (
                    <Text
                        key={idx}
                        selectable
                        style={[
                            viewerStyles.diffLine,
                            { color },
                            bg !== null ? { backgroundColor: bg } : null,
                        ]}
                    >
                        {line.length === 0 ? " " : line}
                    </Text>
                );
            })}
        </View>
    );
}

const viewerStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.lg,
        paddingVertical: 14,
        backgroundColor: colors.bgSecondary,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        flex: 1,
    },
    headerText: {
        flex: 1,
    },
    fileIcon: {
        fontSize: 18,
    },
    fileName: {
        fontSize: fontSize.base,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    filePath: {
        fontSize: fontSize.xs,
        color: colors.textSecondary,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: borderRadius.sm,
        backgroundColor: colors.bgElevated,
        justifyContent: "center",
        alignItems: "center",
    },
    closeText: {
        fontSize: fontSize.base,
        color: colors.textPrimary,
    },
    lineInfo: {
        paddingHorizontal: spacing.lg,
        paddingVertical: 6,
        backgroundColor: colors.accentMuted,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    lineInfoText: {
        fontSize: fontSize.sm,
        color: colors.accent,
    },
    truncatedBanner: {
        paddingHorizontal: spacing.lg,
        paddingVertical: 6,
        backgroundColor: colors.bgElevated,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    truncatedText: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
    },
    body: {
        flex: 1,
    },
    bodyContent: {
        padding: spacing.lg,
        paddingBottom: 40,
    },
    centered: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 40,
        gap: 12,
    },
    loadingText: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
    },
    errorText: {
        fontSize: fontSize.sm,
        color: colors.error,
        textAlign: "center",
    },
    retryBtn: {
        paddingHorizontal: spacing.lg,
        paddingVertical: 8,
        borderRadius: borderRadius.md,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
    },
    retryText: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
    },
    codeText: {
        fontSize: 12,
        lineHeight: 18,
        color: colors.textPrimary,
        fontFamily: "monospace",
    },
    diffLine: {
        fontSize: 12,
        lineHeight: 18,
        fontFamily: "monospace",
        paddingHorizontal: 4,
    },
});

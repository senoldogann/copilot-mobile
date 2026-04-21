// Workspace dosya ve diff görüntüleyicisi — BottomSheet olarak açılır.
// Hem sohbet içi dosya linkleri hem de workspace panelindeki dosya tıklamaları için kullanılır.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSessionStore } from "../stores/session-store";
import {
    onWorkspaceDiffResponse,
    onWorkspaceFileResponse,
    onWorkspaceResolveResponse,
    requestWorkspaceDiff,
    requestWorkspaceFile,
    requestWorkspaceResolve,
} from "../services/bridge";
import type {
    WorkspaceDiffPayload,
    WorkspaceFilePayload,
    WorkspaceResolvePayload,
} from "../services/workspace-events";
import { borderRadius, colors, fontSize, spacing } from "../theme/colors";
import { BottomSheet } from "./BottomSheet";

type ViewerMode = "file" | "diff";

type Props = {
    readonly path: string;
    readonly mode?: ViewerMode;
    readonly onClose: () => void;
};

type LoadState =
    | { readonly status: "loading"; readonly resolvedPath?: string }
    | {
        readonly status: "ready";
        readonly resolvedPath: string;
        readonly body: string;
        readonly truncated: boolean;
    }
    | {
        readonly status: "error";
        readonly message: string;
        readonly resolvedPath?: string;
    };

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

function formatResolveError(payload: WorkspaceResolvePayload): string {
    if (payload.matches !== undefined && payload.matches.length > 0) {
        const preview = payload.matches.slice(0, 3).join(", ");
        return `${payload.error ?? "Ambiguous file reference"} (${preview})`;
    }

    return payload.error ?? `Could not resolve ${payload.rawPath}`;
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

        const cleanupFns: Array<() => void> = [];
        let finished = false;

        const finish = (): void => {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(timeout);
            while (cleanupFns.length > 0) {
                const cleanup = cleanupFns.pop();
                cleanup?.();
            }
        };

        const timeout = setTimeout(() => {
            finish();
            setState({ status: "error", message: "Timed out waiting for response." });
        }, LOAD_TIMEOUT_MS);

        const unsubscribeResolve = onWorkspaceResolveResponse(
            activeSessionId,
            clean,
            (resolvePayload: WorkspaceResolvePayload) => {
                unsubscribeResolve();

                const resolvedPath = resolvePayload.resolvedWorkspaceRelativePath;
                if (resolvedPath === undefined) {
                    finish();
                    setState({
                        status: "error",
                        message: formatResolveError(resolvePayload),
                    });
                    return;
                }

                setState({ status: "loading", resolvedPath });

                if (mode === "diff") {
                    const unsubscribeDiff = onWorkspaceDiffResponse(
                        activeSessionId,
                        resolvedPath,
                        (payload: WorkspaceDiffPayload) => {
                            finish();
                            if (payload.error !== undefined) {
                                setState({
                                    status: "error",
                                    message: payload.error,
                                    resolvedPath,
                                });
                                return;
                            }

                            setState({
                                status: "ready",
                                resolvedPath,
                                body: payload.diff.length > 0 ? payload.diff : "(No changes)",
                                truncated: false,
                            });
                        }
                    );
                    cleanupFns.push(unsubscribeDiff);
                    void requestWorkspaceDiff(activeSessionId, resolvedPath);
                    return;
                }

                const unsubscribeFile = onWorkspaceFileResponse(
                    activeSessionId,
                    resolvedPath,
                    (payload: WorkspaceFilePayload) => {
                        finish();
                        if (payload.error !== undefined) {
                            setState({
                                status: "error",
                                message: payload.error,
                                resolvedPath,
                            });
                            return;
                        }

                        setState({
                            status: "ready",
                            resolvedPath,
                            body: payload.content,
                            truncated: payload.truncated,
                        });
                    }
                );
                cleanupFns.push(unsubscribeFile);
                void requestWorkspaceFile(activeSessionId, resolvedPath);
            }
        );

        cleanupFns.push(unsubscribeResolve);
        void requestWorkspaceResolve(activeSessionId, clean);

        return () => {
            finish();
        };
    }, [activeSessionId, clean, mode]);

    useEffect(() => load(), [load]);

    const resolvedPath = state.resolvedPath;
    const fileName = useMemo(() => {
        const source = resolvedPath ?? clean;
        return source.split("/").pop() ?? source;
    }, [clean, resolvedPath]);

    const stickyHeader = (info !== null || (state.status === "ready" && state.truncated)) ? (
        <View style={viewerStyles.metaBanner}>
            {info !== null && (
                <Text style={viewerStyles.lineInfoText}>{info}</Text>
            )}
            {state.status === "ready" && state.truncated && (
                <Text style={viewerStyles.truncatedText}>Showing first 256 KB</Text>
            )}
        </View>
    ) : null;

    return (
        <BottomSheet
            visible
            onClose={onClose}
            iconName={mode === "diff" ? "git-branch" : "file-text"}
            title={fileName}
            {...(resolvedPath !== undefined && resolvedPath !== fileName ? { subtitle: resolvedPath } : {})}
            stickyHeader={stickyHeader}
        >
            {state.status === "loading" && (
                <View style={viewerStyles.centered}>
                    <ActivityIndicator color={colors.textSecondary} size="small" />
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
                    <FileBody content={state.body} />
                ))}
        </BottomSheet>
    );
}

function classifyDiffLine(line: string): { readonly color: string; readonly bg: string | null } {
    if (line.startsWith("+++") || line.startsWith("---")) {
        return { color: colors.textTertiary, bg: null };
    }
    if (line.startsWith("@@")) {
        return { color: colors.textSecondary, bg: null };
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

function FileBody({ content }: { readonly content: string }): React.JSX.Element {
    const lines = content.split("\n");
    return (
        <View style={viewerStyles.codeBlock}>
            {lines.map((line, idx) => (
                <View key={idx} style={viewerStyles.codeLine}>
                    <Text style={viewerStyles.lineNum} selectable={false}>
                        {String(idx + 1).padStart(4, " ")}
                    </Text>
                    <Text style={viewerStyles.codeText} selectable>
                        {line.length === 0 ? " " : line}
                    </Text>
                </View>
            ))}
        </View>
    );
}

const viewerStyles = StyleSheet.create({
    metaBanner: {
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        backgroundColor: colors.bgElevated,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    lineInfoText: {
        fontSize: fontSize.xs,
        color: colors.textSecondary,
    },
    truncatedText: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
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
        paddingHorizontal: spacing.md,
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
    codeBlock: {
        backgroundColor: colors.bg,
        paddingHorizontal: 8,
        paddingVertical: spacing.sm,
    },
    codeLine: {
        flexDirection: "row",
        backgroundColor: colors.bg,
    },
    lineNum: {
        width: 36,
        fontSize: 11,
        lineHeight: 18,
        color: colors.textTertiary,
        fontFamily: "monospace",
        textAlign: "right",
        marginRight: 10,
        flexShrink: 0,
    },
    codeText: {
        flex: 1,
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

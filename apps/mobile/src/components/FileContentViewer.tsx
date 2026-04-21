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
import { useWorkspaceStore } from "../stores/workspace-store";
import {
    onWorkspaceDiffResponse,
    onWorkspaceFileResponse,
    requestWorkspaceDiff,
    requestWorkspaceFile,
} from "../services/bridge";
import type { WorkspaceDiffPayload, WorkspaceFilePayload } from "../services/workspace-events";
import type { WorkspaceTreeNode } from "@copilot-mobile/shared";
import { borderRadius, colors, fontSize, spacing } from "../theme/colors";
import { BottomSheet } from "./BottomSheet";

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

// Search workspace tree for a node whose name matches the bare filename.
// Returns the full relative path if found, or the original path otherwise.
function resolvePathFromTree(
    rawPath: string,
    tree: WorkspaceTreeNode | null
): string {
    if (tree === null) return rawPath;
    // Only search if the path looks like a bare filename (no slashes)
    const hasDirComponent = rawPath.includes("/") || rawPath.includes("\\");
    if (hasDirComponent) return rawPath;
    const needle = rawPath.toLowerCase().replace(/:\d+(-\d+)?$/, "");

    function search(node: WorkspaceTreeNode): string | null {
        if (node.type === "file" && node.name.toLowerCase() === needle) {
            return node.path;
        }
        if (node.children !== undefined) {
            for (const child of node.children) {
                const found = search(child);
                if (found !== null) return found;
            }
        }
        return null;
    }

    return search(tree) ?? rawPath;
}

export function FileContentViewer(props: Props): React.JSX.Element {
    const { path, mode = "file", onClose } = props;
    const { clean, info } = parseLineInfo(path);

    const activeSessionId = useSessionStore((s) => s.activeSessionId);
    const workspaceTree = useWorkspaceStore((s) => s.tree);

    // Resolve bare filenames (e.g. "bridge.ts") to their full tree path
    const resolvedPath = useMemo(
        () => resolvePathFromTree(clean, workspaceTree),
        [clean, workspaceTree]
    );

    const [state, setState] = useState<LoadState>({ status: "loading" });

    const load = useCallback((): (() => void) | undefined => {
        if (activeSessionId === null) {
            setState({ status: "error", message: "No active session. Connect to the bridge first." });
            return undefined;
        }
        setState({ status: "loading" });

        const unsubscribe =
            mode === "diff"
                ? onWorkspaceDiffResponse(resolvedPath, (payload: WorkspaceDiffPayload) => {
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
                : onWorkspaceFileResponse(resolvedPath, (payload: WorkspaceFilePayload) => {
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
            void requestWorkspaceDiff(activeSessionId, resolvedPath);
        } else {
            void requestWorkspaceFile(activeSessionId, resolvedPath);
        }

        return () => {
            clearTimeout(timeout);
            unsubscribe();
        };
    }, [activeSessionId, resolvedPath, mode]);

    useEffect(() => {
        return load();
    }, [load]);

    const fileName = resolvedPath.split("/").pop() ?? resolvedPath;
    const titleIcon = mode === "diff" ? "git-branch" : "file-text";

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
            icon={titleIcon === "file-text" ? "📄" : "±"}
            title={fileName}
            {...(resolvedPath !== fileName ? { subtitle: resolvedPath } : {})}
            stickyHeader={stickyHeader}
        >
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
        color: colors.accent,
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
        paddingHorizontal: 8,
        paddingVertical: spacing.sm,
    },
    codeLine: {
        flexDirection: "row",
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

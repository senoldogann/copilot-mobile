// Araç yürütme kartı — kompakt tek satır terminal stili ile SVG ikonlar

import React, { useState, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Animated, ScrollView } from "react-native";
import type { ToolItem } from "../stores/session-store";
import { BottomSheet } from "./BottomSheet";
import { ToolIcon } from "./Icons";
import type { FeatherName } from "./Icons";
import { ShimmerText } from "./ShimmerHighlight";
import { colors, spacing, fontSize } from "../theme/colors";

type Props = { item: ToolItem };

// ─── Tool classification ──────────────────────────────────────────────────────

type ToolKind = "edit" | "create" | "shell" | "read" | "search" | "think" | "git" | "fetch" | "other";

function classifyTool(toolName: string): ToolKind {
    const t = toolName.toLowerCase();
    if (t.includes("edit") || t.includes("str_replace")) return "edit";
    if (t.includes("create") || t.includes("write")) return "create";
    if (t.includes("shell") || t.includes("bash") || t.includes("exec") || t.includes("run")) return "shell";
    if (t.includes("read") || t.includes("view") || t.includes("cat")) return "read";
    if (t.includes("grep") || t.includes("search") || t.includes("find") || t.includes("glob")) return "search";
    if (t.includes("think")) return "think";
    if (t.includes("git")) return "git";
    if (t.includes("web") || t.includes("fetch") || t.includes("http")) return "fetch";
    return "other";
}

const KIND_LABELS: Record<ToolKind, string> = {
    edit: "Edit", create: "Create", shell: "Shell", read: "Read",
    search: "Search", think: "Thought", git: "Git", fetch: "Fetch", other: "Tool",
};

const KIND_ICONS: Record<ToolKind, FeatherName> = {
    edit: "edit-2", create: "file-plus", shell: "terminal", read: "eye",
    search: "search", think: "cpu", git: "git-branch", fetch: "globe", other: "tool",
};

// ─── Argument parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
    path?: string;
    oldStr?: string;
    newStr?: string;
    command?: string;
    content?: string;
    query?: string;
    pattern?: string;
    thought?: string;
    raw?: Record<string, unknown>;
}

function parseArgs(text: string | undefined): ParsedArgs {
    if (text === undefined || text.trim() === "") return {};
    try {
        const obj = JSON.parse(text) as Record<string, unknown>;
        const result: ParsedArgs = { raw: obj };
        const p = str(obj.path ?? obj.file ?? obj.filename ?? obj.filepath);
        if (p !== undefined) result.path = p;
        const os = str(obj.old_str ?? obj.old ?? obj.original);
        if (os !== undefined) result.oldStr = os;
        const ns = str(obj.new_str ?? obj.new ?? obj.replacement ?? obj.content);
        if (ns !== undefined) result.newStr = ns;
        const cmd = str(obj.command ?? obj.cmd);
        if (cmd !== undefined) result.command = cmd;
        const ct = str(obj.content ?? obj.file_text ?? obj.text);
        if (ct !== undefined) result.content = ct;
        const q = str(obj.query ?? obj.search ?? obj.pattern ?? obj.glob);
        if (q !== undefined) result.query = q;
        const pt = str(obj.pattern ?? obj.glob ?? obj.query);
        if (pt !== undefined) result.pattern = pt;
        const th = str(obj.thought ?? obj.thinking);
        if (th !== undefined) result.thought = th;
        return result;
    } catch { return {}; }
}

function str(v: unknown): string | undefined {
    return typeof v === "string" && v.length > 0 ? v : undefined;
}

function shortPath(p: string | undefined): string {
    if (p === undefined) return "";
    const parts = p.replace(/\\/g, "/").split("/");
    if (parts.length <= 2) return p;
    return "…/" + parts.slice(-2).join("/");
}

// ─── Diff engine (simple line-level) ─────────────────────────────────────────

type DiffLine = { type: "add" | "remove" | "context"; text: string };

function computeDiff(oldStr: string, newStr: string, contextLines = 3): DiffLine[] {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");

    // LCS via DP (capped at 300 lines each for performance)
    const a = oldLines.slice(0, 300);
    const b = newLines.slice(0, 300);
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            const diagVal = dp[i + 1]?.[j + 1] ?? 0;
            const downVal = dp[i + 1]?.[j] ?? 0;
            const rightVal = dp[i]?.[j + 1] ?? 0;
            dp[i]![j] = a[i] === b[j] ? diagVal + 1 : Math.max(downVal, rightVal);
        }
    }

    // Build edit sequence
    const edits: DiffLine[] = [];
    let i = 0, j = 0;
    while (i < m || j < n) {
        const diagMatch = i < m && j < n && a[i] === b[j];
        const downVal = dp[i + 1]?.[j] ?? 0;
        const rightVal = dp[i]?.[j + 1] ?? 0;
        if (diagMatch) {
            edits.push({ type: "context", text: a[i] as string });
            i++; j++;
        } else if (j < n && (i >= m || rightVal >= downVal)) {
            edits.push({ type: "add", text: b[j] as string });
            j++;
        } else {
            edits.push({ type: "remove", text: a[i] as string });
            i++;
        }
    }

    // Collapse far-apart context lines
    const changed = new Set<number>();
    edits.forEach((e, idx) => { if (e.type !== "context") changed.add(idx); });
    const keep = new Set<number>();
    changed.forEach((idx) => {
        for (let k = idx - contextLines; k <= idx + contextLines; k++) {
            if (k >= 0 && k < edits.length) keep.add(k);
        }
    });

    if (keep.size === 0) return [];
    const result: DiffLine[] = [];
    let lastKept = -1;
    edits.forEach((e, idx) => {
        if (!keep.has(idx)) return;
        if (lastKept >= 0 && idx > lastKept + 1) {
            result.push({ type: "context", text: "··· skipped ···" });
        }
        result.push(e);
        lastKept = idx;
    });
    return result;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
    const lines = useMemo(() => computeDiff(oldStr, newStr), [oldStr, newStr]);
    if (lines.length === 0) {
        return <Text style={diffStyles.empty}>No changes detected</Text>;
    }
    return (
        <View style={diffStyles.container}>
            {lines.map((line, i) => (
                <View
                    key={i}
                    style={[
                        diffStyles.line,
                        line.type === "add" && diffStyles.lineAdd,
                        line.type === "remove" && diffStyles.lineRemove,
                    ]}
                >
                    <Text
                        style={[
                            diffStyles.prefix,
                            line.type === "add" && diffStyles.prefixAdd,
                            line.type === "remove" && diffStyles.prefixRemove,
                            line.type === "context" && diffStyles.prefixContext,
                        ]}
                    >
                        {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                    </Text>
                    <Text
                        style={[
                            diffStyles.text,
                            line.type === "add" && diffStyles.textAdd,
                            line.type === "remove" && diffStyles.textRemove,
                            line.type === "context" && diffStyles.textContext,
                            line.text === "··· skipped ···" && diffStyles.textSkip,
                        ]}
                        selectable
                    >
                        {line.text}
                    </Text>
                </View>
            ))}
        </View>
    );
}

function CreateView({ path, content }: { path: string | undefined; content: string | undefined }) {
    const lines = (content ?? "").split("\n");
    return (
        <View style={diffStyles.container}>
            {path !== undefined && (
                <View style={diffStyles.fileHeader}>
                    <Text style={diffStyles.fileHeaderText}>+ {path}</Text>
                </View>
            )}
            {lines.map((line, i) => (
                <View key={i} style={[diffStyles.line, diffStyles.lineAdd]}>
                    <Text style={[diffStyles.prefix, diffStyles.prefixAdd]}>+</Text>
                    <Text style={[diffStyles.text, diffStyles.textAdd]} selectable>{line}</Text>
                </View>
            ))}
        </View>
    );
}

function TerminalBlock({ command, output }: { command: string | null; output: string | undefined }) {
    return (
        <View style={terminalStyles.container}>
            {command !== null && (
                <View style={terminalStyles.promptRow}>
                    <Text style={terminalStyles.prompt}>$</Text>
                    <Text style={terminalStyles.command} selectable>{command}</Text>
                </View>
            )}
            {output !== undefined && output.trim().length > 0 && (
                <View style={terminalStyles.outputBlock}>
                    {output.trim().split("\n").map((line, i) => (
                        <Text key={i} style={terminalStyles.outputLine} selectable>{line}</Text>
                    ))}
                </View>
            )}
        </View>
    );
}

function ThoughtBlock({ text }: { text: string }) {
    return (
        <View style={thoughtStyles.container}>
            <Text style={thoughtStyles.label}>Reasoning</Text>
            <Text style={thoughtStyles.text} selectable>{text}</Text>
        </View>
    );
}

function MetaRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
    return (
        <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{label}</Text>
            <Text style={[styles.metaValue, accent !== undefined ? { color: accent } : undefined]} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function ToolSpinner() {
    const spinAnim = React.useRef(new Animated.Value(0)).current;
    React.useEffect(() => {
        const loop = Animated.loop(Animated.timing(spinAnim, { toValue: 1, duration: 900, useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [spinAnim]);
    const rotation = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
    return <Animated.View style={[spinnerStyles.ring, { transform: [{ rotate: rotation }] }]} />;
}

// ─── Detail sheet content ─────────────────────────────────────────────────────

function ToolDetail({ item, kind, args }: { item: ToolItem; kind: ToolKind; args: ParsedArgs }) {
    const statusColor = item.status === "failed" ? colors.error
        : item.status === "running" ? colors.accent
        : colors.success;

    return (
        <View style={styles.detailContainer}>
            {/* Status + tool name */}
            <View style={styles.metaSection}>
                <MetaRow label="Tool" value={item.toolName} />
                <MetaRow
                    label="Status"
                    value={item.status === "running" ? "Running…" : item.status === "failed" ? "Failed" : "Completed"}
                    accent={statusColor}
                />
                {args.path !== undefined && (
                    <MetaRow label="File" value={args.path} />
                )}
            </View>

            {/* Kind-specific content */}
            {kind === "edit" && args.oldStr !== undefined && args.newStr !== undefined && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>CHANGES</Text>
                    <DiffView oldStr={args.oldStr} newStr={args.newStr} />
                </View>
            )}

            {kind === "create" && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>NEW FILE</Text>
                    <CreateView path={args.path} content={args.content ?? args.newStr} />
                </View>
            )}

            {(kind === "shell" || kind === "git") && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>COMMAND</Text>
                    <TerminalBlock
                        command={args.command ?? item.progressMessage ?? null}
                        output={item.partialOutput ?? item.progressMessage}
                    />
                </View>
            )}

            {kind === "think" && args.thought !== undefined && (
                <ThoughtBlock text={args.thought} />
            )}

            {kind === "read" && item.partialOutput !== undefined && item.partialOutput.trim().length > 0 && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>CONTENT</Text>
                    <View style={terminalStyles.container}>
                        <Text style={terminalStyles.outputLine} selectable>{item.partialOutput.trim()}</Text>
                    </View>
                </View>
            )}

            {kind === "search" && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>RESULTS</Text>
                    <View style={terminalStyles.container}>
                        {args.query !== undefined && (
                            <View style={terminalStyles.promptRow}>
                                <Text style={terminalStyles.prompt}>~</Text>
                                <Text style={terminalStyles.command} selectable>{args.query}</Text>
                            </View>
                        )}
                        {item.partialOutput !== undefined && item.partialOutput.trim().length > 0 && (
                            <View style={terminalStyles.outputBlock}>
                                {item.partialOutput.trim().split("\n").slice(0, 80).map((line, i) => (
                                    <Text key={i} style={terminalStyles.outputLine} selectable>{line}</Text>
                                ))}
                            </View>
                        )}
                    </View>
                </View>
            )}

            {/* Fallback: raw args if nothing else matched */}
            {kind === "other" && item.argumentsText !== undefined && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>ARGUMENTS</Text>
                    <View style={terminalStyles.container}>
                        <Text style={[terminalStyles.outputLine, { color: colors.textSecondary }]} selectable>
                            {item.argumentsText}
                        </Text>
                    </View>
                </View>
            )}
        </View>
    );
}

// ─── Compact row ──────────────────────────────────────────────────────────────

function getRowSummary(kind: ToolKind, args: ParsedArgs, item: ToolItem): string {
    if (item.status === "running" && item.progressMessage !== undefined) return item.progressMessage;
    switch (kind) {
        case "edit":
        case "create":
        case "read":
            return shortPath(args.path) || args.query || "";
        case "shell":
        case "git":
            return args.command ?? "";
        case "search":
            return args.query ?? args.pattern ?? "";
        case "think":
            return (args.thought ?? "").slice(0, 60) + ((args.thought ?? "").length > 60 ? "…" : "");
        case "fetch":
            return args.query ?? args.path ?? "";
        default: {
            const first = args.path ?? args.command ?? args.query ?? args.content ?? "";
            return first.slice(0, 60);
        }
    }
}

// ─── Main component ───────────────────────────────────────────────────────────

function ToolCardComponent({ item }: Props) {
    const [showSheet, setShowSheet] = useState(false);
    const isRunning = item.status === "running";
    const isFailed = item.status === "failed";
    const kind = classifyTool(item.toolName);
    const label = KIND_LABELS[kind];
    const iconName = KIND_ICONS[kind];
    const args = useMemo(() => parseArgs(item.argumentsText), [item.argumentsText]);
    const rowSummary = getRowSummary(kind, args, item);
    const statusText = isRunning ? "running" : isFailed ? "failed" : "completed";

    return (
        <>
            <View style={styles.rowWrap}>
                <Pressable
                    style={styles.row}
                    onPress={() => setShowSheet(true)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                    <View style={[styles.iconBox, isFailed && styles.iconBoxFailed]}>
                        {isRunning ? <ToolSpinner /> : (
                            <ToolIcon toolName={item.toolName} size={11} color={isFailed ? colors.error : colors.textTertiary} />
                        )}
                    </View>
                    <ShimmerText active={isRunning}>
                        <Text style={[styles.label, isFailed && styles.labelFailed]} numberOfLines={1}>
                            {label}
                        </Text>
                    </ShimmerText>
                    <Text style={styles.argText} numberOfLines={1}>{rowSummary}</Text>
                    <Text style={styles.chevron}>›</Text>
                </Pressable>
            </View>

            <BottomSheet
                visible={showSheet}
                onClose={() => setShowSheet(false)}
                iconName={iconName}
                title={label}
                subtitle={statusText}
            >
                <ToolDetail item={item} kind={kind} args={args} />
            </BottomSheet>
        </>
    );
}

export const ToolCard = React.memo(ToolCardComponent);

// ─── Styles ───────────────────────────────────────────────────────────────────

const spinnerStyles = StyleSheet.create({
    ring: {
        width: 10, height: 10, borderRadius: 5,
        borderWidth: 1.5, borderColor: "transparent",
        borderTopColor: colors.accent, borderRightColor: colors.accentMuted,
    },
});

const diffStyles = StyleSheet.create({
    container: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
    },
    fileHeader: {
        backgroundColor: "#1c2128",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    fileHeaderText: {
        fontSize: fontSize.xs,
        fontFamily: "monospace",
        color: "#57ab5a",
        fontWeight: "600",
    },
    line: {
        flexDirection: "row",
        paddingHorizontal: 8,
        paddingVertical: 1,
        minHeight: 18,
    },
    lineAdd: { backgroundColor: "rgba(87,171,90,0.12)" },
    lineRemove: { backgroundColor: "rgba(229,83,75,0.12)" },
    prefix: {
        width: 14,
        fontSize: fontSize.xs,
        lineHeight: 17,
        fontFamily: "monospace",
        fontWeight: "700",
        flexShrink: 0,
    },
    prefixAdd: { color: "#57ab5a" },
    prefixRemove: { color: "#e5534b" },
    prefixContext: { color: colors.textTertiary },
    text: {
        flex: 1,
        fontSize: fontSize.xs,
        lineHeight: 17,
        fontFamily: "monospace",
    },
    textAdd: { color: "#aff5b4" },
    textRemove: { color: "#ffdcd7" },
    textContext: { color: colors.textSecondary },
    textSkip: { color: colors.textTertiary, fontStyle: "italic" },
    empty: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        fontStyle: "italic",
        textAlign: "center",
        padding: spacing.md,
    },
});

const terminalStyles = StyleSheet.create({
    container: {
        backgroundColor: "#0d1117",
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        gap: 4,
    },
    promptRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    prompt: {
        color: colors.success,
        fontFamily: "monospace",
        fontSize: fontSize.sm,
        lineHeight: 18,
        fontWeight: "700",
    },
    command: {
        flex: 1,
        color: "#e6edf3",
        fontFamily: "monospace",
        fontSize: fontSize.sm,
        lineHeight: 18,
    },
    outputBlock: { marginTop: 6, gap: 2 },
    outputLine: {
        color: "#8b949e",
        fontFamily: "monospace",
        fontSize: fontSize.xs,
        lineHeight: 16,
    },
});

const thoughtStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.bgElevated,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: colors.accent,
        padding: spacing.md,
        gap: 4,
    },
    label: {
        fontSize: fontSize.xs,
        fontWeight: "600",
        color: colors.accent,
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    text: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        lineHeight: 20,
    },
});

const styles = StyleSheet.create({
    rowWrap: {
        overflow: "hidden",
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 5,
        paddingHorizontal: spacing.lg,
        gap: 6,
        minHeight: 28,
    },
    iconBox: {
        width: 20, height: 20, borderRadius: 5,
        justifyContent: "center", alignItems: "center", flexShrink: 0,
    },
    iconBoxFailed: { opacity: 0.5 },
    label: {
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        fontWeight: "500",
        flexShrink: 0,
        minWidth: 36,
    },
    labelFailed: { color: colors.error },
    argText: {
        flex: 1,
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        fontFamily: "monospace",
    },
    chevron: {
        fontSize: 16,
        color: colors.textTertiary,
        lineHeight: 18,
    },
    detailContainer: {
        gap: spacing.lg,
    },
    metaSection: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
        overflow: "hidden",
    },
    metaRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderMuted,
    },
    metaLabel: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    metaValue: {
        fontSize: fontSize.sm,
        color: colors.textSecondary,
        fontFamily: "monospace",
        maxWidth: "65%",
        textAlign: "right",
    },
    diffSection: { gap: 6 },
    sectionTitle: {
        fontSize: fontSize.xs,
        fontWeight: "700",
        color: colors.textTertiary,
        letterSpacing: 0.6,
    },
});


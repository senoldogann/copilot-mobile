// Araç yürütme kartı — kompakt tek satır terminal stili ile SVG ikonlar

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, InteractionManager, ActivityIndicator } from "react-native";
import type { ToolItem } from "../stores/session-store-types";
import { BottomSheet } from "./BottomSheet";
import { ToolIcon, SubagentIcon, SkillIcon } from "./Icons";
import type { FeatherName } from "./Icons";
import { SunshineText } from "./ShimmerHighlight";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";
import { isSubagentToolName, parseToolArgumentsText } from "../utils/tool-introspection";

type Props = { item: ToolItem };

// ─── Tool classification ──────────────────────────────────────────────────────

type ToolKind = "edit" | "create" | "shell" | "read" | "search" | "think" | "git" | "fetch" | "agent" | "skill" | "other";

const EMPTY_PARSED_ARGS: ParsedArgs = {};

function classifyTool(toolName: string): ToolKind {
    const t = toolName.toLowerCase();
    if (isSubagentToolName(t)) return "agent";
    if (t === "skill") return "skill";
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
    search: "Search", think: "Thought", git: "Git", fetch: "Fetch", agent: "Subagent", skill: "Skill", other: "Tool",
};

const KIND_ICONS: Record<ToolKind, FeatherName> = {
    edit: "edit-2", create: "file-plus", shell: "terminal", read: "eye",
    search: "search", think: "cpu", git: "git-branch", fetch: "globe", agent: "cpu", skill: "tool", other: "tool",
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
    description?: string;
    prompt?: string;
    agentName?: string;
    agentType?: string;
    skill?: string;
    raw?: Record<string, unknown>;
}

function parseArgs(text: string | undefined): ParsedArgs {
    const parsed = parseToolArgumentsText(text);
    if (parsed === null) {
        return {};
    }

    return {
        raw: parsed.raw,
        ...(parsed.path !== undefined ? { path: parsed.path } : {}),
        ...(parsed.oldStr !== undefined ? { oldStr: parsed.oldStr } : {}),
        ...(parsed.newStr !== undefined ? { newStr: parsed.newStr } : {}),
        ...(parsed.command !== undefined ? { command: parsed.command } : {}),
        ...(parsed.content !== undefined ? { content: parsed.content } : {}),
        ...(parsed.query !== undefined ? { query: parsed.query } : {}),
        ...(parsed.pattern !== undefined ? { pattern: parsed.pattern } : {}),
        ...(parsed.thought !== undefined ? { thought: parsed.thought } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.prompt !== undefined ? { prompt: parsed.prompt } : {}),
        ...(parsed.agentName !== undefined ? { agentName: parsed.agentName } : {}),
        ...(parsed.agentType !== undefined ? { agentType: parsed.agentType } : {}),
        ...(parsed.skill !== undefined ? { skill: parsed.skill } : {}),
    };
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
    const diffStyles = useThemedStyles(createDiffStyles);
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
    const diffStyles = useThemedStyles(createDiffStyles);
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

function TerminalBlock({ command, output, exitOk }: { command: string | null; output: string | undefined; exitOk?: boolean }) {
    const terminalStyles = useThemedStyles(createTerminalStyles);
    const outputLines = (output ?? "").trim().split("\n").filter((l) => l.length > 0 || output?.trim().length === 0);
    return (
        <View style={terminalStyles.container}>
            {/* Command line */}
            {command !== null && (
                <View style={terminalStyles.promptRow}>
                    <Text style={terminalStyles.prompt}>$</Text>
                    <Text style={terminalStyles.command} selectable>{command}</Text>
                </View>
            )}

            {/* Separator line between command and output */}
            {command !== null && outputLines.length > 0 && (
                <View style={terminalStyles.divider} />
            )}

            {/* Output */}
            {outputLines.length > 0 && (
                <View style={terminalStyles.outputBlock}>
                    {outputLines.slice(0, 200).map((line, i) => (
                        <Text key={i} style={[
                            terminalStyles.outputLine,
                            // Highlight lines that look like errors
                            /^(error|fatal|failed|exception|traceback)\b/i.test(line.trim()) && terminalStyles.outputError,
                            // Highlight lines that look like success
                            /^(success|done|ok\b|passed|complete)\b/i.test(line.trim()) && terminalStyles.outputSuccess,
                        ]} selectable>{line}</Text>
                    ))}
                    {outputLines.length > 200 && (
                        <Text style={terminalStyles.truncated}>… {outputLines.length - 200} more lines</Text>
                    )}
                </View>
            )}

            {/* Exit status badge */}
            {exitOk !== undefined && (
                <View style={[terminalStyles.exitBadge, exitOk ? terminalStyles.exitOk : terminalStyles.exitFail]}>
                    <Text style={terminalStyles.exitText}>{exitOk ? "exit 0" : "exit ≠ 0"}</Text>
                </View>
            )}
        </View>
    );
}

function FileReadView({ path, content }: { path: string | undefined; content: string }) {
    const diffStyles = useThemedStyles(createDiffStyles);
    const fileReadStyles = useThemedStyles(createFileReadStyles);
    const lines = content.split("\n");
    const lineNumWidth = String(lines.length).length;
    return (
        <View style={diffStyles.container}>
            {/* File path header */}
            {path !== undefined && (
                <View style={diffStyles.fileHeader}>
                    <Text style={diffStyles.fileHeaderText}>
                        {path}
                    </Text>
                </View>
            )}
            {/* Content with line numbers */}
            {lines.slice(0, 300).map((line, i) => (
                <View key={i} style={diffStyles.line}>
                    <Text style={fileReadStyles.lineNum}>
                        {String(i + 1).padStart(lineNumWidth, " ")}
                    </Text>
                    <Text style={fileReadStyles.lineText} selectable>
                        {line}
                    </Text>
                </View>
            ))}
            {lines.length > 300 && (
                <View style={[diffStyles.line, { paddingVertical: 4 }]}>
                    <Text style={diffStyles.textSkip}>… {lines.length - 300} more lines</Text>
                </View>
            )}
        </View>
    );
}

function ThoughtBlock({ text }: { text: string }) {
    const thoughtStyles = useThemedStyles(createThoughtStyles);
    return (
        <View style={thoughtStyles.container}>
            <Text style={thoughtStyles.label}>Reasoning</Text>
            <Text style={thoughtStyles.text} selectable>{text}</Text>
        </View>
    );
}

function AgentBlock({
    title,
    subtitle,
    prompt,
    output,
}: {
    title: string;
    subtitle?: string;
    prompt?: string;
    output?: string;
}) {
    const thoughtStyles = useThemedStyles(createThoughtStyles);
    const agentStyles = useThemedStyles(createAgentStyles);
    const styles = useThemedStyles(createStyles);
    return (
        <View style={thoughtStyles.container}>
            <Text style={thoughtStyles.label}>{title}</Text>
            {subtitle !== undefined && subtitle.length > 0 && (
                <Text style={agentStyles.subtitle}>{subtitle}</Text>
            )}
            {prompt !== undefined && prompt.trim().length > 0 && (
                <>
                    <Text style={styles.sectionTitle}>PROMPT</Text>
                    <Text style={agentStyles.prompt} selectable>{prompt}</Text>
                </>
            )}
            {output !== undefined && output.trim().length > 0 && (
                <>
                    <Text style={styles.sectionTitle}>OUTPUT</Text>
                    <TerminalBlock command={null} output={output} />
                </>
            )}
        </View>
    );
}

function MetaRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{label}</Text>
            <Text style={[styles.metaValue, accent !== undefined ? { color: accent } : undefined]} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

// ─── Detail sheet content ─────────────────────────────────────────────────────

function ToolDetail({ item, kind, args }: { item: ToolItem; kind: ToolKind; args: ParsedArgs }) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const diffStyles = useThemedStyles(createDiffStyles);
    const statusColor = item.status === "failed"
        ? theme.colors.error
        : item.status === "running"
            ? theme.colors.textSecondary
            : item.status === "no_results"
                ? theme.colors.textTertiary
                : theme.colors.success;

    return (
        <View style={styles.detailContainer}>
            {/* Status + tool name */}
            <View style={styles.metaSection}>
                <MetaRow label="Tool" value={item.toolName} />
                <MetaRow
                    label="Status"
                    value={
                        item.status === "running"
                            ? "Running…"
                            : item.status === "failed"
                                ? "Failed"
                                : item.status === "no_results"
                                    ? "No Results"
                                    : "Completed"
                    }
                    accent={statusColor}
                />
                {args.path !== undefined && (
                    <MetaRow label="File" value={args.path} />
                )}
                {item.errorMessage !== undefined && item.errorMessage.trim().length > 0 && item.status === "failed" && (
                    <MetaRow label="Error" value={item.errorMessage} accent={theme.colors.error} />
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
                        output={item.partialOutput ?? item.errorMessage ?? item.progressMessage}
                        {...(item.status === "completed"
                            ? { exitOk: true }
                            : item.status === "failed"
                                ? { exitOk: false }
                                : {})}
                    />
                </View>
            )}

            {kind === "think" && args.thought !== undefined && (
                <ThoughtBlock text={args.thought} />
            )}

            {kind === "agent" && (
                <AgentBlock
                    title={args.agentName ?? args.agentType ?? "Subagent"}
                    {...(args.description !== undefined ? { subtitle: args.description } : {})}
                    {...(args.prompt !== undefined ? { prompt: args.prompt } : {})}
                    {...(item.partialOutput !== undefined ? { output: item.partialOutput } : {})}
                />
            )}

            {kind === "skill" && (
                <AgentBlock
                    title={args.skill ?? "Skill"}
                    {...(args.description !== undefined ? { subtitle: args.description } : {})}
                    {...(args.prompt !== undefined ? { prompt: args.prompt } : {})}
                    {...(item.partialOutput !== undefined ? { output: item.partialOutput } : {})}
                />
            )}

            {kind === "read" && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>FILE CONTENT</Text>
                    {(item.partialOutput !== undefined && item.partialOutput.trim().length > 0) ? (
                        <FileReadView path={args.path} content={item.partialOutput.trim()} />
                    ) : (
                        <View style={diffStyles.container}>
                            <Text style={diffStyles.empty}>
                                {item.status === "running"
                                    ? "Reading…"
                                    : item.status === "failed" && item.errorMessage !== undefined
                                        ? item.errorMessage
                                        : "No content captured"}
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {kind === "search" && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>RESULTS</Text>
                    <TerminalBlock
                        command={args.query !== undefined ? `search: ${args.query}` : null}
                        output={item.partialOutput ?? item.errorMessage}
                    />
                </View>
            )}

            {kind === "fetch" && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>RESPONSE</Text>
                    <TerminalBlock
                        command={args.path ?? args.query ?? null}
                        output={item.partialOutput}
                    />
                </View>
            )}

            {/* Fallback: raw args if nothing else matched */}
            {kind === "other" && item.argumentsText !== undefined && (
                <View style={styles.diffSection}>
                    <Text style={styles.sectionTitle}>ARGUMENTS</Text>
                    <TerminalBlock command={null} output={item.argumentsText} />
                </View>
            )}
        </View>
    );
}

// ─── Compact row ──────────────────────────────────────────────────────────────

function getRowSummary(kind: ToolKind, args: ParsedArgs, item: ToolItem): string {
    if (item.status === "running" && item.progressMessage !== undefined && item.progressMessage.length > 0) {
        return item.progressMessage;
    }
    switch (kind) {
        case "agent":
            return args.description ?? args.agentName ?? args.agentType ?? "Subagent run";
        case "skill":
            return args.description ?? args.skill ?? "Skill run";
        case "edit":
            return shortPath(args.path) || (args.oldStr ?? "").slice(0, 40) || "";
        case "create":
            return shortPath(args.path) || (args.content ?? "").split("\n")[0]?.slice(0, 40) || "";
        case "read":
            return shortPath(args.path) || args.query || "";
        case "shell":
        case "git":
            return args.command ?? item.progressMessage ?? "";
        case "search":
            return args.query ?? args.pattern ?? "";
        case "think":
            return (args.thought ?? "").slice(0, 60) + ((args.thought ?? "").length > 60 ? "…" : "");
        case "fetch":
            return args.query ?? args.path ?? "";
        default: {
            const first = args.path ?? args.command ?? args.query ?? args.content ?? item.progressMessage ?? "";
            if (first.length > 0) return first.slice(0, 60);
            // Fallback: extract first meaningful string from raw args
            if (args.raw !== undefined) {
                const rawEntry = Object.values(args.raw).find((v) => typeof v === "string" && v.length > 0);
                if (rawEntry !== undefined) return (rawEntry as string).slice(0, 60);
            }
            return "";
        }
    }
}

// ─── Main component ───────────────────────────────────────────────────────────

function ToolCardComponent({ item }: Props) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const [showSheet, setShowSheet] = useState(false);
    const [detailReady, setDetailReady] = useState(false);
    const isRunning = item.status === "running";
    const isFailed = item.status === "failed";
    const isNoResults = item.status === "no_results";
    const kind = classifyTool(item.toolName);
    const label = KIND_LABELS[kind];
    const iconName = KIND_ICONS[kind];
    const previewArgs = useMemo(() => parseArgs(item.argumentsText), [item.argumentsText]);
    const detailArgs = useMemo(
        () => (detailReady ? parseArgs(item.argumentsText) : EMPTY_PARSED_ARGS),
        [detailReady, item.argumentsText]
    );
    const rowSummary = useMemo(
        () => getRowSummary(kind, previewArgs, item),
        [item, kind, previewArgs]
    );
    const statusText = isRunning ? "running" : isFailed ? "failed" : isNoResults ? "no results" : "completed";
    const iconColor = isFailed ? theme.colors.error : theme.colors.textTertiary;

    useEffect(() => {
        if (!showSheet) {
            setDetailReady(false);
            return;
        }

        const task = InteractionManager.runAfterInteractions(() => {
            setDetailReady(true);
        });

        return () => {
            task.cancel();
        };
    }, [showSheet]);

    return (
        <>
            <View style={styles.rowWrap}>
                <Pressable
                    style={styles.row}
                    onPress={() => setShowSheet(true)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                    <View style={[styles.iconBox, isFailed && styles.iconBoxFailed]}>
                        <ToolIcon toolName={item.toolName} size={11} color={iconColor} />
                    </View>
                    {isRunning ? (
                        <SunshineText
                            active
                            text={rowSummary.length > 0 ? `${label}  ${rowSummary}` : label}
                            textStyle={styles.sunshineRow}
                            style={styles.shimmerFlex}
                            numberOfLines={1}
                        />
                    ) : (
                        <View style={[styles.contentWrap, styles.shimmerFlex]}>
                            <View style={styles.labelWrap}>
                                <Text style={[styles.label, isFailed && styles.labelFailed]} numberOfLines={1}>
                                    {label}
                                </Text>
                            </View>
                            <View style={styles.argWrap}>
                                <Text
                                    style={[styles.argText, isNoResults && styles.argTextMuted]}
                                    numberOfLines={1}
                                >
                                    {isNoResults && rowSummary.length === 0 ? "No results" : rowSummary}
                                </Text>
                            </View>
                        </View>
                    )}
                    <Text style={styles.chevron}>›</Text>
                </Pressable>
            </View>

            <BottomSheet
                visible={showSheet}
                onClose={() => setShowSheet(false)}
                {...(kind === "agent"
                    ? { iconNode: <SubagentIcon size={14} color={theme.colors.textSecondary} /> }
                    : kind === "skill"
                        ? { iconNode: <SkillIcon size={14} color={theme.colors.textSecondary} /> }
                        : { iconName }
                )}
                title={label}
                subtitle={statusText}
            >
                {detailReady ? (
                    <ToolDetail item={item} kind={kind} args={detailArgs} />
                ) : (
                    <View style={styles.detailLoadingState}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={styles.detailLoadingText}>Loading tool details…</Text>
                    </View>
                )}
            </BottomSheet>
        </>
    );
}

export const ToolCard = React.memo(ToolCardComponent);

// ─── Styles ───────────────────────────────────────────────────────────────────

const createDiffStyles = (theme: AppTheme) => StyleSheet.create({
    container: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.codeBorder,
        backgroundColor: theme.colors.codeBg,
        overflow: "hidden",
    },
    fileHeader: {
        backgroundColor: theme.colors.bgTertiary,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.codeBorder,
    },
    fileHeaderText: {
        fontSize: theme.fontSize.xs,
        fontFamily: "monospace",
        color: theme.colors.textSecondary,
        fontWeight: "600",
    },
    line: {
        flexDirection: "row",
        paddingHorizontal: 8,
        paddingVertical: 1,
        minHeight: 18,
    },
    lineAdd: { backgroundColor: theme.colors.successMuted },
    lineRemove: { backgroundColor: theme.colors.errorMuted },
    prefix: {
        width: 14,
        fontSize: theme.fontSize.xs,
        lineHeight: 17,
        fontFamily: "monospace",
        fontWeight: "700",
        flexShrink: 0,
    },
    prefixAdd: { color: theme.colors.success },
    prefixRemove: { color: theme.colors.error },
    prefixContext: { color: theme.colors.textTertiary },
    text: {
        flex: 1,
        fontSize: theme.fontSize.xs,
        lineHeight: 17,
        fontFamily: "monospace",
    },
    textAdd: { color: theme.colors.textPrimary },
    textRemove: { color: theme.colors.textPrimary },
    textContext: { color: theme.colors.textSecondary },
    textSkip: { color: theme.colors.textTertiary, fontStyle: "italic" },
    empty: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        fontStyle: "italic",
        textAlign: "center",
        padding: theme.spacing.md,
    },
});

const createTerminalStyles = (theme: AppTheme) => StyleSheet.create({
    container: {
        backgroundColor: theme.colors.codeBg,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.codeBorder,
        overflow: "hidden",
    },
    promptRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 8,
        backgroundColor: theme.colors.bgTertiary,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.codeBorder,
    },
    prompt: {
        color: theme.colors.success,
        fontFamily: "monospace",
        fontSize: theme.fontSize.sm,
        lineHeight: 18,
        fontWeight: "700",
        flexShrink: 0,
    },
    command: {
        flex: 1,
        color: theme.colors.textPrimary,
        fontFamily: "monospace",
        fontSize: theme.fontSize.sm,
        lineHeight: 18,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.codeBorder,
    },
    outputBlock: {
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        gap: 1,
    },
    outputLine: {
        color: theme.colors.textSecondary,
        fontFamily: "monospace",
        fontSize: theme.fontSize.xs,
        lineHeight: 16,
    },
    outputError: {
        color: theme.colors.error,
    },
    outputSuccess: {
        color: theme.colors.success,
    },
    truncated: {
        color: theme.colors.textTertiary,
        fontFamily: "monospace",
        fontSize: theme.fontSize.xs,
        fontStyle: "italic",
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
    },
    exitBadge: {
        alignSelf: "flex-end",
        margin: theme.spacing.sm,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
    },
    exitOk: {
        borderColor: theme.colors.success,
        backgroundColor: theme.colors.successMuted,
    },
    exitFail: {
        borderColor: theme.colors.error,
        backgroundColor: theme.colors.errorMuted,
    },
    exitText: {
        color: theme.colors.textSecondary,
        fontFamily: "monospace",
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
    },
});

const createFileReadStyles = (theme: AppTheme) => StyleSheet.create({
    lineNum: {
        color: theme.colors.textTertiary,
        fontFamily: "monospace",
        fontSize: theme.fontSize.xs,
        lineHeight: 17,
        textAlign: "right",
        marginRight: 10,
        flexShrink: 0,
        userSelect: "none",
    } as const,
    lineText: {
        flex: 1,
        color: theme.colors.codeText,
        fontFamily: "monospace",
        fontSize: theme.fontSize.xs,
        lineHeight: 17,
    },
});

const createThoughtStyles = (theme: AppTheme) => StyleSheet.create({
    container: {
        backgroundColor: theme.colors.bgElevated,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.md,
        gap: 4,
    },
    label: {
        fontSize: theme.fontSize.xs,
        fontWeight: "600",
        color: theme.colors.textAssistant,
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    text: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textAssistant,
        lineHeight: 20,
    },
});

const createAgentStyles = (theme: AppTheme) => StyleSheet.create({
    subtitle: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textAssistant,
        lineHeight: 18,
        marginBottom: 10,
    },
    prompt: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textPrimary,
        lineHeight: 20,
        marginBottom: 10,
    },
});

const createStyles = (theme: AppTheme) => StyleSheet.create({
    rowWrap: {
        overflow: "hidden",
        minHeight: 30,
    },
    shimmerFlex: {
        flex: 1,
        minWidth: 0,
    },
    sunshineRow: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textSecondary,
        fontWeight: "500",
        lineHeight: 18,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 3,
        paddingHorizontal: theme.spacing.lg,
        gap: 6,
        minHeight: 30,
    },
    iconBox: {
        width: 20, height: 20, borderRadius: 5,
        justifyContent: "center", alignItems: "center", flexShrink: 0,
    },
    iconBoxFailed: { opacity: 0.5 },
    contentWrap: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    labelWrap: {
        flexShrink: 0,
    },
    label: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textSecondary,
        fontWeight: "500",
        lineHeight: 18,
    },
    labelFailed: { color: theme.colors.error },
    argWrap: {
        flex: 1,
        minWidth: 0,
    },
    argText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textSecondary,
        fontFamily: "monospace",
        lineHeight: 18,
    },
    argTextMuted: {
        color: theme.colors.textAssistant,
    },
    chevron: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    detailContainer: {
        gap: theme.spacing.lg,
    },
    detailLoadingState: {
        minHeight: 160,
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.sm,
    },
    detailLoadingText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textSecondary,
    },
    metaSection: {
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bgElevated,
        overflow: "hidden",
    },
    metaRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.borderMuted,
    },
    metaLabel: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    metaValue: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textAssistant,
        fontFamily: "monospace",
        maxWidth: "65%",
        textAlign: "right",
    },
    diffSection: { gap: 6 },
    sectionTitle: {
        fontSize: theme.fontSize.xs,
        fontWeight: "700",
        color: theme.colors.textSecondary,
        letterSpacing: 0.6,
    },
});

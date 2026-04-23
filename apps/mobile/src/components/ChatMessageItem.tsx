// Sohbet mesaj öğesi — GitHub Copilot mobil tasarım diliyle markdown render

import React, { useState, useMemo } from "react";
import {
    View,
    Text,
    Pressable,
    Alert,
    ScrollView,
    StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import type { SessionMessageAttachment } from "@copilot-mobile/shared";
import { insertIntoComposer } from "../services/composer-events";
import type { ChatItem } from "../stores/session-store-types";
import { ThinkingBubble } from "./ThinkingBubble";
import { ToolCard } from "./ToolCard";
import { FileContentViewer } from "./FileContentViewer";
import { useAppTheme, useThemedStyles, type AppTheme } from "../theme/theme-context";
import { ArrowUpIcon, CopyIcon } from "./ProviderIcon";
type Props = {
    item: ChatItem;
};

const scrollPassThroughResponderProps = {
    onStartShouldSetResponder: () => false,
    onMoveShouldSetResponder: () => false,
    onStartShouldSetResponderCapture: () => false,
    onMoveShouldSetResponderCapture: () => false,
};



// --- Lightweight Markdown Renderer ---

type MarkdownSegment =
    | { kind: "text"; value: string }
    | { kind: "bold"; value: string }
    | { kind: "italic"; value: string }
    | { kind: "code"; value: string }
    | { kind: "file"; value: string };

// Parse inline markdown elements
function parseInlineMarkdown(text: string): ReadonlyArray<MarkdownSegment> {
    const segments: Array<MarkdownSegment> = [];
    // Match: **bold**, *italic*, `code`, and file paths
    const inlineRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlineRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const preceding = text.slice(lastIndex, match.index);
            segments.push(...parseFilePaths(preceding));
        }

        if (match[2] !== undefined) {
            segments.push({ kind: "bold", value: match[2] });
        } else if (match[3] !== undefined) {
            segments.push({ kind: "italic", value: match[3] });
        } else if (match[4] !== undefined) {
            // Check if it looks like a file path
            if (isFilePath(match[4])) {
                segments.push({ kind: "file", value: match[4] });
            } else {
                segments.push({ kind: "code", value: match[4] });
            }
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        segments.push(...parseFilePaths(text.slice(lastIndex)));
    }

    return segments;
}

// Detect file paths in plain text
function isFilePath(text: string): boolean {
    return /^[a-zA-Z0-9_\-./\\…]+\.[a-zA-Z]{1,10}(:\d+(?:-\d+)?)?$/.test(text) &&
        text.includes(".");
}

function parseFilePaths(text: string): ReadonlyArray<MarkdownSegment> {
    // Match file paths like /repo/src/foo.ts, src/foo.ts, ./file.tsx, .../foo.ts, packages/shared/index.ts
    const fileRegex = /(?:^|\s)((?:(?:\/|(?:\.{3}|…)\/|\.\/|\.\.\/|[a-zA-Z0-9_\-]+\/))*[a-zA-Z0-9_\-]+\.[a-zA-Z]{1,10}(?::\d+(?:-\d+)?)?)(?=\s|$|[,.)}\]])/g;
    const segments: Array<MarkdownSegment> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = fileRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const filePath = match[1] ?? "";
        const startPos = match.index + (fullMatch.length - filePath.length);

        if (startPos > lastIndex) {
            segments.push({ kind: "text", value: text.slice(lastIndex, startPos) });
        }
        segments.push({ kind: "file", value: filePath });
        lastIndex = startPos + filePath.length;
    }

    if (lastIndex < text.length) {
        segments.push({ kind: "text", value: text.slice(lastIndex) });
    }

    if (segments.length === 0) {
        segments.push({ kind: "text", value: text });
    }

    return segments;
}

// Render inline markdown segments
function InlineMarkdown({ segments }: { segments: ReadonlyArray<MarkdownSegment> }) {
    const mdStyles = useThemedStyles(createMarkdownStyles);
    return (
        <Text style={mdStyles.inlineText}>
            {segments.map((seg, i) => {
                switch (seg.kind) {
                    case "bold":
                        return (
                            <Text key={i} style={mdStyles.bold}>
                                {seg.value}
                            </Text>
                        );
                    case "italic":
                        return (
                            <Text key={i} style={mdStyles.italic}>
                                {seg.value}
                            </Text>
                        );
                    case "code":
                        return (
                            <Text key={i} style={mdStyles.inlineCode}>
                                {seg.value}
                            </Text>
                        );
                    case "file":
                        return <FileLink key={i} path={seg.value} />;
                    case "text":
                    default:
                        return <Text key={i}>{seg.value}</Text>;
                }
            })}
        </Text>
    );
}

// File viewer context — lets FileLink open viewer from deep inside Text tree
const FileViewerContext = React.createContext<(path: string) => void>(() => undefined);

// File link — colored, tappable to open content viewer
function FileLink({ path }: { path: string }) {
    const openFile = React.useContext(FileViewerContext);
    const mdStyles = useThemedStyles(createMarkdownStyles);
    return (
        <Text style={mdStyles.fileLink} onPress={() => openFile(path)}>
            {path}
        </Text>
    );
}

// File content viewer lives in its own file so workspace panel can reuse it.
// See ./FileContentViewer.tsx

// Parse full markdown content into renderable blocks
type MarkdownBlock =
    | { kind: "paragraph"; segments: ReadonlyArray<MarkdownSegment> }
    | { kind: "heading"; level: number; text: string }
    | { kind: "code_block"; language: string; code: string }
    | { kind: "bullet"; indent: number; segments: ReadonlyArray<MarkdownSegment> }
    | { kind: "numbered"; number: string; indent: number; segments: ReadonlyArray<MarkdownSegment> }
    | { kind: "table"; headers: ReadonlyArray<string>; rows: ReadonlyArray<ReadonlyArray<string>> }
    | { kind: "hr" };

const MAX_MARKDOWN_CACHE_ENTRIES = 200;
const markdownBlockCache = new Map<string, ReadonlyArray<MarkdownBlock>>();

function readMarkdownCache(content: string): ReadonlyArray<MarkdownBlock> | null {
    const cached = markdownBlockCache.get(content);
    if (cached === undefined) {
        return null;
    }

    markdownBlockCache.delete(content);
    markdownBlockCache.set(content, cached);
    return cached;
}

function writeMarkdownCache(content: string, blocks: ReadonlyArray<MarkdownBlock>): void {
    if (markdownBlockCache.has(content)) {
        markdownBlockCache.delete(content);
    }

    markdownBlockCache.set(content, blocks);
    if (markdownBlockCache.size <= MAX_MARKDOWN_CACHE_ENTRIES) {
        return;
    }

    const oldestKey = markdownBlockCache.keys().next().value;
    if (typeof oldestKey === "string") {
        markdownBlockCache.delete(oldestKey);
    }
}

function parseMarkdown(content: string): ReadonlyArray<MarkdownBlock> {
    const cached = readMarkdownCache(content);
    if (cached !== null) {
        return cached;
    }

    const lines = content.split("\n");
    const blocks: Array<MarkdownBlock> = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i]!;

        // Code block
        if (line.startsWith("```")) {
            const language = line.slice(3).trim();
            const codeLines: Array<string> = [];
            i += 1;
            while (i < lines.length && !lines[i]!.startsWith("```")) {
                codeLines.push(lines[i]!);
                i += 1;
            }
            blocks.push({ kind: "code_block", language, code: codeLines.join("\n") });
            i += 1;
            continue;
        }

        // Table detection
        if (
            line.includes("|") &&
            i + 1 < lines.length &&
            /^\s*\|?\s*[-:]+/.test(lines[i + 1]!)
        ) {
            const headerCells = line.split("|").map((c) => c.trim()).filter(Boolean);
            i += 2; // skip header + separator
            const tableRows: Array<Array<string>> = [];
            while (i < lines.length && lines[i]!.includes("|")) {
                const cells = lines[i]!.split("|").map((c) => c.trim()).filter(Boolean);
                tableRows.push(cells);
                i += 1;
            }
            blocks.push({ kind: "table", headers: headerCells, rows: tableRows });
            continue;
        }

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            blocks.push({
                kind: "heading",
                level: headingMatch[1]!.length,
                text: headingMatch[2]!,
            });
            i += 1;
            continue;
        }

        // Horizontal rule
        if (/^[-*_]{3,}\s*$/.test(line)) {
            blocks.push({ kind: "hr" });
            i += 1;
            continue;
        }

        // Bullet list
        const bulletMatch = line.match(/^(\s*)[*\-+]\s+(.+)$/);
        if (bulletMatch) {
            const indent = Math.floor(bulletMatch[1]!.length / 2);
            blocks.push({
                kind: "bullet",
                indent,
                segments: parseInlineMarkdown(bulletMatch[2]!),
            });
            i += 1;
            continue;
        }

        // Numbered list
        const numberedMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
        if (numberedMatch) {
            const indent = Math.floor(numberedMatch[1]!.length / 2);
            blocks.push({
                kind: "numbered",
                number: numberedMatch[2]!,
                indent,
                segments: parseInlineMarkdown(numberedMatch[3]!),
            });
            i += 1;
            continue;
        }

        // Empty line
        if (line.trim().length === 0) {
            i += 1;
            continue;
        }

        // Paragraph
        blocks.push({
            kind: "paragraph",
            segments: parseInlineMarkdown(line),
        });
        i += 1;
    }

    writeMarkdownCache(content, blocks);
    return blocks;
}

function buildApplyPrompt(language: string, code: string): string {
    const languageSuffix = language.trim().length > 0 ? language.trim() : "text";
    return [
        "Apply this code block in the correct file.",
        "Adjust imports, surrounding code, and any small syntax differences if needed.",
        "",
        `\`\`\`${languageSuffix}`,
        code,
        "```",
    ].join("\n");
}

function CodeBlockCard({ language, code }: { language: string; code: string }) {
    const [copied, setCopied] = useState(false);
    const [queuedForApply, setQueuedForApply] = useState(false);
    const mdStyles = useThemedStyles(createMarkdownStyles);
    const theme = useAppTheme();

    const handleCopy = React.useCallback(() => {
        void Clipboard.setStringAsync(code)
            .then(() => {
                setCopied(true);
                setTimeout(() => {
                    setCopied(false);
                }, 1600);
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                Alert.alert("Could not copy code", message);
            });
    }, [code]);

    const handleApply = React.useCallback(() => {
        const inserted = insertIntoComposer({
            mode: "append",
            text: buildApplyPrompt(language, code),
        });
        if (!inserted) {
            Alert.alert("Could not add code", "Open the chat composer and try again.");
            return;
        }
        setQueuedForApply(true);
        setTimeout(() => {
            setQueuedForApply(false);
        }, 1600);
    }, [code, language]);

    return (
        <View style={mdStyles.codeBlock}>
            <View style={mdStyles.codeHeader}>
                <View style={mdStyles.codeHeaderMeta}>
                    {language.length > 0 && (
                        <Text style={mdStyles.codeLanguage}>
                            {language}
                        </Text>
                    )}
                </View>
                <View style={mdStyles.codeActions}>
                    <Pressable style={mdStyles.codeActionButton} onPress={handleCopy}>
                        <CopyIcon
                            size={13}
                            color={copied ? theme.colors.success : theme.colors.textTertiary}
                        />
                        <Text style={[
                            mdStyles.codeActionText,
                            copied && mdStyles.codeActionTextActive,
                        ]}>
                            {copied ? "Copied" : "Copy"}
                        </Text>
                    </Pressable>
                    <Pressable style={mdStyles.codeActionButton} onPress={handleApply}>
                        <ArrowUpIcon
                            size={12}
                            color={queuedForApply ? theme.colors.success : theme.colors.textTertiary}
                        />
                        <Text style={[
                            mdStyles.codeActionText,
                            queuedForApply && mdStyles.codeActionTextActive,
                        ]}>
                            {queuedForApply ? "Added" : "Apply"}
                        </Text>
                    </Pressable>
                </View>
            </View>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                directionalLockEnabled
                nestedScrollEnabled
                canCancelContentTouches
            >
                <Text style={mdStyles.codeText}>
                    {code}
                </Text>
            </ScrollView>
        </View>
    );
}

// Render markdown blocks
function MarkdownContent({
    content,
    isStreaming,
}: {
    content: string;
    isStreaming: boolean;
}) {
    const mdStyles = useThemedStyles(createMarkdownStyles);
    const styles = useThemedStyles(createStyles);
    // Markdown ayrıştırmasını her renderda tekrar çalıştırmamak için memoize et
    const blocks = useMemo(() => parseMarkdown(content), [content]);

    return (
        <View
            style={mdStyles.container}
            pointerEvents="box-none"
            {...scrollPassThroughResponderProps}
        >
            {blocks.map((block, i) => {
                switch (block.kind) {
                    case "heading":
                        return (
                            <Text
                                key={i}
                                style={[
                                    mdStyles.heading,
                                    block.level === 1 && mdStyles.h1,
                                    block.level === 2 && mdStyles.h2,
                                    block.level === 3 && mdStyles.h3,
                                ]}
                            >
                                {block.text}
                            </Text>
                        );
                    case "code_block":
                        return (
                            <CodeBlockCard
                                key={i}
                                language={block.language}
                                code={block.code}
                            />
                        );
                    case "bullet":
                        return (
                            <View
                                key={i}
                                style={[
                                    mdStyles.listItem,
                                    { paddingLeft: 16 + block.indent * 16 },
                                ]}
                            >
                                <View style={mdStyles.listContent}>
                                    <InlineMarkdown segments={block.segments} />
                                </View>
                            </View>
                        );
                    case "numbered":
                        return (
                            <View
                                key={i}
                                style={[
                                    mdStyles.listItem,
                                    { paddingLeft: 16 + block.indent * 16 },
                                ]}
                            >
                                <Text style={mdStyles.numberedBullet}>
                                    {block.number}.
                                </Text>
                                <View style={mdStyles.listContent}>
                                    <InlineMarkdown segments={block.segments} />
                                </View>
                            </View>
                        );
                    case "table":
                        return (
                            <ScrollView
                                key={i}
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={mdStyles.tableScroll}
                                directionalLockEnabled
                                nestedScrollEnabled
                                canCancelContentTouches
                            >
                                <View style={mdStyles.table}>
                                    <View style={mdStyles.tableHeaderRow}>
                                        {block.headers.map((header, j) => (
                                            <View key={j} style={mdStyles.tableCell}>
                                                <Text style={mdStyles.tableHeaderText}>
                                                    {header}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                    {block.rows.map((row, ri) => (
                                        <View key={ri} style={mdStyles.tableRow}>
                                            {row.map((cell, ci) => (
                                                <View key={ci} style={mdStyles.tableCell}>
                                                    <Text style={mdStyles.tableCellText}>
                                                        {cell}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                    ))}
                                </View>
                            </ScrollView>
                        );
                    case "hr":
                        return <View key={i} style={mdStyles.hr} />;
                    case "paragraph":
                        return (
                            <View key={i} style={mdStyles.paragraph}>
                                <Text style={mdStyles.text}>
                                    <InlineMarkdown segments={block.segments} />
                                </Text>
                            </View>
                        );
                }
            })}
            {isStreaming && <Text style={styles.cursor}>▌</Text>}
        </View>
    );
}

// User message bubble
function UserBubble({
    content,
    attachments,
    deliveryState,
}: {
    content: string;
    attachments?: ReadonlyArray<SessionMessageAttachment>;
    deliveryState: Extract<ChatItem, { type: "user" }>["deliveryState"];
}) {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.userRow}>
            <View style={styles.userBubble}>
                {attachments !== undefined && attachments.length > 0 && (
                    <View style={styles.userAttachmentsRow}>
                        {attachments.map((attachment, index) => (
                            <View
                                key={`${attachment.displayName ?? attachment.mimeType}-${index}`}
                                style={styles.userAttachmentChip}
                            >
                                <Text style={styles.userAttachmentText} numberOfLines={1}>
                                    {attachment.displayName ?? "Image"}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}
                <Text style={styles.userText}>
                    {content}
                </Text>
            </View>
            {deliveryState === "pending" && (
                <Text style={styles.userMetaText}>Sending…</Text>
            )}
            {deliveryState === "failed" && (
                <Text style={styles.userErrorText}>Failed to send</Text>
            )}
        </View>
    );
}

// Assistant message bubble with markdown rendering
function AssistantBubble({
    content,
    isStreaming,
}: {
    content: string;
    isStreaming: boolean;
}) {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.assistantRow} {...scrollPassThroughResponderProps}>
            <View
                style={styles.assistantBubble}
                pointerEvents="box-none"
                {...scrollPassThroughResponderProps}
            >
                <MarkdownContent content={content} isStreaming={isStreaming} />
            </View>
        </View>
    );
}

function SystemNotificationCard({ content }: { content: string }) {
    const theme = useAppTheme();
    const styles = useThemedStyles(createStyles);

    return (
        <View style={styles.systemNotificationRow} pointerEvents="box-none">
            <View style={styles.systemNotificationCard}>
                <View style={styles.systemNotificationIcon}>
                    <Feather name="bell" size={14} color={theme.colors.textPrimary} />
                </View>
                <View style={styles.systemNotificationContent}>
                    <Text style={styles.systemNotificationTitle}>System notification</Text>
                    <Text style={styles.systemNotificationText}>{content}</Text>
                </View>
            </View>
        </View>
    );
}

function ChatMessageItemComponent({ item }: Props) {
    const [viewerPath, setViewerPath] = useState<string | null>(null);

    return (
        <FileViewerContext.Provider value={setViewerPath}>
            {(() => {
                switch (item.type) {
                    case "user":
                        return (
                            <UserBubble
                                content={item.content}
                                deliveryState={item.deliveryState}
                                {...(item.attachments !== undefined ? { attachments: item.attachments } : {})}
                            />
                        );
                    case "assistant":
                        return (
                            <AssistantBubble
                                content={item.content}
                                isStreaming={item.isStreaming}
                            />
                        );
                    case "thinking":
                        return <ThinkingBubble item={item} />;
                    case "system_notification":
                        return <SystemNotificationCard content={item.content} />;
                    case "tool":
                        return <ToolCard item={item} />;
                }
            })()}
            {viewerPath !== null && (
                <FileContentViewer
                    path={viewerPath}
                    onClose={() => setViewerPath(null)}
                />
            )}
        </FileViewerContext.Provider>
    );
}

export const ChatMessageItem = React.memo(ChatMessageItemComponent);

// --- Markdown stilleri ---
const createMarkdownStyles = (theme: AppTheme) => StyleSheet.create({
    container: {
        gap: 6,
    },
    inlineText: {
        color: theme.colors.textAssistant,
    },
    paragraph: {
        marginBottom: 2,
    },
    text: {
        fontSize: theme.fontSize.base,
        lineHeight: 22,
        color: theme.colors.textAssistant,
    },
    bold: {
        fontWeight: "700",
        color: theme.colors.textAssistant,
    },
    italic: {
        fontStyle: "italic",
        color: theme.colors.textAssistant,
    },
    inlineCode: {
        fontFamily: "monospace",
        fontSize: theme.fontSize.md,
        color: theme.colors.codeInline,
        backgroundColor: theme.colors.bgElevated,
        paddingHorizontal: 4,
        borderRadius: 3,
    },
    fileLink: {
        color: theme.colors.textLink,
        textDecorationLine: "underline",
        fontFamily: "monospace",
        fontSize: theme.fontSize.md,
    },
    heading: {
        fontWeight: "700",
        color: theme.colors.textAssistant,
        marginTop: theme.spacing.sm,
        marginBottom: theme.spacing.xs,
    },
    h1: {
        fontSize: theme.fontSize.xxl,
    },
    h2: {
        fontSize: theme.fontSize.xl,
    },
    h3: {
        fontSize: theme.fontSize.lg,
    },
    codeBlock: {
        backgroundColor: theme.colors.codeBg,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.codeBorder,
        padding: theme.spacing.md,
        marginVertical: theme.spacing.xs,
    },
    codeHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: theme.spacing.sm,
        marginBottom: 10,
    },
    codeHeaderMeta: {
        flex: 1,
        minWidth: 0,
    },
    codeLanguage: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    codeActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    codeActionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    codeActionText: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        fontWeight: "600",
    },
    codeActionTextActive: {
        color: theme.colors.success,
    },
    codeText: {
        fontFamily: "monospace",
        fontSize: theme.fontSize.sm,
        lineHeight: 18,
        color: theme.colors.codeText,
    },
    listItem: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: theme.spacing.sm,
        marginVertical: 2,
    },
    numberedBullet: {
        fontSize: theme.fontSize.base,
        color: theme.colors.textTertiary,
        lineHeight: 22,
        width: 18,
        textAlign: "right",
    },
    listContent: {
        flex: 1,
    },
    tableScroll: {
        marginVertical: 6,
    },
    table: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius.sm,
        overflow: "hidden",
    },
    tableHeaderRow: {
        flexDirection: "row",
        backgroundColor: theme.colors.bgElevated,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    tableRow: {
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.borderMuted,
    },
    tableCell: {
        minWidth: 80,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRightWidth: 1,
        borderRightColor: theme.colors.borderMuted,
    },
    tableHeaderText: {
        fontSize: theme.fontSize.sm,
        fontWeight: "600",
        color: theme.colors.textAssistant,
    },
    tableCellText: {
        fontSize: theme.fontSize.sm,
        color: theme.colors.textAssistant,
    },
    hr: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginVertical: theme.spacing.sm,
    },
});

const createStyles = (theme: AppTheme) => StyleSheet.create({
    // Copilot ikonu
    copilotIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: theme.colors.copilotPurpleMuted,
        justifyContent: "center",
        alignItems: "center",
    },
    copilotIconText: {
        fontSize: 13,
        color: theme.colors.copilotPurple,
    },

    // Kullanıcı avatarı
    userAvatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: theme.colors.bgElevated,
        justifyContent: "center",
        alignItems: "center",
    },
    userAvatarText: {
        fontSize: 12,
        fontWeight: "700",
        color: theme.colors.textLink,
    },

    // Kullanıcı mesajı
    userRow: {
        paddingHorizontal: theme.spacing.md,
        marginVertical: theme.spacing.xs,
        alignItems: "flex-end",
    },
    userBubble: {
        backgroundColor: theme.colors.bgTertiary,
        borderRadius: theme.borderRadius.lg,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        alignSelf: "flex-end",
        maxWidth: "86%",
    },
    userHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
    },
    userLabel: {
        fontSize: theme.fontSize.md,
        fontWeight: "600",
        color: theme.colors.textPrimary,
    },
    userAttachmentsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: theme.spacing.xs,
        marginBottom: theme.spacing.xs,
    },
    userAttachmentChip: {
        maxWidth: 180,
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
        borderRadius: theme.borderRadius.full,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 6,
    },
    userAttachmentText: {
        fontSize: theme.fontSize.xs,
        color: theme.colors.textSecondary,
    },
    userText: {
        fontSize: theme.fontSize.base,
        lineHeight: 22,
        color: theme.colors.textPrimary,
    },
    userMetaText: {
        marginTop: theme.spacing.xs,
        fontSize: theme.fontSize.xs,
        color: theme.colors.textTertiary,
        alignSelf: "flex-end",
    },
    userErrorText: {
        marginTop: theme.spacing.xs,
        fontSize: theme.fontSize.xs,
        color: theme.colors.error,
        fontWeight: "600",
        alignSelf: "flex-end",
    },

    // Asistan mesajı
    assistantRow: {
        paddingHorizontal: theme.spacing.md,
        marginVertical: theme.spacing.xs,
    },
    assistantBubble: {
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
    },
    systemNotificationRow: {
        paddingHorizontal: theme.spacing.md,
        marginVertical: theme.spacing.xs,
    },
    systemNotificationCard: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.bgSecondary,
        borderWidth: 1,
        borderColor: theme.colors.borderMuted,
    },
    systemNotificationIcon: {
        width: 26,
        height: 26,
        borderRadius: theme.borderRadius.sm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.bgElevated,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    systemNotificationContent: {
        flex: 1,
        gap: 3,
    },
    systemNotificationTitle: {
        fontSize: theme.fontSize.sm,
        fontWeight: "700",
        color: theme.colors.textPrimary,
    },
    systemNotificationText: {
        fontSize: theme.fontSize.sm,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    cursor: {
        color: theme.colors.accent,
    },
});

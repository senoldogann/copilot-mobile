// Sohbet mesaj öğesi — GitHub Copilot mobil tasarım diliyle markdown render

import React, { useState, useMemo } from "react";
import {
    View,
    Text,
    Pressable,
    Modal,
    ScrollView,
    StyleSheet,
} from "react-native";
import type { SessionMessageAttachment } from "@copilot-mobile/shared";
import type { ChatItem } from "../stores/session-store";
import { ThinkingBubble } from "./ThinkingBubble";
import { ToolCard } from "./ToolCard";
import { colors, spacing, fontSize, borderRadius } from "../theme/colors";

type Props = {
    item: ChatItem;
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
    return /^[a-zA-Z0-9_\-./\\]+\.[a-zA-Z]{1,10}(:\d+)?$/.test(text) &&
        text.includes(".");
}

function parseFilePaths(text: string): ReadonlyArray<MarkdownSegment> {
    // Match file paths like src/foo/bar.ts, ./file.tsx, packages/shared/index.ts
    const fileRegex = /(?:^|\s)((?:\.\/|\.\.\/|[a-zA-Z0-9_\-]+\/)*[a-zA-Z0-9_\-]+\.[a-zA-Z]{1,10}(?::\d+(?:-\d+)?)?)(?=\s|$|[,.)}\]])/g;
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
    return (
        <Text selectable style={mdStyles.inlineText}>
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

// File link — colored, tappable to open content viewer
function FileLink({ path }: { path: string }) {
    const [showViewer, setShowViewer] = useState(false);

    // Modal'ı Text ağacının dışına taşı — RN, Text içinde Modal desteklemez
    return (
        <>
            <Text
                style={mdStyles.fileLink}
                onPress={() => setShowViewer(true)}
            >
                {path}
            </Text>
            {showViewer && (
                <View style={{ position: "absolute" }}>
                    <FileContentViewer
                        path={path}
                        onClose={() => setShowViewer(false)}
                    />
                </View>
            )}
        </>
    );
}

// File content viewer — slide-in modal showing file path
function FileContentViewer({
    path,
    onClose,
}: {
    path: string;
    onClose: () => void;
}) {
    const cleanPath = path.replace(/:\d+(-\d+)?$/, "");
    const lineMatch = path.match(/:(\d+)(?:-(\d+))?$/);
    const lineInfo = lineMatch
        ? lineMatch[2]
            ? `Lines ${lineMatch[1]}-${lineMatch[2]}`
            : `Line ${lineMatch[1]}`
        : null;

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
                        <Text style={viewerStyles.fileIcon}>📄</Text>
                        <View>
                            <Text style={viewerStyles.fileName} numberOfLines={1}>
                                {cleanPath.split("/").pop()}
                            </Text>
                            <Text style={viewerStyles.filePath} numberOfLines={1}>
                                {cleanPath}
                            </Text>
                        </View>
                    </View>
                    <Pressable
                        style={viewerStyles.closeButton}
                        onPress={onClose}
                    >
                        <Text style={viewerStyles.closeText}>✕</Text>
                    </Pressable>
                </View>
                {lineInfo !== null && (
                    <View style={viewerStyles.lineInfo}>
                        <Text style={viewerStyles.lineInfoText}>{lineInfo}</Text>
                    </View>
                )}
                <ScrollView style={viewerStyles.body}>
                    <Text style={viewerStyles.placeholder}>
                        File content is available on the connected VS Code instance.
                        {"\n\n"}Path: {cleanPath}
                        {lineInfo !== null ? `\n${lineInfo}` : ""}
                    </Text>
                </ScrollView>
            </View>
        </Modal>
    );
}

// Parse full markdown content into renderable blocks
type MarkdownBlock =
    | { kind: "paragraph"; segments: ReadonlyArray<MarkdownSegment> }
    | { kind: "heading"; level: number; text: string }
    | { kind: "code_block"; language: string; code: string }
    | { kind: "bullet"; indent: number; segments: ReadonlyArray<MarkdownSegment> }
    | { kind: "numbered"; number: string; indent: number; segments: ReadonlyArray<MarkdownSegment> }
    | { kind: "table"; headers: ReadonlyArray<string>; rows: ReadonlyArray<ReadonlyArray<string>> }
    | { kind: "hr" };

function parseMarkdown(content: string): ReadonlyArray<MarkdownBlock> {
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

    return blocks;
}

// Render markdown blocks
function MarkdownContent({
    content,
    isStreaming,
}: {
    content: string;
    isStreaming: boolean;
}) {
    // Markdown ayrıştırmasını her renderda tekrar çalıştırmamak için memoize et
    const blocks = useMemo(() => parseMarkdown(content), [content]);

    return (
        <View style={mdStyles.container}>
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
                                selectable
                            >
                                {block.text}
                            </Text>
                        );
                    case "code_block":
                        return (
                            <View key={i} style={mdStyles.codeBlock}>
                                {block.language.length > 0 && (
                                    <Text style={mdStyles.codeLanguage}>
                                        {block.language}
                                    </Text>
                                )}
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    <Text style={mdStyles.codeText} selectable>
                                        {block.code}
                                    </Text>
                                </ScrollView>
                            </View>
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
                                <Text style={mdStyles.bullet}>•</Text>
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
}: {
    content: string;
    attachments?: ReadonlyArray<SessionMessageAttachment>;
}) {
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
                <Text style={styles.userText} selectable>
                    {content}
                </Text>
            </View>
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
    return (
        <View style={styles.assistantRow}>
            <View style={styles.assistantBubble}>
                <MarkdownContent content={content} isStreaming={isStreaming} />
            </View>
        </View>
    );
}

function ChatMessageItemComponent({ item }: Props) {
    switch (item.type) {
        case "user":
            return (
                <UserBubble
                    content={item.content}
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
        case "tool":
            return <ToolCard item={item} />;
    }
}

export const ChatMessageItem = React.memo(ChatMessageItemComponent);

// --- Dosya içerik görüntüleyici stilleri ---
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
        backgroundColor: colors.lineHighlightBg,
        borderBottomWidth: 1,
        borderBottomColor: colors.lineHighlightBorder,
    },
    lineInfoText: {
        fontSize: fontSize.sm,
        color: colors.lineHighlightText,
    },
    body: {
        flex: 1,
        padding: spacing.lg,
    },
    placeholder: {
        fontSize: fontSize.md,
        lineHeight: 20,
        color: colors.textSecondary,
        fontFamily: "monospace",
    },
});

// --- Markdown stilleri ---
const mdStyles = StyleSheet.create({
    container: {
        gap: 6,
    },
    inlineText: {
        color: colors.textPrimary,
    },
    paragraph: {
        marginBottom: 2,
    },
    text: {
        fontSize: fontSize.base,
        lineHeight: 22,
        color: colors.textPrimary,
    },
    bold: {
        fontWeight: "700",
        color: colors.textPrimary,
    },
    italic: {
        fontStyle: "italic",
        color: colors.textPrimary,
    },
    inlineCode: {
        fontFamily: "monospace",
        fontSize: fontSize.md,
        color: colors.codeInline,
        backgroundColor: colors.bgElevated,
        paddingHorizontal: 4,
        borderRadius: 3,
    },
    fileLink: {
        color: colors.textLink,
        textDecorationLine: "underline",
        fontFamily: "monospace",
        fontSize: fontSize.md,
    },
    heading: {
        fontWeight: "700",
        color: colors.textPrimary,
        marginTop: spacing.sm,
        marginBottom: spacing.xs,
    },
    h1: {
        fontSize: fontSize.xxl,
    },
    h2: {
        fontSize: fontSize.xl,
    },
    h3: {
        fontSize: fontSize.lg,
    },
    codeBlock: {
        backgroundColor: colors.codeBg,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        borderColor: colors.codeBorder,
        padding: spacing.md,
        marginVertical: spacing.xs,
    },
    codeLanguage: {
        fontSize: fontSize.xs,
        color: colors.textTertiary,
        marginBottom: 6,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    codeText: {
        fontFamily: "monospace",
        fontSize: fontSize.sm,
        lineHeight: 18,
        color: colors.codeText,
    },
    listItem: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.sm,
        marginVertical: 2,
    },
    bullet: {
        fontSize: fontSize.base,
        color: colors.textTertiary,
        lineHeight: 22,
        width: 12,
    },
    numberedBullet: {
        fontSize: fontSize.base,
        color: colors.textTertiary,
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
        borderColor: colors.border,
        borderRadius: borderRadius.sm,
        overflow: "hidden",
    },
    tableHeaderRow: {
        flexDirection: "row",
        backgroundColor: colors.bgElevated,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    tableRow: {
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: colors.borderMuted,
    },
    tableCell: {
        minWidth: 80,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRightWidth: 1,
        borderRightColor: colors.borderMuted,
    },
    tableHeaderText: {
        fontSize: fontSize.sm,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    tableCellText: {
        fontSize: fontSize.sm,
        color: colors.textPrimary,
    },
    hr: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: spacing.sm,
    },
});

const styles = StyleSheet.create({
    // Copilot ikonu
    copilotIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.copilotPurpleMuted,
        justifyContent: "center",
        alignItems: "center",
    },
    copilotIconText: {
        fontSize: 13,
        color: colors.copilotPurple,
    },

    // Kullanıcı avatarı
    userAvatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.bgElevated,
        justifyContent: "center",
        alignItems: "center",
    },
    userAvatarText: {
        fontSize: 12,
        fontWeight: "700",
        color: colors.textLink,
    },

    // Kullanıcı mesajı
    userRow: {
        paddingHorizontal: spacing.md,
        marginVertical: spacing.xs,
    },
    userBubble: {
        backgroundColor: colors.bgTertiary,
        borderRadius: borderRadius.lg,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
    },
    userHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    userLabel: {
        fontSize: fontSize.md,
        fontWeight: "600",
        color: colors.textPrimary,
    },
    userAttachmentsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.xs,
        marginBottom: spacing.xs,
    },
    userAttachmentChip: {
        maxWidth: 180,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.borderMuted,
        borderRadius: borderRadius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    userAttachmentText: {
        fontSize: fontSize.xs,
        color: colors.textSecondary,
    },
    userText: {
        fontSize: fontSize.base,
        lineHeight: 22,
        color: colors.textPrimary,
    },

    // Asistan mesajı
    assistantRow: {
        paddingHorizontal: spacing.md,
        marginVertical: spacing.xs,
    },
    assistantBubble: {
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
    },
    cursor: {
        color: colors.accent,
    },
});

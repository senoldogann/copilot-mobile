import type { ToolItem } from "../stores/session-store-types";

export type ParsedToolArguments = {
    raw: Readonly<Record<string, unknown>>;
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
};

function readStringValue(
    record: Readonly<Record<string, unknown>>,
    keys: ReadonlyArray<string>
): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

function formatAgentLabel(value: string): string {
    return value
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function parseToolArgumentsText(
    text: string | undefined
): ParsedToolArguments | null {
    if (text === undefined || text.trim().length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return null;
        }

        const record = parsed as Record<string, unknown>;
        const path = readStringValue(record, ["path", "file", "filename", "filepath"]);
        const oldStr = readStringValue(record, ["old_str", "old", "original"]);
        const newStr = readStringValue(record, ["new_str", "new", "replacement", "content"]);
        const command = readStringValue(record, ["command", "cmd"]);
        const content = readStringValue(record, ["content", "file_text", "text"]);
        const query = readStringValue(record, ["query", "search", "pattern", "glob"]);
        const pattern = readStringValue(record, ["pattern", "glob", "query"]);
        const thought = readStringValue(record, ["thought", "thinking"]);
        const description = readStringValue(record, ["description", "title", "summary"]);
        const prompt = readStringValue(record, ["prompt", "initialPrompt"]);
        const agentName = readStringValue(record, ["name", "agent_name", "agent"]);
        const agentType = readStringValue(record, ["agent_type", "agentType", "provider"]);
        const skill = readStringValue(record, ["skill"]);

        return {
            raw: record,
            ...(path !== undefined ? { path } : {}),
            ...(oldStr !== undefined ? { oldStr } : {}),
            ...(newStr !== undefined ? { newStr } : {}),
            ...(command !== undefined ? { command } : {}),
            ...(content !== undefined ? { content } : {}),
            ...(query !== undefined ? { query } : {}),
            ...(pattern !== undefined ? { pattern } : {}),
            ...(thought !== undefined ? { thought } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(prompt !== undefined ? { prompt } : {}),
            ...(agentName !== undefined ? { agentName } : {}),
            ...(agentType !== undefined ? { agentType } : {}),
            ...(skill !== undefined ? { skill } : {}),
        };
    } catch {
        return null;
    }
}

export function isSubagentToolName(toolName: string): boolean {
    const normalized = toolName.toLowerCase();

    return normalized === "task"
        || normalized.includes("subagent")
        || normalized.includes("spawn_agent");
}

export function getSubagentDisplayName(
    item: Pick<ToolItem, "toolName" | "argumentsText">
): string {
    const parsed = parseToolArgumentsText(item.argumentsText);
    const name = parsed?.agentName;
    const type = parsed?.agentType;

    if (name !== undefined && name.length > 0) {
        return formatAgentLabel(name);
    }

    if (type !== undefined && type.length > 0) {
        return formatAgentLabel(type);
    }

    return formatAgentLabel(item.toolName);
}

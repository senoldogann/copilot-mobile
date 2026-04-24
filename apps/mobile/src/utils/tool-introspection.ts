import type {
    AgentTodo,
    ChatItem,
    SubagentRun,
    TodoItemStatus,
    ToolItem,
} from "../stores/session-store-types";

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
    pluginName?: string;
    pluginPublisher?: string;
    pluginUri?: string;
    mcpServer?: string;
    mcpTool?: string;
    appUri?: string;
};

type TodoMutation =
    | {
        kind: "replace";
        todos: ReadonlyArray<AgentTodo>;
    }
    | {
        kind: "status_update";
        status: TodoItemStatus;
        ids?: ReadonlyArray<string>;
        matchStatus?: TodoItemStatus;
    }
    | {
        kind: "clear";
    };

function normalizeTodoStatus(rawStatus: string): TodoItemStatus {
    const normalized = rawStatus.trim().toLowerCase();
    if (normalized === "completed" || normalized === "done") {
        return "completed";
    }

    if (normalized === "in_progress" || normalized === "in progress" || normalized === "active") {
        return "in_progress";
    }

    return "pending";
}

function normalizeTodoPriority(
    rawPriority: string | undefined
): AgentTodo["priority"] | undefined {
    if (rawPriority === undefined) {
        return undefined;
    }

    const normalized = rawPriority.trim().toLowerCase();
    if (normalized === "high" || normalized === "medium" || normalized === "low") {
        return normalized;
    }

    return undefined;
}

function ensureUniqueTodoIds(
    todos: ReadonlyArray<AgentTodo>
): ReadonlyArray<AgentTodo> {
    const seenCounts = new Map<string, number>();

    return todos.map((todo, index) => {
        const normalizedBaseId = todo.id.trim().length > 0
            ? todo.id.trim()
            : `todo-${index + 1}`;
        const nextCount = (seenCounts.get(normalizedBaseId) ?? 0) + 1;
        seenCounts.set(normalizedBaseId, nextCount);

        if (nextCount === 1) {
            return {
                ...todo,
                id: normalizedBaseId,
            };
        }

        return {
            ...todo,
            id: `${normalizedBaseId}-${nextCount}`,
        };
    });
}

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

function readQueryValue(record: Readonly<Record<string, unknown>>): string | undefined {
    return readStringValue(record, ["query", "sql", "statement"]);
}

function formatAgentLabel(value: string): string {
    return value
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function readUriLikeValue(
    record: Readonly<Record<string, unknown>>,
    prefixes: ReadonlyArray<string>
): string | undefined {
    for (const value of Object.values(record)) {
        if (typeof value !== "string") {
            continue;
        }

        const trimmedValue = value.trim();
        if (trimmedValue.length === 0) {
            continue;
        }

        if (prefixes.some((prefix) => trimmedValue.startsWith(prefix))) {
            return trimmedValue;
        }
    }

    return undefined;
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
        const pluginName = readStringValue(record, ["plugin", "pluginName", "plugin_name"]);
        const pluginPublisher = readStringValue(record, ["marketplace", "publisher", "pluginPublisher"]);
        const pluginUri = readUriLikeValue(record, ["plugin://"]);
        const mcpServer = readStringValue(record, ["mcpServer", "mcp_server", "server", "serverName"]);
        const mcpTool = readStringValue(record, ["tool", "tool_name", "toolName"]);
        const appUri = readUriLikeValue(record, ["app://"]);

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
            ...(pluginName !== undefined ? { pluginName } : {}),
            ...(pluginPublisher !== undefined ? { pluginPublisher } : {}),
            ...(pluginUri !== undefined ? { pluginUri } : {}),
            ...(mcpServer !== undefined ? { mcpServer } : {}),
            ...(mcpTool !== undefined ? { mcpTool } : {}),
            ...(appUri !== undefined ? { appUri } : {}),
        };
    } catch {
        return null;
    }
}

function parseTodoListRecord(
    record: Readonly<Record<string, unknown>>
): ReadonlyArray<AgentTodo> | null {
    const raw = record["todos"] ?? record["items"] ?? record["todo_list"];
    if (!Array.isArray(raw) || raw.length === 0) {
        return null;
    }

    const todos: Array<AgentTodo> = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const entry = item as Record<string, unknown>;
        const id = String(entry["id"] ?? entry["taskId"] ?? todos.length + 1);
        const content = String(
            entry["content"]
            ?? entry["description"]
            ?? entry["task"]
            ?? entry["title"]
            ?? ""
        ).trim();
        if (content.length === 0) {
            continue;
        }

        const status = normalizeTodoStatus(String(entry["status"] ?? "pending"));
        const priority = normalizeTodoPriority(
            typeof entry["priority"] === "string" ? entry["priority"] : undefined
        );
        todos.push({
            id,
            content,
            status,
            ...(priority !== undefined ? { priority } : {}),
        });
    }

    return todos.length > 0 ? ensureUniqueTodoIds(todos) : null;
}

function readSqlStringToken(input: string, startIndex: number): {
    value: string;
    nextIndex: number;
} {
    let index = startIndex + 1;
    let value = "";

    while (index < input.length) {
        const char = input[index];
        if (char === "'") {
            const nextChar = input[index + 1];
            if (nextChar === "'") {
                value += "'";
                index += 2;
                continue;
            }

            return {
                value,
                nextIndex: index + 1,
            };
        }

        value += char;
        index += 1;
    }

    return {
        value,
        nextIndex: index,
    };
}

function splitSqlTupleValues(tupleContent: string): ReadonlyArray<string> {
    const values: Array<string> = [];
    let current = "";
    let index = 0;

    while (index < tupleContent.length) {
        const char = tupleContent[index];

        if (char === "'") {
            const parsed = readSqlStringToken(tupleContent, index);
            current += parsed.value;
            index = parsed.nextIndex;
            continue;
        }

        if (char === ",") {
            values.push(current.trim());
            current = "";
            index += 1;
            continue;
        }

        current += char;
        index += 1;
    }

    if (current.trim().length > 0 || tupleContent.endsWith(",")) {
        values.push(current.trim());
    }

    return values;
}

function parseSqlValueTuples(valuesClause: string): ReadonlyArray<ReadonlyArray<string>> {
    const tuples: Array<ReadonlyArray<string>> = [];
    let index = 0;

    while (index < valuesClause.length) {
        const char = valuesClause[index];
        if (char !== "(") {
            index += 1;
            continue;
        }

        let depth = 1;
        let tupleContent = "";
        let cursor = index + 1;

        while (cursor < valuesClause.length && depth > 0) {
            const current = valuesClause[cursor];
            if (current === "'") {
                const parsed = readSqlStringToken(valuesClause, cursor);
                tupleContent += `'${parsed.value.replace(/'/g, "''")}'`;
                cursor = parsed.nextIndex;
                continue;
            }

            if (current === "(") {
                depth += 1;
            } else if (current === ")") {
                depth -= 1;
                if (depth === 0) {
                    cursor += 1;
                    break;
                }
            }

            if (depth > 0) {
                tupleContent += current;
            }
            cursor += 1;
        }

        if (tupleContent.trim().length > 0) {
            tuples.push(splitSqlTupleValues(tupleContent));
        }
        index = cursor;
    }

    return tuples;
}

function parseTodosFromSqlQuery(query: string): ReadonlyArray<AgentTodo> | null {
    const insertMatch = query.match(/insert\s+into\s+todos\s*\(([^)]+)\)\s*values\s*([\s\S]+?)\s*;?\s*$/i);
    if (insertMatch === null) {
        return null;
    }

    const columnGroup = insertMatch[1];
    const valuesGroup = insertMatch[2];
    if (columnGroup === undefined || valuesGroup === undefined) {
        return null;
    }

    const columns = columnGroup
        .split(",")
        .map((column) => column.trim().replace(/["`]/g, "").toLowerCase());
    const tuples = parseSqlValueTuples(valuesGroup);
    if (columns.length === 0 || tuples.length === 0) {
        return null;
    }

    const idIndex = columns.findIndex((column) => column === "id");
    const titleIndex = columns.findIndex((column) => column === "title");
    const descriptionIndex = columns.findIndex((column) => column === "description" || column === "content");
    const statusIndex = columns.findIndex((column) => column === "status");
    const priorityIndex = columns.findIndex((column) => column === "priority");

    const todos = tuples
        .map((values, todoIndex) => {
            const id = idIndex >= 0 ? (values[idIndex] ?? String(todoIndex + 1)) : String(todoIndex + 1);
            const title = titleIndex >= 0 ? (values[titleIndex] ?? "") : "";
            const description = descriptionIndex >= 0 ? (values[descriptionIndex] ?? "") : "";
            const content = title.trim().length > 0 ? title.trim() : description.trim();
            if (content.length === 0) {
                return null;
            }

            const status = normalizeTodoStatus(statusIndex >= 0 ? (values[statusIndex] ?? "pending") : "pending");
            const priority = normalizeTodoPriority(priorityIndex >= 0 ? values[priorityIndex] : undefined);
            return {
                id: id.trim().length > 0 ? id.trim() : String(todoIndex + 1),
                content,
                status,
                ...(priority !== undefined ? { priority } : {}),
            };
        })
        .filter((todo): todo is AgentTodo => todo !== null);

    return todos.length > 0 ? ensureUniqueTodoIds(todos) : null;
}

function parseQuotedSqlStrings(input: string): ReadonlyArray<string> {
    const matches = [...input.matchAll(/'((?:''|[^'])+)'/g)];

    return matches
        .map((match) => match[1]?.replace(/''/g, "'").trim() ?? "")
        .filter((value) => value.length > 0);
}

function parseTodoStatusUpdateFromSqlQuery(query: string): TodoMutation | null {
    const updateMatch = query.match(/update\s+todos\s+set\s+([\s\S]+?)(?:\s+where\s+([\s\S]+?))?\s*;?$/i);
    if (updateMatch === null) {
        return null;
    }

    const setClause = updateMatch[1];
    if (setClause === undefined) {
        return null;
    }

    const rawStatus = setClause.match(/status\s*=\s*'([^']+)'/i)?.[1];
    if (rawStatus === undefined) {
        return null;
    }

    const whereClause = updateMatch[2]?.trim();
    if (whereClause === undefined || whereClause.length === 0) {
        return {
            kind: "status_update",
            status: normalizeTodoStatus(rawStatus),
        };
    }

    const idsGroup = whereClause.match(/id\s+in\s*\(([\s\S]+?)\)/i)?.[1];
    if (idsGroup !== undefined) {
        const ids = parseQuotedSqlStrings(idsGroup);
        if (ids.length > 0) {
            return {
                kind: "status_update",
                status: normalizeTodoStatus(rawStatus),
                ids,
            };
        }
    }

    const singleId = whereClause.match(/id\s*=\s*'([^']+)'/i)?.[1];
    if (singleId !== undefined && singleId.trim().length > 0) {
        return {
            kind: "status_update",
            status: normalizeTodoStatus(rawStatus),
            ids: [singleId.trim()],
        };
    }

    const matchedStatus = whereClause.match(/status\s*=\s*'([^']+)'/i)?.[1];
    if (matchedStatus !== undefined) {
        return {
            kind: "status_update",
            status: normalizeTodoStatus(rawStatus),
            matchStatus: normalizeTodoStatus(matchedStatus),
        };
    }

    return {
        kind: "status_update",
        status: normalizeTodoStatus(rawStatus),
    };
}

function parseTodosFromMarkdownTable(output: string): ReadonlyArray<AgentTodo> | null {
    const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("|") && line.endsWith("|"));

    if (lines.length < 3) {
        return null;
    }

    const headers = lines[0]
        ?.split("|")
        .map((cell) => cell.trim().toLowerCase())
        .filter((cell) => cell.length > 0);
    if (headers === undefined || headers.length === 0) {
        return null;
    }

    const idIndex = headers.findIndex((header) => header === "id");
    const titleIndex = headers.findIndex((header) => header === "title" || header === "content");
    const statusIndex = headers.findIndex((header) => header === "status");
    if (idIndex === -1 || titleIndex === -1 || statusIndex === -1) {
        return null;
    }

    const todos = lines.slice(2)
        .map((line) => line
            .split("|")
            .map((cell) => cell.trim())
            .filter((cell) => cell.length > 0)
        )
        .map((cells) => {
            const id = cells[idIndex];
            const content = cells[titleIndex];
            const status = cells[statusIndex];

            if (id === undefined || content === undefined || status === undefined) {
                return null;
            }

            return {
                id,
                content,
                status: normalizeTodoStatus(status),
            } satisfies AgentTodo;
        })
        .filter((todo): todo is AgentTodo => todo !== null);

    return todos.length > 0 ? ensureUniqueTodoIds(todos) : null;
}

function parseTodosFromJsonOutput(output: string): ReadonlyArray<AgentTodo> | null {
    try {
        const parsed = JSON.parse(output) as unknown;
        if (!Array.isArray(parsed)) {
            return null;
        }

        const todos = parsed.flatMap((item) => {
            if (typeof item !== "object" || item === null) {
                return [];
            }

            const record = item as Record<string, unknown>;
            const id = typeof record["id"] === "string" ? record["id"].trim() : "";
            const contentCandidate = typeof record["title"] === "string"
                ? record["title"]
                : typeof record["content"] === "string"
                    ? record["content"]
                    : typeof record["description"] === "string"
                        ? record["description"]
                        : "";
            const content = contentCandidate.trim();
            const rawStatus = typeof record["status"] === "string" ? record["status"] : "pending";

            if (id.length === 0 || content.length === 0) {
                return [];
            }

            return [{
                id,
                content,
                status: normalizeTodoStatus(rawStatus),
            } satisfies AgentTodo];
        });

        return todos.length > 0 ? ensureUniqueTodoIds(todos) : null;
    } catch {
        return null;
    }
}

function parseTodoMutationFromToolOutput(output: string | undefined): TodoMutation | null {
    if (output === undefined || output.trim().length === 0) {
        return null;
    }

    const jsonTodos = parseTodosFromJsonOutput(output);
    if (jsonTodos !== null) {
        return {
            kind: "replace",
            todos: jsonTodos,
        };
    }

    const markdownTodos = parseTodosFromMarkdownTable(output);
    if (markdownTodos !== null) {
        return {
            kind: "replace",
            todos: markdownTodos,
        };
    }

    return null;
}

function extractAgentTodosFromRecord(
    record: Readonly<Record<string, unknown>>
): ReadonlyArray<AgentTodo> | null {
    const fromList = parseTodoListRecord(record);
    if (fromList !== null) {
        return fromList;
    }

    const query = readQueryValue(record);
    if (query !== undefined) {
        return parseTodosFromSqlQuery(query);
    }

    return null;
}

function parseTodoMutationFromRecord(
    record: Readonly<Record<string, unknown>>
): TodoMutation | null {
    const fromList = parseTodoListRecord(record);
    if (fromList !== null) {
        return {
            kind: "replace",
            todos: fromList,
        };
    }

    const query = readQueryValue(record);
    if (query === undefined) {
        return null;
    }

    const insertedTodos = parseTodosFromSqlQuery(query);
    if (insertedTodos !== null) {
        return {
            kind: "replace",
            todos: insertedTodos,
        };
    }

    const updatedTodos = parseTodoStatusUpdateFromSqlQuery(query);
    if (updatedTodos !== null) {
        return updatedTodos;
    }

    if (/delete\s+from\s+todos/i.test(query)) {
        return { kind: "clear" };
    }

    return null;
}

export function extractAgentTodosFromArgumentsText(
    text: string | undefined
): ReadonlyArray<AgentTodo> | null {
    const parsed = parseToolArgumentsText(text);
    if (parsed === null) {
        return null;
    }

    return extractAgentTodosFromRecord(parsed.raw);
}

function parseTodoMutationFromArgumentsText(
    text: string | undefined
): TodoMutation | null {
    const parsed = parseToolArgumentsText(text);
    if (parsed === null) {
        return null;
    }

    return parseTodoMutationFromRecord(parsed.raw);
}

function applyTodoMutation(
    todos: ReadonlyArray<AgentTodo>,
    mutation: TodoMutation
): ReadonlyArray<AgentTodo> {
    if (mutation.kind === "replace") {
        return mutation.todos;
    }

    if (mutation.kind === "clear") {
        return [];
    }

    return todos.map((todo) => {
        const matchesId = mutation.ids === undefined || mutation.ids.includes(todo.id);
        const matchesStatus = mutation.matchStatus === undefined || todo.status === mutation.matchStatus;

        if (!matchesId || !matchesStatus) {
            return todo;
        }

        return {
            ...todo,
            status: mutation.status,
        };
    });
}

export function getCurrentTurnItems(
    items: ReadonlyArray<ChatItem>
): ReadonlyArray<ChatItem> {
    const lastUserMessageIndex = [...items]
        .map((item, index) => ({ item, index }))
        .reverse()
        .find(({ item }) => item.type === "user")
        ?.index ?? -1;

    return items.slice(lastUserMessageIndex + 1);
}

export function getActiveAgentItems(
    items: ReadonlyArray<ChatItem>,
    isAssistantTyping: boolean
): ReadonlyArray<ChatItem> {
    const currentTurnItems = getCurrentTurnItems(items);
    if (!isAssistantTyping) {
        return currentTurnItems;
    }

    const hasLiveAgentArtifact = items.some((item) => (
        ((item.type === "assistant" || item.type === "thinking") && item.isStreaming)
        || (item.type === "tool" && item.status === "running")
    ));
    if (!hasLiveAgentArtifact) {
        return currentTurnItems;
    }

    const lastAgentAnchorIndex = [...items]
        .map((item, index) => ({ item, index }))
        .reverse()
        .find(({ item }) =>
            ((item.type === "assistant" || item.type === "thinking") && item.isStreaming)
            || (item.type === "tool" && item.status === "running")
        )
        ?.index ?? -1;

    if (lastAgentAnchorIndex === -1) {
        return currentTurnItems;
    }

    const previousUserIndex = [...items]
        .map((item, index) => ({ item, index }))
        .slice(0, lastAgentAnchorIndex + 1)
        .reverse()
        .find(({ item }) => item.type === "user")
        ?.index ?? -1;

    return items.slice(previousUserIndex + 1);
}

export function deriveSubagentRunsFromItems(
    currentTurnItems: ReadonlyArray<ChatItem>,
    isAssistantTyping: boolean
): ReadonlyArray<SubagentRun> {
    const runMap = new Map<string, SubagentRun>();

    for (const item of currentTurnItems) {
        if (item.type !== "tool" || !isSubagentToolName(item.toolName)) {
            continue;
        }

        runMap.set(item.requestId, {
            requestId: item.requestId,
            title: getSubagentDisplayName(item),
            status: item.status === "failed"
                ? "failed"
                : isAssistantTyping
                    ? "running"
                    : item.status === "completed" || item.status === "no_results"
                        ? "completed"
                        : "running",
        });
    }

    const runs = [...runMap.values()];
    const hasRunningRun = runs.some((run) => run.status === "running");

    if (hasRunningRun || (isAssistantTyping && runs.length > 0)) {
        return runs;
    }

    return [];
}

export function areSubagentRunsEqual(
    left: ReadonlyArray<SubagentRun>,
    right: ReadonlyArray<SubagentRun>
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((run, index) => {
        const candidate = right[index];
        return candidate !== undefined
            && candidate.requestId === run.requestId
            && candidate.title === run.title
            && candidate.status === run.status;
    });
}

export function deriveAgentTodosFromItems(
    items: ReadonlyArray<ChatItem>
): ReadonlyArray<AgentTodo> {
    let derivedTodos: ReadonlyArray<AgentTodo> = [];

    for (const item of items) {
        if (item.type !== "tool") {
            continue;
        }

        const mutation = parseTodoMutationFromArgumentsText(item.argumentsText);
        if (mutation !== null) {
            derivedTodos = applyTodoMutation(derivedTodos, mutation);
        }

        const outputMutation = parseTodoMutationFromToolOutput(item.partialOutput);
        if (outputMutation !== null) {
            derivedTodos = applyTodoMutation(derivedTodos, outputMutation);
        }
    }

    return ensureUniqueTodoIds(derivedTodos);
}

export function extractLatestAgentTodosFromItems(
    items: ReadonlyArray<ChatItem>
): ReadonlyArray<AgentTodo> {
    return deriveAgentTodosFromItems(items);
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

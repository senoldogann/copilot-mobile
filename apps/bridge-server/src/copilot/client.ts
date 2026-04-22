// Copilot SDK Adapter implementation
// Wraps @github/copilot-sdk v0.2.2 preview API
// Only this file needs updating if the SDK changes

import { randomUUID } from "node:crypto";
import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type {
    PermissionRequest as SDKPermissionRequest,
    PermissionRequestResult,
    SessionConfig as SDKSessionConfig,
    ResumeSessionConfig,
    SessionEvent,
    ModelInfo as SDKModelInfo,
    CustomAgentConfig,
} from "@github/copilot-sdk";

// SDK does not export ReasoningEffort type from public index; derive array element type.
type SDKReasoningEffort = NonNullable<SDKModelInfo["supportedReasoningEfforts"]>[number];
// Derive SessionHooks and hook input types from exported SDKSessionConfig
type SessionHooks = NonNullable<SDKSessionConfig["hooks"]>;
type PreToolUseHookInput = Parameters<NonNullable<SessionHooks["onPreToolUse"]>>[0];
type SDKUserInputRequest = Parameters<NonNullable<SDKSessionConfig["onUserInputRequest"]>>[0];
import type {
    AdaptedCopilotClient,
    AdaptedCopilotSession,
    AdaptedPermissionRequest,
    AdaptedPlanExitRequest,
    AdaptedSessionState,
    AdaptedToolCompletionDetails,
    AdaptedToolStartDetails,
    AdaptedUserInputRequest,
    AgentMode,
    PermissionLevel,
    RuntimeMode,
    SessionConfig,
    SessionInfo,
    SessionHistoryItem,
    ModelInfo,
    PermissionKind,
    ReasoningEffortLevel,
    HostSessionCapabilities,
    SessionMessageInput,
    ToolExecutionStatus,
} from "@copilot-mobile/shared";
import { MODEL_UNKNOWN } from "@copilot-mobile/shared";
import type { SessionMetadata } from "@github/copilot-sdk";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

const COMMON_COPILOT_CLI_PATHS: ReadonlyArray<string> = [
    "/opt/homebrew/bin/copilot",
    "/usr/local/bin/copilot",
];

function readEnv(names: ReadonlyArray<string>): string | undefined {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

/** Detect git repository root starting from `dir`. Falls back to `dir` itself. */
function detectGitRoot(dir: string): string {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: dir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return dir;
    }
}

const PROCESS_CWD = path.resolve(
    readEnv(["CODE_COMPANION_WORKSPACE_ROOT", "COPILOT_MOBILE_WORKSPACE_ROOT"]) ?? process.cwd()
);
const WORKSPACE_ROOT = detectGitRoot(PROCESS_CWD);

function resolveRequestedWorkspaceRoot(workspaceRoot: string | undefined): string {
    const candidatePath = path.resolve(workspaceRoot ?? PROCESS_CWD);
    const stats = statSync(candidatePath, { throwIfNoEntry: false });

    if (stats === undefined || !stats.isDirectory()) {
        throw new Error(`Workspace directory does not exist: ${candidatePath}`);
    }

    return candidatePath;
}

function resolveExplicitCopilotCliPath(): string | undefined {
    const configuredPath = process.env["COPILOT_CLI_PATH"];
    if (configuredPath === undefined || configuredPath.trim().length === 0) {
        return undefined;
    }

    const resolvedPath = path.resolve(configuredPath.trim());
    const stats = statSync(resolvedPath, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isFile()) {
        throw new Error(`Configured Copilot CLI binary does not exist: ${resolvedPath}`);
    }

    return resolvedPath;
}

function resolveSystemCopilotCliPath(): string | undefined {
    for (const candidatePath of COMMON_COPILOT_CLI_PATHS) {
        const stats = statSync(candidatePath, { throwIfNoEntry: false });
        if (stats !== undefined && stats.isFile()) {
            return candidatePath;
        }
    }

    try {
        const resolvedPath = execFileSync("which", ["copilot"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (resolvedPath.length === 0) {
            return undefined;
        }

        const stats = statSync(resolvedPath, { throwIfNoEntry: false });
        if (stats === undefined || !stats.isFile()) {
            return undefined;
        }

        return resolvedPath;
    } catch {
        return undefined;
    }
}

function resolvePreferredCopilotCliPath(): string | undefined {
    const explicitPath = resolveExplicitCopilotCliPath();
    if (explicitPath !== undefined) {
        return explicitPath;
    }

    return resolveSystemCopilotCliPath();
}

type SessionRecord = {
    session: AdaptedCopilotSession;
    info: SessionInfo;
    unsubscribes: Array<() => void>;
};

type SessionStateRef = {
    agentMode: AgentMode;
    permissionLevel: PermissionLevel;
};

const ASK_AGENT_NAME = "ask";

const ASK_AGENT_CONFIG: CustomAgentConfig = {
    name: ASK_AGENT_NAME,
    displayName: "Ask",
    description: "Answer questions without making changes to the workspace.",
    prompt: [
        "You are the Ask agent.",
        "Focus on analysis, explanation, and guidance.",
        "Never create, edit, or delete files.",
        "Never run shell commands that change the workspace or environment.",
        "If the user asks for code changes, explain what should change instead of making the edit.",
    ].join("\n"),
};

function adaptSessionContext(metadata: SessionMetadata): SessionInfo["context"] {
    const context = metadata.context;

    if (context === undefined) {
        return undefined;
    }

    const sessionCwd = context.cwd;
    const detectedGitRoot = detectGitRoot(sessionCwd);
    const workspaceRoot = sessionCwd;
    const gitRoot = context.gitRoot ?? (detectedGitRoot !== sessionCwd ? detectedGitRoot : undefined);
    const repository = typeof context.repository === "string"
        ? normalizeRepositoryLabel(context.repository)
        : undefined;

    return {
        sessionCwd,
        workspaceRoot,
        ...(gitRoot !== undefined ? { gitRoot } : {}),
        ...(repository !== undefined ? { repository } : {}),
        ...(context.branch !== undefined ? { branch: context.branch } : {}),
    };
}

function normalizeRepositoryLabel(repository: string): string {
    const trimmed = repository.trim();
    const withoutGitSuffix = trimmed.replace(/\.git$/i, "");
    const githubMatch = withoutGitSuffix.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
    if (githubMatch?.[1] !== undefined) {
        return githubMatch[1];
    }

    const genericMatch = withoutGitSuffix.match(/[:/]([^/]+\/[^/]+)$/);
    if (genericMatch?.[1] !== undefined) {
        return genericMatch[1];
    }

    return trimmed;
}

function isSessionAlreadyDeletedError(error: unknown): boolean {
    return error instanceof Error
        && /session not found|no such session|unknown session|file not found/i.test(error.message);
}

function adaptSessionInfoFromMetadata(metadata: SessionMetadata): SessionInfo {
    const context = adaptSessionContext(metadata);

    return {
        id: metadata.sessionId,
        model: MODEL_UNKNOWN,
        createdAt: metadata.startTime.getTime(),
        lastActiveAt: metadata.modifiedTime.getTime(),
        status: "idle",
        ...(metadata.summary !== undefined ? { summary: metadata.summary } : {}),
        ...(context !== undefined ? { context } : {}),
    };
}

function buildSessionContextFromWorkingDirectory(
    workingDirectory: string
): NonNullable<SessionInfo["context"]> {
    const detectedGitRoot = detectGitRoot(workingDirectory);
    const workspaceRoot = workingDirectory;
    const gitRoot = detectedGitRoot !== workingDirectory ? detectedGitRoot : undefined;

    return {
        sessionCwd: workingDirectory,
        workspaceRoot,
        ...(gitRoot !== undefined ? { gitRoot } : {}),
    };
}

function parseEventTimestamp(timestamp: string): number {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

// Normalize reasoning effort levels to canonical form.
// Priority: supportedReasoningEfforts > capabilities.supports.reasoningEffort > none.
// In case of conflict, the canonical list (supportedReasoningEfforts) takes precedence.
function normalizeReasoningEfforts(sdkModel: SDKModelInfo): {
    supportsReasoningEffort: boolean;
    supportedReasoningEfforts?: ReadonlyArray<ReasoningEffortLevel>;
    defaultReasoningEffort?: ReasoningEffortLevel;
} {
    const kVALID: ReadonlyArray<ReasoningEffortLevel> = ["low", "medium", "high", "xhigh"];
    const filterValid = (list: ReadonlyArray<SDKReasoningEffort>): Array<ReasoningEffortLevel> =>
        list.filter((value): value is ReasoningEffortLevel =>
            kVALID.includes(value as ReasoningEffortLevel)
        );

    const explicitEfforts = sdkModel.supportedReasoningEfforts;
    const capabilitySupport = sdkModel.capabilities?.supports?.reasoningEffort === true;
    const defaultEffort = sdkModel.defaultReasoningEffort;

    // 1. Canonical: explicit supportedReasoningEfforts
    if (Array.isArray(explicitEfforts) && explicitEfforts.length > 0) {
        const filtered = filterValid(explicitEfforts);
        if (filtered.length > 0) {
            const result: {
                supportsReasoningEffort: boolean;
                supportedReasoningEfforts: ReadonlyArray<ReasoningEffortLevel>;
                defaultReasoningEffort?: ReasoningEffortLevel;
            } = {
                supportsReasoningEffort: true,
                supportedReasoningEfforts: filtered,
            };
            if (defaultEffort !== undefined && filtered.includes(defaultEffort as ReasoningEffortLevel)) {
                result.defaultReasoningEffort = defaultEffort as ReasoningEffortLevel;
            }
            return result;
        }
    }

    // 2. Support exists but no list — keep level list unknown.
    if (capabilitySupport) {
        const result: {
            supportsReasoningEffort: boolean;
            defaultReasoningEffort?: ReasoningEffortLevel;
        } = { supportsReasoningEffort: true };
        if (defaultEffort !== undefined && kVALID.includes(defaultEffort as ReasoningEffortLevel)) {
            result.defaultReasoningEffort = defaultEffort as ReasoningEffortLevel;
        }
        return result;
    }

    // 3. No support
    return { supportsReasoningEffort: false };
}

function normalizeModelInfo(sdkModel: SDKModelInfo): ModelInfo {
    const effort = normalizeReasoningEfforts(sdkModel);
    const contextWindowTokens = sdkModel.capabilities?.limits?.max_context_window_tokens;
    const supportsVision = sdkModel.capabilities?.supports?.vision;
    const policyState = sdkModel.policy?.state;
    const billingMultiplier = sdkModel.billing?.multiplier;

    const base: ModelInfo = {
        id: sdkModel.id,
        name: sdkModel.name,
        provider: "copilot",
        supportsReasoningEffort: effort.supportsReasoningEffort,
    };

    if (effort.supportedReasoningEfforts !== undefined) {
        base.supportedReasoningEfforts = effort.supportedReasoningEfforts;
    }
    if (effort.defaultReasoningEffort !== undefined) {
        base.defaultReasoningEffort = effort.defaultReasoningEffort;
    }
    if (policyState !== undefined) {
        base.policyState = policyState;
    }
    if (typeof billingMultiplier === "number") {
        base.billingMultiplier = billingMultiplier;
    }
    if (typeof supportsVision === "boolean") {
        base.supportsVision = supportsVision;
    }
    if (typeof contextWindowTokens === "number") {
        base.contextWindowTokens = contextWindowTokens;
    }

    return base;
}

function deriveRuntimeMode(state: SessionStateRef): RuntimeMode {
    if (state.agentMode === "plan") {
        return "plan";
    }

    if (state.permissionLevel === "autopilot") {
        return "autopilot";
    }

    return "interactive";
}

function isAskModeMutation(toolName: string, toolArgs: unknown): boolean {
    const normalizedToolName = toolName.toLowerCase();

    if (
        normalizedToolName === "bash"
        || normalizedToolName === "write_bash"
        || normalizedToolName === "read_bash"
        || normalizedToolName === "stop_bash"
        || normalizedToolName === "list_bash"
    ) {
        return true;
    }

    if (normalizedToolName === "str_replace_editor") {
        if (typeof toolArgs !== "object" || toolArgs === null || Array.isArray(toolArgs)) {
            return true;
        }

        const command = (toolArgs as Record<string, unknown>)["command"];
        return command !== "view";
    }

    return false;
}

function buildSessionHooks(stateRef: SessionStateRef): SessionHooks {
    return {
        onPreToolUse: (input: PreToolUseHookInput) => {
            if (stateRef.agentMode !== "ask") {
                return undefined;
            }

            if (!isAskModeMutation(input.toolName, input.toolArgs)) {
                return undefined;
            }

            return {
                permissionDecision: "deny",
                permissionDecisionReason: "Ask agent is limited to read-only analysis.",
            };
        },
    };
}

async function syncCustomAgent(
    sdkSession: CopilotSession,
    agentMode: AgentMode
): Promise<void> {
    const currentAgent = await sdkSession.rpc.agent.getCurrent();
    const selectedAgentName = currentAgent.agent?.name ?? null;

    if (agentMode === "ask") {
        if (selectedAgentName !== ASK_AGENT_NAME) {
            await sdkSession.rpc.agent.select({ name: ASK_AGENT_NAME });
        }
        return;
    }

    if (selectedAgentName !== null) {
        await sdkSession.rpc.agent.deselect();
    }
}

// SDK bazen mode.get() / mode.set() yanıtında `mode`'u tanımsız ya da tanınmayan bir değer
// olarak döndürebiliyor (özellikle resume akışında). Zod şeması runtimeMode'u zorunlu enum
// olarak işaretlediği için mobil tarafta "payload.runtimeMode required" validation hatası
// üretiyor. Bu guard her zaman geçerli bir enum döndürür.
function normalizeRuntimeMode(
    candidate: unknown,
    fallback: RuntimeMode
): RuntimeMode {
    if (candidate === "interactive" || candidate === "plan" || candidate === "autopilot") {
        return candidate;
    }
    return fallback;
}

type SDKToolExecutionCompleteData = Extract<SessionEvent, { type: "tool.execution_complete" }>["data"];

function extractToolExitCode(data: SDKToolExecutionCompleteData): number | undefined {
    for (const content of data.result?.contents ?? []) {
        if (content.type === "terminal" && typeof content.exitCode === "number") {
            return content.exitCode;
        }
    }

    return undefined;
}

function readToolTelemetryCount(
    toolTelemetry: Record<string, unknown> | undefined,
    key: string
): number | undefined {
    const value = toolTelemetry?.[key];
    return typeof value === "number" ? value : undefined;
}

function isSearchLikeToolName(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return normalized === "rg"
        || normalized.includes("grep")
        || normalized.includes("search")
        || normalized.includes("find")
        || normalized.includes("glob");
}

function normalizeToolCompletionStatus(params: {
    toolName: string;
    success: boolean;
    errorMessage?: string;
    exitCode?: number;
    toolTelemetry?: Record<string, unknown>;
}): Exclude<ToolExecutionStatus, "running"> {
    if (params.success) {
        return "completed";
    }

    const matchCount = readToolTelemetryCount(params.toolTelemetry, "matchCount")
        ?? readToolTelemetryCount(params.toolTelemetry, "matches")
        ?? readToolTelemetryCount(params.toolTelemetry, "resultCount");
    const errorText = params.errorMessage?.toLowerCase() ?? "";

    if (
        isSearchLikeToolName(params.toolName)
        && (params.exitCode === 1
            || matchCount === 0
            || errorText.includes("no matches")
            || errorText.includes("0 results")
            || errorText.includes("not found"))
    ) {
        return "no_results";
    }

    return "failed";
}

async function applySDKSessionState(
    sdkSession: CopilotSession,
    stateRef: SessionStateRef
): Promise<AdaptedSessionState> {
    await syncCustomAgent(sdkSession, stateRef.agentMode);
    const runtimeMode = deriveRuntimeMode(stateRef);
    const result = await sdkSession.rpc.mode.set({ mode: runtimeMode });
    const resolvedCandidate =
        result !== null && typeof result === "object" && "mode" in result
            ? result.mode
            : (await sdkSession.rpc.mode.get()).mode;

    return {
        agentMode: stateRef.agentMode,
        permissionLevel: stateRef.permissionLevel,
        runtimeMode: normalizeRuntimeMode(resolvedCandidate, runtimeMode),
    };
}

async function readSDKSessionState(
    sdkSession: CopilotSession,
    permissionLevel: PermissionLevel
): Promise<AdaptedSessionState> {
    const [modeResult, agentResult] = await Promise.all([
        sdkSession.rpc.mode.get(),
        sdkSession.rpc.agent.getCurrent(),
    ]);
    const agentMode: AgentMode =
        agentResult.agent?.name === ASK_AGENT_NAME
            ? "ask"
            : modeResult.mode === "plan"
                ? "plan"
                : "agent";
    const fallbackRuntimeMode = deriveRuntimeMode({ agentMode, permissionLevel });

    return {
        agentMode,
        permissionLevel,
        runtimeMode: normalizeRuntimeMode(modeResult.mode, fallbackRuntimeMode),
    };
}

function normalizeSessionHistory(
    events: ReadonlyArray<SessionEvent>
): Array<SessionHistoryItem> {
    const items: Array<SessionHistoryItem> = [];
    const toolIndexByRequestId = new Map<string, number>();

    function insertBeforeTrailingAssistant(item: SessionHistoryItem): void {
        let insertIndex = items.length;

        while (insertIndex > 0) {
            const existingItem = items[insertIndex - 1];
            if (existingItem === undefined || existingItem.type !== "assistant") {
                break;
            }
            insertIndex -= 1;
        }

        if (insertIndex === items.length) {
            items.push(item);
            return;
        }

        items.splice(insertIndex, 0, item);
    }

    for (const event of events) {
        const timestamp = parseEventTimestamp(event.timestamp);

        switch (event.type) {
            case "user.message":
                items.push({
                    id: event.id,
                    timestamp,
                    type: "user",
                    content: event.data.content,
                    ...(event.data.attachments !== undefined
                        ? {
                            attachments: event.data.attachments.flatMap((attachment) => {
                                if (attachment.type !== "blob") {
                                    return [];
                                }

                                return [{
                                    type: "blob" as const,
                                    data: attachment.data,
                                    mimeType: attachment.mimeType,
                                    ...(attachment.displayName !== undefined
                                        ? { displayName: attachment.displayName }
                                        : {}),
                                }];
                            }),
                        }
                        : {}),
                });
                break;

            case "assistant.reasoning":
                insertBeforeTrailingAssistant({
                    id: event.data.reasoningId,
                    timestamp,
                    type: "thinking",
                    content: event.data.content,
                });
                break;

            case "assistant.message":
                items.push({
                    id: event.data.messageId,
                    timestamp,
                    type: "assistant",
                    content: event.data.content,
                });
                break;

            case "tool.execution_start": {
                const nextIndex = items.length;
                const argumentsText = formatToolArgumentsForHistory(event.data.arguments);
                toolIndexByRequestId.set(event.data.toolCallId, nextIndex);
                items.push({
                    id: event.id,
                    timestamp,
                    type: "tool",
                    toolName: event.data.toolName,
                    requestId: event.data.toolCallId,
                    status: "running",
                    ...(argumentsText !== undefined ? { argumentsText } : {}),
                });
                break;
            }

            case "tool.execution_partial_result": {
                const existingIndex = toolIndexByRequestId.get(event.data.toolCallId);
                if (existingIndex === undefined) {
                    break;
                }

                const existingItem = items[existingIndex];
                if (existingItem !== undefined && existingItem.type === "tool") {
                    items[existingIndex] = {
                        ...existingItem,
                        partialOutput: (existingItem.partialOutput ?? "") + event.data.partialOutput,
                    };
                }
                break;
            }

            case "tool.execution_progress": {
                const existingIndex = toolIndexByRequestId.get(event.data.toolCallId);
                if (existingIndex === undefined) {
                    break;
                }

                const existingItem = items[existingIndex];
                if (existingItem !== undefined && existingItem.type === "tool") {
                    items[existingIndex] = {
                        ...existingItem,
                        progressMessage: event.data.progressMessage,
                    };
                }
                break;
            }

            case "tool.execution_complete": {
                const existingIndex = toolIndexByRequestId.get(event.data.toolCallId);
                const resultContent = event.data.result?.detailedContent ?? event.data.result?.content;
                const errorMessage = event.data.error?.message;
                const exitCode = extractToolExitCode(event.data);
                const toolName =
                    existingIndex !== undefined
                        && items[existingIndex] !== undefined
                        && items[existingIndex]?.type === "tool"
                        ? items[existingIndex].toolName
                        : "Tool";
                const status = normalizeToolCompletionStatus({
                    toolName,
                    success: event.data.success,
                    ...(errorMessage !== undefined ? { errorMessage } : {}),
                    ...(exitCode !== undefined ? { exitCode } : {}),
                    ...(event.data.toolTelemetry !== undefined
                        ? { toolTelemetry: event.data.toolTelemetry }
                        : {}),
                });

                if (existingIndex !== undefined) {
                    const existingItem = items[existingIndex];

                    if (existingItem !== undefined && existingItem.type === "tool") {
                        items[existingIndex] = {
                            ...existingItem,
                            timestamp,
                            status,
                            ...(resultContent !== undefined && resultContent.trim().length > 0
                                ? {
                                    partialOutput: existingItem.partialOutput !== undefined
                                        && existingItem.partialOutput.length > 0
                                        ? existingItem.partialOutput
                                        : resultContent,
                                }
                                : {}),
                            ...(errorMessage !== undefined ? { errorMessage } : {}),
                        };
                        break;
                    }
                }

                items.push({
                    id: event.id,
                    timestamp,
                    type: "tool",
                    toolName,
                    requestId: event.data.toolCallId,
                    status,
                    ...(resultContent !== undefined && resultContent.trim().length > 0
                        ? { partialOutput: resultContent }
                        : {}),
                    ...(errorMessage !== undefined ? { errorMessage } : {}),
                });
                break;
            }

            default:
                break;
        }
    }

    return items;
}

function formatToolArgumentsForHistory(args: unknown): string | undefined {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return undefined;
    }

    const keys = Object.keys(args);
    if (keys.length === 0) {
        return undefined;
    }

    return JSON.stringify(args, null, 2);
}

function normalizeToolArguments(
    args: unknown
): AdaptedToolStartDetails["arguments"] | undefined {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return undefined;
    }

    return args as Record<string, unknown>;
}

const VALID_PERMISSION_KINDS = new Set<string>(["shell", "write", "read", "mcp", "custom-tool", "url", "memory", "hook"]);

// SDK permission request -> adapted permission request conversion
function adaptPermissionRequest(req: SDKPermissionRequest): AdaptedPermissionRequest {
    const excludedKeys = new Set(["kind", "toolCallId", "toolName", "fileName", "fullCommandText", "commandText"]);
    const metadata = Object.fromEntries(
        Object.entries(req).filter(([k]) => !excludedKeys.has(k))
    );

    const base: AdaptedPermissionRequest = {
        id: req.toolCallId ?? randomUUID(),
        kind: VALID_PERMISSION_KINDS.has(req.kind) ? (req.kind as PermissionKind) : "custom-tool",
        metadata,
    };

    const toolName = req["toolName"] as string | undefined;
    const fileName = req["fileName"] as string | undefined;
    const commandText = (req["fullCommandText"] as string | undefined) ?? (req["commandText"] as string | undefined);

    if (toolName !== undefined) base.toolName = toolName;
    if (fileName !== undefined) base.fileName = fileName;
    if (commandText !== undefined) base.commandText = commandText;

    return base;
}

export function createCopilotAdapter(): AdaptedCopilotClient {
    const cliPath = resolvePreferredCopilotCliPath();
    if (cliPath !== undefined) {
        console.log(`[copilot] Using CLI binary: ${cliPath}`);
    } else {
        console.warn("[copilot] No external Copilot CLI binary detected. Falling back to the bundled SDK CLI.");
    }
    const client = new CopilotClient({
        cwd: WORKSPACE_ROOT,
        ...(cliPath !== undefined ? { cliPath } : {}),
    });
    const sessions = new Map<string, SessionRecord>();
    let startPromise: Promise<void> | null = null;

    // Permission/input handlers for each session can be set externally
    // using the proxy pattern
    type PermissionProxy = {
        handler: ((request: AdaptedPermissionRequest) => Promise<boolean>) | null;
    };
    type InputProxy = {
        handler: ((request: AdaptedUserInputRequest) => Promise<string>) | null;
    };

    // Wraps SDK CopilotSession, wires event listeners, and returns AdaptedCopilotSession
    function wrapSDKSession(
        sdkSession: CopilotSession,
        config: SessionConfig,
        workingDirectory: string,
        permissionProxy: PermissionProxy,
        inputProxy: InputProxy,
        stateRef: SessionStateRef
    ): AdaptedCopilotSession {
        const now = Date.now();
        const sessionId = sdkSession.sessionId;
        const info: SessionInfo = {
            id: sessionId,
            model: config.model,
            createdAt: now,
            lastActiveAt: now,
            status: "active",
            ...{ context: buildSessionContextFromWorkingDirectory(workingDirectory) },
        };

        const unsubscribes: Array<() => void> = [];

        const adapted: AdaptedCopilotSession = {
            id: sessionId,

            async send(message: SessionMessageInput): Promise<void> {
                info.lastActiveAt = Date.now();
                info.status = "active";
                await sdkSession.send(
                    message.attachments !== undefined && message.attachments.length > 0
                        ? { prompt: message.prompt, attachments: [...message.attachments] }
                        : { prompt: message.prompt }
                );
            },

            abort(): void {
                sdkSession.abort().catch((err: unknown) => {
                    console.error(`[sdk] Session ${sessionId} abort error:`, err);
                });
            },

            onMessage(handler: (content: string) => void): void {
                const unsub = sdkSession.on("assistant.message", (event) => {
                    handler(event.data.content);
                });
                unsubscribes.push(unsub);
            },

            onDelta(handler: (delta: string, index: number) => void): void {
                let deltaIndex = 0;
                const unsub = sdkSession.on("assistant.message_delta", (event) => {
                    handler(event.data.deltaContent, deltaIndex);
                    deltaIndex += 1;
                });
                unsubscribes.push(unsub);
            },

            onReasoning(handler: (content: string) => void): void {
                // SDK assistant.reasoning olayını dinle — tam düşünme içeriği
                const unsub = sdkSession.on("assistant.reasoning", (event) => {
                    handler(event.data.content);
                });
                unsubscribes.push(unsub);
            },

            onReasoningDelta(handler: (delta: string, index: number) => void): void {
                let deltaIndex = 0;
                const unsub = sdkSession.on("assistant.reasoning_delta", (event) => {
                    handler(event.data.deltaContent, deltaIndex);
                    deltaIndex += 1;
                });
                unsubscribes.push(unsub);
            },

            onPermissionRequest(
                handler: (request: AdaptedPermissionRequest) => Promise<boolean>
            ): void {
                permissionProxy.handler = handler;
            },

            onUserInputRequest(
                handler: (request: AdaptedUserInputRequest) => Promise<string>
            ): void {
                inputProxy.handler = handler;
            },

            onToolStart(
                handler: (
                    toolName: string,
                    requestId: string,
                    details?: AdaptedToolStartDetails
                ) => void
            ): void {
                const unsub = sdkSession.on("tool.execution_start", (event) => {
                    const argumentsPayload = normalizeToolArguments(event.data.arguments);
                    const details = argumentsPayload !== undefined
                        ? { arguments: argumentsPayload }
                        : undefined;
                    handler(event.data.toolName, event.data.toolCallId, details);
                });
                unsubscribes.push(unsub);
            },

            onToolPartialResult(handler: (requestId: string, partialOutput: string) => void): void {
                const unsub = sdkSession.on("tool.execution_partial_result", (event) => {
                    handler(event.data.toolCallId, event.data.partialOutput);
                });
                unsubscribes.push(unsub);
            },

            onToolProgress(handler: (requestId: string, progressMessage: string) => void): void {
                const unsub = sdkSession.on("tool.execution_progress", (event) => {
                    handler(event.data.toolCallId, event.data.progressMessage);
                });
                unsubscribes.push(unsub);
            },

            onToolComplete(
                handler: (
                    toolName: string,
                    requestId: string,
                    success: boolean,
                    details?: AdaptedToolCompletionDetails
                ) => void
            ): void {
                const unsub = sdkSession.on("tool.execution_complete", (event) => {
                    const details: AdaptedToolCompletionDetails = {};
                    const resultContent = event.data.result?.detailedContent ?? event.data.result?.content;
                    if (resultContent !== undefined) {
                        details.resultContent = resultContent;
                    }
                    if (event.data.error?.message !== undefined) {
                        details.errorMessage = event.data.error.message;
                    }
                    const exitCode = extractToolExitCode(event.data);
                    if (exitCode !== undefined) {
                        details.exitCode = exitCode;
                    }
                    if (event.data.toolTelemetry !== undefined) {
                        details.toolTelemetry = event.data.toolTelemetry;
                    }
                    handler("", event.data.toolCallId, event.data.success, details);
                });
                unsubscribes.push(unsub);
            },

            onIdle(handler: () => void): void {
                const unsub = sdkSession.on("session.idle", () => {
                    info.status = "idle";
                    handler();
                });
                unsubscribes.push(unsub);
            },

            onSessionError(handler: (errorType: string, message: string) => void): void {
                const unsub = sdkSession.on("session.error", (event) => {
                    handler(event.data.errorType, event.data.message);
                });
                unsubscribes.push(unsub);
            },

            onTitleChanged(handler: (title: string) => void): void {
                const unsub = sdkSession.on("session.title_changed", (event) => {
                    handler(event.data.title);
                });
                unsubscribes.push(unsub);
            },

            onIntent(handler: (intent: string) => void): void {
                const unsub = sdkSession.on("assistant.intent", (event) => {
                    handler(event.data.intent);
                });
                unsubscribes.push(unsub);
            },

            onUsage(handler: (usage: {
                tokenLimit: number;
                currentTokens: number;
                systemTokens?: number;
                conversationTokens?: number;
                toolDefinitionsTokens?: number;
                messagesLength?: number;
            }) => void): void {
                const unsub = sdkSession.on("session.usage_info", (event) => {
                    const payload: {
                        tokenLimit: number;
                        currentTokens: number;
                        systemTokens?: number;
                        conversationTokens?: number;
                        toolDefinitionsTokens?: number;
                        messagesLength?: number;
                    } = {
                        tokenLimit: event.data.tokenLimit,
                        currentTokens: event.data.currentTokens,
                    };
                    if (event.data.systemTokens !== undefined) {
                        payload.systemTokens = event.data.systemTokens;
                    }
                    if (event.data.conversationTokens !== undefined) {
                        payload.conversationTokens = event.data.conversationTokens;
                    }
                    if (event.data.toolDefinitionsTokens !== undefined) {
                        payload.toolDefinitionsTokens = event.data.toolDefinitionsTokens;
                    }
                    if (event.data.messagesLength !== undefined) {
                        payload.messagesLength = event.data.messagesLength;
                    }
                    handler(payload);
                });
                unsubscribes.push(unsub);
            },

            onRuntimeModeChanged(handler: (runtimeMode: RuntimeMode) => void): void {
                const unsub = sdkSession.on("session.mode_changed", (event) => {
                    handler(event.data.newMode as RuntimeMode);
                });
                unsubscribes.push(unsub);
            },

            onPlanExitRequest(handler: (request: AdaptedPlanExitRequest) => void): void {
                const unsub = sdkSession.on("exit_plan_mode.requested", (event) => {
                    handler({
                        requestId: event.data.requestId,
                        summary: event.data.summary,
                        planContent: event.data.planContent,
                        actions: event.data.actions,
                        recommendedAction: event.data.recommendedAction,
                    });
                });
                unsubscribes.push(unsub);
            },

            async getHistory(): Promise<ReadonlyArray<SessionHistoryItem>> {
                const events = await sdkSession.getMessages();
                return normalizeSessionHistory(events);
            },

            unsubscribeAll(): void {
                for (const unsub of unsubscribes) unsub();
                unsubscribes.length = 0;
            },

            close(): void {
                info.status = "closed";
                for (const unsub of unsubscribes) unsub();
                sdkSession.disconnect().catch((err: unknown) => {
                    console.error(`[sdk] Session ${sessionId} disconnect error:`, err);
                });
                sessions.delete(sessionId);
            },

            getInfo(): SessionInfo {
                return { ...info };
            },

            getCapabilities(): HostSessionCapabilities {
                const caps = sdkSession.capabilities;
                return {
                    elicitation: caps?.ui?.elicitation === true,
                };
            },

            applyState(nextState: AdaptedSessionState): Promise<AdaptedSessionState> {
                stateRef.agentMode = nextState.agentMode;
                stateRef.permissionLevel = nextState.permissionLevel;
                return applySDKSessionState(sdkSession, stateRef);
            },

            getState(permissionLevel: PermissionLevel): Promise<AdaptedSessionState> {
                stateRef.permissionLevel = permissionLevel;
                return readSDKSessionState(sdkSession, permissionLevel);
            },
        };

        sessions.set(sessionId, { session: adapted, info, unsubscribes });
        return adapted;
    }

    // SDK onPermissionRequest and onUserInputRequest handler factory
    function createSDKPermissionHandler(
        permissionProxy: PermissionProxy
    ): (request: SDKPermissionRequest, invocation: { sessionId: string }) => Promise<PermissionRequestResult> {
        return async (request) => {
            if (permissionProxy.handler === null) {
                return { kind: "denied-interactively-by-user" as const };
            }
            const adapted = adaptPermissionRequest(request);
            let approved: boolean;
            try {
                approved = await permissionProxy.handler(adapted);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `Permission request handler failed for kind=${adapted.kind} requestId=${adapted.id}: ${message}`
                );
            }
            return approved
                ? { kind: "approved" as const }
                : { kind: "denied-interactively-by-user" as const };
        };
    }

    function createSDKUserInputHandler(
        inputProxy: InputProxy
    ): (request: SDKUserInputRequest, invocation: { sessionId: string }) => Promise<{ answer: string; wasFreeform: boolean }> {
        return async (request) => {
            if (inputProxy.handler === null) {
                return { answer: "", wasFreeform: true };
            }
            const adaptedRequest = {
                question: request.question,
                ...(request.choices !== undefined ? { choices: request.choices } : {}),
                ...(request.allowFreeform !== undefined ? { allowFreeform: request.allowFreeform } : {}),
            };
            let value: string;
            try {
                value = await inputProxy.handler(adaptedRequest);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `User input handler failed for question="${request.question}": ${message}`
                );
            }
            return { answer: value, wasFreeform: true };
        };
    }

    async function ensureConnected(): Promise<void> {
        const state = client.getState();

        if (state === "connected") {
            return;
        }

        if (startPromise !== null) {
            await startPromise;
            return;
        }

        startPromise = client.start().finally(() => {
            startPromise = null;
        });

        await startPromise;
    }

    return {
        async createSession(config: SessionConfig): Promise<AdaptedCopilotSession> {
            await ensureConnected();

            const permissionProxy: PermissionProxy = { handler: null };
            const inputProxy: InputProxy = { handler: null };
            const stateRef: SessionStateRef = {
                agentMode: config.agentMode,
                permissionLevel: config.permissionLevel,
            };
            const workingDirectory = resolveRequestedWorkspaceRoot(config.workspaceRoot);

            const sdkConfig: SDKSessionConfig = {
                model: config.model,
                streaming: config.streaming,
                workingDirectory,
                onPermissionRequest: createSDKPermissionHandler(permissionProxy),
                onUserInputRequest: createSDKUserInputHandler(inputProxy),
                customAgents: [ASK_AGENT_CONFIG],
                hooks: buildSessionHooks(stateRef),
                ...(config.agentMode === "ask" ? { agent: ASK_AGENT_NAME } : {}),
            };

            // Only pass reasoning effort if model supports it.
            if (config.reasoningEffort !== undefined) {
                sdkConfig.reasoningEffort = config.reasoningEffort;
            }

            const sdkSession = await client.createSession(sdkConfig);
            const session = wrapSDKSession(
                sdkSession,
                config,
                workingDirectory,
                permissionProxy,
                inputProxy,
                stateRef
            );
            await session.applyState({
                agentMode: config.agentMode,
                permissionLevel: config.permissionLevel,
                runtimeMode: deriveRuntimeMode(stateRef),
            });
            return session;
        },

        async resumeSession(sessionId: string): Promise<AdaptedCopilotSession> {
            const existing = sessions.get(sessionId);
            if (existing !== undefined) {
                existing.info.status = "active";
                existing.info.lastActiveAt = Date.now();
                return existing.session;
            }

            await ensureConnected();

            const permissionProxy: PermissionProxy = { handler: null };
            const inputProxy: InputProxy = { handler: null };
            const metadata = await client.getSessionMetadata(sessionId);
            const config: SessionConfig = {
                model: MODEL_UNKNOWN,
                streaming: true,
                agentMode: "agent",
                permissionLevel: "default",
            };
            const stateRef: SessionStateRef = {
                agentMode: config.agentMode,
                permissionLevel: config.permissionLevel,
            };

            const resumeWorkingDirectory = metadata?.context?.cwd ?? PROCESS_CWD;
            const resumeConfig: ResumeSessionConfig = {
                onPermissionRequest: createSDKPermissionHandler(permissionProxy),
                onUserInputRequest: createSDKUserInputHandler(inputProxy),
                workingDirectory: resumeWorkingDirectory,
                customAgents: [ASK_AGENT_CONFIG],
                hooks: buildSessionHooks(stateRef),
            };

            const sdkSession = await client.resumeSession(sessionId, resumeConfig);
            const session = wrapSDKSession(
                sdkSession,
                config,
                resumeWorkingDirectory,
                permissionProxy,
                inputProxy,
                stateRef
            );
            const record = sessions.get(session.id);

            if (record !== undefined && metadata !== undefined) {
                Object.assign(record.info, adaptSessionInfoFromMetadata(metadata), {
                    status: "active",
                    model: record.info.model,
                    id: record.info.id,
                });
            }

            return session;
        },

        async listSessions(): Promise<ReadonlyArray<SessionInfo>> {
            await ensureConnected();

            const metadataList = await client.listSessions();

            return metadataList.map(adaptSessionInfoFromMetadata);
        },

        async deleteSession(sessionId: string): Promise<void> {
            await ensureConnected();

            const record = sessions.get(sessionId);
            if (record !== undefined) {
                record.session.close();
            }
            try {
                await client.deleteSession(sessionId);
            } catch (error: unknown) {
                if (isSessionAlreadyDeletedError(error)) {
                    return;
                }

                throw error;
            }
        },

        async listModels(): Promise<ReadonlyArray<ModelInfo>> {
            await ensureConnected();

            const models = await client.listModels();
            return models.map(normalizeModelInfo);
        },

        async isAvailable(): Promise<boolean> {
            try {
                await ensureConnected();
                await client.listModels();
                return true;
            } catch {
                return false;
            }
        },

        async shutdown(): Promise<void> {
            for (const [, record] of sessions) {
                record.session.close();
            }
            sessions.clear();
            await client.stop();
        },
    };
}

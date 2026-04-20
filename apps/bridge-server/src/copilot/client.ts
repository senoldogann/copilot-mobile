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
} from "@github/copilot-sdk";

// SDK does not export ReasoningEffort type from public index; derive array element type.
type SDKReasoningEffort = NonNullable<SDKModelInfo["supportedReasoningEfforts"]>[number];
import type {
    AdaptedCopilotClient,
    AdaptedCopilotSession,
    AdaptedPermissionRequest,
    AdaptedToolStartDetails,
    SessionConfig,
    SessionInfo,
    SessionHistoryItem,
    ModelInfo,
    PermissionKind,
    ReasoningEffortLevel,
    HostSessionCapabilities,
    SessionMessageInput,
} from "@copilot-mobile/shared";
import { MODEL_UNKNOWN } from "@copilot-mobile/shared";
import type { SessionMetadata } from "@github/copilot-sdk";

type SessionRecord = {
    session: AdaptedCopilotSession;
    info: SessionInfo;
    unsubscribes: Array<() => void>;
};

function adaptSessionContext(metadata: SessionMetadata): SessionInfo["context"] {
    const context = metadata.context;

    if (context === undefined) {
        return undefined;
    }

    return {
        cwd: context.cwd,
        ...(context.gitRoot !== undefined ? { gitRoot: context.gitRoot } : {}),
        ...(context.repository !== undefined ? { repository: context.repository } : {}),
        ...(context.branch !== undefined ? { branch: context.branch } : {}),
    };
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

    // 2. Support exists but no list — conservative: level list unknown
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

function normalizeSessionHistory(
    events: ReadonlyArray<SessionEvent>
): Array<SessionHistoryItem> {
    const items: Array<SessionHistoryItem> = [];
    const toolIndexByRequestId = new Map<string, number>();

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
                items.push({
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
                toolIndexByRequestId.set(event.data.toolCallId, nextIndex);
                items.push({
                    id: event.id,
                    timestamp,
                    type: "tool",
                    toolName: event.data.toolName,
                    requestId: event.data.toolCallId,
                    status: "running",
                    ...(formatToolArgumentsForHistory(event.data.arguments) !== undefined
                        ? { argumentsText: formatToolArgumentsForHistory(event.data.arguments) }
                        : {}),
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

                if (existingIndex !== undefined) {
                    const existingItem = items[existingIndex];

                    if (existingItem !== undefined && existingItem.type === "tool") {
                        items[existingIndex] = {
                            ...existingItem,
                            timestamp,
                            status: event.data.success ? "completed" : "failed",
                        };
                        break;
                    }
                }

                items.push({
                    id: event.id,
                    timestamp,
                    type: "tool",
                    toolName: "Tool",
                    requestId: event.data.toolCallId,
                    status: event.data.success ? "completed" : "failed",
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
    const client = new CopilotClient();
    const sessions = new Map<string, SessionRecord>();
    let startPromise: Promise<void> | null = null;

    // Permission/input handlers for each session can be set externally
    // using the proxy pattern
    type PermissionProxy = {
        handler: ((request: AdaptedPermissionRequest) => Promise<boolean>) | null;
    };
    type InputProxy = {
        handler: ((prompt: string) => Promise<string>) | null;
    };

    // Wraps SDK CopilotSession, wires event listeners, and returns AdaptedCopilotSession
    function wrapSDKSession(
        sdkSession: CopilotSession,
        config: SessionConfig,
        permissionProxy: PermissionProxy,
        inputProxy: InputProxy
    ): AdaptedCopilotSession {
        const now = Date.now();
        const sessionId = sdkSession.sessionId;
        const info: SessionInfo = {
            id: sessionId,
            model: config.model,
            createdAt: now,
            lastActiveAt: now,
            status: "active",
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
                handler: (prompt: string) => Promise<string>
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
                    handler(event.data.toolName, event.data.toolCallId, {
                        ...(normalizeToolArguments(event.data.arguments) !== undefined
                            ? { arguments: normalizeToolArguments(event.data.arguments) }
                            : {}),
                    });
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

            onToolComplete(handler: (toolName: string, requestId: string, success: boolean) => void): void {
                const unsub = sdkSession.on("tool.execution_complete", (event) => {
                    // tool.execution_complete event has no toolName — toolCallId is used
                    handler("", event.data.toolCallId, event.data.success);
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
            const approved = await permissionProxy.handler(adapted);
            return approved
                ? { kind: "approved" as const }
                : { kind: "denied-interactively-by-user" as const };
        };
    }

    function createSDKUserInputHandler(
        inputProxy: InputProxy
    ): (request: { question: string }, invocation: { sessionId: string }) => Promise<{ answer: string; wasFreeform: boolean }> {
        return async (request) => {
            if (inputProxy.handler === null) {
                return { answer: "", wasFreeform: true };
            }
            const value = await inputProxy.handler(request.question);
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

            const sdkConfig: SDKSessionConfig = {
                model: config.model,
                streaming: config.streaming,
                onPermissionRequest: createSDKPermissionHandler(permissionProxy),
                onUserInputRequest: createSDKUserInputHandler(inputProxy),
            };

            // Only pass reasoning effort if model supports it.
            if (config.reasoningEffort !== undefined) {
                sdkConfig.reasoningEffort = config.reasoningEffort;
            }

            const sdkSession = await client.createSession(sdkConfig);
            return wrapSDKSession(sdkSession, config, permissionProxy, inputProxy);
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
            };

            const resumeConfig: ResumeSessionConfig = {
                onPermissionRequest: createSDKPermissionHandler(permissionProxy),
                onUserInputRequest: createSDKUserInputHandler(inputProxy),
            };

            const sdkSession = await client.resumeSession(sessionId, resumeConfig);
            const session = wrapSDKSession(sdkSession, config, permissionProxy, inputProxy);
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
            } catch (err: unknown) {
                console.warn(`[sdk] Session ${sessionId} delete error (may already be deleted):`, err);
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

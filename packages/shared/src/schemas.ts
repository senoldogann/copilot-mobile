// Zod schemas — runtime message validation
// All WebSocket messages are validated on both sides

import { z } from "zod";

// --- Base Schemas ---

const CERT_FINGERPRINT_PATTERN = /^[a-fA-F0-9]{64}$/;

const baseBridgeMessageSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.number().int().positive(),
    seq: z.number().int().nonnegative(),
});

const sessionConfigSchema = z.object({
    model: z.string().min(1),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    streaming: z.boolean(),
    agentMode: z.enum(["agent", "plan", "ask"]),
    permissionLevel: z.enum(["default", "bypass", "autopilot"]),
});

const sessionContextSchema = z.object({
    cwd: z.string().min(1),
    gitRoot: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
});

let workspaceTreeNodeSchema: z.ZodType<import("./protocol").WorkspaceTreeNode>;
workspaceTreeNodeSchema = z.lazy(() => z.object({
    name: z.string().min(1),
    path: z.string(),
    type: z.enum(["file", "directory", "symlink"]),
    size: z.number().int().nonnegative().optional(),
    modifiedAt: z.number().nonnegative().optional(),
    children: z.array(workspaceTreeNodeSchema).readonly().optional(),
})) as z.ZodType<import("./protocol").WorkspaceTreeNode>;

const gitFileChangeSchema = z.object({
    path: z.string().min(1),
    status: z.enum([
        "added",
        "modified",
        "deleted",
        "renamed",
        "copied",
        "untracked",
        "conflicted",
        "type_changed",
        "unknown",
    ]),
    indexStatus: z.string().min(1),
    worktreeStatus: z.string().min(1),
    originalPath: z.string().min(1).optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
});

const gitCommitSummarySchema = z.object({
    hash: z.string().min(1),
    shortHash: z.string().min(1),
    subject: z.string(),
    author: z.string().min(1),
    committedAt: z.number().int().nonnegative(),
    files: z.array(z.string().min(1)).readonly(),
});

const sessionInfoSchema = z.object({
    id: z.string().min(1),
    model: z.string().min(1),
    createdAt: z.number().int().positive(),
    lastActiveAt: z.number().int().positive(),
    status: z.enum(["active", "idle", "closed"]),
    summary: z.string().min(1).optional(),
    title: z.string().optional(),
    context: sessionContextSchema.optional(),
});

const sessionMessageAttachmentSchema = z.object({
    type: z.literal("blob"),
    data: z.string().min(1),
    mimeType: z.string().min(1),
    displayName: z.string().min(1).optional(),
});

const toolArgumentsSchema = z.record(z.unknown());

const sessionHistoryItemSchema = z.discriminatedUnion("type", [
    z.object({
        id: z.string().min(1),
        timestamp: z.number().int().nonnegative(),
        type: z.literal("user"),
        content: z.string(),
        attachments: z.array(sessionMessageAttachmentSchema).optional(),
    }),
    z.object({
        id: z.string().min(1),
        timestamp: z.number().int().nonnegative(),
        type: z.literal("assistant"),
        content: z.string(),
    }),
    z.object({
        id: z.string().min(1),
        timestamp: z.number().int().nonnegative(),
        type: z.literal("thinking"),
        content: z.string(),
    }),
    z.object({
        id: z.string().min(1),
        timestamp: z.number().int().nonnegative(),
        type: z.literal("tool"),
        toolName: z.string().min(1),
        requestId: z.string().min(1),
        status: z.enum(["running", "completed", "failed"]),
        argumentsText: z.string().optional(),
        progressMessage: z.string().optional(),
        partialOutput: z.string().optional(),
    }),
]);

const permissionKindSchema = z.enum([
    "shell",
    "write",
    "read",
    "mcp",
    "custom-tool",
    "url",
    "memory",
    "hook",
]);

const permissionRequestPayloadSchema = z.object({
    sessionId: z.string().min(1),
    requestId: z.string().min(1),
    kind: permissionKindSchema,
    toolName: z.string().optional(),
    fileName: z.string().optional(),
    fullCommandText: z.string().optional(),
    metadata: z.record(z.unknown()),
});

const permissionResponsePayloadSchema = z.object({
    requestId: z.string().min(1),
    approved: z.boolean(),
});

const errorPayloadSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
    retry: z.boolean(),
});

const reasoningEffortLevelSchema = z.enum(["low", "medium", "high", "xhigh"]);

const modelInfoSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    provider: z.string().min(1),
    policyState: z.enum(["enabled", "disabled", "unconfigured"]).optional(),
    billingMultiplier: z.number().nonnegative().optional(),
    supportsVision: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    supportedReasoningEfforts: z.array(reasoningEffortLevelSchema).readonly().optional(),
    defaultReasoningEffort: reasoningEffortLevelSchema.optional(),
    contextWindowTokens: z.number().int().nonnegative().optional(),
});

const hostSessionCapabilitiesSchema = z.object({
    elicitation: z.boolean(),
});

const bridgeSettingsSchema = z.object({
    autoApproveReads: z.boolean(),
    readApprovalsConfigurable: z.boolean(),
});

const capabilitiesStatePayloadSchema = z.object({
    host: hostSessionCapabilitiesSchema,
    bridge: bridgeSettingsSchema,
});

const sessionStatePayloadSchema = z.object({
    sessionId: z.string().min(1),
    agentMode: z.enum(["agent", "plan", "ask"]),
    permissionLevel: z.enum(["default", "bypass", "autopilot"]),
    runtimeMode: z.enum(["interactive", "plan", "autopilot"]),
});

const userInputRequestPayloadSchema = z.object({
    sessionId: z.string().min(1),
    requestId: z.string().uuid(),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).readonly().optional(),
    allowFreeform: z.boolean().optional(),
});

const planExitRequestPayloadSchema = z.object({
    sessionId: z.string().min(1),
    requestId: z.string().min(1),
    summary: z.string(),
    planContent: z.string(),
    actions: z.array(z.string().min(1)).readonly(),
    recommendedAction: z.string().min(1),
});

const workspaceOperationResultPayloadSchema = z.object({
    sessionId: z.string().min(1),
    context: sessionContextSchema,
    operation: z.enum(["pull", "push"]),
    success: z.boolean(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().optional(),
    signal: z.string().nullable().optional(),
    message: z.string().optional(),
});

// --- Server → Client Message Schemas ---

const pairingSuccessSchema = baseBridgeMessageSchema.extend({
    type: z.literal("pairing.success"),
    payload: z.object({
        jwt: z.string().min(1),
        deviceId: z.string().min(1),
        certFingerprint: z.string().regex(CERT_FINGERPRINT_PATTERN).nullable(),
    }),
});

const sessionCreatedSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.created"),
    payload: z.object({ session: sessionInfoSchema }),
});

const sessionResumedSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.resumed"),
    payload: z.object({ session: sessionInfoSchema }),
});

const sessionIdleSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.idle"),
    payload: z.object({ sessionId: z.string().min(1) }),
});

const sessionListSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.list"),
    payload: z.object({ sessions: z.array(sessionInfoSchema) }),
});

const sessionHistorySchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.history"),
    payload: z.object({
        sessionId: z.string().min(1),
        items: z.array(sessionHistoryItemSchema),
    }),
});

const assistantMessageSchema = baseBridgeMessageSchema.extend({
    type: z.literal("assistant.message"),
    payload: z.object({ sessionId: z.string().min(1), content: z.string() }),
});

const assistantMessageDeltaSchema = baseBridgeMessageSchema.extend({
    type: z.literal("assistant.message_delta"),
    payload: z.object({
        sessionId: z.string().min(1),
        delta: z.string(),
        index: z.number().int().nonnegative(),
    }),
});

const assistantReasoningSchema = baseBridgeMessageSchema.extend({
    type: z.literal("assistant.reasoning"),
    payload: z.object({ sessionId: z.string().min(1), content: z.string() }),
});

const assistantReasoningDeltaSchema = baseBridgeMessageSchema.extend({
    type: z.literal("assistant.reasoning_delta"),
    payload: z.object({
        sessionId: z.string().min(1),
        delta: z.string(),
        index: z.number().int().nonnegative(),
    }),
});

const toolExecutionStartSchema = baseBridgeMessageSchema.extend({
    type: z.literal("tool.execution_start"),
    payload: z.object({
        sessionId: z.string().min(1),
        toolName: z.string().min(1),
        requestId: z.string().min(1),
        arguments: toolArgumentsSchema.optional(),
    }),
});

const toolExecutionPartialResultSchema = baseBridgeMessageSchema.extend({
    type: z.literal("tool.execution_partial_result"),
    payload: z.object({
        sessionId: z.string().min(1),
        requestId: z.string().min(1),
        partialOutput: z.string(),
    }),
});

const toolExecutionProgressSchema = baseBridgeMessageSchema.extend({
    type: z.literal("tool.execution_progress"),
    payload: z.object({
        sessionId: z.string().min(1),
        requestId: z.string().min(1),
        progressMessage: z.string().min(1),
    }),
});

const toolExecutionCompleteSchema = baseBridgeMessageSchema.extend({
    type: z.literal("tool.execution_complete"),
    payload: z.object({
        sessionId: z.string().min(1),
        toolName: z.string().min(1),
        requestId: z.string().min(1),
        success: z.boolean(),
    }),
});

const permissionRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("permission.request"),
    payload: permissionRequestPayloadSchema,
});

const userInputRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("user_input.request"),
    payload: userInputRequestPayloadSchema,
});

const modelsListSchema = baseBridgeMessageSchema.extend({
    type: z.literal("models.list"),
    payload: z.object({ models: z.array(modelInfoSchema) }),
});

const errorMessageSchema = baseBridgeMessageSchema.extend({
    type: z.literal("error"),
    payload: errorPayloadSchema,
});

const connectionStatusSchema = baseBridgeMessageSchema.extend({
    type: z.literal("connection.status"),
    payload: z.object({
        cliConnected: z.boolean(),
        uptime: z.number().nonnegative(),
        activeSessionCount: z.number().int().nonnegative(),
    }),
});

const tokenRefreshSchema = baseBridgeMessageSchema.extend({
    type: z.literal("token.refresh"),
    payload: z.object({ jwt: z.string().min(1) }),
});

const reconnectReadySchema = baseBridgeMessageSchema.extend({
    type: z.literal("reconnect.ready"),
    payload: z.object({}).strict(),
});

const capabilitiesStateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("capabilities.state"),
    payload: capabilitiesStatePayloadSchema,
});

const sessionStateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.state"),
    payload: sessionStatePayloadSchema,
});

const sessionErrorSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.error"),
    payload: z.object({
        sessionId: z.string().min(1),
        errorType: z.string().min(1),
        message: z.string().min(1),
    }),
});

const sessionTitleChangedSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.title_changed"),
    payload: z.object({
        sessionId: z.string().min(1),
        title: z.string(),
    }),
});

const assistantIntentSchema = baseBridgeMessageSchema.extend({
    type: z.literal("assistant.intent"),
    payload: z.object({
        sessionId: z.string().min(1),
        intent: z.string().min(1),
    }),
});

const planExitRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("plan.exit.request"),
    payload: planExitRequestPayloadSchema,
});

const workspaceTreeSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.tree"),
    payload: z.object({
        sessionId: z.string().min(1),
        context: sessionContextSchema,
        rootPath: z.string().min(1),
        requestedPath: z.string(),
        tree: workspaceTreeNodeSchema,
        truncated: z.boolean(),
    }),
});

const workspaceGitSummarySchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.git.summary"),
    payload: z.object({
        sessionId: z.string().min(1),
        context: sessionContextSchema,
        rootPath: z.string().min(1),
        gitRoot: z.string().min(1).nullable(),
        repository: z.string().optional(),
        branch: z.string().optional(),
        uncommittedChanges: z.array(gitFileChangeSchema),
        recentCommits: z.array(gitCommitSummarySchema),
        truncated: z.boolean(),
    }),
});

const workspacePullResultSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.pull.result"),
    payload: workspaceOperationResultPayloadSchema.extend({
        operation: z.literal("pull"),
    }),
});

const workspacePushResultSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.push.result"),
    payload: workspaceOperationResultPayloadSchema.extend({
        operation: z.literal("push"),
    }),
});

const workspaceFileResponseSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.file.response"),
    payload: z.object({
        sessionId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        mimeType: z.string(),
        truncated: z.boolean(),
        error: z.string().optional(),
    }),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
    pairingSuccessSchema,
    sessionCreatedSchema,
    sessionResumedSchema,
    sessionIdleSchema,
    sessionListSchema,
    sessionHistorySchema,
    assistantMessageSchema,
    assistantMessageDeltaSchema,
    assistantReasoningSchema,
    assistantReasoningDeltaSchema,
    toolExecutionStartSchema,
    toolExecutionPartialResultSchema,
    toolExecutionProgressSchema,
    toolExecutionCompleteSchema,
    permissionRequestSchema,
    userInputRequestSchema,
    modelsListSchema,
    errorMessageSchema,
    connectionStatusSchema,
    tokenRefreshSchema,
    reconnectReadySchema,
    capabilitiesStateSchema,
    sessionStateSchema,
    sessionErrorSchema,
    sessionTitleChangedSchema,
    assistantIntentSchema,
    planExitRequestSchema,
    workspaceTreeSchema,
    workspaceGitSummarySchema,
    workspacePullResultSchema,
    workspacePushResultSchema,
    workspaceFileResponseSchema,
]);

// --- Client → Server Message Schemas ---

const authPairSchema = baseBridgeMessageSchema.extend({
    type: z.literal("auth.pair"),
    payload: z.object({ pairingToken: z.string().min(1) }),
});

const sessionCreateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.create"),
    payload: z.object({ config: sessionConfigSchema }),
});

const sessionResumeSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.resume"),
    payload: z.object({ sessionId: z.string().min(1) }),
});

const sessionListRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.list"),
    payload: z.object({}).strict(),
});

const sessionDeleteSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.delete"),
    payload: z.object({ sessionId: z.string().min(1) }),
});

const messageSendSchema = baseBridgeMessageSchema.extend({
    type: z.literal("message.send"),
    payload: z.object({
        sessionId: z.string().min(1),
        content: z.string().min(1),
        attachments: z.array(sessionMessageAttachmentSchema).optional(),
    }),
});

const messageAbortSchema = baseBridgeMessageSchema.extend({
    type: z.literal("message.abort"),
    payload: z.object({ sessionId: z.string().min(1) }),
});

const permissionRespondSchema = baseBridgeMessageSchema.extend({
    type: z.literal("permission.respond"),
    payload: permissionResponsePayloadSchema,
});

const userInputRespondSchema = baseBridgeMessageSchema.extend({
    type: z.literal("user_input.respond"),
    payload: z.object({
        requestId: z.string().uuid(),
        value: z.string(),
    }),
});

const settingsUpdateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("settings.update"),
    payload: z.object({ autoApproveReads: z.boolean() }),
});

const sessionModeUpdateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.mode.update"),
    payload: z.object({
        sessionId: z.string().min(1),
        agentMode: z.enum(["agent", "plan", "ask"]),
    }),
});

const permissionLevelUpdateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("permission.level.update"),
    payload: z.object({
        sessionId: z.string().min(1),
        permissionLevel: z.enum(["default", "bypass", "autopilot"]),
    }),
});

const modelsRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("models.request"),
    payload: z.object({}).strict(),
});

const reconnectSchema = baseBridgeMessageSchema.extend({
    type: z.literal("reconnect"),
    payload: z.object({ lastSeenSeq: z.number().int().nonnegative() }),
});

const capabilitiesRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("capabilities.request"),
    payload: z.object({}).strict(),
});

const workspaceTreeRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.tree.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        path: z.string().optional(),
        maxDepth: z.number().int().positive().optional(),
    }),
});

const workspaceGitSummaryRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.git.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        commitLimit: z.number().int().positive().optional(),
    }),
});

const workspacePullSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.pull"),
    payload: z.object({
        sessionId: z.string().min(1),
    }),
});

const workspacePushSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.push"),
    payload: z.object({
        sessionId: z.string().min(1),
    }),
});

const workspaceFileRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.file.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        path: z.string().min(1),
        maxBytes: z.number().int().positive().optional(),
    }),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
    authPairSchema,
    sessionCreateSchema,
    sessionResumeSchema,
    sessionListRequestSchema,
    sessionDeleteSchema,
    messageSendSchema,
    messageAbortSchema,
    permissionRespondSchema,
    userInputRespondSchema,
    settingsUpdateSchema,
    sessionModeUpdateSchema,
    permissionLevelUpdateSchema,
    modelsRequestSchema,
    reconnectSchema,
    capabilitiesRequestSchema,
    workspaceTreeRequestSchema,
    workspaceGitSummaryRequestSchema,
    workspacePullSchema,
    workspacePushSchema,
    workspaceFileRequestSchema,
]);

// --- QR Payload Schema ---

export const qrPayloadSchema = z.object({
    url: z
        .string()
        .url()
        .refine(
            (value) => value.startsWith("ws://") || value.startsWith("wss://"),
            "QR URL must use ws:// or wss://"
        ),
    token: z.string().min(32),
    certFingerprint: z.string().regex(CERT_FINGERPRINT_PATTERN).nullable(),
    version: z.number().int().positive(),
}).superRefine((value, context) => {
    if (value.url.startsWith("wss://") && value.certFingerprint === null) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["certFingerprint"],
            message: "A secure WebSocket QR payload requires a certificate fingerprint",
        });
    }
});

// --- Helper Types ---

export type ServerMessageSchemaType = z.infer<typeof serverMessageSchema>;
export type ClientMessageSchemaType = z.infer<typeof clientMessageSchema>;
export type QRPayloadSchemaType = z.infer<typeof qrPayloadSchema>;

// --- Derleme zamanı tip uyumluluk kontrolü ---
// Zod schema'ları ile TypeScript tipleri arasındaki yapısal uyumu doğrular.
// exactOptionalPropertyTypes nedeniyle tam ikili uyum yerine discriminant bazlı kontrol yapılır.

import type {
    ServerMessage,
    ClientMessage,
    QRPayload,
    WorkspaceTreeNode,
    GitFileChange,
    GitCommitSummary,
    WorkspaceOperationResultPayload,
} from "./protocol";

type _AssertServerTypes = z.infer<typeof serverMessageSchema>["type"] extends ServerMessage["type"] ? true : never;
type _AssertServerTypesReverse = ServerMessage["type"] extends z.infer<typeof serverMessageSchema>["type"] ? true : never;
const _checkServerTypes: _AssertServerTypes & _AssertServerTypesReverse = true;
void _checkServerTypes;

type _AssertClientTypes = z.infer<typeof clientMessageSchema>["type"] extends ClientMessage["type"] ? true : never;
type _AssertClientTypesReverse = ClientMessage["type"] extends z.infer<typeof clientMessageSchema>["type"] ? true : never;
const _checkClientTypes: _AssertClientTypes & _AssertClientTypesReverse = true;
void _checkClientTypes;

type _AssertWorkspaceTreeNode = z.infer<typeof workspaceTreeNodeSchema> extends WorkspaceTreeNode ? true : never;
type _AssertWorkspaceTreeNodeReverse = WorkspaceTreeNode extends z.infer<typeof workspaceTreeNodeSchema> ? true : never;
const _checkWorkspaceTreeNode: _AssertWorkspaceTreeNode & _AssertWorkspaceTreeNodeReverse = true;
void _checkWorkspaceTreeNode;

type _AssertGitFileChange = z.infer<typeof gitFileChangeSchema> extends GitFileChange ? true : never;
type _AssertGitFileChangeReverse = GitFileChange extends z.infer<typeof gitFileChangeSchema> ? true : never;
const _checkGitFileChange: _AssertGitFileChange & _AssertGitFileChangeReverse = true;
void _checkGitFileChange;

type _AssertGitCommitSummary = z.infer<typeof gitCommitSummarySchema> extends GitCommitSummary ? true : never;
type _AssertGitCommitSummaryReverse = GitCommitSummary extends z.infer<typeof gitCommitSummarySchema> ? true : never;
const _checkGitCommitSummary: _AssertGitCommitSummary & _AssertGitCommitSummaryReverse = true;
void _checkGitCommitSummary;

type _AssertWorkspaceOperationResult =
    z.infer<typeof workspaceOperationResultPayloadSchema> extends WorkspaceOperationResultPayload ? true : never;
type _AssertWorkspaceOperationResultReverse =
    WorkspaceOperationResultPayload extends z.infer<typeof workspaceOperationResultPayloadSchema> ? true : never;
const _checkWorkspaceOperationResult: _AssertWorkspaceOperationResult & _AssertWorkspaceOperationResultReverse = true;
void _checkWorkspaceOperationResult;

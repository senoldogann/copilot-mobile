// Zod schemas — runtime message validation
// All WebSocket messages are validated on both sides

import { z } from "zod";

// --- Base Schemas ---

const CERT_FINGERPRINT_PATTERN = /^[a-fA-F0-9]{64}$/;

const baseBridgeMessageSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.number().int().positive(),
    seq: z.number().int().nonnegative(),
    protocolVersion: z.number().int().positive(),
});

const sessionConfigSchema = z.object({
    model: z.string().min(1),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    streaming: z.boolean(),
    agentMode: z.enum(["agent", "plan", "ask"]),
    permissionLevel: z.enum(["default", "bypass", "autopilot"]),
    workspaceRoot: z.string().min(1).optional(),
});

const sessionContextSchema = z.object({
    sessionCwd: z.string().min(1),
    workspaceRoot: z.string().min(1),
    gitRoot: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
});

const transportModeSchema = z.enum(["direct", "relay"]);
const notificationProviderSchema = z.enum(["expo"]);
const notificationPlatformSchema = z.enum(["ios", "android"]);
const notificationPresenceStateSchema = z.enum(["active", "inactive", "background"]);

let workspaceTreeNodeSchema: z.ZodType<import("./protocol").WorkspaceTreeNode>;
workspaceTreeNodeSchema = z.lazy(() => z.object({
    name: z.string().min(1),
    path: z.string(),
    type: z.enum(["file", "directory", "symlink"]),
    size: z.number().int().nonnegative().optional(),
    modifiedAt: z.number().nonnegative().optional(),
    nextOffset: z.number().int().nonnegative().optional(),
    totalChildren: z.number().int().nonnegative().optional(),
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

const gitBranchSummarySchema = z.object({
    name: z.string().min(1),
    current: z.boolean(),
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
const toolExecutionStatusSchema = z.enum(["running", "completed", "failed", "no_results"]);

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
        status: toolExecutionStatusSchema,
        argumentsText: z.string().optional(),
        progressMessage: z.string().optional(),
        partialOutput: z.string().optional(),
        errorMessage: z.string().optional(),
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
    busy: z.boolean().optional(),
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

const workspaceBranchSwitchResultPayloadSchema = z.object({
    sessionId: z.string().min(1),
    context: sessionContextSchema,
    branchName: z.string().min(1),
    success: z.boolean(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().optional(),
    signal: z.string().nullable().optional(),
    message: z.string().optional(),
});

// --- Server → Client Message Schemas ---

const authAuthenticatedSchema = baseBridgeMessageSchema.extend({
    type: z.literal("auth.authenticated"),
    payload: z.object({
        authMethod: z.enum(["pair", "resume"]),
        deviceId: z.string().min(1),
        deviceCredential: z.string().min(1),
        sessionToken: z.string().min(1),
        sessionTokenExpiresAt: z.number().int().positive(),
        transportMode: transportModeSchema,
        certFingerprint: z.string().regex(CERT_FINGERPRINT_PATTERN).nullable(),
        relayAccessToken: z.string().min(1).optional(),
        replayedCount: z.number().int().nonnegative(),
    }).superRefine((value, ctx) => {
        if (value.transportMode === "relay" && value.relayAccessToken === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["relayAccessToken"],
                message: "relayAccessToken is required for relay auth payloads",
            });
        }

        if (value.transportMode === "direct" && value.relayAccessToken !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["relayAccessToken"],
                message: "relayAccessToken is not allowed for direct auth payloads",
            });
        }
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
        completionStatus: z.enum(["completed", "failed", "no_results"]).optional(),
        errorMessage: z.string().optional(),
        exitCode: z.number().int().optional(),
        toolTelemetry: z.record(z.unknown()).optional(),
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

const authSessionTokenSchema = baseBridgeMessageSchema.extend({
    type: z.literal("auth.session_token"),
    payload: z.object({
        sessionToken: z.string().min(1),
        sessionTokenExpiresAt: z.number().int().positive(),
    }),
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

const sessionUsageSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.usage"),
    payload: z.object({
        sessionId: z.string().min(1),
        tokenLimit: z.number().int().nonnegative(),
        currentTokens: z.number().int().nonnegative(),
        systemTokens: z.number().int().nonnegative().optional(),
        conversationTokens: z.number().int().nonnegative().optional(),
        toolDefinitionsTokens: z.number().int().nonnegative().optional(),
        messagesLength: z.number().int().nonnegative().optional(),
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
        workspaceRoot: z.string().min(1),
        requestedWorkspaceRelativePath: z.string(),
        offset: z.number().int().nonnegative(),
        tree: workspaceTreeNodeSchema,
        truncated: z.boolean(),
    }),
});

const workspaceGitSummarySchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.git.summary"),
    payload: z.object({
        sessionId: z.string().min(1),
        context: sessionContextSchema,
        workspaceRoot: z.string().min(1),
        gitRoot: z.string().min(1).nullable(),
        repository: z.string().optional(),
        branch: z.string().optional(),
        branches: z.array(gitBranchSummarySchema).readonly(),
        uncommittedChanges: z.array(gitFileChangeSchema),
        recentCommits: z.array(gitCommitSummarySchema),
        truncated: z.boolean(),
    }),
});

const workspaceBranchSwitchResultSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.branch.switch.result"),
    payload: workspaceBranchSwitchResultPayloadSchema,
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
        workspaceRelativePath: z.string().min(1),
        content: z.string(),
        mimeType: z.string(),
        truncated: z.boolean(),
        error: z.string().optional(),
    }),
});

const workspaceResolveResponseSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.resolve.response"),
    payload: z.object({
        sessionId: z.string().min(1),
        rawPath: z.string().min(1),
        resolvedWorkspaceRelativePath: z.string().min(1).optional(),
        matches: z.array(z.string().min(1)).readonly().optional(),
        error: z.string().optional(),
    }),
});

const workspaceDiffResponseSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.diff.response"),
    payload: z.object({
        sessionId: z.string().min(1),
        workspaceRelativePath: z.string().min(1),
        diff: z.string(),
        error: z.string().optional(),
    }),
});

const workspaceSearchResponseSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.search.response"),
    payload: z.object({
        requestKey: z.string().min(1),
        query: z.string(),
        matches: z.array(
            z.object({
                path: z.string().min(1),
                displayPath: z.string().min(1),
                name: z.string().min(1),
            })
        ).readonly(),
        error: z.string().optional(),
    }),
});

const skillsListResponseSchema = baseBridgeMessageSchema.extend({
    type: z.literal("skills.list.response"),
    payload: z.object({
        skills: z.array(
            z.object({ name: z.string().min(1), description: z.string() })
        ).readonly(),
    }),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
    authAuthenticatedSchema,
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
    authSessionTokenSchema,
    capabilitiesStateSchema,
    sessionStateSchema,
    sessionErrorSchema,
    sessionTitleChangedSchema,
    assistantIntentSchema,
    sessionUsageSchema,
    planExitRequestSchema,
    workspaceTreeSchema,
    workspaceGitSummarySchema,
    workspaceBranchSwitchResultSchema,
    workspacePullResultSchema,
    workspacePushResultSchema,
    workspaceResolveResponseSchema,
    workspaceFileResponseSchema,
    workspaceDiffResponseSchema,
    workspaceSearchResponseSchema,
    skillsListResponseSchema,
]);

// --- Client → Server Message Schemas ---

const authPairSchema = baseBridgeMessageSchema.extend({
    type: z.literal("auth.pair"),
    payload: z.object({
        pairingToken: z.string().min(1),
        transportMode: transportModeSchema,
    }),
});

const authResumeSchema = baseBridgeMessageSchema.extend({
    type: z.literal("auth.resume"),
    payload: z.object({
        deviceCredential: z.string().min(1),
        sessionToken: z.string().min(1).optional(),
        lastSeenSeq: z.number().int().nonnegative(),
        transportMode: transportModeSchema,
    }),
});

const sessionCreateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("session.create"),
    payload: z.object({
        config: sessionConfigSchema,
        initialMessage: z.object({
            prompt: z.string().min(1),
            attachments: z.array(sessionMessageAttachmentSchema).optional(),
        }).optional(),
    }),
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

const capabilitiesRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("capabilities.request"),
    payload: z.object({}).strict(),
});

const notificationDeviceRegisterSchema = baseBridgeMessageSchema.extend({
    type: z.literal("notification.device.register"),
    payload: z.object({
        provider: notificationProviderSchema,
        pushToken: z.string().min(1),
        platform: notificationPlatformSchema,
        appVersion: z.string().min(1).optional(),
    }),
});

const notificationDeviceUnregisterSchema = baseBridgeMessageSchema.extend({
    type: z.literal("notification.device.unregister"),
    payload: z.object({}).strict(),
});

const notificationPresenceUpdateSchema = baseBridgeMessageSchema.extend({
    type: z.literal("notification.presence.update"),
    payload: z.object({
        state: notificationPresenceStateSchema,
        timestamp: z.number().int().nonnegative(),
    }),
});

const workspaceTreeRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.tree.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        workspaceRelativePath: z.string().optional(),
        maxDepth: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        pageSize: z.number().int().positive().optional(),
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

const workspaceBranchSwitchSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.branch.switch"),
    payload: z.object({
        sessionId: z.string().min(1),
        branchName: z.string().min(1),
    }),
});

const workspaceFileRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.file.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        workspaceRelativePath: z.string().min(1),
        maxBytes: z.number().int().positive().optional(),
    }),
});

const workspaceResolveRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.resolve.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        rawPath: z.string().min(1),
    }),
});

const workspaceDiffRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.diff.request"),
    payload: z.object({
        sessionId: z.string().min(1),
        workspaceRelativePath: z.string().min(1),
    }),
});

const workspaceSearchRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("workspace.search.request"),
    payload: z.object({
        requestKey: z.string().min(1),
        query: z.string(),
        limit: z.number().int().positive().optional(),
    }),
});

const skillsListRequestSchema = baseBridgeMessageSchema.extend({
    type: z.literal("skills.list.request"),
    payload: z.object({}).strict(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
    authPairSchema,
    authResumeSchema,
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
    capabilitiesRequestSchema,
    notificationDeviceRegisterSchema,
    notificationDeviceUnregisterSchema,
    notificationPresenceUpdateSchema,
    workspaceSearchRequestSchema,
    workspaceTreeRequestSchema,
    workspaceGitSummaryRequestSchema,
    workspacePullSchema,
    workspacePushSchema,
    workspaceBranchSwitchSchema,
    workspaceResolveRequestSchema,
    workspaceFileRequestSchema,
    workspaceDiffRequestSchema,
    skillsListRequestSchema,
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
    transportMode: transportModeSchema,
    companionId: z.string().min(1).optional(),
    relayAccessToken: z.string().min(1).optional(),
    version: z.number().int().positive(),
}).superRefine((value, context) => {
    if (value.transportMode === "relay" && value.relayAccessToken === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["relayAccessToken"],
            message: "Relay QR payloads must include a relay access token",
        });
    }

    if (value.transportMode === "direct" && value.relayAccessToken !== undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["relayAccessToken"],
            message: "Direct QR payloads must not include a relay access token",
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
    GitBranchSummary,
    WorkspaceOperationResultPayload,
    WorkspaceBranchSwitchResultPayload,
} from "./protocol.js";

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

type _AssertGitBranchSummary = z.infer<typeof gitBranchSummarySchema> extends GitBranchSummary ? true : never;
type _AssertGitBranchSummaryReverse = GitBranchSummary extends z.infer<typeof gitBranchSummarySchema> ? true : never;
const _checkGitBranchSummary: _AssertGitBranchSummary & _AssertGitBranchSummaryReverse = true;
void _checkGitBranchSummary;

type _AssertWorkspaceOperationResult =
    z.infer<typeof workspaceOperationResultPayloadSchema> extends WorkspaceOperationResultPayload ? true : never;
type _AssertWorkspaceOperationResultReverse =
    WorkspaceOperationResultPayload extends z.infer<typeof workspaceOperationResultPayloadSchema> ? true : never;
const _checkWorkspaceOperationResult: _AssertWorkspaceOperationResult & _AssertWorkspaceOperationResultReverse = true;
void _checkWorkspaceOperationResult;

type _AssertWorkspaceBranchSwitchResult =
    z.infer<typeof workspaceBranchSwitchResultPayloadSchema> extends WorkspaceBranchSwitchResultPayload ? true : never;
type _AssertWorkspaceBranchSwitchResultReverse =
    WorkspaceBranchSwitchResultPayload extends z.infer<typeof workspaceBranchSwitchResultPayloadSchema> ? true : never;
const _checkWorkspaceBranchSwitchResult:
    _AssertWorkspaceBranchSwitchResult & _AssertWorkspaceBranchSwitchResultReverse = true;
void _checkWorkspaceBranchSwitchResult;

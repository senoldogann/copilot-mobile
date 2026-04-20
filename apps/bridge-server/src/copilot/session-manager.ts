// Session Manager — manages Copilot sessions and converts them to WS messages

import type {
    AdaptedCopilotClient,
    AdaptedCopilotSession,
    AdaptedPermissionRequest,
    AdaptedToolStartDetails,
    SessionConfig,
    ServerMessage,
    HostSessionCapabilities,
    CapabilitiesStatePayload,
    SessionMessageAttachment,
} from "@copilot-mobile/shared";
import { MAX_SESSIONS, PERMISSION_TIMEOUT_MS, SDKError } from "@copilot-mobile/shared";
import { generateMessageId, nextSeq, nowMs } from "../utils/message.js";

type SendFn = (message: ServerMessage) => void;
type PendingPermission = {
    resolve: (approved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
};

export function createSessionManager(
    copilotClient: AdaptedCopilotClient,
    send: SendFn
) {
    const activeSessions = new Map<string, AdaptedCopilotSession>();
    const pendingPermissions = new Map<string, PendingPermission>();
    const pendingInputs = new Map<string, { resolve: (value: string) => void; timer: ReturnType<typeof setTimeout> }>();
    let autoApproveReads = false;
    // Latest observed host session capabilities — merged per session.
    // Currently holds the value for the single active session model.
    let lastHostCapabilities: HostSessionCapabilities = { elicitation: false };

    function makeBase() {
        return { id: generateMessageId(), timestamp: nowMs(), seq: nextSeq() };
    }

    function buildCapabilitiesPayload(): CapabilitiesStatePayload {
        return {
            host: { ...lastHostCapabilities },
            bridge: {
                autoApproveReads,
                readApprovalsConfigurable: true,
            },
        };
    }

    function emitCapabilitiesState(): void {
        send({
            ...makeBase(),
            type: "capabilities.state",
            payload: buildCapabilitiesPayload(),
        });
    }

    function wireSessionEvents(session: AdaptedCopilotSession): void {
        const sessionId = session.id;
        const toolNamesByRequestId = new Map<string, string>();

        session.onMessage((content: string) => {
            send({
                ...makeBase(),
                type: "assistant.message",
                payload: { sessionId, content },
            });
        });

        session.onDelta((delta: string, index: number) => {
            send({
                ...makeBase(),
                type: "assistant.message_delta",
                payload: { sessionId, delta, index },
            });
        });

        session.onReasoning((content: string) => {
            send({
                ...makeBase(),
                type: "assistant.reasoning",
                payload: { sessionId, content },
            });
        });

        session.onReasoningDelta((delta: string, index: number) => {
            send({
                ...makeBase(),
                type: "assistant.reasoning_delta",
                payload: { sessionId, delta, index },
            });
        });

        session.onToolStart((toolName: string, requestId: string, details: AdaptedToolStartDetails | undefined) => {
            const normalizedToolName = toolName.trim().length > 0 ? toolName : "tool";
            toolNamesByRequestId.set(requestId, normalizedToolName);

            send({
                ...makeBase(),
                type: "tool.execution_start",
                payload: {
                    sessionId,
                    toolName: normalizedToolName,
                    requestId,
                    ...(details?.arguments !== undefined ? { arguments: details.arguments } : {}),
                },
            });
        });

        session.onToolPartialResult((requestId: string, partialOutput: string) => {
            send({
                ...makeBase(),
                type: "tool.execution_partial_result",
                payload: { sessionId, requestId, partialOutput },
            });
        });

        session.onToolProgress((requestId: string, progressMessage: string) => {
            send({
                ...makeBase(),
                type: "tool.execution_progress",
                payload: { sessionId, requestId, progressMessage },
            });
        });

        session.onToolComplete((toolName: string, requestId: string, success: boolean) => {
            const normalizedToolName =
                toolNamesByRequestId.get(requestId)
                ?? (toolName.trim().length > 0 ? toolName : "tool");

            toolNamesByRequestId.delete(requestId);

            send({
                ...makeBase(),
                type: "tool.execution_complete",
                payload: { sessionId, toolName: normalizedToolName, requestId, success },
            });
        });

        session.onPermissionRequest(async (request: AdaptedPermissionRequest) => {
            const requestId = request.id;

            if (autoApproveReads && request.kind === "read") {
                return true;
            }

            send({
                ...makeBase(),
                type: "permission.request",
                payload: {
                    sessionId,
                    requestId,
                    kind: request.kind,
                    metadata: request.metadata,
                    ...(request.toolName !== undefined ? { toolName: request.toolName } : {}),
                    ...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
                    ...(request.commandText !== undefined ? { fullCommandText: request.commandText } : {}),
                },
            });

            // Wait for mobile response, with timeout
            return new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => {
                    pendingPermissions.delete(requestId);
                    send({
                        ...makeBase(),
                        type: "error",
                        payload: {
                            code: "PERMISSION_TIMEOUT",
                            message: `Permission request ${requestId} timed out`,
                            requestId,
                            retry: false,
                        },
                    });
                    resolve(false);
                }, PERMISSION_TIMEOUT_MS);

                pendingPermissions.set(requestId, { resolve, timer });
            });
        });

        session.onUserInputRequest(async (prompt: string) => {
            const requestId = generateMessageId();

            send({
                ...makeBase(),
                type: "user_input.request",
                payload: { sessionId, requestId, prompt },
            });

            return new Promise<string>((resolve) => {
                const timer = setTimeout(() => {
                    pendingInputs.delete(requestId);
                    send({
                        ...makeBase(),
                        type: "error",
                        payload: {
                            code: "INPUT_TIMEOUT",
                            message: `User input request ${requestId} timed out`,
                            requestId,
                            retry: false,
                        },
                    });
                    resolve("");
                }, PERMISSION_TIMEOUT_MS);

                pendingInputs.set(requestId, { resolve, timer });
            });
        });

        session.onIdle(() => {
            send({
                ...makeBase(),
                type: "session.idle",
                payload: { sessionId },
            });
        });

        session.onSessionError((errorType: string, message: string) => {
            send({
                ...makeBase(),
                type: "session.error",
                payload: { sessionId, errorType, message },
            });
        });

        session.onTitleChanged((title: string) => {
            send({
                ...makeBase(),
                type: "session.title_changed",
                payload: { sessionId, title },
            });
        });

        session.onIntent((intent: string) => {
            send({
                ...makeBase(),
                type: "assistant.intent",
                payload: { sessionId, intent },
            });
        });
    }

    return {
        async createSession(config: SessionConfig): Promise<void> {
            if (activeSessions.size >= MAX_SESSIONS) {
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "MAX_SESSIONS",
                        message: `Maximum ${MAX_SESSIONS} concurrent sessions allowed`,
                        retry: false,
                    },
                });
                return;
            }

            try {
                const session = await copilotClient.createSession(config);
                activeSessions.set(session.id, session);
                wireSessionEvents(session);

                lastHostCapabilities = session.getCapabilities();

                send({
                    ...makeBase(),
                    type: "session.created",
                    payload: { session: session.getInfo() },
                });

                emitCapabilitiesState();
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session creation failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        async resumeSession(sessionId: string): Promise<void> {
            try {
                const session = await copilotClient.resumeSession(sessionId);
                activeSessions.set(session.id, session);

                // Eski dinleyicileri temizle ve yeniden bağla — reconnect sonrası duplikasyonu engeller
                session.unsubscribeAll();
                wireSessionEvents(session);
                const history = await session.getHistory();

                lastHostCapabilities = session.getCapabilities();

                send({
                    ...makeBase(),
                    type: "session.resumed",
                    payload: { session: session.getInfo() },
                });

                send({
                    ...makeBase(),
                    type: "session.history",
                    payload: {
                        sessionId: session.id,
                        items: history,
                    },
                });

                emitCapabilitiesState();
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session resume failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        async listSessions(): Promise<void> {
            try {
                const sessions = await copilotClient.listSessions();
                send({
                    ...makeBase(),
                    type: "session.list",
                    payload: { sessions },
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session list failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        async deleteSession(sessionId: string): Promise<void> {
            const session = activeSessions.get(sessionId);
            if (session !== undefined) {
                session.close();
                activeSessions.delete(sessionId);
            }
            try {
                await copilotClient.deleteSession(sessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Session delete failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: false,
                    },
                });
            }
        },

        async sendMessage(
            sessionId: string,
            content: string,
            attachments?: ReadonlyArray<SessionMessageAttachment>
        ): Promise<void> {
            const session = activeSessions.get(sessionId);
            if (session === undefined) {
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SESSION_NOT_FOUND",
                        message: `Session ${sessionId} not found`,
                        retry: false,
                    },
                });
                return;
            }

            try {
                await session.send(
                    attachments !== undefined && attachments.length > 0
                        ? { prompt: content, attachments }
                        : { prompt: content }
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : "Message send failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        abortMessage(sessionId: string): void {
            const session = activeSessions.get(sessionId);
            if (session !== undefined) {
                session.abort();
            }
        },

        respondToPermission(requestId: string, approved: boolean): void {
            const pending = pendingPermissions.get(requestId);
            if (pending === undefined) return;

            clearTimeout(pending.timer);
            pendingPermissions.delete(requestId);
            pending.resolve(approved);
        },

        respondToUserInput(requestId: string, value: string): void {
            const pending = pendingInputs.get(requestId);
            if (pending === undefined) return;

            clearTimeout(pending.timer);
            pendingInputs.delete(requestId);
            pending.resolve(value);
        },

        async listModels(): Promise<void> {
            try {
                const models = await copilotClient.listModels();
                send({
                    ...makeBase(),
                    type: "models.list",
                    payload: { models },
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Model list failed";
                send({
                    ...makeBase(),
                    type: "error",
                    payload: {
                        code: "SDK_ERROR",
                        message,
                        retry: true,
                    },
                });
            }
        },

        updateSettings(nextSettings: { autoApproveReads: boolean }): void {
            autoApproveReads = nextSettings.autoApproveReads;
            emitCapabilitiesState();
        },

        emitCapabilitiesState(): void {
            emitCapabilitiesState();
        },

        cleanupOnDisconnect(): void {
            // Clear pending permission requests — deny all
            for (const [id, pending] of pendingPermissions) {
                clearTimeout(pending.timer);
                pending.resolve(false);
            }
            pendingPermissions.clear();
            for (const [, pending] of pendingInputs) {
                clearTimeout(pending.timer);
                pending.resolve("");
            }
            pendingInputs.clear();
        },

        async shutdown(): Promise<void> {
            this.cleanupOnDisconnect();
            for (const [, session] of activeSessions) {
                session.close();
            }
            activeSessions.clear();
            await copilotClient.shutdown();
        },
    };
}

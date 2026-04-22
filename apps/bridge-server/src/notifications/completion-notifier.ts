import type { createDeviceRegistry } from "./device-registry.js";
import type { createPushProvider } from "./push-provider.js";

type DeviceRegistry = ReturnType<typeof createDeviceRegistry>;
type PushProvider = ReturnType<typeof createPushProvider>;
type SessionPushEventType = "completion" | "permission_prompt" | "user_input_prompt";

type SessionCycleState = {
    deviceId: string | null;
    cycleId: number;
    pending: boolean;
    notifiedCycleId: number | null;
    latestPreview: string;
    latestError: string | null;
    title: string | null;
};

type CompletedCycleSnapshot = {
    deviceId: string;
    cycleId: number;
    latestPreview: string;
    latestError: string | null;
    title: string | null;
};

const MAX_NOTIFIED_REQUEST_IDS = 200;

function sanitizeNotificationText(input: string): string {
    const singleLine = input.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 160) {
        return singleLine;
    }

    return `${singleLine.slice(0, 157)}...`;
}

function createInitialCycleState(): SessionCycleState {
    return {
        deviceId: null,
        cycleId: 0,
        pending: false,
        notifiedCycleId: null,
        latestPreview: "",
        latestError: null,
        title: null,
    };
}

function isPushEligible(deviceRegistry: DeviceRegistry, deviceId: string): boolean {
    return !deviceRegistry.isConnected(deviceId);
}

function buildNotificationPayload(state: CompletedCycleSnapshot, sessionId: string): {
    sessionId: string;
    title: string;
    body: string;
} {
    const title = state.title?.trim().length
        ? state.title.trim()
        : state.latestError !== null
            ? "Copilot run failed"
            : "Copilot finished working";
    const bodySource = state.latestError ?? state.latestPreview;
    const body = bodySource.trim().length > 0
        ? sanitizeNotificationText(bodySource)
        : "Open Copilot Mobile to review the latest session output.";

    return {
        sessionId,
        title,
        body,
    };
}

export function createCompletionNotifier(deps: {
    deviceRegistry: DeviceRegistry;
    pushProvider: PushProvider;
}) {
    const sessionStates = new Map<string, SessionCycleState>();
    const notifiedRequestIds = new Set<string>();

    function getSessionState(sessionId: string): SessionCycleState {
        const existing = sessionStates.get(sessionId);
        if (existing !== undefined) {
            return existing;
        }

        const nextState = createInitialCycleState();
        sessionStates.set(sessionId, nextState);
        return nextState;
    }

    async function notifyForCompletedCycle(sessionId: string, snapshot: CompletedCycleSnapshot): Promise<void> {
        const latestState = sessionStates.get(sessionId);
        if (latestState === undefined || latestState.notifiedCycleId === snapshot.cycleId) {
            return;
        }

        if (!isPushEligible(deps.deviceRegistry, snapshot.deviceId)) {
            return;
        }

        const registration = deps.deviceRegistry.getPushTarget(snapshot.deviceId);
        if (registration === null) {
            return;
        }

        void notifyForBackgroundSync({
            deviceId: snapshot.deviceId,
            pushToken: registration.pushToken,
            sessionId,
            eventType: "completion",
        });

        const result = await deps.pushProvider.sendCompletionPush({
            pushToken: registration.pushToken,
            ...buildNotificationPayload(snapshot, sessionId),
        });

        if (result.ok) {
            const currentState = sessionStates.get(sessionId);
            if (currentState !== undefined && currentState.cycleId === snapshot.cycleId) {
                currentState.notifiedCycleId = snapshot.cycleId;
            }
            return;
        }

        console.warn("[notifications] Failed to send completion push", {
            sessionId,
            deviceId: snapshot.deviceId,
            error: result.error,
            details: result.details,
            retryable: result.retryable,
            invalidToken: result.invalidToken,
        });

        if (result.invalidToken) {
            deps.deviceRegistry.unregisterPushTarget(snapshot.deviceId);
        }
    }

    function rememberRequestNotification(requestId: string): void {
        notifiedRequestIds.add(requestId);
        if (notifiedRequestIds.size <= MAX_NOTIFIED_REQUEST_IDS) {
            return;
        }

        const oldestRequestId = notifiedRequestIds.values().next().value;
        if (typeof oldestRequestId === "string") {
            notifiedRequestIds.delete(oldestRequestId);
        }
    }

    async function notifyForPrompt(input: {
        sessionId: string;
        requestId: string;
        title: string;
        body: string;
        eventType: SessionPushEventType;
    }): Promise<void> {
        if (notifiedRequestIds.has(input.requestId)) {
            return;
        }

        const sessionState = sessionStates.get(input.sessionId);
        if (sessionState === undefined || sessionState.deviceId === null) {
            return;
        }

        if (!isPushEligible(deps.deviceRegistry, sessionState.deviceId)) {
            return;
        }

        const registration = deps.deviceRegistry.getPushTarget(sessionState.deviceId);
        if (registration === null) {
            return;
        }

        void notifyForBackgroundSync({
            deviceId: sessionState.deviceId,
            pushToken: registration.pushToken,
            sessionId: input.sessionId,
            eventType: input.eventType,
        });

        const result = await deps.pushProvider.sendSessionPush({
            pushToken: registration.pushToken,
            sessionId: input.sessionId,
            title: input.title,
            body: sanitizeNotificationText(input.body),
        });

        if (result.ok) {
            rememberRequestNotification(input.requestId);
            return;
        }

        console.warn("[notifications] Failed to send prompt push", {
            sessionId: input.sessionId,
            requestId: input.requestId,
            error: result.error,
            details: result.details,
            retryable: result.retryable,
            invalidToken: result.invalidToken,
        });

        if (result.invalidToken) {
            deps.deviceRegistry.unregisterPushTarget(sessionState.deviceId);
        }
    }

    async function notifyForBackgroundSync(input: {
        deviceId: string;
        pushToken: string;
        sessionId: string;
        eventType: SessionPushEventType;
    }): Promise<void> {
        const result = await deps.pushProvider.sendBackgroundSyncPush({
            pushToken: input.pushToken,
            sessionId: input.sessionId,
            eventType: input.eventType,
        });

        if (result.ok) {
            return;
        }

        console.warn("[notifications] Failed to send background sync push", {
            sessionId: input.sessionId,
            deviceId: input.deviceId,
            eventType: input.eventType,
            error: result.error,
            details: result.details,
            retryable: result.retryable,
            invalidToken: result.invalidToken,
        });

        if (result.invalidToken) {
            deps.deviceRegistry.unregisterPushTarget(input.deviceId);
        }
    }

    return {
        bindSessionToDevice(sessionId: string, deviceId: string): void {
            const state = getSessionState(sessionId);
            state.deviceId = deviceId;
        },

        updateSessionTitle(sessionId: string, title: string): void {
            const state = getSessionState(sessionId);
            state.title = title;
        },

        replaceAssistantPreview(sessionId: string, content: string): void {
            const trimmed = content.trim();
            if (trimmed.length === 0) {
                return;
            }

            const state = getSessionState(sessionId);
            state.latestPreview = trimmed;
        },

        appendAssistantPreview(sessionId: string, delta: string): void {
            if (delta.length === 0) {
                return;
            }

            const state = getSessionState(sessionId);
            const nextPreview = `${state.latestPreview}${delta}`.trim();
            if (nextPreview.length === 0) {
                return;
            }

            state.latestPreview = nextPreview;
        },

        recordSessionError(sessionId: string, errorType: string, message: string): void {
            const state = getSessionState(sessionId);
            state.latestError = `[${errorType}] ${message}`;
        },

        notifyPermissionPrompt(sessionId: string, requestId: string, summary: string): void {
            const state = getSessionState(sessionId);
            const title = state.title?.trim().length ? state.title.trim() : "Copilot needs approval";
            void notifyForPrompt({
                sessionId,
                requestId,
                title,
                body: `Approval needed: ${summary}`,
                eventType: "permission_prompt",
            });
        },

        notifyUserInputPrompt(sessionId: string, requestId: string, prompt: string): void {
            const state = getSessionState(sessionId);
            const title = state.title?.trim().length ? state.title.trim() : "Copilot needs input";
            void notifyForPrompt({
                sessionId,
                requestId,
                title,
                body: `Input needed: ${prompt}`,
                eventType: "user_input_prompt",
            });
        },

        onBusyStateChanged(sessionId: string, busy: boolean): void {
            const state = getSessionState(sessionId);

            if (busy) {
                state.cycleId += 1;
                state.pending = true;
                state.latestPreview = "";
                state.latestError = null;
                return;
            }

            if (!state.pending) {
                return;
            }

            state.pending = false;
            if (state.deviceId === null) {
                return;
            }

            const snapshot: CompletedCycleSnapshot = {
                deviceId: state.deviceId,
                cycleId: state.cycleId,
                latestPreview: state.latestPreview,
                latestError: state.latestError,
                title: state.title,
            };
            void notifyForCompletedCycle(sessionId, snapshot);
        },

        forgetSession(sessionId: string): void {
            sessionStates.delete(sessionId);
        },
    };
}

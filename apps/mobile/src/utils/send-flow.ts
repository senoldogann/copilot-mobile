import type { SendMode } from "../components/chat-input-types";

export type SendFlowDecision =
    | { kind: "queue"; priority: "back" }
    | { kind: "preempt"; priority: "front"; shouldAbort: boolean }
    | { kind: "send_now" };

export function resolveSendFlowDecision(params: {
    mode: SendMode;
    hasActiveSession: boolean;
    hasBlockingTurn: boolean;
    isAbortPending: boolean;
}): SendFlowDecision {
    if (params.mode === "queue") {
        return { kind: "queue", priority: "back" };
    }

    if (!params.hasActiveSession || !params.hasBlockingTurn) {
        return { kind: "send_now" };
    }

    return {
        kind: "preempt",
        priority: "front",
        shouldAbort: !params.isAbortPending,
    };
}

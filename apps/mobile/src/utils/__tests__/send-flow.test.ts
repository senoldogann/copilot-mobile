import { resolveSendFlowDecision } from "../send-flow";

describe("resolveSendFlowDecision", () => {
    it("keeps explicit queue sends at the back of the queue", () => {
        expect(resolveSendFlowDecision({
            mode: "queue",
            hasActiveSession: true,
            hasBlockingTurn: true,
            isAbortPending: false,
        })).toEqual({
            kind: "queue",
            priority: "back",
        });
    });

    it("preempts blocking turns for direct sends", () => {
        expect(resolveSendFlowDecision({
            mode: "send",
            hasActiveSession: true,
            hasBlockingTurn: true,
            isAbortPending: false,
        })).toEqual({
            kind: "preempt",
            priority: "front",
            shouldAbort: true,
        });
    });

    it("preempts blocking turns for steer sends", () => {
        expect(resolveSendFlowDecision({
            mode: "steer",
            hasActiveSession: true,
            hasBlockingTurn: true,
            isAbortPending: false,
        })).toEqual({
            kind: "preempt",
            priority: "front",
            shouldAbort: true,
        });
    });

    it("does not request a duplicate abort while one is already pending", () => {
        expect(resolveSendFlowDecision({
            mode: "steer",
            hasActiveSession: true,
            hasBlockingTurn: true,
            isAbortPending: true,
        })).toEqual({
            kind: "preempt",
            priority: "front",
            shouldAbort: false,
        });
    });

    it("sends immediately when there is no blocking turn", () => {
        expect(resolveSendFlowDecision({
            mode: "send",
            hasActiveSession: true,
            hasBlockingTurn: false,
            isAbortPending: false,
        })).toEqual({
            kind: "send_now",
        });
    });
});

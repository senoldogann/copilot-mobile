jest.mock("expo-constants", () => ({
    __esModule: true,
    default: {
        appOwnership: "standalone",
        executionEnvironment: "bare",
        expoConfig: {},
        easConfig: {},
    },
}));

jest.mock("../../stores/connection-store", () => ({
    useConnectionStore: {
        getState: () => ({
            setError: jest.fn(),
        }),
    },
}));

describe("notifications", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it("selects only session-complete notifications for dismissal", () => {
        const { getPresentedCompletionNotificationIds } = require("../notifications") as typeof import("../notifications");

        const completionNotificationIds = getPresentedCompletionNotificationIds([
            {
                request: {
                    identifier: "complete-1",
                    content: { data: { kind: "session-complete" } },
                },
            },
            {
                request: {
                    identifier: "prompt-1",
                    content: { data: { kind: "session-event" } },
                },
            },
        ]);

        expect(completionNotificationIds).toEqual(["complete-1"]);
    });

    it("uses request-specific keys for prompt notification dedupe", () => {
        const { notificationTestUtils } = require("../notifications") as typeof import("../notifications");

        const firstKey = notificationTestUtils.createSessionNotificationEventKey(
            "session-1",
            "permission_prompt",
            "request-1"
        );
        const secondKey = notificationTestUtils.createSessionNotificationEventKey(
            "session-1",
            "permission_prompt",
            "request-2"
        );

        expect(firstKey).not.toBe(secondKey);
    });
});

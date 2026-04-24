import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
    checkOperationRateLimit,
    clearRateLimitState,
} from "../../src/utils/rate-limit.js";

afterEach(() => {
    clearRateLimitState();
});

describe("operation rate limit", () => {
    it("throttles repeated session creation bursts per device", () => {
        const deviceId = "device-session-create";

        for (let index = 0; index < 12; index += 1) {
            assert.equal(checkOperationRateLimit(deviceId, "session.create"), true);
        }

        assert.equal(checkOperationRateLimit(deviceId, "session.create"), false);
    });

    it("keeps workspace write throttling isolated per device", () => {
        for (let index = 0; index < 20; index += 1) {
            assert.equal(checkOperationRateLimit("device-a", "workspace-write"), true);
        }

        assert.equal(checkOperationRateLimit("device-a", "workspace-write"), false);
        assert.equal(checkOperationRateLimit("device-b", "workspace-write"), true);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SessionMetadata } from "@github/copilot-sdk";
import type { SessionInfo } from "@copilot-mobile/shared";
import { adaptSessionInfoFromMetadata, mergeResumedSessionInfoFromMetadata } from "../../src/copilot/client.js";

function createMetadata(
    overrides: Partial<SessionMetadata> = {}
): SessionMetadata {
    return {
        sessionId: "stored-session",
        startTime: new Date("2025-01-01T00:00:00.000Z"),
        modifiedTime: new Date("2025-01-01T00:10:00.000Z"),
        summary: "Stored summary",
        context: {
            cwd: process.cwd(),
            repository: "https://github.com/example/repo.git",
            branch: "main",
        },
        ...overrides,
    } as SessionMetadata;
}

describe("copilot client session metadata helpers", () => {
    it("adapts listed sessions to idle metadata snapshots", () => {
        const info = adaptSessionInfoFromMetadata(createMetadata());

        assert.equal(info.id, "stored-session");
        assert.equal(info.status, "idle");
        assert.equal(info.createdAt, Date.parse("2025-01-01T00:00:00.000Z"));
        assert.equal(info.lastActiveAt, Date.parse("2025-01-01T00:10:00.000Z"));
        assert.equal(info.summary, "Stored summary");
        assert.equal(info.context?.sessionCwd, process.cwd());
        assert.equal(info.context?.workspaceRoot, process.cwd());
        assert.equal(info.context?.repository, "example/repo");
        assert.equal(info.context?.branch, "main");
    });

    it("preserves live session status while merging resumed metadata", () => {
        const liveInfo: SessionInfo = {
            id: "live-session",
            model: "gpt-4.1",
            createdAt: 1,
            lastActiveAt: 2,
            status: "active",
            title: "Live title",
        };

        const merged = mergeResumedSessionInfoFromMetadata(liveInfo, createMetadata());

        assert.equal(merged, liveInfo);
        assert.equal(liveInfo.id, "live-session");
        assert.equal(liveInfo.model, "gpt-4.1");
        assert.equal(liveInfo.status, "active");
        assert.equal(liveInfo.createdAt, Date.parse("2025-01-01T00:00:00.000Z"));
        assert.equal(liveInfo.lastActiveAt, Date.parse("2025-01-01T00:10:00.000Z"));
        assert.equal(liveInfo.summary, "Stored summary");
        assert.equal(liveInfo.title, "Live title");
        assert.equal(liveInfo.context?.sessionCwd, process.cwd());
        assert.equal(liveInfo.context?.workspaceRoot, process.cwd());
    });
});

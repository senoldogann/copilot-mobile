import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GitFileChange } from "@copilot-mobile/shared";
import { mapWorkspaceGitChange } from "../../src/utils/workspace.js";

describe("workspace git mapping helpers", () => {
    it("omits originalPath when a rename crosses into the workspace from outside", () => {
        const workspaceRoot = "/repo/apps/mobile";
        const gitRoot = "/repo";
        const change: GitFileChange = {
            path: "apps/mobile/src/moved.ts",
            originalPath: "outside-source.ts",
            status: "renamed",
            indexStatus: "R",
            worktreeStatus: " ",
        };

        const mapped = mapWorkspaceGitChange(change, workspaceRoot, gitRoot, new Map());

        assert.deepEqual(mapped, {
            ...change,
            path: "src/moved.ts",
        });
    });
});

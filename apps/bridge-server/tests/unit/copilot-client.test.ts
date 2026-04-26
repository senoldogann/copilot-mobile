import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionMetadata } from "@github/copilot-sdk";
import type { SessionInfo } from "@copilot-mobile/shared";
import {
    adaptSessionInfoFromMetadata,
    buildSessionHooks,
    buildCopilotSdkTransportOptions,
    buildSdkCliLaunchOptions,
    mergeResumedSessionInfoFromMetadata,
    normalizeManagedCopilotCliPath,
    resolveCopilotClientLaunchOptions,
} from "../../src/copilot/client.js";

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

    it("wraps Windows cmd shims through the Node wrapper for SDK launch", () => {
        const launch = buildSdkCliLaunchOptions("C:/Users/test/AppData/Roaming/npm/copilot.cmd", {
            wrapperPath: "/wrapper/copilot-cli-wrapper.mjs",
            platform: "win32",
        });

        assert.equal(launch.cliPath, process.execPath);
        assert.deepEqual(launch.cliArgs, [
            "/wrapper/copilot-cli-wrapper.mjs",
            "C:/Users/test/AppData/Roaming/npm/copilot.cmd",
        ]);
        assert.equal(launch.displayPath, "C:/Users/test/AppData/Roaming/npm/copilot.cmd");
    });

    it("wraps Windows JavaScript runtimes through the Node wrapper for SDK launch", () => {
        const launch = buildSdkCliLaunchOptions("C:/Users/test/AppData/Local/copilot/index.js", {
            wrapperPath: "/wrapper/copilot-cli-wrapper.mjs",
            platform: "win32",
        });

        assert.equal(launch.cliPath, process.execPath);
        assert.deepEqual(launch.cliArgs, [
            "/wrapper/copilot-cli-wrapper.mjs",
            "C:/Users/test/AppData/Local/copilot/index.js",
        ]);
        assert.equal(launch.displayPath, "C:/Users/test/AppData/Local/copilot/index.js");
    });

    it("keeps native executables unchanged for SDK launch", () => {
        const launch = buildSdkCliLaunchOptions("/usr/local/bin/copilot", {
            wrapperPath: "/wrapper/copilot-cli-wrapper.mjs",
            platform: "linux",
        });

        assert.equal(launch.cliPath, "/usr/local/bin/copilot");
        assert.equal(launch.cliArgs, undefined);
        assert.equal(launch.displayPath, "/usr/local/bin/copilot");
    });

    it("normalizes npm-loader runtimes to the direct index entrypoint", () => {
        const tempDir = mkdtempSync(path.join(tmpdir(), "copilot-cli-path-"));
        try {
            const loaderPath = path.join(tempDir, "npm-loader.js");
            const indexPath = path.join(tempDir, "index.js");
            writeFileSync(loaderPath, "");
            writeFileSync(indexPath, "");

            const normalized = normalizeManagedCopilotCliPath(loaderPath);
            assert.equal(normalized, indexPath);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("resolves explicit Windows launch options with the wrapper-aware JavaScript runtime", () => {
        const tempDir = mkdtempSync(path.join(tmpdir(), "copilot-cli-explicit-"));
        const previousCliPath = process.env.COPILOT_CLI_PATH;
        const previousWrapperPath = process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH;

        try {
            const cliPath = path.join(tempDir, "index.js");
            const wrapperPath = path.join(tempDir, "copilot-cli-wrapper.mjs");
            writeFileSync(cliPath, "");
            writeFileSync(wrapperPath, "");
            process.env.COPILOT_CLI_PATH = cliPath;
            process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH = wrapperPath;

            const launch = resolveCopilotClientLaunchOptions({ platform: "win32" });
            assert.ok(launch);
            assert.equal(launch.source, "configured");
            assert.equal(launch.cliPath, process.execPath);
            assert.deepEqual(launch.cliArgs, [wrapperPath, cliPath]);
            assert.equal(launch.displayPath, cliPath);
        } finally {
            if (previousCliPath === undefined) {
                delete process.env.COPILOT_CLI_PATH;
            } else {
                process.env.COPILOT_CLI_PATH = previousCliPath;
            }

            if (previousWrapperPath === undefined) {
                delete process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH;
            } else {
                process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH = previousWrapperPath;
            }
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("does not fall back to a bundled Copilot runtime when no system CLI is available", () => {
        const previousCliPath = process.env.COPILOT_CLI_PATH;
        const previousWrapperPath = process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH;
        const previousPath = process.env.PATH;

        try {
            delete process.env.COPILOT_CLI_PATH;
            delete process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH;
            process.env.PATH = "";

            const launch = resolveCopilotClientLaunchOptions({ platform: "darwin" });
            assert.equal(launch, undefined);
        } finally {
            if (previousCliPath === undefined) {
                delete process.env.COPILOT_CLI_PATH;
            } else {
                process.env.COPILOT_CLI_PATH = previousCliPath;
            }

            if (previousWrapperPath === undefined) {
                delete process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH;
            } else {
                process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH = previousWrapperPath;
            }

            if (previousPath === undefined) {
                delete process.env.PATH;
            } else {
                process.env.PATH = previousPath;
            }
        }
    });

    it("uses TCP transport for SDK sessions on Windows", () => {
        assert.deepEqual(buildCopilotSdkTransportOptions({ platform: "win32" }), {
            useStdio: false,
        });
    });

    it("keeps default SDK transport on non-Windows platforms", () => {
        assert.deepEqual(buildCopilotSdkTransportOptions({ platform: "darwin" }), {});
    });

    it("pre-approves tool use in bypass and autopilot modes through SDK hooks", async () => {
        for (const permissionLevel of ["bypass", "autopilot"] as const) {
            const hooks = buildSessionHooks({ agentMode: "agent", permissionLevel });
            const result = await hooks.onPreToolUse?.(
                {
                    timestamp: 0,
                    cwd: process.cwd(),
                    toolName: "bash",
                    toolArgs: { command: "echo ok" },
                },
                { sessionId: "session-1" }
            );

            assert.deepEqual(result, { permissionDecision: "allow" });
        }
    });

    it("keeps ask mode read-only even when permissions are otherwise elevated", async () => {
        const hooks = buildSessionHooks({ agentMode: "ask", permissionLevel: "autopilot" });
        const result = await hooks.onPreToolUse?.(
            {
                timestamp: 0,
                cwd: process.cwd(),
                toolName: "bash",
                toolArgs: { command: "echo blocked" },
            },
            { sessionId: "session-1" }
        );

        assert.deepEqual(result, {
            permissionDecision: "deny",
            permissionDecisionReason: "Ask agent is limited to read-only analysis.",
        });
    });
});

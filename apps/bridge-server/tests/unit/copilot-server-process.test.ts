import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    buildManagedCopilotServerSpawnSpec,
    shouldUseManagedCopilotServer,
} from "../../src/copilot/server-process.js";

describe("managed Copilot server spawn helpers", () => {
    it("enables the managed server path on Windows only", () => {
        assert.equal(shouldUseManagedCopilotServer("win32"), true);
        assert.equal(shouldUseManagedCopilotServer("darwin"), false);
    });

    it("builds a wrapper-based Windows server launch spec with hidden terminal settings", () => {
        const tempDir = mkdtempSync(path.join(tmpdir(), "copilot-server-spawn-"));
        const previousCliPath = process.env.COPILOT_CLI_PATH;
        const previousWrapperPath = process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH;
        const previousDisableTerminalTitle = process.env.COPILOT_DISABLE_TERMINAL_TITLE;
        const previousNodeDebug = process.env.NODE_DEBUG;

        try {
            const cliPath = path.join(tempDir, "index.js");
            const wrapperPath = path.join(tempDir, "copilot-cli-wrapper.mjs");
            writeFileSync(cliPath, "");
            writeFileSync(wrapperPath, "");
            process.env.COPILOT_CLI_PATH = cliPath;
            process.env.CODE_COMPANION_COPILOT_WRAPPER_PATH = wrapperPath;
            process.env.NODE_DEBUG = "child_process";
            delete process.env.COPILOT_DISABLE_TERMINAL_TITLE;

            const spec = buildManagedCopilotServerSpawnSpec({
                platform: "win32",
                cwd: "C:/workspace/project",
            });

            assert.equal(spec.command, process.execPath);
            assert.deepEqual(spec.args, [
                wrapperPath,
                cliPath,
                "--headless",
                "--no-auto-update",
                "--log-level",
                "debug",
                "--port",
                "0",
            ]);
            assert.equal(spec.cwd, "C:/workspace/project");
            assert.equal(spec.displayPath, cliPath);
            assert.equal(spec.env.COPILOT_DISABLE_TERMINAL_TITLE, "1");
            assert.equal("NODE_DEBUG" in spec.env, false);
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

            if (previousDisableTerminalTitle === undefined) {
                delete process.env.COPILOT_DISABLE_TERMINAL_TITLE;
            } else {
                process.env.COPILOT_DISABLE_TERMINAL_TITLE = previousDisableTerminalTitle;
            }

            if (previousNodeDebug === undefined) {
                delete process.env.NODE_DEBUG;
            } else {
                process.env.NODE_DEBUG = previousNodeDebug;
            }
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

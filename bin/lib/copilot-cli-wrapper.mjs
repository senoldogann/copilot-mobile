#!/usr/bin/env node

import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const [, , targetCommand, ...args] = process.argv;

if (typeof targetCommand !== "string" || targetCommand.length === 0) {
    console.error("Missing Copilot CLI command for wrapper.");
    process.exit(1);
}

const extension = path.extname(targetCommand).toLowerCase();
const useShell = process.platform === "win32" && (extension === ".cmd" || extension === ".bat");
const isJavaScriptEntrypoint = extension === ".js" || extension === ".mjs" || extension === ".cjs";

function withWindowsHide(options) {
    if (process.platform !== "win32") {
        return options;
    }

    return {
        ...(options ?? {}),
        windowsHide: options?.windowsHide ?? true,
    };
}

function patchChildProcessForWindows() {
    if (process.platform !== "win32") {
        return;
    }

    const require = createRequire(import.meta.url);
    const childProcess = require("node:child_process");

    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function patchedSpawn(command, maybeArgs, maybeOptions) {
        if (Array.isArray(maybeArgs)) {
            return originalSpawn.call(this, command, maybeArgs, withWindowsHide(maybeOptions));
        }

        if (maybeArgs !== undefined) {
            return originalSpawn.call(this, command, withWindowsHide(maybeArgs));
        }

        return originalSpawn.call(this, command, withWindowsHide(undefined));
    };

    const originalSpawnSync = childProcess.spawnSync;
    childProcess.spawnSync = function patchedSpawnSync(command, maybeArgs, maybeOptions) {
        if (Array.isArray(maybeArgs)) {
            return originalSpawnSync.call(this, command, maybeArgs, withWindowsHide(maybeOptions));
        }

        if (maybeArgs !== undefined) {
            return originalSpawnSync.call(this, command, withWindowsHide(maybeArgs));
        }

        return originalSpawnSync.call(this, command, withWindowsHide(undefined));
    };

    const originalExec = childProcess.exec;
    childProcess.exec = function patchedExec(command, maybeOptions, maybeCallback) {
        if (typeof maybeOptions === "function") {
            return originalExec.call(this, command, withWindowsHide(undefined), maybeOptions);
        }

        return originalExec.call(this, command, withWindowsHide(maybeOptions), maybeCallback);
    };

    const originalExecSync = childProcess.execSync;
    childProcess.execSync = function patchedExecSync(command, maybeOptions) {
        return originalExecSync.call(this, command, withWindowsHide(maybeOptions));
    };

    const originalExecFile = childProcess.execFile;
    childProcess.execFile = function patchedExecFile(file, maybeArgs, maybeOptions, maybeCallback) {
        if (Array.isArray(maybeArgs)) {
            if (typeof maybeOptions === "function") {
                return originalExecFile.call(this, file, maybeArgs, withWindowsHide(undefined), maybeOptions);
            }

            return originalExecFile.call(this, file, maybeArgs, withWindowsHide(maybeOptions), maybeCallback);
        }

        if (typeof maybeArgs === "function") {
            return originalExecFile.call(this, file, withWindowsHide(undefined), maybeArgs);
        }

        return originalExecFile.call(this, file, withWindowsHide(maybeArgs), maybeOptions);
    };

    const originalExecFileSync = childProcess.execFileSync;
    childProcess.execFileSync = function patchedExecFileSync(file, maybeArgs, maybeOptions) {
        if (Array.isArray(maybeArgs)) {
            return originalExecFileSync.call(this, file, maybeArgs, withWindowsHide(maybeOptions));
        }

        if (maybeArgs !== undefined) {
            return originalExecFileSync.call(this, file, withWindowsHide(maybeArgs));
        }

        return originalExecFileSync.call(this, file, withWindowsHide(undefined));
    };

    const originalFork = childProcess.fork;
    childProcess.fork = function patchedFork(modulePath, maybeArgs, maybeOptions) {
        if (Array.isArray(maybeArgs)) {
            return originalFork.call(this, modulePath, maybeArgs, withWindowsHide(maybeOptions));
        }

        if (maybeArgs !== undefined) {
            return originalFork.call(this, modulePath, withWindowsHide(maybeArgs));
        }

        return originalFork.call(this, modulePath, withWindowsHide(undefined));
    };

    syncBuiltinESMExports();
}

async function runJavaScriptEntrypoint() {
    patchChildProcessForWindows();
    if (process.platform === "win32" && process.env["COPILOT_DISABLE_TERMINAL_TITLE"] === undefined) {
        process.env["COPILOT_DISABLE_TERMINAL_TITLE"] = "1";
    }
    process.argv = [process.execPath, targetCommand, ...args];
    await import(pathToFileURL(path.resolve(targetCommand)).href);
}

if (isJavaScriptEntrypoint) {
    runJavaScriptEntrypoint().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
} else {
    const child = spawn(targetCommand, args, {
        stdio: "inherit",
        env: process.env,
        shell: useShell,
        windowsHide: true,
    });

    child.on("error", (error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });

    child.on("exit", (code, signal) => {
        if (signal !== null) {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 1);
    });
}

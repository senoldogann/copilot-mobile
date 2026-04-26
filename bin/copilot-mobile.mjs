#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { loadConfig, resolveWorkspaceRoot, writeConfig } from "./lib/config.mjs";
import {
    bootoutLaunchAgent,
    bootstrapLaunchAgent,
    writeLaunchAgentPlist,
} from "./lib/launch-agent.mjs";
import {
    getDesktopPlatformDescription,
    getDesktopServiceLabel,
    getSupportedDesktopPlatform,
    requireSupportedDesktopPlatform,
} from "./lib/runtime-platform.mjs";
import {
    getWindowsDaemonPidStatus,
    startWindowsDaemon,
    stopWindowsDaemon,
} from "./lib/windows-daemon.mjs";
import {
    ensureCompanionDirectories,
    getCompanionLogsDirectory,
    getCompanionConfigPath,
    getCopilotCliWrapperPath,
    getDaemonEntryPoint,
    getDaemonPidPath,
    getLaunchAgentPath,
    getPackageRootDirectory,
} from "./lib/paths.mjs";

const STATUS_PATH = "/__copilot_mobile/status";
const HEALTH_PATH = "/health";
const QR_PATH = "/__copilot_mobile/qr";
const DASHBOARD_PATH = "/__copilot_mobile/dashboard";
const NODEJS_MAJOR_REQUIREMENT = 20;

function printUsage() {
    console.log("Usage: code-companion <login|up|status|doctor|qr|logs|dashboard|down> [--json]");
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function readRecentDaemonStderrLines(limit = 20) {
    const logPath = `${getCompanionLogsDirectory()}/daemon.stderr.log`;
    if (!existsSync(logPath)) {
        return null;
    }

    try {
        const lines = readFileSync(logPath, "utf8")
            .split(/\r?\n/u)
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0);
        return lines.length > 0 ? lines.slice(-limit) : null;
    } catch {
        return null;
    }
}

function formatDaemonStartupFailure(message) {
    const logPath = `${getCompanionLogsDirectory()}/daemon.stderr.log`;
    const recentLines = readRecentDaemonStderrLines();
    if (recentLines === null) {
        return `${message} Check logs at ${logPath}`;
    }

    return `${message}\nRecent daemon stderr:\n${recentLines.map((line) => `  ${line}`).join("\n")}\nFull logs: ${logPath}`;
}

async function requestJson(method, port, path) {
    const url = `http://127.0.0.1:${port}${path}`;
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                "content-type": "application/json",
            },
            signal: AbortSignal.timeout(2_000),
        });
    } catch (error) {
        throw new Error(`Companion request to ${url} failed: ${getErrorMessage(error)}`);
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Companion request failed (${response.status}): ${body}`);
    }

    return response.json();
}

function isManagedStatusPayload(payload) {
    return typeof payload === "object"
        && payload !== null
        && typeof payload.status === "object"
        && payload.status !== null
        && typeof payload.status.daemonState === "string"
        && typeof payload.status.copilotAuthenticated === "boolean";
}

async function fetchManagedStatus(port) {
    const payload = await requestJson("GET", port, STATUS_PATH);
    if (!isManagedStatusPayload(payload)) {
        throw new Error("Legacy bridge detected on the configured port.");
    }

    return payload;
}

async function fetchManagedHealth(port) {
    return requestJson("GET", port, HEALTH_PATH);
}

async function waitForStatus(port) {
    let lastError = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            return await requestJson("GET", port, STATUS_PATH);
        } catch (error) {
            lastError = error;
            await sleep(500);
        }
    }

    throw new Error(`Companion daemon did not become ready on port ${port}. ${getErrorMessage(lastError)}`);
}

async function waitForRelayReady(port) {
    let lastStatus = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const payload = await fetchManagedStatus(port);
        lastStatus = payload;

        if (payload.status.mode !== "hosted") {
            return payload;
        }

        if (
            payload.status.relay?.connectedToRelay === true
            && payload.status.relay?.connectedToLocalBridge === true
        ) {
            return payload;
        }

        await sleep(500);
    }

    const lastError = lastStatus?.status?.lastError ?? "Relay bridge did not become ready in time.";
    throw new Error(lastError);
}

function printStatus(payload) {
    const status = payload.status;
    console.log(`Daemon: ${status.daemonState}`);
    console.log(`Mode: ${status.mode}`);
    console.log(`Bridge PID: ${status.pid}`);
    console.log(`Bridge port: ${status.port}`);
    console.log(`Workspace root: ${status.workspaceRoot ?? "-"}`);
    console.log(`Public endpoint: ${status.publicUrl}`);
    console.log(`Companion ID: ${status.companionId ?? "-"}`);
    console.log(`Copilot auth: ${status.copilotAuthenticated ? "ready" : "missing"}`);
    console.log(`Relay connected: ${status.relay?.connectedToRelay ? "yes" : "no"}`);
    console.log(`Local bridge linked: ${status.relay?.connectedToLocalBridge ? "yes" : "no"}`);
    console.log(`Client connected: ${status.hasClient ? "yes" : "no"}`);
    console.log(`Pairing token active: ${status.pairingActive ? "yes" : "no"}`);
    console.log(`Last pairing: ${status.lastPairingAt !== null ? new Date(status.lastPairingAt).toLocaleString() : "-"}`);
    console.log(`Session expires: ${status.sessionExpiresAt !== null ? new Date(status.sessionExpiresAt).toLocaleString() : "-"}`);
    console.log(`Last error: ${status.lastError ?? "-"}`);
}

function printQrCode(payload) {
    const qrCode = payload.qrCode;
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│    Code Companion Desktop — Pairing QR  │");
    console.log("└─────────────────────────────────────────┘\n");
    console.log(qrCode.ascii);
    console.log(`\nConnection: ${qrCode.payload.url}`);
    console.log(`Mode: ${qrCode.payload.transportMode}`);
    console.log(`Expires at: ${new Date(qrCode.expiresAt).toISOString()}\n`);
}

function requiresDaemonRestart(statusPayload, config) {
    const status = statusPayload.status;
    if (status.mode !== config.mode) {
        return true;
    }

    if (config.mode === "hosted" && status.hostedApiBaseUrl !== config.hostedApiBaseUrl) {
        return true;
    }

    if (config.mode === "self_hosted" && status.hostedRelayBaseUrl !== config.hostedRelayBaseUrl) {
        return true;
    }

    if ((status.workspaceRoot ?? null) !== (config.workspaceRoot ?? null)) {
        return true;
    }

    return false;
}

function stopManagedDaemon(statusPayload, platform) {
    if (platform === "windows") {
        return stopWindowsDaemon(statusPayload);
    }

    const unloaded = bootoutLaunchAgent();

    if (typeof statusPayload?.status?.pid !== "number") {
        return unloaded;
    }

    try {
        terminateProcess(statusPayload.status.pid);
        return true;
    } catch {
        return unloaded;
    }
}

function getServiceCheck(platform) {
    if (platform === "macos") {
        const launchAgentPath = getLaunchAgentPath();
        const installed = existsSync(launchAgentPath);
        return {
            label: getDesktopServiceLabel(platform),
            installed,
            detail: installed
                ? `LaunchAgent plist is present at ${launchAgentPath}.`
                : `LaunchAgent plist is missing at ${launchAgentPath}.`,
            nextAction: "Run `code-companion up` once so the LaunchAgent is installed for the current macOS user.",
        };
    }

    const { pid, running } = getWindowsDaemonPidStatus();
    return {
        label: getDesktopServiceLabel(platform),
        installed: running,
        detail: running
            ? `Background daemon is tracked in ${getDaemonPidPath()} with PID ${pid}.`
            : `Background daemon is not running. Expected PID file location: ${getDaemonPidPath()}.`,
        nextAction: "Run `code-companion up` once so the Windows background daemon starts and writes its PID file.",
    };
}

function normalizeManagedCopilotRuntimePath(resolvedPath) {
    if (path.basename(resolvedPath).toLowerCase() !== "npm-loader.js") {
        return resolvedPath;
    }

    const directEntrypoint = path.join(path.dirname(resolvedPath), "index.js");
    return existsSync(directEntrypoint) ? directEntrypoint : resolvedPath;
}

function isNodeScriptEntrypoint(resolvedPath) {
    const extension = path.extname(resolvedPath).toLowerCase();
    if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
        return true;
    }

    if (extension.length > 0) {
        return false;
    }

    try {
        const firstLine = readFileSync(resolvedPath, "utf8").slice(0, 256).split(/\r?\n/u, 1)[0] ?? "";
        return /^#!.*\bnode(?:\s|$)/u.test(firstLine);
    } catch {
        return false;
    }
}

function resolveConfiguredCopilotRuntime() {
    const configuredPath = process.env.COPILOT_CLI_PATH;
    if (typeof configuredPath !== "string" || configuredPath.trim().length === 0) {
        return null;
    }

    const resolvedPath = normalizeManagedCopilotRuntimePath(path.resolve(configuredPath.trim()));
    if (!existsSync(resolvedPath)) {
        return null;
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    if (isNodeScriptEntrypoint(resolvedPath)) {
        const shouldUseWrapper = process.platform === "win32";
        return {
            command: process.execPath,
            argsPrefix: shouldUseWrapper
                ? [getCopilotCliWrapperPath(), resolvedPath]
                : [resolvedPath],
            cliPath: process.execPath,
            cliArgs: shouldUseWrapper
                ? [getCopilotCliWrapperPath(), resolvedPath]
                : [resolvedPath],
            displayPath: resolvedPath,
            source: "configured",
            useShell: false,
        };
    }

    if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
        return {
            command: resolvedPath,
            argsPrefix: [],
            cliPath: process.execPath,
            cliArgs: [getCopilotCliWrapperPath(), resolvedPath],
            displayPath: resolvedPath,
            source: "configured",
            useShell: true,
        };
    }

    return {
        command: resolvedPath,
        argsPrefix: [],
        cliPath: resolvedPath,
        cliArgs: [],
        displayPath: resolvedPath,
        source: "configured",
        useShell: process.platform === "win32" && (extension === ".cmd" || extension === ".bat"),
    };
}

function resolveCopilotRuntime() {
    const configuredRuntime = resolveConfiguredCopilotRuntime();
    if (configuredRuntime !== null) {
        return configuredRuntime;
    }

    return resolveFallbackSystemCopilotRuntime();
}

function resolveFallbackSystemCopilotRuntime() {
    try {
        const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
        const resolvedOutput = spawnSync(lookupCommand, ["copilot"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).stdout?.trim();
        const resolvedPath = resolvedOutput
            ?.split(/\r?\n/u)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
        if (resolvedPath === undefined) {
            return null;
        }

        const systemCopilotCommand = normalizeManagedCopilotRuntimePath(resolvedPath);
        const shouldUseNodeRuntime = isNodeScriptEntrypoint(systemCopilotCommand);
        const shouldUseWrapper = process.platform === "win32" && !/\.(cmd|bat)$/iu.test(systemCopilotCommand);
        return {
            command: shouldUseNodeRuntime ? process.execPath : systemCopilotCommand,
            argsPrefix: shouldUseNodeRuntime
                ? (shouldUseWrapper ? [getCopilotCliWrapperPath(), systemCopilotCommand] : [systemCopilotCommand])
                : [],
            cliPath: shouldUseNodeRuntime || process.platform === "win32" ? process.execPath : systemCopilotCommand,
            cliArgs: shouldUseNodeRuntime
                ? (shouldUseWrapper ? [getCopilotCliWrapperPath(), systemCopilotCommand] : [systemCopilotCommand])
                : (process.platform === "win32" ? [getCopilotCliWrapperPath(), systemCopilotCommand] : []),
            displayPath: systemCopilotCommand,
            source: "system",
            useShell: process.platform === "win32" && /\.(cmd|bat)$/iu.test(systemCopilotCommand),
        };
    } catch {}

    return null;
}

function quoteShellArgument(argument) {
    if (!/[\s"]/u.test(argument)) {
        return argument;
    }

    return `"${argument.replace(/"/g, '\\"')}"`;
}

function terminateProcess(pid) {
    if (process.platform === "win32") {
        process.kill(pid);
        return;
    }

    process.kill(pid, "SIGTERM");
}

function spawnCopilotRuntime(runtime, commandArgs) {
    if (process.platform === "win32" && runtime.useShell) {
        const commandLine = [runtime.command, ...commandArgs].map(quoteShellArgument).join(" ");
        return spawn(commandLine, {
            stdio: "inherit",
            env: process.env,
            shell: true,
            windowsHide: true,
        });
    }

    return spawn(runtime.command, commandArgs, {
        stdio: "inherit",
        env: process.env,
        windowsHide: process.platform === "win32",
    });
}

function runCopilotLogin() {
    const copilotRuntime = resolveCopilotRuntime();
    if (copilotRuntime === null) {
        console.error("GitHub Copilot CLI could not be resolved.");
        console.error("Install the official GitHub Copilot CLI and make sure `copilot` is available in PATH:");
        console.error("  npm install -g @github/copilot");
        process.exit(1);
    }

    const child = spawnCopilotRuntime(copilotRuntime, [...copilotRuntime.argsPrefix, "login"]);

    child.on("error", (error) => {
        const errorCode = typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;

        if (errorCode === "ENOENT") {
            console.error("GitHub Copilot CLI could not be started.");
            console.error(`Resolved CLI target: ${copilotRuntime.displayPath}`);
            console.error("Install the official GitHub Copilot CLI and make sure `copilot` is available in PATH:");
            console.error("  npm install -g @github/copilot");
            process.exit(1);
            return;
        }

        console.error("Failed to launch GitHub Copilot CLI login.");
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });

    child.on("exit", (code, signal) => {
        if (typeof signal === "string") {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 1);
    });
}

function runLocalBuildStep(command, args, label, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
        env: process.env,
    });

    if (result.status !== 0) {
        throw new Error(`${label} failed.`);
    }
}

function maybeRefreshLocalCompanionBundle() {
    const packageRoot = getPackageRootDirectory();
    const rootPackageJsonPath = path.join(packageRoot, "package.json");
    const desktopBuildScriptPath = path.join(packageRoot, "scripts", "build-desktop-runtime.mjs");
    const sharedPackageJsonPath = path.join(packageRoot, "packages", "shared", "package.json");
    const daemonSourcePath = path.join(packageRoot, "apps", "bridge-server", "src", "daemon.ts");

    if (
        !existsSync(rootPackageJsonPath)
        || !existsSync(desktopBuildScriptPath)
        || !existsSync(sharedPackageJsonPath)
        || !existsSync(daemonSourcePath)
    ) {
        return false;
    }

    console.log("Refreshing local companion bundle...");
    runLocalBuildStep("pnpm", ["build:shared"], "Shared runtime build", packageRoot);
    runLocalBuildStep("pnpm", ["build:desktop"], "Desktop companion build", packageRoot);
    return true;
}

function truncateManagedDaemonLogs() {
    writeFileSync(`${getCompanionLogsDirectory()}/daemon.stdout.log`, "");
    writeFileSync(`${getCompanionLogsDirectory()}/daemon.stderr.log`, "");
}

function parseCommandOptions(args) {
    return {
        json: args.includes("--json"),
    };
}

function getNodeVersionCheck() {
    const rawVersion = process.versions.node;
    const majorVersion = Number.parseInt(rawVersion.split(".")[0] ?? "", 10);
    const supported = Number.isInteger(majorVersion) && majorVersion >= NODEJS_MAJOR_REQUIREMENT;

    return {
        supported,
        detail: supported
            ? `Node.js v${rawVersion} satisfies the companion package requirement (>= ${NODEJS_MAJOR_REQUIREMENT}).`
            : `Node.js v${rawVersion} is too old. Install Node.js ${NODEJS_MAJOR_REQUIREMENT}+ before using the companion.`,
    };
}

function getWindowsPowerShellCheck() {
    const result = spawnSync(
        "pwsh.exe",
        ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"],
        {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        }
    );
    const majorVersion = Number.parseInt(result.stdout?.trim() ?? "", 10);
    const supported = result.status === 0 && Number.isInteger(majorVersion) && majorVersion >= 6;

    return {
        supported,
        detail: supported
            ? `PowerShell ${majorVersion}+ (pwsh.exe) is available for Windows shell tool execution.`
            : "PowerShell 6+ (pwsh.exe) was not found. Install PowerShell 7 and ensure pwsh.exe is on PATH before using agent shell commands on Windows.",
    };
}

async function getCopilotStartupSnapshot(copilotRuntime) {
    if (copilotRuntime === null) {
        return {
            ok: false,
            detail: "GitHub Copilot CLI binary could not be resolved.",
        };
    }

    const result = spawnSync(copilotRuntime.command, [...copilotRuntime.argsPrefix, "--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32" && copilotRuntime.useShell,
        windowsHide: process.platform === "win32",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status === 0) {
        return {
            ok: true,
            detail: output.length > 0 ? `Copilot CLI starts successfully: ${output}` : "Copilot CLI starts successfully.",
        };
    }

    return {
        ok: false,
        detail: output.length > 0
            ? output
            : result.error instanceof Error
                ? result.error.message
                : "Copilot CLI failed to start.",
    };
}

function createDoctorCheck(id, label, status, detail) {
    return { id, label, status, detail };
}

function hasDoctorFailures(checks) {
    return checks.some((check) => check.status === "fail");
}

function printDoctorReport(report) {
    console.log("Code Companion Doctor");
    console.log(`Status: ${report.ready ? "ready" : "action_required"}`);
    console.log("");

    for (const check of report.checks) {
        console.log(`[${check.status}] ${check.label}`);
        console.log(check.detail);
        console.log("");
    }

    if (report.snapshot !== null) {
        console.log("Companion Snapshot");
        console.log(`Mode: ${report.snapshot.mode}`);
        console.log(`Daemon: ${report.snapshot.daemonState}`);
        console.log(`Public endpoint: ${report.snapshot.publicUrl}`);
        console.log(`Workspace root: ${report.snapshot.workspaceRoot ?? "-"}`);
        console.log(`Relay connected: ${report.snapshot.relay?.connectedToRelay ? "yes" : "no"}`);
        console.log(`Local bridge linked: ${report.snapshot.relay?.connectedToLocalBridge ? "yes" : "no"}`);
        console.log(`Client connected: ${report.snapshot.hasClient ? "yes" : "no"}`);
        console.log(`Session expires: ${report.snapshot.sessionExpiresAt !== null ? new Date(report.snapshot.sessionExpiresAt).toLocaleString() : "-"}`);
        console.log(`Last error: ${report.snapshot.lastError ?? "-"}`);
        console.log("");
    }

    if (report.nextActions.length > 0) {
        console.log("Next Actions");
        for (const action of report.nextActions) {
            console.log(`- ${action}`);
        }
    }
}

async function buildDoctorReport() {
    const checks = [];
    const nextActions = [];
    const platform = getSupportedDesktopPlatform();
    checks.push(createDoctorCheck(
        "platform",
        "Platform",
        platform !== null ? "pass" : "fail",
        platform !== null
            ? `${getDesktopPlatformDescription(platform)} detected. The desktop companion can use ${getDesktopServiceLabel(platform).toLowerCase()} lifecycle normally.`
            : `Detected platform: ${process.platform}. The desktop companion supports macOS and Windows only.`
    ));
    if (platform === null) {
        nextActions.push("Run the desktop companion on a supported macOS or Windows machine, then pair the iPhone app there.");
        return {
            ready: false,
            checks,
            nextActions,
            snapshot: null,
        };
    }

    const nodeVersionCheck = getNodeVersionCheck();
    checks.push(createDoctorCheck(
        "node",
        "Node.js",
        nodeVersionCheck.supported ? "pass" : "fail",
        nodeVersionCheck.detail
    ));
    if (!nodeVersionCheck.supported) {
        nextActions.push(`Upgrade Node.js to ${NODEJS_MAJOR_REQUIREMENT}+ and reinstall the global npm package.`);
    }

    if (platform === "windows") {
        const powerShellCheck = getWindowsPowerShellCheck();
        checks.push(createDoctorCheck(
            "powershell",
            "PowerShell 6+",
            powerShellCheck.supported ? "pass" : "fail",
            powerShellCheck.detail
        ));
        if (!powerShellCheck.supported) {
            nextActions.push("Install PowerShell 7 (`winget install --id Microsoft.PowerShell --source winget`) and restart the terminal before running `code-companion up`.");
        }
    }

    const daemonEntryPoint = getDaemonEntryPoint();
    const daemonBundleReady = existsSync(daemonEntryPoint);
    checks.push(createDoctorCheck(
        "bundle",
        "Desktop daemon bundle",
        daemonBundleReady ? "pass" : "fail",
        daemonBundleReady
            ? `Daemon bundle is present at ${daemonEntryPoint}.`
            : `Daemon bundle is missing at ${daemonEntryPoint}.`
    ));
    if (!daemonBundleReady) {
        nextActions.push("Reinstall the npm package or run `pnpm build:desktop` before starting the companion.");
    }

    const copilotRuntime = resolveCopilotRuntime();
    const copilotCliReady = copilotRuntime !== null;
    checks.push(createDoctorCheck(
        "copilot_cli",
        "GitHub Copilot CLI",
        copilotCliReady ? "pass" : "fail",
        copilotCliReady
            ? `Resolved ${copilotRuntime.source} GitHub Copilot CLI at ${copilotRuntime.displayPath}.`
            : "GitHub Copilot CLI could not be resolved from PATH."
    ));
    if (!copilotCliReady) {
        nextActions.push("Install GitHub Copilot CLI (`npm install -g @github/copilot`) and ensure the `copilot` binary is available in PATH.");
    }

    if (copilotCliReady) {
        try {
            const cliSnapshot = await getCopilotStartupSnapshot(copilotRuntime);
            checks.push(createDoctorCheck(
                "copilot_startup",
                "Copilot CLI startup",
                cliSnapshot.ok ? "pass" : "fail",
                cliSnapshot.detail
            ));
            if (!cliSnapshot.ok) {
                nextActions.push("Run `code-companion login` on the desktop companion account, then retry `code-companion doctor`.");
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            checks.push(createDoctorCheck(
                "copilot_startup",
                "Copilot CLI startup",
                "fail",
                `Could not start Copilot CLI: ${message}`
            ));
            nextActions.push("Run `code-companion login` and retry `code-companion doctor`.");
        }
    }

    let config;
    try {
        config = loadConfig();
        checks.push(createDoctorCheck(
            "config",
            "Companion config",
            "pass",
            `Config loaded from ${getCompanionConfigPath()} with mode ${config.mode} and workspace ${config.workspaceRoot ?? "-"}.`
        ));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push(createDoctorCheck(
            "config",
            "Companion config",
            "fail",
            message
        ));
        nextActions.push("Fix the companion config file under `~/.code-companion/config.json`.");
        return {
            ready: false,
            checks,
            nextActions,
            snapshot: null,
        };
    }

    const serviceCheck = getServiceCheck(platform);
    checks.push(createDoctorCheck(
        "service_manager",
        serviceCheck.label,
        serviceCheck.installed ? "pass" : "fail",
        serviceCheck.detail
    ));
    if (!serviceCheck.installed) {
        nextActions.push(serviceCheck.nextAction);
    }

    let snapshot = null;
    try {
        const healthPayload = await fetchManagedHealth(config.managementPort);
        const statusPayload = await fetchManagedStatus(config.managementPort);
        snapshot = statusPayload.status;
        checks.push(createDoctorCheck(
            "daemon",
            "Companion daemon",
            healthPayload.health?.ready === true ? "pass" : "fail",
            healthPayload.health?.ready === true
                ? `Daemon is running on port ${config.managementPort} and reports ready.`
                : `Daemon responded on port ${config.managementPort} but is not fully ready yet.`
        ));

        if (config.mode === "hosted" || config.mode === "self_hosted") {
            const relayReady = snapshot.relay?.connectedToRelay === true
                && snapshot.relay?.connectedToLocalBridge === true;
            checks.push(createDoctorCheck(
                "relay",
                "Relay link",
                relayReady ? "pass" : "fail",
                relayReady
                    ? "Relay is connected and linked back to the local bridge."
                    : `Relay status is not ready. connectedToRelay=${String(snapshot.relay?.connectedToRelay ?? false)}, connectedToLocalBridge=${String(snapshot.relay?.connectedToLocalBridge ?? false)}.`
            ));
            if (!relayReady) {
                nextActions.push("Check hosted relay deployment, secrets, and network reachability before pairing users.");
            }
        } else {
            checks.push(createDoctorCheck(
                "relay",
                "Relay link",
                "info",
                "Direct mode is active. Different-network reconnect is not expected without a hosted relay."
            ));
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push(createDoctorCheck(
            "daemon",
            "Companion daemon",
            "fail",
            `Daemon is not reachable on localhost:${config.managementPort}. ${message}`
        ));
        nextActions.push("Run `code-companion up` and wait for the QR code before pairing the phone.");
    }

    if (snapshot?.lastError) {
        checks.push(createDoctorCheck(
            "last_error",
            "Last daemon error",
            "warn",
            snapshot.lastError
        ));
    }

    if (snapshot?.sessionExpiresAt !== null && snapshot?.sessionExpiresAt !== undefined) {
        checks.push(createDoctorCheck(
            "session_expiry",
            "Relay session expiry",
            "info",
            `Current relay session expires at ${new Date(snapshot.sessionExpiresAt).toLocaleString()}.`
        ));
    }

    return {
        ready: !hasDoctorFailures(checks),
        checks,
        nextActions,
        snapshot,
    };
}

async function handleUp() {
    const platform = requireSupportedDesktopPlatform();
    ensureCompanionDirectories();
    const bundleRefreshed = maybeRefreshLocalCompanionBundle();
    const config = loadConfig();
    if (platform === "windows") {
        const powerShellCheck = getWindowsPowerShellCheck();
        if (!powerShellCheck.supported) {
            throw new Error(`${powerShellCheck.detail} Install with: winget install --id Microsoft.PowerShell --source winget`);
        }
    }
    const copilotRuntime = resolveCopilotRuntime();
    if (copilotRuntime === null) {
        throw new Error("GitHub Copilot CLI was not found. Install it with `npm install -g @github/copilot` and ensure `copilot` is on PATH.");
    }
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    if (config.workspaceRoot !== workspaceRoot) {
        config.workspaceRoot = workspaceRoot;
        writeConfig(config);
    }

    try {
        const status = await fetchManagedStatus(config.managementPort);
        if (bundleRefreshed || requiresDaemonRestart(status, config)) {
            stopManagedDaemon(status, platform);
            await sleep(1_000);
        } else {
            const readyStatus = await waitForRelayReady(config.managementPort);
            const qrPayload = await requestJson("POST", config.managementPort, QR_PATH);
            printStatus(readyStatus);
            printQrCode(qrPayload);
            return;
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("Legacy bridge detected")) {
            throw new Error("A legacy bridge is already listening on this port. Stop it before starting the managed companion.");
        }
    }

    const daemonEntryPoint = getDaemonEntryPoint();
    if (!existsSync(daemonEntryPoint)) {
        throw new Error("Desktop daemon bundle is missing. Run `pnpm build:desktop` first.");
    }

    truncateManagedDaemonLogs();

    let daemonStarted = false;
    try {
        if (platform === "macos") {
            writeLaunchAgentPlist(config.workspaceRoot ?? null);
            await bootstrapLaunchAgent();
        } else {
            startWindowsDaemon(config.workspaceRoot ?? null);
        }
        daemonStarted = true;

        await waitForStatus(config.managementPort);
        const status = await waitForRelayReady(config.managementPort);
        if (!isManagedStatusPayload(status)) {
            throw new Error("Managed companion daemon started, but the status payload is incompatible.");
        }
        if (status.status.copilotAuthenticated !== true) {
            throw new Error("GitHub Copilot CLI authentication is missing. Run `code-companion login` and try again.");
        }

        const qrPayload = await requestJson("POST", config.managementPort, QR_PATH);
        printStatus(status);
        printQrCode(qrPayload);
    } catch (error) {
        if (daemonStarted) {
            stopManagedDaemon(null, platform);
        }

        throw new Error(formatDaemonStartupFailure(getErrorMessage(error)));
    }
}

async function handleStatus() {
    requireSupportedDesktopPlatform();
    const config = loadConfig();

    try {
        const status = await fetchManagedStatus(config.managementPort);
        printStatus(status);
    } catch (error) {
        if (error instanceof Error && error.message.includes("Legacy bridge detected")) {
            console.log("Legacy bridge detected on this port. Stop it manually, then run `code-companion up`.");
            return;
        }
        console.log("Daemon: stopped");
    }
}

async function handleQr() {
    requireSupportedDesktopPlatform();
    const config = loadConfig();
    await waitForRelayReady(config.managementPort);
    const payload = await requestJson("POST", config.managementPort, QR_PATH);
    printQrCode(payload);
}

function handleLogs() {
    const platform = requireSupportedDesktopPlatform();
    ensureCompanionDirectories();
    const logPath = `${getCompanionLogsDirectory()}/daemon.stderr.log`;
    const child = platform === "windows"
        ? spawn(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-Command", `Get-Content -Path '${logPath.replace(/'/g, "''")}' -Tail 100 -Wait`],
            { stdio: "inherit", windowsHide: true }
        )
        : spawn("tail", ["-n", "100", "-f", logPath], {
            stdio: "inherit",
        });

    child.on("exit", (code, signal) => {
        if (typeof signal === "string") {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 0);
    });
}

async function handleDashboard() {
    requireSupportedDesktopPlatform();
    const config = loadConfig();
    const status = await fetchManagedStatus(config.managementPort);
    if (status.status.daemonState !== "running") {
        throw new Error("Companion daemon is not running. Start it with `code-companion up`.");
    }
    console.log(`Dashboard URL: http://127.0.0.1:${config.dashboardPort}${DASHBOARD_PATH}`);
}

async function handleDown() {
    const platform = requireSupportedDesktopPlatform();
    const config = loadConfig();

    try {
        const status = await requestJson("GET", config.managementPort, STATUS_PATH);
        if (isManagedStatusPayload(status)) {
            stopManagedDaemon(status, platform);
        } else if (typeof status?.status?.pid === "number") {
            terminateProcess(status.status.pid);
        }
    } catch {
        stopManagedDaemon(null, platform);
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await requestJson("GET", config.managementPort, STATUS_PATH);
            await sleep(250);
        } catch {
            console.log("Companion daemon stopped.");
            return;
        }
    }

    throw new Error("Companion daemon did not stop cleanly.");
}

async function handleDoctor(options) {
    const report = await buildDoctorReport();

    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printDoctorReport(report);
    }

    if (!report.ready) {
        process.exitCode = 1;
    }
}

async function main() {
    const command = process.argv[2];
    const options = parseCommandOptions(process.argv.slice(3));
    if (
        typeof command !== "string"
        || command === "help"
        || command === "--help"
        || command === "-h"
    ) {
        printUsage();
        process.exit(typeof command === "string" ? 0 : 1);
    }

    switch (command) {
        case "login":
            runCopilotLogin();
            return;
        case "up":
            await handleUp();
            return;
        case "status":
            await handleStatus();
            return;
        case "doctor":
            await handleDoctor(options);
            return;
        case "qr":
            await handleQr();
            return;
        case "logs":
            handleLogs();
            return;
        case "dashboard":
            await handleDashboard();
            return;
        case "down":
            await handleDown();
            return;
        default:
            printUsage();
            process.exit(1);
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});

#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { loadConfig, resolveWorkspaceRoot, writeConfig } from "./lib/config.mjs";
import { bootoutLaunchAgent, bootstrapLaunchAgent, writeLaunchAgentPlist } from "./lib/launch-agent.mjs";
import {
    ensureCompanionDirectories,
    getCompanionLogsDirectory,
    getDaemonEntryPoint,
    getPackageRootDirectory,
} from "./lib/paths.mjs";

const STATUS_PATH = "/__copilot_mobile/status";
const QR_PATH = "/__copilot_mobile/qr";
const DASHBOARD_PATH = "/__copilot_mobile/dashboard";

function printUsage() {
    console.log("Usage: copilot-mobile <login|up|status|qr|logs|down>");
}

function assertMacOS() {
    if (process.platform !== "darwin") {
        throw new Error("copilot-mobile desktop companion v1 currently supports macOS only.");
    }
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function requestJson(method, port, path) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
            "content-type": "application/json",
        },
        signal: AbortSignal.timeout(2_000),
    });

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

    throw new Error(`Companion daemon did not become ready on port ${port}. ${String(lastError)}`);
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
    console.log(`Last error: ${status.lastError ?? "-"}`);
}

function printQrCode(payload) {
    const qrCode = payload.qrCode;
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│ Copilot Mobile Companion — Pairing QR   │");
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

function stopManagedDaemon(statusPayload) {
    const unloaded = bootoutLaunchAgent();

    if (typeof statusPayload?.status?.pid !== "number") {
        return unloaded;
    }

    try {
        process.kill(statusPayload.status.pid, "SIGTERM");
        return true;
    } catch {
        return unloaded;
    }
}

function resolveCopilotBinary() {
    try {
        const require = createRequire(import.meta.url);
        const packageJsonPath = require.resolve("@github/copilot/package.json");
        const packageJson = require(packageJsonPath);
        const binValue = typeof packageJson.bin === "string"
            ? packageJson.bin
            : packageJson.bin?.copilot;
        if (typeof binValue !== "string") {
            return "copilot";
        }

        return path.resolve(path.dirname(packageJsonPath), binValue);
    } catch {
        return "copilot";
    }
}

function runCopilotLogin() {
    const copilotBinary = resolveCopilotBinary();
    const child = spawn(copilotBinary, ["login"], {
        stdio: "inherit",
        env: process.env,
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

async function handleUp() {
    assertMacOS();
    ensureCompanionDirectories();
    const bundleRefreshed = maybeRefreshLocalCompanionBundle();
    const config = loadConfig();
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    if (config.workspaceRoot !== workspaceRoot) {
        config.workspaceRoot = workspaceRoot;
        writeConfig(config);
    }

    try {
        const status = await fetchManagedStatus(config.managementPort);
        if (bundleRefreshed || requiresDaemonRestart(status, config)) {
            stopManagedDaemon(status);
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

    writeLaunchAgentPlist(config.workspaceRoot ?? null);
    truncateManagedDaemonLogs();

    let agentBootstrapped = false;
    try {
        await bootstrapLaunchAgent();
        agentBootstrapped = true;

        await waitForStatus(config.managementPort);
        const status = await waitForRelayReady(config.managementPort);
        if (!isManagedStatusPayload(status)) {
            throw new Error("Managed companion daemon started, but the status payload is incompatible.");
        }
        if (status.status.copilotAuthenticated !== true) {
            throw new Error("GitHub Copilot CLI authentication is missing. Run `copilot-mobile login` and try again.");
        }

        const qrPayload = await requestJson("POST", config.managementPort, QR_PATH);
        printStatus(status);
        printQrCode(qrPayload);
    } catch (error) {
        if (agentBootstrapped) {
            bootoutLaunchAgent();
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} Check logs at ${getCompanionLogsDirectory()}/daemon.stderr.log`);
    }
}

async function handleStatus() {
    assertMacOS();
    const config = loadConfig();

    try {
        const status = await fetchManagedStatus(config.managementPort);
        printStatus(status);
    } catch (error) {
        if (error instanceof Error && error.message.includes("Legacy bridge detected")) {
            console.log("Legacy bridge detected on this port. Stop it manually, then run `copilot-mobile up`.");
            return;
        }
        console.log("Daemon: stopped");
    }
}

async function handleQr() {
    assertMacOS();
    const config = loadConfig();
    await waitForRelayReady(config.managementPort);
    const payload = await requestJson("POST", config.managementPort, QR_PATH);
    printQrCode(payload);
}

function handleLogs() {
    assertMacOS();
    ensureCompanionDirectories();
    const logPath = `${getCompanionLogsDirectory()}/daemon.stderr.log`;
    const child = spawn("tail", ["-n", "100", "-f", logPath], {
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
    assertMacOS();
    const config = loadConfig();
    const status = await fetchManagedStatus(config.managementPort);
    if (status.status.daemonState !== "running") {
        throw new Error("Companion daemon is not running. Start it with `copilot-mobile up`.");
    }
    console.log(`Dashboard URL: http://127.0.0.1:${config.dashboardPort}${DASHBOARD_PATH}`);
}

async function handleDown() {
    assertMacOS();
    const config = loadConfig();

    try {
        const status = await requestJson("GET", config.managementPort, STATUS_PATH);
        if (isManagedStatusPayload(status)) {
            stopManagedDaemon(status);
        } else if (typeof status?.status?.pid === "number") {
            process.kill(status.status.pid, "SIGTERM");
        }
    } catch {
        bootoutLaunchAgent();
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

async function main() {
    const command = process.argv[2];
    if (typeof command !== "string") {
        printUsage();
        process.exit(1);
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

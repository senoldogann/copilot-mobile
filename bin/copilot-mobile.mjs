#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_BRIDGE_PORT = 9876;
const REQUIRED_PUBLIC_URL_ENV = "COPILOT_MOBILE_PUBLIC_WS_URL";
const RELAY_URL_ENV = "COPILOT_MOBILE_RELAY_URL";
const PROCESS_MARKER = "--managed-by-cli";
const MANAGEMENT_STATUS_PATH = "/__copilot_mobile/status";
const MANAGEMENT_QR_PATH = "/__copilot_mobile/qr";
const MANAGEMENT_DASHBOARD_PATH = "/__copilot_mobile/dashboard";

function getRootDirectory() {
    const currentFilePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFilePath), "..");
}

function printUsage() {
    console.log("Usage: copilot-mobile <up|status|qr|dashboard|down>");
}

function getCliStateDirectory(rootDirectory) {
    return path.join(rootDirectory, ".copilot-mobile-cli");
}

function getCliStatePath(rootDirectory) {
    return path.join(getCliStateDirectory(rootDirectory), "managed-bridge.json");
}

function writeCliState(rootDirectory, state) {
    mkdirSync(getCliStateDirectory(rootDirectory), { recursive: true });
    writeFileSync(getCliStatePath(rootDirectory), JSON.stringify(state, null, 2));
}

function readCliState(rootDirectory) {
    const statePath = getCliStatePath(rootDirectory);
    if (!existsSync(statePath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
        return null;
    }
}

function clearCliState(rootDirectory) {
    const statePath = getCliStatePath(rootDirectory);
    if (existsSync(statePath)) {
        rmSync(statePath);
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function parseBridgePort() {
    const rawPort = process.env.BRIDGE_PORT;
    if (typeof rawPort !== "string" || rawPort.trim().length === 0) {
        return DEFAULT_BRIDGE_PORT;
    }

    const parsedPort = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        throw new Error(`BRIDGE_PORT must be a valid TCP port. Received: ${rawPort}`);
    }

    return parsedPort;
}

function getBridgeBootstrapLabel() {
    const relayUrl = process.env[RELAY_URL_ENV];
    if (typeof relayUrl === "string" && relayUrl.trim().length > 0) {
        let parsedRelayUrl;
        try {
            parsedRelayUrl = new URL(relayUrl);
        } catch {
            throw new Error(
                `${RELAY_URL_ENV} must be a valid ws:// or wss:// URL. Received: ${relayUrl}`
            );
        }

        if (parsedRelayUrl.protocol !== "ws:" && parsedRelayUrl.protocol !== "wss:") {
            throw new Error(
                `${RELAY_URL_ENV} must use ws:// or wss://. Received: ${relayUrl}`
            );
        }

        return `${RELAY_URL_ENV}=${relayUrl}`;
    }

    const publicUrl = process.env[REQUIRED_PUBLIC_URL_ENV];
    if (typeof publicUrl !== "string" || publicUrl.trim().length === 0) {
        throw new Error(
            `Missing required ${REQUIRED_PUBLIC_URL_ENV} or ${RELAY_URL_ENV}. Prepare a relay URL or a public reverse-proxy URL first, then run copilot-mobile up.`
        );
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(publicUrl);
    } catch {
        throw new Error(
            `${REQUIRED_PUBLIC_URL_ENV} must be a valid wss:// URL. Received: ${publicUrl}`
        );
    }

    if (parsedUrl.protocol !== "wss:") {
        throw new Error(
            `${REQUIRED_PUBLIC_URL_ENV} must use the wss:// protocol. Received: ${publicUrl}`
        );
    }

    return `${REQUIRED_PUBLIC_URL_ENV}=${publicUrl}`;
}

async function requestJson(method, port, requestPath) {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
        method,
        headers: {
            "content-type": "application/json",
        },
        signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Bridge management request failed (${response.status}): ${body}`);
    }

    return response.json();
}

async function fetchBridgeStatus(port) {
    return requestJson("GET", port, MANAGEMENT_STATUS_PATH);
}

async function fetchFreshQrCode(port) {
    return requestJson("POST", port, MANAGEMENT_QR_PATH);
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function waitForBridge(port) {
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            return await fetchBridgeStatus(port);
        } catch (error) {
            lastError = error;
            await sleep(500);
        }
    }

    throw new Error(`Bridge did not become ready on port ${port}. ${String(lastError)}`);
}

function runPnpmCommand(rootDirectory, args) {
    execFileSync("pnpm", args, {
        cwd: rootDirectory,
        stdio: "inherit",
    });
}

function getBridgeEntryPoint(rootDirectory) {
    return path.join(rootDirectory, "apps", "bridge-server", "dist", "server.js");
}

function spawnManagedBridge(rootDirectory, publicUrl) {
    const bridgeEntryPoint = getBridgeEntryPoint(rootDirectory);
    if (!existsSync(bridgeEntryPoint)) {
        throw new Error(`Bridge build output is missing: ${bridgeEntryPoint}`);
    }

    const child = spawn(process.execPath, [bridgeEntryPoint, PROCESS_MARKER], {
        cwd: rootDirectory,
        env: {
            ...process.env,
            [REQUIRED_PUBLIC_URL_ENV]: publicUrl,
        },
        detached: true,
        stdio: "ignore",
    });

    child.unref();
    return child.pid;
}

function printStatus(statusPayload) {
    const status = statusPayload.status;
    console.log("Bridge is running.");
    console.log(`PID: ${status.pid}`);
    console.log(`Port: ${status.port}`);
    console.log(`Public URL: ${status.publicUrl}`);
    if (status.companionId !== null) {
        console.log(`Companion ID: ${status.companionId}`);
    }
    if (status.relay !== null) {
        console.log(`Relay URL: ${status.relay.relayUrl}`);
        console.log(`Relay connected: ${status.relay.connectedToRelay ? "yes" : "no"}`);
        console.log(`Local bridge linked: ${status.relay.connectedToLocalBridge ? "yes" : "no"}`);
    }
    console.log(`Client connected: ${status.hasClient ? "yes" : "no"}`);
    console.log(`Pairing token active: ${status.pairingActive ? "yes" : "no"}`);
}

function printQrCode(qrPayload) {
    const qrCode = qrPayload.qrCode;
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│   Copilot Mobile Bridge — QR Pairing    │");
    console.log("└─────────────────────────────────────────┘\n");
    console.log(qrCode.ascii);
    console.log(`\nConnection: ${qrCode.payload.url}`);
    console.log(`Mode: ${qrCode.payload.transportMode}`);
    console.log(`Token expires at: ${new Date(qrCode.expiresAt).toISOString()}\n`);
}

function openDashboard(port) {
    const dashboardUrl = `http://127.0.0.1:${port}${MANAGEMENT_DASHBOARD_PATH}`;

    if (process.platform === "darwin") {
        execFileSync("open", [dashboardUrl], { stdio: "ignore" });
        console.log(`Opened dashboard: ${dashboardUrl}`);
        return;
    }

    if (process.platform === "win32") {
        execFileSync("cmd", ["/c", "start", "", dashboardUrl], { stdio: "ignore" });
        console.log(`Opened dashboard: ${dashboardUrl}`);
        return;
    }

    execFileSync("xdg-open", [dashboardUrl], { stdio: "ignore" });
    console.log(`Opened dashboard: ${dashboardUrl}`);
}

async function handleUp() {
    const rootDirectory = getRootDirectory();
    const port = parseBridgePort();
    const bootstrapLabel = getBridgeBootstrapLabel();

    try {
        const runningStatus = await fetchBridgeStatus(port);
        console.error("Bridge is already running.");
        printStatus(runningStatus);
        process.exit(1);
    } catch {
        // Continue — bridge is not up on this port.
    }

    runPnpmCommand(rootDirectory, ["build:shared"]);
    runPnpmCommand(rootDirectory, ["build:bridge"]);

    const pid = spawnManagedBridge(rootDirectory, process.env[REQUIRED_PUBLIC_URL_ENV] ?? "");
    try {
        const statusPayload = await waitForBridge(port);
        const qrPayload = await fetchFreshQrCode(port);

        writeCliState(rootDirectory, {
            pid,
            port,
            bootstrapLabel,
            rootDirectory,
            managedAt: new Date().toISOString(),
        });

        console.log(`Bridge started in the background with PID ${pid}.`);
        printStatus(statusPayload);
        printQrCode(qrPayload);
    } catch (error) {
        if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
            process.kill(pid, "SIGTERM");
        }
        clearCliState(rootDirectory);
        throw error;
    }
}

async function handleStatus() {
    const rootDirectory = getRootDirectory();
    const port = parseBridgePort();

    try {
        const statusPayload = await fetchBridgeStatus(port);
        printStatus(statusPayload);
        return;
    } catch {
        const cliState = readCliState(rootDirectory);
        if (cliState !== null && Number.isInteger(cliState.pid) && isProcessAlive(cliState.pid)) {
            console.log(
                `Managed bridge process found for this repo (PID ${cliState.pid}), but the local status endpoint is unavailable.`
            );
            process.exit(1);
        }

        clearCliState(rootDirectory);
        console.log("Bridge is not running.");
    }
}

async function handleQr() {
    const port = parseBridgePort();

    try {
        const qrPayload = await fetchFreshQrCode(port);
        printQrCode(qrPayload);
    } catch (error) {
        throw new Error(
            `Bridge is not running or QR generation failed on port ${port}. Start it with "pnpm dev:bridge:direct" for local development or "pnpm bridge:up" for relay/public mode. ${String(error)}`
        );
    }
}

async function handleDashboard() {
    const port = parseBridgePort();

    try {
        await fetchBridgeStatus(port);
    } catch (error) {
        throw new Error(
            `Bridge is not running on port ${port}. Start it first with "pnpm dev:bridge:direct" or "pnpm bridge:up". ${String(error)}`
        );
    }

    openDashboard(port);
}

async function handleDown() {
    const rootDirectory = getRootDirectory();
    const port = parseBridgePort();
    let pid = null;

    try {
        const statusPayload = await fetchBridgeStatus(port);
        pid = statusPayload.status.pid;
    } catch {
        const cliState = readCliState(rootDirectory);
        pid = cliState?.pid ?? null;
    }

    if (pid === null) {
        clearCliState(rootDirectory);
        console.log("Bridge is not running.");
        return;
    }

    process.kill(pid, "SIGTERM");

    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await fetchBridgeStatus(port);
        } catch {
            clearCliState(rootDirectory);
            console.log(`Bridge stopped (PID ${pid}).`);
            return;
        }
        await sleep(250);
    }

    throw new Error(`Bridge process ${pid} did not stop after SIGTERM.`);
}

async function main() {
    const command = process.argv[2];

    if (typeof command !== "string") {
        printUsage();
        process.exit(1);
    }

    if (command === "up") {
        await handleUp();
        return;
    }

    if (command === "status") {
        await handleStatus();
        return;
    }

    if (command === "qr") {
        await handleQr();
        return;
    }

    if (command === "dashboard") {
        await handleDashboard();
        return;
    }

    if (command === "down") {
        await handleDown();
        return;
    }

    printUsage();
    process.exit(1);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});

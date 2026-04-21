#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import process from "node:process";

const DEFAULT_BRIDGE_PORT = 9876;
const DEFAULT_RELAY_PORT = 8787;
const RELAY_URL_ENV = "COPILOT_MOBILE_RELAY_URL";
const RELAY_SECRET_ENV = "COPILOT_MOBILE_RELAY_SECRET";
const MANAGEMENT_STATUS_PATH = "/__copilot_mobile/status";
const MANAGEMENT_QR_PATH = "/__copilot_mobile/qr";
const MANAGEMENT_DASHBOARD_PATH = "/__copilot_mobile/dashboard";

function parsePort(rawValue, defaultPort, label) {
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        return defaultPort;
    }

    const parsedPort = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        throw new Error(`${label} must be a valid TCP port. Received: ${rawValue}`);
    }

    return parsedPort;
}

function getPrivateIPv4Address() {
    const interfaces = networkInterfaces();
    const candidates = Object.values(interfaces)
        .flatMap((entries) => entries ?? [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => entry.address);

    const privateAddress = candidates.find((address) => {
        if (/^10\.\d+\.\d+\.\d+$/.test(address)) {
            return true;
        }

        if (/^192\.168\.\d+\.\d+$/.test(address)) {
            return true;
        }

        const private172Match = address.match(/^172\.(\d+)\.\d+\.\d+$/);
        if (private172Match === null) {
            return false;
        }

        const secondOctet = Number.parseInt(private172Match[1] ?? "", 10);
        return secondOctet >= 16 && secondOctet <= 31;
    });

    if (typeof privateAddress === "string") {
        return privateAddress;
    }

    throw new Error(`No private IPv4 address found. Available addresses: ${candidates.join(", ")}`);
}

function assertPortAvailable(port, label) {
    return new Promise((resolve, reject) => {
        const server = createServer();

        server.once("error", (error) => {
            if (error.code === "EADDRINUSE") {
                reject(new Error(`${label} port ${port} is already in use.`));
                return;
            }
            reject(error);
        });

        server.once("listening", () => {
            server.close(() => resolve());
        });

        server.listen(port, "0.0.0.0");
    });
}

async function requestJson(method, port, requestPath) {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
        method,
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Management request failed (${response.status}): ${body}`);
    }

    return response.json();
}

async function waitForBridge(port) {
    let lastError = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            return await requestJson("GET", port, MANAGEMENT_STATUS_PATH);
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    throw new Error(`Bridge did not become ready on port ${port}. ${String(lastError)}`);
}

function printQrCode(qrPayload) {
    const qrCode = qrPayload.qrCode;
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│   Copilot Mobile Companion — QR Ready   │");
    console.log("└─────────────────────────────────────────┘\n");
    console.log(qrCode.ascii);
    console.log(`\nConnection: ${qrCode.payload.url}`);
    console.log(`Mode: ${qrCode.payload.transportMode}`);
    console.log(`Token expires at: ${new Date(qrCode.expiresAt).toISOString()}\n`);
}

function openDashboard(port) {
    const dashboardUrl = `http://127.0.0.1:${port}${MANAGEMENT_DASHBOARD_PATH}`;

    try {
        if (process.platform === "darwin") {
            spawn("open", [dashboardUrl], { detached: true, stdio: "ignore" }).unref();
            return;
        }

        if (process.platform === "win32") {
            spawn("cmd", ["/c", "start", "", dashboardUrl], { detached: true, stdio: "ignore" }).unref();
            return;
        }

        spawn("xdg-open", [dashboardUrl], { detached: true, stdio: "ignore" }).unref();
    } catch {
        // Best-effort only.
    }
}

async function main() {
    const bridgePort = parsePort(process.env.BRIDGE_PORT, DEFAULT_BRIDGE_PORT, "BRIDGE_PORT");
    const relayPort = parsePort(process.env.RELAY_PORT, DEFAULT_RELAY_PORT, "RELAY_PORT");
    const lanIp = getPrivateIPv4Address();
    const relayUrl = `ws://${lanIp}:${relayPort}`;
    const relaySecret = process.env[RELAY_SECRET_ENV] ?? randomBytes(32).toString("hex");

    await assertPortAvailable(relayPort, "Relay");
    await assertPortAvailable(bridgePort, "Bridge");

    console.log(`Starting local companion relay at ${relayUrl}`);
    console.log(`Starting local bridge on ws://127.0.0.1:${bridgePort}`);
    console.log(`Dashboard will be available at http://127.0.0.1:${bridgePort}${MANAGEMENT_DASHBOARD_PATH}\n`);

    const relayProcess = spawn("pnpm", ["--filter", "@copilot-mobile/relay-server", "dev"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            RELAY_PORT: String(relayPort),
            [RELAY_SECRET_ENV]: relaySecret,
        },
        stdio: "inherit",
    });

    const bridgeProcess = spawn("pnpm", ["--filter", "@copilot-mobile/bridge-server", "dev"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            BRIDGE_PORT: String(bridgePort),
            [RELAY_URL_ENV]: relayUrl,
            [RELAY_SECRET_ENV]: relaySecret,
        },
        stdio: "inherit",
    });

    const shutdown = () => {
        relayProcess.kill("SIGTERM");
        bridgeProcess.kill("SIGTERM");
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    relayProcess.on("exit", (code) => {
        if (code !== 0 && bridgeProcess.exitCode === null) {
            bridgeProcess.kill("SIGTERM");
        }
    });

    bridgeProcess.on("exit", (code, signal) => {
        if (relayProcess.exitCode === null) {
            relayProcess.kill("SIGTERM");
        }

        if (typeof signal === "string") {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 1);
    });

    const statusPayload = await waitForBridge(bridgePort);
    const qrPayload = await requestJson("POST", bridgePort, MANAGEMENT_QR_PATH);

    console.log("Local companion stack is ready.");
    console.log(`Public URL: ${statusPayload.status.publicUrl}`);
    console.log(`Companion ID: ${statusPayload.status.companionId ?? "-"}`);
    openDashboard(bridgePort);
    printQrCode(qrPayload);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});

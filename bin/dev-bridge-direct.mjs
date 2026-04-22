#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import process from "node:process";

const DEFAULT_BRIDGE_PORT = 9876;
const REQUIRED_PUBLIC_URL_ENV = "COPILOT_MOBILE_PUBLIC_WS_URL";
const ALLOW_INSECURE_DIRECT_WS_ENV = "COPILOT_MOBILE_ALLOW_INSECURE_DIRECT_WS";
const MANAGEMENT_STATUS_PATH = "/__copilot_mobile/status";
const MANAGEMENT_QR_PATH = "/__copilot_mobile/qr";

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

function printQrCode(qrPayload) {
    const qrCode = qrPayload.qrCode;
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│    Code Companion — QR Pairing Ready    │");
    console.log("└─────────────────────────────────────────┘\n");
    console.log(qrCode.ascii);
    console.log(`\nConnection: ${qrCode.payload.url}`);
    console.log(`Mode: ${qrCode.payload.transportMode}`);
    console.log(`Token expires at: ${new Date(qrCode.expiresAt).toISOString()}\n`);
}

async function printExistingBridge(port) {
    const statusPayload = await fetchBridgeStatus(port);
    const qrPayload = await fetchFreshQrCode(port);
    const status = statusPayload.status;

    console.log("Bridge is already running.");
    console.log(`PID: ${status.pid}`);
    console.log(`Port: ${status.port}`);
    console.log(`Public URL: ${status.publicUrl}`);
    console.log(`Client connected: ${status.hasClient ? "yes" : "no"}`);
    printQrCode(qrPayload);
}

function assertPortAvailable(port) {
    return new Promise((resolve, reject) => {
        const server = createServer();

        server.once("error", (error) => {
            if (error.code === "EADDRINUSE") {
                reject(
                    new Error(
                        `Port ${port} is already in use, but it does not look like a healthy Code Companion bridge. Stop the owner with "lsof -nP -iTCP:${port} -sTCP:LISTEN" and then rerun "pnpm dev:bridge:direct".`
                    )
                );
                return;
            }

            reject(error);
        });

        server.once("listening", () => {
            server.close(() => {
                resolve();
            });
        });

        server.listen(port, "0.0.0.0");
    });
}

async function main() {
    const port = parseBridgePort();
    const address = getPrivateIPv4Address();
    const bridgeUrl = `ws://${address}:${port}`;

    try {
        await printExistingBridge(port);
        return;
    } catch {
        // Continue and start a bridge below.
    }

    await assertPortAvailable(port);

    console.log(`Starting direct development bridge at ${bridgeUrl}`);
    console.log("Use this only on a trusted local network.\n");

    const child = spawn("pnpm", ["--filter", "@copilot-mobile/bridge-server", "dev"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            [REQUIRED_PUBLIC_URL_ENV]: bridgeUrl,
            [ALLOW_INSECURE_DIRECT_WS_ENV]: "1",
        },
        stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
        if (typeof signal === "string") {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 1);
    });
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});

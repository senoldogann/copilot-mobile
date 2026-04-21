// Copilot Mobile Bridge Server — main entry point

import { createCopilotAdapter } from "./copilot/client.js";
import { createBridgeServer } from "./ws/server.js";
import { printPairingQRCode } from "./auth/qr.js";
import { getOrCreateCompanionId } from "./auth/companion-id.js";
import { createRelayProxy } from "./relay/proxy.js";
import { createRelayAccessToken, getRequiredRelaySecret } from "./auth/relay-token.js";
import { DEFAULT_WS_PORT } from "@copilot-mobile/shared";

const REQUIRED_PUBLIC_URL_ENV = "COPILOT_MOBILE_PUBLIC_WS_URL";
const RELAY_BASE_URL_ENV = "COPILOT_MOBILE_RELAY_URL";

function isDirectHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();

    if (
        normalized === "localhost"
        || normalized === "127.0.0.1"
        || normalized === "::1"
        || normalized === "[::1]"
    ) {
        return true;
    }

    if (/^10\.\d+\.\d+\.\d+$/.test(normalized)) {
        return true;
    }

    if (/^192\.168\.\d+\.\d+$/.test(normalized)) {
        return true;
    }

    const private172Match = normalized.match(/^172\.(\d+)\.\d+\.\d+$/);
    if (private172Match === null) {
        return false;
    }

    const secondOctet = Number.parseInt(private172Match[1] ?? "", 10);
    return secondOctet >= 16 && secondOctet <= 31;
}

function getRequiredPublicWebSocketUrl(): string {
    const publicWebSocketUrl = process.env[REQUIRED_PUBLIC_URL_ENV];
    if (typeof publicWebSocketUrl !== "string" || publicWebSocketUrl.trim().length === 0) {
        throw new Error(
            `Missing required ${REQUIRED_PUBLIC_URL_ENV}. Prepare a public relay or reverse-proxy wss:// URL, or use a private-network ws:// development URL before starting the bridge.`
        );
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(publicWebSocketUrl);
    } catch {
        throw new Error(
            `${REQUIRED_PUBLIC_URL_ENV} must be a valid wss:// URL. Received: ${publicWebSocketUrl}`
        );
    }

    if (parsedUrl.protocol === "wss:") {
        return publicWebSocketUrl;
    }

    if (parsedUrl.protocol === "ws:" && isDirectHostname(parsedUrl.hostname)) {
        return publicWebSocketUrl;
    }

    if (parsedUrl.protocol !== "wss:") {
        throw new Error(
            `${REQUIRED_PUBLIC_URL_ENV} must use wss://, or ws:// only for localhost/private-network development URLs. Received: ${publicWebSocketUrl}`
        );
    }

    return publicWebSocketUrl;
}

function getOptionalRelayBaseUrl(): string | null {
    const rawRelayUrl = process.env[RELAY_BASE_URL_ENV];
    if (typeof rawRelayUrl !== "string" || rawRelayUrl.trim().length === 0) {
        return null;
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawRelayUrl);
    } catch {
        throw new Error(
            `${RELAY_BASE_URL_ENV} must be a valid ws:// or wss:// URL. Received: ${rawRelayUrl}`
        );
    }

    if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
        throw new Error(
            `${RELAY_BASE_URL_ENV} must use ws:// or wss://. Received: ${rawRelayUrl}`
        );
    }

    return rawRelayUrl;
}

type RelayRuntimeConfig = {
    companionId: string;
    mobileSocketUrl: string;
    companionSocketUrl: string;
    mobileAccessToken: string;
    companionAccessToken: string;
};

function buildRelaySocketUrl(
    relayBaseUrl: string,
    role: "mobile" | "companion",
    companionId: string
): string {
    const url = new URL(relayBaseUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/connect/${role}/${encodeURIComponent(companionId)}`;
    url.search = "";
    url.hash = "";
    return url.toString();
}

function resolveRelayRuntimeConfig(relayBaseUrl: string): RelayRuntimeConfig {
    const companionId = getOrCreateCompanionId();
    getRequiredRelaySecret();

    return {
        companionId,
        mobileSocketUrl: buildRelaySocketUrl(relayBaseUrl, "mobile", companionId),
        companionSocketUrl: buildRelaySocketUrl(relayBaseUrl, "companion", companionId),
        mobileAccessToken: createRelayAccessToken("mobile", companionId),
        companionAccessToken: createRelayAccessToken("companion", companionId),
    };
}

function isNodeListenError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

async function main(): Promise<void> {
    console.log("Starting Copilot Mobile Bridge...\n");
    const bridgePort = Number.parseInt(process.env["BRIDGE_PORT"] ?? "", 10) || DEFAULT_WS_PORT;
    const relayBaseUrl = getOptionalRelayBaseUrl();
    const relayConfig = relayBaseUrl !== null
        ? resolveRelayRuntimeConfig(relayBaseUrl)
        : null;
    const publicWebSocketUrl = relayConfig?.mobileSocketUrl ?? getRequiredPublicWebSocketUrl();

    // Create Copilot SDK adapter
    const copilotClient = createCopilotAdapter();

    // Check SDK availability
    const available = await copilotClient.isAvailable();
    if (!available) {
        console.warn("[copilot] Copilot CLI not reachable. Make sure you are signed in with your GitHub account.");
        console.warn("[copilot] Starting bridge server anyway (connection attempts will continue)...\n");
    } else {
        console.log("[copilot] Copilot CLI connection successful\n");
    }

    // Start WebSocket server
    let relayProxy: ReturnType<typeof createRelayProxy> | null = null;
    if (relayConfig !== null) {
        relayProxy = createRelayProxy({
            relayUrl: relayConfig.companionSocketUrl,
            localBridgeUrl: `ws://127.0.0.1:${bridgePort}`,
            companionId: relayConfig.companionId,
            accessToken: relayConfig.companionAccessToken,
        });
    }

    const wsServer = createBridgeServer(
        copilotClient,
        publicWebSocketUrl,
        relayConfig !== null
            ? {
                companionId: relayConfig.companionId,
                relayMobileAccessToken: relayConfig.mobileAccessToken,
                getRelayStatus: () => relayProxy?.getStatus() ?? null,
            }
            : undefined
    );
    await wsServer.start();
    relayProxy?.start();

    // Display QR code
    const qrCode = await wsServer.createPairingQrCode(relayConfig?.mobileAccessToken);
    printPairingQRCode(qrCode);

    // Graceful shutdown
    const shutdown = async () => {
        console.log("\nShutting down...");
        relayProxy?.shutdown();
        await wsServer.shutdown();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    if (isNodeListenError(err) && err.code === "EADDRINUSE") {
        const port = process.env["BRIDGE_PORT"] ?? "9876";
        console.error(
            `Failed to start bridge server: port ${port} is already in use. Stop the existing bridge with "pnpm bridge:down" or find the owner with "lsof -nP -iTCP:${port} -sTCP:LISTEN".`
        );
        process.exit(1);
    }

    console.error("Failed to start bridge server:", err);
    process.exit(1);
});

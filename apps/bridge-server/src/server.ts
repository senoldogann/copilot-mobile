// Copilot Mobile Bridge Server — main entry point

import { createCopilotAdapter } from "./copilot/client.js";
import { createBridgeServer } from "./ws/server.js";
import { printPairingQRCode } from "./auth/qr.js";
import { getOrCreateCompanionId } from "./auth/companion-id.js";
import { createRelayProxy } from "./relay/proxy.js";
import { createRelayAccessToken, getRequiredRelaySecret } from "./auth/relay-token.js";
import { DEFAULT_WS_PORT } from "@copilot-mobile/shared";

const REQUIRED_PUBLIC_URL_ENV = "COPILOT_MOBILE_PUBLIC_WS_URL";
const REQUIRED_PUBLIC_CERT_FINGERPRINT_ENV = "COPILOT_MOBILE_PUBLIC_CERT_FINGERPRINT";
const RELAY_BASE_URL_ENV = "COPILOT_MOBILE_RELAY_URL";
const ALLOW_INSECURE_DIRECT_WS_ENV = "COPILOT_MOBILE_ALLOW_INSECURE_DIRECT_WS";

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

function isAllowedPublicWebSocketUrl(parsedUrl: URL): boolean {
    if (parsedUrl.protocol === "wss:") {
        return true;
    }

    return parsedUrl.protocol === "ws:"
        && isDirectHostname(parsedUrl.hostname)
        && process.env[ALLOW_INSECURE_DIRECT_WS_ENV] === "1";
}

function isInsecureDirectWebSocketUrl(parsedUrl: URL): boolean {
    return parsedUrl.protocol === "ws:";
}

function getRequiredPublicWebSocketUrl(): string {
    const publicWebSocketUrl = process.env[REQUIRED_PUBLIC_URL_ENV];
    if (typeof publicWebSocketUrl !== "string" || publicWebSocketUrl.trim().length === 0) {
        throw new Error(
            `Missing required ${REQUIRED_PUBLIC_URL_ENV}. Prepare a public relay or reverse-proxy wss:// URL, or opt into insecure private-network ws:// development with ${ALLOW_INSECURE_DIRECT_WS_ENV}=1 before starting the bridge.`
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

    if (isAllowedPublicWebSocketUrl(parsedUrl)) {
        if (isInsecureDirectWebSocketUrl(parsedUrl)) {
            console.warn(
                `[security] Insecure direct ws:// mode enabled for private-network development only via ${ALLOW_INSECURE_DIRECT_WS_ENV}=1.`
            );
            console.warn(
                `[security] Do not expose this mode through public IPs, tunnels, reverse proxies, or production daemon installs.`
            );
        }
        return publicWebSocketUrl;
    }

    throw new Error(
        `${REQUIRED_PUBLIC_URL_ENV} must use wss://, or ws:// only for localhost/private-network development URLs when ${ALLOW_INSECURE_DIRECT_WS_ENV}=1. Received: ${publicWebSocketUrl}`
    );
}

function getRequiredPublicCertFingerprint(publicWebSocketUrl: string): string | null {
    const parsedUrl = new URL(publicWebSocketUrl);

    if (parsedUrl.protocol === "ws:") {
        return null;
    }

    const rawFingerprint = process.env[REQUIRED_PUBLIC_CERT_FINGERPRINT_ENV];
    if (typeof rawFingerprint !== "string" || rawFingerprint.trim().length === 0) {
        throw new Error(
            `${REQUIRED_PUBLIC_CERT_FINGERPRINT_ENV} is required for direct wss:// pairing so the mobile client can pin the presented certificate.`
        );
    }

    return rawFingerprint.trim().toLowerCase();
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
    const publicCertFingerprint = relayConfig !== null
        ? null
        : getRequiredPublicCertFingerprint(publicWebSocketUrl);

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
                publicCertFingerprint,
                companionId: relayConfig.companionId,
                getRelayMobileAccessToken: () => relayConfig.mobileAccessToken,
                getRelayStatus: () => relayProxy?.getStatus() ?? null,
            }
            : { publicCertFingerprint }
    );
    await wsServer.start();
    relayProxy?.start();

    // Display QR code
    const qrCode = await wsServer.createPairingQrCode(relayConfig?.mobileAccessToken);
    printPairingQRCode(qrCode);

    // Graceful shutdown
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.log(`\nShutting down after ${signal}...`);

        try {
            relayProxy?.shutdown();
            await wsServer.shutdown();
            await copilotClient.shutdown();
            process.exit(0);
        } catch (error) {
            console.error("Failed during shutdown:", error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
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

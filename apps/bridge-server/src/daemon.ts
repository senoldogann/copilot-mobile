import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createCopilotAdapter } from "./copilot/client.js";
import { createBridgeServer } from "./ws/server.js";
import { createRelayProxy } from "./relay/proxy.js";
import type { RelayProxy } from "./relay/proxy.js";
import { createRelayAccessToken } from "./auth/relay-token.js";
import { getOrCreateCompanionId } from "./auth/companion-id.js";

type DesktopMode = "hosted" | "self_hosted";

type DesktopConfig = {
    mode: DesktopMode;
    bridgePort: number;
    managementPort: number;
    dashboardPort: number;
    hostedApiBaseUrl: string;
    hostedRelayBaseUrl: string;
    workspaceRoot?: string;
    selfHostedRelayUrl?: string;
    selfHostedRelaySecret?: string;
    companionRegistrationCredential?: string;
    companionId?: string;
};

type HostedSessionResponse = {
    companionId: string;
    mobileSocketUrl: string;
    companionSocketUrl: string;
    mobileAccessToken: string;
    companionAccessToken: string;
    expiresAt: number;
};

type RuntimeState = {
    daemonState: "starting" | "running" | "error" | "stopping";
    mode: "hosted" | "self_hosted";
    copilotAuthenticated: boolean;
    lastError: string | null;
    lastPairingAt: number | null;
    logsDirectory: string | null;
    workspaceRoot: string | null;
    hostedApiBaseUrl?: string;
    hostedRelayBaseUrl?: string;
    sessionExpiresAt?: number | null;
};

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".copilot-mobile", "config.json");
const DEFAULT_LOGS_DIR = path.join(os.homedir(), ".copilot-mobile", "logs");
const RELAY_SECRET_ENV = "COPILOT_MOBILE_RELAY_SECRET";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const RETRY_REFRESH_DELAY_MS = 60 * 1000;

function getConfigPath(): string {
    return process.env["COPILOT_MOBILE_CONFIG_PATH"] ?? DEFAULT_CONFIG_PATH;
}

function getLogsDirectory(): string {
    return process.env["COPILOT_MOBILE_LOGS_DIR"] ?? DEFAULT_LOGS_DIR;
}

function parseDesktopConfig(rawConfig: unknown): DesktopConfig {
    if (typeof rawConfig !== "object" || rawConfig === null || Array.isArray(rawConfig)) {
        throw new Error("Desktop config must be a JSON object.");
    }

    const value = rawConfig as Record<string, unknown>;
    if (value.mode !== "hosted" && value.mode !== "self_hosted") {
        throw new Error(`Desktop config mode is invalid: ${String(value.mode)}`);
    }

    const bridgePort = Number(value.bridgePort);
    const managementPort = Number(value.managementPort);
    const dashboardPort = Number(value.dashboardPort);
    const hostedApiBaseUrl = String(value.hostedApiBaseUrl ?? "");
    const hostedRelayBaseUrl = String(value.hostedRelayBaseUrl ?? "");

    if (!Number.isInteger(bridgePort) || !Number.isInteger(managementPort) || !Number.isInteger(dashboardPort)) {
        throw new Error("Desktop config ports must be integers.");
    }

    if (hostedApiBaseUrl.length === 0 || hostedRelayBaseUrl.length === 0) {
        throw new Error("Desktop config requires hostedApiBaseUrl and hostedRelayBaseUrl.");
    }

    const parsedConfig: DesktopConfig = {
        mode: value.mode,
        bridgePort,
        managementPort,
        dashboardPort,
        hostedApiBaseUrl,
        hostedRelayBaseUrl,
    };

    if (typeof value.selfHostedRelayUrl === "string" && value.selfHostedRelayUrl.trim().length > 0) {
        parsedConfig.selfHostedRelayUrl = value.selfHostedRelayUrl.trim();
    }

    if (typeof value.selfHostedRelaySecret === "string" && value.selfHostedRelaySecret.trim().length > 0) {
        parsedConfig.selfHostedRelaySecret = value.selfHostedRelaySecret.trim();
    }

    if (
        typeof value.companionRegistrationCredential === "string"
        && value.companionRegistrationCredential.trim().length > 0
    ) {
        parsedConfig.companionRegistrationCredential = value.companionRegistrationCredential.trim();
    }

    if (typeof value.companionId === "string" && value.companionId.trim().length > 0) {
        parsedConfig.companionId = value.companionId.trim();
    }

    if (typeof value.workspaceRoot === "string" && value.workspaceRoot.trim().length > 0) {
        parsedConfig.workspaceRoot = value.workspaceRoot.trim();
    }

    return parsedConfig;
}

function loadDesktopConfig(configPath: string): DesktopConfig {
    if (!existsSync(configPath)) {
        throw new Error(`Desktop config not found at ${configPath}. Run \`copilot-mobile up\` again.`);
    }

    const rawConfig = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return parseDesktopConfig(rawConfig);
}

function saveDesktopConfig(configPath: string, config: DesktopConfig): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function requestJson(
    method: "POST" | "GET",
    baseUrl: string,
    pathname: string,
    body: Record<string, unknown> | null
): Promise<unknown> {
    const requestInit: RequestInit = {
        method,
        headers: {
            "content-type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
    };

    if (body !== null) {
        requestInit.body = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, requestInit);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${method} ${pathname} failed (${response.status}): ${text}`);
    }

    return response.json();
}

async function registerHostedCompanion(config: DesktopConfig): Promise<{
    companionId: string;
    companionRegistrationCredential: string;
}> {
    const response = await requestJson(
        "POST",
        config.hostedApiBaseUrl,
        "/v1/companions/register",
        {
            hostname: os.hostname(),
            platform: process.platform,
        }
    ) as Record<string, unknown>;

    if (
        typeof response.companionId !== "string"
        || typeof response.companionRegistrationCredential !== "string"
    ) {
        throw new Error("Hosted companion registration returned an invalid payload.");
    }

    return {
        companionId: response.companionId,
        companionRegistrationCredential: response.companionRegistrationCredential,
    };
}

function shouldReRegisterHostedCompanion(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return error.message.includes("signature verification failed")
        || error.message.includes("Companion registration credential");
}

async function createHostedSession(
    config: DesktopConfig,
    refresh: boolean
): Promise<HostedSessionResponse> {
    const endpoint = refresh ? "/v1/companions/session/refresh" : "/v1/companions/session";
    const response = await requestJson(
        "POST",
        config.hostedApiBaseUrl,
        endpoint,
        {
            companionRegistrationCredential: config.companionRegistrationCredential,
            companionId: config.companionId,
        }
    ) as Record<string, unknown>;

    if (
        typeof response.companionId !== "string"
        || typeof response.mobileSocketUrl !== "string"
        || typeof response.companionSocketUrl !== "string"
        || typeof response.mobileAccessToken !== "string"
        || typeof response.companionAccessToken !== "string"
        || typeof response.expiresAt !== "number"
    ) {
        throw new Error("Hosted session payload is invalid.");
    }

    return {
        companionId: response.companionId,
        mobileSocketUrl: response.mobileSocketUrl,
        companionSocketUrl: response.companionSocketUrl,
        mobileAccessToken: response.mobileAccessToken,
        companionAccessToken: response.companionAccessToken,
        expiresAt: response.expiresAt,
    };
}

function buildSelfHostedSession(config: DesktopConfig): HostedSessionResponse {
    if (
        typeof config.selfHostedRelayUrl !== "string"
        || config.selfHostedRelayUrl.length === 0
        || typeof config.selfHostedRelaySecret !== "string"
        || config.selfHostedRelaySecret.length === 0
    ) {
        throw new Error("Self-hosted mode requires selfHostedRelayUrl and selfHostedRelaySecret.");
    }

    process.env[RELAY_SECRET_ENV] = config.selfHostedRelaySecret;

    const relayBaseUrl = config.selfHostedRelayUrl.replace(/\/$/, "");
    const companionId = typeof config.companionId === "string" && config.companionId.length > 0
        ? config.companionId
        : getOrCreateCompanionId();
    const socketUrl = new URL(relayBaseUrl);
    socketUrl.pathname = `/connect/mobile/${encodeURIComponent(companionId)}`;
    socketUrl.search = "";
    socketUrl.hash = "";
    const companionSocketUrl = new URL(relayBaseUrl);
    companionSocketUrl.pathname = `/connect/companion/${encodeURIComponent(companionId)}`;
    companionSocketUrl.search = "";
    companionSocketUrl.hash = "";

    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    return {
        companionId,
        mobileSocketUrl: socketUrl.toString(),
        companionSocketUrl: companionSocketUrl.toString(),
        mobileAccessToken: createRelayAccessToken("mobile", companionId),
        companionAccessToken: createRelayAccessToken("companion", companionId),
        expiresAt,
    };
}

async function main(): Promise<void> {
    const configPath = getConfigPath();
    const logsDirectory = getLogsDirectory();
    const config = loadDesktopConfig(configPath);
    const runtimeState: RuntimeState = {
        daemonState: "starting",
        mode: config.mode,
        copilotAuthenticated: false,
        lastError: null,
        lastPairingAt: null,
        logsDirectory,
        workspaceRoot: config.workspaceRoot ?? null,
        hostedApiBaseUrl: config.hostedApiBaseUrl,
        hostedRelayBaseUrl: config.hostedRelayBaseUrl,
        sessionExpiresAt: null,
    };

    let relaySession: HostedSessionResponse | null = null;
    let relayProxy: RelayProxy | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let shuttingDown = false;
    let wsServer: ReturnType<typeof createBridgeServer> | null = null;

    const copilotClient = createCopilotAdapter();
    const available = await copilotClient.isAvailable();
    runtimeState.copilotAuthenticated = available;

    if (!available) {
        runtimeState.daemonState = "error";
        runtimeState.lastError = "GitHub Copilot CLI is not authenticated. Run `copilot-mobile login` first.";
        throw new Error(runtimeState.lastError);
    }

    if (config.mode === "hosted" && (
        typeof config.companionRegistrationCredential !== "string"
        || typeof config.companionId !== "string"
    )) {
        const registration = await registerHostedCompanion(config);
        config.companionId = registration.companionId;
        config.companionRegistrationCredential = registration.companionRegistrationCredential;
        saveDesktopConfig(configPath, config);
    }

    const loadRelaySession = async (refresh: boolean): Promise<HostedSessionResponse> => {
        if (config.mode !== "hosted") {
            return buildSelfHostedSession(config);
        }

        try {
            return await createHostedSession(config, refresh);
        } catch (error) {
            if (!shouldReRegisterHostedCompanion(error)) {
                throw error;
            }

            const registration = await registerHostedCompanion(config);
            config.companionId = registration.companionId;
            config.companionRegistrationCredential = registration.companionRegistrationCredential;
            saveDesktopConfig(configPath, config);
            return createHostedSession(config, false);
        }
    };

    const stopRelayProxy = (): void => {
        if (relayProxy === null) {
            return;
        }

        const currentRelayProxy: RelayProxy = relayProxy;
        relayProxy = null;
        currentRelayProxy.shutdown();
    };

    const startRelayProxy = (session: HostedSessionResponse): void => {
        relaySession = session;
        runtimeState.sessionExpiresAt = session.expiresAt;
        stopRelayProxy();
        relayProxy = createRelayProxy({
            relayUrl: session.companionSocketUrl,
            localBridgeUrl: `ws://127.0.0.1:${config.bridgePort}`,
            companionId: session.companionId,
            accessToken: session.companionAccessToken,
        });
        relayProxy.start();
    };

    const scheduleSessionRefresh = (): void => {
        if (config.mode !== "hosted" || relaySession === null || shuttingDown) {
            return;
        }

        if (refreshTimer !== null) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }

        const delay = Math.max(relaySession.expiresAt - Date.now() - REFRESH_SKEW_MS, RETRY_REFRESH_DELAY_MS);
        refreshTimer = setTimeout(() => {
            void refreshHostedSession();
        }, delay);
    };

    const refreshHostedSession = async (): Promise<void> => {
        if (config.mode !== "hosted" || shuttingDown) {
            return;
        }

        try {
            const session = await loadRelaySession(true);
            startRelayProxy(session);
            runtimeState.lastError = null;
            scheduleSessionRefresh();
        } catch (error) {
            runtimeState.lastError = error instanceof Error ? error.message : String(error);
            refreshTimer = setTimeout(() => {
                void refreshHostedSession();
            }, RETRY_REFRESH_DELAY_MS);
        }
    };

    const firstSession = await loadRelaySession(false);
    startRelayProxy(firstSession);
    scheduleSessionRefresh();

    const shutdown = async (): Promise<void> => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        runtimeState.daemonState = "stopping";
        if (refreshTimer !== null) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        stopRelayProxy();
        if (wsServer !== null) {
            await wsServer.shutdown();
        }
        await copilotClient.shutdown();
        process.exit(0);
    };

    wsServer = createBridgeServer(
        copilotClient,
        firstSession.mobileSocketUrl,
        {
            companionId: firstSession.companionId,
            getRelayMobileAccessToken: () => relaySession?.mobileAccessToken ?? null,
            getRelayStatus: () => relayProxy?.getStatus() ?? null,
            getManagementState: () => runtimeState,
            onStopRequested: shutdown,
            onOpenLogsRequested: () => {
                execFileSync("open", [logsDirectory], { stdio: "ignore" });
            },
            onPairingAuthenticated: () => {
                runtimeState.lastPairingAt = Date.now();
            },
        }
    );

    try {
        await wsServer.start();
        runtimeState.daemonState = "running";
        runtimeState.lastError = null;
    } catch (error) {
        runtimeState.daemonState = "error";
        runtimeState.lastError = error instanceof Error ? error.message : String(error);
        stopRelayProxy();
        await copilotClient.shutdown();
        throw error;
    }

    process.on("SIGINT", () => {
        void shutdown();
    });
    process.on("SIGTERM", () => {
        void shutdown();
    });
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});

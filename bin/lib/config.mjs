import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { getCompanionConfigPath, ensureCompanionDirectories } from "./paths.mjs";

const DEFAULT_BRIDGE_PORT = 9876;
const DEFAULT_HOSTED_API_BASE_URL = "https://copilot-mobile-relay.senoldogan0233.workers.dev";
const LEGACY_DEFAULT_HOSTED_API_BASE_URL = "http://127.0.0.1:8787";
const LEGACY_DEFAULT_HOSTED_RELAY_BASE_URL = "ws://127.0.0.1:8787";
const HOSTED_API_BASE_URL_ENV = "COPILOT_MOBILE_HOSTED_API_BASE_URL";
const HOSTED_RELAY_BASE_URL_ENV = "COPILOT_MOBILE_HOSTED_RELAY_BASE_URL";
const SELF_HOSTED_RELAY_URL_ENV = "COPILOT_MOBILE_SELF_HOSTED_RELAY_URL";
const SELF_HOSTED_RELAY_SECRET_ENV = "COPILOT_MOBILE_SELF_HOSTED_RELAY_SECRET";
const MODE_ENV = "COPILOT_MOBILE_MODE";

function detectGitRoot(currentWorkingDirectory) {
    try {
        const stdout = execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: currentWorkingDirectory,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return path.resolve(stdout);
    } catch {
        return path.resolve(currentWorkingDirectory);
    }
}

function parsePort(rawValue, fallbackPort, label) {
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        return fallbackPort;
    }

    const parsedPort = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        throw new Error(`${label} must be a valid TCP port. Received: ${rawValue}`);
    }

    return parsedPort;
}

function deriveHostedRelayBaseUrl(hostedApiBaseUrl) {
    const parsedUrl = new URL(hostedApiBaseUrl);
    parsedUrl.protocol = parsedUrl.protocol === "https:" ? "wss:" : "ws:";
    parsedUrl.pathname = "";
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return parsedUrl.toString().replace(/\/$/, "");
}

function getDefaultHostedApiBaseUrl() {
    const fromEnv = process.env[HOSTED_API_BASE_URL_ENV];
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
        return fromEnv.trim().replace(/\/$/, "");
    }

    return DEFAULT_HOSTED_API_BASE_URL;
}

function getDefaultMode() {
    const rawMode = process.env[MODE_ENV];
    if (rawMode === "self_hosted") {
        return "self_hosted";
    }

    return "hosted";
}

function buildDefaultConfig() {
    const bridgePort = parsePort(process.env.BRIDGE_PORT, DEFAULT_BRIDGE_PORT, "BRIDGE_PORT");
    const hostedApiBaseUrl = getDefaultHostedApiBaseUrl();
    const hostedRelayBaseUrl = (
        process.env[HOSTED_RELAY_BASE_URL_ENV]?.trim().replace(/\/$/, "")
        ?? deriveHostedRelayBaseUrl(hostedApiBaseUrl)
    );

    return {
        mode: getDefaultMode(),
        bridgePort,
        managementPort: bridgePort,
        dashboardPort: bridgePort,
        hostedApiBaseUrl,
        hostedRelayBaseUrl,
    };
}

function normalizeConfig(rawConfig) {
    if (typeof rawConfig !== "object" || rawConfig === null || Array.isArray(rawConfig)) {
        throw new Error("Companion config must be a JSON object.");
    }

    const baseConfig = buildDefaultConfig();
    const config = {
        ...baseConfig,
        ...rawConfig,
    };

    if (config.mode !== "hosted" && config.mode !== "self_hosted") {
        throw new Error(`Unsupported companion mode: ${String(config.mode)}`);
    }

    const normalized = {
        mode: config.mode,
        bridgePort: parsePort(String(config.bridgePort), baseConfig.bridgePort, "bridgePort"),
        managementPort: parsePort(
            String(config.managementPort),
            baseConfig.managementPort,
            "managementPort"
        ),
        dashboardPort: parsePort(
            String(config.dashboardPort),
            baseConfig.dashboardPort,
            "dashboardPort"
        ),
        hostedApiBaseUrl: String(config.hostedApiBaseUrl),
        hostedRelayBaseUrl: String(config.hostedRelayBaseUrl),
    };

    if (typeof config.workspaceRoot === "string" && config.workspaceRoot.trim().length > 0) {
        const resolvedWorkspaceRoot = path.resolve(config.workspaceRoot.trim());
        const workspaceStats = statSync(resolvedWorkspaceRoot, { throwIfNoEntry: false });

        if (workspaceStats === undefined || !workspaceStats.isDirectory()) {
            throw new Error(`workspaceRoot must point to an existing directory. Received: ${resolvedWorkspaceRoot}`);
        }

        normalized.workspaceRoot = realpathSync(resolvedWorkspaceRoot);
    }

    if (
        typeof config.selfHostedRelayUrl === "string"
        && config.selfHostedRelayUrl.trim().length > 0
    ) {
        normalized.selfHostedRelayUrl = config.selfHostedRelayUrl.trim();
    }

    if (
        typeof config.selfHostedRelaySecret === "string"
        && config.selfHostedRelaySecret.trim().length > 0
    ) {
        normalized.selfHostedRelaySecret = config.selfHostedRelaySecret.trim();
    }

    if (
        typeof config.companionRegistrationCredential === "string"
        && config.companionRegistrationCredential.trim().length > 0
    ) {
        normalized.companionRegistrationCredential = config.companionRegistrationCredential.trim();
    }

    if (typeof config.companionId === "string" && config.companionId.trim().length > 0) {
        normalized.companionId = config.companionId.trim();
    }

    return normalized;
}

function applyDefaultHostedMigration(config) {
    const shouldMigrateHostedApi = config.hostedApiBaseUrl === LEGACY_DEFAULT_HOSTED_API_BASE_URL;
    const shouldMigrateHostedRelay = config.hostedRelayBaseUrl === LEGACY_DEFAULT_HOSTED_RELAY_BASE_URL;

    if (!shouldMigrateHostedApi && !shouldMigrateHostedRelay) {
        return false;
    }

    config.hostedApiBaseUrl = DEFAULT_HOSTED_API_BASE_URL;
    config.hostedRelayBaseUrl = deriveHostedRelayBaseUrl(DEFAULT_HOSTED_API_BASE_URL);
    delete config.companionRegistrationCredential;
    delete config.companionId;
    return true;
}

export function loadConfig() {
    ensureCompanionDirectories();
    const configPath = getCompanionConfigPath();

    if (!existsSync(configPath)) {
        const config = normalizeConfig({});
        writeConfig(config);
        return config;
    }

    try {
        const rawConfig = JSON.parse(readFileSync(configPath, "utf8"));
        const config = normalizeConfig(rawConfig);

        const migrated = applyDefaultHostedMigration(config);
        if (migrated || applyEnvironmentOverrides(config)) {
            writeConfig(config);
        }

        return config;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read companion config at ${configPath}: ${message}`);
    }
}

function applyEnvironmentOverrides(config) {
    let changed = false;

    const rawMode = process.env[MODE_ENV];
    if (rawMode === "hosted" || rawMode === "self_hosted") {
        config.mode = rawMode;
        changed = true;
    }

    const hostedApiBaseUrl = process.env[HOSTED_API_BASE_URL_ENV];
    if (typeof hostedApiBaseUrl === "string" && hostedApiBaseUrl.trim().length > 0) {
        config.hostedApiBaseUrl = hostedApiBaseUrl.trim().replace(/\/$/, "");
        changed = true;
    }

    const hostedRelayBaseUrl = process.env[HOSTED_RELAY_BASE_URL_ENV];
    if (typeof hostedRelayBaseUrl === "string" && hostedRelayBaseUrl.trim().length > 0) {
        config.hostedRelayBaseUrl = hostedRelayBaseUrl.trim().replace(/\/$/, "");
        changed = true;
    }

    const selfHostedRelayUrl = process.env[SELF_HOSTED_RELAY_URL_ENV];
    if (typeof selfHostedRelayUrl === "string" && selfHostedRelayUrl.trim().length > 0) {
        config.selfHostedRelayUrl = selfHostedRelayUrl.trim();
        changed = true;
    }

    const selfHostedRelaySecret = process.env[SELF_HOSTED_RELAY_SECRET_ENV];
    if (typeof selfHostedRelaySecret === "string" && selfHostedRelaySecret.trim().length > 0) {
        config.selfHostedRelaySecret = selfHostedRelaySecret.trim();
        changed = true;
    }

    const bridgePort = process.env.BRIDGE_PORT;
    if (typeof bridgePort === "string" && bridgePort.trim().length > 0) {
        const parsedPort = parsePort(bridgePort, config.bridgePort, "BRIDGE_PORT");
        config.bridgePort = parsedPort;
        config.managementPort = parsedPort;
        config.dashboardPort = parsedPort;
        changed = true;
    }

    return changed;
}

export function writeConfig(config) {
    ensureCompanionDirectories();
    const normalized = normalizeConfig(config);
    writeFileSync(getCompanionConfigPath(), JSON.stringify(normalized, null, 2));
    return normalized;
}

export function resolveWorkspaceRoot(currentWorkingDirectory) {
    return detectGitRoot(currentWorkingDirectory);
}

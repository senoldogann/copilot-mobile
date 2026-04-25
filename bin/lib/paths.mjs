import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIMARY_LAUNCH_AGENT_LABEL = "dev.senoldogan.codecompanion.bridge";
const LEGACY_LAUNCH_AGENT_LABEL = "com.copilotmobile.bridge";

function getPrimaryCompanionRootDirectory() {
    return path.join(os.homedir(), ".code-companion");
}

function getLegacyCompanionRootDirectory() {
    return path.join(os.homedir(), ".copilot-mobile");
}

export function getPackageRootDirectory() {
    const currentFilePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFilePath), "../..");
}

export function getCompanionRootDirectory() {
    return getPrimaryCompanionRootDirectory();
}

export function getReadableCompanionRootDirectory() {
    const primaryDirectory = getPrimaryCompanionRootDirectory();
    if (existsSync(primaryDirectory)) {
        return primaryDirectory;
    }

    const legacyDirectory = getLegacyCompanionRootDirectory();
    if (existsSync(legacyDirectory)) {
        return legacyDirectory;
    }

    return primaryDirectory;
}

export function getCompanionLogsDirectory() {
    return path.join(getCompanionRootDirectory(), "logs");
}

export function getReadableCompanionLogsDirectory() {
    return path.join(getReadableCompanionRootDirectory(), "logs");
}

export function getCompanionConfigPath() {
    return path.join(getCompanionRootDirectory(), "config.json");
}

export function getReadableCompanionConfigPath() {
    return path.join(getReadableCompanionRootDirectory(), "config.json");
}

export function getLaunchAgentPath() {
    return path.join(os.homedir(), "Library", "LaunchAgents", `${PRIMARY_LAUNCH_AGENT_LABEL}.plist`);
}

export function getLegacyLaunchAgentPath() {
    return path.join(os.homedir(), "Library", "LaunchAgents", `${LEGACY_LAUNCH_AGENT_LABEL}.plist`);
}

export function getLaunchAgentLabel() {
    return PRIMARY_LAUNCH_AGENT_LABEL;
}

export function getLegacyLaunchAgentLabel() {
    return LEGACY_LAUNCH_AGENT_LABEL;
}

export function getDaemonEntryPoint() {
    return path.join(getPackageRootDirectory(), "dist", "desktop", "bridge-daemon.mjs");
}

export function getDaemonStdoutPath() {
    return path.join(getCompanionLogsDirectory(), "daemon.stdout.log");
}

export function getDaemonStderrPath() {
    return path.join(getCompanionLogsDirectory(), "daemon.stderr.log");
}

export function ensureCompanionDirectories() {
    mkdirSync(getCompanionRootDirectory(), { recursive: true });
    mkdirSync(getCompanionLogsDirectory(), { recursive: true });
    mkdirSync(path.dirname(getLaunchAgentPath()), { recursive: true });
}

import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCH_AGENT_LABEL = "com.copilotmobile.bridge";

export function getPackageRootDirectory() {
    const currentFilePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFilePath), "../..");
}

export function getCompanionRootDirectory() {
    return path.join(os.homedir(), ".copilot-mobile");
}

export function getCompanionLogsDirectory() {
    return path.join(getCompanionRootDirectory(), "logs");
}

export function getCompanionConfigPath() {
    return path.join(getCompanionRootDirectory(), "config.json");
}

export function getLaunchAgentPath() {
    return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

export function getLaunchAgentLabel() {
    return LAUNCH_AGENT_LABEL;
}

export function getDaemonEntryPoint() {
    return path.join(getPackageRootDirectory(), "dist", "desktop", "bridge-daemon.cjs");
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

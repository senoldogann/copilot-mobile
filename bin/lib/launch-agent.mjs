import { execFileSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import {
    ensureCompanionDirectories,
    getCompanionConfigPath,
    getCompanionLogsDirectory,
    getCompanionRootDirectory,
    getDaemonEntryPoint,
    getDaemonStderrPath,
    getDaemonStdoutPath,
    getLegacyLaunchAgentLabel,
    getLegacyLaunchAgentPath,
    getLaunchAgentLabel,
    getLaunchAgentPath,
} from "./paths.mjs";

const COMMON_COPILOT_CLI_PATHS = [
    "/opt/homebrew/bin/copilot",
    "/usr/local/bin/copilot",
];

function getLaunchctlDomain() {
    const uid = process.getuid?.();
    if (typeof uid !== "number") {
        throw new Error("Code Companion currently supports macOS user sessions only.");
    }

    return `gui/${uid}`;
}

function runLaunchctl(args, allowFailure) {
    try {
        execFileSync("launchctl", args, { stdio: "pipe" });
        return true;
    } catch (error) {
        if (allowFailure) {
            return false;
        }

        const stderr = error instanceof Error && "stderr" in error
            ? String(error.stderr ?? "")
            : "";
        throw new Error(`launchctl ${args.join(" ")} failed. ${stderr}`.trim());
    }
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function resolvePreferredCopilotCliPath() {
    const configuredPath = process.env.COPILOT_CLI_PATH;
    if (typeof configuredPath === "string" && configuredPath.trim().length > 0) {
        const resolvedPath = configuredPath.trim();
        const stats = statSync(resolvedPath, { throwIfNoEntry: false });
        if (stats?.isFile()) {
            return resolvedPath;
        }
    }

    for (const candidatePath of COMMON_COPILOT_CLI_PATHS) {
        const stats = statSync(candidatePath, { throwIfNoEntry: false });
        if (stats?.isFile()) {
            return candidatePath;
        }
    }

    try {
        const resolvedPath = execFileSync("which", ["copilot"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return resolvedPath.length > 0 ? resolvedPath : null;
    } catch {
        return null;
    }
}

export function writeLaunchAgentPlist(workspaceRoot) {
    ensureCompanionDirectories();
    const workingDirectory = typeof workspaceRoot === "string" && workspaceRoot.length > 0
        ? workspaceRoot
        : getCompanionRootDirectory();
    const workspaceRootEnvironment = typeof workspaceRoot === "string" && workspaceRoot.length > 0
        ? [
            `\n        <key>CODE_COMPANION_WORKSPACE_ROOT</key>\n        <string>${workspaceRoot}</string>`,
            `\n        <key>COPILOT_MOBILE_WORKSPACE_ROOT</key>\n        <string>${workspaceRoot}</string>`,
        ].join("")
        : "";
    const copilotCliPath = resolvePreferredCopilotCliPath();
    const copilotCliEnvironment = typeof copilotCliPath === "string" && copilotCliPath.length > 0
        ? `\n        <key>COPILOT_CLI_PATH</key>\n        <string>${copilotCliPath}</string>`
        : "";

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${getLaunchAgentLabel()}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${getDaemonEntryPoint()}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CODE_COMPANION_CONFIG_PATH</key>
        <string>${getCompanionConfigPath()}</string>
        <key>CODE_COMPANION_LOGS_DIR</key>
        <string>${getCompanionLogsDirectory()}</string>
        <key>COPILOT_MOBILE_CONFIG_PATH</key>
        <string>${getCompanionConfigPath()}</string>
        <key>COPILOT_MOBILE_LOGS_DIR</key>
        <string>${getCompanionLogsDirectory()}</string>${copilotCliEnvironment}${workspaceRootEnvironment}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${workingDirectory}</string>
    <key>StandardOutPath</key>
    <string>${getDaemonStdoutPath()}</string>
    <key>StandardErrorPath</key>
    <string>${getDaemonStderrPath()}</string>
</dict>
</plist>
`;

    writeFileSync(getLaunchAgentPath(), plistContent, { mode: 0o644 });
    return getLaunchAgentPath();
}

export async function bootstrapLaunchAgent() {
    const domain = getLaunchctlDomain();
    const plistPath = getLaunchAgentPath();
    const legacyPlistPath = getLegacyLaunchAgentPath();

    let bootstrapError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        runLaunchctl(["bootout", domain, plistPath], true);
        runLaunchctl(["bootout", domain, legacyPlistPath], true);
        try {
            runLaunchctl(["bootstrap", domain, plistPath], false);
            bootstrapError = null;
            break;
        } catch (error) {
            bootstrapError = error;
            await sleep(500 * (attempt + 1));
        }
    }

    if (bootstrapError !== null) {
        throw bootstrapError;
    }

    runLaunchctl(["kickstart", "-k", `${domain}/${getLaunchAgentLabel()}`], true);
    runLaunchctl(["kickstart", "-k", `${domain}/${getLegacyLaunchAgentLabel()}`], true);
}

export function bootoutLaunchAgent() {
    const domain = getLaunchctlDomain();
    const plistPath = getLaunchAgentPath();
    const legacyPlistPath = getLegacyLaunchAgentPath();
    const hasPrimaryPlist = existsSync(plistPath);
    const hasLegacyPlist = existsSync(legacyPlistPath);

    if (!hasPrimaryPlist && !hasLegacyPlist) {
        return false;
    }

    const primaryResult = hasPrimaryPlist
        ? runLaunchctl(["bootout", domain, plistPath], true)
        : false;
    const legacyResult = hasLegacyPlist
        ? runLaunchctl(["bootout", domain, legacyPlistPath], true)
        : false;

    return primaryResult || legacyResult;
}

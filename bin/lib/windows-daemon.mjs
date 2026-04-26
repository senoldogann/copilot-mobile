import {
    closeSync,
    existsSync,
    openSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";
import {
    ensureCompanionDirectories,
    getCompanionConfigPath,
    getCopilotCliWrapperPath,
    getCompanionLogsDirectory,
    getCompanionRootDirectory,
    getDaemonEntryPoint,
    getDaemonPidPath,
    getDaemonStderrPath,
    getDaemonStdoutPath,
} from "./paths.mjs";
import { resolvePreferredCopilotCliPath } from "./launch-agent.mjs";

function parsePid(rawPid) {
    const parsedPid = Number.parseInt(rawPid, 10);
    return Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null;
}

export function readWindowsDaemonPid() {
    if (!existsSync(getDaemonPidPath())) {
        return null;
    }

    const pid = parsePid(readFileSync(getDaemonPidPath(), "utf8").trim());
    if (pid === null) {
        unlinkWindowsDaemonPidFile();
    }
    return pid;
}

export function unlinkWindowsDaemonPidFile() {
    try {
        unlinkSync(getDaemonPidPath());
    } catch {}
}

export function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function getWindowsDaemonPidStatus() {
    const pid = readWindowsDaemonPid();
    if (pid === null) {
        return { pid: null, running: false };
    }

    const running = isProcessRunning(pid);
    if (!running) {
        unlinkWindowsDaemonPidFile();
    }

    return { pid, running };
}

export function startWindowsDaemon(workspaceRoot) {
    ensureCompanionDirectories();

    const stdoutFd = openSync(getDaemonStdoutPath(), "a");
    const stderrFd = openSync(getDaemonStderrPath(), "a");
    const copilotCliPath = resolvePreferredCopilotCliPath();
    const workingDirectory =
        typeof workspaceRoot === "string" && workspaceRoot.length > 0
            ? workspaceRoot
            : getCompanionRootDirectory();

    try {
        const child = spawn(process.execPath, [getDaemonEntryPoint()], {
            cwd: workingDirectory,
            env: {
                ...process.env,
                CODE_COMPANION_CONFIG_PATH: getCompanionConfigPath(),
                CODE_COMPANION_LOGS_DIR: getCompanionLogsDirectory(),
                CODE_COMPANION_COPILOT_WRAPPER_PATH: getCopilotCliWrapperPath(),
                COPILOT_DISABLE_TERMINAL_TITLE: "1",
                COPILOT_MOBILE_CONFIG_PATH: getCompanionConfigPath(),
                COPILOT_MOBILE_LOGS_DIR: getCompanionLogsDirectory(),
                ...(typeof copilotCliPath === "string" && copilotCliPath.length > 0
                    ? { COPILOT_CLI_PATH: copilotCliPath }
                    : {}),
                ...(typeof workspaceRoot === "string" && workspaceRoot.length > 0
                    ? {
                        CODE_COMPANION_WORKSPACE_ROOT: workspaceRoot,
                        COPILOT_MOBILE_WORKSPACE_ROOT: workspaceRoot,
                    }
                    : {}),
            },
            detached: true,
            stdio: ["ignore", stdoutFd, stderrFd],
            windowsHide: true,
        });

        child.unref();
        writeFileSync(getDaemonPidPath(), `${child.pid}\n`);
        return child.pid;
    } finally {
        closeSync(stdoutFd);
        closeSync(stderrFd);
    }
}

export function stopWindowsDaemon(statusPayload) {
    const payloadPid = parsePid(String(statusPayload?.status?.pid ?? ""));
    const pid = payloadPid ?? readWindowsDaemonPid();
    if (pid === null) {
        unlinkWindowsDaemonPidFile();
        return false;
    }

    try {
        process.kill(pid);
        return true;
    } catch {
        unlinkWindowsDaemonPidFile();
        return false;
    }
}

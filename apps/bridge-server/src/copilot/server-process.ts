import { spawn } from "node:child_process";
import process from "node:process";
import { resolveCopilotClientLaunchOptions } from "./client.js";

const DEFAULT_COPILOT_SERVER_START_TIMEOUT_MS = 15_000;
const DEFAULT_COPILOT_SERVER_STOP_TIMEOUT_MS = 5_000;
const LISTENING_PORT_PATTERN = /listening on port (\d+)/i;

export type ManagedCopilotServer = {
    cliUrl: string;
    displayPath: string;
    pid: number | undefined;
    shutdown(): Promise<void>;
};

type ManagedCopilotServerOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logLevel?: string;
    port?: number;
    platform?: NodeJS.Platform;
    startupTimeoutMs?: number;
    onStderr?: (chunk: string) => void;
    onUnexpectedExit?: (error: Error) => void;
};

export function shouldUseManagedCopilotServer(
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform === "win32";
}

export function buildManagedCopilotServerSpawnSpec(
    options: ManagedCopilotServerOptions = {}
): {
    command: string;
    args: Array<string>;
    cwd: string;
    env: NodeJS.ProcessEnv;
    displayPath: string;
} {
    const launchOptions = resolveCopilotClientLaunchOptions({
        ...((options.platform ?? undefined) !== undefined ? { platform: options.platform } : {}),
    });
    if (launchOptions === undefined) {
        throw new Error("No Copilot CLI runtime could be resolved for the managed server.");
    }

    const env = { ...(options.env ?? process.env) };
    delete env.NODE_DEBUG;
    if (env.COPILOT_DISABLE_TERMINAL_TITLE === undefined) {
        env.COPILOT_DISABLE_TERMINAL_TITLE = "1";
    }

    return {
        command: launchOptions.cliPath,
        args: [
            ...(launchOptions.cliArgs ?? []),
            "--headless",
            "--no-auto-update",
            "--log-level",
            options.logLevel ?? "debug",
            "--port",
            String(options.port ?? 0),
        ],
        cwd: options.cwd ?? process.cwd(),
        env,
        displayPath: launchOptions.displayPath,
    };
}

async function waitForChildExit(
    child: ReturnType<typeof spawn>,
    timeoutMs: number
): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    await new Promise<void>((resolve) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            timeoutHandle = null;
            resolve();
        }, timeoutMs);

        child.once("exit", () => {
            if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
            }
            resolve();
        });
    });
}

export async function startManagedCopilotServer(
    options: ManagedCopilotServerOptions = {}
): Promise<ManagedCopilotServer | null> {
    if (!shouldUseManagedCopilotServer(options.platform)) {
        return null;
    }

    const spawnSpec = buildManagedCopilotServerSpawnSpec(options);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: spawnSpec.cwd,
        env: spawnSpec.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    let startupFinished = false;
    let shuttingDown = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const appendStderr = (chunk: string): void => {
        stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8_000);
        options.onStderr?.(chunk);
    };

    const buildExitError = (reason: string): Error => {
        const stderrSuffix = stderrBuffer.trim().length > 0
            ? `\n${stderrBuffer.trim()}`
            : "";
        return new Error(`[copilot] ${reason}${stderrSuffix}`);
    };

    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (childStdout === null || childStderr === null) {
        throw new Error("[copilot] Failed to capture Copilot CLI server stdio.");
    }

    childStderr.on("data", (data: Buffer | string) => {
        appendStderr(data.toString());
    });

    return await new Promise<ManagedCopilotServer>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            if (startupFinished) {
                return;
            }

            startupFinished = true;
            shuttingDown = true;
            try {
                if (typeof child.pid === "number") {
                    process.kill(child.pid);
                }
            } catch {}
            reject(buildExitError("Copilot CLI server did not become ready in time."));
        }, options.startupTimeoutMs ?? DEFAULT_COPILOT_SERVER_START_TIMEOUT_MS);

        const handleFailure = (error: Error): void => {
            if (startupFinished) {
                return;
            }

            startupFinished = true;
            clearTimeout(timeoutHandle);
            shuttingDown = true;
            try {
                if (typeof child.pid === "number" && child.exitCode === null && child.signalCode === null) {
                    process.kill(child.pid);
                }
            } catch {}
            reject(error);
        };

        child.on("error", (error) => {
            handleFailure(buildExitError(`Failed to start Copilot CLI server: ${error.message}`));
        });

        child.on("exit", (code, signal) => {
            const error = buildExitError(
                `Copilot CLI server exited before it became ready (code=${String(code)}, signal=${String(signal)}).`
            );

            if (!startupFinished) {
                handleFailure(error);
                return;
            }

            if (!shuttingDown) {
                options.onUnexpectedExit?.(error);
            }
        });

        childStdout.on("data", (data: Buffer | string) => {
            if (startupFinished) {
                return;
            }

            stdoutBuffer = `${stdoutBuffer}${data.toString()}`.slice(-8_000);
            const portMatch = stdoutBuffer.match(LISTENING_PORT_PATTERN);
            if (portMatch?.[1] === undefined) {
                return;
            }

            const port = Number.parseInt(portMatch[1], 10);
            if (!Number.isInteger(port) || port <= 0) {
                return;
            }

            startupFinished = true;
            clearTimeout(timeoutHandle);

            resolve({
                cliUrl: `127.0.0.1:${port}`,
                displayPath: spawnSpec.displayPath,
                pid: child.pid,
                async shutdown(): Promise<void> {
                    if (shuttingDown) {
                        await waitForChildExit(child, DEFAULT_COPILOT_SERVER_STOP_TIMEOUT_MS);
                        return;
                    }

                    shuttingDown = true;
                    if (child.exitCode !== null || child.signalCode !== null) {
                        return;
                    }

                    try {
                        if (typeof child.pid === "number") {
                            process.kill(child.pid);
                        }
                    } catch {}

                    await waitForChildExit(child, DEFAULT_COPILOT_SERVER_STOP_TIMEOUT_MS);
                },
            });
        });
    });
}

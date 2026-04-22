import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import QRCode from "qrcode";

const TUNNEL_RETRY_COUNT = 3;
const TUNNEL_RETRY_DELAY_MS = 2_000;
const DEFAULT_HOST = "tunnel";
const FALLBACK_HOST = "lan";
const DEFAULT_PORT = 8081;
const MAX_PORT = 8100;
const MOBILE_PROJECT_ROOT = path.resolve("/Users/dogan/Desktop/copilot-mobile", "apps/mobile");
const APP_CONFIG_PATH = path.join(MOBILE_PROJECT_ROOT, "app.json");
const require = createRequire(import.meta.url);

function sanitizeForwardedArgs(args) {
    return args.filter((arg, index) => !(index === 0 && arg === "--"));
}

function readFlagValue(args, flagName) {
    const inlinePrefix = `${flagName}=`;
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index];
        if (value === flagName) {
            return args[index + 1] ?? null;
        }
        if (value.startsWith(inlinePrefix)) {
            return value.slice(inlinePrefix.length);
        }
    }
    return null;
}

function removeFlag(args, flagName) {
    const inlinePrefix = `${flagName}=`;
    const nextArgs = [];

    for (let index = 0; index < args.length; index += 1) {
        const value = args[index];
        if (value === flagName) {
            index += 1;
            continue;
        }
        if (value.startsWith(inlinePrefix)) {
            continue;
        }
        nextArgs.push(value);
    }

    return nextArgs;
}

function isTunnelStartupFailure(output) {
    return /failed to start tunnel/i.test(output)
        || /remote gone away/i.test(output)
        || /ngrok/i.test(output);
}

function wait(delayMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

function parsePort(value) {
    if (value === null) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function isPortInUseError(error) {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "EADDRINUSE";
}

function isPortAvailable(port) {
    return new Promise((resolve, reject) => {
        const server = createServer();

        server.once("error", (error) => {
            server.close();
            if (isPortInUseError(error)) {
                resolve(false);
                return;
            }
            reject(error);
        });

        server.once("listening", () => {
            server.close(() => resolve(true));
        });

        server.listen(port);
    });
}

async function findAvailablePort(startPort) {
    for (let port = startPort; port <= MAX_PORT; port += 1) {
        const available = await isPortAvailable(port);
        if (available) {
            return port;
        }
    }

    throw new Error(`No free Metro port found between ${startPort} and ${MAX_PORT}.`);
}

function runExpoStart(host, args) {
    return new Promise((resolve) => {
        let qrPrinted = false;
        let qrPrintInFlight = false;
        const child = spawn(
            "pnpm",
            [
                "--filter",
                "@copilot-mobile/mobile",
                "exec",
                "expo",
                "start",
                "--dev-client",
                "--host",
                host,
                ...args,
            ],
            {
                stdio: ["inherit", "pipe", "pipe"],
                env: process.env,
            }
        );

        let output = "";

        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            output += text;
            process.stdout.write(chunk);
            if (!qrPrinted && !qrPrintInFlight) {
                qrPrintInFlight = true;
                maybePrintDevelopmentQr({
                    args,
                    host,
                    output,
                }).then((printed) => {
                    qrPrinted = printed;
                }).catch((error) => {
                    process.stderr.write(`\nCould not print development QR: ${error.message}\n`);
                }).finally(() => {
                    qrPrintInFlight = false;
                });
            }
        });

        child.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            output += text;
            process.stderr.write(chunk);
            if (!qrPrinted && !qrPrintInFlight) {
                qrPrintInFlight = true;
                maybePrintDevelopmentQr({
                    args,
                    host,
                    output,
                }).then((printed) => {
                    qrPrinted = printed;
                }).catch((error) => {
                    process.stderr.write(`\nCould not print development QR: ${error.message}\n`);
                }).finally(() => {
                    qrPrintInFlight = false;
                });
            }
        });

        child.on("exit", (code, signal) => {
            resolve({
                code: code ?? 1,
                signal,
                output,
            });
        });
    });
}

async function readAppScheme() {
    const raw = await readFile(APP_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const scheme = parsed?.expo?.scheme;

    if (typeof scheme !== "string" || scheme.length === 0) {
        throw new Error(`Missing Expo scheme in ${APP_CONFIG_PATH}.`);
    }

    return scheme;
}

function readSelectedPort(args) {
    const value = readFlagValue(args, "--port");
    const parsed = parsePort(value);

    if (parsed === null) {
        throw new Error("Missing --port argument while printing the development QR.");
    }

    return parsed;
}

async function createTunnelUrl(port) {
    const { AsyncNgrok } = require("@expo/cli/build/src/start/server/AsyncNgrok.js");
    const ngrok = new AsyncNgrok(MOBILE_PROJECT_ROOT, port);
    const hostname = await ngrok._getProjectHostnameAsync();
    return `https://${hostname}`;
}

async function createDevClientUrl(host, port) {
    const scheme = await readAppScheme();
    const { UrlCreator } = require("@expo/cli/build/src/start/server/UrlCreator.js");
    const bundlerInfo = {
        port,
        getTunnelUrl() {
            return null;
        },
    };

    if (host === "tunnel") {
        const tunnelUrl = await createTunnelUrl(port);
        bundlerInfo.getTunnelUrl = function getTunnelUrl() {
            return tunnelUrl;
        };
    }

    const urlCreator = await UrlCreator.init(
        {
            hostType: host,
            scheme,
        },
        bundlerInfo
    );
    const devClientUrl = urlCreator.constructDevClientUrl();

    if (devClientUrl === null) {
        throw new Error(`Could not create a development-client URL for host mode "${host}".`);
    }

    return devClientUrl;
}

function canPrintQr(host, output) {
    if (host === "tunnel") {
        return output.includes("Tunnel ready.");
    }

    return /Waiting on\s+http:\/\/localhost:\d+/i.test(output);
}

async function printDevelopmentQr(url) {
    const qr = await QRCode.toString(url, {
        type: "utf8",
    });

    process.stdout.write("\nScan this QR with your Copilot Mobile development build:\n\n");
    process.stdout.write(qr);
    process.stdout.write(`\nDevelopment URL:\n${url}\n\n`);
}

async function maybePrintDevelopmentQr({ args, host, output }) {
    if (!canPrintQr(host, output)) {
        return false;
    }

    const port = readSelectedPort(args);
    const devClientUrl = await createDevClientUrl(host, port);
    await printDevelopmentQr(devClientUrl);
    return true;
}

async function main() {
    const rawArgs = process.argv.slice(2);
    const forwardedArgs = sanitizeForwardedArgs(rawArgs);
    const explicitHost = readFlagValue(forwardedArgs, "--host");
    const explicitPort = parsePort(readFlagValue(forwardedArgs, "--port"));
    const host = explicitHost ?? process.env.COPILOT_MOBILE_DEV_HOST ?? DEFAULT_HOST;
    const baseArgs = removeFlag(removeFlag(forwardedArgs, "--host"), "--port");
    const selectedPort = explicitPort ?? await findAvailablePort(DEFAULT_PORT);
    const expoArgs = [...baseArgs, "--port", String(selectedPort)];
    const maxAttempts = host === "tunnel" ? TUNNEL_RETRY_COUNT : 1;

    if (selectedPort !== DEFAULT_PORT) {
        process.stdout.write(`Using Metro port ${selectedPort} because ${DEFAULT_PORT} is busy.\n`);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = await runExpoStart(host, expoArgs);

        if (typeof result.signal === "string") {
            process.kill(process.pid, result.signal);
            return;
        }

        if (result.code === 0) {
            process.exit(0);
        }

        const canRetryTunnel = host === "tunnel"
            && attempt < maxAttempts
            && isTunnelStartupFailure(result.output);

        if (!canRetryTunnel) {
            const shouldFallbackToLan = host === "tunnel" && isTunnelStartupFailure(result.output);

            if (shouldFallbackToLan) {
                process.stderr.write(
                    "\nExpo tunnel could not start after multiple attempts. " +
                    "Ngrok is usually the failing dependency here. " +
                    `Falling back to ${FALLBACK_HOST} mode automatically.\n\n`
                );

                const fallbackResult = await runExpoStart(FALLBACK_HOST, expoArgs);

                if (typeof fallbackResult.signal === "string") {
                    process.kill(process.pid, fallbackResult.signal);
                    return;
                }

                process.exit(fallbackResult.code);
            }

            process.exit(result.code);
        }

        process.stderr.write(
            `\nTunnel startup failed on attempt ${attempt}/${maxAttempts}. Retrying in ${TUNNEL_RETRY_DELAY_MS / 1000}s…\n`
        );
        await wait(TUNNEL_RETRY_DELAY_MS);
    }
}

await main();

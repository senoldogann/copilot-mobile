import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandInfo } from "@copilot-mobile/shared";

const COMMAND_BLOCK_ANCHOR = "\"/statusline\"";
const COMMAND_BLOCK_WINDOW_BEFORE = 1_200;
const COMMAND_BLOCK_WINDOW_AFTER = 4_000;
const COMMAND_ASSIGNMENT_REGEX = /([A-Za-z0-9$]+)="(\/[A-Za-z][A-Za-z0-9-]*)"/g;
const COPILOT_BUNDLE_RELATIVE_PATH = path.join("node_modules", "@github", "copilot", "app.js");

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeBundleString(value: string): string {
    try {
        return JSON.parse(`"${value.replace(/"/g, "\\\"")}"`) as string;
    } catch {
        return value;
    }
}

export function parseInteractiveCommandsFromBundle(bundleContent: string): ReadonlyArray<CommandInfo> {
    const anchorIndex = bundleContent.indexOf(COMMAND_BLOCK_ANCHOR);
    if (anchorIndex === -1) {
        return [];
    }

    const commandSlice = bundleContent.slice(
        Math.max(0, anchorIndex - COMMAND_BLOCK_WINDOW_BEFORE),
        Math.min(bundleContent.length, anchorIndex + COMMAND_BLOCK_WINDOW_AFTER)
    );

    const commandEntries = [...commandSlice.matchAll(COMMAND_ASSIGNMENT_REGEX)];
    if (commandEntries.length === 0) {
        return [];
    }

    const commands = new Map<string, CommandInfo>();
    for (const [, variableName, commandName] of commandEntries) {
        if (variableName === undefined || commandName === undefined) {
            continue;
        }

        const helpMatch = new RegExp(
            `name:${escapeRegExp(variableName)},help:"((?:\\\\.|[^"])*)"`,
        ).exec(bundleContent);

        commands.set(commandName, {
            name: commandName,
            description: helpMatch?.[1] !== undefined
                ? decodeBundleString(helpMatch[1])
                : "",
        });
    }

    return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function resolveInteractiveCommandsBundlePath(): string {
    let currentDirectory = path.dirname(fileURLToPath(import.meta.url));

    while (true) {
        const bundlePath = path.join(currentDirectory, COPILOT_BUNDLE_RELATIVE_PATH);
        if (existsSync(bundlePath)) {
            return bundlePath;
        }

        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            throw new Error("Could not locate @github/copilot/app.js from the bridge runtime.");
        }
        currentDirectory = parentDirectory;
    }
}

export async function listInteractiveCommands(): Promise<ReadonlyArray<CommandInfo>> {
    const bundlePath = resolveInteractiveCommandsBundlePath();
    const bundleContent = await readFile(bundlePath, "utf8");
    return parseInteractiveCommandsFromBundle(bundleContent);
}

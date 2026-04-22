import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";

import type { WorkspaceSearchMatch } from "@copilot-mobile/shared";

const HOME_DIRECTORY = resolve(homedir());
const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 24;
const MAX_SCAN_DEPTH = 3;
const MAX_CHILD_DIRECTORIES = 160;

function expandHomePath(input: string): string {
    if (input === "~") {
        return HOME_DIRECTORY;
    }

    if (input.startsWith("~/")) {
        return join(HOME_DIRECTORY, input.slice(2));
    }

    return input;
}

function toDisplayPath(absolutePath: string): string {
    if (absolutePath === HOME_DIRECTORY) {
        return "~";
    }

    if (absolutePath.startsWith(`${HOME_DIRECTORY}/`)) {
        return `~/${absolutePath.slice(HOME_DIRECTORY.length + 1)}`;
    }

    return absolutePath;
}

function isPathLikeQuery(query: string): boolean {
    return query.startsWith("~")
        || query.startsWith("/")
        || query.startsWith(".")
        || query.includes("/");
}

async function listChildDirectories(
    directoryPath: string
): Promise<ReadonlyArray<{ name: string; path: string }>> {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !entry.name.startsWith("."))
        .slice(0, MAX_CHILD_DIRECTORIES)
        .map((entry) => ({
            name: entry.name,
            path: join(directoryPath, entry.name),
        }));
}

async function findNearestExistingDirectory(rawPath: string): Promise<string> {
    let candidatePath = resolve(expandHomePath(rawPath));

    while (candidatePath !== dirname(candidatePath)) {
        try {
            await readdir(candidatePath);
            return candidatePath;
        } catch {
            candidatePath = dirname(candidatePath);
        }
    }

    return HOME_DIRECTORY;
}

async function searchByPathPrefix(
    query: string,
    limit: number
): Promise<ReadonlyArray<WorkspaceSearchMatch>> {
    const normalizedQuery = normalize(expandHomePath(query));
    const existingDirectory = await findNearestExistingDirectory(normalizedQuery);
    const remainder = normalizedQuery
        .slice(existingDirectory.length)
        .replace(/^[/\\]+/, "");
    const firstPendingSegment = remainder.split(/[\\/]/)[0] ?? "";
    const childDirectories = await listChildDirectories(existingDirectory);
    const loweredSegment = firstPendingSegment.toLowerCase();

    const matches = childDirectories
        .filter((entry) =>
            loweredSegment.length === 0
            || entry.name.toLowerCase().includes(loweredSegment)
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((entry) => ({
            path: entry.path,
            displayPath: toDisplayPath(entry.path),
            name: entry.name,
        }));

    if (matches.length > 0) {
        return matches;
    }

    if (normalizedQuery === existingDirectory) {
        return [{
            path: existingDirectory,
            displayPath: toDisplayPath(existingDirectory),
            name: basename(existingDirectory),
        }];
    }

    return [];
}

async function collectRecursiveMatches(
    rootPath: string,
    query: string,
    depth: number,
    limit: number,
    acc: Array<WorkspaceSearchMatch>
): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || acc.length >= limit) {
        return;
    }

    const childDirectories = await listChildDirectories(rootPath);

    for (const entry of childDirectories) {
        if (acc.length >= limit) {
            return;
        }

        if (entry.path.toLowerCase().includes(query)) {
            acc.push({
                path: entry.path,
                displayPath: toDisplayPath(entry.path),
                name: entry.name,
            });
        }

        await collectRecursiveMatches(entry.path, query, depth + 1, limit, acc);
    }
}

function getSearchRoots(): ReadonlyArray<string> {
    const roots = [
        join(HOME_DIRECTORY, "Desktop"),
        join(HOME_DIRECTORY, "Documents"),
        join(HOME_DIRECTORY, "Downloads"),
        join(HOME_DIRECTORY, "Projects"),
        HOME_DIRECTORY,
    ];

    return [...new Set(roots.map((rootPath) => resolve(rootPath)))];
}

export async function searchWorkspaceDirectories(
    query: string,
    requestedLimit: number | undefined
): Promise<ReadonlyArray<WorkspaceSearchMatch>> {
    const trimmedQuery = query.trim();
    const limit = Math.min(Math.max(requestedLimit ?? DEFAULT_RESULT_LIMIT, 1), MAX_RESULT_LIMIT);

    if (trimmedQuery.length === 0) {
        return getSearchRoots()
            .map((rootPath) => ({
                path: rootPath,
                displayPath: toDisplayPath(rootPath),
                name: basename(rootPath),
            }))
            .slice(0, limit);
    }

    if (isPathLikeQuery(trimmedQuery)) {
        const pathMatches = await searchByPathPrefix(trimmedQuery, limit);
        if (pathMatches.length > 0) {
            return pathMatches;
        }
    }

    const loweredQuery = trimmedQuery.toLowerCase();
    const matches: Array<WorkspaceSearchMatch> = [];

    for (const rootPath of getSearchRoots()) {
        if (!isAbsolute(rootPath)) {
            continue;
        }

        try {
            await collectRecursiveMatches(rootPath, loweredQuery, 0, limit, matches);
        } catch (error) {
            console.warn("[workspace-search] Root scan failed", {
                rootPath,
                error,
            });
            continue;
        }
    }

    return matches.slice(0, limit);
}

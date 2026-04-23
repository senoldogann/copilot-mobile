import { execFile } from "node:child_process";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
    GitBranchSummary,
    GitCommitSummary,
    GitFileChange,
    SessionContext,
    WorkspaceOperation,
    WorkspaceTreeNode,
} from "@copilot-mobile/shared";

const execFileAsync = promisify(execFile);
const MAX_TREE_ENTRIES_PER_DIRECTORY = 1000;
const DEFAULT_TREE_PAGE_SIZE = 200;
const MAX_WORKSPACE_TREE_DEPTH = 7;
const MAX_WORKSPACE_COMMIT_LIMIT = 50;
const MAX_WORKSPACE_RESOLVE_MATCHES = 10;
const MAX_WORKSPACE_SEARCH_LIMIT = 24;
const GIT_OPERATION_TIMEOUT_MS = 30_000;
const WORKSPACE_CANDIDATE_CACHE_TTL_MS = 5_000;
const MAX_WORKSPACE_CANDIDATE_CACHE_ENTRIES = 8;
const FALLBACK_RESOLVE_IGNORED_DIRS = new Set([".git", "node_modules", "Pods", "build", "dist", ".expo"]);

type GitCommandResult = {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode?: number | undefined;
    signal?: string | null | undefined;
    message?: string | undefined;
};

type WorkspaceCandidateCacheEntry = {
    candidates: ReadonlyArray<string>;
    expiresAt: number;
};

const workspaceCandidateCache = new Map<string, WorkspaceCandidateCacheEntry>();

function readCachedWorkspaceCandidates(rootPath: string): ReadonlyArray<string> | null {
    const cached = workspaceCandidateCache.get(rootPath);
    if (cached === undefined) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        workspaceCandidateCache.delete(rootPath);
        return null;
    }

    return cached.candidates;
}

function writeCachedWorkspaceCandidates(
    rootPath: string,
    candidates: ReadonlyArray<string>
): ReadonlyArray<string> {
    workspaceCandidateCache.delete(rootPath);
    workspaceCandidateCache.set(rootPath, {
        candidates,
        expiresAt: Date.now() + WORKSPACE_CANDIDATE_CACHE_TTL_MS,
    });

    while (workspaceCandidateCache.size > MAX_WORKSPACE_CANDIDATE_CACHE_ENTRIES) {
        const oldestRootPath = workspaceCandidateCache.keys().next().value;
        if (typeof oldestRootPath !== "string") {
            break;
        }
        workspaceCandidateCache.delete(oldestRootPath);
    }

    return candidates;
}

export function resolveWorkspaceRoot(context: SessionContext): string {
    return resolve(context.workspaceRoot);
}

export function resolveSessionCwd(context: SessionContext): string {
    return resolve(context.sessionCwd);
}

function toPosixRelativePath(rootPath: string, absolutePath: string): string {
    const rel = relative(rootPath, absolutePath);
    if (rel.length === 0) {
        return ".";
    }

    return rel.split(sep).join("/");
}

function mapGitPathToWorkspacePath(
    workspaceRoot: string,
    gitRoot: string,
    gitPath: string
): string | null {
    const absolutePath = resolve(gitRoot, gitPath);
    if (!isWithinRoot(workspaceRoot, absolutePath)) {
        return null;
    }

    return toPosixRelativePath(workspaceRoot, absolutePath);
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
    const rel = relative(resolve(rootPath), resolve(candidatePath));
    return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

function stripLineSuffix(rawPath: string): string {
    return rawPath.replace(/:\d+(-\d+)?$/, "");
}

function normalizeWorkspaceReference(rawPath: string): string {
    return stripLineSuffix(rawPath.trim()).replace(/\\/g, "/");
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch {
        return false;
    }
}

function candidateFromAbsolutePath(rootPath: string, absolutePath: string): string | null {
    if (!isWithinRoot(rootPath, absolutePath)) {
        return null;
    }

    return toPosixRelativePath(rootPath, absolutePath);
}

function candidateFromSessionPath(
    rootPath: string,
    sessionCwd: string,
    rawPath: string
): string | null {
    if (rawPath.startsWith("./") || rawPath.startsWith("../")) {
        return candidateFromAbsolutePath(rootPath, resolve(sessionCwd, rawPath));
    }

    return null;
}

function candidateFromWorkspaceNamePrefix(rootPath: string, rawPath: string): string | null {
    const workspaceName = basename(rootPath);
    if (workspaceName.length === 0 || !rawPath.startsWith(`${workspaceName}/`)) {
        return null;
    }

    const trimmed = rawPath.slice(workspaceName.length + 1);
    return trimmed.length > 0 ? trimmed : ".";
}

function shouldSearchBySuffix(rawPath: string): boolean {
    return rawPath.startsWith(".../") || rawPath.startsWith("…/");
}

async function listWorkspaceCandidatesFromFilesystem(
    rootPath: string,
    currentPath: string
): Promise<Array<string>> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const candidates: Array<string> = [];

    for (const entry of entries) {
        if (entry.name === ".git") {
            continue;
        }

        const nextPath = resolve(currentPath, entry.name);
        if (!isWithinRoot(rootPath, nextPath)) {
            continue;
        }

        if (entry.isDirectory()) {
            if (FALLBACK_RESOLVE_IGNORED_DIRS.has(entry.name)) {
                continue;
            }
            candidates.push(...await listWorkspaceCandidatesFromFilesystem(rootPath, nextPath));
            continue;
        }

        if (entry.isFile() || entry.isSymbolicLink()) {
            candidates.push(toPosixRelativePath(rootPath, nextPath));
        }
    }

    return candidates;
}

async function listWorkspaceCandidates(rootPath: string): Promise<ReadonlyArray<string>> {
    const cached = readCachedWorkspaceCandidates(rootPath);
    if (cached !== null) {
        return cached;
    }

    const gitResult = await runGit(rootPath, ["ls-files", "--cached", "--others", "--exclude-standard"]);
    if (gitResult.success) {
        return writeCachedWorkspaceCandidates(
            rootPath,
            gitResult.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        );
    }

    return writeCachedWorkspaceCandidates(
        rootPath,
        await listWorkspaceCandidatesFromFilesystem(rootPath, rootPath)
    );
}

function matchWorkspaceCandidates(
    candidates: ReadonlyArray<string>,
    rawPath: string
): Array<string> {
    const normalizedPath = normalizeWorkspaceReference(rawPath);
    const suffix = shouldSearchBySuffix(normalizedPath)
        ? normalizedPath.slice(4)
        : normalizedPath;

    if (suffix.length === 0) {
        return [];
    }

    return candidates.filter((candidate) =>
        candidate === suffix || candidate.endsWith(`/${suffix}`)
    );
}

function candidateMatchesWorkspaceSearch(candidate: string, normalizedQuery: string): boolean {
    if (normalizedQuery.length === 0) {
        return true;
    }

    const loweredCandidate = candidate.toLowerCase();
    if (loweredCandidate.includes(normalizedQuery)) {
        return true;
    }

    const fileName = basename(loweredCandidate);
    return fileName.includes(normalizedQuery);
}

function scoreWorkspaceSearchCandidate(candidate: string, normalizedQuery: string): number {
    if (normalizedQuery.length === 0) {
        return 0;
    }

    const loweredCandidate = candidate.toLowerCase();
    const fileName = basename(loweredCandidate);
    if (fileName === normalizedQuery) {
        return 0;
    }

    if (fileName.startsWith(normalizedQuery)) {
        return 1;
    }

    if (loweredCandidate.startsWith(normalizedQuery)) {
        return 2;
    }

    if (fileName.includes(normalizedQuery)) {
        return 3;
    }

    return 4;
}

export async function searchWorkspaceFiles(
    context: SessionContext,
    query: string,
    requestedLimit: number | undefined
): Promise<ReadonlyArray<{
    path: string;
    displayPath: string;
    name: string;
}>> {
    const rootPath = resolveWorkspaceRoot(context);
    const normalizedLimit = Math.min(
        Math.max(requestedLimit ?? 12, 1),
        MAX_WORKSPACE_SEARCH_LIMIT
    );
    const normalizedQuery = normalizeWorkspaceReference(query).toLowerCase();
    const candidates = await listWorkspaceCandidates(rootPath);

    return [...new Set(candidates)]
        .filter((candidate) => candidateMatchesWorkspaceSearch(candidate, normalizedQuery))
        .sort((left, right) => {
            const scoreDelta = scoreWorkspaceSearchCandidate(left, normalizedQuery)
                - scoreWorkspaceSearchCandidate(right, normalizedQuery);
            if (scoreDelta !== 0) {
                return scoreDelta;
            }

            return left.localeCompare(right);
        })
        .slice(0, normalizedLimit)
        .map((candidate) => ({
            path: candidate,
            displayPath: candidate,
            name: basename(candidate),
        }));
}

export async function resolveWorkspaceReference(
    context: SessionContext,
    rawPath: string
): Promise<{
    workspaceRelativePath?: string;
    matches?: ReadonlyArray<string>;
    error?: string;
}> {
    const rootPath = resolveWorkspaceRoot(context);
    const sessionCwd = resolveSessionCwd(context);
    const normalizedPath = normalizeWorkspaceReference(rawPath);

    if (normalizedPath.length === 0) {
        return { error: "Path is empty" };
    }

    const directCandidates = [
        isAbsolute(normalizedPath) ? candidateFromAbsolutePath(rootPath, normalizedPath) : null,
        candidateFromSessionPath(rootPath, sessionCwd, normalizedPath),
        candidateFromWorkspaceNamePrefix(rootPath, normalizedPath),
        !shouldSearchBySuffix(normalizedPath) ? normalizedPath : null,
    ];

    for (const candidate of directCandidates) {
        if (candidate === null || candidate.length === 0) {
            continue;
        }

        const absoluteCandidate = resolve(rootPath, candidate);
        if (!isWithinRoot(rootPath, absoluteCandidate)) {
            continue;
        }

        if (await pathExists(absoluteCandidate)) {
            return {
                workspaceRelativePath: toPosixRelativePath(rootPath, absoluteCandidate),
            };
        }
    }

    const matches = matchWorkspaceCandidates(await listWorkspaceCandidates(rootPath), normalizedPath);
    if (matches.length === 1) {
        const matchedPath = matches[0];
        if (matchedPath !== undefined) {
            return { workspaceRelativePath: matchedPath };
        }
    }

    if (matches.length > 1) {
        return {
            matches: matches.slice(0, MAX_WORKSPACE_RESOLVE_MATCHES),
            error: `Ambiguous workspace path: ${normalizedPath}`,
        };
    }

    return { error: `File not found in workspace: ${normalizedPath}` };
}

function normalizeGitStatus(indexStatus: string, worktreeStatus: string): GitFileChange["status"] {
    const combined = `${indexStatus}${worktreeStatus}`;
    if (indexStatus === "?" || worktreeStatus === "?") {
        return "untracked";
    }
    if (
        indexStatus === "U"
        || worktreeStatus === "U"
        || combined === "AA"
        || combined === "DD"
        || combined === "AU"
        || combined === "UA"
        || combined === "UD"
        || combined === "DU"
        || combined === "UU"
    ) {
        return "conflicted";
    }
    if (indexStatus === "R" || worktreeStatus === "R") {
        return "renamed";
    }
    if (indexStatus === "C" || worktreeStatus === "C") {
        return "copied";
    }
    if (indexStatus === "T" || worktreeStatus === "T") {
        return "type_changed";
    }
    if (indexStatus === "A" || worktreeStatus === "A") {
        return "added";
    }
    if (indexStatus === "D" || worktreeStatus === "D") {
        return "deleted";
    }
    if (indexStatus === "M" || worktreeStatus === "M") {
        return "modified";
    }

    return "unknown";
}

async function runGit(cwd: string, args: ReadonlyArray<string>): Promise<GitCommandResult> {
    try {
        const { stdout, stderr } = await execFileAsync("git", [...args], {
            cwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: GIT_OPERATION_TIMEOUT_MS,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: "0",
                GIT_OPTIONAL_LOCKS: "0",
            },
        });

        return {
            success: true,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
        };
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
            stdout?: string | Buffer;
            stderr?: string | Buffer;
            code?: number | string;
            signal?: NodeJS.Signals | null;
        };

        return {
            success: false,
            stdout: execError.stdout?.toString() ?? "",
            stderr: execError.stderr?.toString() ?? "",
            ...(typeof execError.code === "number" ? { exitCode: execError.code } : {}),
            signal: execError.signal ?? null,
            message: execError.message,
        };
    }
}

async function buildTreeNode(
    rootPath: string,
    absolutePath: string,
    depthRemaining: number,
    requestedAbsolutePath: string,
    requestedOffset: number,
    pageSize: number
): Promise<{ node: WorkspaceTreeNode; truncated: boolean }> {
    const stats = await lstat(absolutePath);
    const relativePath = toPosixRelativePath(rootPath, absolutePath);
    const name = relativePath === "."
        ? basename(rootPath) || rootPath
        : basename(absolutePath);

    if (stats.isDirectory()) {
        if (depthRemaining <= 0) {
            return {
                node: {
                    name,
                    path: relativePath,
                    type: "directory",
                    modifiedAt: stats.mtimeMs,
                    totalChildren: 0,
                },
                truncated: true,
            };
        }

        const entries = await readdir(absolutePath, { withFileTypes: true });
        entries.sort((left, right) => {
            if (left.isDirectory() && !right.isDirectory()) return -1;
            if (!left.isDirectory() && right.isDirectory()) return 1;
            return left.name.localeCompare(right.name);
        });

        const filteredEntries = entries.filter((entry) => entry.name !== ".git");
        const currentOffset = absolutePath === requestedAbsolutePath ? requestedOffset : 0;
        const boundedOffset = Math.min(Math.max(0, currentOffset), filteredEntries.length);
        const pagedEntries = filteredEntries.slice(boundedOffset, boundedOffset + pageSize);
        const hasMoreChildren = boundedOffset + pagedEntries.length < filteredEntries.length;

        const children: Array<WorkspaceTreeNode> = [];
        let truncated = false;

        for (const entry of pagedEntries) {
            const childPath = resolve(absolutePath, entry.name);
            if (!isWithinRoot(rootPath, childPath)) {
                continue;
            }

            const childStats = await lstat(childPath);
            const childRelativePath = toPosixRelativePath(rootPath, childPath);
            const childName = entry.name;

            if (childStats.isDirectory()) {
                const childResult = await buildTreeNode(
                    rootPath,
                    childPath,
                    depthRemaining - 1,
                    requestedAbsolutePath,
                    requestedOffset,
                    pageSize
                );
                children.push(childResult.node);
                truncated ||= childResult.truncated;
                continue;
            }

            children.push({
                name: childName,
                path: childRelativePath,
                type: childStats.isSymbolicLink() ? "symlink" : "file",
                size: childStats.isFile() ? childStats.size : undefined,
                modifiedAt: childStats.mtimeMs,
            });
        }

        truncated ||= hasMoreChildren;

        return {
            node: {
                name,
                path: relativePath,
                type: "directory",
                modifiedAt: stats.mtimeMs,
                totalChildren: filteredEntries.length,
                ...(hasMoreChildren ? { nextOffset: boundedOffset + pagedEntries.length } : {}),
                children,
            },
            truncated,
        };
    }

    return {
        node: {
            name,
            path: relativePath,
            type: stats.isSymbolicLink() ? "symlink" : "file",
            size: stats.isFile() ? stats.size : undefined,
            modifiedAt: stats.mtimeMs,
        },
        truncated: false,
    };
}

function parseGitStatusLine(line: string): GitFileChange | null {
    if (line.startsWith("?? ")) {
        const path = line.slice(3);
        if (path.length === 0) {
            return null;
        }

        return {
            path,
            status: "untracked",
            indexStatus: "?",
            worktreeStatus: "?",
        };
    }

    if (line.length < 3) {
        return null;
    }

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const remainder = line.slice(3);
    if (remainder.length === 0) {
        return null;
    }

    const arrowIndex = remainder.indexOf(" -> ");
    if (arrowIndex !== -1) {
        const originalPath = remainder.slice(0, arrowIndex).trim();
        const path = remainder.slice(arrowIndex + 4).trim();

        return {
            path,
            originalPath: originalPath.length > 0 ? originalPath : undefined,
            status: normalizeGitStatus(indexStatus, worktreeStatus),
            indexStatus,
            worktreeStatus,
        };
    }

    return {
        path: remainder,
        status: normalizeGitStatus(indexStatus, worktreeStatus),
        indexStatus,
        worktreeStatus,
    };
}

function parseGitLog(stdout: string): Array<GitCommitSummary> {
    const records = stdout.split("\u001e").filter((entry) => entry.length > 0);

    return records.flatMap((record) => {
        const [headerLine = "", ...fileLines] = record.split(/\r?\n/);
        if (headerLine.length === 0) {
            return [];
        }

        const [hash = "", timestamp = "", author = "", subject = ""] = headerLine.split("\u001f");
        if (hash.length === 0) {
            return [];
        }

        return [{
            hash,
            shortHash: hash.slice(0, 7),
            subject,
            author,
            committedAt: Number.parseInt(timestamp, 10) * 1000,
            files: fileLines.filter((line) => line.length > 0),
        }];
    });
}

function parseGitBranches(stdout: string, currentBranch: string | undefined): Array<GitBranchSummary> {
    const branches = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const [name = "", headFlag = ""] = line.split("\t");
            const current = headFlag.trim() === "*" || (currentBranch !== undefined && name === currentBranch);
            return name.length > 0 ? { name, current } : null;
        })
        .filter((branch): branch is GitBranchSummary => branch !== null)
        .sort((left, right) => {
            if (left.current && !right.current) return -1;
            if (!left.current && right.current) return 1;
            return left.name.localeCompare(right.name);
        });

    if (branches.length > 0) {
        return branches;
    }

    if (currentBranch !== undefined && currentBranch.length > 0) {
        return [{ name: currentBranch, current: true }];
    }

    return [];
}

export async function buildWorkspaceTree(
    rootPath: string,
    requestedWorkspaceRelativePath = ".",
    maxDepth = 3,
    offset = 0,
    pageSize = DEFAULT_TREE_PAGE_SIZE
): Promise<{
    workspaceRoot: string;
    requestedWorkspaceRelativePath: string;
    tree: WorkspaceTreeNode;
    truncated: boolean;
}> {
    const normalizedDepth = Math.min(Math.max(0, maxDepth), MAX_WORKSPACE_TREE_DEPTH);
    const normalizedPageSize = Math.min(
        Math.max(1, pageSize),
        MAX_TREE_ENTRIES_PER_DIRECTORY
    );
    const absolutePath = resolve(rootPath, requestedWorkspaceRelativePath);
    if (!isWithinRoot(rootPath, absolutePath)) {
        throw new Error(`Requested path is outside the workspace root: ${requestedWorkspaceRelativePath}`);
    }

    const tree = await buildTreeNode(
        rootPath,
        absolutePath,
        normalizedDepth,
        absolutePath,
        offset,
        normalizedPageSize
    );
    return {
        workspaceRoot: resolve(rootPath),
        requestedWorkspaceRelativePath: toPosixRelativePath(rootPath, absolutePath),
        tree: tree.node,
        truncated: tree.truncated,
    };
}

function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        const [addStr, delStr, ...rest] = line.split("\t");
        if (addStr === undefined || delStr === undefined || rest.length === 0) continue;
        const path = rest.join("\t");
        if (path.length === 0) continue;
        // Binary files show "-\t-\t" — skip counts
        const additions = addStr === "-" ? 0 : Number.parseInt(addStr, 10);
        const deletions = delStr === "-" ? 0 : Number.parseInt(delStr, 10);
        if (Number.isNaN(additions) || Number.isNaN(deletions)) continue;
        const arrowIndex = path.indexOf(" => ");
        const finalPath = arrowIndex === -1 ? path : path.slice(arrowIndex + 4).replace(/[{}]/g, "");
        map.set(finalPath, { additions, deletions });
    }
    return map;
}

async function readUntrackedFileNumstat(
    gitRoot: string,
    path: string
): Promise<{ additions: number; deletions: number } | null> {
    const diffResult = await runGit(gitRoot, ["diff", "--no-index", "--numstat", "/dev/null", path]);
    const canReadDiffOutput = diffResult.success || diffResult.exitCode === 1;
    if (!canReadDiffOutput) {
        return null;
    }

    const parsed = parseNumstat(diffResult.stdout);
    const exactMatch = parsed.get(path);
    if (exactMatch !== undefined) {
        return exactMatch;
    }

    const fallbackMatch = [...parsed.entries()].find(([candidatePath]) => candidatePath.endsWith(path));
    return fallbackMatch?.[1] ?? null;
}

export async function buildWorkspaceGitSummary(
    context: SessionContext,
    commitLimit = 10
): Promise<{
    workspaceRoot: string;
    gitRoot: string | null;
    repository?: string;
    branch?: string;
    branches: ReadonlyArray<GitBranchSummary>;
    uncommittedChanges: ReadonlyArray<GitFileChange>;
    recentCommits: ReadonlyArray<GitCommitSummary>;
    truncated: boolean;
}> {
    const normalizedCommitLimit = Math.min(Math.max(1, commitLimit), MAX_WORKSPACE_COMMIT_LIMIT);
    const workspaceRoot = resolveWorkspaceRoot(context);
    const gitRootCandidate = resolveWorkspaceRoot(context);
    const topLevelResult = await runGit(gitRootCandidate, ["rev-parse", "--show-toplevel"]);
    if (!topLevelResult.success || topLevelResult.stdout.trim().length === 0) {
        return {
            workspaceRoot,
            gitRoot: null,
            ...(context.repository !== undefined ? { repository: context.repository } : {}),
            ...(context.branch !== undefined ? { branch: context.branch } : {}),
            branches: context.branch !== undefined ? [{ name: context.branch, current: true }] : [],
            uncommittedChanges: [],
            recentCommits: [],
            truncated: false,
        };
    }
    const gitRoot = resolve(topLevelResult.stdout.trim());
    const workspaceScoped = workspaceRoot !== gitRoot;

    const statusResult = await runGit(gitRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--renames"]);
    if (!statusResult.success) {
        throw new Error(statusResult.stderr.trim() || statusResult.message || "Unable to read git status");
    }

    // Per-file +additions/-deletions for both tracked (diff HEAD) and untracked (diff --no-index /dev/null).
    const numstatTrackedResult = await runGit(gitRoot, ["diff", "--numstat", "HEAD"]);
    const numstatMap = numstatTrackedResult.success
        ? parseNumstat(numstatTrackedResult.stdout)
        : new Map<string, { additions: number; deletions: number }>();

    const logResult = await runGit(gitRoot, [
        "log",
        `--max-count=${normalizedCommitLimit}`,
        "--date=unix",
        "--pretty=format:%x1e%H%x1f%ct%x1f%an%x1f%s",
        "--name-only",
        "--no-renames",
    ]);
    if (!logResult.success) {
        throw new Error(logResult.stderr.trim() || logResult.message || "Unable to read git history");
    }

    const branchResult = await runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const repository = context.repository;
    const branch = branchResult.success && branchResult.stdout.trim().length > 0
        ? branchResult.stdout.trim()
        : context.branch;
    const branchListResult = await runGit(gitRoot, ["for-each-ref", "--format=%(refname:short)\t%(HEAD)", "refs/heads"]);
    const branches = branchListResult.success
        ? parseGitBranches(branchListResult.stdout, branch)
        : parseGitBranches("", branch);

    const parsedChanges = statusResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .map(parseGitStatusLine)
        .filter((entry): entry is GitFileChange => entry !== null);

    const missingUntrackedStats = parsedChanges.filter((change) =>
        (change.status === "untracked" || change.status === "added")
        && !numstatMap.has(change.path)
    );
    if (missingUntrackedStats.length > 0) {
        const statsEntries = await Promise.all(
            missingUntrackedStats.map(async (change) => {
                const stats = await readUntrackedFileNumstat(gitRoot, change.path);
                return stats === null ? null : [change.path, stats] as const;
            })
        );

        for (const entry of statsEntries) {
            if (entry !== null) {
                numstatMap.set(entry[0], entry[1]);
            }
        }
    }

    return {
        workspaceRoot,
        gitRoot,
        ...(repository !== undefined ? { repository } : {}),
        ...(branch !== undefined ? { branch } : {}),
        branches,
        uncommittedChanges: parsedChanges
            .map((change) => {
                if (!workspaceScoped) {
                    const stats = numstatMap.get(change.path);
                    if (stats !== undefined) {
                        return { ...change, additions: stats.additions, deletions: stats.deletions };
                    }
                    return change;
                }

                const workspaceRelativePath = mapGitPathToWorkspacePath(workspaceRoot, gitRoot, change.path);
                if (workspaceRelativePath === null) {
                    return null;
                }

                const workspaceOriginalPath = change.originalPath !== undefined
                    ? mapGitPathToWorkspacePath(workspaceRoot, gitRoot, change.originalPath)
                    : undefined;
                const stats = numstatMap.get(change.path);

                return {
                    ...change,
                    path: workspaceRelativePath,
                    ...(workspaceOriginalPath !== undefined ? { originalPath: workspaceOriginalPath } : {}),
                    ...(stats !== undefined ? { additions: stats.additions, deletions: stats.deletions } : {}),
                };
            })
            .filter((change): change is GitFileChange => change !== null),
        recentCommits: parseGitLog(logResult.stdout),
        truncated: false,
    };
}

export async function performWorkspaceGitOperation(
    context: SessionContext,
    operation: WorkspaceOperation
): Promise<GitCommandResult> {
    const cwd = resolveWorkspaceRoot(context);
    const args = operation === "pull"
        ? ["pull", "--ff-only", "--no-rebase"]
        : operation === "push"
            ? ["push"]
            : null;
    if (args === null) {
        throw new Error(`Unsupported workspace git operation: ${operation}`);
    }
    return runGit(cwd, args);
}

export async function commitWorkspaceChanges(
    context: SessionContext,
    message: string
): Promise<GitCommandResult> {
    const cwd = resolveWorkspaceRoot(context);
    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
        return {
            success: false,
            stdout: "",
            stderr: "",
            message: "Commit message is required",
        };
    }

    const addResult = await runGit(cwd, ["add", "-A", "--", "."]);
    if (!addResult.success) {
        return addResult;
    }

    const stagedCheckResult = await runGit(cwd, ["diff", "--cached", "--quiet", "--", "."]);
    if (stagedCheckResult.success) {
        return {
            success: false,
            stdout: "",
            stderr: "",
            message: "No changes to commit",
        };
    }

    return runGit(cwd, ["commit", "-m", trimmedMessage, "--", "."]);
}

export async function switchWorkspaceBranch(
    context: SessionContext,
    branchName: string
): Promise<GitCommandResult> {
    return runGit(resolveWorkspaceRoot(context), ["checkout", "--quiet", branchName]);
}

const MAX_FILE_READ_BYTES = 256_000; // 256 KB

const TEXT_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".json", ".jsonc", ".yaml", ".yml", ".toml",
    ".md", ".mdx", ".txt", ".env", ".env.example",
    ".sh", ".bash", ".zsh", ".fish",
    ".html", ".css", ".scss", ".less",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".hpp",
    ".graphql", ".gql", ".sql",
    ".xml", ".svg",
    ".gitignore", ".gitattributes", ".editorconfig",
    ".eslintrc", ".prettierrc", ".babelrc",
    "", // no extension — likely text
]);

function inferMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
        ".ts": "text/typescript", ".tsx": "text/typescript",
        ".js": "text/javascript", ".jsx": "text/javascript",
        ".json": "application/json", ".jsonc": "application/json",
        ".yaml": "text/yaml", ".yml": "text/yaml",
        ".md": "text/markdown", ".mdx": "text/markdown",
        ".html": "text/html", ".css": "text/css",
        ".svg": "image/svg+xml",
        ".txt": "text/plain", ".sh": "text/x-sh",
        ".py": "text/x-python", ".rb": "text/x-ruby",
        ".go": "text/x-go", ".rs": "text/x-rust",
    };
    return mimeMap[ext] ?? "text/plain";
}

export async function readWorkspaceFile(
    context: SessionContext,
    workspaceRelativePath: string,
    maxBytes = MAX_FILE_READ_BYTES
): Promise<{ content: string; mimeType: string; truncated: boolean; error?: string }> {
    const root = resolveWorkspaceRoot(context);
    const absPath = resolve(root, workspaceRelativePath);

    if (!isWithinRoot(root, absPath)) {
        return { content: "", mimeType: "text/plain", truncated: false, error: "Path is outside workspace root" };
    }

    const ext = extname(absPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
        return { content: "", mimeType: "application/octet-stream", truncated: false, error: "Binary file — content not available" };
    }

    try {
        const stat = await lstat(absPath);
        if (!stat.isFile()) {
            return { content: "", mimeType: "text/plain", truncated: false, error: "Path is not a file" };
        }

        const realAbsPath = await realpath(absPath);
        if (!isWithinRoot(root, realAbsPath)) {
            return { content: "", mimeType: "text/plain", truncated: false, error: "Path escapes workspace root via symlink" };
        }

        const limitedBytes = Math.min(maxBytes, MAX_FILE_READ_BYTES);
        const truncated = stat.size > limitedBytes;

        let content: string;
        if (truncated) {
            const file = await open(absPath, "r");
            try {
                const buffer = Buffer.alloc(limitedBytes);
                const { bytesRead } = await file.read(buffer, 0, limitedBytes, 0);
                content = buffer.subarray(0, bytesRead).toString("utf-8");
            } finally {
                await file.close();
            }
        } else {
            content = await readFile(absPath, "utf-8");
        }

        return { content, mimeType: inferMimeType(absPath), truncated };
    } catch (error) {
        return {
            content: "",
            mimeType: "text/plain",
            truncated: false,
            error: error instanceof Error ? error.message : "Failed to read file",
        };
    }
}

// Uncommitted değişikliklerin unified diff'ini döndür. Untracked dosyalar için `diff --no-index`
// kullanarak tamamen ekleme olarak gösterir.
export async function readWorkspaceDiff(
    context: SessionContext,
    workspaceRelativePath: string
): Promise<{ diff: string; error?: string }> {
    const root = resolveWorkspaceRoot(context);
    const absPath = resolve(root, workspaceRelativePath);

    if (!isWithinRoot(root, absPath)) {
        return { diff: "", error: "Path is outside workspace root" };
    }

    // Symlink traversal koruması: dosya varsa realpath'i root içinde olmalı.
    try {
        const stat = await lstat(absPath);
        if (stat.isSymbolicLink()) {
            return { diff: "", error: "Symbolic links are not allowed" };
        }
        const realAbsPath = await realpath(absPath);
        if (!isWithinRoot(root, realAbsPath)) {
            return { diff: "", error: "Path escapes workspace root via symlink" };
        }
    } catch {
        // Untracked/yeni dosya henüz var olmayabilir; bu durumda resolve'u olduğu gibi kullan.
    }

    const relPath = toPosixRelativePath(root, absPath);

    // Önce tracked mi untracked mi olduğunu belirle.
    const lsFiles = await runGit(root, ["ls-files", "--error-unmatch", "--", relPath]);
    if (lsFiles.success) {
        const tracked = await runGit(root, ["diff", "--no-color", "HEAD", "--", relPath]);
        if (!tracked.success) {
            return { diff: "", error: tracked.stderr || "git diff failed" };
        }
        return { diff: tracked.stdout };
    }

    // Untracked: /dev/null'a karşı diff al.
    const untracked = await runGit(root, [
        "diff",
        "--no-color",
        "--no-index",
        "--",
        "/dev/null",
        relPath,
    ]);
    // `diff --no-index` fark bulduğunda exit code 1 verir; bu hata değil.
    if (untracked.stdout.length > 0) {
        return { diff: untracked.stdout };
    }
    if (!untracked.success && untracked.stderr.length > 0) {
        return { diff: "", error: untracked.stderr };
    }
    return { diff: "" };
}

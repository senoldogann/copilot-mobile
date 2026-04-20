import { execFile } from "node:child_process";
import { readdir, lstat } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type {
    GitCommitSummary,
    GitFileChange,
    SessionContext,
    WorkspaceOperation,
    WorkspaceTreeNode,
} from "@copilot-mobile/shared";

const execFileAsync = promisify(execFile);
const MAX_TREE_ENTRIES_PER_DIRECTORY = 250;
const MAX_WORKSPACE_TREE_DEPTH = 5;
const MAX_WORKSPACE_COMMIT_LIMIT = 50;
const GIT_OPERATION_TIMEOUT_MS = 30_000;

type GitCommandResult = {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode?: number | undefined;
    signal?: string | null | undefined;
    message?: string | undefined;
};

function toPosixRelativePath(rootPath: string, absolutePath: string): string {
    const rel = relative(rootPath, absolutePath);
    if (rel.length === 0) {
        return ".";
    }

    return rel.split(sep).join("/");
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
    const rel = relative(resolve(rootPath), resolve(candidatePath));
    return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
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
    depthRemaining: number
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

        const children: Array<WorkspaceTreeNode> = [];
        let truncated = false;

        for (const entry of entries.slice(0, MAX_TREE_ENTRIES_PER_DIRECTORY)) {
            if (entry.name === ".git") {
                continue;
            }

            const childPath = resolve(absolutePath, entry.name);
            if (!isWithinRoot(rootPath, childPath)) {
                continue;
            }

            const childStats = await lstat(childPath);
            const childRelativePath = toPosixRelativePath(rootPath, childPath);
            const childName = entry.name;

            if (childStats.isDirectory()) {
                const childResult = await buildTreeNode(rootPath, childPath, depthRemaining - 1);
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

        truncated ||= entries.length > MAX_TREE_ENTRIES_PER_DIRECTORY;

        return {
            node: {
                name,
                path: relativePath,
                type: "directory",
                modifiedAt: stats.mtimeMs,
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

export async function buildWorkspaceTree(
    rootPath: string,
    requestedPath = ".",
    maxDepth = 3
): Promise<{ rootPath: string; requestedPath: string; tree: WorkspaceTreeNode; truncated: boolean }> {
    const normalizedDepth = Math.min(Math.max(0, maxDepth), MAX_WORKSPACE_TREE_DEPTH);
    const absolutePath = resolve(rootPath, requestedPath);
    if (!isWithinRoot(rootPath, absolutePath)) {
        throw new Error(`Requested path is outside the workspace root: ${requestedPath}`);
    }

    const tree = await buildTreeNode(rootPath, absolutePath, normalizedDepth);
    return {
        rootPath: resolve(rootPath),
        requestedPath: toPosixRelativePath(rootPath, absolutePath),
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

export async function buildWorkspaceGitSummary(
    context: SessionContext,
    commitLimit = 10
): Promise<{
    rootPath: string;
    gitRoot: string | null;
    repository?: string;
    branch?: string;
    uncommittedChanges: ReadonlyArray<GitFileChange>;
    recentCommits: ReadonlyArray<GitCommitSummary>;
    truncated: boolean;
}> {
    const normalizedCommitLimit = Math.min(Math.max(1, commitLimit), MAX_WORKSPACE_COMMIT_LIMIT);
    const rootPath = resolve(context.cwd);
    const gitRootCandidate = resolve(context.gitRoot ?? context.cwd);
    const topLevelResult = await runGit(gitRootCandidate, ["rev-parse", "--show-toplevel"]);
    if (!topLevelResult.success || topLevelResult.stdout.trim().length === 0) {
        return {
            rootPath,
            gitRoot: null,
            repository: context.repository,
            branch: context.branch,
            uncommittedChanges: [],
            recentCommits: [],
            truncated: false,
        };
    }
    const gitRoot = resolve(topLevelResult.stdout.trim());

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

    const branchResult = context.branch !== undefined
        ? { success: true, stdout: context.branch, stderr: "" }
        : await runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const repositoryResult = context.repository !== undefined
        ? { success: true, stdout: context.repository, stderr: "" }
        : await runGit(gitRoot, ["config", "--get", "remote.origin.url"]);

    return {
        rootPath,
        gitRoot,
        repository: context.repository ?? (repositoryResult.success && repositoryResult.stdout.trim().length > 0
            ? repositoryResult.stdout.trim()
            : undefined),
        branch: context.branch ?? (branchResult.success && branchResult.stdout.trim().length > 0
            ? branchResult.stdout.trim()
            : undefined),
        uncommittedChanges: statusResult.stdout
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0)
            .map(parseGitStatusLine)
            .filter((entry): entry is GitFileChange => entry !== null)
            .map((change) => {
                const stats = numstatMap.get(change.path);
                if (stats !== undefined) {
                    return { ...change, additions: stats.additions, deletions: stats.deletions };
                }
                return change;
            }),
        recentCommits: parseGitLog(logResult.stdout),
        truncated: false,
    };
}

export async function performWorkspaceGitOperation(
    context: SessionContext,
    operation: WorkspaceOperation
): Promise<GitCommandResult> {
    const cwd = resolve(context.gitRoot ?? context.cwd);
    const args = operation === "pull"
        ? ["pull", "--ff-only", "--no-rebase"]
        : ["push"];
    return runGit(cwd, args);
}

import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PermissionLevel, SessionInfo } from "@copilot-mobile/shared";

const CHAT_SESSION_INDEX_KEY = "chat.ChatSessionStore.index";
const EXTERNAL_SESSION_PREFIX = "copilotcli:/";

type ExternalSessionIndexEntry = {
    sessionId: string;
    title: string;
    lastMessageDate: number;
    timing: {
        created: number;
        lastRequestStarted?: number;
        lastRequestEnded?: number;
    };
    initialLocation: "panel";
    hasPendingEdits: boolean;
    isEmpty: boolean;
    isExternal: true;
    lastResponseState: 1 | 2;
    permissionLevel?: PermissionLevel;
};

type ChatSessionStoreIndex = {
    version: number;
    entries: Record<string, ExternalSessionIndexEntry>;
};

type ExternalSessionMetadata = Record<string, {
    writtenToDisc: true;
    workspaceFolder?: {
        folderPath: string;
        timestamp: number;
    };
    customTitle?: string;
}>;

type ExternalSessionRegistry = {
    sessionIds: ReadonlyArray<string>;
};

type StoragePaths = {
    globalStateDbPath: string;
    metadataPath: string;
    registryPath: string;
};

type SyncSessionInput = {
    session: SessionInfo;
    permissionLevel: PermissionLevel;
    busy: boolean;
};

type CreateVSCodeExternalSessionStoreOptions = {
    vscodeUserDir?: string;
};

function getVSCodeUserDirCandidates(): Array<string> {
    const home = homedir();
    switch (platform()) {
        case "darwin":
            return [
                join(home, "Library", "Application Support", "Code", "User"),
                join(home, "Library", "Application Support", "Code - Insiders", "User"),
            ];
        case "win32": {
            const appData = process.env.APPDATA;
            if (typeof appData !== "string" || appData.length === 0) {
                return [];
            }
            return [
                join(appData, "Code", "User"),
                join(appData, "Code - Insiders", "User"),
            ];
        }
        default:
            return [
                join(home, ".config", "Code", "User"),
                join(home, ".config", "Code - Insiders", "User"),
            ];
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function readOptionalJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
        const content = await readFile(filePath, "utf8");
        return JSON.parse(content) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return fallback;
        }
        throw error;
    }
}

async function resolveStoragePaths(
    overrideUserDir?: string
): Promise<StoragePaths | null> {
    const candidates = overrideUserDir !== undefined
        ? [overrideUserDir]
        : getVSCodeUserDirCandidates();

    for (const userDir of candidates) {
        const globalStateDbPath = join(userDir, "globalStorage", "state.vscdb");
        const metadataPath = join(
            userDir,
            "globalStorage",
            "github.copilot-chat",
            "copilotCli",
            "copilotcli.session.metadata.json"
        );
        if (await pathExists(globalStateDbPath)) {
            return {
                globalStateDbPath,
                metadataPath,
                registryPath: join(
                    userDir,
                    "globalStorage",
                    "github.copilot-chat",
                    "copilot-mobile",
                    "external-session-registry.json"
                ),
            };
        }
    }

    return null;
}

function readChatSessionStoreIndex(globalStateDbPath: string): ChatSessionStoreIndex {
    const database = new DatabaseSync(globalStateDbPath);
    try {
        database.exec("PRAGMA busy_timeout = 2000");
        const row = database
            .prepare("SELECT value FROM ItemTable WHERE key = ?")
            .get(CHAT_SESSION_INDEX_KEY) as { value: string } | undefined;

        if (row === undefined || row.value.trim().length === 0) {
            return { version: 1, entries: {} };
        }

        const parsed = JSON.parse(row.value) as ChatSessionStoreIndex;
        return {
            version: typeof parsed.version === "number" ? parsed.version : 1,
            entries: typeof parsed.entries === "object" && parsed.entries !== null
                ? parsed.entries
                : {},
        };
    } finally {
        database.close();
    }
}

function writeChatSessionStoreIndex(
    globalStateDbPath: string,
    index: ChatSessionStoreIndex
): void {
    const database = new DatabaseSync(globalStateDbPath);
    try {
        database.exec("PRAGMA busy_timeout = 2000");
        const serialized = JSON.stringify(index);
        const updateResult = database
            .prepare("UPDATE ItemTable SET value = ? WHERE key = ?")
            .run(serialized, CHAT_SESSION_INDEX_KEY);

        if ((updateResult.changes ?? 0) === 0) {
            database
                .prepare("INSERT INTO ItemTable(key, value) VALUES(?, ?)")
                .run(CHAT_SESSION_INDEX_KEY, serialized);
        }
    } finally {
        database.close();
    }
}

function buildExternalSessionKey(sessionId: string): string {
    return sessionId.startsWith(EXTERNAL_SESSION_PREFIX)
        ? sessionId
        : `${EXTERNAL_SESSION_PREFIX}${sessionId}`;
}

function deriveSessionTitle(session: SessionInfo): string {
    const explicitTitle = session.title?.trim();
    if (explicitTitle !== undefined && explicitTitle.length > 0) {
        return explicitTitle;
    }

    const summaryTitle = session.summary?.trim();
    if (summaryTitle !== undefined && summaryTitle.length > 0) {
        return summaryTitle;
    }

    return "New Chat";
}

function deriveWorkspaceFolderPath(session: SessionInfo): string | undefined {
    const context = session.context;
    if (context === undefined) {
        return undefined;
    }

    return context.workspaceRoot
        ?? context.sessionCwd
        ?? context.gitRoot;
}

function buildExternalSessionEntry(
    session: SessionInfo,
    permissionLevel: PermissionLevel,
    busy: boolean,
    existingEntry?: ExternalSessionIndexEntry
): ExternalSessionIndexEntry {
    const timestamp = Math.max(session.createdAt, session.lastActiveAt);
    const title = deriveSessionTitle(session);
    const timing = {
        created: existingEntry?.timing.created ?? session.createdAt,
        ...(busy
            ? { lastRequestStarted: timestamp }
            : {
                lastRequestStarted: existingEntry?.timing.lastRequestStarted ?? timestamp,
                lastRequestEnded: timestamp,
            }),
    };

    return {
        sessionId: buildExternalSessionKey(session.id),
        title,
        lastMessageDate: timestamp,
        timing,
        initialLocation: "panel",
        hasPendingEdits: false,
        isEmpty: title === "New Chat" && !busy,
        isExternal: true,
        lastResponseState: busy ? 2 : 1,
        permissionLevel,
    };
}

export function createVSCodeExternalSessionStore(
    options: CreateVSCodeExternalSessionStoreOptions = {}
) {
    let resolvedPaths: StoragePaths | null | undefined;
    let writeChain = Promise.resolve();

    async function getStoragePaths(): Promise<StoragePaths | null> {
        if (resolvedPaths !== undefined) {
            return resolvedPaths;
        }

        resolvedPaths = await resolveStoragePaths(options.vscodeUserDir);
        return resolvedPaths;
    }

    function queueWrite<T>(operation: () => Promise<T>): Promise<T> {
        const nextOperation = writeChain.then(operation, operation);
        writeChain = nextOperation.then(() => undefined, () => undefined);
        return nextOperation;
    }

    return {
        async syncSession(input: SyncSessionInput): Promise<boolean> {
            return queueWrite(async () => {
                const paths = await getStoragePaths();
                if (paths === null) {
                    return false;
                }

                const registry = await readOptionalJsonFile<ExternalSessionRegistry>(
                    paths.registryPath,
                    { sessionIds: [] }
                );
                const trackedSessionIds = new Set(registry.sessionIds);
                const index = readChatSessionStoreIndex(paths.globalStateDbPath);
                const rawSessionId = input.session.id;
                const externalSessionKey = buildExternalSessionKey(rawSessionId);
                const internalEntry = index.entries[rawSessionId];

                if (
                    !trackedSessionIds.has(rawSessionId)
                    && internalEntry !== undefined
                    && internalEntry.isExternal !== true
                ) {
                    return false;
                }

                const nextEntry = buildExternalSessionEntry(
                    input.session,
                    input.permissionLevel,
                    input.busy,
                    index.entries[externalSessionKey]
                );
                index.entries[externalSessionKey] = nextEntry;
                writeChatSessionStoreIndex(paths.globalStateDbPath, index);

                const metadata = await readOptionalJsonFile<ExternalSessionMetadata>(
                    paths.metadataPath,
                    {}
                );
                const nextMetadataEntry = {
                    ...(metadata[rawSessionId] ?? {}),
                    writtenToDisc: true as const,
                };
                const workspaceFolderPath = deriveWorkspaceFolderPath(input.session);
                if (workspaceFolderPath !== undefined) {
                    nextMetadataEntry.workspaceFolder = {
                        folderPath: workspaceFolderPath,
                        timestamp: Math.max(input.session.createdAt, input.session.lastActiveAt),
                    };
                }

                const title = deriveSessionTitle(input.session);
                if (title !== "New Chat") {
                    nextMetadataEntry.customTitle = title;
                } else {
                    delete nextMetadataEntry.customTitle;
                }

                metadata[rawSessionId] = nextMetadataEntry;
                await mkdir(dirname(paths.metadataPath), { recursive: true });
                await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

                trackedSessionIds.add(rawSessionId);
                await mkdir(dirname(paths.registryPath), { recursive: true });
                await writeFile(
                    paths.registryPath,
                    `${JSON.stringify({ sessionIds: [...trackedSessionIds].sort() }, null, 2)}\n`,
                    "utf8"
                );

                return true;
            });
        },

        async removeSession(sessionId: string): Promise<boolean> {
            return queueWrite(async () => {
                const paths = await getStoragePaths();
                if (paths === null) {
                    return false;
                }

                const registry = await readOptionalJsonFile<ExternalSessionRegistry>(
                    paths.registryPath,
                    { sessionIds: [] }
                );
                const trackedSessionIds = new Set(registry.sessionIds);
                if (!trackedSessionIds.has(sessionId)) {
                    return false;
                }

                const index = readChatSessionStoreIndex(paths.globalStateDbPath);
                delete index.entries[buildExternalSessionKey(sessionId)];
                writeChatSessionStoreIndex(paths.globalStateDbPath, index);

                const metadata = await readOptionalJsonFile<ExternalSessionMetadata>(
                    paths.metadataPath,
                    {}
                );
                delete metadata[sessionId];
                await mkdir(dirname(paths.metadataPath), { recursive: true });
                await writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

                trackedSessionIds.delete(sessionId);
                await mkdir(dirname(paths.registryPath), { recursive: true });
                await writeFile(
                    paths.registryPath,
                    `${JSON.stringify({ sessionIds: [...trackedSessionIds].sort() }, null, 2)}\n`,
                    "utf8"
                );

                return true;
            });
        },
    };
}

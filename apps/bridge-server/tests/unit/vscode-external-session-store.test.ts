import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionInfo } from "@copilot-mobile/shared";
import { createVSCodeExternalSessionStore } from "../../src/vscode/external-session-store.js";

const tempDirs: Array<string> = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type DatabaseSyncInstance = {
    exec(sql: string): void;
    prepare(sql: string): {
        get(...params: Array<unknown>): unknown;
        run(...params: Array<unknown>): { changes?: number };
    };
    close(): void;
};

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncInstance;

async function getDatabaseSyncConstructor(): Promise<DatabaseSyncConstructor | null> {
    try {
        const module = await import("node:sqlite");
        return module.DatabaseSync as DatabaseSyncConstructor;
    } catch (error) {
        if (
            error instanceof Error
            && "code" in error
            && (error as NodeJS.ErrnoException).code === "ERR_UNKNOWN_BUILTIN_MODULE"
        ) {
            return null;
        }
        throw error;
    }
}

function decodeSqliteText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString("utf8");
    }

    if (value instanceof ArrayBuffer) {
        return Buffer.from(value).toString("utf8");
    }

    throw new TypeError("Unsupported SQLite text value");
}

async function createFixture(
    DatabaseSync: DatabaseSyncConstructor,
    input: {
        index?: unknown;
        metadata?: unknown;
    } = {}
): Promise<{
    userDir: string;
    dbPath: string;
    metadataPath: string;
}> {
    const rootDir = await mkdtemp(join(tmpdir(), "copilot-mobile-vscode-sync-"));
    tempDirs.push(rootDir);

    const userDir = join(rootDir, "User");
    const globalStorageDir = join(userDir, "globalStorage");
    const copilotCliDir = join(globalStorageDir, "github.copilot-chat", "copilotCli");
    await mkdir(copilotCliDir, { recursive: true });

    const dbPath = join(globalStorageDir, "state.vscdb");
    const database = new DatabaseSync(dbPath);
    database.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
    database
        .prepare("INSERT INTO ItemTable(key, value) VALUES(?, ?)")
        .run("chat.ChatSessionStore.index", JSON.stringify(input.index ?? { version: 1, entries: {} }));
    database.close();

    const metadataPath = join(copilotCliDir, "copilotcli.session.metadata.json");
    await writeFile(metadataPath, `${JSON.stringify(input.metadata ?? {}, null, 2)}\n`, "utf8");

    return { userDir, dbPath, metadataPath };
}

function readIndex(DatabaseSync: DatabaseSyncConstructor, dbPath: string): {
    version: number;
    entries: Record<string, unknown>;
} {
    const database = new DatabaseSync(dbPath);
    try {
        const row = database
            .prepare("SELECT value FROM ItemTable WHERE key = ?")
            .get("chat.ChatSessionStore.index") as { value: unknown };
        return JSON.parse(decodeSqliteText(row.value)) as {
            version: number;
            entries: Record<string, unknown>;
        };
    } finally {
        database.close();
    }
}

function createSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        id: "session-1",
        model: "gpt-5.4",
        createdAt: 1_700_000_000_000,
        lastActiveAt: 1_700_000_000_500,
        status: "idle",
        summary: "Mobile session summary",
        context: {
            sessionCwd: "/Users/dogan/Desktop/copilot-mobile",
            workspaceRoot: "/Users/dogan/Desktop/copilot-mobile",
            branch: "main",
        },
        ...overrides,
    };
}

describe("VS Code external session store", () => {
    it("registers a mobile session as an external copilotcli session", async (t) => {
        const DatabaseSync = await getDatabaseSyncConstructor();
        if (DatabaseSync === null) {
            t.skip("node:sqlite unavailable");
            return;
        }

        const fixture = await createFixture(DatabaseSync);
        const store = createVSCodeExternalSessionStore({ vscodeUserDir: fixture.userDir });

        const synced = await store.syncSession({
            session: createSessionInfo(),
            permissionLevel: "default",
            busy: false,
        });

        assert.equal(synced, true);

        const index = readIndex(DatabaseSync, fixture.dbPath);
        assert.deepEqual(index.entries["copilotcli:/session-1"], {
            sessionId: "copilotcli:/session-1",
            title: "Mobile session summary",
            lastMessageDate: 1_700_000_000_500,
            timing: {
                created: 1_700_000_000_000,
                lastRequestStarted: 1_700_000_000_500,
                lastRequestEnded: 1_700_000_000_500,
            },
            initialLocation: "panel",
            hasPendingEdits: false,
            isEmpty: false,
            isExternal: true,
            lastResponseState: 1,
            permissionLevel: "default",
        });

        const metadata = JSON.parse(await readFile(fixture.metadataPath, "utf8")) as Record<string, unknown>;
        assert.deepEqual(metadata["session-1"], {
            writtenToDisc: true,
            workspaceFolder: {
                folderPath: "/Users/dogan/Desktop/copilot-mobile",
                timestamp: 1_700_000_000_500,
            },
            customTitle: "Mobile session summary",
        });
    });

    it("does not create an external entry when a native VS Code session already exists", async (t) => {
        const DatabaseSync = await getDatabaseSyncConstructor();
        if (DatabaseSync === null) {
            t.skip("node:sqlite unavailable");
            return;
        }

        const fixture = await createFixture(DatabaseSync, {
            index: {
                version: 1,
                entries: {
                    "session-1": {
                        sessionId: "session-1",
                        title: "Desktop native session",
                        isExternal: false,
                    },
                },
            },
        });
        const store = createVSCodeExternalSessionStore({ vscodeUserDir: fixture.userDir });

        const synced = await store.syncSession({
            session: createSessionInfo(),
            permissionLevel: "default",
            busy: false,
        });

        assert.equal(synced, false);
        const index = readIndex(DatabaseSync, fixture.dbPath);
        assert.equal(index.entries["copilotcli:/session-1"], undefined);
    });

    it("removes externally registered sessions when they are deleted", async (t) => {
        const DatabaseSync = await getDatabaseSyncConstructor();
        if (DatabaseSync === null) {
            t.skip("node:sqlite unavailable");
            return;
        }

        const fixture = await createFixture(DatabaseSync);
        const store = createVSCodeExternalSessionStore({ vscodeUserDir: fixture.userDir });

        await store.syncSession({
            session: createSessionInfo({ title: "Bridge chat" }),
            permissionLevel: "default",
            busy: false,
        });

        const removed = await store.removeSession("session-1");
        assert.equal(removed, true);

        const index = readIndex(DatabaseSync, fixture.dbPath);
        assert.equal(index.entries["copilotcli:/session-1"], undefined);

        const metadata = JSON.parse(await readFile(fixture.metadataPath, "utf8")) as Record<string, unknown>;
        assert.equal(metadata["session-1"], undefined);
    });
});

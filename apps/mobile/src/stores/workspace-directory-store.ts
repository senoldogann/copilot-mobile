import { create } from "zustand";

import { readLocalStateValue, writeLocalStateValue } from "../services/local-state-storage";
import { getDefaultCompanionScopeKey, getScopedStorageKey } from "../services/companion-scope";

const WORKSPACE_DIRECTORIES_KEY = "code_companion_workspace_directories";
const LEGACY_WORKSPACE_DIRECTORIES_KEY = "copilot_mobile_workspace_directories";

export type SavedWorkspaceDirectory = {
    path: string;
    createdAt: number;
    lastUsedAt: number;
};

type WorkspaceDirectoryStore = {
    scopeKey: string;
    directories: ReadonlyArray<SavedWorkspaceDirectory>;
    hydrated: boolean;
    hydrate: () => Promise<void>;
    switchScope: (scopeKey: string) => Promise<void>;
    addDirectory: (path: string) => void;
    removeDirectory: (path: string) => void;
    touchDirectory: (path: string) => void;
};

type PersistedWorkspaceDirectoryStore = {
    directories: ReadonlyArray<SavedWorkspaceDirectory>;
};

function getWorkspaceDirectoriesStorageKeys(scopeKey: string): {
    primary: string;
    legacy: string;
} {
    return {
        primary: getScopedStorageKey(WORKSPACE_DIRECTORIES_KEY, scopeKey),
        legacy: getScopedStorageKey(LEGACY_WORKSPACE_DIRECTORIES_KEY, scopeKey),
    };
}

async function persistDirectories(
    directories: ReadonlyArray<SavedWorkspaceDirectory>,
    scopeKey: string
): Promise<void> {
    const payload: PersistedWorkspaceDirectoryStore = { directories };
    const serializedPayload = JSON.stringify(payload);
    const keys = getWorkspaceDirectoriesStorageKeys(scopeKey);
    await writeLocalStateValue(
        keys.primary,
        serializedPayload,
    );
    await writeLocalStateValue(
        keys.legacy,
        serializedPayload,
    );
}

function sortDirectories(
    directories: ReadonlyArray<SavedWorkspaceDirectory>
): Array<SavedWorkspaceDirectory> {
    return [...directories].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
}

async function loadPersistedDirectories(scopeKey: string): Promise<ReadonlyArray<SavedWorkspaceDirectory>> {
    const keys = getWorkspaceDirectoriesStorageKeys(scopeKey);
    const rawValue = await readLocalStateValue(keys.primary)
        ?? await readLocalStateValue(keys.legacy);
    if (rawValue === null) {
        return [];
    }

    await writeLocalStateValue(keys.primary, rawValue);

    const parsed = JSON.parse(rawValue) as unknown;
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { directories?: unknown }).directories)) {
        return [];
    }

    return ((parsed as { directories: ReadonlyArray<unknown> }).directories)
        .flatMap((item) => {
            if (typeof item !== "object" || item === null) {
                return [];
            }

            const value = item as Record<string, unknown>;
            if (
                typeof value.path !== "string"
                || typeof value.createdAt !== "number"
                || typeof value.lastUsedAt !== "number"
            ) {
                return [];
            }

            return [{
                path: value.path,
                createdAt: value.createdAt,
                lastUsedAt: value.lastUsedAt,
            } satisfies SavedWorkspaceDirectory];
        });
}

export const useWorkspaceDirectoryStore = create<WorkspaceDirectoryStore>((set, get) => ({
    scopeKey: getDefaultCompanionScopeKey(),
    directories: [],
    hydrated: false,

    hydrate: async () => {
        const directories = await loadPersistedDirectories(get().scopeKey);
        set({ directories: sortDirectories(directories), hydrated: true });
    },

    switchScope: async (scopeKey) => {
        set({ scopeKey, directories: [], hydrated: false });
        const directories = await loadPersistedDirectories(scopeKey);
        set({
            scopeKey,
            directories: sortDirectories(directories),
            hydrated: true,
        });
    },

    addDirectory: (path) => {
        const normalizedPath = path.trim();
        if (normalizedPath.length === 0) {
            return;
        }

        const now = Date.now();
        const existing = get().directories.find((directory) => directory.path === normalizedPath);
        const nextDirectories = existing === undefined
            ? sortDirectories([
                ...get().directories,
                {
                    path: normalizedPath,
                    createdAt: now,
                    lastUsedAt: now,
                },
            ])
            : sortDirectories(get().directories.map((directory) =>
                directory.path === normalizedPath
                    ? { ...directory, lastUsedAt: now }
                    : directory
            ));

        set({ directories: nextDirectories });
        void persistDirectories(nextDirectories, get().scopeKey);
    },

    removeDirectory: (path) => {
        const nextDirectories = get().directories.filter((directory) => directory.path !== path);
        set({ directories: nextDirectories });
        void persistDirectories(nextDirectories, get().scopeKey);
    },

    touchDirectory: (path) => {
        const now = Date.now();
        const nextDirectories = sortDirectories(get().directories.map((directory) =>
            directory.path === path
                ? { ...directory, lastUsedAt: now }
                : directory
        ));
        set({ directories: nextDirectories });
        void persistDirectories(nextDirectories, get().scopeKey);
    },
}));

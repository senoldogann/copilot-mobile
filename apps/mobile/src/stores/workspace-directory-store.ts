import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const WORKSPACE_DIRECTORIES_KEY = "copilot_mobile_workspace_directories";

export type SavedWorkspaceDirectory = {
    path: string;
    createdAt: number;
    lastUsedAt: number;
};

type WorkspaceDirectoryStore = {
    directories: ReadonlyArray<SavedWorkspaceDirectory>;
    hydrated: boolean;
    hydrate: () => Promise<void>;
    addDirectory: (path: string) => void;
    removeDirectory: (path: string) => void;
    touchDirectory: (path: string) => void;
};

type PersistedWorkspaceDirectoryStore = {
    directories: ReadonlyArray<SavedWorkspaceDirectory>;
};

async function persistDirectories(
    directories: ReadonlyArray<SavedWorkspaceDirectory>
): Promise<void> {
    const payload: PersistedWorkspaceDirectoryStore = { directories };
    await SecureStore.setItemAsync(
        WORKSPACE_DIRECTORIES_KEY,
        JSON.stringify(payload),
    );
}

function sortDirectories(
    directories: ReadonlyArray<SavedWorkspaceDirectory>
): Array<SavedWorkspaceDirectory> {
    return [...directories].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
}

export const useWorkspaceDirectoryStore = create<WorkspaceDirectoryStore>((set, get) => ({
    directories: [],
    hydrated: false,

    hydrate: async () => {
        const rawValue = await SecureStore.getItemAsync(WORKSPACE_DIRECTORIES_KEY);
        if (rawValue === null) {
            set({ hydrated: true });
            return;
        }

        const parsed = JSON.parse(rawValue) as unknown;
        if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { directories?: unknown }).directories)) {
            set({ directories: [], hydrated: true });
            return;
        }

        const directories = ((parsed as { directories: ReadonlyArray<unknown> }).directories)
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

        set({
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
        void persistDirectories(nextDirectories);
    },

    removeDirectory: (path) => {
        const nextDirectories = get().directories.filter((directory) => directory.path !== path);
        set({ directories: nextDirectories });
        void persistDirectories(nextDirectories);
    },

    touchDirectory: (path) => {
        const now = Date.now();
        const nextDirectories = sortDirectories(get().directories.map((directory) =>
            directory.path === path
                ? { ...directory, lastUsedAt: now }
                : directory
        ));
        set({ directories: nextDirectories });
        void persistDirectories(nextDirectories);
    },
}));

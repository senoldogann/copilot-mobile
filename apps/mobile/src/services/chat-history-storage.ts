import { Directory, File, Paths } from "expo-file-system";

const STORAGE_DIRECTORY_NAME = "code-companion";
const LEGACY_STORAGE_DIRECTORY_NAME = "copilot-mobile";
const CHAT_HISTORY_FILE_NAME = "chat-history.json";

function getStorageDirectoryUri(directoryName: string): string {
    return new Directory(Paths.document, directoryName).uri;
}

function getScopedChatHistoryFileName(scopeKey?: string): string {
    if (scopeKey === undefined || scopeKey === "default") {
        return CHAT_HISTORY_FILE_NAME;
    }

    return `chat-history.${scopeKey}.json`;
}

function getChatHistoryFileUri(directoryName: string, scopeKey?: string): string {
    return new File(getStorageDirectoryUri(directoryName), getScopedChatHistoryFileName(scopeKey)).uri;
}

async function ensureStorageDirectory(directoryName: string): Promise<void> {
    const directory = new Directory(getStorageDirectoryUri(directoryName));
    if (directory.exists) {
        return;
    }

    await directory.create({ intermediates: true, idempotent: true });
}

export async function writeChatHistorySnapshot(serialized: string, scopeKey?: string): Promise<void> {
    const directoryNames = [STORAGE_DIRECTORY_NAME, LEGACY_STORAGE_DIRECTORY_NAME] as const;

    for (const directoryName of directoryNames) {
        await ensureStorageDirectory(directoryName);
        const file = new File(getChatHistoryFileUri(directoryName, scopeKey));
        if (!file.exists) {
            await file.create({ intermediates: true, overwrite: true });
        }
        await file.write(serialized);
    }
}

export async function readChatHistorySnapshot(scopeKey?: string): Promise<string | null> {
    const primaryFile = new File(getChatHistoryFileUri(STORAGE_DIRECTORY_NAME, scopeKey));
    if (primaryFile.exists) {
        return await primaryFile.text();
    }

    const legacyFile = new File(getChatHistoryFileUri(LEGACY_STORAGE_DIRECTORY_NAME, scopeKey));
    if (!legacyFile.exists) {
        return null;
    }

    const legacySnapshot = await legacyFile.text();
    await writeChatHistorySnapshot(legacySnapshot, scopeKey);
    return legacySnapshot;
}

export async function deleteChatHistorySnapshot(scopeKey?: string): Promise<void> {
    const directoryNames = [STORAGE_DIRECTORY_NAME, LEGACY_STORAGE_DIRECTORY_NAME] as const;

    for (const directoryName of directoryNames) {
        const file = new File(getChatHistoryFileUri(directoryName, scopeKey));
        if (!file.exists) {
            continue;
        }

        await file.delete();
    }
}

export async function readLegacySecureStoreChatHistory(): Promise<string | null> {
    return null;
}

export async function clearLegacySecureStoreChatHistory(): Promise<void> {
    return Promise.resolve();
}

import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";

const CHAT_HISTORY_KEY = "copilot_mobile_chat_history";
const STORAGE_DIRECTORY_NAME = "copilot-mobile";
const CHAT_HISTORY_FILE_NAME = "chat-history.json";

function getStorageDirectoryUri(): string {
    return new Directory(Paths.document, STORAGE_DIRECTORY_NAME).uri;
}

function getChatHistoryFileUri(): string {
    return new File(getStorageDirectoryUri(), CHAT_HISTORY_FILE_NAME).uri;
}

async function ensureStorageDirectory(): Promise<void> {
    const directory = new Directory(getStorageDirectoryUri());
    if (directory.exists) {
        return;
    }

    await directory.create({ intermediates: true, idempotent: true });
}

export async function writeChatHistorySnapshot(serialized: string): Promise<void> {
    await ensureStorageDirectory();
    const file = new File(getChatHistoryFileUri());
    if (!file.exists) {
        await file.create({ intermediates: true, overwrite: true });
    }
    await file.write(serialized);
}

export async function readChatHistorySnapshot(): Promise<string | null> {
    const file = new File(getChatHistoryFileUri());
    if (!file.exists) {
        return null;
    }

    return await file.text();
}

export async function deleteChatHistorySnapshot(): Promise<void> {
    const file = new File(getChatHistoryFileUri());
    if (!file.exists) {
        return;
    }

    await file.delete();
}

export async function readLegacySecureStoreChatHistory(): Promise<string | null> {
    return SecureStore.getItemAsync(CHAT_HISTORY_KEY);
}

export async function clearLegacySecureStoreChatHistory(): Promise<void> {
    await SecureStore.deleteItemAsync(CHAT_HISTORY_KEY);
}

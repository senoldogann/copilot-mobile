import { Directory, File, Paths } from "expo-file-system";

const LOCAL_STATE_DIRECTORY_NAME = "code-companion";

function getLocalStateDirectoryUri(): string {
    return new Directory(Paths.document, LOCAL_STATE_DIRECTORY_NAME).uri;
}

function getLocalStateFileUri(storageKey: string): string {
    return new File(getLocalStateDirectoryUri(), `${storageKey}.json`).uri;
}

async function ensureLocalStateDirectory(): Promise<void> {
    const directory = new Directory(getLocalStateDirectoryUri());
    if (directory.exists) {
        return;
    }

    await directory.create({ intermediates: true, idempotent: true });
}

export async function writeLocalStateValue(
    storageKey: string,
    value: string
): Promise<void> {
    await ensureLocalStateDirectory();
    const file = new File(getLocalStateFileUri(storageKey));
    if (!file.exists) {
        await file.create({ intermediates: true, overwrite: true });
    }
    await file.write(value);
}

export async function readLocalStateValue(storageKey: string): Promise<string | null> {
    const file = new File(getLocalStateFileUri(storageKey));
    if (!file.exists) {
        return null;
    }

    return file.text();
}

export async function deleteLocalStateValue(storageKey: string): Promise<void> {
    const file = new File(getLocalStateFileUri(storageKey));
    if (!file.exists) {
        return;
    }

    await file.delete();
}

// Persistent pairing credentials used to resume without scanning QR again.

import * as SecureStore from "expo-secure-store";
import type { TransportMode } from "@copilot-mobile/shared";

import { deleteLocalStateValue, readLocalStateValue, writeLocalStateValue } from "./local-state-storage";

type SecureStoreKeyPair = {
    primary: string;
    legacy: string;
};

const KEY_DEVICE_CREDENTIAL: SecureStoreKeyPair = {
    primary: "code_companion_device_credential",
    legacy: "copilot_mobile_device_credential",
};
const KEY_SERVER_URL: SecureStoreKeyPair = {
    primary: "code_companion_server_url",
    legacy: "copilot_mobile_server_url",
};
const KEY_CERT_FINGERPRINT: SecureStoreKeyPair = {
    primary: "code_companion_cert_fingerprint",
    legacy: "copilot_mobile_cert_fingerprint",
};
const KEY_DEVICE_ID: SecureStoreKeyPair = {
    primary: "code_companion_device_id",
    legacy: "copilot_mobile_device_id",
};
const KEY_TRANSPORT_MODE: SecureStoreKeyPair = {
    primary: "code_companion_transport_mode",
    legacy: "copilot_mobile_transport_mode",
};
const KEY_RELAY_ACCESS_TOKEN: SecureStoreKeyPair = {
    primary: "code_companion_relay_access_token",
    legacy: "copilot_mobile_relay_access_token",
};
const KEY_ACTIVE_SESSION_ID = "code_companion_active_session_id";
const KEY_SESSION_PREFERENCES = "code_companion_session_preferences";
const KEY_ONBOARDING_COMPLETED = "code_companion_onboarding_completed";
const KEY_FREE_MESSAGE_TRIAL = "code_companion_free_message_trial";

export type StoredCredentials = {
    deviceCredential: string;
    serverUrl: string;
    certFingerprint: string | null;
    deviceId: string;
    transportMode: TransportMode;
    relayAccessToken: string | null;
};

function normalizeStoredTransportMode(
    transportMode: string | null
): TransportMode | null {
    if (transportMode === "direct") {
        return "direct";
    }

    if (transportMode === "relay" || transportMode === "tunnel") {
        return "relay";
    }

    return null;
}

export type StoredSessionPreferences = {
    selectedModel: string;
    reasoningEffort: string | null;
    agentMode: string;
    permissionLevel: string;
    autoApproveReads: boolean;
};

type PersistedFreeMessageTrial = {
    hasUsedFreeMessage: boolean;
};

async function writeOnboardingStateFile(completed: boolean): Promise<void> {
    if (!completed) {
        await deleteLocalStateValue(KEY_ONBOARDING_COMPLETED);
        return;
    }

    await writeLocalStateValue(KEY_ONBOARDING_COMPLETED, JSON.stringify({ completed: true }));
}

async function readOnboardingStateFile(): Promise<boolean> {
    const raw = await readLocalStateValue(KEY_ONBOARDING_COMPLETED);
    if (raw === null) {
        return false;
    }

    try {
        const parsed = JSON.parse(raw) as { completed?: unknown };
        return parsed.completed === true;
    } catch {
        return false;
    }
}

async function writeFreeMessageTrialStateFile(hasUsedFreeMessage: boolean): Promise<void> {
    const payload: PersistedFreeMessageTrial = { hasUsedFreeMessage };
    await writeLocalStateValue(KEY_FREE_MESSAGE_TRIAL, JSON.stringify(payload));
}

async function readFreeMessageTrialStateFile(): Promise<boolean> {
    const raw = await readLocalStateValue(KEY_FREE_MESSAGE_TRIAL);
    if (raw === null) {
        return false;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<PersistedFreeMessageTrial>;
        return parsed.hasUsedFreeMessage === true;
    } catch {
        return false;
    }
}

async function writeSecureStoreValue(
    storageKey: string,
    value: string | null
): Promise<void> {
    if (value === null) {
        await SecureStore.deleteItemAsync(storageKey);
        return;
    }

    await SecureStore.setItemAsync(storageKey, value);
}

async function restoreSecureStorePair(
    key: SecureStoreKeyPair,
    previousPrimaryValue: string | null,
    previousLegacyValue: string | null
): Promise<void> {
    await writeSecureStoreValue(key.primary, previousPrimaryValue);
    await writeSecureStoreValue(key.legacy, previousLegacyValue);
}

async function setItem(key: SecureStoreKeyPair, value: string): Promise<void> {
    const previousPrimaryValue = await SecureStore.getItemAsync(key.primary);
    const previousLegacyValue = await SecureStore.getItemAsync(key.legacy);

    try {
        await writeSecureStoreValue(key.primary, value);
        await writeSecureStoreValue(key.legacy, value);
    } catch (error) {
        try {
            await restoreSecureStorePair(key, previousPrimaryValue, previousLegacyValue);
        } catch (restoreError) {
            throw new Error(
                `Failed to restore credential keys after write error (${key.primary}, ${key.legacy}): ${
                    restoreError instanceof Error ? restoreError.message : String(restoreError)
                }`
            );
        }

        throw new Error(
            `Failed to persist credential keys atomically (${key.primary}, ${key.legacy}): ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

async function getItem(key: SecureStoreKeyPair): Promise<string | null> {
    const primaryValue = await SecureStore.getItemAsync(key.primary);
    const legacyValue = await SecureStore.getItemAsync(key.legacy);

    if (primaryValue !== null && legacyValue !== null) {
        if (primaryValue !== legacyValue) {
            await setItem(key, primaryValue);
        }
        return primaryValue;
    }

    if (legacyValue !== null) {
        await setItem(key, legacyValue);
        return legacyValue;
    }

    if (primaryValue !== null) {
        await setItem(key, primaryValue);
        return primaryValue;
    }

    return null;
}

async function removeItem(key: SecureStoreKeyPair): Promise<void> {
    const previousPrimaryValue = await SecureStore.getItemAsync(key.primary);
    const previousLegacyValue = await SecureStore.getItemAsync(key.legacy);

    try {
        await writeSecureStoreValue(key.primary, null);
        await writeSecureStoreValue(key.legacy, null);
    } catch (error) {
        try {
            await restoreSecureStorePair(key, previousPrimaryValue, previousLegacyValue);
        } catch (restoreError) {
            throw new Error(
                `Failed to restore credential keys after delete error (${key.primary}, ${key.legacy}): ${
                    restoreError instanceof Error ? restoreError.message : String(restoreError)
                }`
            );
        }

        throw new Error(
            `Failed to delete credential keys atomically (${key.primary}, ${key.legacy}): ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
    await setItem(KEY_DEVICE_CREDENTIAL, creds.deviceCredential);
    await setItem(KEY_SERVER_URL, creds.serverUrl);
    await setItem(KEY_DEVICE_ID, creds.deviceId);
    await setItem(KEY_TRANSPORT_MODE, creds.transportMode);
    if (creds.certFingerprint !== null) {
        await setItem(KEY_CERT_FINGERPRINT, creds.certFingerprint);
    } else {
        await removeItem(KEY_CERT_FINGERPRINT);
    }

    if (creds.relayAccessToken !== null) {
        await setItem(KEY_RELAY_ACCESS_TOKEN, creds.relayAccessToken);
    } else {
        await removeItem(KEY_RELAY_ACCESS_TOKEN);
    }
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
    const deviceCredential = await getItem(KEY_DEVICE_CREDENTIAL);
    const serverUrl = await getItem(KEY_SERVER_URL);
    const deviceId = await getItem(KEY_DEVICE_ID);
    const transportMode = normalizeStoredTransportMode(await getItem(KEY_TRANSPORT_MODE));

    if (
        deviceCredential === null
        || serverUrl === null
        || deviceId === null
        || transportMode === null
    ) {
        return null;
    }

    const certFingerprint = await getItem(KEY_CERT_FINGERPRINT);
    const relayAccessToken = await getItem(KEY_RELAY_ACCESS_TOKEN);
    return {
        deviceCredential,
        serverUrl,
        certFingerprint,
        deviceId,
        transportMode,
        relayAccessToken,
    };
}

export async function updateStoredDeviceCredential(deviceCredential: string): Promise<void> {
    await setItem(KEY_DEVICE_CREDENTIAL, deviceCredential);
}

export async function clearCredentials(): Promise<void> {
    await removeItem(KEY_DEVICE_CREDENTIAL);
    await removeItem(KEY_SERVER_URL);
    await removeItem(KEY_CERT_FINGERPRINT);
    await removeItem(KEY_DEVICE_ID);
    await removeItem(KEY_TRANSPORT_MODE);
    await removeItem(KEY_RELAY_ACCESS_TOKEN);
    await deleteLocalStateValue(KEY_ACTIVE_SESSION_ID);
}

export async function saveActiveSessionId(sessionId: string | null): Promise<void> {
    if (sessionId === null) {
        await deleteLocalStateValue(KEY_ACTIVE_SESSION_ID);
        return;
    }

    await writeLocalStateValue(KEY_ACTIVE_SESSION_ID, sessionId);
}

export async function loadActiveSessionId(): Promise<string | null> {
    return readLocalStateValue(KEY_ACTIVE_SESSION_ID);
}

export async function saveSessionPreferences(
    preferences: StoredSessionPreferences
): Promise<void> {
    await writeLocalStateValue(KEY_SESSION_PREFERENCES, JSON.stringify(preferences));
}

export async function loadSessionPreferences(): Promise<StoredSessionPreferences | null> {
    try {
        const raw = await readLocalStateValue(KEY_SESSION_PREFERENCES);
        if (raw === null) {
            return null;
        }

        const parsed = JSON.parse(raw) as Partial<StoredSessionPreferences>;
        if (
            typeof parsed.selectedModel !== "string"
            || (parsed.reasoningEffort !== null && typeof parsed.reasoningEffort !== "string")
            || typeof parsed.agentMode !== "string"
            || typeof parsed.permissionLevel !== "string"
            || typeof parsed.autoApproveReads !== "boolean"
        ) {
            return null;
        }

        return {
            selectedModel: parsed.selectedModel,
            reasoningEffort: parsed.reasoningEffort,
            agentMode: parsed.agentMode,
            permissionLevel: parsed.permissionLevel,
            autoApproveReads: parsed.autoApproveReads,
        };
    } catch {
        return null;
    }
}

export async function saveOnboardingCompleted(completed: boolean): Promise<void> {
    await writeOnboardingStateFile(completed);
}

export async function loadOnboardingCompleted(): Promise<boolean> {
    return readOnboardingStateFile();
}

export async function saveFreeMessageTrialUsed(hasUsedFreeMessage: boolean): Promise<void> {
    await writeFreeMessageTrialStateFile(hasUsedFreeMessage);
}

export async function loadFreeMessageTrialUsed(): Promise<boolean> {
    return readFreeMessageTrialStateFile();
}

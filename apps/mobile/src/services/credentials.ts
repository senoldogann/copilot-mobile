// Persistent pairing credentials used to resume without scanning QR again.

import * as SecureStore from "expo-secure-store";
import type { TransportMode } from "@copilot-mobile/shared";

const KEY_DEVICE_CREDENTIAL = "copilot_mobile_device_credential";
const KEY_SERVER_URL = "copilot_mobile_server_url";
const KEY_CERT_FINGERPRINT = "copilot_mobile_cert_fingerprint";
const KEY_DEVICE_ID = "copilot_mobile_device_id";
const KEY_TRANSPORT_MODE = "copilot_mobile_transport_mode";
const KEY_RELAY_ACCESS_TOKEN = "copilot_mobile_relay_access_token";
const KEY_ACTIVE_SESSION_ID = "copilot_mobile_active_session_id";
const KEY_SESSION_PREFERENCES = "copilot_mobile_session_preferences";

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

async function setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
}

async function removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
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
    await removeItem(KEY_ACTIVE_SESSION_ID);
}

export async function saveActiveSessionId(sessionId: string | null): Promise<void> {
    if (sessionId === null) {
        await removeItem(KEY_ACTIVE_SESSION_ID);
        return;
    }

    await setItem(KEY_ACTIVE_SESSION_ID, sessionId);
}

export async function loadActiveSessionId(): Promise<string | null> {
    return getItem(KEY_ACTIVE_SESSION_ID);
}

export async function saveSessionPreferences(
    preferences: StoredSessionPreferences
): Promise<void> {
    await setItem(KEY_SESSION_PREFERENCES, JSON.stringify(preferences));
}

export async function loadSessionPreferences(): Promise<StoredSessionPreferences | null> {
    try {
        const raw = await getItem(KEY_SESSION_PREFERENCES);
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

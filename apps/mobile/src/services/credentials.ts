// Kal\u0131c\u0131 pairing kimlik bilgileri: JWT, server URL, cert fingerprint, device ID.
// App restart sonras\u0131 QR taramadan otomatik yeniden ba\u011flanma i\u00e7in kullan\u0131l\u0131r.

import * as SecureStore from "expo-secure-store";

const KEY_JWT = "copilot_mobile_jwt";
const KEY_SERVER_URL = "copilot_mobile_server_url";
const KEY_CERT_FINGERPRINT = "copilot_mobile_cert_fingerprint";
const KEY_DEVICE_ID = "copilot_mobile_device_id";
const KEY_ACTIVE_SESSION_ID = "copilot_mobile_active_session_id";

export type StoredCredentials = {
    jwt: string;
    serverUrl: string;
    certFingerprint: string | null;
    deviceId: string;
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
    await setItem(KEY_JWT, creds.jwt);
    await setItem(KEY_SERVER_URL, creds.serverUrl);
    await setItem(KEY_DEVICE_ID, creds.deviceId);
    if (creds.certFingerprint !== null) {
        await setItem(KEY_CERT_FINGERPRINT, creds.certFingerprint);
    } else {
        await removeItem(KEY_CERT_FINGERPRINT);
    }
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
    const jwt = await getItem(KEY_JWT);
    const serverUrl = await getItem(KEY_SERVER_URL);
    const deviceId = await getItem(KEY_DEVICE_ID);
    if (jwt === null || serverUrl === null || deviceId === null) {
        return null;
    }
    const certFingerprint = await getItem(KEY_CERT_FINGERPRINT);
    return { jwt, serverUrl, certFingerprint, deviceId };
}

export async function updateStoredJWT(jwt: string): Promise<void> {
    await setItem(KEY_JWT, jwt);
}

export async function clearCredentials(): Promise<void> {
    await removeItem(KEY_JWT);
    await removeItem(KEY_SERVER_URL);
    await removeItem(KEY_CERT_FINGERPRINT);
    await removeItem(KEY_DEVICE_ID);
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

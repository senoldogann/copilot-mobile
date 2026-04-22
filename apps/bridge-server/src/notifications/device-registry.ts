import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
    NotificationPlatform,
    NotificationPresenceState,
    NotificationProvider,
} from "@copilot-mobile/shared";
import { getConfigDir } from "../auth/certs.js";

const DEVICE_REGISTRY_FILENAME = "notification-devices.json";

type PersistedPushRegistration = {
    provider: NotificationProvider;
    pushToken: string;
    platform: NotificationPlatform;
    appVersion?: string;
    updatedAt: number;
};

type PersistedDeviceRegistry = {
    version: 1;
    devices: Record<string, PersistedPushRegistration>;
};

type ConnectionState = {
    connectionId: string;
    connectedAt: number;
};

export type PushRegistrationRecord = PersistedPushRegistration;

export type DevicePresenceRecord = {
    connectionId: string;
    state: NotificationPresenceState;
    timestamp: number;
    receivedAt: number;
};

function createEmptyRegistry(): PersistedDeviceRegistry {
    return {
        version: 1,
        devices: {},
    };
}

function isPersistedPushRegistration(value: unknown): value is PersistedPushRegistration {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (record["provider"] === "expo")
        && typeof record["pushToken"] === "string"
        && record["pushToken"].trim().length > 0
        && (record["platform"] === "ios" || record["platform"] === "android")
        && typeof record["updatedAt"] === "number"
        && Number.isFinite(record["updatedAt"])
        && (
            record["appVersion"] === undefined
            || (typeof record["appVersion"] === "string" && record["appVersion"].trim().length > 0)
        );
}

function readPersistedRegistry(filePath: string): PersistedDeviceRegistry {
    if (!existsSync(filePath)) {
        return createEmptyRegistry();
    }

    try {
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            return createEmptyRegistry();
        }

        const value = raw as Record<string, unknown>;
        if (value["version"] !== 1) {
            return createEmptyRegistry();
        }

        const rawDevices = value["devices"];
        if (typeof rawDevices !== "object" || rawDevices === null || Array.isArray(rawDevices)) {
            return createEmptyRegistry();
        }

        const devices: Record<string, PersistedPushRegistration> = {};
        for (const [deviceId, entry] of Object.entries(rawDevices)) {
            if (deviceId.trim().length === 0 || !isPersistedPushRegistration(entry)) {
                continue;
            }

            devices[deviceId] = entry;
        }

        return {
            version: 1,
            devices,
        };
    } catch (error) {
        console.warn("[notifications] Failed to read device registry", {
            filePath,
            error: error instanceof Error ? error.message : String(error),
        });
        return createEmptyRegistry();
    }
}

function persistRegistry(filePath: string, registrations: ReadonlyMap<string, PersistedPushRegistration>): void {
    const payload: PersistedDeviceRegistry = {
        version: 1,
        devices: Object.fromEntries(registrations.entries()),
    };
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(tmpPath, filePath);
    chmodSync(filePath, 0o600);
}

export function createDeviceRegistry() {
    const filePath = join(getConfigDir(), DEVICE_REGISTRY_FILENAME);
    const persisted = readPersistedRegistry(filePath);
    const registrations = new Map<string, PersistedPushRegistration>(Object.entries(persisted.devices));
    const connections = new Map<string, ConnectionState>();
    const presences = new Map<string, DevicePresenceRecord>();

    function writeRegistry(): void {
        persistRegistry(filePath, registrations);
    }

    return {
        registerPushTarget(input: {
            deviceId: string;
            provider: NotificationProvider;
            pushToken: string;
            platform: NotificationPlatform;
            appVersion?: string;
        }): void {
            const nextRecord: PersistedPushRegistration = {
                provider: input.provider,
                pushToken: input.pushToken,
                platform: input.platform,
                updatedAt: Date.now(),
                ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
            };
            registrations.set(input.deviceId, nextRecord);
            writeRegistry();
        },

        unregisterPushTarget(deviceId: string): void {
            registrations.delete(deviceId);
            writeRegistry();
        },

        getPushTarget(deviceId: string): PushRegistrationRecord | null {
            return registrations.get(deviceId) ?? null;
        },

        markConnected(deviceId: string, connectionId: string): void {
            connections.set(deviceId, {
                connectionId,
                connectedAt: Date.now(),
            });
            presences.delete(deviceId);
        },

        markDisconnected(deviceId: string, connectionId: string): void {
            const current = connections.get(deviceId);
            if (current === undefined || current.connectionId !== connectionId) {
                return;
            }

            connections.delete(deviceId);
            presences.delete(deviceId);
        },

        updatePresence(input: {
            deviceId: string;
            connectionId: string;
            state: NotificationPresenceState;
            timestamp: number;
        }): void {
            const currentConnection = connections.get(input.deviceId);
            if (currentConnection === undefined || currentConnection.connectionId !== input.connectionId) {
                return;
            }

            const currentPresence = presences.get(input.deviceId);
            if (
                currentPresence !== undefined
                && currentPresence.connectionId === input.connectionId
                && input.timestamp < currentPresence.timestamp
            ) {
                return;
            }

            presences.set(input.deviceId, {
                connectionId: input.connectionId,
                state: input.state,
                timestamp: input.timestamp,
                receivedAt: Date.now(),
            });
        },

        getPresence(deviceId: string): DevicePresenceRecord | null {
            return presences.get(deviceId) ?? null;
        },

        isConnected(deviceId: string): boolean {
            return connections.has(deviceId);
        },
    };
}

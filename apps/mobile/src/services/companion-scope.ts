const DEFAULT_COMPANION_SCOPE_KEY = "default";

let currentCompanionScopeKey = DEFAULT_COMPANION_SCOPE_KEY;

function sanitizeScopeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getDefaultCompanionScopeKey(): string {
    return DEFAULT_COMPANION_SCOPE_KEY;
}

export function getCompanionScopeKey(deviceId: string | null | undefined): string {
    if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
        return DEFAULT_COMPANION_SCOPE_KEY;
    }

    return `device_${sanitizeScopeSegment(deviceId.trim())}`;
}

export function getCurrentCompanionScopeKey(): string {
    return currentCompanionScopeKey;
}

export function setCurrentCompanionScopeKey(scopeKey: string): void {
    currentCompanionScopeKey = scopeKey.trim().length > 0
        ? scopeKey
        : DEFAULT_COMPANION_SCOPE_KEY;
}

export function getScopedStorageKey(baseKey: string, scopeKey: string): string {
    if (scopeKey === DEFAULT_COMPANION_SCOPE_KEY) {
        return baseKey;
    }

    return `${baseKey}.${scopeKey}`;
}

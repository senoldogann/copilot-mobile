import Constants from "expo-constants";

const FALLBACK_APP_NAME = "Code Companion";
const FALLBACK_APP_VERSION = "1.0.0";

function normalizeMetadataValue(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

export function readAppName(): string {
    return normalizeMetadataValue(Constants.expoConfig?.name)
        ?? FALLBACK_APP_NAME;
}

export function readAppVersion(): string {
    return normalizeMetadataValue(Constants.expoConfig?.version)
        ?? FALLBACK_APP_VERSION;
}

import Application from "expo-application";
import Constants from "expo-constants";

const FALLBACK_APP_NAME = "Code Companion";
const FALLBACK_APP_VERSION = "0.1.5";

function normalizeMetadataValue(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

export function readAppName(): string {
    return normalizeMetadataValue(Application.applicationName)
        ?? normalizeMetadataValue(Constants.expoConfig?.name)
        ?? FALLBACK_APP_NAME;
}

export function readAppVersion(): string {
    return normalizeMetadataValue(Application.nativeApplicationVersion)
        ?? normalizeMetadataValue(Constants.expoConfig?.version)
        ?? FALLBACK_APP_VERSION;
}

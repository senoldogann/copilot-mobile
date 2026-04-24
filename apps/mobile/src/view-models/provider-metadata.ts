import type { ConnectionState } from "../services/ws-client";

export type ProviderKind = "local" | "copilot_cli" | "cloud";
export type ProviderSourceType = "saved_workspace" | "draft" | "cli_session" | "cloud_cache";
export type ProviderRemoteAvailability = "live" | "available" | "offline" | "cache_only";
export type ProviderSyncFreshness = "fresh" | "stale" | "none";
export type ProviderResumeResult = "idle" | "success" | "failed";
export type ProviderMetadataChipTone = "neutral" | "success" | "warning" | "danger";

export type ProviderMetadataChip = {
    label: string;
    tone: ProviderMetadataChipTone;
};

export type ProviderMetadata = {
    kind: ProviderKind;
    sourceType: ProviderSourceType;
    remoteAvailability: ProviderRemoteAvailability;
    syncFreshness: ProviderSyncFreshness;
    lastResumeResult: ProviderResumeResult;
    lastSyncText: string | null;
    chips: ReadonlyArray<ProviderMetadataChip>;
};

export type DrawerMetadataChip = ProviderMetadataChip;
export type DrawerMetadataChipTone = ProviderMetadataChipTone;
export type DrawerProviderMetadata = ProviderMetadata;
export type DrawerResumeResult = ProviderResumeResult;

const RECENT_SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

function isFreshSync(timestamp: number | null, now: number): boolean {
    return timestamp !== null && now - timestamp <= RECENT_SYNC_WINDOW_MS;
}

export function formatRelativeTimestamp(timestamp: number | null, now: number): string {
    if (timestamp === null) {
        return "never";
    }

    const diffMs = Math.max(0, now - timestamp);
    const diffMinutes = Math.floor(diffMs / 60_000);
    if (diffMinutes < 1) {
        return "just now";
    }
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 5) {
        return `${diffWeeks}w ago`;
    }

    return new Date(timestamp).toLocaleDateString();
}

export function isRecentCloudSync(timestamp: number | null, now: number): boolean {
    return isFreshSync(timestamp, now);
}

function appendResumeFailureChip(
    chips: Array<ProviderMetadataChip>,
    lastResumeResult: ProviderResumeResult
): void {
    if (lastResumeResult === "failed") {
        chips.push({ label: "Resume failed", tone: "danger" });
    }
}

export function buildLocalDraftMetadata(): ProviderMetadata {
    return {
        kind: "local",
        sourceType: "draft",
        remoteAvailability: "cache_only",
        syncFreshness: "none",
        lastResumeResult: "idle",
        lastSyncText: null,
        chips: [
            { label: "Draft", tone: "neutral" },
        ],
    };
}

export function buildSavedWorkspaceMetadata(
    lastUsedAt: number | null,
    now: number
): ProviderMetadata {
    return {
        kind: "local",
        sourceType: "saved_workspace",
        remoteAvailability: "cache_only",
        syncFreshness: isFreshSync(lastUsedAt, now) ? "fresh" : "stale",
        lastResumeResult: "idle",
        lastSyncText: lastUsedAt === null
            ? "Saved locally"
            : `Last used ${formatRelativeTimestamp(lastUsedAt, now)}`,
        chips: [],
    };
}

export function buildCopilotCliMetadata(
    lastActiveAt: number,
    lastResumeResult: ProviderResumeResult,
    now: number
): ProviderMetadata {
    const chips: Array<ProviderMetadataChip> = [];

    appendResumeFailureChip(chips, lastResumeResult);

    return {
        kind: "copilot_cli",
        sourceType: "cli_session",
        remoteAvailability: "live",
        syncFreshness: isFreshSync(lastActiveAt, now) ? "fresh" : "stale",
        lastResumeResult,
        lastSyncText: `Last active ${formatRelativeTimestamp(lastActiveAt, now)}`,
        chips,
    };
}

export function buildCloudConversationMetadata(
    lastSyncedAt: number | null,
    sessionId: string | null,
    remoteSessionAvailable: boolean,
    lastResumeResult: ProviderResumeResult,
    now: number
): ProviderMetadata {
    const recent = isFreshSync(lastSyncedAt, now);
    const remoteAvailability: ProviderRemoteAvailability = sessionId === null
        ? "cache_only"
        : remoteSessionAvailable
            ? "available"
            : "cache_only";

    const chips: Array<ProviderMetadataChip> = [];
    if (!recent) {
        chips.push({ label: "Cached", tone: "warning" });
    }
    if (sessionId !== null && !remoteSessionAvailable) {
        chips.push({ label: "Remote unavailable", tone: "warning" });
    }

    appendResumeFailureChip(chips, lastResumeResult);

    return {
        kind: "cloud",
        sourceType: "cloud_cache",
        remoteAvailability,
        syncFreshness: recent ? "fresh" : "stale",
        lastResumeResult,
        lastSyncText: `Last sync ${formatRelativeTimestamp(lastSyncedAt, now)}`,
        chips,
    };
}

export function buildConnectionDiagnosticsMetadata(
    serverUrl: string | null,
    connectionState: ConnectionState,
    now: number
): ProviderMetadata {
    if (serverUrl !== null && serverUrl.includes("/connect/mobile/")) {
        return {
            kind: "cloud",
            sourceType: "cloud_cache",
            remoteAvailability: connectionState === "authenticated" ? "live" : "offline",
            syncFreshness: "none",
            lastResumeResult: "idle",
            lastSyncText: `Observed ${formatRelativeTimestamp(now, now)}`,
            chips: [
                {
                    label: connectionState === "authenticated" ? "Relay connected" : "Relay offline",
                    tone: connectionState === "authenticated" ? "success" : "warning",
                },
            ],
        };
    }

    if (serverUrl !== null) {
        return {
            kind: "copilot_cli",
            sourceType: "cli_session",
            remoteAvailability: connectionState === "authenticated" ? "live" : "offline",
            syncFreshness: "none",
            lastResumeResult: "idle",
            lastSyncText: `Observed ${formatRelativeTimestamp(now, now)}`,
            chips: [
                {
                    label: connectionState === "authenticated" ? "Connected" : "Disconnected",
                    tone: connectionState === "authenticated" ? "success" : "warning",
                },
            ],
        };
    }

    return {
        kind: "local",
        sourceType: "saved_workspace",
        remoteAvailability: "cache_only",
        syncFreshness: "none",
        lastResumeResult: "idle",
        lastSyncText: null,
        chips: [
            { label: "Not paired", tone: "warning" },
        ],
    };
}

export function buildArchivedConversationMetadata(
    sessionId: string | null,
    workspaceRoot: string | null,
    lastSyncedAt: number | null,
    connectionState: ConnectionState,
    lastResumeResult: ProviderResumeResult,
    now: number
): ProviderMetadata {
    if (sessionId === null) {
        return buildLocalDraftMetadata();
    }

    const metadata = workspaceRoot === null
        ? buildCloudConversationMetadata(
            lastSyncedAt,
            sessionId,
            connectionState === "authenticated",
            lastResumeResult,
            now,
        )
        : buildCopilotCliMetadata(
            lastSyncedAt ?? now,
            lastResumeResult,
            now,
        );

    return metadata;
}

// Rate limiter — sliding window counter pattern

import {
    RATE_LIMIT_PAIRING_MAX,
    RATE_LIMIT_PAIRING_WINDOW_MS,
    RATE_LIMIT_MESSAGE_MAX,
    RATE_LIMIT_MESSAGE_WINDOW_MS,
    REPLAY_WINDOW_MS,
} from "@copilot-mobile/shared";

const REPLAY_CLEANUP_INTERVAL_MS = 60_000;
const MAX_TRACKED_WINDOW_KEYS = 4_096;
const MAX_REPLAY_IDS = 20_000;

type WindowEntry = {
    timestamps: number[];
};

const pairingWindows = new Map<string, WindowEntry>();
const messageWindows = new Map<string, WindowEntry>();
const seenMessageIds = new Map<string, number>();

// Periodic cleanup — prevents memory leaks
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function pruneWindowEntry(entry: WindowEntry, windowMs: number, now: number): void {
    entry.timestamps = entry.timestamps.filter((timestamp) => now - timestamp < windowMs);
}

function pruneWindowMap(
    windows: Map<string, WindowEntry>,
    windowMs: number,
    now: number
): void {
    for (const [key, entry] of windows) {
        pruneWindowEntry(entry, windowMs, now);
        if (entry.timestamps.length === 0) {
            windows.delete(key);
        }
    }
}

function evictOldestWindowEntries(
    windows: Map<string, WindowEntry>,
    maxKeys: number
): void {
    while (windows.size > maxKeys) {
        let oldestKey: string | null = null;
        let oldestTimestamp = Number.POSITIVE_INFINITY;

        for (const [key, entry] of windows) {
            const firstTimestamp = entry.timestamps[0];
            if (firstTimestamp !== undefined && firstTimestamp < oldestTimestamp) {
                oldestTimestamp = firstTimestamp;
                oldestKey = key;
            }
        }

        if (oldestKey === null) {
            break;
        }

        windows.delete(oldestKey);
    }
}

function enforceWindowCapacity(
    windows: Map<string, WindowEntry>,
    windowMs: number,
    now: number
): void {
    if (windows.size <= MAX_TRACKED_WINDOW_KEYS) {
        return;
    }

    pruneWindowMap(windows, windowMs, now);

    if (windows.size <= MAX_TRACKED_WINDOW_KEYS) {
        return;
    }

    evictOldestWindowEntries(windows, MAX_TRACKED_WINDOW_KEYS);
}

function pruneReplayMap(now: number): void {
    for (const [id, timestamp] of seenMessageIds) {
        if (now - timestamp > REPLAY_WINDOW_MS) {
            seenMessageIds.delete(id);
        }
    }
}

function enforceReplayCapacity(now: number): void {
    if (seenMessageIds.size < MAX_REPLAY_IDS) {
        return;
    }

    pruneReplayMap(now);

    while (seenMessageIds.size >= MAX_REPLAY_IDS) {
        const oldestKey = seenMessageIds.keys().next().value;
        if (oldestKey === undefined) {
            break;
        }

        seenMessageIds.delete(oldestKey);
    }
}

function startReplayCleanup(): void {
    if (cleanupTimer !== null) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        pruneReplayMap(now);
        pruneWindowMap(pairingWindows, RATE_LIMIT_PAIRING_WINDOW_MS, now);
        pruneWindowMap(messageWindows, RATE_LIMIT_MESSAGE_WINDOW_MS, now);
    }, REPLAY_CLEANUP_INTERVAL_MS);
    // Don't let timer keep the process alive
    cleanupTimer.unref();
}

function checkLimit(
    windows: Map<string, WindowEntry>,
    key: string,
    maxCount: number,
    windowMs: number
): boolean {
    startReplayCleanup();

    const now = Date.now();
    let entry = windows.get(key);

    if (entry === undefined) {
        entry = { timestamps: [] };
        windows.set(key, entry);
    }

    pruneWindowEntry(entry, windowMs, now);

    if (entry.timestamps.length >= maxCount) {
        enforceWindowCapacity(windows, windowMs, now);
        return false;
    }

    entry.timestamps.push(now);
    enforceWindowCapacity(windows, windowMs, now);
    return true;
}

export function checkPairingRateLimit(ip: string): boolean {
    return checkLimit(
        pairingWindows,
        ip,
        RATE_LIMIT_PAIRING_MAX,
        RATE_LIMIT_PAIRING_WINDOW_MS
    );
}

export function checkMessageRateLimit(deviceId: string): boolean {
    return checkLimit(
        messageWindows,
        deviceId,
        RATE_LIMIT_MESSAGE_MAX,
        RATE_LIMIT_MESSAGE_WINDOW_MS
    );
}

export function checkReplayProtection(messageId: string): boolean {
    // Start periodic cleanup on first call
    startReplayCleanup();

    const now = Date.now();

    if (seenMessageIds.has(messageId)) {
        return false;
    }

    enforceReplayCapacity(now);
    seenMessageIds.set(messageId, now);
    return true;
}

export function clearRateLimitState(): void {
    pairingWindows.clear();
    messageWindows.clear();
    seenMessageIds.clear();
    if (cleanupTimer !== null) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

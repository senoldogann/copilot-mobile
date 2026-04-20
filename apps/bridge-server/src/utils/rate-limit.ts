// Rate limiter — sliding window counter pattern

import {
    RATE_LIMIT_PAIRING_MAX,
    RATE_LIMIT_PAIRING_WINDOW_MS,
    RATE_LIMIT_MESSAGE_MAX,
    RATE_LIMIT_MESSAGE_WINDOW_MS,
    REPLAY_WINDOW_MS,
} from "@copilot-mobile/shared";

const REPLAY_CLEANUP_INTERVAL_MS = 60_000;

type WindowEntry = {
    timestamps: number[];
};

const pairingWindows = new Map<string, WindowEntry>();
const messageWindows = new Map<string, WindowEntry>();
const seenMessageIds = new Map<string, number>();

// Periodic cleanup — prevents memory leaks
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startReplayCleanup(): void {
    if (cleanupTimer !== null) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, timestamp] of seenMessageIds) {
            if (now - timestamp > REPLAY_WINDOW_MS) {
                seenMessageIds.delete(id);
            }
        }
        // Rate limit penceresi temizliği
        for (const [key, entry] of pairingWindows) {
            entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_PAIRING_WINDOW_MS);
            if (entry.timestamps.length === 0) pairingWindows.delete(key);
        }
        for (const [key, entry] of messageWindows) {
            entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_MESSAGE_WINDOW_MS);
            if (entry.timestamps.length === 0) messageWindows.delete(key);
        }
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
    const now = Date.now();
    let entry = windows.get(key);

    if (entry === undefined) {
        entry = { timestamps: [] };
        windows.set(key, entry);
    }

    // Clean up old records
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxCount) {
        return false;
    }

    entry.timestamps.push(now);
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

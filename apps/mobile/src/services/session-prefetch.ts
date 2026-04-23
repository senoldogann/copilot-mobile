const PREFETCH_TTL_MS = 30_000;

type PrefetchStage = "resume" | "history";

type PrefetchEntry = {
    stage: PrefetchStage;
    expiresAt: number;
};

const prefetchedSessions = new Map<string, PrefetchEntry>();

function pruneExpiredPrefetches(now: number): void {
    for (const [sessionId, entry] of prefetchedSessions.entries()) {
        if (entry.expiresAt <= now) {
            prefetchedSessions.delete(sessionId);
        }
    }
}

function setPrefetchStage(sessionId: string, stage: PrefetchStage): void {
    const now = Date.now();
    pruneExpiredPrefetches(now);
    prefetchedSessions.set(sessionId, {
        stage,
        expiresAt: now + PREFETCH_TTL_MS,
    });
}

export function markSessionPrefetchRequest(sessionId: string): void {
    setPrefetchStage(sessionId, "resume");
}

export function consumeSessionPrefetchResume(sessionId: string): boolean {
    const now = Date.now();
    pruneExpiredPrefetches(now);
    const entry = prefetchedSessions.get(sessionId);
    if (entry?.stage !== "resume") {
        return false;
    }

    prefetchedSessions.set(sessionId, {
        stage: "history",
        expiresAt: now + PREFETCH_TTL_MS,
    });
    return true;
}

export function consumeSessionPrefetchHistory(sessionId: string): boolean {
    const now = Date.now();
    pruneExpiredPrefetches(now);
    const entry = prefetchedSessions.get(sessionId);
    if (entry?.stage !== "history") {
        return false;
    }

    prefetchedSessions.delete(sessionId);
    return true;
}

export function clearSessionPrefetch(sessionId: string): void {
    prefetchedSessions.delete(sessionId);
}

import type { SessionInfo } from "@copilot-mobile/shared";
import { MODEL_UNKNOWN } from "@copilot-mobile/shared";

export type WorkspaceSessionEntry = {
    key: string;
    primarySession: SessionInfo;
    sessions: ReadonlyArray<SessionInfo>;
    duplicateCount: number;
    title: string;
    preview: string;
};

export type WorkspaceGroup = {
    workspace: string;
    displayName: string;
    entries: ReadonlyArray<WorkspaceSessionEntry>;
    totalSessions: number;
};

function extractPathName(value: string): string {
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? value;
}

function extractRepositoryName(repository: string): string {
    const sanitized = repository.replace(/\.git$/, "");
    const parts = sanitized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? sanitized;
}

function getWorkspaceKey(session: SessionInfo): string {
    const context = session.context;

    if (context?.workspaceRoot !== undefined && context.workspaceRoot.length > 0) {
        return context.workspaceRoot;
    }

    if (context?.gitRoot !== undefined && context.gitRoot.length > 0) {
        return context.gitRoot;
    }

    if (context?.repository !== undefined && context.repository.length > 0) {
        return context.repository;
    }

    return "__none__";
}

function getWorkspaceDisplayName(session: SessionInfo): string {
    const context = session.context;

    if (context?.workspaceRoot !== undefined && context.workspaceRoot.length > 0) {
        return extractPathName(context.workspaceRoot);
    }

    const workspaceKey = context?.gitRoot ?? context?.workspaceRoot ?? "__none__";
    if (workspaceKey === "__none__") {
        return "Other";
    }

    if (context?.repository !== undefined && context.repository.length > 0) {
        return extractRepositoryName(context.repository);
    }

    return extractPathName(workspaceKey);
}

export function formatSessionTitle(session: SessionInfo): string {
    const summary = session.summary?.trim();
    if (
        summary !== undefined
        && summary.length > 0
        && !summary.startsWith("You are ")
        && !summary.startsWith("You're ")
        && !summary.startsWith("You have ")
        && summary.length < 200
    ) {
        return summary.length > 55 ? summary.slice(0, 52) + "…" : summary;
    }

    if (session.context?.repository !== undefined) {
        const repo = extractRepositoryName(session.context.repository);
        const branch = session.context.branch !== undefined ? ` · ${session.context.branch}` : "";
        return repo + branch;
    }

    if (session.context?.branch !== undefined) {
        return session.context.branch;
    }

    const diff = Date.now() - session.createdAt;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Session · just now";
    if (mins < 60) return `Session · ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Session · ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Session · ${days}d ago`;
    return `Session · ${Math.floor(days / 7)}w ago`;
}

export function formatSessionPreview(session: SessionInfo): string {
    const previewParts = [
        session.context?.branch,
        session.model !== MODEL_UNKNOWN ? session.model : null,
    ].filter((value): value is string => value !== undefined && value !== null && value.length > 0);

    return previewParts.join(" · ");
}

function sortSessionsByLatest(sessions: ReadonlyArray<SessionInfo>): Array<SessionInfo> {
    return [...sessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
}

export function buildWorkspaceGroups(
    sessions: ReadonlyArray<SessionInfo>,
    savedWorkspaceRoots: ReadonlyArray<string> = []
): ReadonlyArray<WorkspaceGroup> {
    const workspaceMap = new Map<string, Array<SessionInfo>>();

    for (const session of sessions) {
        const workspaceKey = getWorkspaceKey(session);
        const existing = workspaceMap.get(workspaceKey);
        if (existing !== undefined) {
            existing.push(session);
            continue;
        }
        workspaceMap.set(workspaceKey, [session]);
    }

    for (const savedWorkspaceRoot of savedWorkspaceRoots) {
        if (!workspaceMap.has(savedWorkspaceRoot)) {
            workspaceMap.set(savedWorkspaceRoot, []);
        }
    }

    const groups: Array<WorkspaceGroup> = [];

    for (const [workspaceKey, groupSessions] of workspaceMap.entries()) {
        const sortedSessions = sortSessionsByLatest(groupSessions);
        const entries = sortedSessions.map((session) => ({
            key: session.id,
            primarySession: session,
            sessions: [session],
            duplicateCount: 0,
            title: formatSessionTitle(session),
            preview: formatSessionPreview(session),
        } satisfies WorkspaceSessionEntry));

        const primarySession = sortedSessions[0];
        groups.push({
            workspace: workspaceKey,
            displayName: primarySession !== undefined
                ? (primarySession.context?.repository !== undefined && primarySession.context.repository.length > 0
                    ? getWorkspaceDisplayName(primarySession)
                    : extractPathName(workspaceKey === "__none__" ? "Other" : workspaceKey))
                : extractPathName(workspaceKey === "__none__" ? "Other" : workspaceKey),
            entries,
            totalSessions: groupSessions.length,
        });
    }

    groups.sort((left, right) => {
        const leftLatest = left.entries[0]?.primarySession.lastActiveAt ?? 0;
        const rightLatest = right.entries[0]?.primarySession.lastActiveAt ?? 0;
        if (leftLatest !== rightLatest) {
            return rightLatest - leftLatest;
        }
        return left.displayName.localeCompare(right.displayName);
    });

    return groups;
}

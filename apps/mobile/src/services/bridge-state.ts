import type { ConnectionState } from "./ws-client";
import { useConnectionStore } from "../stores/connection-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";

export function getBridgeSessionState() {
    return useSessionStore.getState();
}

export function getBridgeConnectionState() {
    return useConnectionStore.getState();
}

export function getBridgeWorkspaceState() {
    return useWorkspaceStore.getState();
}

export function setBridgeConnectionState(state: ConnectionState): void {
    useConnectionStore.getState().setState(state);
}

export function setBridgeConnectionError(error: string | null): void {
    useConnectionStore.getState().setError(error);
}

export function setBridgeServerInfo(serverUrl: string, certFingerprint: string | null): void {
    useConnectionStore.getState().setServerInfo(serverUrl, certFingerprint);
}

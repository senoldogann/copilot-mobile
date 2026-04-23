import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

let currentAppVisibilityState: AppStateStatus = AppState.currentState;
const listeners = new Set<() => void>();

export function getAppVisibilityState(): AppStateStatus {
    return currentAppVisibilityState;
}

export function setAppVisibilityState(nextState: AppStateStatus): void {
    if (currentAppVisibilityState === nextState) {
        return;
    }

    currentAppVisibilityState = nextState;
    for (const listener of listeners) {
        listener();
    }
}

export function isAppActive(): boolean {
    return currentAppVisibilityState === "active";
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useAppIsActive(): boolean {
    return useSyncExternalStore(subscribe, isAppActive, isAppActive);
}

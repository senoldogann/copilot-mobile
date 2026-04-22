import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

let currentAppVisibilityState: AppStateStatus = AppState.currentState;

export function getAppVisibilityState(): AppStateStatus {
    return currentAppVisibilityState;
}

export function setAppVisibilityState(nextState: AppStateStatus): void {
    currentAppVisibilityState = nextState;
}

export function isAppActive(): boolean {
    return currentAppVisibilityState === "active";
}

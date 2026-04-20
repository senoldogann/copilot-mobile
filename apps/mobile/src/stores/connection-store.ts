// Connection state management — Zustand store
// QR scanning, WebSocket connection, authentication state

import { create } from "zustand";
import type { ConnectionState } from "../services/ws-client.js";

export type ConnectionStore = {
    state: ConnectionState;
    serverUrl: string | null;
    certFingerprint: string | null;
    deviceId: string | null;
    error: string | null;
    setState: (state: ConnectionState) => void;
    setServerInfo: (url: string, fingerprint: string | null) => void;
    setDeviceId: (deviceId: string) => void;
    setError: (error: string | null) => void;
    reset: () => void;
};

export const useConnectionStore = create<ConnectionStore>((set) => ({
    state: "disconnected",
    serverUrl: null,
    certFingerprint: null,
    deviceId: null,
    error: null,

    setState: (state) => {
        const clearError = state === "authenticated" || state === "connected";
        set(clearError ? { state, error: null } : { state });
    },

    setServerInfo: (url, fingerprint) =>
        set({ serverUrl: url, certFingerprint: fingerprint }),

    setDeviceId: (deviceId) => set({ deviceId }),

    setError: (error) => set({ error }),

    reset: () =>
        set({
            state: "disconnected",
            serverUrl: null,
            certFingerprint: null,
            deviceId: null,
            error: null,
        }),
}));

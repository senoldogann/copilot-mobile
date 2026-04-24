import { create } from "zustand";
import type { CustomerInfo, PurchasesOffering } from "react-native-purchases";

export type SubscriptionStoreStatus = "idle" | "loading" | "ready" | "error";

type SubscriptionSnapshot = {
    customerInfo: CustomerInfo | null;
    offering: PurchasesOffering | null;
    hasActiveEntitlement: boolean;
};

type SubscriptionStoreState = SubscriptionSnapshot & {
    entitlementId: string | null;
    initialized: boolean;
    status: SubscriptionStoreStatus;
    lastError: string | null;
    setSnapshot: (snapshot: SubscriptionSnapshot) => void;
    setStatus: (status: SubscriptionStoreStatus) => void;
    setInitialized: (initialized: boolean) => void;
    setLastError: (lastError: string | null) => void;
    setEntitlementId: (entitlementId: string | null) => void;
};

const initialSnapshot: SubscriptionSnapshot = {
    customerInfo: null,
    offering: null,
    hasActiveEntitlement: false,
};

export const useSubscriptionStore = create<SubscriptionStoreState>((set) => ({
    ...initialSnapshot,
    entitlementId: null,
    initialized: false,
    status: "idle",
    lastError: null,
    setSnapshot: (snapshot) =>
        set({
            customerInfo: snapshot.customerInfo,
            offering: snapshot.offering,
            hasActiveEntitlement: snapshot.hasActiveEntitlement,
        }),
    setStatus: (status) => set({ status }),
    setInitialized: (initialized) => set({ initialized }),
    setLastError: (lastError) => set({ lastError }),
    setEntitlementId: (entitlementId) => set({ entitlementId }),
}));

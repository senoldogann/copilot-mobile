import Constants from "expo-constants";
import { Linking, Platform } from "react-native";
import Purchases, {
    LOG_LEVEL,
    PURCHASES_ERROR_CODE,
    type CustomerInfo,
    type PurchasesOffering,
    type PurchasesPackage,
    type PurchasesError,
} from "react-native-purchases";
import RevenueCatUI from "react-native-purchases-ui";
import { useSubscriptionStore } from "../stores/subscription-store";

type ExpoExtra = {
    revenueCatApiKey?: string;
    revenueCatEntitlementId?: string;
};

type RevenueCatSnapshot = {
    customerInfo: CustomerInfo;
    offering: PurchasesOffering | null;
    hasActiveEntitlement: boolean;
};

let configurePromise: Promise<void> | null = null;
let customerInfoListenerRegistered = false;
let revenueCatLogHandlerRegistered = false;

function getExpoExtra(): ExpoExtra {
    const extra = Constants.expoConfig?.extra;
    if (typeof extra !== "object" || extra === null) {
        return {};
    }

    return extra as ExpoExtra;
}

function getRequiredRevenueCatApiKey(): string {
    const apiKey = getExpoExtra().revenueCatApiKey;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
        throw new Error(
            "RevenueCat API key is missing. Set expo.extra.revenueCatApiKey in app.json."
        );
    }

    return apiKey;
}

export function getRequiredRevenueCatEntitlementId(): string {
    const entitlementId = getExpoExtra().revenueCatEntitlementId;
    if (typeof entitlementId !== "string" || entitlementId.trim().length === 0) {
        throw new Error(
            "RevenueCat entitlement identifier is missing. Set expo.extra.revenueCatEntitlementId in app.json."
        );
    }

    return entitlementId;
}

function hasActiveEntitlement(customerInfo: CustomerInfo, entitlementId: string): boolean {
    return customerInfo.entitlements.active[entitlementId] !== undefined;
}

function applyRevenueCatSnapshot(snapshot: RevenueCatSnapshot): void {
    useSubscriptionStore.getState().setSnapshot({
        customerInfo: snapshot.customerInfo,
        offering: snapshot.offering,
        hasActiveEntitlement: snapshot.hasActiveEntitlement,
    });
    useSubscriptionStore.getState().setStatus("ready");
    useSubscriptionStore.getState().setLastError(null);
}

function ensureRevenueCatLogHandlerRegistered(): void {
    if (revenueCatLogHandlerRegistered) {
        return;
    }

    revenueCatLogHandlerRegistered = true;
    Purchases.setLogHandler((logLevel, message) => {
        const normalizedMessage = message.toLowerCase();
        const isKnownOfferings404 =
            normalizedMessage.includes("error fetching offerings")
            || normalizedMessage.includes("api request failed with status code 404");

        if (isKnownOfferings404) {
            console.warn(`[RevenueCat] ${message}`);
            return;
        }

        const formattedMessage = `[RevenueCat] ${message}`;
        switch (logLevel) {
            case LOG_LEVEL.DEBUG:
                console.debug(formattedMessage);
                break;
            case LOG_LEVEL.INFO:
                console.info(formattedMessage);
                break;
            case LOG_LEVEL.WARN:
                console.warn(formattedMessage);
                break;
            case LOG_LEVEL.ERROR:
                console.error(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
        }
    });
}

async function loadRevenueCatSnapshot(): Promise<RevenueCatSnapshot> {
    const entitlementId = getRequiredRevenueCatEntitlementId();
    const [customerInfo, offerings] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
    ]);

    return {
        customerInfo,
        offering: offerings.current,
        hasActiveEntitlement: hasActiveEntitlement(customerInfo, entitlementId),
    };
}

function ensureCustomerInfoListenerRegistered(): void {
    if (customerInfoListenerRegistered) {
        return;
    }

    customerInfoListenerRegistered = true;
    Purchases.addCustomerInfoUpdateListener((customerInfo) => {
        const entitlementId = getRequiredRevenueCatEntitlementId();
        applyRevenueCatSnapshot({
            customerInfo,
            offering: useSubscriptionStore.getState().offering,
            hasActiveEntitlement: hasActiveEntitlement(customerInfo, entitlementId),
        });
    });
}

export async function initializeRevenueCat(): Promise<void> {
    if (configurePromise !== null) {
        return configurePromise;
    }

    configurePromise = (async () => {
        const apiKey = getRequiredRevenueCatApiKey();
        const entitlementId = getRequiredRevenueCatEntitlementId();

        useSubscriptionStore.getState().setStatus("loading");
        useSubscriptionStore.getState().setEntitlementId(entitlementId);

        Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
        ensureRevenueCatLogHandlerRegistered();
        Purchases.configure({
            apiKey,
            appUserID: null,
            preferredUILocaleOverride: "en_US",
        });

        ensureCustomerInfoListenerRegistered();
        const snapshot = await loadRevenueCatSnapshot();
        applyRevenueCatSnapshot(snapshot);
        useSubscriptionStore.getState().setInitialized(true);
    })().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        useSubscriptionStore.getState().setStatus("error");
        useSubscriptionStore.getState().setLastError(message);
        configurePromise = null;
        throw error;
    });

    return configurePromise;
}

export async function refreshRevenueCatState(): Promise<void> {
    await initializeRevenueCat();

    useSubscriptionStore.getState().setStatus("loading");
    try {
        const snapshot = await loadRevenueCatSnapshot();
        applyRevenueCatSnapshot(snapshot);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        useSubscriptionStore.getState().setStatus("error");
        useSubscriptionStore.getState().setLastError(message);
        throw error;
    }
}

function getRequiredMonthlyPackage(offering: PurchasesOffering | null): PurchasesPackage {
    if (offering === null) {
        throw new Error(
            "RevenueCat current offering is missing. Create the default offering and attach the monthly package in RevenueCat."
        );
    }

    if (offering.monthly === null) {
        throw new Error(
            `RevenueCat offering "${offering.identifier}" does not include a monthly package.`
        );
    }

    return offering.monthly;
}

function isUserCancelledPurchase(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }

    const purchasesError = error as Partial<PurchasesError> & {
        userCancelled?: boolean;
        code?: PURCHASES_ERROR_CODE | string;
    };

    return purchasesError.userCancelled === true
        || purchasesError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

export async function purchaseRevenueCatMonthlyPackage(): Promise<boolean> {
    await initializeRevenueCat();

    const offering = useSubscriptionStore.getState().offering;
    const monthlyPackage = getRequiredMonthlyPackage(offering);

    useSubscriptionStore.getState().setStatus("loading");
    try {
        const purchaseResult = await Purchases.purchasePackage(monthlyPackage);
        applyRevenueCatSnapshot({
            customerInfo: purchaseResult.customerInfo,
            offering,
            hasActiveEntitlement: hasActiveEntitlement(
                purchaseResult.customerInfo,
                getRequiredRevenueCatEntitlementId()
            ),
        });
        return true;
    } catch (error: unknown) {
        if (isUserCancelledPurchase(error)) {
            useSubscriptionStore.getState().setLastError(null);
            useSubscriptionStore.getState().setStatus("ready");
            return false;
        }

        const message = error instanceof Error ? error.message : String(error);
        useSubscriptionStore.getState().setStatus("error");
        useSubscriptionStore.getState().setLastError(message);
        throw error;
    }
}

export async function restoreRevenueCatPurchases(): Promise<void> {
    await initializeRevenueCat();

    useSubscriptionStore.getState().setStatus("loading");
    try {
        const customerInfo = await Purchases.restorePurchases();
        applyRevenueCatSnapshot({
            customerInfo,
            offering: useSubscriptionStore.getState().offering,
            hasActiveEntitlement: hasActiveEntitlement(
                customerInfo,
                getRequiredRevenueCatEntitlementId()
            ),
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        useSubscriptionStore.getState().setStatus("error");
        useSubscriptionStore.getState().setLastError(message);
        throw error;
    }
}

export async function presentRevenueCatPaywall(fontFamily: string | null): Promise<void> {
    await initializeRevenueCat();

    const offering = useSubscriptionStore.getState().offering;
    await RevenueCatUI.presentPaywall({
        ...(offering !== null ? { offering } : {}),
        displayCloseButton: true,
        fontFamily,
    });
    await refreshRevenueCatState();
}

function getSubscriptionManagementUrl(): string {
    if (Platform.OS === "ios") {
        return "https://apps.apple.com/account/subscriptions";
    }

    if (Platform.OS === "android") {
        return "https://play.google.com/store/account/subscriptions";
    }

    throw new Error("Subscription management is only supported on iOS and Android.");
}

export async function openSubscriptionManagement(): Promise<void> {
    await Linking.openURL(getSubscriptionManagementUrl());
}

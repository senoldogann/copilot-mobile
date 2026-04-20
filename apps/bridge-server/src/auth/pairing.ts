// QR pairing token generation and verification

import { randomBytes } from "node:crypto";
import {
    PAIRING_TOKEN_BYTES,
    PAIRING_TOKEN_TTL_MS,
} from "@copilot-mobile/shared";

type PairingToken = {
    token: string;
    createdAt: number;
    used: boolean;
};

let activePairingToken: PairingToken | null = null;

export function generatePairingToken(): string {
    const token = randomBytes(PAIRING_TOKEN_BYTES).toString("hex");
    activePairingToken = {
        token,
        createdAt: Date.now(),
        used: false,
    };
    return token;
}

export function validatePairingToken(token: string): boolean {
    if (activePairingToken === null) return false;
    if (activePairingToken.used) return false;
    if (activePairingToken.token !== token) return false;

    const elapsed = Date.now() - activePairingToken.createdAt;
    if (elapsed > PAIRING_TOKEN_TTL_MS) {
        activePairingToken = null;
        return false;
    }

    // Single use — mark as used
    activePairingToken.used = true;
    return true;
}

export function clearPairingToken(): void {
    activePairingToken = null;
}

export function isPairingActive(): boolean {
    if (activePairingToken === null) return false;
    if (activePairingToken.used) return false;
    const elapsed = Date.now() - activePairingToken.createdAt;
    return elapsed <= PAIRING_TOKEN_TTL_MS;
}

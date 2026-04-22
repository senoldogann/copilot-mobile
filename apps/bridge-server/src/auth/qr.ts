// QR code generator — displays ASCII QR in terminal

import QRCode from "qrcode";
import type { QRPayload } from "@copilot-mobile/shared";
import { PAIRING_TOKEN_TTL_MS, QR_PAYLOAD_VERSION } from "@copilot-mobile/shared";
import { generatePairingToken } from "./pairing.js";

const ALLOW_INSECURE_DIRECT_WS_ENV = "COPILOT_MOBILE_ALLOW_INSECURE_DIRECT_WS";

export type PairingQRCode = {
    payload: QRPayload;
    ascii: string;
    expiresAt: number;
};

function isDirectHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();

    if (
        normalized === "localhost"
        || normalized === "127.0.0.1"
        || normalized === "::1"
        || normalized === "[::1]"
    ) {
        return true;
    }

    if (/^10\.\d+\.\d+\.\d+$/.test(normalized)) {
        return true;
    }

    if (/^192\.168\.\d+\.\d+$/.test(normalized)) {
        return true;
    }

    const private172Match = normalized.match(/^172\.(\d+)\.\d+\.\d+$/);
    if (private172Match !== null) {
        const secondOctet = Number.parseInt(private172Match[1] ?? "", 10);
        return secondOctet >= 16 && secondOctet <= 31;
    }

    return false;
}

function resolveTransportMode(
    publicWebSocketUrl: string,
    relayAccessToken?: string
): "direct" | "relay" {
    if (relayAccessToken !== undefined) {
        return "relay";
    }

    const parsedUrl = new URL(publicWebSocketUrl);

    if (parsedUrl.protocol === "wss:") {
        return "direct";
    }

    if (
        parsedUrl.protocol === "ws:"
        && isDirectHostname(parsedUrl.hostname)
        && process.env[ALLOW_INSECURE_DIRECT_WS_ENV] === "1"
    ) {
        return "direct";
    }

    throw new Error(
        `Plain ws:// pairing is only allowed for localhost or private-network development URLs when ${ALLOW_INSECURE_DIRECT_WS_ENV}=1. Use wss:// for public bridge URLs.`
    );
}

export async function generatePairingQRCode(
    publicWebSocketUrl: string,
    certFingerprint: string | null,
    companionId?: string,
    relayAccessToken?: string
): Promise<PairingQRCode> {
    const token = generatePairingToken();
    const transportMode = resolveTransportMode(publicWebSocketUrl, relayAccessToken);

    const payload: QRPayload = {
        url: publicWebSocketUrl,
        token,
        certFingerprint,
        transportMode,
        ...(companionId !== undefined ? { companionId } : {}),
        ...(relayAccessToken !== undefined ? { relayAccessToken } : {}),
        version: QR_PAYLOAD_VERSION,
    };

    const qrString = JSON.stringify(payload);
    const ascii = await QRCode.toString(qrString, { type: "utf8" });

    return {
        payload,
        ascii,
        expiresAt: Date.now() + PAIRING_TOKEN_TTL_MS,
    };
}

export function printPairingQRCode(qrCode: PairingQRCode): void {
    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│   Copilot Mobile Bridge — QR Pairing    │");
    console.log("└─────────────────────────────────────────┘\n");
    console.log(qrCode.ascii);
    console.log(`\nConnection: ${qrCode.payload.url}`);
    console.log(`Mode: ${qrCode.payload.transportMode}`);
    console.log(`Token TTL: ${Math.ceil((qrCode.expiresAt - Date.now()) / 60_000)} minute(s)\n`);
}

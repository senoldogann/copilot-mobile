// QR code generator — displays ASCII QR in terminal

import QRCode from "qrcode";
import type { QRPayload } from "@copilot-mobile/shared";
import { QR_PAYLOAD_VERSION } from "@copilot-mobile/shared";
import { getPreferredLocalIP } from "../utils/network.js";
import { generatePairingToken } from "./pairing.js";

export async function displayQRCode(port: number): Promise<QRPayload> {
    const localIP = getPreferredLocalIP();
    const token = generatePairingToken();

    const payload: QRPayload = {
        url: `ws://${localIP}:${port}`,
        token,
        certFingerprint: null,
        version: QR_PAYLOAD_VERSION,
    };

    const qrString = JSON.stringify(payload);
    const ascii = await QRCode.toString(qrString, { type: "terminal", small: true });

    console.log("\n┌─────────────────────────────────────────┐");
    console.log("│   Copilot Mobile Bridge — QR Pairing    │");
    console.log("└─────────────────────────────────────────┘\n");
    console.log(ascii);
    console.log(`\nConnection: ws://${localIP}:${port}`);
    console.log(`Token TTL: 2 minutes\n`);

    return payload;
}

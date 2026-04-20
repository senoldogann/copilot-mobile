// JWT token generation, verification, and secret rotation

import jwt from "jsonwebtoken";
import {
    JWT_TTL_SECONDS,
    JWT_SECRET_ROTATION_MS,
    JWT_SECRET_GRACE_MS,
} from "@copilot-mobile/shared";
import { getOrCreateJWTSecret } from "./certs.js";
import { randomBytes } from "node:crypto";

type JWTPayload = {
    deviceId: string;
    pairedAt: number;
};

// Active secret + old secret (valid during grace period)
let currentSecret: Buffer = getOrCreateJWTSecret();
let previousSecret: Buffer | null = null;
let lastRotationAt: number = Date.now();
let previousSecretExpiresAt: number = 0;

export function rotateSecretIfNeeded(): boolean {
    const now = Date.now();
    if (now - lastRotationAt < JWT_SECRET_ROTATION_MS) return false;

    previousSecret = currentSecret;
    previousSecretExpiresAt = now + JWT_SECRET_GRACE_MS;
    currentSecret = randomBytes(32);
    lastRotationAt = now;
    console.log("[jwt] Secret rotation performed");
    return true;
}

export function createJWT(deviceId: string): string {
    rotateSecretIfNeeded();
    const payload: JWTPayload = {
        deviceId,
        pairedAt: Date.now(),
    };

    return jwt.sign(payload, currentSecret, {
        expiresIn: JWT_TTL_SECONDS,
        algorithm: "HS256",
    });
}

function isValidJWTPayload(decoded: unknown): decoded is JWTPayload {
    if (typeof decoded !== "object" || decoded === null) return false;
    const obj = decoded as Record<string, unknown>;
    return typeof obj["deviceId"] === "string" && typeof obj["pairedAt"] === "number";
}

export function verifyJWT(token: string): JWTPayload {
    // Try active secret first
    try {
        const decoded = jwt.verify(token, currentSecret, {
            algorithms: ["HS256"],
        });
        if (!isValidJWTPayload(decoded)) {
            throw new Error("Invalid JWT payload structure");
        }
        return decoded;
    } catch (primaryError) {
        // Try old secret during grace period
        if (previousSecret !== null && Date.now() < previousSecretExpiresAt) {
            const decoded = jwt.verify(token, previousSecret, {
                algorithms: ["HS256"],
            });
            if (!isValidJWTPayload(decoded)) {
                throw new Error("Invalid JWT payload structure");
            }
            return decoded;
        }
        throw primaryError;
    }
}

// Test helper — reset state
export function resetJWTState(): void {
    currentSecret = getOrCreateJWTSecret();
    previousSecret = null;
    lastRotationAt = Date.now();
    previousSecretExpiresAt = 0;
}

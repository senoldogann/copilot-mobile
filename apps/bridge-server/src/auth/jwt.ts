// Token generation, verification, and secret rotation

import jwt from "jsonwebtoken";
import {
    DEVICE_CREDENTIAL_TTL_SECONDS,
    JWT_SECRET_GRACE_MS,
    JWT_SECRET_ROTATION_MS,
    SESSION_TOKEN_TTL_SECONDS,
} from "@copilot-mobile/shared";
import { randomBytes } from "node:crypto";
import { getOrCreateJWTSecret, persistJWTSecret } from "./certs.js";

type TokenKind = "device_credential" | "session_token";

type TokenPayload = {
    kind: TokenKind;
    deviceId: string;
    issuedAt: number;
};

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
    persistJWTSecret(currentSecret);
    console.log("[jwt] Secret rotation performed and persisted");
    return true;
}

function signToken(kind: TokenKind, deviceId: string, expiresInSeconds: number): string {
    rotateSecretIfNeeded();

    const payload: TokenPayload = {
        kind,
        deviceId,
        issuedAt: Date.now(),
    };

    return jwt.sign(payload, currentSecret, {
        expiresIn: expiresInSeconds,
        algorithm: "HS256",
    });
}

function isValidTokenPayload(decoded: unknown, expectedKind: TokenKind): decoded is TokenPayload {
    if (typeof decoded !== "object" || decoded === null) return false;

    const obj = decoded as Record<string, unknown>;
    return obj["kind"] === expectedKind
        && typeof obj["deviceId"] === "string"
        && typeof obj["issuedAt"] === "number";
}

function verifyToken(token: string, expectedKind: TokenKind): TokenPayload {
    const verifyWithSecret = (secret: Buffer): TokenPayload => {
        const decoded = jwt.verify(token, secret, {
            algorithms: ["HS256"],
        });

        if (!isValidTokenPayload(decoded, expectedKind)) {
            throw new Error(`Invalid ${expectedKind} payload structure`);
        }

        return decoded;
    };

    try {
        return verifyWithSecret(currentSecret);
    } catch (primaryError) {
        if (previousSecret !== null && Date.now() < previousSecretExpiresAt) {
            return verifyWithSecret(previousSecret);
        }

        throw primaryError;
    }
}

export function createDeviceCredential(deviceId: string): string {
    return signToken("device_credential", deviceId, DEVICE_CREDENTIAL_TTL_SECONDS);
}

export function verifyDeviceCredential(token: string): TokenPayload {
    return verifyToken(token, "device_credential");
}

export function createSessionToken(deviceId: string): string {
    return signToken("session_token", deviceId, SESSION_TOKEN_TTL_SECONDS);
}

export function verifySessionToken(token: string): TokenPayload {
    return verifyToken(token, "session_token");
}

export function resetJWTState(): void {
    currentSecret = getOrCreateJWTSecret();
    previousSecret = null;
    lastRotationAt = Date.now();
    previousSecretExpiresAt = 0;
}

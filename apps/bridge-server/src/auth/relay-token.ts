import jwt from "jsonwebtoken";

const RELAY_SECRET_ENV = "COPILOT_MOBILE_RELAY_SECRET";
const RELAY_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_RELAY_SECRET_BYTES = 32;

function validateRelaySecret(secret: string): string {
    const normalizedSecret = secret.trim();
    if (Buffer.byteLength(normalizedSecret, "utf8") < MIN_RELAY_SECRET_BYTES) {
        throw new Error(
            `${RELAY_SECRET_ENV} must be at least ${MIN_RELAY_SECRET_BYTES} bytes of high-entropy secret material.`
        );
    }

    if (/^(changeme|password|secret|test|dev|relay-test-secret)$/i.test(normalizedSecret)) {
        throw new Error(`${RELAY_SECRET_ENV} is too weak. Generate a random secret instead.`);
    }

    return normalizedSecret;
}

type RelayTokenRole = "mobile" | "companion";

type RelayTokenPayload = {
    kind: "relay_access";
    role: RelayTokenRole;
    companionId: string;
    issuedAt: number;
};

export function getRequiredRelaySecret(): string {
    const relaySecret = process.env[RELAY_SECRET_ENV];

    if (typeof relaySecret !== "string" || relaySecret.trim().length === 0) {
        throw new Error(
            `Missing required ${RELAY_SECRET_ENV}. Relay mode requires an explicit shared secret for hosted deployment.`
        );
    }

    return validateRelaySecret(relaySecret);
}

export function createRelayAccessToken(role: RelayTokenRole, companionId: string): string {
    const relaySecret = getRequiredRelaySecret();
    const payload: RelayTokenPayload = {
        kind: "relay_access",
        role,
        companionId,
        issuedAt: Date.now(),
    };

    return jwt.sign(payload, relaySecret, {
        expiresIn: RELAY_ACCESS_TOKEN_TTL_SECONDS,
        algorithm: "HS256",
    });
}

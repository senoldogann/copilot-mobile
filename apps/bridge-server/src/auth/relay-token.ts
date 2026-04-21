import jwt from "jsonwebtoken";

const RELAY_SECRET_ENV = "COPILOT_MOBILE_RELAY_SECRET";
const RELAY_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

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

    return relaySecret;
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

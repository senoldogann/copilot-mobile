import jwt from "jsonwebtoken";

const RELAY_SECRET_ENV_NAMES = [
    "CODE_COMPANION_SELF_HOSTED_RELAY_SECRET",
    "CODE_COMPANION_RELAY_SECRET",
    "COPILOT_MOBILE_RELAY_SECRET",
] as const;
const RELAY_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_RELAY_SECRET_BYTES = 32;

function readRelaySecretEnv(): string | undefined {
    for (const envName of RELAY_SECRET_ENV_NAMES) {
        const value = process.env[envName];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

function validateRelaySecret(secret: string): string {
    const normalizedSecret = secret.trim();
    if (Buffer.byteLength(normalizedSecret, "utf8") < MIN_RELAY_SECRET_BYTES) {
        throw new Error(
            `${RELAY_SECRET_ENV_NAMES[0]} must be at least ${MIN_RELAY_SECRET_BYTES} bytes of high-entropy secret material.`
        );
    }

    if (/^(changeme|password|secret|test|dev|relay-test-secret)$/i.test(normalizedSecret)) {
        throw new Error(`${RELAY_SECRET_ENV_NAMES[0]} is too weak. Generate a random secret instead.`);
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
    const relaySecret = readRelaySecretEnv();

    if (typeof relaySecret !== "string" || relaySecret.trim().length === 0) {
        throw new Error(
            `Missing relay secret. Set ${RELAY_SECRET_ENV_NAMES[0]} or keep the legacy ${RELAY_SECRET_ENV_NAMES[2]} during migration.`
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

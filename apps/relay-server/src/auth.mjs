import jwt from "jsonwebtoken";

const RELAY_SECRET_ENV = "COPILOT_MOBILE_RELAY_SECRET";

function getRequiredRelaySecret() {
  const relaySecret = process.env[RELAY_SECRET_ENV];
  if (typeof relaySecret !== "string" || relaySecret.trim().length === 0) {
    throw new Error(
      `Missing required ${RELAY_SECRET_ENV}. Relay server refuses unauthenticated public connections.`,
    );
  }

  return relaySecret;
}

function isRelayTokenPayload(value, expectedRole, expectedCompanionId) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return value.kind === "relay_access"
    && value.role === expectedRole
    && value.companionId === expectedCompanionId
    && typeof value.issuedAt === "number";
}

export function verifyRelayAccessToken(accessToken, expectedRole, expectedCompanionId) {
  const relaySecret = getRequiredRelaySecret();
  const decoded = jwt.verify(accessToken, relaySecret, {
    algorithms: ["HS256"],
  });

  if (!isRelayTokenPayload(decoded, expectedRole, expectedCompanionId)) {
    throw new Error("Relay access token payload is invalid.");
  }

  return decoded;
}

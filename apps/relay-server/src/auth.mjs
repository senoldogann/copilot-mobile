import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const RELAY_SECRET_ENV = "COPILOT_MOBILE_RELAY_SECRET";
const CONTROL_PLANE_SECRET_ENV = "COPILOT_MOBILE_CONTROL_PLANE_SECRET";
const COMPANION_ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MOBILE_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const REGISTRATION_CREDENTIAL_TTL_SECONDS = 365 * 24 * 60 * 60;
const MIN_SECRET_BYTES = 32;

function validateSecret(secret, envName) {
  const normalized = secret.trim();
  if (Buffer.byteLength(normalized, "utf8") < MIN_SECRET_BYTES) {
    throw new Error(`${envName} must be at least ${MIN_SECRET_BYTES} bytes of high-entropy secret material.`);
  }

  if (/^(changeme|password|secret|test|dev|relay-test-secret)$/i.test(normalized)) {
    throw new Error(`${envName} is too weak. Generate a random secret instead.`);
  }

  return normalized;
}

function getRequiredSecret(envName, fallbackEnvName) {
  const primarySecret = process.env[envName];
  if (typeof primarySecret === "string" && primarySecret.trim().length > 0) {
    return validateSecret(primarySecret, envName);
  }

  if (typeof fallbackEnvName === "string") {
    const fallbackSecret = process.env[fallbackEnvName];
    if (typeof fallbackSecret === "string" && fallbackSecret.trim().length > 0) {
      return validateSecret(fallbackSecret, fallbackEnvName);
    }
  }

  throw new Error(`Missing required ${envName}${fallbackEnvName ? ` or ${fallbackEnvName}` : ""}.`);
}

function getRelaySecret() {
  return getRequiredSecret(RELAY_SECRET_ENV);
}

function getControlPlaneSecret() {
  return getRequiredSecret(CONTROL_PLANE_SECRET_ENV, RELAY_SECRET_ENV);
}

function signJwt(payload, secret, expiresInSeconds) {
  return jwt.sign(payload, secret, {
    expiresIn: expiresInSeconds,
    algorithm: "HS256",
  });
}

function verifyJwt(token, secret) {
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
  });
}

export function createCompanionRegistrationCredential(details = {}) {
  const companionId = randomUUID();
  const credential = signJwt({
    kind: "companion_registration",
    companionId,
    issuedAt: Date.now(),
    ...details,
  }, getControlPlaneSecret(), REGISTRATION_CREDENTIAL_TTL_SECONDS);

  return {
    companionId,
    companionRegistrationCredential: credential,
  };
}

export function verifyCompanionRegistrationCredential(credential, expectedCompanionId) {
  const decoded = verifyJwt(credential, getControlPlaneSecret());
  if (
    typeof decoded !== "object"
    || decoded === null
    || decoded.kind !== "companion_registration"
    || typeof decoded.companionId !== "string"
    || typeof decoded.issuedAt !== "number"
  ) {
    throw new Error("Companion registration credential payload is invalid.");
  }

  if (
    typeof expectedCompanionId === "string"
    && decoded.companionId !== expectedCompanionId
  ) {
    throw new Error("Companion registration credential does not match the requested companion.");
  }

  return decoded;
}

export function createRelayAccessToken(role, companionId) {
  return signJwt({
    kind: "relay_access",
    role,
    companionId,
    issuedAt: Date.now(),
  }, getRelaySecret(), role === "companion" ? COMPANION_ACCESS_TOKEN_TTL_SECONDS : MOBILE_ACCESS_TOKEN_TTL_SECONDS);
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
  const decoded = verifyJwt(accessToken, getRelaySecret());

  if (!isRelayTokenPayload(decoded, expectedRole, expectedCompanionId)) {
    throw new Error("Relay access token payload is invalid.");
  }

  return decoded;
}

export function getCompanionAccessTokenTtlMs() {
  return COMPANION_ACCESS_TOKEN_TTL_SECONDS * 1000;
}

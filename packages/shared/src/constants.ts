// Constants

export const DEFAULT_WS_PORT = 9876;
export const PAIRING_TOKEN_BYTES = 32;
export const PAIRING_TOKEN_TTL_MS = 2 * 60 * 1000; // 2 minutes (security review: reduced from 5)
export const JWT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const JWT_REFRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 hours — token refreshed after this
export const JWT_SECRET_ROTATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — secret rotation interval
export const JWT_SECRET_GRACE_MS = 24 * 60 * 60 * 1000; // 1 day — old secret grace period
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const PERMISSION_TIMEOUT_MS = 60 * 1000; // 60 seconds auto-deny
export const MAX_SESSIONS = 10;
export const MAX_MESSAGE_BUFFER = 50;
export const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const RATE_LIMIT_PAIRING_MAX = 5;
export const RATE_LIMIT_PAIRING_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_MESSAGE_MAX = 30;
export const RATE_LIMIT_MESSAGE_WINDOW_MS = 60 * 1000;
export const CONFIG_DIR_NAME = ".copilot-mobile";
export const CERT_FILENAME = "cert.pem";
export const KEY_FILENAME = "key.pem";
export const JWT_SECRET_FILENAME = "jwt-secret.key";
export const QR_PAYLOAD_VERSION = 1;
// Runtime WS protocol version. Client/server uyumsuzlu\u011fu bu alana g\u00f6re tespit edilir.
export const PROTOCOL_VERSION = 1;
export const MODEL_UNKNOWN = "unknown";

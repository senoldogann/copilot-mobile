// TLS certificate and JWT secret management
// Stored in ~/.code-companion/ with legacy migration from ~/.copilot-mobile/

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import {
    CONFIG_DIR_NAME,
    LEGACY_CONFIG_DIR_NAME,
    CERT_FILENAME,
    KEY_FILENAME,
    JWT_SECRET_FILENAME,
    COMPANION_ID_FILENAME,
} from "@copilot-mobile/shared";

function getPrimaryConfigDir(): string {
    return join(homedir(), CONFIG_DIR_NAME);
}

function getLegacyConfigDir(): string {
    return join(homedir(), LEGACY_CONFIG_DIR_NAME);
}

function migrateLegacyConfigFiles(): void {
    const primaryConfigDir = getPrimaryConfigDir();
    const legacyConfigDir = getLegacyConfigDir();
    const fileNames = [CERT_FILENAME, KEY_FILENAME, JWT_SECRET_FILENAME, COMPANION_ID_FILENAME] as const;

    if (!existsSync(legacyConfigDir)) {
        return;
    }

    if (!existsSync(primaryConfigDir)) {
        mkdirSync(primaryConfigDir, { mode: 0o700, recursive: true });
    }

    for (const fileName of fileNames) {
        const primaryPath = join(primaryConfigDir, fileName);
        const legacyPath = join(legacyConfigDir, fileName);

        if (existsSync(primaryPath) || !existsSync(legacyPath)) {
            continue;
        }

        copyFileSync(legacyPath, primaryPath);
        chmodSync(primaryPath, fileName === CERT_FILENAME ? 0o644 : 0o600);
    }
}

export function getConfigDir(): string {
    migrateLegacyConfigFiles();
    const dir = getPrimaryConfigDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { mode: 0o700, recursive: true });
    }
    return dir;
}

// --- JWT Secret ---

export function getOrCreateJWTSecret(): Buffer {
    const configDir = getConfigDir();
    const secretPath = join(configDir, JWT_SECRET_FILENAME);

    if (existsSync(secretPath)) {
        return readFileSync(secretPath);
    }

    const secret = randomBytes(32);
    writeFileSync(secretPath, secret, { mode: 0o600 });
    chmodSync(secretPath, 0o600);
    return secret;
}

// Persist atomically during rotation so a restart cannot lose the latest secret.
export function persistJWTSecret(secret: Buffer): void {
    const configDir = getConfigDir();
    const secretPath = join(configDir, JWT_SECRET_FILENAME);
    const tmpPath = `${secretPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, secret, { mode: 0o600 });
    renameSync(tmpPath, secretPath);
    chmodSync(secretPath, 0o600);
}

// --- TLS Certificate ---

type TLSCredentials = {
    cert: string;
    key: string;
    fingerprint: string;
};

export function getOrCreateTLSCredentials(): TLSCredentials {
    const configDir = getConfigDir();
    const certPath = join(configDir, CERT_FILENAME);
    const keyPath = join(configDir, KEY_FILENAME);

    if (existsSync(certPath) && existsSync(keyPath)) {
        const cert = readFileSync(certPath, "utf-8");
        const key = readFileSync(keyPath, "utf-8");
        const fingerprint = computeCertFingerprint(cert);
        return { cert, key, fingerprint };
    }

    // openssl required — valid X.509 certificates cannot be generated with node:crypto
    setupTLSWithOpenSSL(configDir);

    const cert = readFileSync(certPath, "utf-8");
    const key = readFileSync(keyPath, "utf-8");
    const fingerprint = computeCertFingerprint(cert);
    return { cert, key, fingerprint };
}

export function setupTLSWithOpenSSL(configDir: string): void {
    const certPath = join(configDir, CERT_FILENAME);
    const keyPath = join(configDir, KEY_FILENAME);

    if (existsSync(certPath) && existsSync(keyPath)) return;

    if (!existsSync(configDir)) {
        mkdirSync(configDir, { mode: 0o700, recursive: true });
    }

    // execFileSync used to prevent shell injection
    execFileSync("openssl", [
        "req", "-x509",
        "-newkey", "rsa:2048",
        "-keyout", keyPath,
        "-out", certPath,
        "-days", "365",
        "-nodes",
        "-subj", "/CN=code-companion-bridge",
    ], { stdio: "ignore" });
    chmodSync(keyPath, 0o600);
}

function computeCertFingerprint(certPem: string): string {
    return createHash("sha256").update(certPem).digest("hex");
}

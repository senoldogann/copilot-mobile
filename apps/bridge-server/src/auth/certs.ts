// TLS certificate and JWT secret management
// Stored in ~/.copilot-mobile/

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import {
    CONFIG_DIR_NAME,
    CERT_FILENAME,
    KEY_FILENAME,
    JWT_SECRET_FILENAME,
} from "@copilot-mobile/shared";

function getConfigDir(): string {
    const dir = join(homedir(), CONFIG_DIR_NAME);
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
    return secret;
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
        "-subj", "/CN=copilot-mobile-bridge",
    ], { stdio: "ignore" });
    chmodSync(keyPath, 0o600);
}

function computeCertFingerprint(certPem: string): string {
    return createHash("sha256").update(certPem).digest("hex");
}

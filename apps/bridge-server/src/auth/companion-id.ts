import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { COMPANION_ID_FILENAME } from "@copilot-mobile/shared";
import { getConfigDir } from "./certs.js";

function readStoredCompanionId(path: string): string | null {
    if (!existsSync(path)) {
        return null;
    }

    const value = readFileSync(path, "utf-8").trim();
    return value.length > 0 ? value : null;
}

export function getOrCreateCompanionId(): string {
    const companionIdPath = join(getConfigDir(), COMPANION_ID_FILENAME);
    const stored = readStoredCompanionId(companionIdPath);
    if (stored !== null) {
        return stored;
    }

    const companionId = randomUUID();
    writeFileSync(companionIdPath, companionId, { mode: 0o600 });
    return companionId;
}

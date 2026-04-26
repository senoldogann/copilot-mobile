import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("published package runtime dependencies", () => {
    it("does not install Copilot native packages into the global package", () => {
        const packageJsonPath = path.join(repoRoot, "package.json");
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
            dependencies?: Record<string, string>;
        };

        assert.equal(packageJson.dependencies?.["@github/copilot"], undefined);
        assert.equal(packageJson.dependencies?.["@github/copilot-sdk"], undefined);
    });

    it("keeps the desktop daemon self-contained instead of externalizing the SDK", () => {
        const buildScriptPath = path.join(repoRoot, "scripts/build-desktop-runtime.mjs");
        const buildScript = readFileSync(buildScriptPath, "utf8");

        assert.match(buildScript, /external:\s*\[\]/u);
        assert.equal(buildScript.includes('"@github/copilot-sdk"'), false);
    });
});

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const rootDirectory = process.cwd();
const outDirectory = path.join(rootDirectory, "dist", "desktop");

mkdirSync(outDirectory, { recursive: true });
rmSync(path.join(outDirectory, "bridge-daemon.cjs"), { force: true });
rmSync(path.join(outDirectory, "bridge-daemon.cjs.map"), { force: true });
rmSync(path.join(outDirectory, "bridge-daemon.mjs"), { force: true });
rmSync(path.join(outDirectory, "bridge-daemon.mjs.map"), { force: true });

await build({
    entryPoints: [path.join(rootDirectory, "apps", "bridge-server", "src", "daemon.ts")],
    outfile: path.join(outDirectory, "bridge-daemon.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    tsconfigRaw: {
        compilerOptions: {},
    },
    sourcemap: true,
    legalComments: "none",
    external: [],
    banner: {
        js: `#!/usr/bin/env node
import { dirname as __copilotMobileDirname } from "node:path";
import { createRequire as __copilotMobileCreateRequire } from "node:module";
import { fileURLToPath as __copilotMobileFileURLToPath } from "node:url";
const __filename = __copilotMobileFileURLToPath(import.meta.url);
const __dirname = __copilotMobileDirname(__filename);
const require = __copilotMobileCreateRequire(import.meta.url);`,
    },
});

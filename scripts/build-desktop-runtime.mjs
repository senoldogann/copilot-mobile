import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const rootDirectory = process.cwd();
const outDirectory = path.join(rootDirectory, "dist", "desktop");

mkdirSync(outDirectory, { recursive: true });
rmSync(path.join(outDirectory, "bridge-daemon.mjs"), { force: true });
rmSync(path.join(outDirectory, "bridge-daemon.mjs.map"), { force: true });

await build({
    entryPoints: [path.join(rootDirectory, "apps", "bridge-server", "src", "daemon.ts")],
    outfile: path.join(outDirectory, "bridge-daemon.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    tsconfigRaw: {
        compilerOptions: {},
    },
    sourcemap: true,
    legalComments: "none",
    external: [
        "@github/copilot-sdk",
        "jsonwebtoken",
        "qrcode",
        "uuid",
        "ws",
        "zod",
    ],
    banner: {
        js: "#!/usr/bin/env node",
    },
});

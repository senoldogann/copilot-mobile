#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(currentFilePath), "..");
const daemonModuleUrl = pathToFileURL(path.join(packageRoot, "dist", "desktop", "bridge-daemon.cjs")).href;

await import(daemonModuleUrl);

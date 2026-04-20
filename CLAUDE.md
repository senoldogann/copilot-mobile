# copilot-mobile

## Overview

This project uses **Expo, Expo Router, React, React Native, JavaScript, TypeScript, Node.js, GitHub Actions, pnpm** and is located at `/Users/dogan/Desktop/copilot-mobile`.

## Tech Stack

| Name | Category | Version |
|------|----------|---------|
| Expo | framework | ~54.0.0 |
| Expo Router | framework | ~6.0.23 |
| React | framework | 19.1.0 |
| React Native | framework | 0.81.5 |
| JavaScript | language | — |
| TypeScript | language | ^5.7.0 |
| Node.js | runtime | >=20.0.0 |
| GitHub Actions | tool | — |
| pnpm | tooling | >=9.0.0 |

## Build & Run

Auto-detected commands:

```bash
# Install
pnpm install
# Typecheck
pnpm typecheck
# Test
pnpm test
# Build Bridge
pnpm build:bridge
# Build Shared
pnpm build:shared
# Dev Bridge
pnpm dev:bridge
# Dev Mobile
pnpm dev:mobile
# Test Bridge
pnpm test:bridge
```

## Workspace Map

- `root` — package.json (copilot-mobile) — scripts: test, typecheck, build:bridge, build:shared
- `apps/bridge-server` — package.json (@copilot-mobile/bridge-server) — scripts: dev, build, test, typecheck
- `apps/mobile` — package.json (@copilot-mobile/mobile) — scripts: start, build, typecheck
- `packages/shared` — package.json (@copilot-mobile/shared) — scripts: build, typecheck

## Important Paths

- `README.md` — high-level project overview
- `package.json` — root scripts and JavaScript dependencies
- `pnpm-workspace.yaml` — workspace package boundaries
- `apps/bridge-server/package.json` — workspace manifest
- `apps/mobile/package.json` — workspace manifest
- `packages/shared/package.json` — workspace manifest

## Architecture

### Architecture — 2 pattern(s) detected

Detected patterns:
• Monorepo with multiple package.json workspaces
• Documentation directory

## Context Notes

### tech

**Tech stack — Expo + Expo Router + React + React Native**: framework: Expo ~54.0.0, Expo Router ~6.0.23, React 19.1.0, React Native 0.81.5. language: JavaScript, TypeScript ^5.7.0. runtime: Node.js >=20.0.0. tool: GitHub Actions. tooling: pnpm >=9.0.0.


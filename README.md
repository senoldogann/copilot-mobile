# Code Companion

Code Companion lets you control a coding session running on your own desktop from your phone.

## How It Works

```text
┌──────────────┐       WSS        ┌────────────────┐    JSON-RPC    ┌─────────────┐
│  Mobile App  │ ◄──────────────► │  Bridge Server │ ◄────────────► │ Copilot CLI │
│ (React Native)│   QR Pairing    │   (Node.js)    │                │  (Desktop)  │
└──────────────┘                  └────────────────┘                └─────────────┘
```

1. The desktop companion runs as a local background service and talks to Copilot CLI through `@github/copilot-sdk`.
2. `code-companion up` starts the service and prints a pairing QR code.
3. The mobile app scans the QR code and connects through the hosted relay/control plane or a self-hosted relay.
4. You send messages from your phone while the coding session runs on your desktop.

## Continue On Desktop

- Sessions started from the phone are stored in the local Copilot CLI session store.
- New sessions are opened from the repository root, so monorepos stay visible as one project instead of being pinned to a nested package.
- You can continue a phone-started session from a VS Code terminal on the same desktop machine with `copilot /resume`.
- When the mobile app returns to the foreground or the chat drawer opens, it refreshes the session list so desktop-started sessions can appear on the phone.

## Requirements

- A Mac or Windows PC
- Node.js >= 20
- pnpm >= 9
- A GitHub Copilot account with Copilot CLI signed in on the desktop companion machine
- An iOS or Android device
- A public relay/control-plane deployment for access outside the local network

For end users, the desktop setup is:

1. Install the companion on the desktop companion machine with `npm install -g @senoldogann/code-companion`
2. Sign in once with `code-companion login`
3. Start the service with `code-companion up`
4. Scan the QR code from the phone

After pairing, the service keeps running in the background through the local service manager as long as the desktop machine is awake, the user session is active, and the companion remains healthy. The phone does not need to be on the same network when the hosted relay is used.

## Installation

```bash
pnpm install
```

## Usage

### 1. Sign In To The Desktop Companion

Recommended global npm flow:

```bash
npm install -g @senoldogann/code-companion
code-companion login
code-companion up
code-companion doctor
```

`code-companion login` starts the official Copilot CLI `copilot login` flow. `code-companion up` starts the daemon in the background and prints the pairing QR code in the terminal. On macOS it installs or refreshes the LaunchAgent at `~/Library/LaunchAgents/dev.senoldogan.codecompanion.bridge.plist`; on Windows it starts a detached background daemon tracked under `~/.code-companion/daemon.pid`. `code-companion doctor` checks Copilot authentication, service-manager state, daemon bundle health, relay connectivity, and the localhost management endpoint in one place.

When working from the repository, you can run the same commands with `node ./bin/copilot-mobile.mjs <command>` or `pnpm code-companion <command>`.

### 2. Prepare Hosted Relay Or Local Control Plane

The companion starts in hosted mode by default. For local smoke tests inside this repository, start the relay/control plane on the same machine:

```bash
export CODE_COMPANION_SELF_HOSTED_RELAY_SECRET="replace-with-a-long-random-secret"
pnpm dev:relay
code-companion up
```

In that setup, `code-companion up` uses the local hosted endpoint at `http://127.0.0.1:8787` to register the companion, create a relay session, and generate a relay-backed QR route.

For real remote usage, the recommended path is the Cloudflare Workers relay:

- [docs/cloudflare-relay.md](docs/cloudflare-relay.md)

Summary commands:

```bash
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler login
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler secret put RELAY_SECRET
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler secret put CONTROL_PLANE_SECRET
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler deploy
```

After deployment, start the desktop companion:

```bash
code-companion up
```

This repository currently defaults to this hosted Worker URL:

```bash
https://copilot-mobile-relay.senoldogan0233.workers.dev
```

Because of that default, normal end users do not need any extra `export` command.

The legacy self-hosted relay mode is still supported, but it is no longer the default consumer flow.

### 3. Start The Mobile App

```bash
pnpm dev:mobile
```

This opens Metro in `tunnel` mode for the Expo Dev Client, so physical devices can load the development bundle even when they are on another network or 5G.

### 4. Pair With QR

1. Tap **Connect With QR** in the mobile app.
2. Point the camera at the QR code printed by `code-companion up`.
3. After the connection is established, open the **Chat** screen.
4. Start coding from your phone.

## Project Structure

```text
copilot-mobile/
├── packages/
│   └── shared/              # Protocol types, Zod schemas, adapter interfaces
├── apps/
│   ├── bridge-server/       # WebSocket bridge server (Node.js + copilot-sdk)
│   ├── cloudflare-relay/    # Hosted relay/control plane (Cloudflare Workers)
│   │   ├── src/
│   │   │   ├── server.ts        # Entry point
│   │   │   ├── ws/              # WebSocket server and message routing
│   │   │   ├── copilot/         # SDK adapter and session management
│   │   │   ├── auth/            # TLS, JWT, pairing, QR
│   │   │   └── utils/           # Rate limiting, message IDs, network helpers
│   │   └── tests/               # Integration tests
│   └── mobile/              # React Native / Expo mobile app
│       └── app/                 # Expo Router screens
```

## Commands

| Command | Description |
| ------- | ----------- |
| `code-companion login` | Start the official Copilot CLI login flow |
| `code-companion up` | Start the managed daemon and print the pairing QR |
| `code-companion status` | Show daemon, Copilot auth, relay, and last-error state |
| `code-companion doctor` | Verify readiness for production pairing and reconnect |
| `code-companion qr` | Request a fresh pairing QR from the running daemon |
| `code-companion logs` | Tail daemon stderr logs |
| `code-companion dashboard` | Print the local dashboard URL |
| `code-companion down` | Stop the managed daemon |
| `pnpm dev:companion:macos` | Open the native macOS companion shell |
| `pnpm dev:relay:cloudflare` | Start the Cloudflare Worker relay in local dev mode |
| `pnpm deploy:relay:cloudflare` | Deploy the Cloudflare Worker relay |
| `pnpm dev:mobile` | Start the mobile app |
| `pnpm build:shared` | Build the shared package |
| `pnpm build:bridge` | Build the bridge server |
| `pnpm build:desktop` | Build the publishable desktop daemon bundle |
| `pnpm build:companion:macos` | Build the native macOS companion shell |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm test` | Run E2E tests against the real Copilot CLI |

## Security

- **WebSocket transport**: A public relay or reverse proxy carries WebSocket traffic to the bridge. Pairing and JWT authentication are enforced at the bridge layer.
- **QR pairing**: One-time pairing token with a 2-minute TTL.
- **JWT auth**: HS256 tokens with a 24-hour TTL and reconnect support.
- **Rate limiting**: Pairing is limited to 5 attempts per 5 minutes; messages are limited to 30 per minute.
- **Replay protection**: Duplicate message IDs are rejected within a 5-minute window.
- **Single mobile client**: The bridge accepts one mobile device at a time.

## Runtime Notes

- Companion config is stored at `~/.code-companion/config.json`. Legacy `~/.copilot-mobile/config.json` is migrated on first read.
- On macOS the default background service is a user `LaunchAgent` loaded with `launchctl bootstrap gui/<uid>`.
- On Windows the managed daemon is started as a detached background process and tracked in `~/.code-companion/daemon.pid`.
- Hosted relay public API and relay base URLs can be overridden with `CODE_COMPANION_HOSTED_API_BASE_URL` and `CODE_COMPANION_HOSTED_RELAY_BASE_URL`.
- Local smoke tests can run with `pnpm dev:relay` and `CODE_COMPANION_SELF_HOSTED_RELAY_SECRET`.
- `status` and `qr` talk to localhost management endpoints inside the daemon; those endpoints are not exposed to the public network.
- `doctor` checks the localhost health endpoint, service-manager state, daemon bundle, and Copilot CLI authentication together. Use `code-companion doctor --json` for CI or support flows.
- The browser dashboard uses the same management endpoints for QR refresh, log access, and service shutdown actions.
- `dev:companion:macos` wraps the same management endpoints in a native macOS shell for bridge lifecycle, QR, and dashboard views.
- Relay-backed companion QR codes advertise `transportMode: "relay"`. Legacy direct mode is kept only for private-network debugging.
- Session completion notifications work in development or production builds when the user grants permission. Expo Go does not support the remote push flow.
- Voice dictation uses `expo-speech-recognition` and requires a development build. The `app.json` plugin adds iOS microphone/speech recognition usage descriptions and Android `RECORD_AUDIO` permission. Build it with `pnpm --filter @copilot-mobile/mobile expo prebuild --clean`, then `pnpm --filter @copilot-mobile/mobile expo run:ios` or `run:android`.
- The JavaScript fallback path in `@github/copilot` may require Node.js 24. Normal global installs resolve the platform binary and run the companion flow on Node.js 20+. For support and release checks, trust `code-companion doctor`.

For the production and App Store release checklist, see:

- [docs/project-runbook-and-appstore-readiness.md](docs/project-runbook-and-appstore-readiness.md)

## Technology

- **Shared**: TypeScript, Zod
- **Bridge server**: Node.js, ws, jsonwebtoken, `@github/copilot-sdk`
- **Mobile**: Expo 54, React Native 0.81.5, Expo Router 6, Zustand 5, expo-camera, expo-secure-store

## Test Notes

- `pnpm test` does not use mocks; it validates the real Copilot CLI integration.
- The GitHub account must be signed in through the CLI.
- If needed, run `gh auth login` first and make sure Copilot CLI access is ready.

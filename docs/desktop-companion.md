# Desktop Companion

This is the current macOS-first desktop companion flow for Copilot Mobile.

## Goal

The desktop side should feel like:

1. Install the iPhone app.
2. Install the desktop CLI with `npm install -g copilot-mobile`.
3. Run `copilot-mobile login` once.
4. Run `copilot-mobile up`.
5. Scan the QR from the local dashboard.

The daemon is installed as a user `LaunchAgent` at `~/Library/LaunchAgents/com.copilotmobile.bridge.plist`.

## Runtime Files

- Config: `~/.copilot-mobile/config.json`
- Logs: `~/.copilot-mobile/logs/`
- LaunchAgent: `~/Library/LaunchAgents/com.copilotmobile.bridge.plist`

## Stable Commands

- `copilot-mobile login`
- `copilot-mobile up`
- `copilot-mobile status`
- `copilot-mobile qr`
- `copilot-mobile logs`
- `copilot-mobile down`

## Local Smoke Test

For repo-local testing, run the relay/control-plane locally:

```bash
export COPILOT_MOBILE_RELAY_SECRET="replace-with-a-long-random-secret"
pnpm dev:relay
```

Then in another terminal:

```bash
copilot-mobile login
copilot-mobile up
copilot-mobile status
copilot-mobile qr
copilot-mobile down
```

If you are testing from the repo instead of a global npm install, use:

```bash
pnpm install
pnpm build:shared
pnpm build:bridge
pnpm build:desktop
node ./bin/copilot-mobile.mjs up
```

## Remote / Different Network Test

Use a deployed relay/control-plane and set:

```bash
export COPILOT_MOBILE_HOSTED_API_BASE_URL="https://relay.example.com"
export COPILOT_MOBILE_HOSTED_RELAY_BASE_URL="wss://relay.example.com"
copilot-mobile up
```

The phone can then pair and connect from a different network through the relay.

## Current Readiness

What is ready now:

- Publish-style CLI packaging via `prepack`
- Bundled desktop daemon runtime
- macOS LaunchAgent lifecycle
- Hosted relay/control-plane endpoints in `apps/relay-server`
- Dashboard QR refresh / open logs / stop service actions

What still needs product hardening before App Store-grade rollout:

- Production relay hosting and secrets management
- Full mobile reconnect token refresh without long-lived relay token assumptions
- End-to-end onboarding polish for non-technical users
- App Store metadata, privacy manifest, and release operations

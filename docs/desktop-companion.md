# Mac Companion

This is the current macOS-first desktop companion flow for Code Companion.

## Goal

The desktop side should feel like:

1. Install the iPhone app.
2. Install the desktop CLI with `npm install -g @senoldogann/code-companion`.
3. Run `code-companion login` once.
4. Run `code-companion up`.
5. Scan the QR from the local dashboard.

The daemon is installed as a user `LaunchAgent` at `~/Library/LaunchAgents/dev.senoldogan.codecompanion.bridge.plist`.

## Runtime Files

- Config: `~/.code-companion/config.json`
- Logs: `~/.code-companion/logs/`
- LaunchAgent: `~/Library/LaunchAgents/dev.senoldogan.codecompanion.bridge.plist`

## Stable Commands

- `code-companion login`
- `code-companion up`
- `code-companion status`
- `code-companion doctor`
- `code-companion qr`
- `code-companion logs`
- `code-companion down`

## Local Smoke Test

For repo-local testing, run the relay/control-plane locally:

```bash
export CODE_COMPANION_SELF_HOSTED_RELAY_SECRET="replace-with-a-long-random-secret"
pnpm dev:relay
```

Then in another terminal:

```bash
code-companion login
code-companion up
code-companion status
code-companion qr
code-companion down
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
code-companion up
```

The phone can then pair and connect from a different network through the relay.

## Current Readiness

What is ready now:

- Publish-style CLI packaging via `prepack`
- Bundled desktop daemon runtime
- macOS LaunchAgent lifecycle
- Hosted relay/control-plane endpoints in `apps/relay-server`
- Dashboard QR refresh / open logs / stop service actions
- `code-companion doctor` readiness check for auth, LaunchAgent, daemon health, and relay link state

What still needs product hardening before App Store-grade rollout:

- Production relay hosting and secrets management
- End-to-end onboarding polish for non-technical users
- App Store metadata, privacy manifest, and release operations

The detailed release checklist lives in `docs/project-runbook-and-appstore-readiness.md` in the source repository.

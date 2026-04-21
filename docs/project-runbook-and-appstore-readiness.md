# Copilot Mobile Runbook And App Store Readiness

This document describes how to run the project locally and the current release readiness state as of April 21, 2026.

## Workspaces

- Root: `/Users/dogan/Desktop/copilot-mobile`
- Mobile app: `/Users/dogan/Desktop/copilot-mobile/apps/mobile`
- Bridge server: `/Users/dogan/Desktop/copilot-mobile/apps/bridge-server`
- Shared types: `/Users/dogan/Desktop/copilot-mobile/packages/shared`

## Local Setup

Requirements:

- Node.js 20+
- pnpm 9+
- Xcode with iOS development tools
- CocoaPods
- iPhone on the same local network as the Mac for direct bridge development

Install dependencies:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm install
```

## iOS Development Build

Open the mobile workspace:

```bash
cd /Users/dogan/Desktop/copilot-mobile/apps/mobile
pnpm xcode:ios
```

Important:

- This project uses a development build, not Expo Go.
- The iPhone must allow `Local Network` access for Metro and the local bridge.

Start Metro for the development client:

```bash
cd /Users/dogan/Desktop/copilot-mobile/apps/mobile
pnpm start:dev-client -- --clear
```

If the phone shows `No script URL provided`, Metro is not reachable. Check:

- same Wi-Fi network
- Local Network permission enabled
- Metro running on port `8081`

## Bridge Development Flow

Start the direct development bridge:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm dev:bridge:direct
```

Or start the local companion stack with relay + dashboard:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm dev:companion:local
```

For a hosted relay deployment, set the same relay secret on both the bridge host and the relay host:

```bash
export COPILOT_MOBILE_RELAY_SECRET="replace-with-a-long-random-secret"
```

Or open the native macOS companion shell:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm dev:companion:macos
```

Check bridge health:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm bridge:status
```

Open the local companion dashboard:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm bridge:dashboard
```

Build the native macOS companion shell:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm build:companion:macos
```

Generate a QR code for pairing:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm bridge:qr
```

Expected flow:

1. Start Metro.
2. Install or launch the iOS development build.
3. Start the direct bridge.
4. Optionally open the dashboard to inspect bridge, relay, and QR state.
5. On macOS, prefer the native companion shell if you want one place to start or stop bridge modes and watch the embedded dashboard.
6. Scan the QR code from the phone.
7. Open or create a session in the app.

## Common Troubleshooting

### Workspace File Viewer

The file viewer expects workspace-relative paths from the local bridge. If a chat message contains a session-relative path like `../foo.ts`, the app now normalizes it against the active session context before requesting local file contents.

### `@` File Suggestions

`@` suggestions depend on the workspace tree. The app now requests the tree lazily when file autocomplete is opened in chat.

### Bridge Already Running

If `pnpm dev:bridge:direct` reports `EADDRINUSE`, another bridge instance is already listening on the same port. Check status first instead of starting a second copy:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm bridge:status
```

## Validation Commands

Mobile typecheck:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm --filter @copilot-mobile/mobile exec tsc --noEmit
```

Bridge typecheck:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm --filter @copilot-mobile/bridge-server exec tsc --noEmit
```

## App Store Readiness

Current state: not App Store ready yet.

The project is functional for local development, but it still has productization gaps before a public App Store release:

- direct bridge pairing is still a developer-oriented setup
- end-user desktop bridge installation and lifecycle are not finalized
- remote/tunnel onboarding is not the default production path yet
- App Store release packaging and onboarding UX are still incomplete
- privacy/compliance/release hardening still needs a final pass
- release telemetry and production recovery UX need more work

## Recommendation

Use the current build as a development and internal testing environment.

Before App Store submission, complete:

1. end-user bridge installer and startup flow
2. production transport and pairing defaults
3. release onboarding and reconnect UX
4. final privacy/review packaging checklist
5. App Store metadata and submission assets

# Copilot Mobile Runbook And App Store Readiness

This document describes the release-oriented desktop companion flow and the current readiness state as of April 23, 2026.

## Workspaces

- Root: `/Users/dogan/Desktop/copilot-mobile`
- Mobile app: `/Users/dogan/Desktop/copilot-mobile/apps/mobile`
- Bridge server: `/Users/dogan/Desktop/copilot-mobile/apps/bridge-server`
- Shared types: `/Users/dogan/Desktop/copilot-mobile/packages/shared`

## Local Setup

Requirements:

- macOS desktop or laptop that stays signed in
- Node.js 20+
- pnpm 9+
- Xcode with iOS development tools
- CocoaPods
- GitHub Copilot CLI authentication on the Mac
- A hosted relay/control-plane deployment for different-network reconnect

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

## Desktop Companion Flow

Target end-user flow:

```bash
npm install -g copilot-mobile
copilot-mobile login
copilot-mobile up
copilot-mobile doctor
```

After the QR is scanned once:

- the phone reconnects through the hosted relay
- the Mac companion keeps running as a user `LaunchAgent`
- users do not need to repeat pairing unless companion config, auth, or stored device credentials are reset

What the user must understand clearly before installing:

- the iPhone app is only the mobile bridge UI
- the real Copilot session runs on the user's Mac
- the Mac must remain on, signed in, and able to reach the relay
- if the Mac sleeps, loses network, or loses Copilot auth, the phone cannot continue the session until the companion recovers

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

Run the release-oriented readiness check:

```bash
cd /Users/dogan/Desktop/copilot-mobile
node ./bin/copilot-mobile.mjs doctor
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

## Production Checklist

Current state: internal production-validation ready, but not yet claimable as public App Store-ready until every checklist item below is green in a real deployment.

### 1. Companion Distribution

Required outcome:

- users install `copilot-mobile` globally with npm
- users run `copilot-mobile login` once
- users run `copilot-mobile up`
- `copilot-mobile doctor` returns `ready`

Release gate:

- companion bundle exists in the published npm package
- LaunchAgent installs cleanly under the logged-in macOS user
- Copilot CLI path resolves without manual edits
- the product copy clearly explains that the Mac companion is required

### 2. Reconnect Validation Matrix

The following matrix must pass on a real hosted relay before public release:

| Scenario | Expected Result |
| --- | --- |
| Same Wi-Fi, app foregrounded | session opens immediately and stream stays live |
| Wi-Fi to cellular switch on phone | reconnect succeeds without re-pairing |
| Different network after initial QR scan | reconnect succeeds through hosted relay |
| App background then foreground | active session resumes and pending stream state remains correct |
| Permission request while app is backgrounded | local notification is delivered if permission is granted |
| Session finishes while app is backgrounded | completion notification is delivered |
| Mac sleep then wake | companion reconnects to relay and phone can resume |
| Relay session renewal window | session expiry updates without forcing re-pair |
| Companion daemon restart | phone reconnects after daemon returns |
| Stale device credentials | app fails cleanly and prompts for fresh pairing instead of looping forever |

### 3. Relay And Control-Plane Hardening

Release gate:

- `/health` reports ready only when daemon, Copilot auth, and relay link are all healthy
- relay secrets and control-plane secrets are provisioned outside source control
- production deployment URL is stable and documented
- last error, companion id, and session expiry are visible via `status` or `doctor`
- bulk workspace and session delete paths complete without leaving orphaned local state

### 4. App Store And Onboarding Readiness

Release gate:

- onboarding copy explicitly says the app requires a Mac companion
- privacy, permission, and notification copy match the actual runtime behavior
- support docs explain what users install, what keeps running in the background, and what breaks reconnect
- App Store reviewer notes explain that code execution happens on the user's own Mac through GitHub Copilot CLI

## Recommendation

Use `copilot-mobile doctor` as the first support and release gate. If it is not green, do not proceed to public pairing or reconnect validation.

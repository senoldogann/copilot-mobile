# Code Companion Runbook And App Store Readiness

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

## Mac Companion Flow

Target end-user flow:

```bash
npm install -g code-companion
code-companion login
code-companion up
code-companion doctor
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
export CODE_COMPANION_SELF_HOSTED_RELAY_SECRET="replace-with-a-long-random-secret"
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

- users install `code-companion` globally with npm
- users run `code-companion login` once
- users run `code-companion up`
- `code-companion doctor` returns `ready`

Release gate:

- companion bundle exists in the published npm package
- LaunchAgent installs cleanly under the logged-in macOS user
- Copilot CLI path resolves without manual edits
- the product copy clearly explains that the Mac companion is required
- iOS debug device builds do not require a Push Notifications-capable provisioning profile

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
- App Store Connect metadata does not contain placeholder privacy or support URLs
- Reviewer package includes a sample QR and a short setup video

## Real-Device Regression Gate

Run this gate on a physical iPhone paired to a real Mac companion before every TestFlight or App Store submission. Every scenario below must have a clear pass or fail result.

### 1. Background Push

Setup:

- pair the iPhone with a Mac companion that is already healthy in `code-companion doctor`
- enable notifications for the app on the device
- keep the app installed as a development or production build, not Expo Go

Steps:

- send a prompt that will finish in the background
- immediately move the app to the background
- repeat with a prompt that triggers a permission request

Expected result:

- a local notification arrives while the app is backgrounded when the session finishes
- a local notification arrives while the app is backgrounded when a permission request is waiting
- opening the app clears the pending notification state instead of showing the same notification again

Fail condition:

- no notification arrives until the app returns to the foreground
- the same session completion notification appears again after reopening the app

### 2. Reconnect

Setup:

- start with a fresh successful pairing
- confirm the companion is connected through the hosted relay

Steps:

- switch from Wi-Fi to cellular
- switch to a completely different network after the original QR scan
- background and foreground the app during an active session
- restart the desktop daemon and reconnect
- put the Mac to sleep and wake it again

Expected result:

- the phone reconnects without a fresh QR scan
- the active session resumes without losing message history or stream state
- stale credentials fail cleanly and prompt for fresh pairing instead of looping forever

Fail condition:

- reconnect requires re-pairing in a healthy hosted-relay scenario
- the app shows connected state while the underlying session is actually broken

### 3. Stop Session

Setup:

- send a prompt that triggers tool calls, thinking, or subagents

Steps:

- tap the stop button while the assistant is actively streaming
- repeat during a long tool run and during a subagent run

Expected result:

- the stream stops immediately
- no additional assistant, thinking, todo, or subagent updates arrive after the stop is acknowledged
- the UI leaves the running state and the stop control becomes tappable again for later turns

Fail condition:

- the stop button changes visual state but the assistant keeps running
- the UI gets stuck in a pseudo-running state after the stop request

### 4. Git Commit / Pull / Push

Setup:

- open a workspace with a real git remote and a clean authenticated GitHub flow

Steps:

- create or edit files in the workspace
- commit from the top-bar git menu
- pull from the same menu
- push from the same menu

Expected result:

- commit, pull, and push are available from the chat header without opening the workspace sheet
- success feedback is shown with a short transient toast
- diff totals include new files as additions
- failures include actionable error text

Fail condition:

- any git action silently fails
- success feedback never appears or persists indefinitely
- new files do not contribute to the `+` diff count

### 5. Onboarding

Setup:

- delete the app from the phone and install a fresh build

Steps:

- open the app for the first time
- complete or dismiss onboarding
- reopen the app
- open onboarding again manually from Settings

Expected result:

- onboarding appears exactly once on first install before normal app usage
- onboarding can be opened again from Settings
- all cards fit on screen in light and dark themes without clipped content
- setup copy clearly explains the Mac companion requirement and the exact `code-companion` commands

Fail condition:

- the app lands directly on the main chat on a first install
- onboarding loops when the user taps the CTA buttons
- onboarding layout clips text or buttons on supported iPhone sizes

### 6. Large Chat Performance

Setup:

- use a chat with long streaming output, tool cards, thoughts, subagents, and todos

Steps:

- stream a long response
- scroll during streaming
- open and close tool cards, todo panels, and subagent panels
- leave the chat and return to it

Expected result:

- thinking and tool progress appear incrementally while preserving device thermals
- the main chat scroll remains responsive from the center of the screen, not only from the edges
- todo and subagent panels update live without flickering or stale counts
- finished todo and subagent state does not reappear on unrelated later turns

Fail condition:

- stream content only appears after completion
- repeated rerenders cause visible flicker, jank, or excessive device heat
- stale subagent or todo panels return on a later user message

### 7. Brand And Review Safety

Setup:

- review the latest iOS build, onboarding, settings, App Store metadata draft, and support copy together

Steps:

- scan for `Copilot Mobile`, `VSCode Mobile`, or any copy that suggests this is an official Microsoft or GitHub mobile client
- verify that the app is described as a desktop coding companion that runs actions on the user's own Mac

Expected result:

- product copy stays in the "desktop coding companion" lane
- no visible strings imply official GitHub Copilot or Visual Studio Code ownership

Fail condition:

- any customer-facing copy can be read as a brand clone, official client, or endorsed first-party product

## Recommendation

Use `code-companion doctor` as the first support and release gate. If it is not green, do not proceed to public pairing or reconnect validation.

# iOS Development Build Runbook

This project uses an Expo development build for iPhone testing. Always open the iOS workspace, not the Xcode project file.

## Required Shell Setup

Homebrew Node is unstable on this machine and has previously hung or crashed with `libsimdjson` errors. New interactive shells should prefer the bundled Codex Node runtime from `~/.zshrc`.

If a terminal was already open, refresh it before running project commands:

```bash
source ~/.zshrc
hash -r
node -v
pnpm -v
```

Expected working Node during this setup is the bundled runtime:

```text
/Applications/Codex.app/Contents/Resources/node
```

## Pod Install

Use the project wrapper instead of running `pod install` directly:

```bash
cd /Users/dogan/Desktop/copilot-mobile/apps/mobile
pnpm pod:ios
```

The wrapper is `apps/mobile/scripts/pod-install-safe.sh`. It sets the working Node runtime and patches CocoaPods plist parsing through `plutil`, avoiding the Ruby `CFPropertyList/kconv/nkf` hang seen on this machine.

## Opening Xcode

Open Xcode through the workspace:

```bash
cd /Users/dogan/Desktop/copilot-mobile/apps/mobile
pnpm xcode:ios
```

Never open `apps/mobile/ios/CopilotMobile.xcodeproj` directly for app builds. The workspace includes both `CopilotMobile.xcodeproj` and `Pods/Pods.xcodeproj`; opening only the project can cause missing Expo modulemap errors such as `No such module 'Expo'`.

If Xcode reports stale modulemap or PCH errors, close Xcode and clean DerivedData:

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/CopilotMobile-* ~/Library/Developer/Xcode/DerivedData/ModuleCache.noindex
```

Then reopen the workspace and use `Product > Clean Build Folder`.

## Metro For Development Client

Run Metro from the mobile workspace before or after installing the app:

```bash
cd /Users/dogan/Desktop/copilot-mobile/apps/mobile
pnpm start:dev-client -- --clear
```

If local network access is blocked by iOS, check:

```text
iPhone Settings > Apps > Copilot Mobile > Local Network
```

If the permission was denied before the plist changes, delete the app from the iPhone and install it again from Xcode.

## Bridge QR Pairing

For local iPhone development on the same Wi-Fi network, use the direct bridge command:

```bash
cd /Users/dogan/Desktop/copilot-mobile
pnpm dev:bridge:direct
```

This prints a terminal QR code with a private-network URL such as:

```text
ws://192.168.1.109:9876
```

Scan that QR code from the mobile app. Keep the bridge terminal running while using the app.

## Public Tunnel Mode

Production-style pairing requires a public `wss://` tunnel URL that forwards to the local bridge port, usually `127.0.0.1:9876`.

Once a tunnel URL exists:

```bash
cd /Users/dogan/Desktop/copilot-mobile
export COPILOT_MOBILE_PUBLIC_WS_URL="wss://your-tunnel.example.com"
pnpm bridge:up
```

Then print a fresh QR code any time while the bridge is running:

```bash
pnpm bridge:qr
```

`pnpm bridge:qr` only works after the bridge is already running. If the bridge is down, it should fail with `Bridge is not running`.

## Bridge Troubleshooting

If the app starts reconnecting before a QR scan, it is usually using old SecureStore credentials from a previous QR pairing. The app now performs only a quiet one-shot stored-credential resume on launch; it should not loop forever or keep showing WebSocket errors before the user scans a fresh QR.

If the terminal reports `EADDRINUSE` for port `9876`, another bridge process already owns the port. First check whether it is a healthy bridge:

```bash
pnpm bridge:status
pnpm bridge:qr
```

`pnpm dev:bridge:direct` now detects a healthy existing bridge and prints a fresh QR instead of starting a duplicate process. If the port is owned by a stale or unrelated process, find it with:

```bash
lsof -nP -iTCP:9876 -sTCP:LISTEN
```

Then stop that process or run `pnpm bridge:down` if it is a managed bridge.

## Common Warnings

`empty dSYM file detected` in Debug builds is not the cause of app startup failure.

`UIScene lifecycle will soon be required` is a future iOS lifecycle warning, not the current Metro or QR pairing failure.

`No script URL provided` means the development build could not reach Metro.

`Local network prohibited` means iOS blocked LAN access. Enable Local Network permission or reinstall the app to trigger the permission prompt again.

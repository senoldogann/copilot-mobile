# Code Companion

Use your phone to control GitHub Copilot CLI running on your own computer.

It works like this:

1. Install **Code Companion** on your **Mac or Windows PC**
2. Sign in to **GitHub Copilot CLI**
3. Run one command to start the desktop companion
4. Scan the QR code with the phone app
5. Chat from your phone while the real coding session runs on your computer

## Quick Start

### What you need

- A **Mac or Windows** computer
- **Node.js 20+**
- A **GitHub Copilot** account
- The official **GitHub Copilot CLI** (`copilot`) available in PATH
- On Windows: **PowerShell 7** (`pwsh.exe`) available in PATH
- The **Code Companion** mobile app

### Install it globally

```bash
npm install -g @senoldogann/code-companion
```

Install the official GitHub Copilot CLI separately:

```bash
npm install -g @github/copilot
```

On Windows, also install PowerShell 7 before pairing:

```powershell
winget install --id Microsoft.PowerShell --source winget
```

After that, you can use the global command:

```bash
code-companion
```

### First-time setup

Run these commands on the computer you want to control:

```bash
code-companion login
code-companion up
code-companion doctor
```

What these commands do:

- `code-companion login` opens the official GitHub Copilot CLI sign-in flow
- `code-companion up` starts the desktop companion and prints a QR code
- `code-companion doctor` checks that everything is ready

Then on your phone:

1. Open the app
2. Tap **Connect With QR**
3. Scan the QR code from your computer

That is it.

## Everyday Use

If you already installed the package globally, these are the main commands:

```bash
code-companion up
code-companion status
code-companion qr
code-companion doctor
code-companion logs
code-companion down
```

## What each command does

| Command | What it does |
| --- | --- |
| `code-companion login` | Sign in to GitHub Copilot CLI |
| `code-companion up` | Start the desktop companion and show a pairing QR |
| `code-companion status` | Show whether the desktop companion is running |
| `code-companion qr` | Print a fresh QR code |
| `code-companion doctor` | Check auth, daemon, and connection health |
| `code-companion logs` | Show desktop companion logs |
| `code-companion down` | Stop the desktop companion |

## Supported computers

- **macOS**: runs through a LaunchAgent
- **Windows**: runs through a detached background daemon

## Simple troubleshooting

### `code-companion` command not found

Install the package globally:

```bash
npm install -g @senoldogann/code-companion
```

Then open a new terminal and try:

```bash
code-companion doctor
```

### Copilot is not signed in

Run:

```bash
code-companion login
```

### `spawn copilot ENOENT`

This means Code Companion could not start the Copilot CLI binary.

Install the official GitHub Copilot CLI:

```bash
npm install -g @github/copilot
```

Then open a new terminal and check:

```bash
code-companion doctor
```

### The phone cannot connect

Run:

```bash
code-companion doctor
code-companion qr
```

Then scan the new QR code.

### I changed to a different computer

Scan the QR code from the new computer. The mobile app now keeps chat and workspace cache scoped to the connected companion so different machines should not mix together.

## How it works

- Your phone is the **remote control**
- Your computer runs the **real Copilot CLI session**
- The bridge server talks to `@github/copilot-sdk`
- Pairing happens through a QR code
- Reconnect and session continuity are supported

## Development

Install dependencies:

```bash
pnpm install
```

Useful commands:

```bash
pnpm test
pnpm test:mobile
pnpm typecheck
pnpm build:shared
pnpm build:bridge
pnpm build:desktop
```

For the relay docs, see:

- `docs/cloudflare-relay.md`

For desktop companion notes, see:

- `docs/desktop-companion.md`

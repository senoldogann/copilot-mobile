# App Store Metadata Draft

Last updated: April 23, 2026

This draft avoids third-party product names in the store-facing app title.

## Recommended app name

`Code Companion`

Reason:

- Avoids GitHub / Copilot / VS Code trademark risk in the app title.
- Still describes the product as a companion app.
- Leaves room to explain the Mac requirement in subtitle and description.

## Avoid these names

- `VSCode Mobile`
- `VS Code Mobile`
- `Visual Studio Code Mobile`
- `Copilot Mobile`
- `GitHub Copilot Mobile`

Why:

- Apple Guideline 2.3.7 and 5.2.1 create metadata and trademark risk for third-party brand usage without approval.
- Microsoft’s VS Code brand page says not to use `Visual Studio Code` or `VS Code` in your product or service name.

## Recommended subtitle

`Continue your Mac coding sessions`

Alternative:

`Remote companion for your Mac`

## Promotional text

`Pair your iPhone with your own Mac, then continue coding sessions, approvals, and progress updates from anywhere.`

## Short description / first paragraph

`Code Companion is a mobile client for a coding session that runs on your own Mac. Install the desktop companion on your Mac, sign in there, scan the pairing QR once, and continue your session from iPhone.`

## Key bullets for the full description

- Requires a Mac that stays powered on and signed in.
- Uses your own desktop companion for the active coding session.
- Scan once to pair your iPhone with your Mac.
- Reconnect through the hosted relay after pairing.
- Optional notifications for approval requests and background completion alerts.

## Keywords to keep

- companion
- remote coding
- developer
- coding workflow
- mac companion

## Keywords to avoid

- VS Code
- vscode
- Visual Studio Code
- GitHub Copilot
- copilot

## Reviewer notes draft

```text
The iPhone app is a companion client for a user-owned Mac.

Review setup:
1. On the Mac, install the desktop companion:
   npm install -g code-companion
2. Sign in on the Mac:
   code-companion login
3. Start the Mac companion and show the pairing QR:
   code-companion up
4. On iPhone, open the Setup Guide if needed, then scan the QR.

Important:
- The coding session runs on the user’s own Mac.
- The iPhone app is the remote companion client.
- Camera is used only for QR pairing.
- Notifications are optional and only used for background approval/completion alerts.
```

## Still blocked until the website exists

- Public support URL with real contact details
- Public privacy policy URL
- In-app link to the final public privacy policy
- Final App Store Connect privacy answers tied to that policy
- Final review attachments: sample QR and short setup video

Note:

- This does not require a full marketing website. A simple public support page and privacy page are enough for submission metadata.
- Do not submit with placeholder, empty, or temporary URLs.

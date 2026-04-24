# App Store Review Readiness

Last checked: April 23, 2026

This note tracks the current App Store review risk for the iPhone app and the companion-based setup flow.

## Official Apple sources used

- App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
- App Review overview: <https://developer.apple.com/app-store/review/>
- App Store review details: <https://developer.apple.com/documentation/appstoreconnectapi/app-store-review-details>
- Human Interface Guidelines: Onboarding: <https://developer.apple.com/design/human-interface-guidelines/onboarding>
- Human Interface Guidelines: Notifications: <https://developer.apple.com/design/human-interface-guidelines/notifications/>
- Human Interface Guidelines: Privacy: <https://developer.apple.com/design/human-interface-guidelines/privacy/>
- App privacy details: <https://developer.apple.com/app-store/app-privacy-details/>
- App information reference: <https://developer.apple.com/help/app-store-connect/reference/app-information/app-information>
- Manage app privacy: <https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy>

## What is in better shape now

- The app now has an in-app setup guide that clearly says a Mac companion is required.
- The setup guide explains the exact Mac commands:
  - `npm install -g @senoldogann/code-companion`
  - `code-companion login`
  - `code-companion up`
- The store-facing mobile app name has been moved to `Code Companion` to reduce third-party trademark risk.
- Notification permission is no longer prompted at launch. The user now gets context first and can enable notifications from onboarding or settings.
- The QR screen now links back to setup guidance.
- Settings now include setup help and a notifications action.

## Source-backed review requirements we must satisfy

### 1. Accurate metadata and complete review instructions

Apple says submissions must be complete and accurate, and that review notes must include any non-obvious setup. Apple also says that if review needs extra resources, you should provide them, such as a demo account, sample QR code, demo video, or hardware details.

Implication for this app:

- The App Store description must clearly say the iPhone app requires a Mac companion.
- The reviewer must receive working review notes with the Mac setup, sample QR, and the hosted relay path.
- If Apple cannot reproduce the pairing flow quickly, the app is at risk under completeness and reviewability expectations.

### 1.1 Support URL should be ready before release operations

Apple’s App Review overview and App Store Connect reference expect a support URL with real contact details for shipped apps and updates.

Implication for this app:

- A minimal public support page is still needed even if the full marketing website is not ready.
- That page should include at least a support email or other direct contact method.

### 2. Privacy policy URL is required

Apple’s current App Review Guidelines and App Store Connect help both state that all apps must provide a privacy policy URL, and that it must also be accessible within the app.

Implication for this app:

- Submission is not ready without a public privacy policy URL.
- The app should expose that policy from an easily accessible place in the UI.

### 3. Don’t ask for permission without context

Apple’s HIG for Privacy and Notifications says to avoid asking for permission at launch unless it is obviously required, and to request notification authorization in a context that explains the benefit.

Implication for this app:

- Launch-time notification prompts were a review risk.
- The updated onboarding and settings flow is closer to Apple’s recommended pattern.

### 4. Power, heat, and device stress matter

App Review Guideline 2.4.2 says apps should not rapidly drain battery, generate excessive heat, or put unnecessary strain on the device.

Implication for this app:

- Physical-device battery and heat checks are part of release readiness.
- Long-running scroll, animation, socket reconnect, and background notification flows should be profiled on a real iPhone before submission.

### 5. Third-party trademarks and service permissions

App Review Guideline 5.2.1 says you must not use protected third-party trademarks or misleading names without permission. Guideline 5.2.2 says that if an app uses or displays a third-party service, you need to be permitted to do so under that service’s terms.

Implication for this app:

- If you do not have permission to market the iOS app using GitHub or GitHub Copilot branding, this remains a real rejection risk.
- Microsoft’s official VS Code brand page says not to use `Visual Studio Code` or `VS Code` in your own product or service name, so `VSCode Mobile` is not a safe title.
- Review notes should describe the app as a companion for the user’s own Mac running GitHub Copilot CLI, not as an official GitHub or Microsoft product, unless you are authorized to claim that.

## Current blockers that are still manual

These are not solved fully by code alone:

1. A public privacy policy URL is still required in App Store Connect.
2. A public support URL with real contact details should be prepared before release operations and later version updates.
3. That same privacy policy should be reachable from inside the app.
4. App Store Connect privacy answers still need to be filled accurately for the shipped build and all included SDKs.
5. The app still has a structural App Review risk under Guideline 4.2.3 because it depends on a separate Mac companion to deliver its core function.
6. Reviewer materials still need to make that dependency explicit with a demo QR flow and review notes.
7. Review notes still need attachments:
   - sample QR code
   - optional demo video
   - short explanation of the Mac companion requirement

## Recommended App Review notes

Use a reviewer note close to this:

```text
This iPhone app is a companion client for a user-owned Mac.

How to review:
1. On the Mac, install the desktop companion with:
   npm install -g @senoldogann/code-companion
2. Sign in on the Mac:
   code-companion login
3. Start the companion and display the pairing QR:
   code-companion up
4. On iPhone, open the Setup Guide if needed, then scan the QR from the Mac.

Important behavior:
- The coding session runs on the user’s own Mac through GitHub Copilot CLI.
- The iPhone app is the remote mobile client.
- Notifications are optional and are used only for background approval/completion alerts.
- Camera access is used only for QR pairing.

Attachments:
- sample QR code
- demo video showing Mac setup -> QR scan -> paired chat session
```

## Submission status today

Engineering status:

- Closer to review-ready than before.
- Not honestly safe to call "fully App Store ready" yet.

Reason:

- The in-app onboarding and permission timing are now much better.
- The remaining high-risk items are privacy policy, privacy disclosures, and the App Review risk created by the Mac companion dependency itself.
- Submission metadata should not use placeholder support or privacy URLs.

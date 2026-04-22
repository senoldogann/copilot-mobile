# Background Completion Push Design

## Problem

Today, session completion notifications are generated inside the mobile app process.

- `apps/mobile/src/services/app-runtime.ts` marks a session as pending when the app moves to the background.
- `apps/mobile/src/services/background-completion.ts` waits for live bridge events and then schedules a local notification.
- `apps/mobile/src/services/notifications.ts` only creates local notifications from mobile JS.

This works only while the app JS runtime and WebSocket connection are alive. On iOS, once the app is backgrounded, the app is commonly suspended. When that happens:

- the mobile WebSocket no longer receives session updates in real time
- completion detection no longer runs
- local notifications cannot be scheduled at the moment the session actually finishes
- the session appears to "finish" only after the user reopens the app and reconnect/resume runs

This is not a reliable production architecture for background completion.

## Decision

Move session completion notifications from a mobile-local mechanism to a server-authoritative remote push mechanism.

The bridge server becomes the source of truth for:

- whether a session entered a new busy cycle
- whether that busy cycle completed
- whether the mobile app was foregrounded or backgrounded when completion happened
- whether a push should be emitted

The mobile app becomes responsible for:

- obtaining a push token in dev-build / production builds
- registering that token with the bridge
- reporting foreground/background presence
- opening the correct session when the user taps the notification

Local notifications remain optional fallback behavior, not the primary completion channel.

## Alternatives Considered

### 1. Keep the current local notification flow

Rejected.

It depends on the mobile JS runtime staying alive in background. That assumption does not hold reliably on iOS.

### 2. Add a mobile background task to keep the socket alive

Rejected.

For a live interactive WebSocket session this is not a reliable or App Store-friendly foundation. Background execution windows are limited, non-deterministic, and not appropriate for long-running conversational tracking.

### 3. Emit completion from bridge server using remote push

Accepted.

The bridge server already owns session lifecycle information and can observe completion even when the mobile app is suspended. It is the right place to decide when a completion push should be sent.

## Architecture

### Current authority boundaries

- Bridge server owns live session state through `session-manager.ts`
- Mobile app owns local UI state and notification presentation
- Relay only transports WebSocket traffic and should not become the main notification decision-maker

### New authority boundaries

- Bridge server owns completion notification eligibility and push dispatch
- Mobile app owns push registration and tap routing
- Relay stays transport-only unless future hosted push orchestration is needed

### Why bridge server, not relay

The bridge server is the simplest and most correct place for completion push emission because:

- it already observes session busy/idle transitions
- it already knows the authenticated mobile device identity
- it already runs for both direct and relay transports
- it can call Expo Push or a future APNs/FCM provider directly over outbound internet

This avoids moving session semantics into Cloudflare Durable Objects.

## End-to-End Flow

### Registration flow

1. Mobile app initializes notifications in a dev build or production build.
2. Mobile app obtains an Expo push token.
3. Mobile app sends a new bridge message such as `notification.device.register`.
4. Bridge server derives device identity from the authenticated WebSocket connection and stores the push registration under that device.

### Presence flow

1. Mobile app reports app visibility changes with a new bridge message such as `notification.presence.update`.
2. Values are `active`, `inactive`, or `background`.
3. Bridge server stores the last known presence for the current authenticated connection and ignores older timestamps for the same device.
4. On socket close / heartbeat timeout, bridge invalidates any previously foreground presence for that connection.

### Completion flow

1. Session becomes busy.
2. Bridge server marks that session/device pair as having a pending completion cycle.
3. Session returns to idle / `busy=false`.
4. Bridge server checks:
   - is there a registered push token for the authenticated device
   - is the last reliable mobile presence `background`, or is the device currently disconnected / stale
   - has this busy cycle already produced a notification
5. If eligible, bridge server sends one remote push.
6. Mobile app opens the session from the notification tap using existing session routing behavior.

## Protocol Changes

Add new client-to-server messages in `packages/shared/src/protocol.ts`.

### `notification.device.register`

Payload:

- `platform: "ios" | "android"`
- `provider: "expo"`
- `pushToken: string`
- `appVersion?: string`

Purpose:

- bind a remote push destination to the authenticated mobile device

### `notification.device.unregister`

Payload:

empty object

Purpose:

- explicitly remove a token when permissions are revoked, token becomes invalid, or the user signs out / unpairs

### `notification.presence.update`

Payload:

- `state: "active" | "inactive" | "background"`
- `timestamp: number`

Purpose:

- let the bridge decide whether the app is foregrounded when a session finishes

No server-to-client push-delivery acknowledgment message is required in phase 1.

## Bridge Server Design

### New modules

Introduce a notification subsystem under `apps/bridge-server/src/notifications/`.

Suggested files:

- `device-registry.ts`
- `push-provider.ts`
- `completion-notifier.ts`

### `device-registry.ts`

Responsibilities:

- persist push registrations keyed by authenticated device
- track connection-scoped presence in memory
- support register, unregister, lookup, connection lifecycle, and presence update operations

Storage recommendation:

- lightweight JSON file in the bridge server data directory
- write-through persistence with explicit fs error handling

Keep this simple in phase 1. A database is unnecessary.

Important boundary:

- persist push tokens
- do not persist live foreground/background presence across process restarts

### `push-provider.ts`

Responsibilities:

- wrap Expo Push HTTP API
- provide typed `sendCompletionPush(...)`
- handle provider errors explicitly
- return structured success / failure results

Phase 1 recommendation:

- start with Expo Push because the mobile app already uses Expo
- keep provider isolated so APNs/FCM direct delivery can replace it later

### `completion-notifier.ts`

Responsibilities:

- track pending completion cycles per session
- decide whether a notification should be sent
- dedupe notifications per busy cycle
- build notification title/body preview

Recommended rule:

- arm notification eligibility when a session transitions to `busy=true`
- emit at the first stable completion transition to `busy=false`
- clear cycle state after push emission or when a new busy cycle starts
- dedupe local-vs-remote notifications by suppressing mobile-local completion scheduling once bridge-side remote push registration is active

## Session Lifecycle Integration

Use existing busy/idle lifecycle rather than inventing a new completion detector.

Integration point:

- the bridge server already emits `session.state` with `busy`
- completion notifier should hook into the same adapted session state transitions

Required behavior:

- when busy changes from false to true, mark pending completion
- when busy changes from true to false, evaluate and possibly push
- if a session errors and the busy cycle ends with failure, still allow a push with an error-oriented body in a later phase; phase 1 can restrict to successful completions only if we want minimum scope

Recommended phase 1:

- push on both successful completion and error completion
- message copy should distinguish failure from success

## Mobile App Design

### Notification registration

Extend `apps/mobile/src/services/notifications.ts` so it can:

- obtain Expo push token in non-Expo-Go environments
- surface token acquisition errors clearly
- expose a typed registration result

### Bridge registration

Extend app startup and reconnect flow so that after authentication:

- the app registers its push token with the bridge
- the app sends current presence state immediately

### Presence updates

Extend `apps/mobile/src/services/app-runtime.ts` so every `AppState` transition also sends presence updates to bridge.

Rules:

- on foreground: send `active`
- on inactive/background: send the matching non-active state
- if bridge is disconnected, do not queue stale presence events; instead send the current state after reconnect

### Tap routing

Keep existing notification tap routing behavior. The notification payload should continue including `sessionId`.

## Data Model

### Bridge-side registration record

Suggested shape:

```ts
type RegisteredMobileDevice = {
  deviceId: string;
  platform: "ios" | "android";
  provider: "expo";
  pushToken: string;
  appVersion?: string;
  updatedAt: number;
};
```

Presence stays separate and connection-scoped:

```ts
type ConnectedDevicePresence = {
  deviceId: string;
  connectionId: string;
  state: "active" | "inactive" | "background";
  timestamp: number;
  receivedAt: number;
};
```

### Completion tracking record

Suggested shape:

```ts
type PendingCompletionCycle = {
  sessionId: string;
  deviceId: string;
  armedAt: number;
  lastKnownTitle: string | null;
  lastAssistantPreview: string | null;
  notified: boolean;
};
```

## Notification Content Rules

Title:

- session title if available
- otherwise `Copilot finished working`

Body:

- latest assistant content preview if available
- otherwise a generic fallback

Length:

- clamp to a short single-line preview

Phase 1 should avoid rich notification features and keep copy deterministic.

## Error Handling

### Registration errors

- token retrieval failure must not break the session
- registration send failure should be logged and retried on next reconnect
- missing Expo `projectId` must surface a clear error instead of silently disabling remote push

### Push provider errors

- invalid token responses should remove or quarantine the token
- transient provider failures should be logged with enough context
- do not fail session completion if push delivery fails

### Presence mismatch

If the app crashes or disconnects without reporting background:

- treat disconnected mobile as non-active
- allow server-side push on completion

This is preferable to missing the notification.

If presence is `inactive` but the socket is still connected:

- do not send a completion push yet
- wait for either `background` or disconnect / timeout

## Migration Plan

### Phase 1

- add protocol messages
- add mobile push token registration
- add mobile presence updates
- add bridge-side registry and Expo push provider
- add bridge-side completion notifier
- suppress existing local background completion notifications once remote registration is active, while keeping the local codepath as a fallback when remote registration never succeeded

### Phase 2

- reduce or remove local completion scheduling when remote push is confirmed stable
- add failure-completion copy tuning
- add token invalidation cleanup and observability

### Phase 3

- optionally support direct APNs/FCM for production builds if Expo Push becomes limiting

## Testing Strategy

### Bridge server

Add integration coverage for:

- register token
- update presence
- busy true -> busy false emits exactly one push
- active presence suppresses push
- disconnected mobile still receives push eligibility
- repeated idle events do not duplicate push

### Mobile

Add smoke coverage for:

- token registration after auth
- presence updates on `AppState` transitions
- tap routing from notification payload

### Manual verification

1. Start a session.
2. Send a long-running agent task.
3. Background the app.
4. Confirm the bridge remains the source of truth for completion.
5. Confirm a remote push arrives before reopening the app.

## Risks

### Expo Push dependency

This introduces dependency on Expo Push delivery for phase 1. Acceptable because it is the fastest reliable path and is isolated behind a provider wrapper.

### Token churn

Push tokens can rotate. Registration must be repeatable and idempotent.

### Local bridge offline

If the bridge server loses internet connectivity, it cannot emit Expo Push even if the session completes. This is acceptable and matches the fact that the current system is already less reliable.

## Non-Goals

- keeping mobile WebSocket alive in background
- implementing arbitrary background execution on iOS
- moving session semantics into the relay layer
- building a full notification preferences center in phase 1

## Recommended Implementation Order

1. Add shared protocol types for device registration and presence.
2. Add bridge-side device registry and Expo push provider.
3. Wire completion notifier into session busy/idle transitions.
4. Add mobile token registration after authentication.
5. Add mobile presence updates from `AppState`.
6. Keep local notification fallback until the remote path is verified.

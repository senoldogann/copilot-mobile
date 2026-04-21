# Relay Deployment

This relay is the public network edge for Copilot Mobile. It only accepts authenticated companion and mobile sockets. Both sides must present a signed relay access token immediately after the socket opens.

## Required Environment

Use the same secret on both the relay host and the desktop bridge host:

```bash
export COPILOT_MOBILE_RELAY_SECRET="replace-with-a-long-random-secret"
```

You can also start from [apps/relay-server/.env.example](/Users/dogan/Desktop/copilot-mobile/apps/relay-server/.env.example).

On the relay host also set:

```bash
export RELAY_PORT=8787
```

## Docker Build

From the repo root:

```bash
docker build -t copilot-mobile-relay ./apps/relay-server
```

## Docker Run

```bash
docker run \
  --name copilot-mobile-relay \
  -e COPILOT_MOBILE_RELAY_SECRET="$COPILOT_MOBILE_RELAY_SECRET" \
  -e RELAY_PORT=8787 \
  -p 8787:8787 \
  --restart unless-stopped \
  copilot-mobile-relay
```

## Public Endpoint

Put a public `wss://` endpoint in front of the relay container and forward WebSocket upgrades to the relay process.

Expected routes:

- `/connect/mobile/:companionId`
- `/connect/companion/:companionId`
- `/health`

## Bridge Host

On the desktop bridge host:

```bash
export COPILOT_MOBILE_RELAY_SECRET="replace-with-the-same-secret"
export COPILOT_MOBILE_RELAY_URL="wss://your-relay-domain.example.com"
pnpm copilot-mobile up
```

The bridge will mint a companion relay token, mint a mobile relay token, connect the desktop companion socket outbound, and embed the mobile relay token into the pairing QR.

## Smoke Check

```bash
curl https://your-relay-domain.example.com/health
```

You should get JSON containing `ok: true`.

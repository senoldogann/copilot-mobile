# Relay Deployment

This relay is the public network edge and control-plane for Code Companion. It accepts authenticated companion and mobile sockets, and it also exposes the hosted companion registration/session endpoints used by `code-companion up`.

## Required Environment

Use the same relay secret on the relay host and, for self-hosted legacy mode, on the desktop bridge host:

```bash
export COPILOT_MOBILE_RELAY_SECRET="replace-with-a-long-random-secret"
```

Optionally provide a separate control-plane signing secret:

```bash
export COPILOT_MOBILE_CONTROL_PLANE_SECRET="replace-with-a-long-random-secret"
```

You can also start from [apps/relay-server/.env.example](/Users/dogan/Desktop/copilot-mobile/apps/relay-server/.env.example).

On the relay host also set:

```bash
export RELAY_PORT=8787
```

The bundled relay server is development-safe by default:

- `POST /v1/companions/register` only accepts localhost callers unless you explicitly set
  `COPILOT_MOBILE_ALLOW_PUBLIC_REGISTRATION=1`
- control-plane endpoints apply basic in-memory rate limiting

For a real hosted production deployment, keep registration behind your own trusted edge or managed control-plane instead of exposing the reference server directly without additional abuse protection.

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

Expected public routes:

- `POST /v1/companions/register`
- `POST /v1/companions/session`
- `POST /v1/companions/session/refresh`
- `/connect/mobile/:companionId`
- `/connect/companion/:companionId`
- `/health`

## Mac Companion

For a hosted deployment:

```bash
export COPILOT_MOBILE_HOSTED_API_BASE_URL="https://your-relay-domain.example.com"
export COPILOT_MOBILE_HOSTED_RELAY_BASE_URL="wss://your-relay-domain.example.com"
code-companion up
```

The desktop companion will register once, obtain a companion session from the control-plane, connect the outbound companion socket, and embed the mobile relay token into the pairing QR.

Legacy self-hosted bridge mode still exists, but it is no longer the primary desktop flow.

## Smoke Check

```bash
curl https://your-relay-domain.example.com/health
```

You should get JSON containing `ok: true`.

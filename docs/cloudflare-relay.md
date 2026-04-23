# Cloudflare Hosted Relay

This is the production-oriented remote networking path for Code Companion.

The goal is:

1. Deploy the relay/control-plane once to Cloudflare Workers.
2. Point the desktop companion at that public URL.
3. Let end users run only `code-companion login` and `code-companion up`.

## App Location

Cloudflare Worker source lives in:

- `/Users/dogan/Desktop/copilot-mobile/apps/cloudflare-relay`

It provides:

- `POST /v1/companions/register`
- `POST /v1/companions/session`
- `POST /v1/companions/session/refresh`
- `GET /health`
- `/connect/mobile/:companionId`
- `/connect/companion/:companionId`

The public relay and control-plane run in the same Worker.

## GitHub Actions Deploy

The repository now includes a dedicated workflow at
[deploy-cloudflare-relay.yml](/Users/dogan/Desktop/copilot-mobile/.github/workflows/deploy-cloudflare-relay.yml).

It will deploy the Worker automatically on `main` changes under `apps/cloudflare-relay/**`
or when triggered manually, as long as these repository secrets exist:

```bash
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

## One-Time Deploy

Run these commands from the repo root:

```bash
pnpm install
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler login
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler secret put RELAY_SECRET
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler secret put CONTROL_PLANE_SECRET
pnpm --filter @copilot-mobile/cloudflare-relay exec wrangler deploy
```

Wrangler will print a public URL similar to:

```bash
https://copilot-mobile-relay.<your-subdomain>.workers.dev
```

Current production Worker URL:

```bash
https://copilot-mobile-relay.senoldogan0233.workers.dev
```

The desktop companion now uses this hosted API by default, so end users do not need to export any relay environment variables.

## Mac Companion

After the Worker is deployed, run from any terminal:

```bash
code-companion login
code-companion up
```

The command will:

- start or refresh the background macOS companion daemon
- connect the desktop side to the Cloudflare relay
- print a pairing QR directly in the terminal

The phone can then scan the QR and connect from a different network.

## Local Validation

Run these commands from the repo root:

```bash
pnpm install
pnpm --filter @copilot-mobile/cloudflare-relay typecheck
```

For local Cloudflare Worker development:

```bash
pnpm dev:relay:cloudflare
```

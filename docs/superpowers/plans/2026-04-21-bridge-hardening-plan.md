# Code Companion Bridge Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the bridge and mobile stack by fixing the verified security and reliability gaps without chasing stale findings from the previous audit.

**Architecture:** Keep the existing monorepo boundaries intact: shared protocol stays in `packages/shared`, bridge hardening stays in `apps/bridge-server`, and mobile UX/runtime constraints remain documented in `apps/mobile`. Do not attempt a partial WSS rollout until the client trust model for Expo/React Native is designed end-to-end.

**Tech Stack:** Node.js, TypeScript, `ws`, `@github/copilot-sdk`, Expo 54, React Native 0.81, Zustand.

---

### Task 1: Audit Alignment And Documentation

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-bridge-hardening-plan.md`
- Modify: `README.md`

- [ ] Record the verified findings from the audit in repository documentation.
- [ ] Explicitly mark these findings as still valid: no WSS/TLS transport, validation error detail leakage, in-memory rate limiter growth risk.
- [ ] Explicitly mark these findings as stale: auth timeout leak as written, missing credential persistence, missing runtime mode normalization, missing `@` and `/` autocomplete.
- [ ] Add a short note that WSS requires a client trust strategy on Expo/React Native before rollout.

### Task 2: Bridge Validation Sanitization

**Files:**
- Modify: `apps/bridge-server/src/ws/handler.ts`

- [ ] Replace raw Zod issue echoing with a generic client-facing validation error.
- [ ] Keep full validation details in server logs only.
- [ ] Preserve existing error code semantics so the mobile client behavior does not regress.

### Task 3: Defensive Authentication Timeout Cleanup

**Files:**
- Modify: `apps/bridge-server/src/ws/server.ts`

- [ ] Add explicit timeout cleanup immediately after a successful JWT auto-auth path.
- [ ] Keep the existing callback-based cleanup intact.
- [ ] Treat this as defense-in-depth and readability, not as the primary risk item.

### Task 4: Rate Limiter Hardening

**Files:**
- Modify: `apps/bridge-server/src/utils/rate-limit.ts`

- [ ] Add bounded cleanup behavior on write paths so high-cardinality attacks cannot wait for the periodic timer alone.
- [ ] Avoid adding a new dependency unless the current map-based implementation becomes too complex.
- [ ] Keep timer-based cleanup for replay protection, but make per-key insertion self-pruning enough to cap growth pressure.

### Task 5: WSS/TLS Design Gate

**Files:**
- Modify: `README.md`
- Optional future design doc: `docs/superpowers/specs/2026-04-21-wss-transport-design.md`

- [ ] Document that bridge transport is still `ws://` and therefore not production-grade secure.
- [ ] Document that Expo/React Native JS WebSocket does not currently give this app a complete custom trust/pinning path in its existing architecture.
- [ ] State the next design requirement clearly: trusted certificate distribution or native SSL pinning strategy before enabling `wss://` by default.

### Task 6: Verification

**Files:**
- Verify only

- [ ] Run `pnpm build:shared`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:bridge` if bridge-side changes affect behavior.
- [ ] Review changed files for accidental UX regressions in mobile code.

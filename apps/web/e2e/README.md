# E2E — upload wizard (real browser, real worker)

A Playwright flow that drives the whole product the way an operator does: sign in,
walk the 5-step upload wizard with a real CSV, and assert the worker dispatched
the **locked** webhook payload to a stand-in receiver.

## What it exercises

`upload-wizard.spec.ts` runs in a real Chromium against the real stack:

1. **Auth** — lands an authenticated session (dev seam, see below).
2. **Context** → ticket ref + note.
3. **Upload** → `fixtures/sample-tenants.csv` parsed client-side.
4. **Match columns** → maps `First name / Last name / Customer Email` → `first_name / last_name / email`.
5. **Review & submit** → validates the grid, submits.
6. **Deliver** → the worker's queue consumer POSTs the batch to the local
   catcher; the test asserts the captured payload byte-for-byte (rows with
   1-based `row`, `batch {index,count,totalRows}`, injected `user.userId`,
   packed `metadata`).

## Run it

```bash
pnpm --filter @evo-csv/web test:e2e          # reuses any running dev servers
CI=1 pnpm --filter @evo-csv/web test:e2e     # cold: Playwright boots everything
```

`playwright.config.ts` starts three `webServer`s itself, so no manual setup:

- **webhook catcher** (`e2e/webhook-catcher.mjs`, :9099) — records deliveries, exposes `/__captured`.
- **worker** (:8787) — applies local D1 migrations (the seed) then `wrangler dev` with `ENVIRONMENT=local` + `DEV_EMAIL=aphisak@mohara.co`.
- **web** (:5173) — Vite with blank `VITE_FIREBASE_*` so the SPA's dev bypass is active.

First run only: `pnpm --filter @evo-csv/web exec playwright install chromium`.

## Auth: dev seam vs. real Google

The test authenticates via the **local dev seam**: no `VITE_FIREBASE_*` → the SPA
sends no token → the worker (`ENVIRONMENT=local`) authorizes as `DEV_EMAIL`. This
is the actual user (`aphisak@mohara.co`) minus Google's redirect, which needs a
human and so can't run unattended.

To exercise **real Firebase Google sign-in** end-to-end, build/serve the web app
with the `VITE_FIREBASE_*` values from
[docs/runbooks/auth-firebase-provisioning.md](../../../docs/runbooks/auth-firebase-provisioning.md),
point the spec's `baseURL` at it, and complete the Google consent by hand (or with
a dedicated test account) — the wizard steps after sign-in are identical.

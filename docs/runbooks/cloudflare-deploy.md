# Runbook — Cloudflare provisioning + first deploy

Takes the worker from code-complete to live. The build is verified
(`wrangler deploy --dry-run` passes; all bindings resolve), so what remains is
**creating the two remote resources** the worker binds (D1 + Queue) and one
`deploy`.

## $0, no card, no paid plan

The architecture runs entirely on the **Workers Free plan** with **no payment
method on file**:

- **Queues** — free (10,000 operations/day on Workers Free; we use a few per
  upload). No card required.
- **D1** — free (5 GB account storage, 100k writes / 5M reads per day). Batch
  payloads are stored here (gzipped) — see [ADR-0002](../adr/0002-no-r2-batch-payloads-in-d1.md).
- **R2 was removed** precisely because enabling it requires a card on file. There
  is no R2 binding anymore.

The current `aphisak@mohara.co` OAuth token already has the `workers`, `d1`, and
`queues` scopes needed below (no `r2` scope required).

Account in use: `aphisak@mohara.co` (`01ac9228929b4e4dadeeb28a70e92475`). If the
team wants a dedicated prod account, switch before provisioning — the D1 id is
per-account.

> Naming note: the D1 binding in `wrangler.toml` is `evo-csv-dev` (the current,
> dev-flavoured name). For a separate prod DB, create it under a prod name and
> update `database_name`/`database_id` to match.

## Provision (run from `apps/worker/`)

```bash
# 1. D1 — create, then paste the returned id into wrangler.toml [[d1_databases]].database_id
npx wrangler d1 create evo-csv-dev
# 2. Apply schema + seed (project, env, imp_tenants importer + columns, owner) to REMOTE
npx wrangler d1 migrations apply evo-csv-dev --remote
# 3. Queue (free on Workers Free)
npx wrangler queues create webhook-dispatch
```

No R2 step. No card. No plan upgrade.

## Config to set before deploy

In `apps/worker/wrangler.toml`:

- `database_id` → the id from step 1.
- `ENVIRONMENT` → keep `production` (committed default; verifies Firebase tokens).
- `FIREBASE_PROJECT_ID` → already `evo-usecsv`.
- `APP_BASE_URL` → **change** from `http://localhost:5173` to the prod web origin
  (used for invite links / redirects).

No secrets to set — Firebase verification uses public JWKS.

## Deploy

```bash
pnpm --filter @evo-csv/worker deploy            # worker
# web (Pages or your host) built with the public VITE_FIREBASE_* from
# docs/runbooks/auth-firebase-provisioning.md §2
```

## Seed the first owner + smoke test

```bash
pnpm bootstrap --email you@yourco.com --project-slug evo --project-name EVO --remote
```

Then follow [auth-firebase-provisioning.md](auth-firebase-provisioning.md) §5 for
the live sign-in smoke test, and the [E2E flow](../../apps/web/e2e/README.md) for
the upload→webhook path (runnable locally without any of the above).

## Verified deploy-readiness (as of this branch)

- `wrangler deploy --dry-run` ✅ — worker compiles; bindings are D1 + Queue only
  (no R2).
- Worker 156 / web 191 unit tests ✅; Playwright E2E ✅ (cold boot, R2 removed).
- Locked webhook payload unchanged (snapshot + E2E assert it byte-for-byte).
- The only remaining step is the two `wrangler create` commands + `deploy` — a
  harness running unattended may be blocked from creating prod infra, in which
  case the account owner runs the three commands above.

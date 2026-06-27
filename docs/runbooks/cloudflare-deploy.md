# Runbook — Cloudflare provisioning + first deploy

Takes the worker from code-complete to live. The build is verified
(`wrangler deploy --dry-run` passes; 329 KiB, all bindings resolve), so what
remains is **standing up the three remote resources** the worker binds and one
`deploy`. Everything here needs the **account owner** — resource creation and the
account-level enablements below can't be done by an unattended agent.

## Account / plan prerequisites (one-time, dashboard)

The architecture uses **Queues** and **R2**, so the target account must have:

1. **Workers Paid** ($5/mo) — required for Queues (consumers don't run on Free).
2. **R2 enabled** — without it `wrangler r2 ...` returns
   `Please enable R2 through the Cloudflare Dashboard [code: 10042]`. R2 has a
   free tier but must be activated (accept R2 terms; card on file).
3. **An API token / `wrangler login` session with the `r2` scope.** The current
   `aphisak@mohara.co` OAuth token has `workers`, `d1`, `queues`, `pages` but
   **not `r2`** — re-run `wrangler login` and grant R2, or mint an API token with
   *Workers R2 Storage: Edit*.

Account in use: `aphisak@mohara.co` (`01ac9228929b4e4dadeeb28a70e92475`). If the
team wants a dedicated prod account, switch before provisioning — the IDs below
are per-account.

> Naming note: the D1 binding in `wrangler.toml` is `evo-csv-dev`. That's the
> current (dev-flavoured) name. If you want a separate prod DB, create it under a
> prod name and update `database_name`/`database_id` accordingly.

## Provision (run from `apps/worker/`)

```bash
# 1. D1 — create, then paste the returned id into wrangler.toml [[d1_databases]].database_id
npx wrangler d1 create evo-csv-dev
# 2. Apply schema + seed (project, env, imp_tenants importer + columns, owner) to REMOTE
npx wrangler d1 migrations apply evo-csv-dev --remote
# 3. Queue (needs Workers Paid)
npx wrangler queues create webhook-dispatch
# 4. R2 bucket (needs R2 enabled + r2-scoped token)
npx wrangler r2 bucket create evo-csv-uploads
```

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

- `wrangler deploy --dry-run` ✅ — worker compiles, bindings + vars resolve.
- Worker 156 / web 191 unit tests ✅; Playwright E2E ✅ (cold boot).
- Locked webhook payload unchanged (snapshot + E2E assert it byte-for-byte).
- Blockers are **account-level only** (plan + R2 + r2 token scope) — no code work
  remains.

# Runbook — Cloudflare provisioning + first deploy

Takes the worker from code-complete to live. The build is verified
(`wrangler deploy --dry-run` passes; all bindings resolve), so what remains is
**creating the two remote resources** the worker binds (D1 + Queue) and one
`deploy`.

> **Routine deploys are now automated.** After the one-time provisioning below,
> you don't run the manual deploy by hand — merging to `main` deploys for you.
> See [Automated deploy (CI/CD)](#automated-deploy-cicd) at the bottom. The
> manual steps here remain the source of truth for first-time provisioning and
> for break-glass manual deploys.

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

## Deploy (single-origin: SPA ships with the worker)

The SPA is served by the worker via Workers Assets (`[assets]` → `../web/dist`),
so build the web app first, then deploy the worker — one origin, one command.

```bash
# Build the SPA with the public Firebase config (see auth-firebase-provisioning.md §2)
VITE_FIREBASE_API_KEY=… VITE_FIREBASE_AUTH_DOMAIN=… \
VITE_FIREBASE_PROJECT_ID=… VITE_FIREBASE_APP_ID=… \
  pnpm --filter @evo-csv/web build
# Deploy the worker (bundles dist as static assets; note: `run deploy`, not the
# pnpm `deploy` builtin)
pnpm --filter @evo-csv/worker run deploy
```

Then add the served origin to **Firebase → Auth → Settings → Authorised
domains** (e.g. `evo-csv.aphisak.workers.dev`), or Google sign-in returns
`auth/unauthorized-domain`.

> **Currently deployed:** https://evo-csv.aphisak.workers.dev (Workers Free, $0,
> no card). D1 `evo-csv-dev` (`863559dd…`, APAC) + queue `webhook-dispatch` live;
> `evo-csv.aphisak.workers.dev` is in the Firebase authorised domains.

## Seed the first owner + smoke test

```bash
pnpm bootstrap --email you@yourco.com --project-slug evo --project-name EVO --remote
```

Then follow [auth-firebase-provisioning.md](auth-firebase-provisioning.md) §5 for
the live sign-in smoke test, and the [E2E flow](../../apps/web/e2e/README.md) for
the upload→webhook path (runnable locally without any of the above).

## Automated deploy (CI/CD)

Once provisioning is done, **deploys happen automatically on merge to `main`**
via GitHub Actions ([.github/workflows/ci.yml](../../.github/workflows/ci.yml),
the `deploy` job). You do not run the manual `wrangler deploy` above for routine
releases.

**Flow (topology A — one workflow, two jobs):**

1. `ci` job runs on every PR and on push to `main` (install → build web →
   typecheck → lint (advisory) → test → build).
2. On a push to `main` only, the `deploy` job runs after `ci` passes. PRs
   (including fork PRs) never enter it, so secrets are never exposed to forks.
3. The `deploy` job targets the `prod` GitHub Environment, so it **pauses
   for a one-click human approval** before running.
4. After approval it: builds the web SPA with the Firebase config injected from
   secrets → **applies D1 migrations to prod** (`wrangler d1 migrations apply
   evo-csv-dev --remote`) → deploys the worker (`wrangler deploy`).

Migrations run **before** the worker deploy on purpose: they're additive, so the
currently-live worker keeps serving against the migrated schema, and the new
worker never goes live against an un-migrated DB. The deploy job uses its own
`deploy-prod` concurrency group with `cancel-in-progress: false`, so a live
deploy is never interrupted by a follow-up merge.

> Single-environment note: `evo-csv-dev` **is** the production D1 database — the
> migration step applies against it directly.

### Required repo secrets

Set these in **Settings → Secrets and variables → Actions** (or scoped to the
`prod` Environment):

- `CLOUDFLARE_API_TOKEN` — token with Workers + D1 + Queues edit scopes.
- `CLOUDFLARE_ACCOUNT_ID` — `01ac9228929b4e4dadeeb28a70e92475`.
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

(The four `VITE_FIREBASE_*` values are the public web Firebase config — see
[auth-firebase-provisioning.md](auth-firebase-provisioning.md) §2.)

### One remaining human setup step (required, or the gate is a no-op)

Create the **`prod` GitHub Environment** with a **required reviewer**:

> **Settings → Environments → New environment → `prod`** → enable
> **Required reviewers** and add at least one person.

The name must be exactly `prod` — it has to match the `environment: prod` line
in the workflow. On a name mismatch GitHub silently auto-creates an unguarded
environment and the reviewer gate is bypassed. Without a required reviewer, the
deploy job still runs — it just won't pause for approval. The approval gate only
exists once a required reviewer is configured. A break-glass manual deploy is
always available via the manual `wrangler deploy` steps above.

## Verified deploy-readiness (as of this branch)

- `wrangler deploy --dry-run` ✅ — worker compiles; bindings are D1 + Queue only
  (no R2).
- Worker 156 / web 191 unit tests ✅; Playwright E2E ✅ (cold boot, R2 removed).
- Locked webhook payload unchanged (snapshot + E2E assert it byte-for-byte).
- The only remaining step is the two `wrangler create` commands + `deploy` — a
  harness running unattended may be blocked from creating prod infra, in which
  case the account owner runs the three commands above.

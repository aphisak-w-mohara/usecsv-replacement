# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`evo-csv` is a self-hosted, internal CSV importer that replaces usecsv.com for the Mohara team. It ingests client-supplied Property/Tenant CSVs in a 5-step wizard and dispatches batched webhook deliveries to the EVO Laravel backend. **The webhook payload is byte-identical to usecsv.com's** so existing Laravel handlers keep working without change — this constraint is load-bearing, not aspirational. See [prds/prd-high-evo-csv.md](prds/prd-high-evo-csv.md) §9 and [docs/superpowers/specs/2026-05-26-usecsv-clone-design.md](docs/superpowers/specs/2026-05-26-usecsv-clone-design.md) for the full design.

## Monorepo layout

pnpm workspaces — packages live under `apps/*` and `packages/*`.

- `apps/worker` — Cloudflare Worker (Hono) serving the API at `/api/*`. D1 for relational data, R2 for source files, Queues for sequential webhook dispatch. Migrations in [apps/worker/migrations/](apps/worker/migrations/).
- `apps/web` — React 19 SPA built with Vite + TanStack Router (file-based routing in [apps/web/src/routes/](apps/web/src/routes/)). Talks to the worker via a typed Hono RPC client.
- `packages/shared` — cross-package types only (webhook payload contract, queue job shape). No runtime code.

The web bundle imports the worker's `AppType` via `import type` so the typed RPC client (`apps/web/src/lib/api.ts`) gets full route inference without pulling worker code into the browser. Touching `apps/worker/src/index.ts`'s exported `AppType` cascades into web-side type errors — that's by design.

## Commands

Run from repo root unless noted.

| Task | Command |
|---|---|
| Dev (worker + web in parallel) | `pnpm dev` |
| Dev — worker only | `pnpm dev:worker` (wrangler dev on `:8787`) |
| Dev — web only | `pnpm dev:web` (vite dev on `:5173`, proxies `/api` → `:8787`) |
| Typecheck + build (all workspaces) | `pnpm build` |
| All tests | `pnpm test` |
| Worker tests only | `pnpm --filter @evo-csv/worker test` |
| Web tests only | `pnpm --filter @evo-csv/web test` |
| Single test file | `pnpm --filter @evo-csv/worker exec vitest run path/to/file.test.ts` |
| Filter by test name | `pnpm --filter @evo-csv/worker exec vitest run -t "pattern"` |
| Worker typecheck (incl. tests) | `pnpm --filter @evo-csv/worker typecheck` |
| Lint | `pnpm lint` (biome check) |
| Format | `pnpm format` (biome format --write) |
| Deploy worker | `pnpm --filter @evo-csv/worker deploy` |

Node ≥ 22.11, pnpm ≥ 9 (enforced in root `package.json`).

## Test infrastructure quirks

- **Worker tests use `@cloudflare/vitest-pool-workers` with `singleWorker: true` and `isolatedStorage: false`** (see [apps/worker/vitest.config.ts](apps/worker/vitest.config.ts)). This is intentional: the worker is both queue producer and consumer, and miniflare fires queue callbacks in the same event loop as the test that enqueued them — per-test isolated storage frames break that. Migrations are applied in `beforeAll`, so shared storage is the right tradeoff.
- D1 migrations auto-load via [apps/worker/test/global-setup.ts](apps/worker/test/global-setup.ts) — adding a new `.sql` in `apps/worker/migrations/` makes it available to all tests without further wiring.
- Web tests use jsdom (see [apps/web/vitest.config.ts](apps/web/vitest.config.ts)).

## Worker conventions

- **Auth today is a temporary dev stub** at [apps/worker/src/middleware/dev-session.ts](apps/worker/src/middleware/dev-session.ts) — reads `DEV_USER_EMAIL` and looks up the seeded user. PRD-004 ([prds/prd-feature-auth-bootstrap.md](prds/prd-feature-auth-bootstrap.md)) replaces it with Google SSO + KV-backed sessions. Do not build on top of `devSession`'s implementation details; rely only on `c.var.session` having `{ user, project_id, environment_id, role }`.
- **IDOR pattern**: cross-project / cross-environment access returns **404, not 403**, to avoid leaking existence. Project/env IDs come from session context, never from request body.
- **Webhook queue config** (in [apps/worker/wrangler.toml](apps/worker/wrangler.toml)): `max_batch_size = 1`, `max_retries = 0`. The worker manages its own attempt counting + backoff via re-enqueue — do not turn on platform retries.
- **`batch.index` is 1-based**; the final batch satisfies `batch.index === batch.count`. Laravel's `TenantsImport` final-batch logic depends on this.
- **The webhook payload is locked.** A snapshot test pins the format against [captured-payloads/2026-05-26-usecsv-live-webhook.json](captured-payloads/2026-05-26-usecsv-live-webhook.json) and existing Laravel fixtures. Adding/renaming/removing a top-level field is a breaking change; new auth headers (HMAC signature) are OK.

## D1 migration gotcha

`importer_columns` enforces `UNIQUE(importer_id, position)`. Bulk reorders must write **negative temporary positions** inside the transaction before the final `1..N` sequence — otherwise the unique constraint fires mid-statement. See the reorder endpoint in [apps/worker/src/routes/importers.ts](apps/worker/src/routes/importers.ts) for the pattern.

## Web conventions

- **Routes are file-based** ([apps/web/src/routes/](apps/web/src/routes/)) with TanStack Router; `routeTree.gen.ts` is auto-generated by the Vite plugin — do not hand-edit it.
- **Underscore-suffix routes are flat siblings, not nested children.** `importers.$id.tsx` renders inside the importer detail layout; `importers.$id_.upload.tsx` (note the `_` on `$id_`) renders the upload wizard as a flat top-level page that does NOT inherit the parent's layout chrome. This is a TanStack convention — adding/removing the underscore silently changes whether the parent layout wraps the child.
- `_authed/` is the session-gated layout segment. Anything outside it (`/login`, `/invites/:token` when they ship) is the unauthenticated surface.
- The upload wizard is a 5-step flow under [apps/web/src/components/upload-wizard/](apps/web/src/components/upload-wizard/). The importer detail editor (`General · Columns · Env tabs`) is under [apps/web/src/components/importers/](apps/web/src/components/importers/).
- **CSV/XLSX parsing happens client-side** (PapaParse + xlsx) — PII never hits the server until the user clicks Submit on a validated grid. Don't move parsing to the worker.

## PRD / workflow conventions

- Product specs live in [prds/](prds/). [prds/MASTER-PRD.md](prds/MASTER-PRD.md) is the index — keep it in sync when adding or versioning a PRD.
- Implementation plans for each story land in [docs/moai/plans/](docs/moai/plans/) as `YYYY-MM-DD-story-NN-name.md` *before* `/build` runs.

### Branch naming

- `feature/<issue-num>-<slug>` — story / code work tied to a GitHub issue. Example: `feature/19-webhook-signing`.
- `docs/<slug>` — PRDs and other docs. Example: `docs/prd-004-auth-bootstrap`, `docs/init-claude-md`.
- `chore/<slug>` — repo housekeeping with no user-facing change. Example: `chore/renumber-0003-migrations`.
- `claude/<slug>` — ad-hoc fix from a Claude session that isn't tracked by a story (typecheck patches, test fixes). Use sparingly — prefer creating an issue first.

All PRs squash-merge to `main`. Remote feature branches are deleted on merge (`gh pr merge --squash --delete-branch`).

### Commit + PR title format

Conventional Commits with a scope. Common scopes: `worker`, `web`, `shared`, `worker,web` (cross-cutting).

- `feat(worker): <what>` / `feat(web): <what>` — new feature increment
- `fix(worker): <what>` / `fix(web): <what>` — bug fix
- `fix(<scope>): <what> (review #N)` — fix landed in response to a PR review thread; cite the thread number
- `chore: <what>` / `chore(<scope>): <what>` — housekeeping
- `docs: <what>` — documentation only

PR titles follow the same shape, with one extra pattern: **story PRs use `Story #N: <title>`** (e.g. `Story #19: Webhook signing + secret/key rotation`) and **PRD PRs use `docs: PRD-XXX — <feature>`** (em dash). PRD-004 #36 and Story #19 #35 in `git log` are good references.

### When to create issues

- **PRD-driven (default for any new feature):** run `/create-issue <prd-path>`. Produces one **Epic** (from the PRD's H1) and one **child Story** per Section 5 user story. Each child is sized to be one `/build` run; flag stories that look > 2–3 days for splitting.
- **Plan-driven, single issue:** ad-hoc work that has a plan in `docs/moai/plans/` but no parent Epic. One flat issue referencing the plan path.
- **Standalone bug / one-off:** clear bug or task that needs no plan or PRD first. Use the Bug template.
- **Don't create an issue** for trivial inline fixes you can complete in the same session (typo, one-line typecheck patch). Just commit on a `claude/<slug>` branch and open a PR.

Hierarchy is strict and two-level: Epic → flat Story/Task/Bug/Spike children. Never nest deeper. Only Epics can be parents.

### When to create a milestone

- **One milestone per PRD-driven Epic**, named `MVP — <feature name>` (em dash). Created at the same time as the Epic; assigned to the Epic + every child issue. Closed when the Epic ships.
- **No milestone** for standalone bugs, chores, or ad-hoc claude/* fixes.
- The `gh api .../milestones` endpoint defaults to `state=open`. Prior milestones close as their Epics ship, so an empty open-list does **not** mean the repo lacks the convention — always create a new milestone for a new PRD-driven Epic. Reference: [github.com/aphisak-w-mohara/usecsv-replacement/milestones](https://github.com/aphisak-w-mohara/usecsv-replacement/milestones).

### Sub-issue (Epic → child) linking

`gh issue edit` does **not** have a flag to set an Epic as parent. The native sub-issue relationship lives behind the GraphQL `addSubIssue` mutation:

```bash
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}' \
  -F p=$EPIC_NODE_ID -F c=$CHILD_NODE_ID
```

Get node IDs with `gh issue view <number> --json id -q .id`. The `/create-issue` skill handles this automatically; remember it for any one-off issue you create manually.

### GitHub Project fields

Every issue lives in Project #1 (`evo-csv`). Required fields per issue:

- **Type** — `Epic` for parents, `Story` for user-value work, `Task` for support work, `Bug` for defects, `Spike Story` for research timeboxes.
- **Size** — `XS / S / M / L / XL`. Epics are `XL`. Children must fit one `/build` run (mostly S/M; L is borderline).
- **Status** — defaults to `Todo`; updated to `In progress` / `Done` as work moves.

Priority / Iteration / Estimate fields are **not** part of the current convention — leave unset.

## Tooling

- **Formatter + linter:** Biome (config in [biome.json](biome.json)). 2-space indent, 100-col width. `noNonNullAssertion` off; `noExplicitAny` is a warning, not an error.
- **TypeScript:** strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`. Base config in [tsconfig.base.json](tsconfig.base.json). The `verbatimModuleSyntax` flag means `import type` vs runtime `import` is non-negotiable.
- **Wrangler** is invoked from `apps/worker/`; D1 binding is `DB`, R2 binding is `UPLOADS_BUCKET`, queue binding is `WEBHOOK_QUEUE`.

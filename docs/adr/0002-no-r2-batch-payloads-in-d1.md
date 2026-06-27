# ADR-0002 — Drop R2; store batch payloads in D1 (gzipped)

**Status:** Accepted (2026-06-27) · **Supersedes:** the R2 `UPLOADS_BUCKET` storage in PRD-005

## Context

evo-csv must run at **zero ongoing cost on the Cloudflare Workers Free plan with
no payment method on file**. An audit of the paid/enablement gates found:

- **Queues** — free on Workers Free (10k ops/day); no card. *No change needed.*
  (An earlier assumption that Queues needed Workers Paid was stale.)
- **R2** — has a free tier (10 GB) but **requires a card on file to enable**
  (`code: 10042` until activated). This was the only thing forcing a payment
  method.
- **D1 / Workers / Cron** — free, no card.

R2 stored one JSON object per upload-batch (`uploads/{id}/batches/{i}.json`),
written by the ingest handler and read back by the webhook dispatcher
(milliseconds later, inline) and by the errors.csv endpoint. The raw source file
was never actually persisted (parsing is client-side; `r2_source_key` pointed at
a non-existent object).

## Options weighed (researched against current 2026 Cloudflare limits)

- **Workers KV** — free/no-card, 25 MiB values, but **eventually consistent**
  (negative lookups cached up to ~60s). The inline dispatcher could miss a
  just-written payload → **disqualified**.
- **Durable Objects (SQLite)** — free/no-card, strong per-object consistency, but
  adds a new class + per-upload routing discipline + lifecycle. Strong-fit but
  more moving parts.
- **D1 (chosen)** — already the app's datastore; **strong read-after-write** by
  default (single primary, replication off); free/no-card. The only constraint is
  D1's hard **2 MB per-row** limit.

## Decision

Drop R2 entirely. Store each batch payload **inline in D1, gzipped**, on the
existing `upload_batches` table (`payload BLOB`, `payload_encoding`), keyed by the
existing `(upload_id, batch_index)` PK.

- **gzip** (`CompressionStream`, no dependency): CSV-derived JSON compresses
  ~5–10×, keeping even low-MB payloads well under the 2 MB row cap. The 4 KB
  per-batch row-count clamp and idempotent `ON CONFLICT DO NOTHING` write preserve
  the prior R2 "put-if-absent" semantics.
- **Strong consistency** is load-bearing: leave D1 read replication **off** so the
  dispatcher's read always observes the ingest write. (Never enable replication
  for this DB without the Sessions API + bookmarks on the dispatch read path.)
- **Queues stays** — free, and keeps the exact 10s/30s/…/6h backoff and halt
  semantics (PRD-005, unchanged).
- **Raw source-file storage dropped** — `uploads.r2_source_key` removed; it was
  always dead. If audit retention is ever needed it requires a real blob store.

## Consequences

- **$0, no card, no paid plan.** The only go-live steps are creating the D1 DB and
  the Queue (both free) and deploying — see
  [cloud­flare-deploy.md](../runbooks/cloudflare-deploy.md).
- The **locked webhook payload is unchanged** — it's rebuilt byte-for-byte from
  D1 instead of R2 (snapshot test + Playwright E2E assert this).
- Payloads accumulate in the 5 GB / 500 MB-per-DB budget. At this tool's volume
  that lasts years; a retention sweep can be added later if needed (errors.csv
  reads payloads back, so they can't be deleted immediately on dispatch).
- A single batch's payload must fit 2 MB compressed; a chunk-across-rows fallback
  is the escape hatch if that ever bites (it shouldn't at this scale).

Implementation: migration `0007_batch_payloads_inline.sql`; `lib/gzip.ts`;
swaps in `routes/uploads.ts` (ingest + errors.csv) and `lib/dispatch.ts`.

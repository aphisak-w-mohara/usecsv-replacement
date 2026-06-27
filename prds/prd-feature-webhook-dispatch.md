# Feature PRD — Webhook Dispatch Pipeline

**ID:** PRD-005
**Type:** Feature
**Parent PRD:** PRD-001 evo-csv
**Author:** Aphisak Naksomboon
**Date:** 2026-05-28
**Status:** Draft — Pending Review

> **Superseded 2026-06-27 (storage):** this PRD describes batch payloads persisted to R2. They were later moved to D1 (gzipped) to keep the importer on the Cloudflare free tier with no card — see [ADR-0002](../docs/adr/0002-no-r2-batch-payloads-in-d1.md). The R2 references below are preserved as the historical record; the dispatch contract (payload shape, queue, backoff, halt) is unchanged.
**Target release:** Q3 2026 (MVP)
**Version:** 1.0

## Version history
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-05-28 | Aphisak Naksomboon | Initial draft |

## 1. Context

The upload wizard (PRD-002) persists a CSV's batches to R2 and enqueues one `WebhookDispatchJob` per batch. This PRD owns everything **downstream of that enqueue**: the Cloudflare Queue consumer, the per-batch POST to Laravel, retry/backoff, halt semantics, status recompute, and the operator-facing retry and error-export endpoints. It is the load-bearing piece for "we replace usecsv.com without changing Laravel."

**Parent PRD:** [prd-high-evo-csv.md](prd-high-evo-csv.md)
**Feature area:** worker / queue / webhook delivery

## 2. Scope

The dispatch pipeline must deliver each upload's batches to the importer-environment's webhook URL **in `batch.index` order**, retry transient failures with exponential backoff, halt cleanly when retries are exhausted, expose a one-click retry, and produce a downloadable CSV of per-row errors returned by Laravel. The webhook payload is **byte-identical** to usecsv.com's (pinned by snapshot test against [captured-payloads/2026-05-26-usecsv-live-webhook.json](../captured-payloads/2026-05-26-usecsv-live-webhook.json)) so Laravel handlers keep working without change. Optional HMAC-SHA256 signing (from PRD-003) is honoured per-importer-environment.

### What is being built:

- Cloudflare Queue consumer (`max_batch_size = 1`, `max_retries = 0`) that delivers one batch per invocation
- `dispatchBatch` worker function — reads R2 payload, POSTs to webhook URL, writes a `webhook_attempts` row, re-enqueues on failure with exponential backoff
- Worker-managed retry: 6 attempts max, backoff `10s · 30s · 2m · 10m · 1h · 6h`
- Upload status recompute (`pending → dispatching → completed | halted`) from the full `webhook_attempts` view
- `POST /api/uploads/:id/retry` — operator retry of un-delivered batches; resets attempt budget
- `GET /api/uploads/:id` — status polling endpoint returning batch counts, latest attempt, row errors
- `GET /api/uploads/:id/errors.csv` — download per-row errors keyed back to original rows
- HMAC-SHA256 signing of `${timestamp}.${rawBody}` when enabled, with `X-Evo-Timestamp` + `X-Evo-Signature` headers
- Snapshot test pinning payload format
- Wizard step 5 (`step-progress`) polling, retry button, halt surfacing

### What is not being built (out of scope):

- Platform-managed queue retries (we own attempt counting; `max_retries = 0` in [apps/worker/wrangler.toml](../apps/worker/wrangler.toml))
- Dead-letter queue (DLQ) — halt is the terminal state; abandoned uploads are manually marked `failed` via a future endpoint, not this PRD
- Webhook receiver / Laravel-side changes (the contract is invariant)
- Per-importer rate limiting (PRD-001 §15 explicitly out-of-scope)
- Alert/notification pipeline on halt (no email/Slack ping; UI surfaces only)
- HMAC secret rotation UX (owned by PRD-003)
- Custom retry windows or backoff override per importer-environment

**Sign-off:** [ ] Approved by Aphisak Naksomboon on [date]

## 3. Current State vs Desired End State

|  | Description |
|---|---|
| **Current state** | Pipeline is implemented in the worker ([dispatch.ts](../apps/worker/src/lib/dispatch.ts), [index.ts:20](../apps/worker/src/index.ts:20)) and exercised by [apps/worker/test/dispatch.test.ts](../apps/worker/test/dispatch.test.ts) + [uploads-retry-errors.test.ts](../apps/worker/test/uploads-retry-errors.test.ts). Wizard step 5 polls status and surfaces halt+retry. Gaps: no operator runbook, no structured logging schema, no snapshot test against the captured live payload pinned to this PRD, no end-to-end test that proves "queue ordering preserved" under load. |
| **Desired end state** | Pipeline is documented as the spec it implements; remaining gaps closed: snapshot test references the captured fixture; structured `console.error` lines have a documented schema (so `wrangler tail` filters work); runbook covers the halt-investigate-retry loop; an integration test exercises a multi-batch upload end-to-end through the queue. |

## 4. Permissions Impact

The dispatch pipeline itself runs as the worker (no user). The operator-facing endpoints (`retry`, status, errors.csv) inherit upload visibility from PRD-002.

| Role | Can do | Cannot do |
|---|---|---|
| Owner | Retry any upload in the project; download errors.csv | — |
| Member (any project member) | Retry / view status / download errors.csv for any upload in the project | Cross-project access returns 404 (not 403, per IDOR convention) |

> **As-built correction (2026-06-27):** the `retry` / status / `errors.csv` endpoints scope by `project_id` **only** — they do not enforce per-environment grants. Any project member can act on any upload in the project regardless of env grant. The earlier table over-claimed env-grant-level control that the shipped code does not enforce; env-grant scoping on these endpoints is deferred (see PRD-004).

## 5. User Stories & Acceptance Criteria

---

### Story 1 — Worker dispatches a batch and records the attempt

**User story**
As **the worker** (acting on behalf of an upload), I want to consume a `WebhookDispatchJob`, POST the persisted R2 payload to the importer-environment's webhook URL, and persist a `webhook_attempts` row, so that the upload's progress is durably recorded and the next batch can be triggered.

**Detailed flow**
1. Queue consumer receives one `WebhookDispatchJob` (`max_batch_size = 1`)
2. Worker loads `uploads → importer_environments` row for `webhook_url`, `webhook_signing_enabled`, `webhook_secret`
3. Worker fetches `uploads/<uploadId>/batches/<batchIndex>.json` from R2
4. Worker builds headers: `Content-Type: application/json`, `User-Agent: evo-csv/0.1`; if signing is on, adds `X-Evo-Timestamp` + `X-Evo-Signature: sha256=<hex>` (HMAC-SHA256 over `${ts}.${rawBody}`)
5. Worker `fetch()` POSTs the raw body
6. Worker writes `webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, response_body[16KB cap], errors_json, started_at, finished_at)` via `INSERT OR IGNORE`
7. Worker calls `recomputeUploadStatus(env, uploadId)`
8. Consumer acks the message

**Edge cases & error states**
- R2 object missing → re-enqueue with 5s delay (covers ingest/dispatch race)
- Network/timeout → `status_code = null`, `response_body = error.message`; counts as a failed attempt
- Non-JSON 2xx body → success, no row errors recorded
- Webhook URL not configured → log error, ack without re-enqueueing (no point retrying a misconfig)
- `dispatchBatch` throws → caught in consumer, message still ack'd (prevents redelivery storm; `INSERT OR IGNORE` makes redelivery safe but unhelpful for persistent errors)

**Acceptance criteria**
1. One `webhook_attempts` row exists per `(upload_id, batch_index, attempt_number)` after delivery
2. Successful 2xx with `errors[]` in body → `errors_json` populated; without `errors[]` → `errors_json` null
3. Signed payloads include both `X-Evo-Timestamp` and `X-Evo-Signature` headers; unsigned payloads include neither
4. `response_body` is truncated to 16 KB
5. Re-running the consumer on a duplicate message does not duplicate the attempts row (INSERT OR IGNORE)

**Test cases**
1. Happy path: 2xx with no row errors → `webhook_attempts.status_code = 200`, `errors_json = null`, upload status recomputed
2. 2xx with `{errors:[{row:5,msg:"bad email"}]}` → `errors_json` is the stringified array
3. Network timeout → `status_code = null`, retry scheduled
4. Signing enabled → headers contain valid HMAC; signing disabled → no signing headers
5. R2 miss → message re-enqueued with `delaySeconds: 5`, no attempt row written

---

### Story 2 — Worker retries with exponential backoff and halts after 6 attempts

**User story**
As **the worker**, I want to re-enqueue failed batches with exponential backoff up to 6 attempts and then stop, so that transient Laravel hiccups self-heal without operator intervention and persistent failures don't loop forever.

**Detailed flow**
1. After writing a non-2xx `webhook_attempts` row, worker checks `attempt < 6`
2. If yes, `env.WEBHOOK_QUEUE.send({...job, attempt: attempt+1}, { delaySeconds: BACKOFF[attempt-1] })`
3. Backoff schedule: `attempt 1 fail → 10s`, `2 → 30s`, `3 → 2m`, `4 → 10m`, `5 → 1h`, `6 → no re-enqueue, halt`
4. After 6 attempts with no 2xx, `recomputeUploadStatus` flips upload status to `halted`

**Edge cases & error states**
- Worker dies between `webhook_attempts` insert and re-enqueue → next platform retry of the consumer won't fire (max_retries=0); upload sits in `dispatching` until manual retry. **Accepted risk** — `max_retries=0` is load-bearing for ordering and idempotency.
- A 4xx response (e.g. 422 validation error from Laravel) is treated identically to 5xx — both retry up to 6 attempts. This matches usecsv's behaviour.

**Acceptance criteria**
1. After 1st failure, next attempt is scheduled with `delaySeconds = 10`
2. After 6th failure, no further enqueue; upload status flips to `halted`
3. A successful 2xx anywhere in the chain stops further retries
4. `attempt_number` in `webhook_attempts` is strictly monotonic for a `(upload_id, batch_index)` pair

**Test cases**
1. 3 failures then 2xx → exactly 4 attempts rows; upload moves to `completed` if it's the last batch
2. 6 consecutive failures → 6 attempts rows, no 7th enqueue, status = `halted`
3. Multi-batch upload where batch 2 halts but batches 1 and 3 succeed → upload status = `halted` (halt wins over partial completion)

---

### Story 3 — Worker recomputes upload status from attempts on every dispatch

**User story**
As **the worker**, I want to derive `uploads.status` from the full `webhook_attempts` view after every dispatch, so that status is self-consistent even if a delivery races with a retry or the worker is replayed.

**Detailed flow**
1. After every `dispatchBatch`, call `recomputeUploadStatus(env, uploadId)`
2. Compute `delivered` set: every `batch_index` with at least one 2xx attempt
3. Compute `attemptsByBatch`: max `attempt_number` per `batch_index`
4. If any undelivered batch has `attemptsByBatch >= 6` → `halted`
5. Else if every batch in `1..batch_count` is in `delivered` → `completed`
6. Else → `dispatching`
7. `UPDATE uploads SET status = ?, updated_at = ?`

**Edge cases & error states**
- `pending → dispatching` transition is set on first batch enqueue ([uploads.ts:225](../apps/worker/src/routes/uploads.ts:225)), not by the recompute — recompute never returns `pending`
- An upload manually marked `failed` is never auto-promoted out; the recompute writes `halted | completed | dispatching` only

**Acceptance criteria**
1. Status is deterministic given the set of attempts (idempotent on replay)
2. `halted` only set if at least one undelivered batch has exhausted 6 attempts
3. `completed` only set if every batch in `1..batch_count` has a 2xx attempt
4. Concurrent updates from two attempts settling at once converge (last-write-wins on `updated_at`)

**Test cases**
1. 3-batch upload, all delivered → `completed`
2. 3-batch upload, batch 2 has 6 fails, batches 1 & 3 delivered → `halted`
3. Recompute on an upload with no attempts → stays at `dispatching` (or whatever the producer set)

---

### Story 4 — Operator retries a halted upload

**User story**
As a **member with env access**, I want to click "Retry" on a halted upload so that the worker re-attempts the undelivered batches with a fresh 6-attempt budget.

**Detailed flow**
1. Operator clicks retry button (wizard step 5 or upload detail page)
2. SPA `POST /api/uploads/:upload_id/retry`
3. Worker computes the undelivered batch set (no 2xx attempt)
4. For each undelivered batch: `DELETE FROM webhook_attempts WHERE upload_id = ? AND batch_index = ?`, then `WEBHOOK_QUEUE.send({uploadId, batchIndex: i, attempt: 1})`
5. `UPDATE uploads SET status = 'dispatching'`
6. Return 202
7. Wizard step 5 resumes polling

**Edge cases & error states**
- Upload not found / cross-project → 404 (IDOR rule)
- All batches already delivered → no-op enqueue, status stays `completed`
- Retry while still in `dispatching` → safe; just re-enqueues already-pending batches (each one starts fresh at attempt 1, prior attempts deleted)
- `INSERT OR IGNORE` gotcha: prior attempts MUST be deleted before re-enqueue, otherwise consumer's insert is silently dropped and upload can never leave `halted`. This is the bug guarded by [uploads-retry-errors.test.ts](../apps/worker/test/uploads-retry-errors.test.ts).

**Acceptance criteria**
1. Retry only affects batches with no 2xx attempt
2. Prior `webhook_attempts` rows for undelivered batches are deleted before re-enqueue
3. Each re-enqueued batch starts at `attempt: 1` with a full 6-attempt budget
4. Endpoint returns 202 (accepted, not synchronous)
5. Member without env access → 404

**Test cases**
1. Halted upload (batch 2 failed 6×) → retry → batch 2 attempts row deleted, new attempt scheduled, status flips to `dispatching`
2. Completed upload → retry → no-op, status stays `completed`
3. Cross-project retry attempt → 404
4. Retry while dispatching → safely resets and re-enqueues

---

### Story 5 — Operator downloads row errors as CSV

**User story**
As a **member with env access**, I want to download `errors.csv` for an upload with row errors so that I can hand it back to the client or fix the source CSV.

**Detailed flow**
1. Operator clicks "Download errors" on the wizard step 5 or upload detail
2. SPA `GET /api/uploads/:upload_id/errors.csv`
3. Worker collects every `errors_json` across attempts, dedupes by row number (last wins), looks up the original row from R2-persisted batch payloads, builds CSV with original columns + an `_error` column

**Edge cases & error states**
- Upload not found / cross-project → 404
- No row errors → still returns an empty CSV with headers (or 204; TBC during build — see Open Questions)
- Original batch payload missing from R2 → row is omitted from the export with a `console.error`

**Acceptance criteria**
1. Each row in the CSV corresponds to a row Laravel reported an error for
2. Original columns preserved + `_error` column appended
3. Row order matches the original source CSV order
4. Authentication enforced (cross-project → 404)

**Test cases**
1. Upload with 3 row errors → CSV has 3 data rows + header
2. Upload with no errors → empty CSV (or 204)
3. R2 batch missing → row dropped silently with server log

---

### Story 6 — Wizard step 5 polls status and surfaces halt + retry + errors

**User story**
As a **member running an upload**, I want the wizard's final step to show live progress, halt cleanly when delivery fails, and offer a retry button plus the errors download, so that I never have to leave the wizard to recover.

**Detailed flow**
1. After submit, [step-progress.tsx](../apps/web/src/components/upload-wizard/step-progress.tsx) polls `GET /api/uploads/:id` via `useUploadStatus` hook
2. Display: `batches_delivered / batch_count` progress bar, latest attempt summary, terminal state copy
3. Terminal states:
   - `completed` + no row errors → success
   - `completed` + row errors → success with "Download errors.csv" CTA
   - `halted` → "Delivery halted after 6 attempts" + "Retry" + "Download errors.csv" CTAs
4. Retry CTA calls `POST /api/uploads/:id/retry` and bumps `retryKey` to restart polling

**Edge cases & error states**
- Polling fetch fails → keep polling, surface transient error inline
- Browser closed mid-poll → state is durable server-side; reopening the upload detail page resumes from current status

**Acceptance criteria**
1. Polling stops at any terminal state (`completed`, `halted`, `failed`)
2. Halt state always renders the Retry CTA
3. Row-error state always renders the Download errors CTA
4. After retry click, polling restarts and progress bar reflects the new attempts

**Test cases**
1. Submit → polling shows `0/3 → 1/3 → 2/3 → 3/3 completed`
2. Halted upload → CTA visible → click retry → polling resumes
3. Network blip during polling → no UI crash; resumes on next tick

## 6. UI / UX Requirements

Applies to wizard step 5 + upload detail page (PRD-002 surfaces).

- **Progress states:** `idle → submitting → polling → terminal(completed | halted | failed)`
- **Empty / pre-submit:** "Ready to submit" with row count + batch count preview
- **Loading / in-flight:** progress bar `batches_delivered / batch_count`; "Latest: batch N, attempt M → HTTP 200" sub-text
- **Halt error copy:** *"Delivery halted after 6 attempts. The last attempt returned HTTP {code}: {first 200 chars of response_body}. You can retry, or download the row errors."*
- **Row-error copy (completed):** *"Upload completed with {n} row errors. Download the corrected CSV from the client and re-upload."*
- **CTAs:** `[Retry]` (halt only) · `[Download errors.csv]` (when `has_row_errors === true`) · `[Done]`
- **Toast on retry:** *"Retry queued. Watching delivery…"*
- **Accessibility:** progress bar has `aria-valuenow / aria-valuemax`; terminal state is announced via `role="status"`

## 7. Data & Schema Changes

**New fields:** none (all tables already exist).

**Tables touched:**
- `uploads` — read/write `status`, `updated_at`
- `webhook_attempts` — full CRUD; `UNIQUE(upload_id, batch_index, attempt_number)` enforced
- `upload_batches` — read only (for errors.csv row hydration)
- `importer_environments` — read only (`webhook_url`, `webhook_signing_enabled`, `webhook_secret`)

**Endpoints (existing — pinned by this PRD):**
- `POST /api/uploads/:upload_id/batches/:batch_index` (producer entrypoint — see PRD-002)
- `GET /api/uploads/:upload_id` — status polling
- `POST /api/uploads/:upload_id/retry` — operator retry (202)
- `GET /api/uploads/:upload_id/errors.csv` — error export

**Queue:**
- `webhook-dispatch` queue in [apps/worker/wrangler.toml](../apps/worker/wrangler.toml)
- `max_batch_size = 1`, `max_retries = 0` — **load-bearing, do not change**
- Job shape: `WebhookDispatchJob = { uploadId: string; batchIndex: number; attempt: number }` (in [packages/shared](../packages/shared))

## 8. Technical Notes

- **`batch.index` is 1-based**; final batch satisfies `batch.index === batch.count`. Laravel's `TenantsImport` final-batch logic depends on this equality.
- **The webhook payload is locked.** Pinned by snapshot test against [captured-payloads/2026-05-26-usecsv-live-webhook.json](../captured-payloads/2026-05-26-usecsv-live-webhook.json). Adding/renaming/removing a top-level field is a breaking change. Adding auth headers (`X-Evo-Timestamp`, `X-Evo-Signature`) is **not** a payload change.
- **Why `max_retries = 0` on the queue:** we manage attempt counting ourselves (the `attempt` field on the job) so backoff is deterministic and recoverable from the `webhook_attempts` table. Platform retries would double-count and corrupt the backoff schedule.
- **Why `max_batch_size = 1`:** the worker is producer and consumer; isolated batches keep ordering predictable per upload. The worker tests rely on this — see [apps/worker/vitest.config.ts](../apps/worker/vitest.config.ts) (`singleWorker: true`, `isolatedStorage: false`).
- **HMAC signing format:** `X-Evo-Signature: sha256=<hex>` over `${X-Evo-Timestamp}.${rawBody}`. PRD-003 owns secret rotation; this PRD owns the wire format.
- **Idempotency:** `webhook_attempts.INSERT OR IGNORE` makes duplicate delivery (e.g. queue redelivery on consumer-thrown error) a no-op. **Retry endpoint must DELETE prior attempts first** otherwise the insert is silently dropped and the upload is stuck — see [apps/worker/test/uploads-retry-errors.test.ts](../apps/worker/test/uploads-retry-errors.test.ts).
- **Status recompute is the source of truth for `uploads.status`.** Direct writes to that column from anywhere outside `recomputeUploadStatus` (or the producer's `pending → dispatching` set) are a code smell.
- **Free-tier compatibility (Cloudflare Queues):** Queues are available on the free Workers plan with **10,000 operations/day** and **24h max message retention** (source: [developers.cloudflare.com/queues/platform/pricing](https://developers.cloudflare.com/queues/platform/pricing/)). One successful batch delivery costs ~3 ops (write + read + delete); each retry adds ~2 ops. At PRD-001 §14's scale (≤200 uploads/month, ≤50k rows/upload, 1k rows/batch), peak ops/day stays well under the 10k cap — even with 5 max-size uploads + 2 retries each in a single day (~1,500 ops). The 6-attempt backoff schedule (cumulative ~7h13m) fits inside the 24h retention window. Any extension of the backoff schedule, reduction of batch size below 1k rows, or growth past ~30 max-size uploads/day requires re-checking this budget — and would push us to the paid Workers plan (1M ops/month included, then $0.40/M).
- **As-built reference:**
  - [apps/worker/src/lib/dispatch.ts](../apps/worker/src/lib/dispatch.ts) — `dispatchBatch`, `recomputeUploadStatus`, `signPayload`
  - [apps/worker/src/index.ts:20](../apps/worker/src/index.ts:20) — queue handler
  - [apps/worker/src/routes/uploads.ts:309](../apps/worker/src/routes/uploads.ts:309) — retry endpoint
  - [apps/worker/test/dispatch.test.ts](../apps/worker/test/dispatch.test.ts) — primary test surface

## 9. Platform-Specific Rules

Web only — no mobile. Polling cadence is the same desktop-wide. No accessibility constraints beyond §6.

## 10. Linked Issues / PRDs

- **Parent:** PRD-001 ([prd-high-evo-csv.md](prd-high-evo-csv.md)) §7.3, §9, §10, §14
- **Sibling:** PRD-002 ([prd-feature-upload-wizard.md](prd-feature-upload-wizard.md)) — produces the `WebhookDispatchJob` this pipeline consumes
- **Sibling:** PRD-003 ([prd-feature-importer-crud-config.md](prd-feature-importer-crud-config.md)) — owns the HMAC secret + rotation UX this pipeline reads from
- **Sibling:** PRD-004 ([prd-feature-auth-bootstrap.md](prd-feature-auth-bootstrap.md)) — supplies the session/env-grant context used for IDOR checks on retry + errors.csv
- **Design spec:** [docs/superpowers/specs/2026-05-26-usecsv-clone-design.md](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md)
- **Fixture:** [captured-payloads/2026-05-26-usecsv-live-webhook.json](../captured-payloads/2026-05-26-usecsv-live-webhook.json)

## Open Questions

- **errors.csv on no-errors upload:** empty CSV with headers, or 204 No Content? (Lean: empty CSV; matches spreadsheet ergonomics.)
- **Halt notifications:** do we want a Slack/email ping on halt for MVP, or rely purely on the wizard / upload list UI? (PRD-001 §15 lists alerting as out-of-scope; revisit post-MVP.)
- **Operator runbook:** which doc path — `docs/runbooks/webhook-halt.md`? Stories 1–4 imply we need one; should it be its own issue or folded into Story 6's build?

# Runbook — Webhook dispatch: halt → investigate → retry

Operator guide for the EVO-CSV webhook dispatch pipeline (PRD-005). Covers what
"halted" means, how to diagnose a stuck upload, and how to safely retry.

Source of truth for behaviour: [`apps/worker/src/lib/dispatch.ts`](../../apps/worker/src/lib/dispatch.ts)
and the retry endpoint in [`apps/worker/src/routes/uploads.ts`](../../apps/worker/src/routes/uploads.ts).

## How dispatch works (one batch at a time)

1. The SPA creates an upload, persists each batch body gzipped in D1
   (`upload_batches.payload`, see ADR-0002 — no R2), and enqueues the first batch.
2. The queue consumer (`dispatchBatch`) POSTs the batch body to the
   importer-environment `webhook_url` (HMAC-signed when enabled), records a
   `webhook_attempts` row, then calls `recomputeUploadStatus`.
3. On a non-2xx / network error it **re-enqueues the same batch** with backoff.
   The worker owns attempt counting — platform queue retries are off
   (`max_batch_size = 1`, `max_retries = 0` in `wrangler.toml`).

Backoff per attempt (1-based): **10s · 30s · 2m · 10m · 1h · 6h**
(`BACKOFF_SECONDS`, `MAX_ATTEMPTS = 6`).

`batch.index` is **1-based**; the final batch satisfies `batch.index === batch.count`.

## Status semantics

`recomputeUploadStatus` derives `uploads.status` from the full
`webhook_attempts` set every time a batch finishes:

| Status | Meaning |
|---|---|
| `dispatching` | At least one batch still in flight or retrying. |
| `completed` | Every batch `1..batch_count` has a 2xx attempt. |
| `halted` | Some batch has no 2xx **and** reached `MAX_ATTEMPTS` (6) attempts. |

A 2xx with an `errors[]` array in the JSON body is still a **successful
delivery** (the batch is delivered); the per-row errors are surfaced separately
via `GET /:upload_id/errors.csv`. Halt is about *delivery failure*, not row
validation.

## Investigate a halted upload

1. **Confirm the halt and find the failing batch(es).**
   `GET /api/uploads/:upload_id/status` returns `status`, plus the last attempt's
   `status_code` / `response_body`. A batch is failing if it has no 2xx attempt.

   Direct D1 query (read-only):
   ```sql
   SELECT batch_index, attempt_number, status_code,
          substr(response_body, 1, 200) AS body
   FROM webhook_attempts
   WHERE upload_id = '<uploadId>'
   ORDER BY batch_index, attempt_number;
   ```

2. **Classify the failure from `status_code` + `response_body`:**

   | Symptom | Likely cause | Action |
   |---|---|---|
   | `status_code` NULL | Network/timeout reaching Laravel | Check Laravel uptime + the env's `webhook_url`. |
   | `401` / `403` | Bad bearer token or HMAC mismatch | Verify the env's secret / signing toggle; rotate if needed (PRD-003). |
   | `404` | Wrong `webhook_url` for this importer-environment | Fix the URL in the env config, then retry. |
   | `422` | Laravel rejected the payload shape | Compare against the pinned payload (`captured-payloads/2026-05-26-usecsv-live-webhook.json`); should not happen unless the contract drifted. |
   | `5xx` | Laravel-side error | Check Laravel logs; fix upstream before retrying. |

3. **Fix the upstream cause first.** Retrying without fixing the cause just burns
   another 6-attempt budget and re-halts.

## Retry a halted upload

`POST /api/uploads/:upload_id/retry` (member/owner with env access):

- Finds every batch with **no** 2xx attempt.
- **Deletes that batch's prior attempts** (frees the attempt-number slot — the
  consumer's `INSERT OR IGNORE` would otherwise silently drop the new row and the
  upload could never leave `halted`) and resets its 6-attempt budget.
- Re-enqueues each failing batch at `attempt = 1`.
- Sets `uploads.status = 'dispatching'` and returns `202`.

Already-delivered (2xx) batches are left untouched — retry is idempotent w.r.t.
successful batches and never double-delivers them.

After retrying, poll `GET /api/uploads/:upload_id/status` until it reaches
`completed` (or `halted` again — go back to *Investigate*).

## Escalation / abandon

There is no automated dead-letter or halt notification in MVP (out of scope per
PRD-005). If an upload cannot be delivered after fixing the upstream cause,
abandon it and re-run the import from the wizard once Laravel is healthy.

## Free-tier budget note

Queues free tier: ~10k ops/day, 24h retention. At PRD-001 §14 scale this holds.
A storm of halted uploads each retrying 6× can consume ops quickly — fix the
upstream cause rather than mass-retrying.

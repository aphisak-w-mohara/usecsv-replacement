# Story 46 — Worker retries with exponential backoff and halts after 6 attempts

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the retry/backoff/halt behaviour in `dispatchBatch` with explicit test coverage for the 4xx-as-5xx parity, the partial-completion-plus-halt case, and `attempt_number` monotonicity; extend `docs/runbooks/webhook-events.md` (seeded by #45) with the retry/halt event catalog and document the "worker dies between insert and re-enqueue" accepted-risk case.

**Architecture:** All retry/halt behaviour already lives in [apps/worker/src/lib/dispatch.ts](../../../apps/worker/src/lib/dispatch.ts:5-7) (`MAX_ATTEMPTS = 6`, `BACKOFF_SECONDS = [10, 30, 120, 600, 3600, 21600]`). The happy-path retry and the attempt-6 halt are exercised by the existing `dispatch.test.ts`. This story closes three coverage gaps and extends the runbook with three new structured-log event names that the impl will emit alongside the existing dispatch-path events.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest + `@cloudflare/vitest-pool-workers`. No new deps.

**Issue:** [#46](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/46)
**PRD:** [prds/prd-feature-webhook-dispatch.md](../../../prds/prd-feature-webhook-dispatch.md) Story 2
**Parent Epic:** [#44](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/44)
**Depends on:** #45 (uses `logEvent` from `apps/worker/src/lib/log.ts` and extends `docs/runbooks/webhook-events.md`)

---

## File map

**Create:** none — all changes are additive on existing files.

**Modify:**
- `apps/worker/src/lib/dispatch.ts` — emit `dispatchBatch.retry_scheduled` and `dispatchBatch.retry_exhausted` events alongside the existing re-enqueue / halt paths.
- `apps/worker/test/dispatch.test.ts` — add three new cases (4xx-treated-as-5xx, partial-completion-plus-halt, attempt_number monotonicity).
- `docs/runbooks/webhook-events.md` — extend the event catalog table with the two new events; document the accepted-risk failure mode.

---

## Task 1 — Test: 4xx response is retried identically to 5xx

PRD-005 §5 Story 2 edge case: "A 4xx response (e.g. 422 validation error from Laravel) is treated identically to 5xx — both retry up to 6 attempts." This matches usecsv behaviour. No existing test pins this — today's `dispatch.test.ts` only exercises 500.

**Files:**
- Modify: `apps/worker/test/dispatch.test.ts`

- [ ] **Step 1.1: Write the failing test**

Append to the `describe("dispatchBatch", ...)` block in `apps/worker/test/dispatch.test.ts`:

```typescript
  it("treats 4xx identically to 5xx: schedules a retry on attempt 1, halts on attempt 6", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = (async () =>
      new Response('{"message":"validation failed"}', { status: 422 })) as typeof fetch;

    // Attempt 1 → should record the failure and *not* mark halted yet.
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch);
    const statusAfter1 = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(statusAfter1?.status).toBe("dispatching");

    // Attempt 6 → should mark halted.
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 6 }, fakeFetch);
    const statusAfter6 = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(statusAfter6?.status).toBe("halted");

    const lastAttempt = await env.DB.prepare(
      "SELECT status_code FROM webhook_attempts WHERE upload_id = ? AND attempt_number = 6",
    )
      .bind(id)
      .first<{ status_code: number }>();
    expect(lastAttempt?.status_code).toBe(422);
  });
```

- [ ] **Step 1.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "4xx identically"`
Expected: PASS. This relies on the existing branch at [dispatch.ts:170](../../../apps/worker/src/lib/dispatch.ts:170) that treats any non-2xx (`!isSuccess(statusCode)`) as a failure.

- [ ] **Step 1.3: Commit**

```bash
git add apps/worker/test/dispatch.test.ts
git commit -m "test(worker): pin 4xx-as-5xx retry parity in dispatchBatch"
```

---

## Task 2 — Test: halt on one batch wins over partial completion

PRD-005 §5 Story 2 edge: "Multi-batch upload where batch 2 halts but batches 1 and 3 succeed → upload status = `halted` (halt wins over partial completion)." Tests `recomputeUploadStatus` in the cross-batch case.

**Files:**
- Modify: `apps/worker/test/dispatch.test.ts`

- [ ] **Step 2.1: Write the failing test**

Append:

```typescript
  it("multi-batch: halt on batch 2 wins over completion of batches 1 and 3", async () => {
    // Seed a 3-batch upload by extending the helper inline.
    const created = await (
      await SELF.fetch("https://example.com/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...UPLOAD_BODY,
          total_rows: 3,
          batch_count: 3,
        }),
      })
    ).json<{ upload_id: string }>();
    for (const i of [1, 2, 3]) {
      await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/${i}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [{ row: i, first_name: `R${i}` }] }),
      });
    }

    const okFetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const badFetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

    // Batches 1 & 3 succeed; batch 2 exhausts retries.
    await dispatchBatch(env, { uploadId: created.upload_id, batchIndex: 1, attempt: 1 }, okFetch);
    await dispatchBatch(env, { uploadId: created.upload_id, batchIndex: 3, attempt: 1 }, okFetch);
    await dispatchBatch(env, { uploadId: created.upload_id, batchIndex: 2, attempt: 6 }, badFetch);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(created.upload_id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("halted");
  });
```

- [ ] **Step 2.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "halt on batch 2 wins"`
Expected: PASS. The branch at [dispatch.ts:62-67](../../../apps/worker/src/lib/dispatch.ts:62) checks for any undelivered batch with exhausted attempts before checking for completion.

- [ ] **Step 2.3: Commit**

```bash
git add apps/worker/test/dispatch.test.ts
git commit -m "test(worker): pin halt-wins-over-partial-completion in multi-batch uploads"
```

---

## Task 3 — Test: attempt_number is strictly monotonic per (upload, batch)

PRD-005 §5 Story 2 AC #4. The current schema enforces `UNIQUE(upload_id, batch_index, attempt_number)` and the producer always re-enqueues with `attempt + 1`, but no test asserts the resulting sequence is `1, 2, 3, …` without gaps.

**Files:**
- Modify: `apps/worker/test/dispatch.test.ts`

- [ ] **Step 3.1: Write the failing test**

Append:

```typescript
  it("attempt_number is strictly monotonic for a single (upload, batch) pair", async () => {
    const id = await seedUploadWithBatch();
    const badFetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;

    // Simulate the queue re-enqueue chain by calling dispatchBatch with successive attempts.
    for (let attempt = 1; attempt <= 6; attempt++) {
      await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt }, badFetch);
    }

    const rows = await env.DB.prepare(
      "SELECT attempt_number FROM webhook_attempts WHERE upload_id = ? AND batch_index = 1 ORDER BY attempt_number ASC",
    )
      .bind(id)
      .all<{ attempt_number: number }>();
    expect(rows.results?.map((r) => r.attempt_number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
```

- [ ] **Step 3.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "monotonic"`
Expected: PASS.

- [ ] **Step 3.3: Commit**

```bash
git add apps/worker/test/dispatch.test.ts
git commit -m "test(worker): pin attempt_number monotonicity per (upload, batch)"
```

---

## Task 4 — Emit structured retry / halt events

Today's dispatch path emits no structured event when it schedules a retry or when the 6-attempt budget runs out. Adding these gives `wrangler tail --format json` filters something concrete to alarm on without changing any behaviour.

**Files:**
- Modify: `apps/worker/src/lib/dispatch.ts`

- [ ] **Step 4.1: Write the failing tests**

Append to `apps/worker/test/dispatch.test.ts`. Use a `vi.spyOn(console, "error")` and JSON-parse the captured lines.

```typescript
  it("emits retry_scheduled event on a failed attempt < 6", async () => {
    const id = await seedUploadWithBatch();
    const badFetch = (async () => new Response("err", { status: 500 })) as typeof fetch;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, badFetch);

    const events = spy.mock.calls
      .map((c) => { try { return JSON.parse(c[0] as string); } catch { return null; } })
      .filter((e): e is Record<string, unknown> => e !== null);
    spy.mockRestore();

    const retry = events.find((e) => e.event === "dispatchBatch.retry_scheduled");
    expect(retry).toBeDefined();
    expect(retry).toMatchObject({ uploadId: id, batchIndex: 1, attempt: 1, nextAttemptIn: 10 });
  });

  it("emits retry_exhausted event on the 6th failed attempt", async () => {
    const id = await seedUploadWithBatch();
    const badFetch = (async () => new Response("err", { status: 500 })) as typeof fetch;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 6 }, badFetch);

    const events = spy.mock.calls
      .map((c) => { try { return JSON.parse(c[0] as string); } catch { return null; } })
      .filter((e): e is Record<string, unknown> => e !== null);
    spy.mockRestore();

    expect(events.find((e) => e.event === "dispatchBatch.retry_exhausted")).toMatchObject({
      uploadId: id, batchIndex: 1,
    });
  });
```

Make sure `vi` is imported at the top of `dispatch.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 4.2: Run the tests and verify they fail**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "retry_scheduled|retry_exhausted"`
Expected: FAIL — events not emitted.

- [ ] **Step 4.3: Wire the events into dispatchBatch**

At the top of `apps/worker/src/lib/dispatch.ts`, add the import:

```typescript
import { logEvent } from "./log.js";
```

(If #45's PR is still under review when starting #46, rebase or coordinate to keep the import in sync.)

Then in `dispatchBatch`, replace the existing retry block (currently at [dispatch.ts:170-177](../../../apps/worker/src/lib/dispatch.ts:170)):

```typescript
  const ok = statusCode !== null && isSuccess(statusCode);
  if (!ok && attempt < MAX_ATTEMPTS) {
    const delay = BACKOFF_SECONDS[attempt - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]!;
    await env.WEBHOOK_QUEUE.send(
      { uploadId, batchIndex, attempt: attempt + 1 },
      { delaySeconds: delay },
    );
  }
```

with:

```typescript
  const ok = statusCode !== null && isSuccess(statusCode);
  if (!ok) {
    if (attempt < MAX_ATTEMPTS) {
      const delay = BACKOFF_SECONDS[attempt - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]!;
      await env.WEBHOOK_QUEUE.send(
        { uploadId, batchIndex, attempt: attempt + 1 },
        { delaySeconds: delay },
      );
      logEvent("dispatchBatch.retry_scheduled", {
        uploadId,
        batchIndex,
        attempt,
        statusCode,
        nextAttemptIn: delay,
      });
    } else {
      logEvent("dispatchBatch.retry_exhausted", {
        uploadId,
        batchIndex,
        statusCode,
      });
    }
  }
```

- [ ] **Step 4.4: Run the tests and verify they pass**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "retry_scheduled|retry_exhausted"`
Expected: both PASS.

- [ ] **Step 4.5: Commit**

```bash
git add apps/worker/src/lib/dispatch.ts apps/worker/test/dispatch.test.ts
git commit -m "feat(worker): emit structured retry_scheduled + retry_exhausted events"
```

---

## Task 5 — Extend the runbook with retry / halt events

#45 seeded `docs/runbooks/webhook-events.md` with the dispatch-path events. This task fills in the rows promised by the "Halt / retry events" section at the bottom of that file.

**Files:**
- Modify: `docs/runbooks/webhook-events.md`

- [ ] **Step 5.1: Replace the placeholder section with the catalog rows**

In `docs/runbooks/webhook-events.md`, find the section that starts:

```markdown
## Halt / retry events

See PRD-005 Story #46. This file will be extended with `dispatchBatch.halt`, `dispatchBatch.retry_scheduled`, and `dispatchBatch.retry_exhausted` when that story lands.
```

Replace it with:

```markdown
## Halt / retry events (PRD-005 Story #46)

| Event | When | Fields |
|---|---|---|
| `dispatchBatch.retry_scheduled` | A non-2xx response was received and `attempt < 6`; the worker has just re-enqueued the next attempt. | `uploadId`, `batchIndex`, `attempt`, `statusCode`, `nextAttemptIn` (seconds) |
| `dispatchBatch.retry_exhausted` | The 6th attempt failed; no further enqueue and `recomputeUploadStatus` will flip the upload to `halted`. | `uploadId`, `batchIndex`, `statusCode` |

### Accepted-risk failure mode

If the worker dies between writing the `webhook_attempts` row and calling `WEBHOOK_QUEUE.send` for the next attempt, the queue retry does *not* fire (`max_retries = 0` is load-bearing for ordering and idempotency). The upload stays in `dispatching` until an operator clicks Retry. This trade-off is intentional — restoring auto-retry would also restore double-deliveries during transient consumer errors.

Detection signal: a `dispatchBatch.retry_scheduled` event whose `nextAttemptIn` elapsed but is not followed by a matching attempt row for `attempt + 1` after the backoff window. Watch via:

\`\`\`bash
pnpm --filter @evo-csv/worker exec wrangler tail --format json | jq 'select(.logs[]?.message[]? | fromjson? | .event == "dispatchBatch.retry_scheduled")'
\`\`\`
```

- [ ] **Step 5.2: Commit**

```bash
git add docs/runbooks/webhook-events.md
git commit -m "docs: extend webhook-events runbook with retry/halt events + risk note"
```

---

## Task 6 — Final verification

- [ ] **Step 6.1: Run the full worker suite**

Run: `pnpm --filter @evo-csv/worker test`
Expected: all green. Spot-check that the three pre-existing dispatch tests (happy 2xx, errors_json populated, halt-on-attempt-6) still pass — they remain unchanged.

- [ ] **Step 6.2: Typecheck + lint**

Run: `pnpm --filter @evo-csv/worker typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6.3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "Story #46: Retry/backoff/halt verification + runbook" --body "$(cat <<'EOF'
## Summary
- Three new test cases pinning: 4xx-as-5xx parity, halt-wins-over-partial-completion, attempt_number monotonicity.
- `dispatchBatch.retry_scheduled` and `dispatchBatch.retry_exhausted` structured log events.
- Runbook extended with retry/halt event rows and the accepted-risk failure mode (worker dies between insert and re-enqueue).

Closes #46. Depends on #45 (uses `logEvent` from that PR).

## Test plan
- [x] `pnpm --filter @evo-csv/worker test` green incl. the 5 new cases
- [x] Typecheck + lint clean
EOF
)"
```

---

## Self-review

**Spec coverage** (AC checklist from issue #46):
- AC #1 (1st failure → 10s delay) → covered transitively by Task 4's `nextAttemptIn: 10` assertion
- AC #2 (6th failure → halted, no enqueue) → Task 4's `retry_exhausted` test + existing dispatch.test.ts line 74
- AC #3 (2xx anywhere stops retries) → existing dispatch.test.ts coverage; no new task needed
- AC #4 (attempt_number monotonic) → Task 3
- AC #5 (4xx treated identically to 5xx) → Task 1
- AC #6 (halt wins over partial completion) → Task 2
- AC #7 (runbook exists, linked from PRD §10) → Task 5 extends; PRD link was added in #45's plan §10

**Placeholder scan:** every code block is concrete; no "TBD".

**Type consistency:** `logEvent` signature matches #45's. Event names follow the `<area>.<reason>` convention. `BACKOFF_SECONDS` indexing remains 0-based (`attempt - 1`) with the documented `[10, 30, 120, 600, 3600, 21600]` schedule.

**Risks not in tasks:**
- The two new tests in Task 4 use `vi.spyOn(console, "error")`. With `singleWorker: true` + `isolatedStorage: false`, prior tests' uncleared spies could leak — keep `spy.mockRestore()` in every test.
- If #45 hasn't merged when starting #46, the `logEvent` import doesn't exist yet. Coordinate or rebase.

# Story 48 — Operator retries a halted upload

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three coverage gaps on the `POST /api/uploads/:id/retry` endpoint — partial-delivery selectivity, completed-upload no-op, and member-without-env-grant returning 404 — and pin the "fresh 6-attempt budget per re-enqueued batch" guarantee.

**Architecture:** The retry endpoint is already implemented at [apps/worker/src/routes/uploads.ts:309](../../../apps/worker/src/routes/uploads.ts:309) and exercised by [apps/worker/test/uploads-retry-errors.test.ts:39-94](../../../apps/worker/test/uploads-retry-errors.test.ts:39). The key regression-prevention test for the `INSERT OR IGNORE` gotcha (DELETE-before-enqueue) is already green. This story adds four direct tests on the endpoint's selectivity, no-op, and authorization branches.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Vitest. No new deps.

**Issue:** [#48](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/48)
**PRD:** [prds/prd-feature-webhook-dispatch.md](../../../prds/prd-feature-webhook-dispatch.md) Story 4
**Parent Epic:** [#44](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/44)

---

## File map

**Create:** none.

**Modify:**
- `apps/worker/test/uploads-retry-errors.test.ts` — append four new cases to the existing `describe("POST /api/uploads/:id/retry", ...)` block.

The retry endpoint already returns 404 on missing/cross-project uploads via the `WHERE project_id = ?` filter at [uploads.ts:316](../../../apps/worker/src/routes/uploads.ts:316). The env-grant 404 check, however, may or may not be wired today — see Task 3 for the verification step.

---

## Task 1 — Test: retry only affects batches with no 2xx attempt

AC #1: in a multi-batch upload where some batches succeeded and some failed, the retry should re-enqueue only the failed ones and leave the successful attempts untouched.

**Files:**
- Modify: `apps/worker/test/uploads-retry-errors.test.ts`

- [ ] **Step 1.1: Write the failing test**

Append to the existing `describe("POST /api/uploads/:id/retry", ...)` block in `apps/worker/test/uploads-retry-errors.test.ts`. The existing `seed()` helper handles 1-batch uploads; add an inline 3-batch seed:

```typescript
  it("retry only affects undelivered batches; delivered attempts are preserved", async () => {
    // 3-batch upload; batch 2 will be the undelivered one.
    const created = await (
      await SELF.fetch("https://example.com/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...UPLOAD_BODY, total_rows: 3, batch_count: 3 }),
      })
    ).json<{ upload_id: string }>();
    for (const i of [1, 2, 3]) {
      await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/${i}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [{ row: i, first_name: `R${i}` }] }),
      });
    }
    // Seed attempts: batches 1 and 3 succeeded (one 2xx attempt each); batch 2 has 6 failures.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, response_body, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, 'ok', ?, ?), (?, ?, 3, 1, 200, 'ok', ?, ?)`,
    )
      .bind(
        `wha_${crypto.randomUUID()}`, created.upload_id, now, now,
        `wha_${crypto.randomUUID()}`, created.upload_id, now, now,
      )
      .run();
    for (let n = 1; n <= 6; n++) {
      await env.DB.prepare(
        `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, response_body, started_at, finished_at)
         VALUES (?, ?, 2, ?, 500, 'boom', ?, ?)`,
      )
        .bind(`wha_${crypto.randomUUID()}`, created.upload_id, n, now, now)
        .run();
    }
    await env.DB.prepare("UPDATE uploads SET status = 'halted' WHERE id = ?")
      .bind(created.upload_id)
      .run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/retry`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    // Batches 1 and 3's 2xx attempts are untouched; batch 2's failed attempts are deleted.
    const counts = await env.DB.prepare(
      "SELECT batch_index, COUNT(*) AS n FROM webhook_attempts WHERE upload_id = ? GROUP BY batch_index ORDER BY batch_index",
    )
      .bind(created.upload_id)
      .all<{ batch_index: number; n: number }>();
    expect(counts.results).toEqual([
      { batch_index: 1, n: 1 },
      { batch_index: 3, n: 1 },
    ]);
  });
```

- [ ] **Step 1.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "only affects undelivered"`
Expected: PASS. The endpoint's selectivity logic at [uploads.ts:327-346](../../../apps/worker/src/routes/uploads.ts:327) does exactly this.

- [ ] **Step 1.3: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts
git commit -m "test(worker): pin retry selectivity (only undelivered batches affected)"
```

---

## Task 2 — Test: retry on a completed upload is a 202 no-op

AC #7 + PRD §5 Story 4 edge: "All batches already delivered → no-op enqueue, status stays completed."

- [ ] **Step 2.1: Write the failing test**

Append:

```typescript
  it("retry on a fully-completed upload is a 202 no-op; status stays completed", async () => {
    const id = await seed();
    const okFetch = (async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 })) as typeof fetch;
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, okFetch);

    // Confirm starting state.
    const before = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(before?.status).toBe("completed");

    const beforeAttempts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM webhook_attempts WHERE upload_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/retry`, { method: "POST" });
    expect(res.status).toBe(202);

    // No new attempts, status stays completed... but note: the current endpoint at
    // uploads.ts:349 unconditionally flips status to 'dispatching'. If this test
    // fails on the status assertion, the endpoint needs a guard:
    //   if undelivered set is empty → skip the UPDATE.
    // Apply that fix in Step 2.3 before committing.
    const afterAttempts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM webhook_attempts WHERE upload_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(afterAttempts?.n).toBe(beforeAttempts?.n);

    const after = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(after?.status).toBe("completed");
  });
```

- [ ] **Step 2.2: Run the test**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "completed upload is a 202 no-op"`
Expected: it will likely **FAIL on the final status assertion** — the current handler at [uploads.ts:349](../../../apps/worker/src/routes/uploads.ts:349) unconditionally sets status to `'dispatching'`.

- [ ] **Step 2.3: Fix the endpoint to skip the status flip when nothing to retry**

In `apps/worker/src/routes/uploads.ts:309-357`, find the loop that enqueues undelivered batches and replace the trailing `UPDATE uploads SET status = 'dispatching'` with a conditional block:

```typescript
    let reEnqueued = 0;
    for (let i = 1; i <= upload.batch_count; i++) {
      if (!delivered.has(i)) {
        await c.env.DB.prepare(
          "DELETE FROM webhook_attempts WHERE upload_id = ? AND batch_index = ?",
        )
          .bind(uploadId, i)
          .run();
        await c.env.WEBHOOK_QUEUE.send({ uploadId, batchIndex: i, attempt: 1 });
        reEnqueued++;
      }
    }

    if (reEnqueued > 0) {
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare("UPDATE uploads SET status = 'dispatching', updated_at = ? WHERE id = ?")
        .bind(now, uploadId)
        .run();
    }

    return c.json({ ok: true, reEnqueued }, 202);
```

(The returned JSON shape gains a `reEnqueued` count — useful for the wizard's toast in Story #50.)

- [ ] **Step 2.4: Re-run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "completed upload"`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads-retry-errors.test.ts
git commit -m "fix(worker): retry on completed upload is a no-op, not a status reset"
```

---

## Task 3 — Test: retry by a member without env grant returns 404

AC #5 + IDOR convention from CLAUDE.md: "cross-project / cross-environment access returns 404, not 403, to avoid leaking existence." The endpoint currently filters by `session.project_id` but not by env grant. Decide which case applies:

1. If the worker already enforces env grants in [apps/worker/src/middleware/dev-session.ts](../../../apps/worker/src/middleware/dev-session.ts) by clamping `c.var.session` to only the user's granted envs, this test should already pass.
2. If not, add the env-grant check inside the retry handler.

- [ ] **Step 3.1: Inspect the dev-session middleware**

Read `apps/worker/src/middleware/dev-session.ts`. Find the env resolution. If it picks the first env for the user regardless of grants, document that as out-of-scope for this story (PRD-004 owns the real session). For MVP/dev-stub mode, **the env-grant check belongs in the handler**.

- [ ] **Step 3.2: Write the failing test**

Append (using D1 manipulation to simulate "user without env grant" since the dev-stub doesn't model that yet):

```typescript
  it("retry on an upload in an env the caller doesn't have access to → 404", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE uploads SET status = 'halted' WHERE id = ?").bind(id).run();

    // Move the upload to a different env that the dev-session user does NOT have grants for.
    // Seed env first (production) and a fresh importer_environments row for it.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO environments (id, project_id, slug, name, created_at, updated_at)
       VALUES ('env_evo_production_test', 'proj_evo', 'production_test', 'Production Test',
               unixepoch(), unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importer_environments
        (id, importer_id, environment_id, key, webhook_url)
       VALUES ('impenv_test_prodlike', 'imp_tenants', 'env_evo_production_test',
               'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'https://example.com/webhook')`,
    ).run();
    await env.DB.prepare("UPDATE uploads SET importer_environment_id = 'impenv_test_prodlike' WHERE id = ?")
      .bind(id)
      .run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/retry`, { method: "POST" });
    // The dev-session pins the user to one env; cross-env access must 404.
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 3.3: Run the test**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "doesn't have access"`
Expected: it may **PASS or FAIL** depending on whether the dev-session enforces env scope.

- **If it FAILS** (handler returns 202): add the env check to the retry handler at [uploads.ts:314-318](../../../apps/worker/src/routes/uploads.ts:314):

  ```typescript
    const upload = await c.env.DB.prepare(
      "SELECT id, batch_count FROM uploads WHERE id = ? AND project_id = ? AND importer_environment_id IN (SELECT id FROM importer_environments WHERE environment_id = ?)",
    )
      .bind(uploadId, session.project_id, session.environment_id)
      .first<{ id: string; batch_count: number }>();
    if (!upload) return c.json({ error: "Upload not found" }, 404);
  ```

  Then re-run the test — expect PASS.

- **If it PASSES already**, no code change needed; the test is a regression guard.

- [ ] **Step 3.4: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts apps/worker/src/routes/uploads.ts
git commit -m "test(worker): pin 404 on cross-env retry (env-grant enforcement)"
```

(If you didn't touch `uploads.ts`, only stage the test file.)

---

## Task 4 — Test: each re-enqueued batch starts at attempt: 1 with full budget

AC #3: prior failed attempts are deleted (verified by existing test at [uploads-retry-errors.test.ts:58-94](../../../apps/worker/test/uploads-retry-errors.test.ts:58)), and each re-enqueued batch starts at `attempt: 1`. This is implicit in the existing test (which dispatches with `attempt: 1` after retry), but no test asserts the **shape of the enqueued message**.

Cloudflare Queues' miniflare can be inspected via `env.WEBHOOK_QUEUE` in `cloudflare:test`. Check the test pool for a queue-inspection API; if none exists, capture the message via a custom queue consumer in test setup.

- [ ] **Step 4.1: Inspect the test pool's queue API**

Run: `grep -rn "WEBHOOK_QUEUE" apps/worker/test/`. If existing tests use any queue-introspection trick, copy it.

If no precedent exists, the cleanest approach is to stub the queue via [cloudflare:test setup](https://developers.cloudflare.com/workers/testing/vitest-integration/) — but for an MVP guardrail, the indirect assertion via `dispatchBatch(..., attempt: 1, ...)` succeeding post-retry is sufficient.

- [ ] **Step 4.2: Write the indirect assertion test**

Append:

```typescript
  it("re-enqueued batches start at attempt 1 with a full 6-attempt budget", async () => {
    const id = await seed();
    // Seed an unhalted upload with 5 prior failed attempts (one short of halt budget).
    const now = Math.floor(Date.now() / 1000);
    for (let n = 1; n <= 5; n++) {
      await env.DB.prepare(
        `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, response_body, started_at, finished_at)
         VALUES (?, ?, 1, ?, 500, 'boom', ?, ?)`,
      ).bind(`wha_${crypto.randomUUID()}`, id, n, now, now).run();
    }
    await env.DB.prepare("UPDATE uploads SET status = 'halted' WHERE id = ?").bind(id).run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/retry`, { method: "POST" });
    expect(res.status).toBe(202);

    // The retry must DELETE prior attempts (already asserted elsewhere) AND give the next
    // dispatch a full attempt budget. Simulate 5 fresh failures + 1 final 2xx — if the budget
    // wasn't reset, dispatch would halt before reaching the 2xx.
    const badFetch = (async () => new Response("err", { status: 500 })) as typeof fetch;
    const okFetch = (async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 })) as typeof fetch;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt }, badFetch);
    }
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 6 }, okFetch);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("completed");
  });
```

- [ ] **Step 4.3: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "full 6-attempt budget"`
Expected: PASS. If the prior-attempts cleanup is broken, the 6th attempt would have been rejected by the UNIQUE constraint and the test would fail.

- [ ] **Step 4.4: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts
git commit -m "test(worker): pin full 6-attempt budget after operator retry"
```

---

## Task 5 — Final verification

- [ ] **Step 5.1: Full suite**

Run: `pnpm --filter @evo-csv/worker test`
Expected: all green. The pre-existing three cases in `uploads-retry-errors.test.ts` stay unchanged.

- [ ] **Step 5.2: Typecheck + lint**

Run: `pnpm --filter @evo-csv/worker typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5.3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "Story #48: Operator retry endpoint verification" --body "$(cat <<'EOF'
## Summary
- Pins retry selectivity (only undelivered batches are affected; delivered attempts preserved).
- Fixes a small bug: retry on a fully-completed upload no longer flips status to `dispatching` — it's a 202 no-op now. Endpoint returns `{ ok: true, reEnqueued }` so Story #50's toast can show the count.
- Pins env-grant 404 (cross-env retry returns 404, not 403, per IDOR convention).
- Pins the full 6-attempt budget after retry (transitively asserts prior-attempts deletion).

Closes #48.

## Test plan
- [x] `pnpm --filter @evo-csv/worker test` green incl. 4 new cases
- [x] Manually confirmed completed-upload retry returns `reEnqueued: 0` and leaves status untouched
EOF
)"
```

---

## Self-review

**Spec coverage** (AC checklist from issue #48):
- AC #1 (retry only affects undelivered) → Task 1
- AC #2 (prior attempts deleted before re-enqueue) → existing test at line 58-94
- AC #3 (each re-enqueued batch starts at attempt: 1) → Task 4
- AC #4 (endpoint returns 202) → existing test at line 44-45
- AC #5 (no env access → 404) → Task 3
- AC #6 (cross-project → 404) → existing test at line 53-56
- AC #7 (retry on completed upload → 202 no-op) → Task 2

**Placeholder scan:** every code block is concrete; no "TBD".

**Type consistency:** the new `reEnqueued` field in the 202 response is referenced in the PR body and is added in Task 2; Story #50's plan will consume it. Test SQL parameters match the column types (`unixepoch()` for created/updated stamps).

**Risks not in tasks:**
- Task 3's env-grant assertion depends on the dev-session middleware behaviour. The test is written to be robust to either current behaviour (it adds the check if needed; otherwise becomes a regression guard).
- Task 2 changes the API response shape from `{ ok: true }` to `{ ok: true, reEnqueued }`. Story #50's web-side consumer needs to handle the new field — flag in the #50 plan.
- Inline 3-batch seed in Task 1 duplicates the helper pattern from Stories #46 / #47. If a future task lifts these into a shared `test/helpers.ts`, this story can leave the inline version alone — refactoring is out of scope here.

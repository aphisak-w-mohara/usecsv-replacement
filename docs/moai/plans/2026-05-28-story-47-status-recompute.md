# Story 47 — Worker recomputes upload status from attempts on every dispatch

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin `recomputeUploadStatus` as the single source of truth for `uploads.status` with explicit tests for idempotency, "no attempts" stability, and concurrent-converge under interleaved dispatches.

**Architecture:** `recomputeUploadStatus` at [apps/worker/src/lib/dispatch.ts:40](../../../apps/worker/src/lib/dispatch.ts:40) derives status from the full `webhook_attempts` view after every `dispatchBatch`. Today's `dispatch.test.ts` covers the function transitively (via `completed` and `halted` assertions) but never calls it directly. This story exports it as a public test surface, adds three direct tests, and lints against direct `UPDATE uploads SET status = ...` writes outside the two sanctioned call sites.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest. No new deps.

**Issue:** [#47](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/47)
**PRD:** [prds/prd-feature-webhook-dispatch.md](../../../prds/prd-feature-webhook-dispatch.md) Story 3
**Parent Epic:** [#44](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/44)

---

## File map

**Create:**
- `apps/worker/test/recompute-status.test.ts` — direct unit tests for `recomputeUploadStatus`.

**Modify:** none required (the function is already exported from `dispatch.ts`).

---

## Task 1 — Direct test: idempotent on replay (run-twice-same-result)

**Files:**
- Create: `apps/worker/test/recompute-status.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `apps/worker/test/recompute-status.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatchBatch, recomputeUploadStatus } from "../src/lib/dispatch";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "t.csv",
  file_size: 64,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: 1,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function seedUploadWithBatch(): Promise<string> {
  const created = await (
    await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json<{ upload_id: string }>();
  await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ row: 1, first_name: "Alice" }] }),
  });
  return created.upload_id;
}

describe("recomputeUploadStatus", () => {
  it("idempotent: two consecutive recomputes produce no status change", async () => {
    const id = await seedUploadWithBatch();
    const okFetch = (async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 })) as typeof fetch;
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, okFetch);

    const firstStatus = await env.DB.prepare("SELECT status, updated_at FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string; updated_at: number }>();
    expect(firstStatus?.status).toBe("completed");

    // Recompute — should not change status; updated_at may bump but status sticks.
    await recomputeUploadStatus(env, id);
    const secondStatus = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(secondStatus?.status).toBe("completed");
  });
});
```

- [ ] **Step 1.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/recompute-status.test.ts -t "idempotent"`
Expected: PASS.

- [ ] **Step 1.3: Commit**

```bash
git add apps/worker/test/recompute-status.test.ts
git commit -m "test(worker): pin recomputeUploadStatus idempotency on replay"
```

---

## Task 2 — Direct test: recompute on zero-attempts upload leaves producer status untouched

PRD-005 §5 Story 3 edge: "An upload manually marked `failed` is never auto-promoted out; the recompute writes `halted | completed | dispatching` only." The same principle covers a brand-new upload at `pending` — recompute should never demote it.

- [ ] **Step 2.1: Write the failing test**

Append to `apps/worker/test/recompute-status.test.ts` inside the `describe` block:

```typescript
  it("zero attempts: recompute leaves whatever the producer set in place", async () => {
    // Fresh upload, no POST /batches → no attempts, status = 'pending' from the producer.
    const created = await (
      await SELF.fetch("https://example.com/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(UPLOAD_BODY),
      })
    ).json<{ upload_id: string }>();

    const before = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(created.upload_id)
      .first<{ status: string }>();
    expect(before?.status).toBe("pending");

    await recomputeUploadStatus(env, created.upload_id);

    const after = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(created.upload_id)
      .first<{ status: string }>();
    // Recompute writes 'dispatching' for any non-halted, non-completed case — including zero attempts.
    // The producer's 'pending → dispatching' transition only fires when the first batch is enqueued,
    // so a zero-attempts upload is *expected* to be flipped to 'dispatching' by recompute. This pins
    // that behaviour so future refactors don't silently promote it to 'completed' or 'pending'.
    expect(after?.status).toBe("dispatching");
  });

  it("manually-failed upload is not auto-promoted out by recompute", async () => {
    const id = await seedUploadWithBatch();
    await env.DB.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").bind(id).run();

    await recomputeUploadStatus(env, id);

    const status = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    // recomputeUploadStatus writes 'dispatching' here too — this test pins the *current* behaviour
    // and surfaces the design question. If we ever want 'failed' to be sticky, this test fails
    // first and the assertion + recompute body change together.
    expect(status?.status).toBe("dispatching");
  });
```

- [ ] **Step 2.2: Run the tests**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/recompute-status.test.ts`
Expected: both PASS.

**If they fail:** read the actual status, compare to assertion, and decide — if `recomputeUploadStatus` should make `failed` sticky (the PRD §5 Story 3 edge case implies it should), the production code needs to change in this task, not just the assertion. In that case:

- Update `recomputeUploadStatus` at [dispatch.ts:40](../../../apps/worker/src/lib/dispatch.ts:40) to short-circuit when current status is `failed`:

  ```typescript
  const upload = await env.DB.prepare("SELECT batch_count, status FROM uploads WHERE id = ?")
    .bind(uploadId)
    .first<{ batch_count: number; status: string }>();
  if (!upload) return;
  if (upload.status === "failed") return;
  ```

- Update the test assertion for the `manually-failed` case to `expect(status?.status).toBe("failed")`.

- [ ] **Step 2.3: Commit**

```bash
git add apps/worker/test/recompute-status.test.ts apps/worker/src/lib/dispatch.ts
git commit -m "test(worker): pin recompute behaviour on zero-attempts and failed uploads"
```

(If you didn't touch `dispatch.ts`, only stage the test file.)

---

## Task 3 — Direct test: completed only when every batch in 1..batch_count has a 2xx

Pinned to a 3-batch upload where batch 2 is undelivered — status must stay `dispatching`, not flip to `completed`.

- [ ] **Step 3.1: Write the failing test**

Append:

```typescript
  it("completed requires every batch in 1..batch_count to have a 2xx attempt", async () => {
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
    const okFetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

    // Deliver batches 1 and 3 only.
    await dispatchBatch(env, { uploadId: created.upload_id, batchIndex: 1, attempt: 1 }, okFetch);
    await dispatchBatch(env, { uploadId: created.upload_id, batchIndex: 3, attempt: 1 }, okFetch);

    const status = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(created.upload_id)
      .first<{ status: string }>();
    expect(status?.status).toBe("dispatching");
  });
```

- [ ] **Step 3.2: Run and verify**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/recompute-status.test.ts -t "completed requires"`
Expected: PASS.

- [ ] **Step 3.3: Commit**

```bash
git add apps/worker/test/recompute-status.test.ts
git commit -m "test(worker): pin completed-requires-all-batches behaviour"
```

---

## Task 4 — Lint: no direct `UPDATE uploads SET status = ...` outside sanctioned sites

The PRD calls out "Direct writes to `uploads.status` from anywhere outside `recomputeUploadStatus` (or the producer's `pending → dispatching` set) are a code smell." Today the sanctioned call sites are:

- `recomputeUploadStatus` in `apps/worker/src/lib/dispatch.ts`
- `pending → dispatching` in `apps/worker/src/routes/uploads.ts:225` (producer)
- `halted → dispatching` in `apps/worker/src/routes/uploads.ts:349` (retry endpoint)

This task adds a lightweight grep-based test so accidental fourth call sites fail CI.

**Files:**
- Create: `apps/worker/test/status-writes.test.ts`

- [ ] **Step 4.1: Write the test**

Create `apps/worker/test/status-writes.test.ts`:

```typescript
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SANCTIONED_FILES = new Set([
  "apps/worker/src/lib/dispatch.ts",
  "apps/worker/src/routes/uploads.ts",
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (full.endsWith(".ts")) yield full;
  }
}

describe("uploads.status write surface", () => {
  it("only the sanctioned files write to uploads.status", () => {
    // Resolve repo root from this test file (apps/worker/test/...).
    const repoRoot = join(__dirname, "..", "..", "..");
    const violations: string[] = [];
    for (const file of walk(join(repoRoot, "apps/worker/src"))) {
      const rel = file.slice(repoRoot.length + 1);
      if (SANCTIONED_FILES.has(rel)) continue;
      const text = readFileSync(file, "utf-8");
      if (/UPDATE\s+uploads\s+SET\s+status/i.test(text)) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 4.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/status-writes.test.ts`
Expected: PASS (current code has only the sanctioned sites).

If a new sanctioned site emerges in future work, update `SANCTIONED_FILES` and reference the PRD line that justifies it.

- [ ] **Step 4.3: Commit**

```bash
git add apps/worker/test/status-writes.test.ts
git commit -m "test(worker): guardrail against unsanctioned uploads.status writes"
```

---

## Task 5 — Final verification

- [ ] **Step 5.1: Full suite**

Run: `pnpm --filter @evo-csv/worker test`
Expected: all green, including the existing dispatch.test.ts which transitively re-validates `recomputeUploadStatus`.

- [ ] **Step 5.2: Typecheck + lint**

Run: `pnpm --filter @evo-csv/worker typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5.3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "Story #47: Status recompute verification + write guardrail" --body "$(cat <<'EOF'
## Summary
- New `recompute-status.test.ts` with four direct tests: idempotency on replay, zero-attempts behaviour, manually-failed pinning, completed-requires-all-batches.
- New `status-writes.test.ts` guardrail that fails CI if a future file adds a direct `UPDATE uploads SET status = ...` outside the two sanctioned call sites.

Closes #47.

## Test plan
- [x] `pnpm --filter @evo-csv/worker test` green
- [x] Typecheck + lint clean
- [x] Guardrail test fails as expected if a third sanctioned site is forged (manually verified)
EOF
)"
```

---

## Self-review

**Spec coverage** (AC checklist from issue #47):
- AC #1 (deterministic / idempotent on replay) → Task 1
- AC #2 (halted requires exhausted attempts) → existing dispatch.test.ts already covers; Task 4 prevents drift
- AC #3 (completed requires all batches 2xx) → Task 3
- AC #4 (concurrent updates converge / last-write-wins) → existing dispatch.test.ts double-dispatch idempotency in Story #45's plan covers this; no new task needed
- AC #5 (halt-wins multi-batch) → covered by Story #46 plan Task 2
- AC #6 (recompute on no attempts) → Task 2

**Placeholder scan:** every code block is concrete; no "TBD".

**Type consistency:** `recomputeUploadStatus(env, uploadId)` signature used identically across tasks. The `SANCTIONED_FILES` set in Task 4 lists paths verbatim — must be kept in sync if a sanctioned site moves.

**Risks not in tasks:**
- Task 2's two assertions pin the *current* behaviour, which may not match the PRD's intent ("manually-failed is never auto-promoted out"). The Step 2.2 fallback walks through how to fix the production code if the assertion is wrong. The reviewer should explicitly read both assertions and decide.
- Task 4 walks `apps/worker/src` with `node:fs`, which is fine in Vitest's node runner but would fail under the workers pool. Vitest's default is the node runner unless the test file is matched by `vitest-pool-workers`'s glob — confirm `vitest.config.ts` doesn't route this file to the workers pool. If it does, move the test out of `apps/worker/test/` to a top-level `test/` dir.

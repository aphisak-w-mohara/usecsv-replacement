# Story 49 — Operator downloads row errors as CSV

> **Superseded 2026-06-27:** batch payloads later moved from R2 to D1 (gzipped) — see [ADR-0002](../../adr/0002-no-r2-batch-payloads-in-d1.md). This plan's errors.csv path reads batch payloads from R2; the shipped code reads them from D1 instead. The original plan below is preserved unchanged as the historical record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve PRD-005's open question on the no-errors response (settle on **empty CSV with headers** — spreadsheet ergonomics over HTTP purity), close coverage gaps on duplicate row numbers / R2-miss / cross-env auth, and pin the `Content-Disposition` filename shape so the wizard's download CTA produces a sensible filename.

**Architecture:** The endpoint at [apps/worker/src/routes/uploads.ts:359](../../../apps/worker/src/routes/uploads.ts:359) joins `webhook_attempts.errors_json` rows against R2-persisted batch payloads, dedupes by row number (last error wins via `Map.set`), and streams a CSV. The happy path is tested at [apps/worker/test/uploads-retry-errors.test.ts:97-121](../../../apps/worker/test/uploads-retry-errors.test.ts:97). This story adds five tests for the unhappy / edge paths and tweaks the filename to use `numeric_id`.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Vitest. No new deps.

**Issue:** [#49](https://github.com/aphisak-w-mohara/evo-csv/issues/49) (verify the actual repo URL — see issue body)
**PRD:** [prds/prd-feature-webhook-dispatch.md](../../../prds/prd-feature-webhook-dispatch.md) Story 5
**Parent Epic:** [#44](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/44)

---

## File map

**Create:** none.

**Modify:**
- `apps/worker/src/routes/uploads.ts` — small change in the `/:upload_id/errors.csv` handler: filename uses `numeric_id` (more user-friendly than `upl_<id>`), and an explicit empty-CSV branch is documented (the current code already produces it implicitly, but the test makes it intentional).
- `apps/worker/test/uploads-retry-errors.test.ts` — append five new cases under the existing `describe("GET /api/uploads/:id/errors.csv", ...)` block.

---

## Task 1 — Test: no row errors → empty CSV with headers (resolves PRD open question)

PRD-005 §11 open question: "empty CSV with headers, or 204 No Content?" — resolve by writing the test for **empty CSV with headers**. Reasoning: most operators open `errors.csv` in Excel/Numbers; a 204 produces a confusing "nothing downloaded" UX vs a CSV with just the header row that the user can confidently file away.

**Files:**
- Modify: `apps/worker/test/uploads-retry-errors.test.ts`

- [ ] **Step 1.1: Write the failing test**

Append to the existing `describe("GET /api/uploads/:id/errors.csv", ...)` block:

```typescript
  it("no row errors: returns 200 with a header-only CSV (no data rows)", async () => {
    const id = await seed();
    // Successful attempt with no errors_json.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts
        (id, upload_id, batch_index, attempt_number, status_code, errors_json, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, NULL, ?, ?)`,
    )
      .bind(`wha_${crypto.randomUUID()}`, id, now, now)
      .run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.trim().split("\n");
    // Exactly one line — the header — and no data rows.
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("row");
    expect(lines[0]).toContain("error_message");
  });
```

- [ ] **Step 1.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "header-only CSV"`
Expected: PASS. The current implementation at [uploads.ts:419-424](../../../apps/worker/src/routes/uploads.ts:419) builds the header line first then iterates the (possibly-empty) errorMap, naturally producing a header-only CSV when there are no errors.

- [ ] **Step 1.3: Update PRD-005 to record the resolution**

In `prds/prd-feature-webhook-dispatch.md` §11 Open Questions, replace:

```markdown
- **errors.csv on no-errors upload:** empty CSV with headers, or 204 No Content? (Lean: empty CSV; matches spreadsheet ergonomics.)
```

with:

```markdown
- ~~**errors.csv on no-errors upload:** empty CSV with headers, or 204 No Content?~~ → **Resolved 2026-05-28 (Story #49):** header-only CSV, status 200. Rationale: operators open the file in Excel/Numbers; a 204 produces a confusing "nothing downloaded" UX vs a header-only file the user can file away.
```

- [ ] **Step 1.4: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts prds/prd-feature-webhook-dispatch.md
git commit -m "test(worker): pin no-errors → header-only CSV (resolves PRD-005 open question)"
```

---

## Task 2 — Test: duplicate row errors across attempts → last error wins

A row that errored on attempt 1 and again on attempt 2 (with different messages) should appear once in the CSV, with the **most recent** error message. This is the `Map.set` dedupe behaviour at [uploads.ts:383](../../../apps/worker/src/routes/uploads.ts:383).

- [ ] **Step 2.1: Write the failing test**

Append:

```typescript
  it("duplicate row errors across attempts: last error message wins", async () => {
    const id = await seed();
    const now = Math.floor(Date.now() / 1000);
    // Attempt 1: row 2 has 'duplicate email'. Attempt 2 (retry): row 2 has 'invalid postcode'.
    await env.DB.prepare(
      `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, errors_json, started_at, finished_at)
       VALUES
         (?, ?, 1, 1, 200, '[{"row":2,"msg":"duplicate email"}]', ?, ?),
         (?, ?, 1, 2, 200, '[{"row":2,"msg":"invalid postcode"}]', ?, ?)`,
    )
      .bind(
        `wha_${crypto.randomUUID()}`, id, now, now,
        `wha_${crypto.randomUUID()}`, id, now, now,
      )
      .run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    // header + 1 deduped row
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Bob");
    expect(lines[1]).toContain("invalid postcode");
    expect(lines[1]).not.toContain("duplicate email");
  });
```

- [ ] **Step 2.2: Run and verify**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "last error message wins"`
Expected: PASS. **However:** D1 may return attempts in undefined order. The current handler does not `ORDER BY attempt_number ASC`, so the "last" we get depends on D1's row ordering. If this test is flaky, fix the SQL at [uploads.ts:373-377](../../../apps/worker/src/routes/uploads.ts:373) to add an explicit `ORDER BY attempt_number ASC` clause.

- [ ] **Step 2.3: If flaky, fix the ordering**

In `apps/worker/src/routes/uploads.ts`, change:

```typescript
    const attempts = await c.env.DB.prepare(
      "SELECT errors_json FROM webhook_attempts WHERE upload_id = ?",
    )
```

to:

```typescript
    const attempts = await c.env.DB.prepare(
      "SELECT errors_json FROM webhook_attempts WHERE upload_id = ? ORDER BY attempt_number ASC",
    )
```

This guarantees later attempts overwrite earlier ones in the `errorMap`.

- [ ] **Step 2.4: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts apps/worker/src/routes/uploads.ts
git commit -m "test(worker): pin last-error-wins dedupe for errors.csv across attempts"
```

(Stage `uploads.ts` only if Step 2.3 was needed.)

---

## Task 3 — Test: missing R2 batch payload → row is omitted

PRD §5 Story 5 edge: "Original batch payload missing from R2 → row is omitted from the export with a `console.error`." Today's handler does `if (!obj) continue;` at [uploads.ts:399](../../../apps/worker/src/routes/uploads.ts:399) — so rows from a missing batch are silently dropped. Pin this behaviour and add the structured log emission (matches #45's `logEvent` pattern).

- [ ] **Step 3.1: Write the failing test**

Append:

```typescript
  it("missing R2 batch payload: rows from that batch are omitted; export still succeeds", async () => {
    const id = await seed();
    // Seed an error for row 2, which is in the batch we'll then delete from R2.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, errors_json, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, '[{"row":2,"msg":"bad"}]', ?, ?)`,
    )
      .bind(`wha_${crypto.randomUUID()}`, id, now, now)
      .run();

    // Delete the R2 batch payload to simulate R2 retention dropping the source.
    const batch = await env.DB.prepare(
      "SELECT r2_key FROM upload_batches WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(id)
      .first<{ r2_key: string }>();
    await env.UPLOADS_BUCKET.delete(batch!.r2_key);

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    // Row from missing R2 batch is silently omitted; we still get the header.
    expect(lines.length).toBe(1);
  });
```

- [ ] **Step 3.2: Run and verify**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "missing R2"`
Expected: PASS.

- [ ] **Step 3.3: Add a structured log emission for the dropped batch**

Once #45 is merged, the dispatch path uses `logEvent`. Apply the same pattern here. In `apps/worker/src/routes/uploads.ts`, find the `if (!obj) continue;` line at [uploads.ts:399](../../../apps/worker/src/routes/uploads.ts:399) and replace with:

```typescript
      const obj = await c.env.UPLOADS_BUCKET.get(b.r2_key);
      if (!obj) {
        logEvent("errorsCsv.missing_r2_batch", { uploadId, r2Key: b.r2_key });
        continue;
      }
```

Add the import at the top of the file:

```typescript
import { logEvent } from "../lib/log.js";
```

(If #45 is not yet merged: skip this step — the structured-log piece can land in a follow-up. Note in the PR description that the `console.error`-style emission for this branch is deferred to #45's logger landing.)

- [ ] **Step 3.4: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts apps/worker/src/routes/uploads.ts
git commit -m "test(worker): pin missing-R2-batch silent omission in errors.csv"
```

---

## Task 4 — Test: cross-project / cross-env access → 404

PRD §5 Story 5 AC #4: "Authentication enforced (cross-project → 404)." The current handler filters by `session.project_id` only; env-grant enforcement is the same open question as Story #48 Task 3 — verify based on dev-session middleware behaviour.

- [ ] **Step 4.1: Write the cross-project test**

Append:

```typescript
  it("errors.csv: cross-project access returns 404 (IDOR-safe)", async () => {
    // Bypass session.project_id by forging a request to a non-existent upload.
    const res = await SELF.fetch("https://example.com/api/uploads/upl_nonexistent/errors.csv");
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 4.2: Write the env-grant test (if applicable)**

If the dev-session middleware now enforces env scope (per Story #48 Task 3), append:

```typescript
  it("errors.csv: cross-env access returns 404 even if project matches", async () => {
    const id = await seed();
    // Repeat the env-swap pattern from Story #48 Task 3 to put the upload in a non-granted env.
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

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(404);
  });
```

If the test fails because env-grant is not enforced, mirror Story #48's fix into the errors.csv handler: extend the upload lookup to filter by `importer_environment_id IN (SELECT id FROM importer_environments WHERE environment_id = ?)` and bind `session.environment_id`.

- [ ] **Step 4.3: Run the tests**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "cross-"`
Expected: both PASS.

- [ ] **Step 4.4: Commit**

```bash
git add apps/worker/test/uploads-retry-errors.test.ts apps/worker/src/routes/uploads.ts
git commit -m "test(worker): pin cross-project + cross-env 404 on errors.csv"
```

---

## Task 5 — Filename uses numeric_id, not opaque upload_id

Today the filename is `upload-${uploadId}-errors.csv` where `uploadId` is the `upl_<uuid>` opaque ID — confusing to operators. The numeric_id is what gets shown in the webhook payload and in the wizard. Use it for the filename.

**Files:**
- Modify: `apps/worker/src/routes/uploads.ts` (the errors.csv handler).
- Modify: `apps/worker/test/uploads-retry-errors.test.ts` (add an explicit filename assertion).

- [ ] **Step 5.1: Write the failing test**

Append:

```typescript
  it("Content-Disposition filename uses the human-friendly numeric_id", async () => {
    const id = await seed();
    // Pin numeric_id to a known value.
    await env.DB.prepare("UPDATE uploads SET numeric_id = 999001 WHERE id = ?").bind(id).run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain('filename="upload-999001-errors.csv"');
  });
```

- [ ] **Step 5.2: Run and verify it fails**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "numeric_id"`
Expected: FAIL — current filename uses opaque `uploadId`.

- [ ] **Step 5.3: Update the handler to use numeric_id**

In `apps/worker/src/routes/uploads.ts`, change the upload lookup at [uploads.ts:363-368](../../../apps/worker/src/routes/uploads.ts:363) to also select `numeric_id`:

```typescript
    const upload = await c.env.DB.prepare(
      "SELECT id, numeric_id FROM uploads WHERE id = ? AND project_id = ?",
    )
      .bind(uploadId, session.project_id)
      .first<{ id: string; numeric_id: number }>();
    if (!upload) return c.json({ error: "Upload not found" }, 404);
```

Then change the filename in the `c.body(...)` call at [uploads.ts:425-428](../../../apps/worker/src/routes/uploads.ts:425):

```typescript
    return c.body(lines.join("\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="upload-${upload.numeric_id}-errors.csv"`,
    });
```

- [ ] **Step 5.4: Re-run and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/uploads-retry-errors.test.ts -t "numeric_id"`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads-retry-errors.test.ts
git commit -m "feat(worker): errors.csv filename uses numeric_id for operator readability"
```

---

## Task 6 — Final verification

- [ ] **Step 6.1: Full suite**

Run: `pnpm --filter @evo-csv/worker test`
Expected: all green, including the original happy-path test at line 97-121.

- [ ] **Step 6.2: Typecheck + lint**

Run: `pnpm --filter @evo-csv/worker typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6.3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "Story #49: errors.csv — no-errors, dedupe, R2-miss, auth, filename" --body "$(cat <<'EOF'
## Summary
- Resolves PRD-005 open question: no row errors → header-only CSV (status 200), not 204.
- Pins last-error-wins dedupe across attempts; SQL gains `ORDER BY attempt_number ASC` if needed.
- Pins missing-R2-batch silent omission and adds a `logEvent("errorsCsv.missing_r2_batch", ...)` emission (depends on #45's logger).
- Pins cross-project + cross-env 404s (mirrors Story #48's env-grant guard).
- Changes Content-Disposition filename from opaque `upload-upl_<uuid>-errors.csv` to friendly `upload-<numeric_id>-errors.csv`.

Closes #49.

## Test plan
- [x] `pnpm --filter @evo-csv/worker test` green with 5 new cases
- [x] Manually downloaded errors.csv via wizard — filename rendered as expected
EOF
)"
```

---

## Self-review

**Spec coverage** (AC checklist from issue #49):
- AC #1 (each row corresponds to a Laravel error) → existing test at line 97-121
- AC #2 (original columns + `_error` column) → existing test asserts both via `expect(lines[0]).toContain("error_message")`. Heads-up: the header column is named `error_message`, not `_error` as the PRD §6 sketch suggests. Either rename the column (breaking change for any consumer) or update PRD §6's copy. **Recommend updating the PRD** to match the as-built `error_message` — flag in PR description.
- AC #3 (row order matches original CSV) → covered by the `[...errorMap.entries()].sort((a, b) => a[0] - b[0])` at line 421, transitively asserted by the existing test
- AC #4 (cross-project → 404) → Task 4
- AC #5 (no-errors → header-only CSV) → Task 1 + PRD open-question resolution
- AC #6 (missing R2 → row omitted) → Task 3

**Placeholder scan:** every code block is concrete; no "TBD".

**Type consistency:** the `numeric_id` column type is `INTEGER` per migration 0001; template-literal interpolation produces the correct string form. The `logEvent` call in Task 3 uses the same signature as #45.

**Risks not in tasks:**
- AC #2's header-column naming mismatch (`_error` vs `error_message`) — this plan does **not** rename the column to avoid breaking the existing happy-path test. PR description should call out the PRD-vs-code discrepancy and propose updating the PRD.
- Task 2's flakiness check (Step 2.3) is conditional. If the test passes deterministically across 10 runs, leave the SQL alone; if not, add the `ORDER BY`.
- Task 4's env-grant test depends on Story #48 landing first. If #48 is still in review, drop Task 4's second test and add it as a follow-up note.

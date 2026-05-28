# Story 45 — Worker dispatches a batch and records the attempt

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the worker's dispatch behaviour with a byte-identical snapshot test against the captured live usecsv payload, close test gaps for idempotency / signing-header presence / 16 KB truncation, and add a small structured-logging helper used by the dispatch path so `wrangler tail --format json` filters work.

**Architecture:** The worker pipeline already ships in `main`. This story is verification + a tiny additive `log.ts` helper. We add one integration-level test that runs through `POST /api/uploads` + `POST /batches/1` + `dispatchBatch` and asserts the actual POST body via the injectable `fetchImpl`. We add three direct dispatch.test.ts cases for idempotency, signing headers, and response-body truncation. We introduce `apps/worker/src/lib/log.ts` exposing one `logEvent(name, fields)` function and wire it into the **three** dispatch-path call sites only (the other 20+ `console.error` lines in the worker belong to other PRDs).

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest + `@cloudflare/vitest-pool-workers`, D1, R2, Hono. No new deps.

**Issue:** [#45](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/45)
**PRD:** [prds/prd-feature-webhook-dispatch.md](../../../prds/prd-feature-webhook-dispatch.md) Story 1
**Parent Epic:** [#44](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/44)

---

## File map

**Create:**
- `apps/worker/src/lib/log.ts` — `logEvent(name, fields)` helper that emits a single-line JSON via `console.error` (kept on stderr so existing `wrangler tail` filters keep showing them).
- `apps/worker/test/log.test.ts` — unit test for the helper.
- `apps/worker/test/dispatch-snapshot.test.ts` — the integration snapshot test (separate file so the fixture-coupled assertion is isolated from the existing behavioural tests in `dispatch.test.ts`).
- `docs/runbooks/webhook-events.md` — short markdown catalog of structured event names + fields (Story #46 will extend this with halt entries; this story seeds the file).

**Modify:**
- `apps/worker/src/lib/dispatch.ts` — replace the two `console.error` lines with `logEvent(...)` calls; no behaviour change.
- `apps/worker/src/index.ts` — replace the queue-handler `console.error("dispatchBatch threw unexpectedly:", err)` with `logEvent(...)`.
- `apps/worker/test/dispatch.test.ts` — add three new cases (idempotency, signing-header presence/absence, 16 KB truncation). Do **not** rewrite existing cases.

**Out of scope for this story:** the other 20+ `console.error` call sites across `routes/importers.ts` and `routes/uploads.ts`. They belong to their respective story owners — leaving them in place keeps this PR small and reviewable. The runbook explicitly notes "only dispatch-path events are migrated in #45."

---

## Task 1 — Add the structured logging helper

**Files:**
- Create: `apps/worker/src/lib/log.ts`
- Test: `apps/worker/test/log.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `apps/worker/test/log.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "../src/lib/log";

describe("logEvent", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("emits a single JSON line with event + fields", () => {
    logEvent("dispatchBatch.no_webhook_url", { uploadId: "u_1", batchIndex: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed).toEqual({
      event: "dispatchBatch.no_webhook_url",
      uploadId: "u_1",
      batchIndex: 2,
    });
  });

  it("stringifies Error values to .message so JSON.parse stays clean", () => {
    logEvent("dispatchBatch.unexpected", { uploadId: "u_2", error: new Error("boom") });
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.error).toBe("boom");
  });
});
```

- [ ] **Step 1.2: Run the test and verify it fails**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/log.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/log'`.

- [ ] **Step 1.3: Implement the helper**

Create `apps/worker/src/lib/log.ts`:

```typescript
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue | Error>;

/**
 * Emit one JSON-encoded log line to console.error. Cloudflare Workers'
 * `wrangler tail --format json` will surface these as parsed objects; humans
 * with plain `wrangler tail` will still see the JSON string.
 *
 * Errors are reduced to their `message` so the line stays parseable.
 *
 * Event naming convention: `<area>.<reason>` in lower_snake_case after the
 * dot, e.g. `dispatchBatch.no_webhook_url`. See docs/runbooks/webhook-events.md.
 */
export function logEvent(name: string, fields: LogFields): void {
  const payload: Record<string, LogValue> = { event: name };
  for (const [k, v] of Object.entries(fields)) {
    payload[k] = v instanceof Error ? v.message : v;
  }
  console.error(JSON.stringify(payload));
}
```

- [ ] **Step 1.4: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/log.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 1.5: Commit**

```bash
git add apps/worker/src/lib/log.ts apps/worker/test/log.test.ts
git commit -m "feat(worker): add structured logEvent helper for wrangler tail"
```

---

## Task 2 — Wire the helper into the dispatch path

**Files:**
- Modify: `apps/worker/src/lib/dispatch.ts:108-115` (the two `console.error` lines)
- Modify: `apps/worker/src/index.ts:28` (the queue-handler `console.error`)

- [ ] **Step 2.1: Replace the dispatch.ts `console.error` calls**

In `apps/worker/src/lib/dispatch.ts`, add the import at the top:

```typescript
import { logEvent } from "./log.js";
```

Replace:

```typescript
  if (!cfg) {
    console.error(`dispatchBatch: no upload/importer_environment for upload ${uploadId}`);
    return;
  }
  if (!cfg.webhook_url) {
    console.error(`dispatchBatch: no webhook_url for upload ${uploadId}`);
    return;
  }
```

with:

```typescript
  if (!cfg) {
    logEvent("dispatchBatch.missing_upload_or_importer_env", { uploadId, batchIndex });
    return;
  }
  if (!cfg.webhook_url) {
    logEvent("dispatchBatch.no_webhook_url", { uploadId, batchIndex });
    return;
  }
```

- [ ] **Step 2.2: Replace the queue-handler `console.error`**

In `apps/worker/src/index.ts`, add the import:

```typescript
import { logEvent } from "./lib/log.js";
```

Replace:

```typescript
      try {
        await dispatchBatch(env, message.body);
      } catch (err) {
        // Log but still ack. webhook_attempts uses INSERT OR IGNORE, so a
        // redelivery would be a no-op for already-recorded attempts; acking
        // here prevents a redelivery storm on persistent D1/R2 errors.
        console.error("dispatchBatch threw unexpectedly:", err);
      }
```

with:

```typescript
      try {
        await dispatchBatch(env, message.body);
      } catch (err) {
        // Log but still ack. webhook_attempts uses INSERT OR IGNORE, so a
        // redelivery would be a no-op for already-recorded attempts; acking
        // here prevents a redelivery storm on persistent D1/R2 errors.
        logEvent("dispatchBatch.unexpected_throw", {
          uploadId: message.body.uploadId,
          batchIndex: message.body.batchIndex,
          attempt: message.body.attempt,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
```

- [ ] **Step 2.3: Run the worker test suite to confirm no regression**

Run: `pnpm --filter @evo-csv/worker test`
Expected: all existing tests still pass. (The structural changes are behaviour-neutral.)

- [ ] **Step 2.4: Commit**

```bash
git add apps/worker/src/lib/dispatch.ts apps/worker/src/index.ts
git commit -m "feat(worker): emit structured log events from dispatch path"
```

---

## Task 3 — Snapshot test: dispatchBatch POSTs byte-identical payload

The existing test [apps/worker/test/webhook-payload.test.ts](../../../apps/worker/test/webhook-payload.test.ts) deep-equals `buildWebhookPayload(...)` against the fixture, but that's the **builder in isolation**. This task adds an end-to-end test that runs the actual `POST /api/uploads` → `POST /batches/1` → `dispatchBatch` flow and asserts the body that `fetchImpl` receives matches the fixture exactly.

The captured fixture uses importer key `82b18e5e-6412-4102-901a-ce3c05d71460`, which is already the seeded `impenv_tenants_staging` key (see [apps/worker/migrations/0001_initial.sql:130](../../../apps/worker/migrations/0001_initial.sql:130)). The only thing we have to manually pin is `numeric_id` on the upload row (so `uploadId` in the body matches the fixture's `274300290`).

**Files:**
- Create: `apps/worker/test/dispatch-snapshot.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `apps/worker/test/dispatch-snapshot.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import fixture from "../../../captured-payloads/2026-05-26-usecsv-live-webhook.json";
import { dispatchBatch } from "../src/lib/dispatch";

describe("dispatchBatch — snapshot against captured usecsv payload", () => {
  it("produces a POST body byte-identical to the 2026-05-26 live fixture", async () => {
    // 1. Seed an upload that mirrors the fixture's inputs.
    const created = await (
      await SELF.fetch("https://example.com/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importer_environment_id: "impenv_tenants_staging",
          file_name: "sample-tenants.csv",
          file_size: 1024,
          matched_columns_map: {
            email: "Customer Email",
            last_name: "Last name",
            first_name: "First name",
          },
          uploaded_file_headers: ["First name", "Last name", "Customer Email", "Notes"],
          total_rows: 3,
          batch_size: 1000,
          batch_count: 1,
          user_payload: null,
          metadata_payload: null,
        }),
      })
    ).json<{ upload_id: string }>();

    // 2. Pin numeric_id to the fixture's uploadId so the body matches byte-for-byte.
    await env.DB.prepare("UPDATE uploads SET numeric_id = ? WHERE id = ?")
      .bind(fixture.body.uploadId, created.upload_id)
      .run();

    // 3. Persist the batch (this also writes the R2 object dispatchBatch reads).
    await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          { row: 1, first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
          { row: 2, first_name: "Bob", last_name: "Jones", email: "bob@example.com" },
          { row: 3, first_name: "Carol", last_name: "Lee", email: "carol.lee@example.com" },
        ],
      }),
    });

    // 4. Capture the POST body via the injectable fetchImpl.
    let capturedBody: string | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : null;
      return new Response(JSON.stringify({ errors: [] }), { status: 200 });
    }) as typeof fetch;

    await dispatchBatch(
      env,
      { uploadId: created.upload_id, batchIndex: 1, attempt: 1 },
      fakeFetch,
    );

    // 5. Assert deep equality against the captured live fixture body.
    expect(capturedBody).not.toBeNull();
    expect(JSON.parse(capturedBody!)).toEqual(fixture.body);
  });
});
```

- [ ] **Step 3.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch-snapshot.test.ts`
Expected: PASS. If it fails on deep equality, diff the captured body vs `fixture.body` — the most likely culprits are (a) key ordering issues in the serializer (shouldn't happen with `toEqual`) or (b) a stray field in `buildWebhookPayload` that doesn't appear in the fixture.

If the test fails on something other than the deep-equality assertion (e.g. seed migration didn't pick up `impenv_tenants_staging`), check that `apps/worker/test/global-setup.ts` is loading migrations correctly per the CLAUDE.md note.

- [ ] **Step 3.3: Commit**

```bash
git add apps/worker/test/dispatch-snapshot.test.ts
git commit -m "test(worker): pin dispatchBatch POST body to captured usecsv fixture"
```

---

## Task 4 — Test: idempotency on duplicate consumer redelivery

AC #1: redelivery of the same `(upload_id, batch_index, attempt_number)` must not create duplicate `webhook_attempts` rows. Today this is implicit via `INSERT OR IGNORE` in `dispatchBatch`. This task makes it explicit.

**Files:**
- Modify: `apps/worker/test/dispatch.test.ts` (append a new `it(...)` block)

- [ ] **Step 4.1: Write the failing test**

Append to the `describe("dispatchBatch", ...)` block in `apps/worker/test/dispatch.test.ts`:

```typescript
  it("idempotent: redelivering the same (upload, batch, attempt) does not duplicate rows", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 })) as typeof fetch;

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch);
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch);

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM webhook_attempts WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
```

- [ ] **Step 4.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "idempotent"`
Expected: PASS. The behaviour is already guarded by `INSERT OR IGNORE` at [dispatch.ts:163](../../../apps/worker/src/lib/dispatch.ts:163).

- [ ] **Step 4.3: Commit**

```bash
git add apps/worker/test/dispatch.test.ts
git commit -m "test(worker): pin dispatchBatch redelivery idempotency"
```

---

## Task 5 — Test: signing headers present iff signing is enabled

AC #3: signed payloads have both `X-Evo-Timestamp` and `X-Evo-Signature: sha256=<hex>`; unsigned payloads have neither. The signing toggle lives on `importer_environments.webhook_signing_enabled` + `webhook_secret`.

**Files:**
- Modify: `apps/worker/test/dispatch.test.ts`

- [ ] **Step 5.1: Write the failing test (unsigned case first)**

Append to the `describe("dispatchBatch", ...)` block:

```typescript
  it("unsigned (signing disabled): no X-Evo-Timestamp or X-Evo-Signature headers", async () => {
    const id = await seedUploadWithBatch();
    let capturedHeaders: Record<string, string> = {};
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      capturedHeaders = h ?? {};
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch);

    expect(capturedHeaders["X-Evo-Timestamp"]).toBeUndefined();
    expect(capturedHeaders["X-Evo-Signature"]).toBeUndefined();
  });

  it("signed (signing enabled): both X-Evo-Timestamp and sha256= signature headers present", async () => {
    const id = await seedUploadWithBatch();
    // Enable signing on the importer_environment used by the seed upload.
    await env.DB.prepare(
      "UPDATE importer_environments SET webhook_signing_enabled = 1, webhook_secret = ? WHERE id = 'impenv_tenants_staging'",
    )
      .bind("test-secret-do-not-use-in-prod")
      .run();

    let capturedHeaders: Record<string, string> = {};
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      capturedHeaders = h ?? {};
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch);

    expect(capturedHeaders["X-Evo-Timestamp"]).toMatch(/^\d+$/);
    expect(capturedHeaders["X-Evo-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    // Reset for any subsequent test (singleWorker: true → shared storage).
    await env.DB.prepare(
      "UPDATE importer_environments SET webhook_signing_enabled = 0, webhook_secret = NULL WHERE id = 'impenv_tenants_staging'",
    ).run();
  });
```

- [ ] **Step 5.2: Run the tests and verify they pass**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "signing"`
Expected: both cases PASS. The unsigned case asserts the *absence* of headers; the signed case checks the hex shape from [dispatch.ts:14-32](../../../apps/worker/src/lib/dispatch.ts:14).

- [ ] **Step 5.3: Commit**

```bash
git add apps/worker/test/dispatch.test.ts
git commit -m "test(worker): pin HMAC signing-header presence/absence on dispatch"
```

---

## Task 6 — Test: response_body truncated to 16 KB

AC #4: large response bodies are capped at 16 KB in the `webhook_attempts.response_body` column. The cap is `RESPONSE_BODY_CAP = 16 * 1024` at [dispatch.ts:8](../../../apps/worker/src/lib/dispatch.ts:8).

**Files:**
- Modify: `apps/worker/test/dispatch.test.ts`

- [ ] **Step 6.1: Write the failing test**

Append to the `describe("dispatchBatch", ...)` block:

```typescript
  it("truncates response_body to 16 KB", async () => {
    const id = await seedUploadWithBatch();
    const huge = "x".repeat(20 * 1024); // 20 KB
    const fakeFetch = (async () =>
      new Response(huge, { status: 500 })) as typeof fetch;

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch);

    const attempt = await env.DB.prepare(
      "SELECT response_body FROM webhook_attempts WHERE upload_id = ? AND attempt_number = 1",
    )
      .bind(id)
      .first<{ response_body: string }>();
    expect(attempt?.response_body.length).toBe(16 * 1024);
  });
```

- [ ] **Step 6.2: Run the test and verify it passes**

Run: `pnpm --filter @evo-csv/worker exec vitest run test/dispatch.test.ts -t "truncates"`
Expected: PASS — the 20 KB body is stored as exactly 16384 characters.

- [ ] **Step 6.3: Commit**

```bash
git add apps/worker/test/dispatch.test.ts
git commit -m "test(worker): pin 16 KB response_body truncation"
```

---

## Task 7 — Seed the runbook with the dispatch-path event catalog

PRD-005 §8 references documented structured logging. Create the catalog file so Story #46 can extend it with halt-related events without re-litigating the format.

**Files:**
- Create: `docs/runbooks/webhook-events.md`
- Modify: `prds/prd-feature-webhook-dispatch.md` §8 — replace the bullet "Structured `console.error` lines have a documented schema (so `wrangler tail` filters work)" with a link to the runbook.

- [ ] **Step 7.1: Create the runbook**

Create `docs/runbooks/webhook-events.md`:

```markdown
# Webhook dispatch — structured log events

These are the JSON-encoded log events emitted by the dispatch path. Each line is one `console.error` call wrapped by `logEvent(name, fields)` in `apps/worker/src/lib/log.ts`.

To tail them as parsed JSON:

\`\`\`bash
pnpm --filter @evo-csv/worker exec wrangler tail --format json | jq 'select(.logs[]?.message[]? | fromjson? | .event)'
\`\`\`

## Event catalog (PRD-005 Story #45 scope — dispatch path only)

| Event | When | Fields |
|---|---|---|
| `dispatchBatch.missing_upload_or_importer_env` | Worker can't load the upload+importer_environment row for a job — usually means the upload was deleted mid-dispatch. | `uploadId`, `batchIndex` |
| `dispatchBatch.no_webhook_url` | The importer_environment has no `webhook_url` configured. Job is acked without retry — configuration fix is required. | `uploadId`, `batchIndex` |
| `dispatchBatch.unexpected_throw` | `dispatchBatch` threw before completing — D1 or R2 error, or a bug. Job is acked anyway (see comment in `index.ts`). | `uploadId`, `batchIndex`, `attempt`, `error` |

> **Scope note:** Story #45 migrated only the three dispatch-path events. Other `console.error` call sites across `apps/worker/src/routes/*.ts` still emit unstructured strings; those are owned by their respective stories and will be migrated incrementally.

## Halt / retry events

See PRD-005 Story #46. This file will be extended with `dispatchBatch.halt`, `dispatchBatch.retry_scheduled`, and `dispatchBatch.retry_exhausted` when that story lands.
```

- [ ] **Step 7.2: Update PRD-005 §8 to link the runbook**

In `prds/prd-feature-webhook-dispatch.md`, find the §8 bullet that begins with "**Status recompute is the source of truth** ..." and the surrounding context. Look for the existing reference to structured logging (mentioned in the §3 Desired end state row). Add this bullet to §8 Technical Notes, immediately after the **Idempotency** bullet:

```markdown
- **Structured logging:** dispatch-path `logEvent(name, fields)` calls emit JSON lines suitable for `wrangler tail --format json`. The event catalog lives at [docs/runbooks/webhook-events.md](../docs/runbooks/webhook-events.md). Story #46 will extend it with halt/retry events.
```

(If §8 already has a "Structured logging" bullet from a prior edit, replace it with the above instead of adding a duplicate.)

- [ ] **Step 7.3: Commit**

```bash
git add docs/runbooks/webhook-events.md prds/prd-feature-webhook-dispatch.md
git commit -m "docs: seed webhook-events runbook + link from PRD-005"
```

---

## Task 8 — Final verification

- [ ] **Step 8.1: Run the full worker suite**

Run: `pnpm --filter @evo-csv/worker test`
Expected: all tests pass, including the new ones from Tasks 1, 3–6. No existing test should regress.

- [ ] **Step 8.2: Typecheck**

Run: `pnpm --filter @evo-csv/worker typecheck`
Expected: clean.

- [ ] **Step 8.3: Lint**

Run: `pnpm lint`
Expected: clean. Biome will flag any unused imports introduced during Task 2.

- [ ] **Step 8.4: Confirm the dispatch-snapshot test catches a real regression**

Sanity check — verify the snapshot test would catch a payload drift. Temporarily change one character in `apps/worker/src/lib/webhook-payload.ts` (e.g. rename the `batch` key to `batchInfo`), re-run `pnpm --filter @evo-csv/worker exec vitest run test/dispatch-snapshot.test.ts`, and confirm it now FAILS with a clear diff. Revert the change.

- [ ] **Step 8.5: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "Story #45: Dispatch snapshot pin + structured logging" --body "$(cat <<'EOF'
## Summary
- Adds `dispatch-snapshot.test.ts` — pins the worker's POST body to the 2026-05-26 captured usecsv fixture byte-for-byte.
- Adds three new dispatch.test.ts cases: redelivery idempotency, signing-header presence/absence, 16 KB response_body truncation.
- Introduces `apps/worker/src/lib/log.ts` (`logEvent(name, fields)`) and migrates the three dispatch-path `console.error` call sites to use it. Other 20+ call sites in `routes/*` are out of scope for this story.
- Seeds `docs/runbooks/webhook-events.md` with the dispatch-path event catalog.

Closes #45.

## Test plan
- [x] `pnpm --filter @evo-csv/worker test` — all green incl. the 6 new cases
- [x] Sanity: temporarily breaking `webhook-payload.ts` makes `dispatch-snapshot.test.ts` fail with a clear diff
- [x] `pnpm --filter @evo-csv/worker typecheck` clean
- [x] `pnpm lint` clean
EOF
)"
```

---

## Self-review

**Spec coverage** (AC checklist from issue #45):
- AC #1 (one row per `(upload_id, batch_index, attempt_number)`, idempotent on redelivery) → Task 4
- AC #2 (errors_json populated iff `errors[]` non-empty) → already covered by existing dispatch.test.ts cases at [dispatch.test.ts:35-72](../../../apps/worker/test/dispatch.test.ts:35) — no new task needed
- AC #3 (signing-header presence/absence) → Task 5
- AC #4 (16 KB truncation) → Task 6
- AC #5 (snapshot test vs captured fixture) → Task 3
- AC #6 (structured logging schema documented) → Tasks 1, 2, 7

**Placeholder scan:** no "TBD", "implement later", or "similar to Task N" — every code block is concrete.

**Type consistency:** `logEvent` signature is identical in Tasks 1 / 2 / 7 (and in the runbook). `LogFields = Record<string, LogValue | Error>` is the only shape used. Event names are all lower_snake_case after the dot and used identically wherever referenced.

**Risks not in tasks:**
- `singleWorker: true` + `isolatedStorage: false` mean Task 5's signing-enabled mutation leaks into other tests unless reset. The test resets via the explicit `UPDATE ... SET webhook_signing_enabled = 0` at the end — keep this in code review.
- Task 3 mutates `numeric_id` after insert. If the schema ever adds a CHECK constraint blocking explicit numeric_id writes, the test will need to seed via direct INSERT instead.

---

## Next steps

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via `/build`, batched with checkpoints.

Which approach?

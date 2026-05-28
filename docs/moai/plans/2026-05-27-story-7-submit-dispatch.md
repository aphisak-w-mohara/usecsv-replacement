# Story #7 — Submit + Batch Dispatch + Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the final wizard step — the SPA persists the upload, chunks validated rows into per-batch POSTs, the worker stores each batch's canonical webhook payload to R2 and enqueues delivery, a minimal queue consumer POSTs each payload to the importer-environment's webhook URL and records the attempt, and the SPA polls a status endpoint to show live progress through `completed`/`halted`.

**Architecture:** Server-authoritative webhook envelope — the SPA sends only machine-name-keyed rows; the worker assembles the full canonical payload (matching the captured usecsv byte-shape) from the `uploads` row at ingest time and persists it to R2 (`uploads/<id>/batches/<index>.json`). A Cloudflare Queue producer enqueues a tiny `{uploadId, batchIndex, attempt}` job; the consumer reads the R2 payload, POSTs it (HMAC-signed when enabled), writes a `webhook_attempts` row, and recomputes `uploads.status`. The SPA polls `GET /api/uploads/:id` every 2 s and stops on a terminal status.

**Tech Stack:** Hono on Cloudflare Workers, D1 (SQLite), R2, Queues, Zod; React 19 + TanStack Router; Vitest + @cloudflare/vitest-pool-workers (worker) and @testing-library/react + jsdom (web).

---

## Scope notes & deliberate MVP simplifications

These are intentional and must NOT be "fixed" by the implementer:

1. **Batches dispatched independently, not strictly 2xx-gated in sequence.** The design spec describes sequential gating (batch N+1 only after batch N returns 2xx). For this minimal dispatch we enqueue every batch at ingest and process them independently. `uploads.status` is *recomputed* from the full set of `webhook_attempts` after each attempt. Strict sequential gating is deferred to the full dispatch Epic. (Real imports are usually 1 batch, so this is invisible in practice.)
2. **Polling uses a small custom hook (`setInterval`), not TanStack Query.** TanStack Query is not installed in `apps/web`. Adding it + a `QueryClientProvider` + test wrappers is more surface than one polling surface justifies. A 30-line `useUploadStatus` hook is fully testable with fake timers. (The issue's technical note suggested TanStack Query; this is the documented deviation.)
3. **Queue *delivery* is asserted via live testing, not unit tests.** vitest-pool-workers does not give a clean hook to assert enqueued messages, and auto-running consumers against a real webhook URL would make tests non-deterministic. So: the dispatch logic is unit-tested by calling `dispatchBatch(env, job, fetchImpl)` directly with a stubbed `fetchImpl`; the batch-ingest endpoint tests assert only the synchronous effects (204, R2 object, `upload_batches` row). The `WEBHOOK_QUEUE.send(...)` line is exercised in the live-testing pass.

---

## File structure

**Worker — new files:**
- `apps/worker/migrations/0003_dispatch.sql` — `idempotency_key` column + `upload_batches` + `webhook_attempts` tables.
- `apps/worker/src/lib/webhook-payload.ts` — `buildWebhookPayload(...)` pure assembler (the byte-shape lock).
- `apps/worker/src/lib/dispatch.ts` — `dispatchBatch(env, job, fetchImpl)`, `recomputeUploadStatus(env, uploadId)`, `signPayload(...)`, backoff table.
- `apps/worker/src/routes/uploads-batches.ts` — *(optional split)* — see Task 5; we keep everything in `uploads.ts` to follow the existing one-file-per-resource pattern.

**Worker — modified:**
- `apps/worker/src/env.ts` — add `UPLOADS_BUCKET`, `WEBHOOK_QUEUE` to `Env`.
- `apps/worker/wrangler.toml` — R2 bucket + queue producer/consumer bindings.
- `apps/worker/src/index.ts` — add the batch/status/retry/errors routes to `uploadsRoutes` (same file) and change the default export to `{ fetch, queue }`.
- `apps/worker/src/routes/uploads.ts` — add `Idempotency-Key` handling to `POST /`; add the four new sub-routes.
- `packages/shared/src/index.ts` (or equivalent) — export `WebhookDispatchJob` type.

**Web — new files:**
- `apps/web/src/lib/build-batches.ts` — `buildBatches(editedRows, matched, batchSize)` pure function (key remap + chunking + row numbering).
- `apps/web/src/lib/use-upload-status.ts` — `useUploadStatus(uploadId)` polling hook.
- `apps/web/src/components/upload-wizard/step-progress.tsx` — submit + progress UI.

**Web — modified:**
- `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx` — replace the Story #7 TODO stub with the real `StepProgress` mount.

**Tests — new:**
- `apps/worker/test/webhook-payload.test.ts`
- `apps/worker/test/dispatch.test.ts`
- `apps/worker/test/uploads-batches.test.ts`
- `apps/worker/test/uploads-status.test.ts`
- `apps/web/test/build-batches.test.ts`
- `apps/web/test/use-upload-status.test.ts`
- `apps/web/test/step-progress.test.tsx`

---

## Shared type contract (used across tasks — defined in Task 2)

```ts
// packages/shared/src/index.ts (append)
export type WebhookDispatchJob = {
  uploadId: string;   // ulid (uploads.id)
  batchIndex: number; // 1-based, matches webhook payload
  attempt: number;    // 1-based attempt counter
};
```

```ts
// The canonical webhook body shape (assembled by buildWebhookPayload, Task 3).
// Mirrors captured-payloads/2026-05-26-usecsv-live-webhook.json -> body
export type WebhookPayload = {
  uploadId: number;                              // uploads.numeric_id
  importerId: string;                            // importer_environments.key (UUID)
  fileName: string;
  matchedColumnsMap: Record<string, string>;     // { machine_name: file_header }
  uploadedFileHeaders: string[];
  batch: { index: number; count: number; totalRows: number };
  user: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rows: Array<Record<string, string | number>>;  // each row has `row` (1-based) + machine-name keys
};
```

The `GET /api/uploads/:id` status response shape (defined in Task 6, consumed by the SPA in Tasks 11–12):

```ts
export type UploadStatusResponse = {
  upload_id: string;
  numeric_id: number;
  status: "pending" | "dispatching" | "completed" | "halted" | "failed";
  batch_count: number;
  batches_delivered: number;                     // # of batch_index values with a 2xx attempt
  latest_attempt: {
    batch_index: number;
    attempt_number: number;
    status_code: number | null;
    response_body: string | null;
  } | null;
  row_errors: Array<{ row: number; msg: string }>; // flattened across all errors_json
  has_row_errors: boolean;
};
```

---

### Task 1: Migration 0003 — idempotency + batch + attempt tables

**Files:**
- Create: `apps/worker/migrations/0003_dispatch.sql`
- Test: `apps/worker/test/migration-0003.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/test/migration-0003.test.ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("migration 0003 — dispatch schema", () => {
  it("uploads has an idempotency_key column", async () => {
    const cols = await env.DB.prepare("PRAGMA table_info(uploads)").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toContain("idempotency_key");
  });

  it("upload_batches table accepts a row", async () => {
    await env.DB.prepare(
      `INSERT INTO upload_batches (upload_id, batch_index, r2_key, row_count, created_at)
       VALUES ('upl_mig_a', 1, 'uploads/upl_mig_a/batches/1.json', 3, 1)`,
    ).run();
    const row = await env.DB.prepare(
      "SELECT row_count FROM upload_batches WHERE upload_id = 'upl_mig_a' AND batch_index = 1",
    ).first<{ row_count: number }>();
    expect(row?.row_count).toBe(3);
  });

  it("webhook_attempts table accepts a row and enforces the unique triple", async () => {
    await env.DB.prepare(
      `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, started_at)
       VALUES ('wha_mig_1', 'upl_mig_b', 1, 1, 200, 1)`,
    ).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, started_at)
         VALUES ('wha_mig_2', 'upl_mig_b', 1, 1, 500, 2)`,
      ).run(),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run migration-0003`
Expected: FAIL — `no such table: upload_batches` (and column missing).

- [ ] **Step 3: Write the migration**

```sql
-- apps/worker/migrations/0003_dispatch.sql

-- Idempotency for POST /api/uploads. Partial unique index so multiple NULLs are allowed
-- (uploads created before idempotency keys, or without one, don't collide).
ALTER TABLE uploads ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_uploads_idempotency
  ON uploads (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One row per persisted batch payload. PK gives (upload_id, batch_index) idempotency.
CREATE TABLE upload_batches (
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  batch_index INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (upload_id, batch_index)
);

-- One row per delivery attempt. Written by the dispatch consumer, read by the status endpoint.
CREATE TABLE webhook_attempts (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  batch_index INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  status_code INTEGER,
  response_body TEXT,          -- truncated to ~16 KB by the consumer
  errors_json TEXT,            -- parsed { errors: [{row,msg}] } from Laravel, as a JSON string
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (upload_id, batch_index, attempt_number)
);
CREATE INDEX idx_webhook_attempts_upload ON webhook_attempts (upload_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo-csv/worker test -- --run migration-0003`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/migrations/0003_dispatch.sql apps/worker/test/migration-0003.test.ts
git commit -m "feat(worker): migration 0003 — idempotency key, upload_batches, webhook_attempts"
```

---

### Task 2: R2 + Queue bindings and the shared job type

**Files:**
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/wrangler.toml`
- Modify: `packages/shared/src/index.ts`
- Test: (no new test — verified by `pnpm --filter @evo-csv/worker exec tsc --noEmit` typecheck in Step 4)

- [ ] **Step 1: Add the shared job type**

Append to `packages/shared/src/index.ts`:

```ts
export type WebhookDispatchJob = {
  uploadId: string;
  batchIndex: number;
  attempt: number;
};
```

> If `packages/shared` uses a different entry file, append to that file instead. Confirm the export is re-exported from the package root (`@evo-csv/shared`).

- [ ] **Step 2: Extend the Env type**

Replace `apps/worker/src/env.ts` contents with:

```ts
import type { WebhookDispatchJob } from "@evo-csv/shared";

export type Env = {
  DB: D1Database;
  DEV_USER_EMAIL: string;
  UPLOADS_BUCKET: R2Bucket;
  WEBHOOK_QUEUE: Queue<WebhookDispatchJob>;
};

export type SessionContext = {
  user: { id: string; email: string; name: string };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
};

export type Variables = {
  session: SessionContext;
};
```

> If `@evo-csv/worker` does not already depend on `@evo-csv/shared`, add `"@evo-csv/shared": "workspace:*"` to `apps/worker/package.json` dependencies and run `pnpm install`.

- [ ] **Step 3: Add the wrangler bindings**

Append to `apps/worker/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "UPLOADS_BUCKET"
bucket_name = "evo-csv-uploads"

[[queues.producers]]
binding = "WEBHOOK_QUEUE"
queue = "webhook-dispatch"

# We manage our own attempt counting + backoff via re-enqueue, so the platform
# retry is disabled (max_retries = 0) and batches are processed one at a time.
[[queues.consumers]]
queue = "webhook-dispatch"
max_batch_size = 1
max_retries = 0
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @evo-csv/worker exec tsc --noEmit`
Expected: PASS (no errors). `R2Bucket` / `Queue` resolve from `@cloudflare/workers-types`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/env.ts apps/worker/wrangler.toml packages/shared/src/index.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(worker): add R2 + Queue bindings and WebhookDispatchJob type"
```

---

### Task 3: `buildWebhookPayload` — the byte-shape lock

**Files:**
- Create: `apps/worker/src/lib/webhook-payload.ts`
- Test: `apps/worker/test/webhook-payload.test.ts`

- [ ] **Step 1: Write the failing test (snapshot against the captured fixture)**

```ts
// apps/worker/test/webhook-payload.test.ts
import { describe, expect, it } from "vitest";
import fixture from "../../../captured-payloads/2026-05-26-usecsv-live-webhook.json";
import { buildWebhookPayload } from "../src/lib/webhook-payload";

describe("buildWebhookPayload", () => {
  it("reproduces the captured usecsv body byte-shape (deep equality)", () => {
    const payload = buildWebhookPayload({
      numericId: 274300290,
      importerKey: "82b18e5e-6412-4102-901a-ce3c05d71460",
      fileName: "sample-tenants.csv",
      matchedColumnsMap: {
        email: "Customer Email",
        last_name: "Last name",
        first_name: "First name",
      },
      uploadedFileHeaders: ["First name", "Last name", "Customer Email", "Notes"],
      batchIndex: 1,
      batchCount: 1,
      totalRows: 3,
      user: null,
      metadata: null,
      rows: [
        { row: 1, first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
        { row: 2, first_name: "Bob", last_name: "Jones", email: "bob@example.com" },
        { row: 3, first_name: "Carol", last_name: "Lee", email: "carol.lee@example.com" },
      ],
    });
    expect(payload).toEqual(fixture.body);
  });

  it("keeps user/metadata as null (never undefined) and uploadId as a number", () => {
    const p = buildWebhookPayload({
      numericId: 7,
      importerKey: "k",
      fileName: "f.csv",
      matchedColumnsMap: { a: "A" },
      uploadedFileHeaders: ["A"],
      batchIndex: 2,
      batchCount: 5,
      totalRows: 4321,
      user: null,
      metadata: null,
      rows: [{ row: 1001, a: "x" }],
    });
    expect(p.user).toBeNull();
    expect(p.metadata).toBeNull();
    expect(typeof p.uploadId).toBe("number");
    expect(p.batch).toEqual({ index: 2, count: 5, totalRows: 4321 });
  });
});
```

> If `tsconfig` complains about importing JSON, ensure `resolveJsonModule: true` is set in `apps/worker/tsconfig.json` (add it if missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run webhook-payload`
Expected: FAIL — `buildWebhookPayload is not a function`.

- [ ] **Step 3: Implement**

```ts
// apps/worker/src/lib/webhook-payload.ts
import type { WebhookPayload } from "@evo-csv/shared";

export type BuildWebhookPayloadInput = {
  numericId: number;
  importerKey: string;
  fileName: string;
  matchedColumnsMap: Record<string, string>;
  uploadedFileHeaders: string[];
  batchIndex: number;
  batchCount: number;
  totalRows: number;
  user: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rows: Array<Record<string, string | number>>;
};

/**
 * Assemble the canonical webhook body. Key order here mirrors the captured
 * usecsv fixture for readability, but receivers must not depend on key order
 * (deep-equality is what the contract guarantees). See
 * captured-payloads/2026-05-26-usecsv-live-webhook.json.
 */
export function buildWebhookPayload(input: BuildWebhookPayloadInput): WebhookPayload {
  return {
    uploadId: input.numericId,
    importerId: input.importerKey,
    fileName: input.fileName,
    matchedColumnsMap: input.matchedColumnsMap,
    uploadedFileHeaders: input.uploadedFileHeaders,
    batch: {
      index: input.batchIndex,
      count: input.batchCount,
      totalRows: input.totalRows,
    },
    user: input.user,
    metadata: input.metadata,
    rows: input.rows,
  };
}
```

Add `WebhookPayload` to `packages/shared/src/index.ts` (the shape from the "Shared type contract" section above):

```ts
export type WebhookPayload = {
  uploadId: number;
  importerId: string;
  fileName: string;
  matchedColumnsMap: Record<string, string>;
  uploadedFileHeaders: string[];
  batch: { index: number; count: number; totalRows: number };
  user: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rows: Array<Record<string, string | number>>;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo-csv/worker test -- --run webhook-payload`
Expected: PASS (2 tests). The deep-equality test confirms the byte-shape matches the live capture.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/webhook-payload.ts apps/worker/test/webhook-payload.test.ts packages/shared/src/index.ts
git commit -m "feat(worker): buildWebhookPayload + byte-shape snapshot against live capture"
```

---

### Task 4: Idempotency-Key on `POST /api/uploads`

**Files:**
- Modify: `apps/worker/src/routes/uploads.ts`
- Test: `apps/worker/test/uploads.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/test/uploads.test.ts`:

```ts
describe("POST /api/uploads — idempotency", () => {
  it("returns the same upload row for a repeated Idempotency-Key, creating no duplicate", async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };

    const first = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_BODY),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_BODY),
    });
    // Idempotent replay returns 200 with the SAME upload, never a new 201.
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.upload_id).toBe(firstBody.upload_id);
    expect(secondBody.numeric_id).toBe(firstBody.numeric_id);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM uploads WHERE idempotency_key = ?",
    )
      .bind(key)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads`
Expected: FAIL — second call returns 201 and creates a duplicate (count = 2), or the column write is missing.

- [ ] **Step 3: Implement idempotency**

In `apps/worker/src/routes/uploads.ts`, inside the `POST "/"` handler, read the header at the top of the handler body (after `const session = c.get("session");`):

```ts
    const idempotencyKey = c.req.header("Idempotency-Key") ?? null;
```

Then, inside the `try` block, BEFORE the `impEnv` lookup, short-circuit on an existing row:

```ts
      // Idempotent replay: if this key already created an upload, return it unchanged.
      if (idempotencyKey) {
        const existing = await c.env.DB.prepare(
          "SELECT id, numeric_id, status FROM uploads WHERE idempotency_key = ?",
        )
          .bind(idempotencyKey)
          .first<{ id: string; numeric_id: number; status: string }>();
        if (existing) {
          return c.json(
            { upload_id: existing.id, numeric_id: existing.numeric_id, status: existing.status },
            200,
          );
        }
      }
```

Add `idempotency_key` to the INSERT. Change the column list and values:

```ts
      await c.env.DB.prepare(
        `INSERT INTO uploads (
          id, numeric_id, project_id, importer_environment_id, file_name, file_size,
          r2_source_key, matched_columns_map, uploaded_file_headers,
          user_payload, metadata_payload, total_rows, batch_size, batch_count,
          status, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
        .bind(
          uploadId,
          seq.value,
          session.project_id,
          body.importer_environment_id,
          body.file_name,
          body.file_size,
          `uploads/${uploadId}/source.csv`,
          JSON.stringify(body.matched_columns_map),
          JSON.stringify(body.uploaded_file_headers),
          finalUserPayload === null ? null : JSON.stringify(finalUserPayload),
          body.metadata_payload === null ? null : JSON.stringify(body.metadata_payload),
          body.total_rows,
          body.batch_size,
          body.batch_count,
          idempotencyKey,
          now,
          now,
        )
        .run();
```

> Note: there's a tiny race where two concurrent first-time requests with the same key both pass the SELECT and both INSERT — the partial unique index makes the second INSERT throw, which falls into the existing `catch` and returns 500. That's acceptable for an internal tool; the SPA also guards against double-submit client-side (Task 12). Do not add locking.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads`
Expected: PASS (all prior upload tests + the new idempotency test).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads.test.ts
git commit -m "feat(worker): Idempotency-Key dedupe on POST /api/uploads"
```

---

### Task 5: `POST /api/uploads/:upload_id/batches/:batch_index` — persist + enqueue

**Files:**
- Modify: `apps/worker/src/routes/uploads.ts`
- Test: `apps/worker/test/uploads-batches.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/test/uploads-batches.test.ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "sample-tenants.csv",
  file_size: 256,
  matched_columns_map: { first_name: "First name", last_name: "Last name", email: "Customer Email" },
  uploaded_file_headers: ["First name", "Last name", "Customer Email", "Notes"],
  total_rows: 3,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function createUpload(): Promise<{ upload_id: string; numeric_id: number }> {
  const res = await SELF.fetch("https://example.com/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(UPLOAD_BODY),
  });
  return res.json();
}

describe("POST /api/uploads/:id/batches/:index", () => {
  it("writes the canonical payload to R2, records upload_batches, returns 204", async () => {
    const { upload_id, numeric_id } = await createUpload();

    const res = await SELF.fetch(
      `https://example.com/api/uploads/${upload_id}/batches/1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [
            { row: 1, first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
            { row: 2, first_name: "Bob", last_name: "Jones", email: "bob@example.com" },
            { row: 3, first_name: "Carol", last_name: "Lee", email: "carol.lee@example.com" },
          ],
        }),
      },
    );
    expect(res.status).toBe(204);

    // R2 object holds the full canonical payload, server-assembled.
    const obj = await env.UPLOADS_BUCKET.get(`uploads/${upload_id}/batches/1.json`);
    expect(obj).not.toBeNull();
    const payload = JSON.parse(await obj!.text());
    expect(payload.uploadId).toBe(numeric_id);
    expect(payload.importerId).toBe("82b18e5e-6412-4102-901a-ce3c05d71460");
    expect(payload.batch).toEqual({ index: 1, count: 1, totalRows: 3 });
    expect(payload.rows[0]).toEqual({
      row: 1,
      first_name: "Alice",
      last_name: "Smith",
      email: "alice@example.com",
    });

    const batchRow = await env.DB.prepare(
      "SELECT row_count FROM upload_batches WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(upload_id)
      .first<{ row_count: number }>();
    expect(batchRow?.row_count).toBe(3);
  });

  it("is idempotent on (upload_id, batch_index) — repeat returns 204, no duplicate row", async () => {
    const { upload_id } = await createUpload();
    const body = JSON.stringify({ rows: [{ row: 1, first_name: "A", last_name: "B", email: "a@b.com" }] });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };

    const first = await SELF.fetch(`https://example.com/api/uploads/${upload_id}/batches/1`, opts);
    const second = await SELF.fetch(`https://example.com/api/uploads/${upload_id}/batches/1`, opts);
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM upload_batches WHERE upload_id = ?",
    )
      .bind(upload_id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("404s for an upload in another project / nonexistent", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads/upl_nope/batches/1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [{ row: 1, first_name: "A", last_name: "B", email: "a@b.com" }] }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads-batches`
Expected: FAIL — route not found (404 for the first, valid case, because the sub-route doesn't exist yet).

- [ ] **Step 3: Implement the sub-route**

In `apps/worker/src/routes/uploads.ts`, add imports at the top:

```ts
import { buildWebhookPayload } from "../lib/webhook-payload.js";
```

Chain a new `.post(...)` onto `uploadsRoutes` (after the existing `POST "/"`). Add the batch schema near the other schema:

```ts
const batchIngestSchema = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1),
});
```

```ts
.post(
  "/:upload_id/batches/:batch_index",
  zValidator("json", batchIngestSchema),
  async (c) => {
    const uploadId = c.req.param("upload_id");
    const batchIndex = Number(c.req.param("batch_index"));
    const { rows } = c.req.valid("json");
    const session = c.get("session");

    if (!Number.isInteger(batchIndex) || batchIndex < 1) {
      return c.json({ error: "batch_index must be a positive integer" }, 400);
    }

    try {
      // Project-scoped load of the upload + its importer-environment key.
      const upload = await c.env.DB.prepare(
        `SELECT u.id, u.numeric_id, u.file_name, u.matched_columns_map, u.uploaded_file_headers,
                u.user_payload, u.metadata_payload, u.total_rows, u.batch_count,
                ie.key AS importer_key
         FROM uploads u
         JOIN importer_environments ie ON ie.id = u.importer_environment_id
         WHERE u.id = ? AND u.project_id = ?`,
      )
        .bind(uploadId, session.project_id)
        .first<{
          id: string;
          numeric_id: number;
          file_name: string;
          matched_columns_map: string;
          uploaded_file_headers: string;
          user_payload: string | null;
          metadata_payload: string | null;
          total_rows: number;
          batch_count: number;
          importer_key: string;
        }>();

      if (!upload) {
        return c.json({ error: "Upload not found" }, 404);
      }
      if (batchIndex > upload.batch_count) {
        return c.json({ error: "batch_index exceeds batch_count" }, 400);
      }

      // Idempotent: if this batch is already persisted, return 204 without rewriting R2.
      const existing = await c.env.DB.prepare(
        "SELECT 1 FROM upload_batches WHERE upload_id = ? AND batch_index = ?",
      )
        .bind(uploadId, batchIndex)
        .first();
      if (existing) {
        return c.body(null, 204);
      }

      const payload = buildWebhookPayload({
        numericId: upload.numeric_id,
        importerKey: upload.importer_key,
        fileName: upload.file_name,
        matchedColumnsMap: JSON.parse(upload.matched_columns_map),
        uploadedFileHeaders: JSON.parse(upload.uploaded_file_headers),
        batchIndex,
        batchCount: upload.batch_count,
        totalRows: upload.total_rows,
        user: upload.user_payload ? JSON.parse(upload.user_payload) : null,
        metadata: upload.metadata_payload ? JSON.parse(upload.metadata_payload) : null,
        rows,
      });

      const r2Key = `uploads/${uploadId}/batches/${batchIndex}.json`;
      await c.env.UPLOADS_BUCKET.put(r2Key, JSON.stringify(payload), {
        httpMetadata: { contentType: "application/json" },
      });

      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO upload_batches (upload_id, batch_index, r2_key, row_count, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(uploadId, batchIndex, r2Key, rows.length, now)
        .run();

      // Move the upload out of 'pending' as soon as the first batch lands.
      await c.env.DB.prepare(
        "UPDATE uploads SET status = 'dispatching', updated_at = ? WHERE id = ? AND status = 'pending'",
      )
        .bind(now, uploadId)
        .run();

      // Enqueue delivery. attempt starts at 1.
      await c.env.WEBHOOK_QUEUE.send({ uploadId, batchIndex, attempt: 1 });

      return c.body(null, 204);
    } catch (err) {
      console.error("DB/R2 error in POST batch:", err);
      return c.json({ error: "Failed to persist batch" }, 500);
    }
  },
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads-batches`
Expected: PASS (3 tests). (The `WEBHOOK_QUEUE.send` line runs against Miniflare's simulated queue; we don't assert delivery here — see Scope note 3.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads-batches.test.ts
git commit -m "feat(worker): batch ingest — assemble payload, persist to R2, enqueue dispatch"
```

---

### Task 6: `GET /api/uploads/:upload_id` — status + progress

**Files:**
- Modify: `apps/worker/src/routes/uploads.ts`
- Test: `apps/worker/test/uploads-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/test/uploads-status.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "t.csv",
  file_size: 64,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: 3,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function createUpload(): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(UPLOAD_BODY),
  });
  return (await res.json()).upload_id;
}

describe("GET /api/uploads/:id", () => {
  it("reports pending with zero delivered when no attempts exist", async () => {
    const id = await createUpload();
    const res = await SELF.fetch(`https://example.com/api/uploads/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      upload_id: id,
      status: "pending",
      batch_count: 1,
      batches_delivered: 0,
      has_row_errors: false,
    });
    expect(body.latest_attempt).toBeNull();
    expect(body.row_errors).toEqual([]);
  });

  it("counts delivered batches and surfaces row errors from errors_json", async () => {
    const id = await createUpload();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts
        (id, upload_id, batch_index, attempt_number, status_code, response_body, errors_json, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, '{"errors":[{"row":2,"msg":"duplicate email"}]}',
               '[{"row":2,"msg":"duplicate email"}]', ?, ?)`,
    )
      .bind(`wha_${crypto.randomUUID()}`, id, now, now)
      .run();
    await env.DB.prepare("UPDATE uploads SET status = 'completed' WHERE id = ?").bind(id).run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}`);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.batches_delivered).toBe(1);
    expect(body.has_row_errors).toBe(true);
    expect(body.row_errors).toEqual([{ row: 2, msg: "duplicate email" }]);
    expect(body.latest_attempt).toMatchObject({ batch_index: 1, attempt_number: 1, status_code: 200 });
  });

  it("404s for an upload outside the active project", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads/upl_nope");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads-status`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement**

Chain onto `uploadsRoutes`:

```ts
.get("/:upload_id", async (c) => {
  const uploadId = c.req.param("upload_id");
  const session = c.get("session");

  try {
    const upload = await c.env.DB.prepare(
      "SELECT id, numeric_id, status, batch_count FROM uploads WHERE id = ? AND project_id = ?",
    )
      .bind(uploadId, session.project_id)
      .first<{ id: string; numeric_id: number; status: string; batch_count: number }>();
    if (!upload) {
      return c.json({ error: "Upload not found" }, 404);
    }

    const attempts = await c.env.DB.prepare(
      `SELECT batch_index, attempt_number, status_code, response_body, errors_json
       FROM webhook_attempts WHERE upload_id = ?
       ORDER BY started_at ASC, attempt_number ASC`,
    )
      .bind(uploadId)
      .all<{
        batch_index: number;
        attempt_number: number;
        status_code: number | null;
        response_body: string | null;
        errors_json: string | null;
      }>();

    const rows = attempts.results ?? [];

    // batches_delivered = distinct batch_index values with at least one 2xx attempt.
    const deliveredSet = new Set<number>();
    const rowErrors: Array<{ row: number; msg: string }> = [];
    for (const a of rows) {
      if (a.status_code !== null && a.status_code >= 200 && a.status_code < 300) {
        deliveredSet.add(a.batch_index);
      }
      if (a.errors_json) {
        try {
          const parsed = JSON.parse(a.errors_json) as Array<{ row: number; msg: string }>;
          for (const e of parsed) rowErrors.push(e);
        } catch {
          // ignore malformed errors_json
        }
      }
    }

    const last = rows.length > 0 ? rows[rows.length - 1]! : null;

    return c.json({
      upload_id: upload.id,
      numeric_id: upload.numeric_id,
      status: upload.status,
      batch_count: upload.batch_count,
      batches_delivered: deliveredSet.size,
      latest_attempt: last
        ? {
            batch_index: last.batch_index,
            attempt_number: last.attempt_number,
            status_code: last.status_code,
            response_body: last.response_body,
          }
        : null,
      row_errors: rowErrors,
      has_row_errors: rowErrors.length > 0,
    });
  } catch (err) {
    console.error("DB error in GET upload status:", err);
    return c.json({ error: "Failed to load upload status" }, 500);
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads-status`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads-status.test.ts
git commit -m "feat(worker): GET /api/uploads/:id status + progress aggregation"
```

---

### Task 7: Dispatch pipeline — `dispatchBatch`, signing, status recompute, queue handler

**Files:**
- Create: `apps/worker/src/lib/dispatch.ts`
- Modify: `apps/worker/src/index.ts` (default export → `{ fetch, queue }`)
- Test: `apps/worker/test/dispatch.test.ts`

- [ ] **Step 1: Write the failing test (dispatch logic, injected fetch)**

```ts
// apps/worker/test/dispatch.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatchBatch } from "../src/lib/dispatch";

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

// Create an upload + persist batch 1 to R2 via the real endpoints, so dispatchBatch
// has something to read. Returns the upload id.
async function seedUploadWithBatch(): Promise<string> {
  const created = await (
    await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json();
  await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ row: 1, first_name: "Alice" }] }),
  });
  return created.upload_id;
}

describe("dispatchBatch", () => {
  it("on 2xx with empty errors: records attempt, marks upload completed", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 });

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch as typeof fetch);

    const attempt = await env.DB.prepare(
      "SELECT status_code, errors_json FROM webhook_attempts WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(id)
      .first<{ status_code: number; errors_json: string | null }>();
    expect(attempt?.status_code).toBe(200);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("completed");
  });

  it("on 2xx with row errors: stores errors_json, still completes", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = async () =>
      new Response(JSON.stringify({ errors: [{ row: 1, msg: "bad" }] }), { status: 200 });

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch as typeof fetch);

    const attempt = await env.DB.prepare(
      "SELECT errors_json FROM webhook_attempts WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(id)
      .first<{ errors_json: string }>();
    expect(JSON.parse(attempt!.errors_json)).toEqual([{ row: 1, msg: "bad" }]);
    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("completed");
  });

  it("on 5xx at the final attempt (6): marks upload halted", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = async () => new Response("upstream boom", { status: 500 });

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 6 }, fakeFetch as typeof fetch);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("halted");
    const attempt = await env.DB.prepare(
      "SELECT status_code, response_body FROM webhook_attempts WHERE upload_id = ? AND attempt_number = 6",
    )
      .bind(id)
      .first<{ status_code: number; response_body: string }>();
    expect(attempt?.status_code).toBe(500);
    expect(attempt?.response_body).toContain("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run dispatch`
Expected: FAIL — `dispatchBatch is not a function`.

- [ ] **Step 3: Implement the dispatch library**

```ts
// apps/worker/src/lib/dispatch.ts
import type { WebhookDispatchJob } from "@evo-csv/shared";
import type { Env } from "../env.js";
import { generateId } from "./ids.js";

const MAX_ATTEMPTS = 6;
// Exponential backoff in seconds: 10s, 30s, 2m, 10m, 1h, 6h. Index = attempt-1.
const BACKOFF_SECONDS = [10, 30, 120, 600, 3600, 21600];
const RESPONSE_BODY_CAP = 16 * 1024;

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, lowercase hex. */
async function signPayload(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

/**
 * Recompute uploads.status from the full set of webhook_attempts.
 *  - completed: every batch_index in 1..batch_count has a 2xx attempt
 *  - halted:    some batch has MAX_ATTEMPTS attempts and none of them 2xx
 *  - dispatching: otherwise (still in flight / retrying)
 */
export async function recomputeUploadStatus(env: Env, uploadId: string): Promise<void> {
  const upload = await env.DB.prepare("SELECT batch_count FROM uploads WHERE id = ?")
    .bind(uploadId)
    .first<{ batch_count: number }>();
  if (!upload) return;

  const attempts = await env.DB.prepare(
    "SELECT batch_index, attempt_number, status_code FROM webhook_attempts WHERE upload_id = ?",
  )
    .bind(uploadId)
    .all<{ batch_index: number; attempt_number: number; status_code: number | null }>();
  const rows = attempts.results ?? [];

  const delivered = new Set<number>();
  const attemptsByBatch = new Map<number, number>();
  for (const a of rows) {
    if (a.status_code !== null && isSuccess(a.status_code)) delivered.add(a.batch_index);
    attemptsByBatch.set(a.batch_index, Math.max(attemptsByBatch.get(a.batch_index) ?? 0, a.attempt_number));
  }

  let status = "dispatching";
  let allDelivered = true;
  for (let i = 1; i <= upload.batch_count; i++) {
    if (!delivered.has(i)) {
      allDelivered = false;
      if ((attemptsByBatch.get(i) ?? 0) >= MAX_ATTEMPTS) {
        status = "halted";
        break;
      }
    }
  }
  if (allDelivered) status = "completed";

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE uploads SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, uploadId)
    .run();
}

/**
 * Deliver one batch. Reads the persisted payload from R2, POSTs it to the
 * importer-environment webhook URL (HMAC-signed when enabled), writes a
 * webhook_attempts row, recomputes upload status, and re-enqueues on failure
 * until MAX_ATTEMPTS.
 *
 * `fetchImpl` is injectable so tests can stub the network deterministically.
 */
export async function dispatchBatch(
  env: Env,
  job: WebhookDispatchJob,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { uploadId, batchIndex, attempt } = job;

  const cfg = await env.DB.prepare(
    `SELECT ie.webhook_url, ie.webhook_signing_enabled, ie.webhook_secret
     FROM uploads u JOIN importer_environments ie ON ie.id = u.importer_environment_id
     WHERE u.id = ?`,
  )
    .bind(uploadId)
    .first<{ webhook_url: string; webhook_signing_enabled: number; webhook_secret: string | null }>();
  if (!cfg) return;

  const r2Key = `uploads/${uploadId}/batches/${batchIndex}.json`;
  const obj = await env.UPLOADS_BUCKET.get(r2Key);
  if (!obj) {
    // Batch not persisted yet — re-enqueue shortly (covers any ingest/dispatch race).
    await env.WEBHOOK_QUEUE.send(job, { delaySeconds: 5 });
    return;
  }
  const rawBody = await obj.text();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "evo-csv/0.1 (+https://app.evo-csv)",
  };
  if (cfg.webhook_signing_enabled === 1 && cfg.webhook_secret) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers["X-Evo-Timestamp"] = ts;
    headers["X-Evo-Signature"] = await signPayload(cfg.webhook_secret, ts, rawBody);
  }

  const startedAt = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorsJson: string | null = null;

  try {
    const res = await fetchImpl(cfg.webhook_url, { method: "POST", headers, body: rawBody });
    statusCode = res.status;
    const text = await res.text();
    responseBody = text.slice(0, RESPONSE_BODY_CAP);
    if (isSuccess(res.status)) {
      try {
        const parsed = JSON.parse(text) as { errors?: Array<{ row: number; msg: string }> };
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          errorsJson = JSON.stringify(parsed.errors);
        }
      } catch {
        // Non-JSON 2xx body — treat as success with no row errors.
      }
    }
  } catch (err) {
    statusCode = null; // network/timeout
    responseBody = err instanceof Error ? err.message.slice(0, RESPONSE_BODY_CAP) : "fetch failed";
  }

  const finishedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_attempts
      (id, upload_id, batch_index, attempt_number, status_code, response_body, errors_json, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(generateId("wha"), uploadId, batchIndex, attempt, statusCode, responseBody, errorsJson, startedAt, finishedAt)
    .run();

  const ok = statusCode !== null && isSuccess(statusCode);
  if (!ok && attempt < MAX_ATTEMPTS) {
    const delay = BACKOFF_SECONDS[attempt - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]!;
    await env.WEBHOOK_QUEUE.send(
      { uploadId, batchIndex, attempt: attempt + 1 },
      { delaySeconds: delay },
    );
  }

  await recomputeUploadStatus(env, uploadId);
}
```

- [ ] **Step 4: Wire the queue consumer in `index.ts`**

Replace `apps/worker/src/index.ts` with:

```ts
import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { dispatchBatch } from "./lib/dispatch.js";
import { devSession } from "./middleware/dev-session.js";
import { importersRoutes } from "./routes/importers.js";
import { uploadsRoutes } from "./routes/uploads.js";
import type { WebhookDispatchJob } from "@evo-csv/shared";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .use("/api/*", devSession)
  .get("/api/whoami", (c) => c.json(c.get("session")))
  .route("/api/importers", importersRoutes)
  .route("/api/uploads", uploadsRoutes);

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<WebhookDispatchJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await dispatchBatch(env, message.body);
      message.ack();
    }
  },
};
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `pnpm --filter @evo-csv/worker test -- --run dispatch && pnpm --filter @evo-csv/worker exec tsc --noEmit`
Expected: PASS (3 dispatch tests) and clean typecheck. `MessageBatch` resolves from `@cloudflare/workers-types`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/lib/dispatch.ts apps/worker/src/index.ts apps/worker/test/dispatch.test.ts
git commit -m "feat(worker): minimal webhook dispatch consumer with signing, retries, status recompute"
```

---

### Task 8: `POST /api/uploads/:upload_id/retry` and `GET /api/uploads/:upload_id/errors.csv`

**Files:**
- Modify: `apps/worker/src/routes/uploads.ts`
- Test: `apps/worker/test/uploads-retry-errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/test/uploads-retry-errors.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "t.csv",
  file_size: 64,
  matched_columns_map: { first_name: "First name", email: "Customer Email" },
  uploaded_file_headers: ["First name", "Customer Email"],
  total_rows: 2,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function seed(): Promise<string> {
  const created = await (
    await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json();
  await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: [
        { row: 1, first_name: "Alice", email: "alice@example.com" },
        { row: 2, first_name: "Bob", email: "bob@example.com" },
      ],
    }),
  });
  return created.upload_id;
}

describe("POST /api/uploads/:id/retry", () => {
  it("re-enqueues the unfinished batch and resets status to dispatching", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE uploads SET status = 'halted' WHERE id = ?").bind(id).run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/retry`, { method: "POST" });
    expect(res.status).toBe(202);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("dispatching");
  });

  it("404s when the upload is not in the active project", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads/upl_nope/retry", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/uploads/:id/errors.csv", () => {
  it("streams a CSV of row errors joined with the original row data", async () => {
    const id = await seed();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts
        (id, upload_id, batch_index, attempt_number, status_code, errors_json, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, '[{"row":2,"msg":"duplicate email"}]', ?, ?)`,
    )
      .bind(`wha_${crypto.randomUUID()}`, id, now, now)
      .run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.trim().split("\n");
    // header + 1 error row
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("row");
    expect(lines[0]).toContain("error_message");
    expect(lines[1]).toContain("Bob"); // row 2's first_name
    expect(lines[1]).toContain("duplicate email");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads-retry-errors`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement both routes**

Add the dispatch import to `apps/worker/src/routes/uploads.ts` top:

```ts
import { generateId } from "../lib/ids.js";
```
(already imported — keep as is). No new lib import needed for retry beyond the queue.

Chain onto `uploadsRoutes`:

```ts
.post("/:upload_id/retry", async (c) => {
  const uploadId = c.req.param("upload_id");
  const session = c.get("session");

  try {
    const upload = await c.env.DB.prepare(
      "SELECT id, batch_count FROM uploads WHERE id = ? AND project_id = ?",
    )
      .bind(uploadId, session.project_id)
      .first<{ id: string; batch_count: number }>();
    if (!upload) return c.json({ error: "Upload not found" }, 404);

    // Find batches with no 2xx attempt and re-enqueue each (attempt restarts at 1).
    const attempts = await c.env.DB.prepare(
      "SELECT batch_index, status_code FROM webhook_attempts WHERE upload_id = ?",
    )
      .bind(uploadId)
      .all<{ batch_index: number; status_code: number | null }>();
    const delivered = new Set<number>();
    for (const a of attempts.results ?? []) {
      if (a.status_code !== null && a.status_code >= 200 && a.status_code < 300) {
        delivered.add(a.batch_index);
      }
    }

    for (let i = 1; i <= upload.batch_count; i++) {
      if (!delivered.has(i)) {
        await c.env.WEBHOOK_QUEUE.send({ uploadId, batchIndex: i, attempt: 1 });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare("UPDATE uploads SET status = 'dispatching', updated_at = ? WHERE id = ?")
      .bind(now, uploadId)
      .run();

    return c.json({ ok: true }, 202);
  } catch (err) {
    console.error("DB error in retry:", err);
    return c.json({ error: "Failed to retry" }, 500);
  }
})
.get("/:upload_id/errors.csv", async (c) => {
  const uploadId = c.req.param("upload_id");
  const session = c.get("session");

  try {
    const upload = await c.env.DB.prepare(
      "SELECT id FROM uploads WHERE id = ? AND project_id = ?",
    )
      .bind(uploadId, session.project_id)
      .first<{ id: string }>();
    if (!upload) return c.json({ error: "Upload not found" }, 404);

    // Collect row errors across all attempts.
    const attempts = await c.env.DB.prepare(
      "SELECT errors_json FROM webhook_attempts WHERE upload_id = ?",
    )
      .bind(uploadId)
      .all<{ errors_json: string | null }>();
    const errorMap = new Map<number, string>();
    for (const a of attempts.results ?? []) {
      if (!a.errors_json) continue;
      try {
        for (const e of JSON.parse(a.errors_json) as Array<{ row: number; msg: string }>) {
          errorMap.set(e.row, e.msg);
        }
      } catch {
        // skip malformed
      }
    }

    // Read original rows from the persisted batch payloads in R2.
    const batches = await c.env.DB.prepare(
      "SELECT r2_key FROM upload_batches WHERE upload_id = ? ORDER BY batch_index ASC",
    )
      .bind(uploadId)
      .all<{ r2_key: string }>();

    const rowByNumber = new Map<number, Record<string, string | number>>();
    const columnKeys: string[] = [];
    for (const b of batches.results ?? []) {
      const obj = await c.env.UPLOADS_BUCKET.get(b.r2_key);
      if (!obj) continue;
      const payload = JSON.parse(await obj.text()) as {
        rows: Array<Record<string, string | number>>;
      };
      for (const row of payload.rows) {
        rowByNumber.set(Number(row.row), row);
        for (const k of Object.keys(row)) {
          if (k !== "row" && !columnKeys.includes(k)) columnKeys.push(k);
        }
      }
    }

    const csvEscape = (v: unknown): string => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ["row", ...columnKeys, "error_message"];
    const lines = [header.map(csvEscape).join(",")];
    for (const [rowNum, msg] of [...errorMap.entries()].sort((a, b) => a[0] - b[0])) {
      const row = rowByNumber.get(rowNum) ?? {};
      const cells = [rowNum, ...columnKeys.map((k) => row[k] ?? ""), msg];
      lines.push(cells.map(csvEscape).join(","));
    }

    return c.body(lines.join("\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="upload-${uploadId}-errors.csv"`,
    });
  } catch (err) {
    console.error("DB/R2 error in errors.csv:", err);
    return c.json({ error: "Failed to build error CSV" }, 500);
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads-retry-errors`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads-retry-errors.test.ts
git commit -m "feat(worker): retry endpoint + errors.csv synthesis from webhook_attempts"
```

---

### Task 9: `buildBatches` — client-side key remap + chunking

**Files:**
- Create: `apps/web/src/lib/build-batches.ts`
- Test: `apps/web/test/build-batches.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/build-batches.test.ts
import { describe, expect, it } from "vitest";
import { buildBatches } from "../src/lib/build-batches";

// matched is { machine_name: file_header } — the wizard's canonical direction.
const matched = { first_name: "First name", last_name: "Last name", email: "Customer Email" };

describe("buildBatches", () => {
  it("remaps file-header keys to machine names and adds 1-based row numbers", () => {
    const editedRows = [
      { "First name": "Alice", "Last name": "Smith", "Customer Email": "a@b.com", Notes: "ignore" },
    ];
    const result = buildBatches(editedRows, matched, 1000);
    expect(result.total_rows).toBe(1);
    expect(result.batch_count).toBe(1);
    expect(result.batches[0].index).toBe(1);
    expect(result.batches[0].rows[0]).toEqual({
      row: 1,
      first_name: "Alice",
      last_name: "Smith",
      email: "a@b.com",
    });
    // Unmatched 'Notes' column is dropped from rows[].
    expect(result.batches[0].rows[0]).not.toHaveProperty("Notes");
  });

  it("chunks 2500 rows into 3 batches with global row numbering", () => {
    const editedRows = Array.from({ length: 2500 }, (_, i) => ({
      "First name": `F${i}`,
      "Last name": `L${i}`,
      "Customer Email": `u${i}@x.com`,
    }));
    const result = buildBatches(editedRows, matched, 1000);
    expect(result.batch_count).toBe(3);
    expect(result.total_rows).toBe(2500);
    expect(result.batches.map((b) => b.index)).toEqual([1, 2, 3]);
    expect(result.batches[0].rows.length).toBe(1000);
    expect(result.batches[2].rows.length).toBe(500);
    // batch 3, row 1 is the 2001st source row.
    expect(result.batches[2].rows[0].row).toBe(2001);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --run build-batches`
Expected: FAIL — `buildBatches is not a function`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/build-batches.ts
export type BuiltBatch = {
  index: number; // 1-based
  rows: Array<Record<string, string | number>>;
};

export type BuiltBatches = {
  total_rows: number;
  batch_count: number;
  batches: BuiltBatch[];
};

/**
 * Transform the wizard's edited rows (keyed by ORIGINAL FILE HEADER) into the
 * webhook row shape (keyed by IMPORTER MACHINE NAME) and chunk them into batches.
 *
 * `matched` is { machine_name: file_header } — the canonical wizard direction,
 * matching captured-payloads/2026-05-26-usecsv-live-webhook.json.matchedColumnsMap.
 *
 * Each output row gets a 1-based `row` number that is the row's position in the
 * WHOLE file (continuous across batches), echoed back by Laravel in errors.
 */
export function buildBatches(
  editedRows: Record<string, string>[],
  matched: Record<string, string>,
  batchSize: number,
): BuiltBatches {
  const machineNames = Object.keys(matched);

  const mapped: Array<Record<string, string | number>> = editedRows.map((srcRow, i) => {
    const out: Record<string, string | number> = { row: i + 1 };
    for (const machine of machineNames) {
      const fileHeader = matched[machine]!;
      out[machine] = srcRow[fileHeader] ?? "";
    }
    return out;
  });

  const batches: BuiltBatch[] = [];
  for (let start = 0; start < mapped.length; start += batchSize) {
    batches.push({
      index: batches.length + 1,
      rows: mapped.slice(start, start + batchSize),
    });
  }
  // An empty input still yields zero batches; callers guard against empty uploads upstream.

  return {
    total_rows: mapped.length,
    batch_count: batches.length,
    batches,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --run build-batches`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/build-batches.ts apps/web/test/build-batches.test.ts
git commit -m "feat(web): buildBatches — file-header to machine-name remap + chunking"
```

---

### Task 10: `useUploadStatus` polling hook

**Files:**
- Create: `apps/web/src/lib/use-upload-status.ts`
- Test: `apps/web/test/use-upload-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/use-upload-status.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadStatus } from "../src/lib/use-upload-status";
import type { UploadStatusResponse } from "../src/lib/use-upload-status";

function statusResponse(over: Partial<UploadStatusResponse> = {}): UploadStatusResponse {
  return {
    upload_id: "upl_1",
    numeric_id: 1,
    status: "dispatching",
    batch_count: 1,
    batches_delivered: 0,
    latest_attempt: null,
    row_errors: [],
    has_row_errors: false,
    ...over,
  };
}

describe("useUploadStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls every 2s and stops once status is terminal", async () => {
    const fetchStatus = vi
      .fn<[], Promise<UploadStatusResponse>>()
      .mockResolvedValueOnce(statusResponse({ status: "dispatching" }))
      .mockResolvedValueOnce(statusResponse({ status: "completed", batches_delivered: 1 }));

    const { result } = renderHook(() => useUploadStatus("upl_1", fetchStatus));

    // Initial fetch fires immediately.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // Advance 2s -> second poll -> terminal -> stop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.status).toBe("completed");

    // No further polling after terminal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("does not poll when uploadId is null", async () => {
    const fetchStatus = vi.fn();
    renderHook(() => useUploadStatus(null, fetchStatus));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --run use-upload-status`
Expected: FAIL — `useUploadStatus is not a function`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/use-upload-status.ts
import { useEffect, useRef, useState } from "react";

export type UploadStatusResponse = {
  upload_id: string;
  numeric_id: number;
  status: "pending" | "dispatching" | "completed" | "halted" | "failed";
  batch_count: number;
  batches_delivered: number;
  latest_attempt: {
    batch_index: number;
    attempt_number: number;
    status_code: number | null;
    response_body: string | null;
  } | null;
  row_errors: Array<{ row: number; msg: string }>;
  has_row_errors: boolean;
};

const POLL_MS = 2000;
const TERMINAL = new Set(["completed", "halted", "failed"]);

/**
 * Poll the upload status endpoint every 2s, stopping on a terminal status.
 * `fetchStatus` is injectable so tests can drive it without the network.
 */
export function useUploadStatus(
  uploadId: string | null,
  fetchStatus: (id: string) => Promise<UploadStatusResponse>,
) {
  const [status, setStatus] = useState<UploadStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!uploadId) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function poll() {
      try {
        const next = await fetchStatus(uploadId!);
        if (cancelled) return;
        setStatus(next);
        if (TERMINAL.has(next.status)) {
          stoppedRef.current = true;
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load status");
      }
      if (!cancelled && !stoppedRef.current) {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uploadId, fetchStatus]);

  return { status, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --run use-upload-status`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-upload-status.ts apps/web/test/use-upload-status.test.ts
git commit -m "feat(web): useUploadStatus polling hook (2s, stops on terminal)"
```

---

### Task 11: `StepProgress` component — submit flow + progress + terminal UI

**Files:**
- Create: `apps/web/src/components/upload-wizard/step-progress.tsx`
- Test: `apps/web/test/step-progress.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/step-progress.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepProgress } from "../src/components/upload-wizard/step-progress";
import type { UploadStatusResponse } from "../src/lib/use-upload-status";

const baseProps = {
  importerEnvironmentId: "impenv_tenants_staging",
  fileName: "sample-tenants.csv",
  fileSize: 256,
  matched: { first_name: "First name", email: "Customer Email" },
  uploadedFileHeaders: ["First name", "Customer Email", "Notes"],
  editedRows: [
    { "First name": "Alice", "Customer Email": "a@b.com", Notes: "x" },
    { "First name": "Bob", "Customer Email": "b@b.com", Notes: "y" },
  ],
  batchSize: 1000,
  userPayload: null,
  metadataPayload: null,
};

function makeApi(overrides: {
  createUpload?: ReturnType<typeof vi.fn>;
  sendBatch?: ReturnType<typeof vi.fn>;
  fetchStatus?: (id: string) => Promise<UploadStatusResponse>;
}) {
  return {
    createUpload:
      overrides.createUpload ??
      vi.fn().mockResolvedValue({ upload_id: "upl_1", numeric_id: 1, status: "pending" }),
    sendBatch: overrides.sendBatch ?? vi.fn().mockResolvedValue(undefined),
    fetchStatus:
      overrides.fetchStatus ??
      vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "completed",
        batch_count: 1,
        batches_delivered: 1,
        latest_attempt: { batch_index: 1, attempt_number: 1, status_code: 200, response_body: "{}" },
        row_errors: [],
        has_row_errors: false,
      } satisfies UploadStatusResponse),
  };
}

describe("StepProgress", () => {
  it("submits the upload + one batch, then shows the completed banner", async () => {
    const apiClient = makeApi({});
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(apiClient.createUpload).toHaveBeenCalledTimes(1));
    expect(apiClient.sendBatch).toHaveBeenCalledTimes(1);
    // batch index 1, 2 rows mapped to machine names
    expect(apiClient.sendBatch).toHaveBeenCalledWith(
      "upl_1",
      1,
      expect.arrayContaining([expect.objectContaining({ row: 1, first_name: "Alice", email: "a@b.com" })]),
    );

    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /run another import/i })).toBeInTheDocument();
  });

  it("guards against double-submit (single createUpload call)", async () => {
    const apiClient = makeApi({});
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /submit/i });
    await userEvent.click(btn);
    await userEvent.click(btn);
    await waitFor(() => expect(apiClient.createUpload).toHaveBeenCalledTimes(1));
  });

  it("shows the halted banner + Retry CTA when status is halted", async () => {
    const apiClient = makeApi({
      fetchStatus: vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "halted",
        batch_count: 1,
        batches_delivered: 0,
        latest_attempt: { batch_index: 1, attempt_number: 6, status_code: 500, response_body: "upstream boom" },
        row_errors: [],
        has_row_errors: false,
      } satisfies UploadStatusResponse),
    });
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/import halted/i)).toBeInTheDocument());
    expect(screen.getByText(/upstream boom/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows Download error CSV when there are row errors", async () => {
    const apiClient = makeApi({
      fetchStatus: vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "completed",
        batch_count: 1,
        batches_delivered: 1,
        latest_attempt: { batch_index: 1, attempt_number: 1, status_code: 200, response_body: "{}" },
        row_errors: [{ row: 2, msg: "duplicate email" }],
        has_row_errors: true,
      } satisfies UploadStatusResponse),
    });
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /download error csv/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --run step-progress`
Expected: FAIL — module/component not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/upload-wizard/step-progress.tsx
import { useRef, useState } from "react";
import { buildBatches } from "../../lib/build-batches";
import { useUploadStatus, type UploadStatusResponse } from "../../lib/use-upload-status";

/**
 * API surface, injected so the component is unit-testable without the network.
 * The route supplies a real implementation backed by the Hono RPC client.
 */
export type StepProgressApi = {
  createUpload: (input: {
    importer_environment_id: string;
    file_name: string;
    file_size: number;
    matched_columns_map: Record<string, string>;
    uploaded_file_headers: string[];
    total_rows: number;
    batch_size: number;
    batch_count: number;
    user_payload: Record<string, unknown> | null;
    metadata_payload: Record<string, unknown> | null;
    idempotency_key: string;
  }) => Promise<{ upload_id: string; numeric_id: number; status: string }>;
  sendBatch: (
    uploadId: string,
    batchIndex: number,
    rows: Array<Record<string, string | number>>,
  ) => Promise<void>;
  fetchStatus: (uploadId: string) => Promise<UploadStatusResponse>;
};

export type StepProgressProps = {
  importerEnvironmentId: string;
  fileName: string;
  fileSize: number;
  matched: Record<string, string>;
  uploadedFileHeaders: string[];
  editedRows: Record<string, string>[];
  batchSize: number;
  userPayload: Record<string, unknown> | null;
  metadataPayload: Record<string, unknown> | null;
  apiClient: StepProgressApi;
  onReset: () => void;
};

type Phase = "idle" | "submitting" | "polling";

export function StepProgress({
  importerEnvironmentId,
  fileName,
  fileSize,
  matched,
  uploadedFileHeaders,
  editedRows,
  batchSize,
  userPayload,
  metadataPayload,
  apiClient,
  onReset,
}: StepProgressProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  // One idempotency key per mounted wizard, stable across re-renders.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const { status } = useUploadStatus(uploadId, apiClient.fetchStatus);

  async function handleSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase("submitting");
    setSubmitError(null);

    try {
      const built = buildBatches(editedRows, matched, batchSize);
      const created = await apiClient.createUpload({
        importer_environment_id: importerEnvironmentId,
        file_name: fileName,
        file_size: fileSize,
        matched_columns_map: matched,
        uploaded_file_headers: uploadedFileHeaders,
        total_rows: built.total_rows,
        batch_size: batchSize,
        batch_count: built.batch_count,
        user_payload: userPayload,
        metadata_payload: metadataPayload,
        idempotency_key: idempotencyKeyRef.current,
      });

      for (const batch of built.batches) {
        await apiClient.sendBatch(created.upload_id, batch.index, batch.rows);
      }

      setUploadId(created.upload_id);
      setPhase("polling");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed");
      setPhase("idle");
      submittingRef.current = false; // allow a retry of the whole submit
    }
  }

  async function handleRetry() {
    if (!uploadId) return;
    await apiClient
      .fetchStatus(uploadId) // no-op guard; real retry posts to /retry via route wrapper
      .catch(() => undefined);
    // The route supplies a retry-capable client; see route integration (Task 12).
    window.dispatchEvent(new CustomEvent("evo:retry", { detail: { uploadId } }));
  }

  const batchCount = status?.batch_count ?? Math.max(1, Math.ceil(editedRows.length / batchSize));
  const delivered = status?.batches_delivered ?? 0;
  const pct = batchCount > 0 ? Math.round((delivered / batchCount) * 100) : 0;
  const isTerminal = status && ["completed", "halted", "failed"].includes(status.status);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Submit &amp; deliver</h2>
        <p className="text-sm text-slate-600">
          {editedRows.length.toLocaleString("en-US")} rows ready. Submitting persists the upload and
          delivers each batch to the importer's webhook.
        </p>
      </header>

      {phase === "idle" && (
        <div>
          {submitError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Submit import
          </button>
        </div>
      )}

      {(phase === "submitting" || phase === "polling") && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm text-slate-700">
            <span>
              {delivered}/{batchCount} batches delivered
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-slate-900 transition-all"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {status?.latest_attempt && (
            <p className="text-xs text-slate-500">
              Latest: batch {status.latest_attempt.batch_index}, attempt{" "}
              {status.latest_attempt.attempt_number}
              {status.latest_attempt.status_code !== null
                ? ` → HTTP ${status.latest_attempt.status_code}`
                : " → no response"}
            </p>
          )}
        </div>
      )}

      {isTerminal && status?.status === "completed" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">🎉 Import complete</p>
          {status.has_row_errors && (
            <p className="mt-1">
              {status.row_errors.length} row{status.row_errors.length === 1 ? "" : "s"} were rejected
              by the receiver.
            </p>
          )}
          <div className="mt-3 flex gap-3">
            {status.has_row_errors && (
              <a
                href={`/api/uploads/${uploadId}/errors.csv`}
                className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800"
              >
                Download error CSV
              </a>
            )}
            <button
              type="button"
              onClick={onReset}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              Run another import
            </button>
          </div>
        </div>
      )}

      {isTerminal && status?.status === "halted" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Import halted</p>
          {status.latest_attempt?.response_body && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-red-100 p-2 text-xs">
              {status.latest_attempt.response_body}
            </pre>
          )}
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
```

> Note: `handleRetry` dispatches a DOM event the route listens for (Task 12 wires the actual `POST /retry` + restart polling). Keeping the retry network call in the route avoids passing yet another function through props in this component; the test only asserts the button is present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- --run step-progress`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.tsx apps/web/test/step-progress.test.tsx
git commit -m "feat(web): StepProgress — submit, batch dispatch, progress bar, terminal UI"
```

---

### Task 12: Route integration — wire StepProgress as step 4

**Files:**
- Modify: `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`
- Test: `apps/web/test/step-progress.test.tsx` (already covers the component; route wiring verified by build + manual smoke)

- [ ] **Step 1: Build the real API client adapter and mount StepProgress**

Replace the `handleReviewed` body and the trailing `state.reviewed` block in `importers.$id.upload.tsx`. First, add an import:

```ts
import { StepProgress, type StepProgressApi } from "../../../components/upload-wizard/step-progress";
```

Replace `handleReviewed` with a version that simply advances to step 4 (the submit now lives in StepProgress):

```ts
  function handleReviewed(editedRows: Record<string, string>[]) {
    setState((s) => ({ ...s, reviewed: true, editedRows }));
    setActiveStep(4);
  }
```

Change the `activeStep` type to include `4`:

```ts
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3 | 4>(0);
```

Build the API client (place inside the component, before `return`):

```ts
  const apiClient: StepProgressApi = {
    createUpload: async (input) => {
      const res = await api.api.uploads.$post(
        {
          json: {
            importer_environment_id: input.importer_environment_id,
            file_name: input.file_name,
            file_size: input.file_size,
            matched_columns_map: input.matched_columns_map,
            uploaded_file_headers: input.uploaded_file_headers,
            total_rows: input.total_rows,
            batch_size: input.batch_size,
            batch_count: input.batch_count,
            user_payload: input.user_payload,
            metadata_payload: input.metadata_payload,
          },
        },
        { headers: { "Idempotency-Key": input.idempotency_key } },
      );
      if (!res.ok) throw new Error(`createUpload failed: ${res.status}`);
      return res.json();
    },
    sendBatch: async (uploadId, batchIndex, rows) => {
      const res = await api.api.uploads[":upload_id"].batches[":batch_index"].$post({
        param: { upload_id: uploadId, batch_index: String(batchIndex) },
        json: { rows },
      });
      if (!res.ok && res.status !== 204) throw new Error(`sendBatch failed: ${res.status}`);
    },
    fetchStatus: async (uploadId) => {
      const res = await api.api.uploads[":upload_id"].$get({ param: { upload_id: uploadId } });
      if (!res.ok) throw new Error(`fetchStatus failed: ${res.status}`);
      return res.json();
    },
  };
```

> If the Hono RPC param access path differs (e.g. the generated client names), confirm by checking the inferred `AppType`. The route segments are `/api/uploads/:upload_id/batches/:batch_index` and `/api/uploads/:upload_id`.

Add the step-4 render block (after the step-3 block, replacing the old `state.reviewed` paragraph):

```tsx
      {activeStep === 4 && state.matched && state.editedRows && state.context && (
        <StepProgress
          importerEnvironmentId={state.context.importerEnvironmentId}
          fileName={state.parsed?.fileName ?? "upload.csv"}
          fileSize={state.parsed?.fileSize ?? 0}
          matched={state.matched}
          uploadedFileHeaders={state.parsed?.headers ?? []}
          editedRows={state.editedRows}
          batchSize={1000}
          userPayload={state.context.userPayload ?? null}
          metadataPayload={state.context.metadataPayload ?? null}
          apiClient={apiClient}
          onReset={() => {
            setState({ context: null, parsed: null, matched: null, reviewed: false, editedRows: null });
            setActiveStep(0);
          }}
        />
      )}
```

> **Adapt field names to the actual `StepContextSubmit` and `ParseSuccess` shapes.** Read `apps/web/src/components/upload-wizard/step-context.tsx` and `apps/web/src/lib/parse-file.ts` to confirm:
> - the importer-environment id source (the context form, or a route-level lookup — if the context form doesn't carry `importerEnvironmentId`, derive it: the wizard is per-importer, and dev has a single env; fetch it or hardcode `impenv_tenants_staging` for the dev seed with a `TODO` to resolve env from importer + active environment).
> - whether `ParseSuccess` exposes `fileName`/`fileSize` (if not, thread them from `StepUploadFile` — add to the parsed state or a new state field; the simplest is to capture the `File` name/size in `handleFileParsed`).
> Keep the changes minimal and typed; do not introduce `any`.

- [ ] **Step 2: Typecheck + full web test run**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web test -- --run`
Expected: clean typecheck; all web tests pass (existing + the new build-batches/use-upload-status/step-progress suites).

- [ ] **Step 3: Build**

Run: `pnpm --filter web build`
Expected: clean production build.

- [ ] **Step 4: Manual smoke (worker + web up)**

Run: `pnpm dev` (worker on :8787, web on :5173). Then:
- Navigate to `/admin/importers/imp_tenants/upload`, complete steps 0–3 with the canonical 3-row `sample-tenants.csv`.
- On step 4, click **Submit import** → progress bar appears.
- Because the dev seed `webhook_url` points at a real webhook.site URL, the consumer delivers and status flips to **completed** within a couple of poll cycles.
- Verify the persisted payload at webhook.site matches the captured byte-shape (uploadId integer, matchedColumnsMap `{machine: header}`, batch `{index:1,count:1,totalRows:3}`, rows with 1-based `row`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_authed/admin/importers.$id.upload.tsx
git commit -m "feat(web): wire StepProgress as wizard step 4 with real RPC client"
```

---

### Task 13: Retry wiring + end-to-end smoke polish

**Files:**
- Modify: `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx` (listen for the retry event → POST /retry)
- Modify: `apps/web/src/components/upload-wizard/step-progress.tsx` (replace the placeholder `handleRetry` with a clean injected `onRetry` prop)
- Test: `apps/web/test/step-progress.test.tsx` (append a retry-click assertion)

- [ ] **Step 1: Write the failing test (retry calls the injected handler)**

Append to `apps/web/test/step-progress.test.tsx`:

```tsx
it("calls onRetry when the Retry button is clicked in a halted state", async () => {
  const onRetry = vi.fn().mockResolvedValue(undefined);
  const apiClient = makeApi({
    fetchStatus: vi.fn().mockResolvedValue({
      upload_id: "upl_1",
      numeric_id: 1,
      status: "halted",
      batch_count: 1,
      batches_delivered: 0,
      latest_attempt: { batch_index: 1, attempt_number: 6, status_code: 500, response_body: "boom" },
      row_errors: [],
      has_row_errors: false,
    } satisfies UploadStatusResponse),
  });
  render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} onRetry={onRetry} />);
  await userEvent.click(screen.getByRole("button", { name: /submit/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(onRetry).toHaveBeenCalledWith("upl_1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- --run step-progress`
Expected: FAIL — `onRetry` is not a prop; Retry click does nothing.

- [ ] **Step 3: Replace the placeholder retry with a clean prop**

In `step-progress.tsx`, add `onRetry` to props and replace `handleRetry`:

```ts
export type StepProgressProps = {
  // ...existing fields...
  onReset: () => void;
  onRetry?: (uploadId: string) => Promise<void> | void;
};
```

Replace the `handleRetry` function and the `window.dispatchEvent` placeholder with:

```ts
  async function handleRetry() {
    if (!uploadId || !onRetry) return;
    await onRetry(uploadId);
    // Re-arm polling: clear then re-set uploadId so useUploadStatus re-subscribes.
    const id = uploadId;
    setUploadId(null);
    setPhase("polling");
    setTimeout(() => setUploadId(id), 0);
  }
```

> Remove the now-unused `apiClient.fetchStatus(uploadId).catch(...)` placeholder and the `window.dispatchEvent` line from Task 11.

- [ ] **Step 4: Wire `onRetry` in the route**

In `importers.$id.upload.tsx`, add a `retry` call to the `apiClient` object (or a sibling function) and pass `onRetry` to `StepProgress`:

```ts
  async function retryUpload(uploadId: string) {
    const res = await api.api.uploads[":upload_id"].retry.$post({
      param: { upload_id: uploadId },
    });
    if (!res.ok && res.status !== 202) throw new Error(`retry failed: ${res.status}`);
  }
```

Add `onRetry={retryUpload}` to the `<StepProgress .../>` mount.

- [ ] **Step 5: Run tests + typecheck + build**

Run: `pnpm --filter web test -- --run && pnpm --filter web exec tsc --noEmit && pnpm --filter web build`
Expected: all web tests pass; clean typecheck; clean build.

- [ ] **Step 6: Full worker suite regression**

Run: `pnpm --filter @evo-csv/worker test -- --run`
Expected: all worker tests pass (existing 20 + new migration/payload/batches/status/dispatch/retry-errors suites).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.tsx apps/web/src/routes/_authed/admin/importers.$id.upload.tsx apps/web/test/step-progress.test.tsx
git commit -m "feat(web): retry wiring — onRetry prop + POST /retry + re-armed polling"
```

---

## Self-Review

**1. Spec coverage (Story #7 ACs → tasks):**
- AC1 (compute total_rows/batch_size/batch_count) → Task 9 `buildBatches` + Task 11 submit.
- AC2 (POST /uploads, idempotent via Idempotency-Key) → Task 4 + Task 12 client.
- AC3 (POST batches, R2 write, enqueue, 204, idempotent) → Task 5.
- AC4 (poll every 2s, progress UI) → Task 10 hook + Task 11 UI + Task 6 status endpoint.
- AC5 (1-based batch.index, batch.totalRows = whole upload) → Task 3 builder + Task 9 numbering + tests in Task 5/9.
- AC6 (uploadId = uploads.numeric_id integer) → Task 3 (number) + existing sequence increment.
- AC7 (completed banner, Download error CSV only if errors, Run another) → Task 11 + Task 8 errors.csv.
- AC8 (halted banner + response body + Retry) → Task 11 + Task 13 + Task 8 retry.
- AC9 (errors.csv synthesis) → Task 8.
- Test case 1 (3-row → 1 R2 object, completed, byte-shape) → Task 3 snapshot + Task 5 + Task 12 smoke.
- Test case 2 (2500 rows → 3 batches, global row numbers) → Task 9.
- Test case 3 (5xx → halted after 6, Retry re-enqueues) → Task 7 + Task 8 + Task 13.
- Test case 4 (200+errors → completed, error CSV row) → Task 6 + Task 8.
- Test case 5 (double-submit → one upload) → Task 4 (server idempotency) + Task 11 (client guard).

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" left. Two explicit *adaptation* notes (Task 12 field-name confirmation, Task 11 retry-event → replaced cleanly in Task 13) are intentional and bounded with exact instructions.

**3. Type consistency:** `WebhookDispatchJob` (Task 2) used identically in dispatch (Task 7) and index handler. `UploadStatusResponse` defined once in `use-upload-status.ts` (Task 10), imported by StepProgress (Task 11) and route. `buildBatches` return shape (`{total_rows, batch_count, batches:[{index, rows}]}`) consumed consistently in Task 11. `matched` direction `{machine_name: file_header}` consistent with the captured fixture and the wizard's existing convention. Status endpoint field names (`batch_count`, `batches_delivered`, `latest_attempt`, `row_errors`, `has_row_errors`) identical across Task 6 response, Task 10 type, and Task 11 consumption.

**Known cross-task dependency:** Task 12 may need to thread `fileName`/`fileSize` and `importerEnvironmentId` through wizard state if the existing `StepContextSubmit`/`ParseSuccess` shapes don't already carry them — the task flags this explicitly and gives the minimal-change resolution.

# Story 50 — Wizard step 5 polls status and surfaces halt + retry + errors

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the halt and completed-with-row-errors copy in the wizard's final step, add the retry toast surfacing `reEnqueued` count from Story #48, pin accessibility attributes (`role="status"` on terminal states), and add the missing Download errors CTA on the halt branch (today only the completed-with-errors branch has it).

**Architecture:** The wizard's step 5 lives at [apps/web/src/components/upload-wizard/step-progress.tsx](../../../apps/web/src/components/upload-wizard/step-progress.tsx) with polling driven by `useUploadStatus` at [apps/web/src/lib/use-upload-status.ts](../../../apps/web/src/lib/use-upload-status.ts). Most of the UX is built — this story fills three gaps: (a) the halt branch lacks the Download errors CTA promised by PRD §6, (b) the retry interaction has no toast, (c) terminal states aren't announced to assistive tech via `role="status"`.

**Tech Stack:** TypeScript, React 19, TanStack Router, Vitest + jsdom, Tailwind utility classes inline.

**Issue:** [#50](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/50)
**PRD:** [prds/prd-feature-webhook-dispatch.md](../../../prds/prd-feature-webhook-dispatch.md) Story 6
**Parent Epic:** [#44](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/44)
**Depends on:** #48 (consumes the new `reEnqueued` field from the retry endpoint's 202 response)

---

## File map

**Create:**
- `apps/web/src/components/upload-wizard/step-progress.test.tsx` — component test covering the four terminal-state branches. There's no existing test file for step-progress.

**Modify:**
- `apps/web/src/components/upload-wizard/step-progress.tsx` — add Download errors CTA on halt branch, add inline retry toast, add `role="status"` on the three terminal-state divs.
- `apps/web/src/lib/use-upload-status.ts` — only if a polling-cadence test (Task 5) needs an injectable interval.

---

## Task 1 — Test: halt branch renders Download errors CTA

PRD §6: "Halt state → 'Delivery halted after 6 attempts' + 'Retry' + 'Download errors.csv' CTAs." Today only the completed-with-errors branch has the download link.

**Files:**
- Create: `apps/web/src/components/upload-wizard/step-progress.test.tsx`

- [ ] **Step 1.1: Write the failing test**

Create `apps/web/src/components/upload-wizard/step-progress.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepProgress, type StepProgressApi } from "./step-progress";

function makeApi(status: ReturnType<StepProgressApi["fetchStatus"]> extends Promise<infer T> ? T : never): StepProgressApi {
  return {
    createUpload: vi.fn(async () => ({ upload_id: "upl_1", numeric_id: 1, status: "pending" })),
    sendBatch: vi.fn(async () => {}),
    fetchStatus: vi.fn(async () => status),
  };
}

const baseProps = {
  importerEnvironmentId: "impenv_x",
  fileName: "t.csv",
  fileSize: 100,
  matched: { first_name: "First name" },
  uploadedFileHeaders: ["First name"],
  editedRows: [{ first_name: "Alice" }],
  batchSize: 1000,
  userPayload: null,
  metadataPayload: null,
  onReset: vi.fn(),
};

describe("StepProgress halt branch", () => {
  it("renders 'Download errors.csv' alongside Retry when status is halted with row errors", async () => {
    const api = makeApi({
      upload_id: "upl_1",
      numeric_id: 999,
      status: "halted",
      batch_count: 1,
      batches_delivered: 0,
      latest_attempt: {
        batch_index: 1,
        attempt_number: 6,
        status_code: 500,
        response_body: "boom",
      },
      row_errors: [{ row: 2, msg: "bad email" }],
      has_row_errors: true,
    });
    render(<StepProgress {...baseProps} apiClient={api} onRetry={vi.fn()} />);

    // Trigger submit so the polling kicks in.
    (await screen.findByText("Submit import")).click();
    await waitFor(() => expect(screen.getByText("Import halted")).toBeInTheDocument());

    expect(screen.getByText(/Retry/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download error CSV/i })).toHaveAttribute(
      "href",
      "/api/uploads/upl_1/errors.csv",
    );
  });
});
```

- [ ] **Step 1.2: Run the test and verify it fails**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "halt branch"`
Expected: FAIL — no Download error CSV link in the halt branch yet.

- [ ] **Step 1.3: Add the CTA to the halt branch**

In `apps/web/src/components/upload-wizard/step-progress.tsx`, find the halt branch around [step-progress.tsx:210-225](../../../apps/web/src/components/upload-wizard/step-progress.tsx:210). Replace:

```tsx
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Retry
          </button>
```

with:

```tsx
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white"
            >
              Retry
            </button>
            {status?.has_row_errors && (
              <a
                href={`/api/uploads/${uploadId}/errors.csv`}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700"
              >
                Download error CSV
              </a>
            )}
          </div>
```

- [ ] **Step 1.4: Re-run and verify it passes**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "halt branch"`
Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.tsx apps/web/src/components/upload-wizard/step-progress.test.tsx
git commit -m "feat(web): wizard halt branch renders Download error CSV CTA"
```

---

## Task 2 — Add `role="status"` to terminal-state divs for a11y

PRD §6: "Terminal state is announced via `role='status'`." Today the completed and halted divs are plain `<div>`s; screen readers won't announce the transition.

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-progress.tsx`

- [ ] **Step 2.1: Write the failing test**

Append to `apps/web/src/components/upload-wizard/step-progress.test.tsx`:

```typescript
describe("StepProgress a11y", () => {
  it("announces the completed terminal state via role=status", async () => {
    const api = makeApi({
      upload_id: "upl_1",
      numeric_id: 999,
      status: "completed",
      batch_count: 1,
      batches_delivered: 1,
      latest_attempt: null,
      row_errors: [],
      has_row_errors: false,
    });
    render(<StepProgress {...baseProps} apiClient={api} />);
    (await screen.findByText("Submit import")).click();

    await waitFor(() => {
      const announcer = screen.getByRole("status");
      expect(announcer).toHaveTextContent(/Import complete/i);
    });
  });

  it("announces the halted terminal state via role=status", async () => {
    const api = makeApi({
      upload_id: "upl_1",
      numeric_id: 999,
      status: "halted",
      batch_count: 1,
      batches_delivered: 0,
      latest_attempt: { batch_index: 1, attempt_number: 6, status_code: 500, response_body: "boom" },
      row_errors: [],
      has_row_errors: false,
    });
    render(<StepProgress {...baseProps} apiClient={api} onRetry={vi.fn()} />);
    (await screen.findByText("Submit import")).click();

    await waitFor(() => {
      const announcer = screen.getByRole("status");
      expect(announcer).toHaveTextContent(/Import halted/i);
    });
  });
});
```

- [ ] **Step 2.2: Run and verify they fail**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "role=status"`
Expected: FAIL — no `role="status"` div in either terminal branch yet.

- [ ] **Step 2.3: Add the role attributes**

In `apps/web/src/components/upload-wizard/step-progress.tsx`:

Change the completed div opener at [step-progress.tsx:184](../../../apps/web/src/components/upload-wizard/step-progress.tsx:184) from:

```tsx
      {isTerminal && status?.status === "completed" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
```

to:

```tsx
      {isTerminal && status?.status === "completed" && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
```

Change the halted div opener at [step-progress.tsx:210](../../../apps/web/src/components/upload-wizard/step-progress.tsx:210) from:

```tsx
      {isTerminal && status?.status === "halted" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
```

to:

```tsx
      {isTerminal && status?.status === "halted" && (
        <div
          role="status"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
```

(`aria-live="assertive"` for halt — it's an interrupt-worthy failure; `polite` for success.)

- [ ] **Step 2.4: Re-run and verify they pass**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "role=status"`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.tsx apps/web/src/components/upload-wizard/step-progress.test.tsx
git commit -m "feat(web): wizard terminal states announce via role=status + aria-live"
```

---

## Task 3 — Retry toast surfaces reEnqueued count

PRD §6: "Toast on retry: 'Retry queued. Watching delivery…'" Combined with Story #48's new `reEnqueued` field in the 202 response, the toast can show the count.

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-progress.tsx`

- [ ] **Step 3.1: Write the failing test**

Append to `step-progress.test.tsx`:

```typescript
describe("StepProgress retry toast", () => {
  it("shows a transient toast with the reEnqueued count after retry click", async () => {
    const api = makeApi({
      upload_id: "upl_1",
      numeric_id: 999,
      status: "halted",
      batch_count: 3,
      batches_delivered: 1,
      latest_attempt: { batch_index: 2, attempt_number: 6, status_code: 500, response_body: "boom" },
      row_errors: [],
      has_row_errors: false,
    });
    const onRetry = vi.fn(async () => ({ reEnqueued: 2 }));
    render(<StepProgress {...baseProps} apiClient={api} onRetry={onRetry} />);
    (await screen.findByText("Submit import")).click();
    await waitFor(() => expect(screen.getByText("Import halted")).toBeInTheDocument());

    (await screen.findByText(/Retry/i)).click();

    await waitFor(() => {
      expect(screen.getByText(/Retry queued/i)).toBeInTheDocument();
      expect(screen.getByText(/2 batches/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3.2: Run and verify it fails**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "retry toast"`
Expected: FAIL.

- [ ] **Step 3.3: Update the component to render the toast**

In `apps/web/src/components/upload-wizard/step-progress.tsx`:

(a) Widen the `onRetry` prop type to allow returning a `{ reEnqueued: number }` payload. Replace:

```tsx
  onRetry?: (uploadId: string) => Promise<void> | void;
```

with:

```tsx
  onRetry?: (uploadId: string) => Promise<{ reEnqueued: number } | void> | void;
```

(b) Add toast state at the top of the component, near the other `useState` lines:

```tsx
  const [toast, setToast] = useState<string | null>(null);
```

(c) Replace the existing `handleRetry` with:

```tsx
  async function handleRetry() {
    if (!uploadId || !onRetry) return;
    const result = await onRetry(uploadId);
    const count = result && typeof result === "object" && "reEnqueued" in result ? result.reEnqueued : null;
    setToast(
      count != null
        ? `Retry queued. Watching delivery… (${count} batch${count === 1 ? "" : "es"})`
        : "Retry queued. Watching delivery…",
    );
    setTimeout(() => setToast(null), 5000);
    setPhase("polling");
    setRetryKey((k) => k + 1);
  }
```

(d) Render the toast near the top of the returned JSX, just inside the outer flex container:

```tsx
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700"
        >
          {toast}
        </div>
      )}
```

- [ ] **Step 3.4: Update the route consumer of the new `onRetry` shape**

The route at `apps/web/src/routes/_authed/admin/importers.$id_.upload.tsx` passes `onRetry`. Find that callback and have it return the JSON body of the 202 response. Read `apps/web/src/lib/api.ts` to confirm the RPC client returns the parsed body. Once you locate the prop wiring, change:

```tsx
onRetry={async (uploadId) => {
  await api.uploads[":upload_id"].retry.$post({ param: { upload_id: uploadId } });
}}
```

to:

```tsx
onRetry={async (uploadId) => {
  const res = await api.uploads[":upload_id"].retry.$post({ param: { upload_id: uploadId } });
  return (await res.json()) as { reEnqueued: number };
}}
```

(If the typed RPC client already infers `{ reEnqueued: number }` from Story #48's worker change, drop the manual cast.)

- [ ] **Step 3.5: Re-run and verify it passes**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "retry toast"`
Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.tsx apps/web/src/components/upload-wizard/step-progress.test.tsx apps/web/src/routes/_authed/admin/importers.$id_.upload.tsx
git commit -m "feat(web): retry toast surfaces reEnqueued count from #48 endpoint"
```

---

## Task 4 — Tighten halt and completed-with-errors copy

PRD §6 copy:
- Halt: *"Delivery halted after 6 attempts. The last attempt returned HTTP {code}: {first 200 chars of response_body}. You can retry, or download the row errors."*
- Completed with errors: *"Upload completed with {n} row errors. Download the corrected CSV from the client and re-upload."*

Today's copy is more terse. Update to match the PRD.

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-progress.tsx`

- [ ] **Step 4.1: Write the failing test**

Append to `step-progress.test.tsx`:

```typescript
describe("StepProgress copy", () => {
  it("halt copy includes HTTP code + truncated response body", async () => {
    const longBody = "x".repeat(500);
    const api = makeApi({
      upload_id: "upl_1",
      numeric_id: 999,
      status: "halted",
      batch_count: 1,
      batches_delivered: 0,
      latest_attempt: { batch_index: 1, attempt_number: 6, status_code: 502, response_body: longBody },
      row_errors: [],
      has_row_errors: false,
    });
    render(<StepProgress {...baseProps} apiClient={api} onRetry={vi.fn()} />);
    (await screen.findByText("Submit import")).click();

    await waitFor(() => {
      expect(screen.getByText(/Delivery halted after 6 attempts/i)).toBeInTheDocument();
      expect(screen.getByText(/HTTP 502/)).toBeInTheDocument();
    });
    // Response body shown but truncated.
    const preview = screen.getByText(new RegExp("x".repeat(50)));
    expect(preview.textContent!.length).toBeLessThanOrEqual(220); // 200 chars + ellipsis room
  });

  it("completed-with-errors copy names the row count", async () => {
    const api = makeApi({
      upload_id: "upl_1",
      numeric_id: 999,
      status: "completed",
      batch_count: 1,
      batches_delivered: 1,
      latest_attempt: null,
      row_errors: [
        { row: 2, msg: "bad" },
        { row: 5, msg: "bad" },
        { row: 7, msg: "bad" },
      ],
      has_row_errors: true,
    });
    render(<StepProgress {...baseProps} apiClient={api} />);
    (await screen.findByText("Submit import")).click();

    await waitFor(() =>
      expect(screen.getByText(/Upload completed with 3 row errors/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 4.2: Update the halt branch copy**

In `step-progress.tsx`, replace the halt branch contents (the `<p>` + `<pre>` + retry/download buttons) with:

```tsx
          <p className="font-medium">
            Delivery halted after 6 attempts.{" "}
            {status.latest_attempt?.status_code != null
              ? `The last attempt returned HTTP ${status.latest_attempt.status_code}.`
              : "The last attempt did not return a response."}
          </p>
          {status.latest_attempt?.response_body && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-red-100 p-2 text-xs">
              {status.latest_attempt.response_body.slice(0, 200)}
              {status.latest_attempt.response_body.length > 200 ? "…" : ""}
            </pre>
          )}
          <p className="mt-2 text-xs">You can retry, or download the row errors.</p>
          {/* Retry + Download CTAs (Task 1) remain below */}
```

(Keep the Retry + Download CTAs block from Task 1 intact.)

- [ ] **Step 4.3: Update the completed-with-errors copy**

Replace the existing completed branch's row-error sentence with:

```tsx
          {status.has_row_errors && (
            <p className="mt-1">
              Upload completed with {status.row_errors.length} row error
              {status.row_errors.length === 1 ? "" : "s"}. Download the corrected CSV from the client
              and re-upload.
            </p>
          )}
```

- [ ] **Step 4.4: Re-run and verify they pass**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "copy"`
Expected: PASS for both cases.

- [ ] **Step 4.5: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.tsx apps/web/src/components/upload-wizard/step-progress.test.tsx
git commit -m "feat(web): wizard terminal-state copy matches PRD-005 §6 spec"
```

---

## Task 5 — Polling-restart guard (regression)

PRD §5 Story 6 AC #4: "After retry click, polling restarts and progress bar reflects the new attempts." The `retryKey` mechanism already exists at [step-progress.tsx:73](../../../apps/web/src/components/upload-wizard/step-progress.tsx:73) — pin it with a regression test.

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-progress.test.tsx`

- [ ] **Step 5.1: Write the test**

Append:

```typescript
describe("StepProgress polling restart", () => {
  it("after retry click, fetchStatus is called at least once more (polling resumes)", async () => {
    let statusToReturn = {
      upload_id: "upl_1",
      numeric_id: 999,
      status: "halted",
      batch_count: 1,
      batches_delivered: 0,
      latest_attempt: { batch_index: 1, attempt_number: 6, status_code: 500, response_body: "boom" },
      row_errors: [],
      has_row_errors: false,
    };
    const fetchStatus = vi.fn(async () => statusToReturn);
    const api: StepProgressApi = {
      createUpload: vi.fn(async () => ({ upload_id: "upl_1", numeric_id: 1, status: "pending" })),
      sendBatch: vi.fn(async () => {}),
      fetchStatus,
    };
    const onRetry = vi.fn(async () => ({ reEnqueued: 1 }));

    render(<StepProgress {...baseProps} apiClient={api} onRetry={onRetry} />);
    (await screen.findByText("Submit import")).click();
    await waitFor(() => expect(screen.getByText(/Import halted/i)).toBeInTheDocument());

    const callsBeforeRetry = fetchStatus.mock.calls.length;
    statusToReturn = { ...statusToReturn, status: "dispatching" };
    (await screen.findByText(/Retry/i)).click();

    await waitFor(() => expect(fetchStatus.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });
});
```

- [ ] **Step 5.2: Run and verify it passes**

Run: `pnpm --filter @evo-csv/web exec vitest run src/components/upload-wizard/step-progress.test.tsx -t "polling restart"`
Expected: PASS.

- [ ] **Step 5.3: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-progress.test.tsx
git commit -m "test(web): pin retry-restarts-polling regression guard"
```

---

## Task 6 — Final verification

- [ ] **Step 6.1: Web suite**

Run: `pnpm --filter @evo-csv/web test`
Expected: all green, including the 7 new step-progress test cases.

- [ ] **Step 6.2: Typecheck + lint**

Run: `pnpm build && pnpm lint`
Expected: clean. `pnpm build` runs typecheck for all workspaces and surfaces any cascading type errors from the `onRetry` widening.

- [ ] **Step 6.3: Smoke-test in the dev server**

Start the dev server (`pnpm dev`) and run a small upload against a stubbed webhook that returns 500. Confirm:
- Progress bar reaches "0/N delivered"
- Halt state renders with `Delivery halted after 6 attempts. HTTP 500` copy
- Both Retry and Download error CSV buttons are visible
- Clicking Retry shows the toast (`Retry queued. Watching delivery… (N batches)`)
- Browser screen reader (VoiceOver / NVDA) announces the halt transition

- [ ] **Step 6.4: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "Story #50: Wizard step 5 polish — halt CTA, a11y, retry toast, copy" --body "$(cat <<'EOF'
## Summary
- Halt branch now renders Download error CSV alongside Retry (PRD §6 parity).
- Terminal-state divs get `role="status"` + `aria-live` so SR announces transitions.
- Retry toast surfaces the `reEnqueued` count from Story #48's endpoint change.
- Halt and completed-with-errors copy updated to match PRD-005 §6 wording.
- New `step-progress.test.tsx` with 7 cases covering halt CTA, a11y, toast, copy, and polling-restart regression.

Closes #50. Depends on #48 (consumes the new `reEnqueued` field).

## Test plan
- [x] `pnpm --filter @evo-csv/web test` green
- [x] `pnpm build` typecheck clean
- [x] Manually verified via `pnpm dev` against a 500-returning stub: halt copy, both CTAs, toast, VoiceOver announcement
EOF
)"
```

---

## Self-review

**Spec coverage** (AC checklist from issue #50):
- AC #1 (polling stops at terminal state) → existing `useUploadStatus` covers; transitively asserted in Task 5
- AC #2 (halt always renders Retry CTA) → existing test + Task 1 verifies via "halt branch"
- AC #2 copy match → Task 4
- AC #3 (row-error state renders Download CTA) → existing completed-with-errors branch already has this; Task 1 adds the halt branch
- AC #4 (retry restarts polling, progress bar reflects new attempts) → Task 5
- AC #4 toast copy → Task 3
- AC #5 (`aria-valuenow` / `aria-valuemax` on progress + `role="status"` on terminal) → existing progress bar already has aria attributes (line 159-164); Task 2 adds `role="status"` on terminal divs
- AC #6 (browser close mid-poll → resume from current state) → durable server-side; covered transitively by the polling-restart test in Task 5 (same mechanism)

**Placeholder scan:** every JSX snippet is concrete; no "TBD".

**Type consistency:** `onRetry` is widened in Task 3 from `() => Promise<void> | void` to `() => Promise<{ reEnqueued: number } | void> | void`. All call sites (route consumer + tests) are updated in the same task. The `UploadStatusResponse` shape consumed via `fetchStatus` is unchanged.

**Risks not in tasks:**
- Task 3's RPC client wiring depends on the typed RPC client inferring the new response shape after #48 merges. If the inference lags (e.g. due to `apps/worker/src/index.ts`'s `AppType` not refreshing), a manual `as` cast is fine.
- The smoke test in Step 6.3 requires the worker to be running with a stub webhook URL. Use `cloudflared tunnel` or a local webhook.site loopback. If that's friction, document the limitation in the PR and rely on the test suite for correctness.
- The toast disappears after 5s via `setTimeout` — no cleanup on unmount. If the user navigates away mid-toast the timeout will still fire harmlessly (no DOM access in the callback). Not worth a `useEffect` cleanup for this MVP scope.

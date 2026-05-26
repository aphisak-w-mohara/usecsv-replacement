# Feature PRD — Upload Wizard

**Trigger:** Use this when you are about to build a specific user flow or feature.
**Output:** A build-ready spec that can be handed directly to AI code generation or a developer.

**ID:** PRD-002
**Type:** Feature
**Parent PRD:** PRD-001 evo-csv
**Author:** Aphisak Naksomboon
**Date:** 2026-05-26
**Status:** Draft — Pending Review
**Target release:** Q3 2026 (TBC)
**Version:** 1.0

## Version history
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-05-26 | Aphisak Naksomboon | Initial draft |

## 1. Context

The **upload wizard** is the day-one user-facing flow of evo-csv — the reason the tool exists. A Mohara dev team member opens it with a client CSV in hand, walks through five steps, and lands the rows in EVO's Laravel backend via a backward-compatible webhook. Without this flow, every other capability in the product is plumbing.

This PRD covers the **SPA + API ingestion surface only** — file pick through "Submit" plus the API endpoints the SPA calls. The downstream **webhook dispatch pipeline** (Queue consumer that drains batches to Laravel) is a sibling feature PRD (forthcoming). The wizard hands off cleanly: when Submit completes, the upload is persisted and N batch jobs are enqueued; rendering progress depends on the dispatch pipeline writing `webhook_attempts` rows the SPA polls.

**Parent PRD:** [PRD-001 evo-csv](./prd-high-evo-csv.md)
**Feature area:** Upload / import flow

## 2. Scope

### What is being built

A logged-in member opens `/admin/importers/:id/upload`, optionally adds upload context (ticket ref, note), drops a CSV/XLSX, sees fuzzy-matched columns with per-cell validation, edits errors inline, and submits. The SPA parses the file client-side (so PII never reaches our servers until validation passes), then chunks the parsed rows into per-batch POSTs to the API. The API persists each batch to R2 and enqueues one Queue job per batch. The wizard then polls a status endpoint until the dispatch pipeline reports `completed` or `halted`.

### What is not being built (out of scope)

- Webhook dispatch to Laravel (sibling PRD)
- HMAC signing logic (lives in the dispatch pipeline)
- Importer/column configuration UI (sibling PRD)
- Streaming/web-worker parse for > 50k rows (deferred)
- Excel formula evaluation (values only)
- Multi-file uploads in one wizard run (one file per upload)
- Resume-from-failure UX (if browser closes mid-submit, the upload is lost; user re-runs)
- onData callback delivery mode

**Sign-off:** [ ] Approved by Aphisak Naksomboon on [date]

## 3. Current State vs Desired End State

|  | Description |
|---|---|
| **Current state** | Dev team uses usecsv.com's hosted modal. They configure an importer on usecsv.com, paste the client's CSV, walk through usecsv's 4-step wizard, and usecsv POSTs to our Laravel webhook. We have no audit trail of who ran what, no per-environment routing, the secret is sent plaintext, and we pay a vendor for it. |
| **Desired end state** | Dev team opens our own `app.<domain>/admin/importers/:id/upload`, fills in optional ticket context, walks through 5 steps, and the same byte-identical webhook payload lands at Laravel. Audit trail captured (who, when, which env, which ticket). usecsv.com is decommissioned for Tenants/Properties imports. |

## 4. Permissions Impact

| Role | Can do | Cannot do |
|---|---|---|
| **Owner** | Run uploads in any environment (implicit access to all envs) | — |
| **Member with env access** | Run uploads in environments they're granted access to | Run uploads in envs they don't have a grant for (route returns 404, not 403, to avoid leaking env existence) |
| **Member without env access** | Nothing in this flow | Even reach `/admin/importers/:id/upload` for the selected env — `withEnvironment` middleware blocks |

The wizard inherits its env context from the top-nav environment switcher. Switching environments mid-wizard discards in-progress wizard state and re-routes.

## 5. User Stories & Acceptance Criteria

---

### Story 1 — Member fills in upload context

**User story**
As a Mohara dev team member, I want to attach a ticket reference and free-text note to my upload so that the resulting webhook payload carries audit context Laravel can log alongside the imported rows.

**Detailed flow**
1. Member navigates to `/admin/importers/:id/upload`. Active env shown in the nav (e.g. "staging").
2. Wizard opens at **Step 0: Upload context**.
3. Form fields:
   - **Ticket reference** (optional, free text — e.g. `EVO-1234`)
   - **Note** (optional, multiline free text — e.g. "Onboarding Smith Property Group, batch 1 of 3")
   - **User payload (JSON)** (optional, advanced — defaults collapsed; auto-populated with `{"userId": "<signed-in-email>"}` when collapsed)
   - **Metadata payload (JSON)** (optional, advanced)
4. Member clicks **Next**. The wizard advances to Step 1.
5. Context is held in client state only until Submit — not persisted until the upload is created.

**Edge cases & error states**
- All fields are optional — member can click Next immediately and skip the context entirely. `user_payload` still auto-fills `{"userId": <email>}` server-side at upload creation if the field is empty.
- Invalid JSON in the advanced fields → inline error "Not valid JSON" on the relevant textarea; Next is disabled until fixed.
- JSON payloads larger than 4 KB are rejected with "Payload too large — keep it under 4 KB."

**Acceptance criteria**
1. Member can navigate to `/admin/importers/:id/upload` and see Step 0 with all four fields.
2. Member can leave all fields empty and proceed to Step 1.
3. Invalid JSON in `user_payload` or `metadata_payload` blocks Next with a clear inline error.
4. The auto-filled `userId` field is the signed-in member's email, sourced from the session, not the client.
5. The context is carried through the wizard and included in the final upload payload (verified at submit time).

**Test cases**
1. Submit with all fields empty → final webhook payload's `user` is `{"userId": "<member email>"}` and `metadata` is `null`.
2. Submit with `ticket_reference = "EVO-1234"` and `note = "test"` → final webhook payload's `metadata` is `{"ticket_reference": "EVO-1234", "note": "test"}`.
3. Submit with custom `user_payload = {"userId": "custom-id", "role": "ops"}` → that exact JSON object is the webhook payload's `user` (no `userId` injection from session if member explicitly set it).
4. Paste invalid JSON `{foo: bar}` → Next button disabled, inline error visible.

---

### Story 2 — Member uploads a CSV/XLSX file

**User story**
As a member, I want to drop a CSV or XLSX file onto the wizard and see a preview of its rows so that I can confirm it's the right file before mapping columns.

**Detailed flow**
1. **Step 1: Upload File** shows a drop zone with text "Drag and drop your file here, or click to browse." Allowed extensions listed below: `.csv`, `.tsv`, `.xlsx`, `.xls`.
2. Above the drop zone: a "First row is a header" checkbox (default checked) and an "Encoding" dropdown (default "Auto-detect (UTF-8)").
3. Member drops/selects a file. SPA parses client-side with PapaParse (for csv/tsv) or SheetJS (for xlsx/xls).
4. Parsed preview renders below the drop zone: a read-only table with the original file headers and up to the first 100 rows.
5. Footer shows: detected encoding, file name, total row count, file size.
6. **Next** button enabled.
7. "Upload a different file" button reverts to Step 1.

**Edge cases & error states**
- File > 50,000 rows → reject with "This file has X rows. The current limit is 50,000 — split it and run again." Next disabled.
- File > 25 MB raw → reject with same approach.
- File with no rows (only headers, or completely empty) → "This file has no data rows."
- File where the first row doesn't look like headers (e.g. all numeric) AND "First row is a header" is checked → soft warning "This row doesn't look like a header — uncheck 'First row is a header' if these are data."
- XLSX with multiple sheets → use the first sheet; show "Using sheet: <name>. (Multi-sheet workbooks not supported yet.)"
- XLSX with formulas → SheetJS resolves values; ignore formula text. Formulas that evaluate to errors (#N/A, #REF!) are shown as the error string and the cell is flagged red later in Step 3.
- Encoding misdetection → member can manually pick from the dropdown.

**Acceptance criteria**
1. Member can drop or click-to-browse any of: `.csv`, `.tsv`, `.xlsx`, `.xls`.
2. Files > 50k rows or > 25 MB are rejected with a clear, actionable error.
3. Preview shows up to 100 rows in the original file's column order.
4. Detected encoding is shown; the member can override before continuing.
5. "Upload a different file" returns to the empty drop-zone state without losing Step 0 context.
6. Parsing is fully client-side — no file bytes leave the browser during this step (verifiable in network panel).

**Test cases**
1. Drop a 3-row CSV with mismatched headers ("First name", "Last name", "Customer Email") + an extra "Notes" column → preview shows all 4 columns and 3 rows correctly.
2. Drop a 51,000-row CSV → rejected with row-count error.
3. Drop an XLSX with 3 sheets → only the first sheet's data is parsed; banner names the sheet used.
4. Drop a CSV in ISO-8859-1 with characters that misdetect as UTF-8 → member can manually pick "ISO 8859-1 Latin 1" and re-preview.

---

### Story 3 — Member maps columns to the importer schema

**User story**
As a member, I want the wizard to auto-suggest a column mapping and let me adjust any wrong ones, so that I don't have to manually map every column for routine imports.

**Detailed flow**
1. **Step 2: Match Columns** shows the same preview table as Step 1, but each column header now has a dropdown.
2. Each dropdown contains: the importer's columns (by display name), an "Ignore this column" option, and a "—" default.
3. On entry, the SPA runs a fuzzy matcher (`match-sorter` on lowercased strings) and pre-selects the best match per column. Confidence > threshold → green outline; below → yellow outline + tooltip "Please confirm".
4. The member can click any dropdown to override the choice.
5. A banner shows match status: "All required columns matched" (green) or "Missing required: Customer Email" (red).
6. Required importer columns that aren't mapped block **Next**. Hovering Next shows "Match all required columns to continue."
7. A column can only be mapped to one importer column at a time — selecting a column that's already taken auto-unsets the previous mapping.

**Edge cases & error states**
- File has fewer columns than required importer columns → red banner lists what's missing; Next blocked.
- File has more columns than importer (like our test "Notes") → those columns default to "Ignore" — explicitly visible to the member.
- Two file columns fuzzy-match to the same importer column → SPA picks the higher-confidence one and leaves the other unmapped.
- Member maps two file columns to the same importer column manually → second selection wins; first auto-unsets.

**Acceptance criteria**
1. On entering Step 2, all file columns have a sensible auto-suggestion or are explicitly set to "Ignore".
2. All required importer columns must be mapped before Next is enabled.
3. The match status banner accurately reflects the current state (counts of matched required, missing required, ignored).
4. Changing a mapping updates the banner in real time without re-fetching from the server.
5. The `matchedColumnsMap` derived from these selections has the **shape `{ <importer_column_name>: <original_file_header> }`** — keys are machine names, values are raw headers — verified against the empirical fixture at `captured-payloads/2026-05-26-usecsv-live-webhook.json`.

**Test cases**
1. CSV headers `["First name", "Last name", "Customer Email", "Notes"]` against importer columns `first_name`, `last_name`, `email` → auto-match all three to display names; Notes defaults to Ignore; banner says "All required columns matched."
2. Member manually unmaps `Customer Email` → banner switches to "Missing required: Customer Email"; Next disabled.
3. Member maps both `First name` and `Notes` to `first_name` → only `Notes` ends up mapped; `First name` is set to "Ignore".
4. Resulting matched map for the canonical case is `{"first_name": "First name", "last_name": "Last name", "email": "Customer Email"}` — direction matches empirical capture exactly.

---

### Story 4 — Member reviews and edits validation errors

**User story**
As a member, I want to see which rows and cells have validation errors and edit them inline before submitting, so that I can land as much clean data as possible in one pass.

**Detailed flow**
1. **Step 3: Review & Edit** shows a virtualized grid (TanStack Table + TanStack Virtual) of all parsed rows, with mapped columns only (unmatched columns hidden unless `include_unmatched_columns` is on).
2. Each cell is validated against its importer column's validation format (string, number, date with format, phone, email, regex, select, boolean). Errors highlighted red; warnings yellow.
3. Above the grid: a summary chip — e.g. `4,317 rows · 23 errors · 6 warnings`. A "Show only errors" filter toggles a filtered view.
4. Cells are click-to-edit. On edit, validation runs immediately and the cell's status updates.
5. A separate red banner appears if the importer has `disable_importing_all_data_if_there_are_invalid_rows` enabled and any errors remain: "Imports with errors are blocked for this importer — fix all errors to continue."
6. If `filter_invalid_rows` is enabled (importer config), invalid rows are silently excluded from the final submit; a footer shows "X rows will be excluded due to errors."
7. **Next** button enabled unless the "disable if invalid" rule applies and errors remain.

**Edge cases & error states**
- Email validation: same regex pattern as usecsv (RFC 5322 lite) — verifiable against the importer's "Email" validation format. If `allowDisplayName` is on (column setting), accept `Alice Smith <alice@example.com>`.
- Date validation: format string from `importer_columns.validation_format` (e.g. `27/03/1998`). Invalid → red.
- Number: `,` and `.` allowed (matches usecsv's number validator).
- Required column blank → red.
- Cell value > 64 KB → reject the edit, keep the previous value, show toast "Cell too large."
- Editing a cell triggers re-validation only for that cell, not the whole grid (perf).
- Filtering to "errors only" with 0 errors → empty state "🎉 No errors. Click Submit to import."

**Acceptance criteria**
1. The grid renders 50k rows smoothly (target: < 200 ms initial paint, scroll at 60 fps on a mid-range laptop).
2. Per-cell validation status is correct for all eight importer validation formats.
3. Inline edits update validation status in place without re-rendering the entire grid.
4. The "Show only errors" filter accurately includes/excludes rows.
5. The "disable if invalid" rule (when set on the importer) blocks Next while errors remain.
6. When `filter_invalid_rows` is true, the footer count accurately reflects what will be submitted.

**Test cases**
1. Load 3-row Tenants CSV with one bad email `not-an-email` → that one cell is red, summary shows `3 rows · 1 error`; "Show only errors" filters to that single row.
2. Edit the bad email to `valid@example.com` → cell goes green, summary shows `3 rows · 0 errors`.
3. Set importer's `filter_invalid_rows = true`, leave one row bad → footer reads "1 row will be excluded due to errors."
4. Set importer's `disable_importing_all_data_if_there_are_invalid_rows = true`, leave one row bad → Next disabled with explicit banner.

---

### Story 5 — Member submits and watches progress

**User story**
As a member, I want to submit the validated rows and see live progress as each batch is delivered, so that I know when the import is complete and what (if anything) Laravel rejected.

**Detailed flow**
1. **Step 4: Submit & Progress** opens on click of "Submit" in Step 3. The button is replaced by a progress UI; the grid collapses into a summary card.
2. The SPA computes `total_rows`, `batch_size` (default 1,000 from the importer-env config), and `batch_count = ceil(total_rows / batch_size)`.
3. SPA calls `POST /api/uploads` with: `importer_environment_id`, `file_name`, `total_rows`, `batch_size`, `batch_count`, `matched_columns_map`, `uploaded_file_headers`, `user_payload`, `metadata_payload`. API returns `{ upload_id, numeric_id }`.
4. SPA chunks the rows into batches and POSTs each: `POST /api/uploads/:upload_id/batches/:batch_index`. Each batch POST returns immediately after R2 write + queue enqueue (no waiting on Laravel here).
5. Once all batches are submitted, SPA starts polling `GET /api/uploads/:upload_id` every 2 seconds.
6. Progress UI shows: a bar `<delivered>/<batch_count> batches`, plus a "Latest response" pane showing per-batch status (200/halted/retrying) and any `errors[]` rows returned from Laravel.
7. When status flips to `completed`: success banner, "Download error CSV" button if any per-row errors were returned, "Run another import" CTA.
8. When status flips to `halted`: red banner with the failing batch's last response body, "Retry" button (triggers `POST /api/uploads/:upload_id/retry`), and a "Mark as failed" button (owner-only).

**Edge cases & error states**
- Network drops between batch POSTs → SPA retries each batch POST up to 3 times with backoff (10s, 30s, 90s). After 3 failures, surface "Upload interrupted — re-run the wizard for the remaining rows."
- API returns 413 (batch too large) → SPA halves `batch_size` and retries that batch. Logged.
- API returns 409 (duplicate batch_index) → SPA treats as success and moves on (idempotent — server already has it).
- Polling returns `dispatching` for > 10 minutes without progress → show "This is taking longer than expected. Check Webhook attempts in the importer detail page for details" with a link.
- Browser tab closes during submit → in-flight batches succeed (already in R2 + queue), the upload's status is what it is. Re-opening the importer detail page shows the upload in whatever state the dispatch pipeline left it.

**Acceptance criteria**
1. Submit produces exactly `batch_count` rows in R2 under `uploads/<upload_id>/batches/<batch_index>.json` and exactly `batch_count` enqueued Queue messages.
2. The webhook payload that ends up in R2 for each batch (and therefore on the wire) matches the empirical fixture's shape — verified by the snapshot test at the worker layer.
3. `batch.index` in each batch payload is **1-based** (1, 2, ..., batch_count); final batch satisfies `batch.index === batch.count`.
4. `uploadId` in each batch payload is a positive integer sourced from `uploads.numeric_id`.
5. Progress polling reflects real `webhook_attempts` rows; the SPA does not simulate progress.
6. Per-row errors returned by Laravel appear in the progress UI with row number and message, and are downloadable as a CSV.
7. The "Retry" CTA on a halted upload calls `POST /api/uploads/:upload_id/retry`, which re-enqueues failed batches without recreating R2 objects.

**Test cases**
1. Submit a 3-row CSV → 1 R2 object, 1 Queue message, 1 webhook attempt, status flips Pending → Dispatching → Completed. Final webhook payload byte-shape matches captured fixture.
2. Submit a 2,500-row CSV with `batch_size=1000` → 3 batches, last has 500 rows, `batch.index` runs 1/2/3, `batch.count=3`, `totalRows=2500`. Each batch's `rows[i].row` is the source-file 1-based row number across the whole file.
3. Simulate Laravel returning 500 on batch 2 → status goes Halted after 6 attempts; UI shows the response body; clicking Retry re-enqueues only batch 2.
4. Simulate Laravel returning 200 with `{errors: [{row: 17, msg: "duplicate email"}]}` → upload still completes; UI shows "1 row failed in Laravel" and lets the user download an error CSV containing row 17 with its data + the error message.

---

## 6. UI / UX Requirements

- **Screen states per step**: `idle`, `loading`, `error`, `success`. Step 1 has an additional `parsing` state with a determinate progress bar (PapaParse exposes a progress callback for chunked parsing).
- **Wizard chrome**: fixed footer with Back + Next buttons, step indicator at top (matches usecsv's visual pattern — see `usecsv-screenshots/05-importer-modal-step1.png`). Back is disabled on Step 0 and after Submit.
- **Error message copy** is plain, action-oriented:
  - "This file has 53,412 rows. The current limit is 50,000 — split it and run again."
  - "Missing required column: Customer Email. Match it in the dropdown above to continue."
  - "Not a valid email address."
- **Empty states**:
  - Step 1: large drop-zone with sample CSV download link.
  - Step 3 with "Show only errors" filter active and 0 errors: "🎉 No errors. Click Submit to import."
- **Interactions**:
  - Drop zone: hover state, drag-over state, dropped state, parsing state.
  - Cell editing: single-click to edit; Tab/Enter to commit; Esc to cancel.
  - Progress bar: animated with smooth easing as batches complete.
- **Accessibility**:
  - All form controls have associated labels.
  - The review grid supports keyboard navigation (arrow keys to move cell focus, Enter to edit).
  - Color is not the only signal of validation status — every error/warning cell has an icon and a tooltip.

## 7. Data & Schema Changes

This feature uses tables defined in PRD-001's data model. No new tables. New endpoints below; no modified endpoints.

**New endpoints (all `POST`/`GET` JSON; all under `requireSession` + `withProject` + `withEnvironment`):**

- `POST /api/uploads` — body: `{ importer_environment_id, file_name, total_rows, batch_size, batch_count, matched_columns_map, uploaded_file_headers, user_payload, metadata_payload }` → `{ upload_id, numeric_id, status: 'pending' }`. Idempotent via client-generated `idempotency_key` header.
- `POST /api/uploads/:upload_id/batches/:batch_index` — body: `{ rows: [...] }` → `204 No Content`. `batch_index` 1-based. Writes to R2, then enqueues a `WebhookDispatchJob`. Idempotent on `(upload_id, batch_index)` — duplicate calls write to R2 (overwrite) and re-enqueue (queue dedupes via message body hash).
- `GET /api/uploads/:upload_id` — returns `{ upload_id, status, batch_count, batches_delivered, latest_attempt, errors_summary }`. Used for progress polling.
- `POST /api/uploads/:upload_id/retry` — re-enqueues any halted batches. Returns the updated upload row.
- `GET /api/uploads/:upload_id/errors.csv` — streams a CSV of `(row_number, row_data..., error_message)` from `webhook_attempts.errors_json`.

**Storage:**
- Source file uploaded to R2 at `uploads/<upload_id>/source.<ext>` — written by `POST /api/uploads` from a multipart sub-request OR (preferred for MVP) the SPA re-uploads the file alongside the first batch POST.
- Each batch JSON body to R2 at `uploads/<upload_id>/batches/<batch_index>.json`.
- D1 rows: one in `uploads`, one in `sequences` increment, N rows in `webhook_attempts` (written by the dispatch pipeline, not this feature).

## 8. Technical Notes

**Stack & libraries (locked from PRD-001 / design spec):**
- React 19 + Vite 8 + TanStack Router + TanStack Query + TanStack Table + TanStack Virtual
- Tailwind v4 + Radix primitives
- **PapaParse** for CSV/TSV streaming parse
- **SheetJS** (`xlsx-js-style`) for XLSX/XLS (note: loads full file into memory; the 50k-row cap exists for this reason)
- **match-sorter** for fuzzy column matching
- Hono RPC client (`hc<AppType>`) for typed API calls

**Codebase scan:** This is a greenfield repo — only docs and reference artefacts so far. No existing implementations of this flow to extend or replace. The `evo-laravel-server` reference confirms the row-key contract (`first_name`, `last_name`, `email`, `mobile_number`, `property_id`, `organisation`, etc. — see PRD-001 §13 and the design spec's webhook contract section for the full list).

**Reference artefacts in this repo:**
- `captured-payloads/2026-05-26-usecsv-live-webhook.json` — the empirical fixture this feature's snapshot test must match.
- `usecsv-screenshots/05-importer-modal-step1.png` etc. — visual references for the wizard layout.
- `sample-tenants.csv` — the canonical 3-row test input used in the live capture; reuse as the seed fixture for unit/integration tests.

**Known constraints:**
- PapaParse + SheetJS run on the main thread. The 50k-row hard cap exists to prevent UI freezes; web-worker streaming is deferred (PRD-001 non-goals).
- Hono RPC types must flow from worker to web via `import type { AppType } from "@evo-csv/worker"`. The web package imports types but never runtime code from the worker package.
- The `idempotency_key` header on `POST /api/uploads` prevents duplicate upload rows if the SPA double-clicks Submit during a network blip.
- `webhook_attempts` rows are written by the dispatch pipeline (sibling PRD). The polling endpoint reads them but doesn't create them.
- The `numeric_id` field on `uploads` is generated via the `sequences` table (see PRD-001 macro data model + the design spec's M5 note).

**Out-of-scope assumptions this feature depends on:**
- The dispatch pipeline correctly reads `uploads/<upload_id>/batches/<batch_index>.json` from R2, signs (if enabled), and writes `webhook_attempts` rows.
- The importer + importer-environment configuration UI exists so a member can navigate to `/admin/importers/:id/upload`.
- Auth + env grants are enforced — this feature trusts `requireSession` + `withEnvironment` to gate access.

## 9. Platform-Specific Rules

Desktop-only. Mobile is out of scope (the review grid requires real estate). Minimum supported viewport: 1280×720. Below that, a placeholder message: "evo-csv is best used on a desktop. Open this URL on a larger screen."

Browsers: latest two versions of Chrome, Edge, Firefox, Safari. No IE/legacy support.

## 10. Linked Issues / PRDs

- **Parent:** [PRD-001 evo-csv](./prd-high-evo-csv.md)
- **Siblings (forthcoming feature PRDs):**
  - Auth & bootstrap (Google SSO + CLI seed)
  - Importer CRUD + per-env config (admin surface that this wizard navigates from)
  - Webhook dispatch pipeline (Queue consumer + retry/halt; the downstream half of Story 5)
- **Design spec:** [`docs/superpowers/specs/2026-05-26-usecsv-clone-design.md`](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md) — full technical reference (data model, queue message shape, repo layout)
- **Empirical reference:** [`captured-payloads/2026-05-26-usecsv-live-webhook.json`](../captured-payloads/2026-05-26-usecsv-live-webhook.json)

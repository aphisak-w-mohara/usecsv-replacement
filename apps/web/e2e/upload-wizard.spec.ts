import { fileURLToPath } from "node:url";
import { expect, request, test } from "@playwright/test";

/**
 * Full operator journey: sign-in (dev seam) → 5-step upload wizard → the worker
 * dispatches the batch → our local catcher receives the locked webhook payload.
 *
 * This is the "on behalf of an actual user" flow: every step below is a real
 * click/type/upload in a real browser against the real worker, not a mocked API.
 */

const WORKER = "http://localhost:8787";
const CATCHER = "http://localhost:9099";
const CSV = fileURLToPath(new URL("./fixtures/sample-tenants.csv", import.meta.url));

const IMPORTER_ID = "imp_tenants";
const ENV_ID = "env_evo_staging"; // seeded default environment

test.beforeAll(async () => {
  const ctx = await request.newContext();
  // Clean slate for the catcher, and point the importer's webhook at it (the
  // operator would do this once via the Environments tab; we set it via the same
  // API the tab calls). Auth is the worker's local DEV_EMAIL seam — no header.
  await ctx.post(`${CATCHER}/__reset`);
  const put = await ctx.put(`${WORKER}/api/importers/${IMPORTER_ID}/environments/${ENV_ID}`, {
    data: { webhook_url: `${CATCHER}/hook`, batch_size: 1000 },
  });
  expect(put.ok()).toBeTruthy();
  await ctx.dispose();
});

test("operator imports tenants end-to-end and the webhook is delivered", async ({ page }) => {
  // The wizard is a flat top-level route (no importer-detail chrome). Direct nav
  // is how the app reaches it today; the _authed gate admits us via the dev seam.
  await page.goto(`/admin/importers/${IMPORTER_ID}/upload`);

  // ---- Step 1 of 5: Context ---------------------------------------------------
  await expect(page.getByRole("heading", { name: "Upload context" })).toBeVisible();
  await page.getByPlaceholder("EVO-1234").fill("EVO-123");
  await page.getByPlaceholder(/Onboarding Smith Property Group/).fill("E2E import");
  await page.getByRole("button", { name: "Next" }).click();

  // ---- Step 2 of 5: Upload file ----------------------------------------------
  await expect(page.getByRole("heading", { name: "Upload file" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(CSV);
  // Parsing is client-side; the preview surfaces the file name + row count.
  await expect(page.getByText("sample-tenants.csv")).toBeVisible();
  await expect(page.getByText("2 rows")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // ---- Step 3 of 5: Match columns --------------------------------------------
  await expect(page.getByRole("heading", { name: "Match columns" })).toBeVisible();
  // Headers equal the importer display names, so the fuzzy matcher pre-selects
  // them; set explicitly anyway to mirror an operator confirming each mapping.
  await page.getByLabel("Map column First name").selectOption("first_name");
  await page.getByLabel("Map column Last name").selectOption("last_name");
  await page.getByLabel("Map column Customer Email").selectOption("email");
  await expect(page.getByText(/3 of 3 required matched/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // ---- Step 4 of 5: Review & submit ------------------------------------------
  await expect(page.getByRole("heading", { name: "Review & submit" })).toBeVisible();
  await expect(page.getByText("alice@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // ---- Step 5 of 5: Submit & deliver -----------------------------------------
  await page.getByRole("button", { name: /submit import/i }).click();
  await expect(page.getByText(/import complete/i)).toBeVisible({ timeout: 30_000 });

  // ---- Assert the worker actually delivered the locked webhook payload --------
  const ctx = await request.newContext();
  const res = await ctx.get(`${CATCHER}/__captured`);
  const captured = (await res.json()) as {
    body: {
      fileName: string;
      importerId: string;
      matchedColumnsMap: Record<string, string>;
      batch: { index: number; count: number; totalRows: number };
      user: { userId: string };
      metadata: Record<string, unknown>;
      rows: Record<string, string>[];
    };
  }[];
  await ctx.dispose();

  expect(captured).toHaveLength(1);
  const { body } = captured[0]!;
  expect(body.fileName).toBe("sample-tenants.csv");
  expect(body.importerId).toBe("82b18e5e-6412-4102-901a-ce3c05d71460"); // seeded env key
  expect(body.matchedColumnsMap).toEqual({
    first_name: "First name",
    last_name: "Last name",
    email: "Customer Email",
  });
  expect(body.batch).toEqual({ index: 1, count: 1, totalRows: 2 });
  expect(body.user.userId).toBe("aphisak@mohara.co"); // injected from the dev seam identity
  expect(body.metadata).toMatchObject({ ticket_reference: "EVO-123", note: "E2E import" });
  // The wizard tags each row with its 1-based source position (`row`) — part of
  // the locked payload the EVO Laravel side expects.
  expect(body.rows).toEqual([
    { row: 1, first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
    { row: 2, first_name: "Bob", last_name: "Jones", email: "bob@example.com" },
  ]);
});

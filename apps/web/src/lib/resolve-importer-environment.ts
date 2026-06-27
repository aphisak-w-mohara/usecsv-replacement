/**
 * Resolves the `importer_environment_id` the upload wizard must send to
 * `POST /api/uploads`, given the rows returned by
 * `GET /api/importers/:importer_id/environments` and the environment the
 * operator explicitly selected in the upload flow's env picker.
 *
 * The wizard knows the importer id from the route; the target
 * importer_environment is `(importer_id, selected environment)`. We pick the row
 * whose `env_id` matches the selected environment and read its
 * `importer_environment.id`.
 *
 * Three outcomes the caller must handle:
 *  - `resolved`     — the selected env has a configured importer_environment.
 *  - `not-configured` — the selected env exists for the importer but has no
 *                       importer_environment yet (operator must configure a
 *                       webhook URL on the Environments tab first).
 *  - `not-found`    — the selected env isn't among the importer's environments
 *                     (shouldn't happen for a selectable env, but guard it).
 */

/** Minimal shape of one row from GET /api/importers/:importer_id/environments. */
export type ImporterEnvironmentRow = {
  env_id: string;
  importer_environment: { id: string } | null;
};

export type ResolveResult =
  | { status: "resolved"; importerEnvironmentId: string }
  | { status: "not-configured" }
  | { status: "not-found" };

export function resolveImporterEnvironmentId(
  rows: readonly ImporterEnvironmentRow[],
  selectedEnvironmentId: string,
): ResolveResult {
  const row = rows.find((r) => r.env_id === selectedEnvironmentId);
  if (!row) return { status: "not-found" };
  if (!row.importer_environment) return { status: "not-configured" };
  return { status: "resolved", importerEnvironmentId: row.importer_environment.id };
}

/**
 * Resolves the `importer_environment_id` the upload wizard must send to
 * `POST /api/uploads`, given the rows returned by
 * `GET /api/importers/:importer_id/environments` and the session's active
 * environment id (`me.environment_id`).
 *
 * The wizard only knows the importer id from the route; the target
 * importer_environment is `(importer_id, active environment)`. We pick the row
 * whose `env_id` matches the active environment and read its
 * `importer_environment.id`.
 *
 * Three outcomes the caller must handle:
 *  - `resolved`     — the active env has a configured importer_environment.
 *  - `not-configured` — the active env exists for the importer but has no
 *                       importer_environment yet (operator must configure a
 *                       webhook URL on the Environments tab first).
 *  - `not-found`    — the active env isn't among the importer's environments
 *                     (shouldn't happen for an accessible env, but guard it).
 */

/** Minimal shape of one row from GET /api/importers/:importer_id/environments. */
export type ImporterEnvironmentRow = {
  env_id: string;
  importer_environment: {
    id: string;
    batch_size: number;
    filter_invalid_rows: boolean;
  } | null;
};

export type ResolveResult =
  | {
      status: "resolved";
      importerEnvironmentId: string;
      batchSize: number;
      filterInvalidRows: boolean;
    }
  | { status: "not-configured" }
  | { status: "not-found" };

export function resolveImporterEnvironmentId(
  rows: readonly ImporterEnvironmentRow[],
  activeEnvironmentId: string,
): ResolveResult {
  const row = rows.find((r) => r.env_id === activeEnvironmentId);
  if (!row) return { status: "not-found" };
  if (!row.importer_environment) return { status: "not-configured" };
  return {
    status: "resolved",
    importerEnvironmentId: row.importer_environment.id,
    // Carry the env's configured delivery settings so the wizard honors them
    // instead of hardcoding defaults.
    batchSize: row.importer_environment.batch_size,
    filterInvalidRows: row.importer_environment.filter_invalid_rows,
  };
}

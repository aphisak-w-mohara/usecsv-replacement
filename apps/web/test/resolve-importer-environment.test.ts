import { describe, expect, it } from "vitest";
import {
  type ImporterEnvironmentRow,
  resolveImporterEnvironmentId,
} from "../src/lib/resolve-importer-environment";

const ROWS: ImporterEnvironmentRow[] = [
  { env_id: "env_staging", importer_environment: { id: "impenv_staging" } },
  { env_id: "env_prod", importer_environment: { id: "impenv_prod" } },
  { env_id: "env_unconfigured", importer_environment: null },
];

describe("resolveImporterEnvironmentId", () => {
  it("resolves the importer_environment id for the active environment", () => {
    expect(resolveImporterEnvironmentId(ROWS, "env_staging")).toEqual({
      status: "resolved",
      importerEnvironmentId: "impenv_staging",
    });
  });

  it("resolves a different importer_environment when the active env changes", () => {
    // Switching the active environment must change the target env id.
    expect(resolveImporterEnvironmentId(ROWS, "env_prod")).toEqual({
      status: "resolved",
      importerEnvironmentId: "impenv_prod",
    });
  });

  it("reports not-configured when the active env has no importer_environment", () => {
    expect(resolveImporterEnvironmentId(ROWS, "env_unconfigured")).toEqual({
      status: "not-configured",
    });
  });

  it("reports not-found when the active env isn't among the importer's environments", () => {
    expect(resolveImporterEnvironmentId(ROWS, "env_other_project")).toEqual({
      status: "not-found",
    });
  });

  it("never returns the seed default for a non-seed importer", () => {
    // Regression guard for #71: the wizard must not hardcode impenv_tenants_staging.
    const result = resolveImporterEnvironmentId(
      [{ env_id: "env_staging", importer_environment: { id: "impenv_custom" } }],
      "env_staging",
    );
    expect(result).toEqual({ status: "resolved", importerEnvironmentId: "impenv_custom" });
  });
});

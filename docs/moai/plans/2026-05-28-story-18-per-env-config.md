# Story #18 — Per-environment delivery config

> Stacked on `feature/17-column-reorder`.

## Worker
- `GET /api/importers/:importer_id/environments` — lists all envs in the importer's project + their `importer_environments` row (if any). Shape: `{ environments: [{ env_id, env_slug, env_name, configured: boolean, importer_environment?: { id, key, webhook_url, batch_size, filter_invalid_rows, include_unmatched_columns } }] }`.
- `PUT /api/importers/:importer_id/environments/:env_id` — upsert config.
  - Body: `{ webhook_url: string, batch_size?: number, filter_invalid_rows?: boolean, include_unmatched_columns?: boolean }`.
  - `webhook_url` validated http/https; `batch_size` in [1, 50000] (default 1000).
  - On first config: generate `key = crypto.randomUUID()`.
  - On update: never overwrite `key`.
  - Cross-project importer → 404; env not in project → 404.

## Web
- Replace the `tab === "environments"` placeholder with a sub-tab strip (one tab per project env) + an `EnvironmentConfigForm` for the selected env.
- Form fields: webhook URL, batch size (default 1000), `filter_invalid_rows` checkbox, `include_unmatched_columns` checkbox, read-only `key` field with a copy-to-clipboard button.
- Unconfigured env shows a "Configure this environment" empty state — same form, just no `key` yet (key appears after first save).

## Tests
- Worker: list (configured + unconfigured), PUT upsert + key persistence, batch_size range, bad URL, cross-project IDOR.
- Web: form basic interactions + copy button.

## Order
1. Worker GET + tests.
2. Worker PUT + tests.
3. Web env tab + tests.
4. Push, PR.

# Story #19 — Webhook signing + secret/key rotation

> Stacked on `feature/18-per-env-config`.

## Worker endpoints
All scoped to importer ∈ project, env ∈ project, AND an existing `importer_environments` row (404 otherwise — you can't sign before you configure):

1. `POST /api/importers/:importer_id/environments/:env_id/signing` — enable signing + generate secret. Returns `{ secret }` exactly once + `{ importer_environment }` mirror with `webhook_signing_enabled: true, secret_set: true`.
2. `POST /api/importers/:importer_id/environments/:env_id/rotate-secret` — replace secret, return new value once. Requires `webhook_signing_enabled = 1`.
3. `POST /api/importers/:importer_id/environments/:env_id/rotate-key` — generate new `key` UUID; UNIQUE collision → 500 (extremely improbable). Returns updated `importer_environment` (no secret).
4. `DELETE /api/importers/:importer_id/environments/:env_id/signing` — set `webhook_signing_enabled = 0` and clear `webhook_secret`.

Secret generation: `crypto.randomUUID()` — 36 chars, sufficient entropy for dev MVP per PRD-003 note ("at-rest encryption is out of scope").

## Web
Extend `environments-tab.tsx` (or add a small `SigningSection` component imported into it):
- Visible only when `envRow.configured`.
- States:
  - `signing_enabled = false`: a single "Enable signing" button. Click → POST signing → reveal modal.
  - `signing_enabled = true`: "Rotate secret", "Rotate key", "Disable signing" (with confirm dialog).
- Reveal modal: shows the raw secret in a monospace box, a "Copy" button, and a "Store this now — you won't see it again" warning. Closed via OK.

## Tests
- Worker: enable + secret is one-time + DB has secret; rotate-secret returns a different value; rotate-secret without signing enabled → 409; rotate-key changes the key, old key no longer resolves; disable clears secret; GET never returns raw secret (already covered); cross-project IDOR.
- Web: enable flow opens modal; disable flow toggles back to "Enable signing"; modal "Copy" actually puts the secret on the clipboard.

## Order
1. Worker endpoints + tests.
2. Web SigningSection + tests.
3. Push, PR.

# Runbook — Google OAuth + KV provisioning (go-live for auth)

Turnkey steps to take the PRD-004 auth stack (#39–#42) from "code complete" to a
working live sign-in. Everything here needs a **human** with Google Cloud +
Cloudflare account access — no code changes are expected.

Auth surface implemented by: [auth routes](../../apps/worker/src/routes/auth.ts),
[session store](../../apps/worker/src/lib/session.ts),
[requireSession](../../apps/worker/src/middleware/require-session.ts),
config in [wrangler.toml](../../apps/worker/wrangler.toml).

## What the code expects (the contract you're filling)

| Name | Where | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `[vars]` in wrangler.toml | OAuth client id (not secret) |
| `GOOGLE_CLIENT_SECRET` | `wrangler secret put` | OAuth client secret — **never** in wrangler.toml |
| `GOOGLE_REDIRECT_URI` | `[vars]` | must **exactly** equal the callback URL registered in Google |
| `APP_BASE_URL` | `[vars]` | SPA origin; used to build invite links |
| `ENVIRONMENT` | `[vars]` | anything other than `"local"` enables `Secure` + the `__Host-` cookie prefix (so prod **must** be HTTPS — Workers are) |
| `SESSIONS` | `[[kv_namespaces]]` | KV namespace id; currently the placeholder `REPLACE_WITH_KV_ID` |

Callback path is fixed in code: **`/api/auth/google/callback`**. Scopes:
`openid email profile`. The Google `hd` hint is sent automatically when the
project has an `allowed_email_domain` set.

## Steps

### 1. Google Cloud — OAuth client
1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → OAuth consent screen** → pick **Internal** if you're on a Google Workspace and want to lock to it (pairs with `allowed_email_domain`); otherwise External. Fill app name + support email.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorized redirect URIs** — add one per environment, each ending in `/api/auth/google/callback`:
   - local: `http://localhost:8787/api/auth/google/callback`
   - prod/staging: `https://<your-worker-domain>/api/auth/google/callback`
5. Copy the **Client ID** and **Client secret**.

### 2. Cloudflare — KV namespace
```bash
cd apps/worker
npx wrangler kv namespace create SESSIONS
# also create a preview ns for `wrangler dev` if you want non-simulated KV:
npx wrangler kv namespace create SESSIONS --preview
```
Paste the returned `id` (and `preview_id`) into the `[[kv_namespaces]]` block in
`apps/worker/wrangler.toml`, replacing `REPLACE_WITH_KV_ID`.

### 3. Vars + secret
In `apps/worker/wrangler.toml` set `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`
(the prod callback URL), `APP_BASE_URL` (the SPA origin), and `ENVIRONMENT`
(e.g. `production` — **not** `local`). Then:
```bash
cd apps/worker
npx wrangler secret put GOOGLE_CLIENT_SECRET   # paste the client secret
```
A deployed secret shadows any same-named `[vars]` value, so the fake
`GOOGLE_CLIENT_SECRET="test-secret"` used for local/tests is overridden in prod.

### 4. Deploy
```bash
pnpm --filter @evo-csv/worker deploy
```

### 5. Seed the first owner (closed signup has no open door)
A Google sign-in for an unknown email is rejected by design. Seed yourself first:
```bash
pnpm bootstrap --email you@yourco.com --project-slug evo --project-name EVO --remote
# optional: lock the workspace domain
pnpm bootstrap --email you@yourco.com --project-slug evo --project-name EVO \
  --allowed-email-domain yourco.com --remote
```
`--remote` targets the deployed D1. Bootstrap is idempotent (re-running upserts
your membership to `owner`).

### 6. Smoke test (the one live check that can't be automated)
1. Visit `https://<spa-origin>/login` → **Continue with Google** → consent.
2. You land on `/admin/importers`; the top bar shows your name + environment.
3. `GET /api/me` returns 200 with your owner session; **Logout** returns you to `/login`.
4. (If you set a domain) a non-matching Google account → 403 "not on the allowed workspace".

If all four pass, merge the auth stack (PR order **#61 → #62 → #63 → #64**).

## Gotchas
- **Redirect URI mismatch** is the #1 failure — `GOOGLE_REDIRECT_URI` must match the Google-registered URI byte-for-byte (scheme, host, path, no trailing slash).
- **`__Host-` cookie** requires HTTPS + `Secure` + `Path=/` + no `Domain`; it only engages when `ENVIRONMENT !== "local"`. Don't set `ENVIRONMENT=local` in prod or the cookie downgrades.
- **KV id placeholder** left as `REPLACE_WITH_KV_ID` → sign-in 500s on session write. Tests/`wrangler dev` simulate KV locally, so this only bites on deploy.
- Sessions are a rolling 14-day KV TTL; revoking access = delete the `session:*` key (or the user's memberships/grants).

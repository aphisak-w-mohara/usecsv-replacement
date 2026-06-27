# Runbook — Firebase Auth provisioning (go-live)

Turnkey operator steps to take the Firebase auth (PR #66, ADR-0001) from
code-complete to a working live sign-in. **No secrets to manage** — Firebase
verification uses public keys and the web config is public. Everything below
needs a human with the **dedicated Firebase project** + the **Cloudflare**
account; no code changes are expected.

Contract the code expects:

| Name | Where | Purpose |
|---|---|---|
| `FIREBASE_PROJECT_ID` | worker `[vars]` (prod) | token `iss`/`aud` check (`https://securetoken.google.com/<id>` + `aud=<id>`) |
| `ENVIRONMENT` | worker `[vars]` | must be `production` (the committed default) — always verifies tokens |
| `VITE_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` | web build env | public Firebase web SDK config |

## 1. Firebase project + providers
1. [console.firebase.google.com](https://console.firebase.google.com) → open the **dedicated** project (or "Add Firebase" to the GCP project you created for evo-csv). Keep it separate from the production EVO platform project.
2. **Build → Authentication → Get started.**
3. **Sign-in method → enable:**
   - **Google** (primary).
   - **Email/Password** → also toggle on **Email link (passwordless sign-in)** (the non-Google fallback).
4. **Authentication → Settings → Authorized domains** → add your SPA's prod domain (`localhost` is there by default for dev).

## 2. Web app config
The web app **"EVO UseCSV"** already exists in the `evo-usecsv` project. Set these
at build time (`apps/web/.env.production` locally, or your CI build vars — note
`.env*` is gitignored, so they're supplied per-build, not committed). All values
are **public** (Firebase web config ships in the browser bundle by design):
```
VITE_FIREBASE_API_KEY=AIzaSyAnZrT1ITmRCpiS62QlJT4WJJHXYUyOcv4
VITE_FIREBASE_AUTH_DOMAIN=evo-usecsv.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=evo-usecsv
VITE_FIREBASE_APP_ID=1:124414392250:web:5b3a01f71c77e93ed3cf83
```
Leaving these blank in local dev is intentional — `pnpm dev` then uses the
worker's `DEV_EMAIL` seam (no real Firebase needed).

## 3. Worker config + deploy
1. In `apps/worker/wrangler.toml`, set `FIREBASE_PROJECT_ID` to `<project-id>` (replace `REPLACE_WITH_FIREBASE_PROJECT_ID`) and confirm `ENVIRONMENT="production"` (the committed default). No secret to set.
2. Deploy: `pnpm --filter @evo-csv/worker deploy`. Build + deploy the web app (Pages / your host) with the `VITE_FIREBASE_*` env.

> Fail-safe: if `FIREBASE_PROJECT_ID` is left as the placeholder, every token fails verification → the worker is locked **closed** (401), never open.

## 4. Seed the first owner (closed signup has no open door)
Firebase authenticates the email, but our D1 gate only admits invited/member emails. Seed yourself first:
```bash
pnpm bootstrap --email you@yourco.com --project-slug evo --project-name EVO --remote
```
Then sign in with that Google account → email-match → owner. Invite everyone else from **Settings → Members** (any domain; leave `allowed_email_domain` unset for multi-domain clients).

## 5. Smoke test (the one live check)
1. Visit the app → bounces to `/login` → **Continue with Google** → consent → lands in `/admin/importers`.
2. `GET /api/me` returns your owner session; **Logout** signs out of Firebase and returns to `/login`.
3. (Optional) email-link: "Email me a sign-in link" → click the emailed link → signed in.

## Gotchas
- **`signInWithRedirect` + third-party cookies:** recent browsers require the app be served from the same domain as `authDomain`, or use Firebase's redirect-resolver hosting. If redirect sign-in misbehaves, serve the app under the Firebase `authDomain` or switch that one call to `signInWithPopup`.
- **Spark email-LINK cap ~5/day.** Fine as a rare non-Google fallback; if you expect more, use Email/Password (free, higher limits) for those users.
- **Don't enable phone auth** (not free).
- **Never set `ENVIRONMENT=local` on a deployed env** — that turns on the `X-Dev-Email` dev bypass.

# ADR-0001 — Authentication via Firebase (D1 keeps authorization)

**Status:** Accepted (2026-06-27) · **Supersedes:** the hand-rolled Google SSO (#39)

## Context
evo-csv (Cloudflare Workers + D1 + R2 + Queues) needs login that is **zero ongoing
cost**, lets owners **invite users from arbitrary email domains** (internal + client
Workspaces + Gmail, and eventually non-Google users), and stays low-maintenance.
A hand-rolled Google SSO (#39) shipped first but only covers people who have a
Google account and needs a Google OAuth client + secret.

## Options weighed (deep research + a design-review grill)
- **Hand-rolled Google SSO (#39, built):** $0, any *Google* domain, but excludes
  non-Google users; needs an OAuth client + secret.
- **Cloudflare Access OTP:** $0, free email, but **50-user cap** + the edge
  allowlist duplicates our D1 invites — awkward for open multi-domain invites.
- **Supabase Auth:** default email is unusable for prod (needs paid custom SMTP),
  pauses on inactivity, off-Cloudflare second backend.
- **Firebase Authentication (chosen):** free at our scale, **any email domain**,
  **sends its own auth emails free** (no SMTP), GCP-native, Workers-friendly token
  verification. Covers non-Google invitees via free email-link.

## Decision
Use **Firebase Authentication** for *authentication only*. **Authorization stays
entirely in D1** (closed-signup invites, roles, memberships, env grants,
`allowed_email_domain`). Key design (locked in the grill):

- **Providers:** Google primary (`signInWithRedirect`) + email-link secondary
  (non-Google fallback; Spark caps email-LINK ~5/day → use email/password if it
  ever exceeds that).
- **Stateless:** the SPA holds the Firebase session and sends
  `Authorization: Bearer <ID token>` per request; the worker verifies it each
  request (`jose` + secure-token JWKS, `iss=https://securetoken.google.com/<project>`,
  `aud=<project>`, `email_verified`). No server sessions, no KV.
- **`allowed_email_domain` stays in D1** (per-project; Firebase is one global
  project and can't express per-tenant domain rules, and domain restriction is an
  authorization concern).
- **Invite acceptance:** lazy email-match in `requireAuth` on first authed request;
  the invite token is kept only for the preview page.
- **Dedicated Firebase project**, isolated from the production EVO platform
  (`evo-platform-193721`) so its consent screen / Firebase services don't touch prod.
- **No app secrets** — verification uses public JWKS; web config is public.
- **Secure default:** `wrangler.toml ENVIRONMENT="production"` always verifies
  tokens; the `X-Dev-Email` dev seam is enabled only in tests (vitest override) and
  local dev (`.dev.vars`). A plain deploy ships the verified path and fails **closed**
  (401) if `FIREBASE_PROJECT_ID` is unset.

## Consequences
- One identity store split (Firebase identity ↔ D1 authz) — acceptable; the gate
  re-checks D1 every request, so revoking access = delete the membership → instant
  403 regardless of token lifetime.
- Off-Cloudflare runtime dependency (Google) + the Firebase web SDK in the bundle.
- Operator residual (no secrets): enable providers + set `FIREBASE_PROJECT_ID` /
  `VITE_FIREBASE_*` in the dedicated project, then deploy.

Implementation: PR #66. Bootstrap CLI (#38) is independent.

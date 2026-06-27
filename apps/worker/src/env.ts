import type { WebhookDispatchJob } from "@evo-csv/shared";

export type Env = {
  DB: D1Database;
  WEBHOOK_QUEUE: Queue<WebhookDispatchJob>;
  // Static SPA assets (apps/web/dist), served single-origin with the API so the
  // browser's `window.location.origin` API calls and Firebase redirect cookies
  // share one domain. Non-/api paths fall back to index.html (client routing).
  ASSETS: Fetcher;
  // "local" relaxes auth (trusts a dev email header/var, skipping Firebase
  // token verification); deployed envs use "staging"/"production".
  ENVIRONMENT: string;
  // The Firebase project whose ID tokens we trust. Drives both the JWKS issuer
  // (`https://securetoken.google.com/<id>`) and the expected audience.
  FIREBASE_PROJECT_ID: string;
  // Local/test-only convenience: the email trusted by the `local` auth seam
  // when no `X-Dev-Email` header is present. Never consulted off `local`.
  DEV_EMAIL: string;
  APP_BASE_URL: string;
};

export type SessionContext = {
  user: { id: string; email: string; name: string; picture_url?: string | null };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
};

export type Variables = {
  session: SessionContext;
};

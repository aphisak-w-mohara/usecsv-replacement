import type { WebhookDispatchJob } from "@evo-csv/shared";

export type Env = {
  DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  WEBHOOK_QUEUE: Queue<WebhookDispatchJob>;
  // Opaque sessions + short-lived OAuth PKCE state.
  SESSIONS: KVNamespace;
  // "local" relaxes cookie security; deployed envs use "staging"/"production".
  ENVIRONMENT: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
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

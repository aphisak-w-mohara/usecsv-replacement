/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Public Firebase web config — see apps/web/.env.example. Optional so the DEV
  // bypass (blank config → worker email seam) typechecks.
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

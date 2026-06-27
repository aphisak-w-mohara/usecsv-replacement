import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, type User, getAuth, onAuthStateChanged } from "firebase/auth";

/**
 * Firebase client init. All values here are PUBLIC web config (they ship in the
 * browser bundle by design) and come from Vite env vars. Authorization is the
 * worker's job (D1 memberships / invites / grants / allowed_email_domain) — this
 * SDK only authenticates the user and yields an ID token.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * True when a real Firebase project is configured. In DEV without config, the
 * app falls back to the worker's local email seam (see `firebaseConfigured`
 * checks in `_authed` + `api`), so `pnpm dev` works without a Firebase project.
 */
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

/**
 * Lazily initialize Firebase and return the Auth instance. Throws if called
 * without configuration — callers must gate on `firebaseConfigured` first (the
 * DEV bypass relies on never reaching here when unconfigured).
 */
export function getFirebaseAuth(): Auth {
  if (!firebaseConfigured) {
    throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env vars).");
  }
  if (!app) app = initializeApp(firebaseConfig);
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
}

/**
 * Resolve the current user's Firebase ID token, or null when unconfigured / not
 * signed in. Used by the API client to attach `Authorization: Bearer <token>`.
 */
export async function getIdToken(): Promise<string | null> {
  if (!firebaseConfigured) return null;
  const user = await waitForFirebaseUser();
  if (!user) return null;
  return user.getIdToken();
}

/**
 * Resolve once the Firebase auth state has settled: the signed-in `User`, or
 * `null` when signed out. Resolves immediately if a user is already cached.
 * Returns null when Firebase isn't configured.
 */
export function waitForFirebaseUser(): Promise<User | null> {
  if (!firebaseConfigured) return Promise.resolve(null);
  const auth = getFirebaseAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

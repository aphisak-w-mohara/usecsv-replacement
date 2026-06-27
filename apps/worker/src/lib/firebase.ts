import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env.js";

/**
 * Firebase ID-token verification.
 *
 * Firebase mints RS256-signed JWTs whose public keys rotate; the canonical JWK
 * endpoint below is the JWK form (the x509 endpoint would need separate PEM
 * handling). `createRemoteJWKSet` fetches + caches the keys and refreshes them
 * on a rotation, so the set is created once at module scope and reused across
 * requests within an isolate.
 *
 * Trust contract (Firebase = authentication only — authorization lives in D1):
 *  - issuer  === `https://securetoken.google.com/<FIREBASE_PROJECT_ID>`
 *  - audience === `<FIREBASE_PROJECT_ID>`
 *  - a verified email is present (`email` + `email_verified === true`)
 * Any signature / claim / expiry failure resolves to `null`.
 */
const JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);

const jwks = createRemoteJWKSet(JWKS_URL);

type FirebasePayload = JWTPayload & {
  email?: unknown;
  email_verified?: unknown;
};

export async function verifyFirebaseToken(
  env: Env,
  token: string,
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    const { email, email_verified } = payload as FirebasePayload;
    if (typeof email !== "string" || email.length === 0 || email_verified !== true) {
      return null;
    }
    return { email: email.toLowerCase() };
  } catch {
    return null;
  }
}

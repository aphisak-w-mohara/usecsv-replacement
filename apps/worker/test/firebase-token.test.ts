import { env, fetchMock } from "cloudflare:test";
import { SignJWT, type JWK, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyFirebaseToken } from "../src/lib/firebase.js";

/**
 * Unit test for verifyFirebaseToken. We can't use a real Google-signed token, so
 * we mint an RS256 keypair locally, sign tokens with it, and serve the matching
 * public JWK at the securetoken JWK endpoint via fetchMock — the same endpoint
 * `createRemoteJWKSet` fetches. The `kid` ties header → JWK.
 */
const KID = "test-key-1";
const JWK_URL_ORIGIN = "https://www.googleapis.com";
const JWK_URL_PATH = "/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let privateKey: CryptoKey;
let publicJwk: JWK;

const ISSUER = () => `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
const AUDIENCE = () => env.FIREBASE_PROJECT_ID;

beforeAll(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair("RS256", { extractable: true });
  privateKey = priv;
  publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
});

/** (Re)register a persistent JWK interceptor — createRemoteJWKSet may refetch on
 * a kid miss, so make it always available within the test. */
function mockJwks() {
  fetchMock
    .get(JWK_URL_ORIGIN)
    .intercept({ path: JWK_URL_PATH, method: "GET" })
    .reply(200, { keys: [publicJwk] }, { headers: { "content-type": "application/json" } })
    .persist();
}

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  mockJwks();
});

afterEach(() => {
  // JWK fetch is best-effort (cached after first hit); don't assert it was used.
  fetchMock.deactivate();
});

type Claims = {
  iss?: string;
  aud?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
};

async function signToken(claims: Claims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const builder = new SignJWT({
    email: claims.email,
    email_verified: claims.email_verified,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt(now)
    .setSubject("firebase-uid-123")
    .setIssuer(claims.iss ?? ISSUER())
    .setAudience(claims.aud ?? AUDIENCE())
    .setExpirationTime(claims.exp ?? now + 3600);
  return builder.sign(privateKey);
}

describe("verifyFirebaseToken", () => {
  it("returns the lowercased email for a valid, verified token", async () => {
    const token = await signToken({ email: "User@Mohara.co", email_verified: true });
    const result = await verifyFirebaseToken(env, token);
    expect(result).toEqual({ email: "user@mohara.co" });
  });

  it("rejects a token with the wrong audience → null", async () => {
    const token = await signToken({
      email: "user@mohara.co",
      email_verified: true,
      aud: "some-other-project",
    });
    expect(await verifyFirebaseToken(env, token)).toBeNull();
  });

  it("rejects a token with the wrong issuer → null", async () => {
    const token = await signToken({
      email: "user@mohara.co",
      email_verified: true,
      iss: "https://securetoken.google.com/some-other-project",
    });
    expect(await verifyFirebaseToken(env, token)).toBeNull();
  });

  it("rejects a token whose email is not verified → null", async () => {
    const token = await signToken({ email: "user@mohara.co", email_verified: false });
    expect(await verifyFirebaseToken(env, token)).toBeNull();
  });

  it("rejects a token with no email claim → null", async () => {
    const token = await signToken({ email_verified: true });
    expect(await verifyFirebaseToken(env, token)).toBeNull();
  });

  it("rejects an expired token → null", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await signToken({
      email: "user@mohara.co",
      email_verified: true,
      exp: past,
    });
    expect(await verifyFirebaseToken(env, token)).toBeNull();
  });

  it("rejects a structurally invalid token → null", async () => {
    expect(await verifyFirebaseToken(env, "not-a-jwt")).toBeNull();
  });
});

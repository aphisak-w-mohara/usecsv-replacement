import type { Env } from "../env.js";
import { base64urlDecodeToString, base64urlEncode } from "./encoding.js";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type BuildGoogleAuthUrlInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Google Workspace domain hint (e.g. "mohara.co"); omitted for personal accounts. */
  hd?: string | null;
};

export function buildGoogleAuthUrl(input: BuildGoogleAuthUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.hd) params.set("hd", input.hd);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export type Pkce = { verifier: string; challenge: string };

/** Generate a PKCE verifier + S256 challenge pair (both base64url). */
export async function pkce(): Promise<Pkce> {
  const verifier = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

export type TokenResponse = {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  [k: string]: unknown;
};

export type ExchangeCodeInput = { code: string; verifier: string };

/** Exchange an authorization code (+ PKCE verifier) for Google's token response. */
export async function exchangeCode(
  env: Env,
  input: ExchangeCodeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
  });

  const res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export type GoogleIdTokenClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
  aud?: string;
  iss?: string;
};

/**
 * Decode the (already-trusted) ID token's payload segment. The token comes
 * straight from Google's token endpoint over TLS, so no signature check is
 * required for MVP — the caller MUST still assert aud + iss.
 */
export function decodeIdToken(idToken: string): GoogleIdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Malformed id_token");
  }
  const json = base64urlDecodeToString(parts[1]);
  return JSON.parse(json) as GoogleIdTokenClaims;
}

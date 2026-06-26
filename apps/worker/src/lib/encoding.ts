/** base64url + opaque-token helpers shared by the session store and OAuth code. */

/** base64url-encode raw bytes (no padding). */
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url-decode a string back into a binary string (tolerates missing padding). */
export function base64urlDecodeToString(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

/** An opaque, URL-safe token of `byteLen` random bytes (default 32 → ~43 chars). */
export function randomToken(byteLen = 32): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(byteLen)));
}

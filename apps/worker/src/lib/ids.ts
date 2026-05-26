/**
 * Tiny ULID-shaped id generator. Format: `<prefix>_<ts><rand>` where ts is
 * 10 chars (base36 Date.now()) and rand is 16 chars (8 random bytes base36).
 *
 * Good enough for dev. Replace with a real ULID lib if cross-worker ordering
 * matters.
 */
export function generateId(prefix: string): string {
  const ts = Date.now().toString(36).padStart(10, "0");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return `${prefix}_${ts}${rand}`;
}

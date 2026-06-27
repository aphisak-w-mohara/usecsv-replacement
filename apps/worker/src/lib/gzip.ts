/**
 * gzip helpers for storing batch payloads inline in D1 as compressed BLOBs.
 *
 * The Workers runtime exposes the WHATWG `CompressionStream`/`DecompressionStream`,
 * so this needs no dependency. We gzip the (highly repetitive, CSV-derived) JSON
 * before persisting it to keep each row well under D1's hard 2 MB per-row limit —
 * this is the load-bearing reason batch payloads can live in D1 instead of R2.
 */

/** Normalize whatever D1 hands back for a BLOB column into a Uint8Array. */
export function toBytes(value: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

async function pipeThrough(input: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  // Uint8Array is a valid BodyInit at runtime; the cast sidesteps a TS 5.7
  // generic-variance mismatch (Uint8Array<ArrayBufferLike> vs BodyInit).
  const compressed = new Response(input as BodyInit).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** gzip a UTF-8 JSON string to bytes for storage. */
export async function gzipString(text: string): Promise<Uint8Array> {
  return pipeThrough(new TextEncoder().encode(text), new CompressionStream("gzip"));
}

/** Inverse of {@link gzipString}: decompress stored bytes back to the string. */
export async function gunzipToString(bytes: ArrayBuffer | Uint8Array | number[]): Promise<string> {
  const out = await pipeThrough(toBytes(bytes), new DecompressionStream("gzip"));
  return new TextDecoder().decode(out);
}

import type { PromptBundle } from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyBundleIntegrity(
  bundle: PromptBundle,
  expectedSha256: string,
): Promise<void> {
  for (const prompt of bundle.prompts) {
    const actual = await sha256Hex(prompt.content);
    if (actual !== prompt.sha256)
      throw new Error(`prompt checksum mismatch: ${prompt.id}`);
  }
  const payload: PromptBundle = {
    schema_version: bundle.schema_version,
    release_id: bundle.release_id,
    generation: bundle.generation,
    prompts: bundle.prompts,
  };
  const aggregate = await sha256Hex(canonicalJson(payload));
  if (aggregate !== expectedSha256) throw new Error("bundle checksum mismatch");
}

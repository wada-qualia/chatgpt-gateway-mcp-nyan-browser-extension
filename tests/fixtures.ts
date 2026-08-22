import { canonicalJson, sha256Hex } from "../src/integrity";
import type { PromptBundle, PromptManifest } from "../src/types";

export async function promptFixture(
  content = "Prompt text",
): Promise<{ manifest: PromptManifest; bundle: PromptBundle }> {
  const promptSha = await sha256Hex(content);
  const bundle: PromptBundle = {
    schema_version: 1,
    release_id: "release-1",
    generation: 7,
    prompts: [
      {
        id: "takeoff",
        version: 3,
        content,
        content_type: "text/plain",
        variables_schema: { type: "object", additionalProperties: false },
        sha256: promptSha,
      },
    ],
  };
  const bundleSha = await sha256Hex(canonicalJson(bundle));
  const manifest: PromptManifest = {
    schema_version: 1,
    channel: "dev",
    release_id: "release-1",
    generation: 11,
    release_generation: 7,
    bundle_id: bundleSha,
    sha256: bundleSha,
    etag: '"channel:dev:generation:11:sha256:test"',
    cache_scope_id: "scope-opaque",
    max_stale_seconds: 60,
  };
  return { manifest, bundle };
}

import { verifyBundleIntegrity } from "./integrity";
import type { CachedPromptBundle, PromptBundle, PromptManifest } from "./types";

const CACHE_KEY = "atlas.promptBundle.v1";

export type StorageArea = Pick<
  chrome.storage.StorageArea,
  "get" | "set" | "remove"
>;

export class PromptCache {
  constructor(
    private readonly storage: StorageArea,
    private readonly now: () => number = Date.now,
  ) {}

  async read(): Promise<CachedPromptBundle | null> {
    const result = await this.storage.get(CACHE_KEY);
    const value = result[CACHE_KEY] as CachedPromptBundle | undefined;
    return value ?? null;
  }

  async write(
    manifest: PromptManifest,
    bundle: PromptBundle,
    bundleEtag: string,
  ): Promise<CachedPromptBundle> {
    if (manifest.bundle_id !== manifest.sha256)
      throw new Error("manifest bundle identity mismatch");
    if (bundle.sha256 !== undefined && bundle.sha256 !== manifest.sha256) {
      throw new Error("bundle checksum metadata mismatch");
    }
    if (bundle.release_id !== manifest.release_id)
      throw new Error("bundle release mismatch");
    await verifyBundleIntegrity(bundle, manifest.sha256);
    const value: CachedPromptBundle = {
      manifest,
      bundle,
      bundleEtag,
      validatedAtMs: this.now(),
    };
    await this.storage.set({ [CACHE_KEY]: value });
    return value;
  }

  async touch(value: CachedPromptBundle): Promise<CachedPromptBundle> {
    const refreshed = { ...value, validatedAtMs: this.now() };
    await this.storage.set({ [CACHE_KEY]: refreshed });
    return refreshed;
  }

  async purge(): Promise<void> {
    await this.storage.remove(CACHE_KEY);
  }

  isUsable(value: CachedPromptBundle, cacheScopeId: string): boolean {
    if (value.manifest.cache_scope_id !== cacheScopeId) return false;
    const maxAgeMs = value.manifest.max_stale_seconds * 1000;
    return this.now() - value.validatedAtMs <= maxAgeMs;
  }

  findPrompt(value: CachedPromptBundle, promptId: string): string | null {
    const prompt = value.bundle.prompts.find((item) => item.id === promptId);
    return prompt?.content ?? null;
  }
}

import { PromptCache } from "./cache";
import type { GatewayClient } from "./gatewayClient";
import type { CachedPromptBundle } from "./types";

export type PromptGateway = Pick<GatewayClient, "getManifest" | "getBundle">;

export class PromptRepository {
  constructor(
    private readonly client: PromptGateway,
    private readonly cache: PromptCache,
    private readonly channel: string = "dev",
  ) {}

  private staleOrThrow(
    cached: CachedPromptBundle | null,
    error: Error,
  ): CachedPromptBundle {
    if (cached && this.cache.isUsable(cached, cached.manifest.cache_scope_id))
      return cached;
    throw error;
  }

  async refresh(): Promise<CachedPromptBundle> {
    const cached = await this.cache.read();
    let manifestResult;
    try {
      manifestResult = await this.client.getManifest(
        this.channel,
        cached?.manifest.etag ?? null,
      );
    } catch (error) {
      return this.staleOrThrow(
        cached,
        error instanceof Error ? error : new Error("manifest request failed"),
      );
    }

    if (manifestResult.status === 410) {
      await this.cache.purge();
      throw new Error("prompt release revoked");
    }
    if (manifestResult.status === 401)
      throw new Error("Gateway authorization required");
    if (manifestResult.status === 404)
      throw new Error("prompt channel unavailable");
    if (manifestResult.status === 502 || manifestResult.status === 503) {
      return this.staleOrThrow(
        cached,
        new Error("Gateway prompt facade unavailable"),
      );
    }
    if (manifestResult.status === 304) {
      if (!cached) throw new Error("manifest returned 304 without cache");
      return this.cache.touch(cached);
    }
    if (manifestResult.status !== 200)
      throw new Error("unexpected manifest status");

    const manifest = manifestResult.body;
    const sameScope =
      cached?.manifest.cache_scope_id === manifest.cache_scope_id;
    if (cached && !sameScope) {
      await this.cache.purge();
    }
    const reusable =
      sameScope && cached?.manifest.bundle_id === manifest.bundle_id
        ? cached
        : null;

    let bundleResult;
    try {
      bundleResult = await this.client.getBundle(
        manifest.bundle_id,
        reusable?.bundleEtag ?? null,
      );
    } catch (error) {
      if (reusable && this.cache.isUsable(reusable, manifest.cache_scope_id))
        return reusable;
      throw error;
    }
    if (bundleResult.status === 410) {
      await this.cache.purge();
      throw new Error("prompt bundle revoked");
    }
    if (bundleResult.status === 401)
      throw new Error("Gateway authorization required");
    if (bundleResult.status === 404)
      throw new Error("prompt bundle unavailable");
    if (bundleResult.status === 502 || bundleResult.status === 503) {
      if (reusable && this.cache.isUsable(reusable, manifest.cache_scope_id))
        return reusable;
      throw new Error("Gateway prompt bundle unavailable");
    }
    if (bundleResult.status === 304) {
      if (!reusable) throw new Error("bundle returned 304 without cache");
      return this.cache.write(manifest, reusable.bundle, reusable.bundleEtag);
    }
    if (bundleResult.status !== 200)
      throw new Error("unexpected bundle status");
    return this.cache.write(manifest, bundleResult.body, bundleResult.etag);
  }

  async getPrompt(promptId: string): Promise<string> {
    const bundle = await this.refresh();
    const content = this.cache.findPrompt(bundle, promptId);
    if (!content) throw new Error(`prompt not found: ${promptId}`);
    return content;
  }
}

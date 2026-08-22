import { describe, expect, it, vi } from "vitest";

import { PromptCache, type StorageArea } from "../src/cache";
import { PromptRepository, type PromptGateway } from "../src/promptRepository";
import type { GatewayResult } from "../src/gatewayClient";
import type { PromptBundle, PromptManifest } from "../src/types";
import { promptFixture } from "./fixtures";

function memoryStorage(): StorageArea {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      if (typeof key !== "string")
        throw new Error("test storage expects a string key");
      return Promise.resolve({ [key]: data[key] });
    },
    set(items) {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove(key) {
      if (typeof key !== "string")
        throw new Error("test storage expects a string key");
      delete data[key];
      return Promise.resolve();
    },
  } as StorageArea;
}

function gateway(
  manifestResults: Array<GatewayResult<PromptManifest>>,
  bundleResults: Array<GatewayResult<PromptBundle>> = [],
): {
  client: PromptGateway;
  getManifest: ReturnType<typeof vi.fn<PromptGateway["getManifest"]>>;
  getBundle: ReturnType<typeof vi.fn<PromptGateway["getBundle"]>>;
} {
  const getManifest = vi.fn<PromptGateway["getManifest"]>(() =>
    Promise.resolve(manifestResults.shift() ?? { status: 503 }),
  );
  const getBundle = vi.fn<PromptGateway["getBundle"]>(() =>
    Promise.resolve(bundleResults.shift() ?? { status: 503 }),
  );
  return { client: { getManifest, getBundle }, getManifest, getBundle };
}

describe("PromptRepository", () => {
  it("touches an existing LKG after a confirmed manifest 304", async () => {
    let now = 1_000;
    const storage = memoryStorage();
    const cache = new PromptCache(storage, () => now);
    const { manifest, bundle } = await promptFixture();
    await cache.write(manifest, bundle, '"bundle-etag"');
    now = 5_000;
    const fake = gateway([{ status: 304 }]);
    const result = await new PromptRepository(fake.client, cache).refresh();
    expect(result.validatedAtMs).toBe(5_000);
    expect(fake.getManifest).toHaveBeenCalledWith("dev", manifest.etag);
    expect(fake.getBundle).not.toHaveBeenCalled();
  });

  it("uses transient LKG only inside max_stale", async () => {
    let now = 1_000;
    const cache = new PromptCache(memoryStorage(), () => now);
    const { manifest, bundle } = await promptFixture();
    await cache.write(manifest, bundle, '"bundle-etag"');
    const fake = gateway([{ status: 503 }, { status: 503 }]);
    const repository = new PromptRepository(fake.client, cache);

    now = 60_000;
    await expect(repository.refresh()).resolves.toMatchObject({ manifest });
    now = 62_001;
    await expect(repository.refresh()).rejects.toThrow(
      "Gateway prompt facade unavailable",
    );
  });

  it("purges LKG immediately when the release is revoked", async () => {
    const cache = new PromptCache(memoryStorage(), () => 1_000);
    const { manifest, bundle } = await promptFixture();
    await cache.write(manifest, bundle, '"bundle-etag"');
    const fake = gateway([{ status: 410 }]);

    await expect(
      new PromptRepository(fake.client, cache).refresh(),
    ).rejects.toThrow("prompt release revoked");
    expect(await cache.read()).toBeNull();
    expect(fake.getBundle).not.toHaveBeenCalled();
  });

  it("does not reuse an old-scope bundle validator after cache_scope_id changes", async () => {
    const cache = new PromptCache(memoryStorage(), () => 1_000);
    const { manifest, bundle } = await promptFixture();
    await cache.write(manifest, bundle, '"old-bundle-etag"');
    const newManifest: PromptManifest = {
      ...manifest,
      generation: manifest.generation + 1,
      etag: '"new-manifest-etag"',
      cache_scope_id: "scope-new",
    };
    const fake = gateway(
      [{ status: 200, body: newManifest, etag: newManifest.etag }],
      [{ status: 200, body: bundle, etag: '"new-bundle-etag"' }],
    );

    const result = await new PromptRepository(fake.client, cache).refresh();
    expect(fake.getBundle).toHaveBeenCalledWith(newManifest.bundle_id, null);
    expect(result.manifest.cache_scope_id).toBe("scope-new");
    expect(result.bundleEtag).toBe('"new-bundle-etag"');
  });
});

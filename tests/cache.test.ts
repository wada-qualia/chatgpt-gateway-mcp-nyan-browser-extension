import { describe, expect, it } from "vitest";

import { PromptCache, type StorageArea } from "../src/cache";
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

describe("PromptCache", () => {
  it("validates checksums and enforces scope/max-stale", async () => {
    let now = 1_000;
    const cache = new PromptCache(memoryStorage(), () => now);
    const { manifest, bundle } = await promptFixture();
    const saved = await cache.write(manifest, bundle, '"sha256:bundle"');
    expect(cache.findPrompt(saved, "takeoff")).toBe("Prompt text");
    expect(cache.isUsable(saved, "scope-opaque")).toBe(true);
    expect(cache.isUsable(saved, "other-scope")).toBe(false);
    now += 61_000;
    expect(cache.isUsable(saved, "scope-opaque")).toBe(false);
  });

  it("rejects tampered prompt content and refreshes validation time", async () => {
    let now = 5_000;
    const cache = new PromptCache(memoryStorage(), () => now);
    const { manifest, bundle } = await promptFixture();
    const saved = await cache.write(manifest, bundle, '"sha256:bundle"');
    await expect(
      cache.write(
        manifest,
        {
          ...bundle,
          prompts: [{ ...bundle.prompts[0]!, content: "tampered" }],
        },
        '"x"',
      ),
    ).rejects.toThrow("prompt checksum mismatch");
    now = 8_000;
    const touched = await cache.touch(saved);
    expect(touched.validatedAtMs).toBe(8_000);
    await cache.purge();
    expect(await cache.read()).toBeNull();
  });
});

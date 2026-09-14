import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { nekoAssets, pickNekoAsset } from "../src/assets/neko";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function basenames(paths: readonly string[]): string[] {
  return paths.map((path) => path.split("/").at(-1) ?? "").sort();
}

describe("neko asset manager", () => {
  it("exposes the complete typed waiting and interesting catalogs", () => {
    expect(nekoAssets.waiting).toHaveLength(26);
    expect(nekoAssets.interesting).toHaveLength(25);
    expect(new Set(nekoAssets.waiting).size).toBe(nekoAssets.waiting.length);
    expect(new Set(nekoAssets.interesting).size).toBe(
      nekoAssets.interesting.length,
    );
    expect(
      nekoAssets.waiting.every((path) =>
        /^assets\/neko\/waiting\/icon_[0-9]{2}\.png$/u.test(path),
      ),
    ).toBe(true);
    expect(
      nekoAssets.interesting.every((path) =>
        /^assets\/neko\/interesting\/icon_[0-9]{2}\.png$/u.test(path),
      ),
    ).toBe(true);
  });

  it("keeps the catalog exactly aligned with packaged source assets", async () => {
    const waitingFiles = (
      await readdir(resolve(root, "src/assets/neko/waiting"))
    ).sort();
    const interestingFiles = (
      await readdir(resolve(root, "src/assets/neko/interesting"))
    ).sort();

    expect(waitingFiles).toEqual(basenames(nekoAssets.waiting));
    expect(interestingFiles).toEqual(basenames(nekoAssets.interesting));
  });

  it("selects catalog entries across the full random range", () => {
    expect(pickNekoAsset("waiting", () => 0)).toBe(nekoAssets.waiting[0]);
    expect(pickNekoAsset("waiting", () => 1)).toBe(nekoAssets.waiting.at(-1));
    expect(pickNekoAsset("interesting", () => -1)).toBe(
      nekoAssets.interesting[0],
    );
    expect(pickNekoAsset("interesting", () => Number.NaN)).toBe(
      nekoAssets.interesting[0],
    );
  });
});

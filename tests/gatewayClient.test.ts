import { describe, expect, it, vi } from "vitest";

import { GatewayClient, parseManifest } from "../src/gatewayClient";
import { promptFixture } from "./fixtures";

describe("GatewayClient", () => {
  it("sends bearer + If-None-Match and parses a manifest", async () => {
    const { manifest } = await promptFixture();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer token");
      expect(headers.get("If-None-Match")).toBe('"old"');
      expect(init?.credentials).toBe("omit");
      return Promise.resolve(
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { ETag: manifest.etag },
        }),
      );
    });
    const client = new GatewayClient(
      "https://gateway.example.test",
      "token",
      fetcher as typeof fetch,
    );
    const result = await client.getManifest("dev", '"old"');
    expect(result.status).toBe(200);
  });

  it("preserves 304 and fail-closed revocation status", async () => {
    const responses = [
      new Response(null, { status: 304 }),
      new Response(null, { status: 410 }),
    ];
    const fetcher = vi.fn(() => Promise.resolve(responses.shift()!));
    const client = new GatewayClient(
      "https://gateway.example.test",
      "token",
      fetcher as typeof fetch,
    );
    expect((await client.getManifest("dev", '"old"')).status).toBe(304);
    expect((await client.getBundle("a".repeat(64), null)).status).toBe(410);
  });

  it("rejects invalid protocol and malformed manifest identity", async () => {
    expect(
      () => new GatewayClient("http://gateway.example.test", "token"),
    ).toThrow("HTTPS");
    const { manifest } = await promptFixture();
    expect(() =>
      parseManifest({ ...manifest, bundle_id: "b".repeat(64) }),
    ).toThrow("invalid manifest");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  GatewayClient,
  GatewayRequestError,
  parseManifest,
} from "../src/gatewayClient";
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

  it("keeps the browser-global receiver when using native fetch", async () => {
    const { manifest } = await promptFixture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function (this: unknown): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { ETag: manifest.etag },
        }),
      );
    } as typeof fetch;
    try {
      const client = new GatewayClient("https://gateway.example.test", "token");
      await expect(client.getManifest("dev", null)).resolves.toMatchObject({
        status: 200,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it("reads the authenticated username through Gateway userinfo without exposing the token", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer token");
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      return Promise.resolve(
        new Response(JSON.stringify({ preferred_username: "gateway-admin" }), {
          status: 200,
        }),
      );
    });
    const client = new GatewayClient(
      "https://gateway.example.test",
      "token",
      fetcher as typeof fetch,
    );
    await expect(client.getUserInfo()).resolves.toEqual({
      displayName: "gateway-admin",
    });
  });

  it("fails closed on expired or malformed Gateway userinfo", async () => {
    const responses = [
      new Response(null, { status: 401 }),
      new Response(JSON.stringify({ preferred_username: "" }), { status: 200 }),
    ];
    const fetcher = vi.fn(() => Promise.resolve(responses.shift()!));
    const client = new GatewayClient(
      "https://gateway.example.test",
      "token",
      fetcher as typeof fetch,
    );
    await expect(client.getUserInfo()).resolves.toBeNull();
    await expect(client.getUserInfo()).rejects.toThrow(
      "invalid Gateway userinfo response",
    );
  });
});

describe("GatewayClient chat contexts", () => {
  it("creates, binds, and resolves chat contexts with bearer-only JSON requests", async () => {
    const seen: Array<{
      path: string;
      body: unknown;
      authorization: string | null;
    }> = [];
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof URL
          ? input
          : typeof input === "string"
            ? new URL(input)
            : new URL(input.url);
      const headers = new Headers(init?.headers);
      const rawBody = init?.body;
      seen.push({
        path: url.pathname,
        body: typeof rawBody === "string" ? JSON.parse(rawBody) : null,
        authorization: headers.get("Authorization"),
      });
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      expect(headers.get("Content-Type")).toBe("application/json");
      if (url.pathname.endsWith("/bind")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              context_id: "context-1",
              key_version: 1,
              newly_bound: true,
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            context_id: "context-1",
            chat_context: "A1b2",
            generation: 1,
            expires_at: "2026-08-29T01:00:00Z",
          }),
          { status: 200 },
        ),
      );
    });
    const client = new GatewayClient(
      "https://gateway.example.test",
      "token",
      fetcher as typeof fetch,
    );

    await expect(
      client.createChatContext({
        clientNonce: "nonce-1",
        projectRef: "g-p-alpha",
      }),
    ).resolves.toMatchObject({ contextId: "context-1", chatContext: "A1b2" });
    await expect(
      client.bindChatContext("context-1", "conversation-1"),
    ).resolves.toEqual({
      contextId: "context-1",
      keyVersion: 1,
      newlyBound: true,
    });
    await expect(
      client.resolveChatContext("conversation-1"),
    ).resolves.toMatchObject({
      contextId: "context-1",
    });

    expect(seen).toEqual([
      {
        path: "/api/chat-contexts/v1/contexts",
        body: { client_nonce: "nonce-1", project_ref: "g-p-alpha" },
        authorization: "Bearer token",
      },
      {
        path: "/api/chat-contexts/v1/contexts/context-1/bind",
        body: { conversation_ref: "conversation-1" },
        authorization: "Bearer token",
      },
      {
        path: "/api/chat-contexts/v1/resolve",
        body: { conversation_ref: "conversation-1" },
        authorization: "Bearer token",
      },
    ]);
  });

  it("treats resolve 404 as an absent binding and exposes 401 for session cleanup", async () => {
    const responses = [
      new Response(null, { status: 404 }),
      new Response(null, { status: 401 }),
    ];
    const fetcher = vi.fn(() => Promise.resolve(responses.shift()!));
    const client = new GatewayClient(
      "https://gateway.example.test",
      "token",
      fetcher as typeof fetch,
    );

    await expect(
      client.resolveChatContext("missing-conversation"),
    ).resolves.toBeNull();
    const rejected = client.createChatContext({
      clientNonce: "nonce-1",
      projectRef: "g-p-alpha",
    });
    await expect(rejected).rejects.toBeInstanceOf(GatewayRequestError);
    await expect(rejected).rejects.toMatchObject({ status: 401 });
  });
});

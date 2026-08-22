import { describe, expect, it, vi } from "vitest";

import {
  BrowserOAuthClient,
  EXTENSION_ACCESS_TOKEN_TTL_SECONDS,
  EXTENSION_CLIENT_ID,
  EXTENSION_REDIRECT_URI,
  EXTENSION_SCOPE,
  isOAuthSessionTokenUsable,
  pkceS256,
} from "../src/oauth";

const gatewayOrigin = "https://gateway.example.test";

function authorizeFromLogin(loginUrl: string): URL {
  const login = new URL(loginUrl);
  expect(login.origin).toBe(gatewayOrigin);
  expect(login.pathname).toBe("/auth/login");
  const next = login.searchParams.get("next");
  expect(next).toBeTruthy();
  return new URL(next!, gatewayOrigin);
}

describe("BrowserOAuthClient", () => {
  it("performs exact public-client login with state, PKCE and no credentials", async () => {
    let authorize: URL | undefined;
    let verifier: string | undefined;
    const launchWebAuthFlow = vi.fn((loginUrl: string) => {
      authorize = authorizeFromLogin(loginUrl);
      const state = authorize.searchParams.get("state");
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      return Promise.resolve(
        `${EXTENSION_REDIRECT_URI}?code=authorization-code&state=${encodeURIComponent(state!)}`,
      );
    });
    const fetcher = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (!(input instanceof URL)) throw new Error("expected URL request");
        expect(input.toString()).toBe(`${gatewayOrigin}/oauth/token`);
        expect(init?.method).toBe("POST");
        expect(init?.credentials).toBe("omit");
        expect(init?.cache).toBe("no-store");
        expect(new Headers(init?.headers).get("Content-Type")).toBe(
          "application/x-www-form-urlencoded",
        );
        if (!(init?.body instanceof URLSearchParams)) {
          throw new Error("expected URLSearchParams body");
        }
        const form = init.body;
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("code")).toBe("authorization-code");
        expect(form.get("redirect_uri")).toBe(EXTENSION_REDIRECT_URI);
        expect(form.get("client_id")).toBe(EXTENSION_CLIENT_ID);
        expect(form.has("client_secret")).toBe(false);
        verifier = form.get("code_verifier") ?? undefined;
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "access-token",
              token_type: "Bearer",
              expires_in: EXTENSION_ACCESS_TOKEN_TTL_SECONDS,
              scope: EXTENSION_SCOPE,
            }),
            { status: 200 },
          ),
        );
      },
    );
    const client = new BrowserOAuthClient(gatewayOrigin, {
      getRedirectUrl: () => EXTENSION_REDIRECT_URI,
      launchWebAuthFlow,
      fetcher: fetcher as typeof fetch,
      now: () => 10_000,
    });

    const token = await client.login();

    expect(authorize?.pathname).toBe("/oauth/authorize");
    expect(authorize?.searchParams.get("response_type")).toBe("code");
    expect(authorize?.searchParams.get("client_id")).toBe(EXTENSION_CLIENT_ID);
    expect(authorize?.searchParams.get("redirect_uri")).toBe(
      EXTENSION_REDIRECT_URI,
    );
    expect(authorize?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize?.searchParams.get("scope")).toBe(EXTENSION_SCOPE);
    expect(authorize?.searchParams.get("code_challenge")).toBe(
      await pkceS256(verifier!),
    );
    expect(token).toEqual({
      accessToken: "access-token",
      expiresAtMs: 10_000 + EXTENSION_ACCESS_TOKEN_TTL_SECONDS * 1000,
      scope: EXTENSION_SCOPE,
    });
  });

  it("rejects a redirect URI that is not pinned to the deterministic extension ID", async () => {
    const launchWebAuthFlow = vi.fn();
    const client = new BrowserOAuthClient(gatewayOrigin, {
      getRedirectUrl: () =>
        "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/oauth2",
      launchWebAuthFlow,
    });

    await expect(client.login()).rejects.toThrow("pinned extension ID");
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("fails closed when OAuth state does not round-trip", async () => {
    const client = new BrowserOAuthClient(gatewayOrigin, {
      getRedirectUrl: () => EXTENSION_REDIRECT_URI,
      launchWebAuthFlow: () =>
        Promise.resolve(
          `${EXTENSION_REDIRECT_URI}?code=authorization-code&state=wrong-state`,
        ),
    });

    await expect(client.login()).rejects.toThrow("state mismatch");
  });

  it("fails closed when the callback origin or path changes", async () => {
    const client = new BrowserOAuthClient(gatewayOrigin, {
      getRedirectUrl: () => EXTENSION_REDIRECT_URI,
      launchWebAuthFlow: (loginUrl) => {
        const authorize = authorizeFromLogin(loginUrl);
        const state = authorize.searchParams.get("state");
        return Promise.resolve(
          `https://example.invalid/oauth2?code=authorization-code&state=${encodeURIComponent(state!)}`,
        );
      },
    });

    await expect(client.login()).rejects.toThrow("callback URI");
  });

  it.each([
    {
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 7200,
      scope: EXTENSION_SCOPE,
    },
    {
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: EXTENSION_ACCESS_TOKEN_TTL_SECONDS,
      scope: "workspace:write",
    },
    {
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: EXTENSION_ACCESS_TOKEN_TTL_SECONDS,
      scope: EXTENSION_SCOPE,
      refresh_token: "must-not-be-issued",
    },
  ])("rejects token responses outside the pinned contract", async (payload) => {
    const client = new BrowserOAuthClient(gatewayOrigin, {
      getRedirectUrl: () => EXTENSION_REDIRECT_URI,
      launchWebAuthFlow: (loginUrl) => {
        const authorize = authorizeFromLogin(loginUrl);
        const state = authorize.searchParams.get("state");
        return Promise.resolve(
          `${EXTENSION_REDIRECT_URI}?code=authorization-code&state=${encodeURIComponent(state!)}`,
        );
      },
      fetcher: (() =>
        Promise.resolve(
          new Response(JSON.stringify(payload), { status: 200 }),
        )) as typeof fetch,
    });

    await expect(client.login()).rejects.toThrow(
      "Invalid OAuth token response",
    );
  });

  it("treats expired, wrong-scope and legacy session tokens as unauthenticated", () => {
    expect(
      isOAuthSessionTokenUsable(
        {
          accessToken: "token",
          expiresAtMs: 20_000,
          scope: EXTENSION_SCOPE,
        },
        10_000,
      ),
    ).toBe(true);
    expect(
      isOAuthSessionTokenUsable(
        { accessToken: "token", expiresAtMs: 10_000, scope: EXTENSION_SCOPE },
        10_000,
      ),
    ).toBe(false);
    expect(
      isOAuthSessionTokenUsable(
        { accessToken: "token", expiresAtMs: 20_000, scope: "workspace:write" },
        10_000,
      ),
    ).toBe(false);
    expect(
      isOAuthSessionTokenUsable({ accessToken: "legacy-token" }, 10_000),
    ).toBe(false);
  });

  it("rejects non-HTTPS or non-origin Gateway URLs", () => {
    expect(() => new BrowserOAuthClient("http://gateway.example.test")).toThrow(
      "exact HTTPS origin",
    );
    expect(
      () => new BrowserOAuthClient("https://gateway.example.test/base"),
    ).toThrow("exact HTTPS origin");
  });
});

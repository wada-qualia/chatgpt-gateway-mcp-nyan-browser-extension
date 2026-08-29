import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_CONTEXT_SESSION_KEY } from "../src/chatContext";
import {
  EXTENSION_ACCESS_TOKEN_TTL_SECONDS,
  EXTENSION_REDIRECT_URI,
  EXTENSION_SCOPE,
} from "../src/oauth";
import type { RuntimeRequest, RuntimeResponse } from "../src/types";

const TOKEN_KEY = "atlas.accessToken.v1";
const CONFIG_KEY = "atlas.gatewayConfig.v1";
const gatewayOrigin = "https://gateway.example.test";

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: RuntimeResponse) => void,
) => boolean | void;

function memoryArea(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = structuredClone(initial);
  return {
    values,
    area: {
      get: vi.fn(
        (keys?: string | string[] | Record<string, unknown> | null) => {
          if (typeof keys === "string") {
            return Promise.resolve(
              keys in values ? { [keys]: structuredClone(values[keys]) } : {},
            );
          }
          if (Array.isArray(keys)) {
            return Promise.resolve(
              Object.fromEntries(
                keys
                  .filter((key) => key in values)
                  .map((key) => [key, structuredClone(values[key])]),
              ),
            );
          }
          return Promise.resolve(structuredClone(values));
        },
      ),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(values, structuredClone(items));
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys])
          delete values[key];
        return Promise.resolve();
      }),
    },
  };
}

describe("service worker session identity lifecycle", () => {
  let listener: MessageListener | undefined;
  let session: ReturnType<typeof memoryArea>;
  let local: ReturnType<typeof memoryArea>;

  beforeEach(async () => {
    vi.resetModules();
    session = memoryArea({
      [TOKEN_KEY]: {
        accessToken: "previous-access-token",
        expiresAtMs: Date.now() + 60_000,
        scope: EXTENSION_SCOPE,
      },
      [CHAT_CONTEXT_SESSION_KEY]: {
        version: 1,
        tabs: {
          "41": {
            projectId: "g-p-alpha",
            clientNonce: "old-nonce",
          },
        },
      },
    });
    local = memoryArea({
      [CONFIG_KEY]: { baseUrl: gatewayOrigin, channel: "dev" },
    });
    vi.stubGlobal("chrome", {
      storage: { session: session.area, local: local.area },
      runtime: {
        onMessage: {
          addListener: vi.fn((candidate: MessageListener) => {
            listener = candidate;
          }),
        },
      },
      identity: {
        getRedirectURL: vi.fn(() => EXTENSION_REDIRECT_URI),
        launchWebAuthFlow: vi.fn(
          ({ url }: { url: string; interactive: boolean }) => {
            const login = new URL(url);
            const next = login.searchParams.get("next");
            if (!next) throw new Error("missing OAuth next path");
            const authorize = new URL(next, gatewayOrigin);
            const state = authorize.searchParams.get("state");
            if (!state) throw new Error("missing OAuth state");
            return Promise.resolve(
              `${EXTENSION_REDIRECT_URI}?code=authorization-code&state=${encodeURIComponent(state)}`,
            );
          },
        ),
      },
    });
    await import("../src/serviceWorker");
    expect(listener).toBeTypeOf("function");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function dispatch(request: RuntimeRequest): Promise<RuntimeResponse> {
    const activeListener = listener;
    if (!activeListener)
      throw new Error("service worker listener is unavailable");
    return new Promise((resolve, reject) => {
      try {
        const keepAlive = activeListener(request, {}, resolve);
        if (keepAlive !== true)
          reject(
            new Error("service worker did not keep response channel open"),
          );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  it("clears bearer and all chat-context mappings on logout", async () => {
    await expect(dispatch({ type: "auth:logout" })).resolves.toEqual({
      ok: true,
      value: false,
    });
    expect(session.values).not.toHaveProperty(TOKEN_KEY);
    expect(session.values).not.toHaveProperty(CHAT_CONTEXT_SESSION_KEY);
  });

  it("clears previous account context before installing a newly authorized token", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof URL
          ? input
          : new URL(input instanceof Request ? input.url : input);
      expect(url.toString()).toBe(`${gatewayOrigin}/oauth/token`);
      expect(init?.credentials).toBe("omit");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            token_type: "Bearer",
            expires_in: EXTENSION_ACCESS_TOKEN_TTL_SECONDS,
            scope: EXTENSION_SCOPE,
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(dispatch({ type: "auth:login" })).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(session.values).not.toHaveProperty(CHAT_CONTEXT_SESSION_KEY);
    expect(session.values[TOKEN_KEY]).toMatchObject({
      accessToken: "new-access-token",
      scope: EXTENSION_SCOPE,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

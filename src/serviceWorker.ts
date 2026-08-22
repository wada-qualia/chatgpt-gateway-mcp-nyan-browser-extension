import { PromptCache } from "./cache";
import { GatewayClient } from "./gatewayClient";
import { PromptRepository } from "./promptRepository";
import type { RuntimeRequest, RuntimeResponse } from "./types";

const CONFIG_KEY = "atlas.gatewayConfig.v1";
const TOKEN_KEY = "atlas.accessToken.v1";

type GatewayConfig = { baseUrl: string; channel: string };
type SessionToken = { accessToken: string };

async function loadRepository(): Promise<PromptRepository> {
  const local = await chrome.storage.local.get(CONFIG_KEY);
  const session = await chrome.storage.session.get(TOKEN_KEY);
  const config = local[CONFIG_KEY] as GatewayConfig | undefined;
  const token = session[TOKEN_KEY] as SessionToken | undefined;
  if (!config?.baseUrl || !config.channel || !token?.accessToken) {
    throw new Error("extension Gateway authentication is not configured");
  }
  const client = new GatewayClient(config.baseUrl, token.accessToken);
  return new PromptRepository(
    client,
    new PromptCache(chrome.storage.local),
    config.channel,
  );
}

async function handle(request: RuntimeRequest): Promise<RuntimeResponse> {
  try {
    if (request.type === "auth:get-status") {
      const session = await chrome.storage.session.get(TOKEN_KEY);
      return {
        ok: true,
        value: Boolean(
          (session[TOKEN_KEY] as SessionToken | undefined)?.accessToken,
        ),
      };
    }
    const repository = await loadRepository();
    if (request.type === "prompt:refresh") {
      const value = await repository.refresh();
      return {
        ok: true,
        value: {
          generation: value.manifest.generation,
          bundle_id: value.manifest.bundle_id,
          cache_scope_id: value.manifest.cache_scope_id,
        },
      };
    }
    return { ok: true, value: await repository.getPrompt(request.promptId) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "extension request failed",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const request = message as RuntimeRequest;
    void handle(request).then(sendResponse);
    return true;
  },
);

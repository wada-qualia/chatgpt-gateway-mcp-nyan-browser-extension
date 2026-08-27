import { PromptCache } from "./cache";
import { GatewayClient } from "./gatewayClient";
import {
  BrowserOAuthClient,
  isOAuthSessionTokenUsable,
  type OAuthSessionToken,
} from "./oauth";
import { PromptRepository } from "./promptRepository";
import { EXTENSION_SETTINGS_KEY, parseExtensionSettings } from "./settings";
import type { RuntimeRequest, RuntimeResponse } from "./types";

declare const __ATLAS_GATEWAY_ORIGIN__: string;
declare const __ATLAS_PROMPT_CHANNEL__: string;

const CONFIG_KEY = "atlas.gatewayConfig.v1";
const TOKEN_KEY = "atlas.accessToken.v1";

type GatewayConfig = { baseUrl: string; channel: string };

async function loadGatewayConfig(): Promise<GatewayConfig> {
  const local = await chrome.storage.local.get(CONFIG_KEY);
  const configured = local[CONFIG_KEY] as Partial<GatewayConfig> | undefined;
  const baseUrl =
    configured?.baseUrl?.trim() || __ATLAS_GATEWAY_ORIGIN__.trim();
  const channel =
    configured?.channel?.trim() || __ATLAS_PROMPT_CHANNEL__.trim();
  if (!baseUrl || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(channel)) {
    throw new Error("extension Gateway configuration is not available");
  }
  return { baseUrl, channel };
}

async function loadSessionToken(): Promise<OAuthSessionToken | undefined> {
  const session = await chrome.storage.session.get(TOKEN_KEY);
  const value = session[TOKEN_KEY] as unknown;
  if (!isOAuthSessionTokenUsable(value)) {
    if (value !== undefined) await chrome.storage.session.remove(TOKEN_KEY);
    return undefined;
  }
  return value;
}

async function loadRepository(): Promise<PromptRepository> {
  const config = await loadGatewayConfig();
  const token = await loadSessionToken();
  if (!token) {
    throw new Error("extension Gateway authentication is not configured");
  }
  const client = new GatewayClient(config.baseUrl, token.accessToken);
  return new PromptRepository(
    client,
    new PromptCache(chrome.storage.local),
    config.channel,
  );
}

async function loadSettings(): Promise<
  ReturnType<typeof parseExtensionSettings>
> {
  const local = await chrome.storage.local.get(EXTENSION_SETTINGS_KEY);
  return parseExtensionSettings(local[EXTENSION_SETTINGS_KEY]);
}

async function handle(request: RuntimeRequest): Promise<RuntimeResponse> {
  try {
    if (request.type === "auth:get-status") {
      return { ok: true, value: Boolean(await loadSessionToken()) };
    }
    if (request.type === "auth:get-profile") {
      const token = await loadSessionToken();
      if (!token) return { ok: true, value: null };
      const config = await loadGatewayConfig();
      const profile = await new GatewayClient(
        config.baseUrl,
        token.accessToken,
      ).getUserInfo();
      if (!profile) {
        await chrome.storage.session.remove(TOKEN_KEY);
        return { ok: true, value: null };
      }
      return { ok: true, value: profile };
    }
    if (request.type === "auth:login") {
      const config = await loadGatewayConfig();
      const token = await new BrowserOAuthClient(config.baseUrl).login();
      await chrome.storage.session.set({ [TOKEN_KEY]: token });
      return { ok: true, value: true };
    }
    if (request.type === "auth:logout") {
      await chrome.storage.session.remove(TOKEN_KEY);
      return { ok: true, value: false };
    }
    if (request.type === "settings:get") {
      return { ok: true, value: await loadSettings() };
    }
    if (request.type === "settings:update") {
      const settings = parseExtensionSettings(request.settings);
      await chrome.storage.local.set({ [EXTENSION_SETTINGS_KEY]: settings });
      return { ok: true, value: settings };
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

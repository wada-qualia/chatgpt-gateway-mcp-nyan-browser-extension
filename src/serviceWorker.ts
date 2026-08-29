import { PromptCache } from "./cache";
import { ChatContextCoordinator, ChatContextSessionStore } from "./chatContext";
import { GatewayClient, GatewayRequestError } from "./gatewayClient";
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
const chatContextStore = new ChatContextSessionStore(chrome.storage.session);

type GatewayConfig = { baseUrl: string; channel: string };

async function clearSessionIdentity(): Promise<void> {
  await Promise.all([
    chrome.storage.session.remove(TOKEN_KEY),
    chatContextStore.clear(),
  ]);
}

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
    if (value !== undefined) await clearSessionIdentity();
    return undefined;
  }
  return value;
}

async function loadGatewayClient(): Promise<GatewayClient> {
  const config = await loadGatewayConfig();
  const token = await loadSessionToken();
  if (!token) {
    throw new Error("extension Gateway authentication is not configured");
  }
  return new GatewayClient(config.baseUrl, token.accessToken);
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

function contentTabId(sender: chrome.runtime.MessageSender): number {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    throw new Error("chat context request requires a browser tab");
  }
  const pageUrl = sender.url ? new URL(sender.url) : null;
  if (
    !pageUrl ||
    !["chatgpt.com", "chat.openai.com"].includes(pageUrl.hostname)
  ) {
    throw new Error("chat context request requires a ChatGPT page");
  }
  return tabId!;
}

function projectId(value: string): string {
  if (!/^g-p-[A-Za-z0-9]+$/u.test(value)) {
    throw new Error("invalid ChatGPT project id");
  }
  return value;
}

function conversationRef(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) {
    throw new Error("invalid ChatGPT conversation reference");
  }
  return value;
}

async function handle(
  request: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
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
        await clearSessionIdentity();
        return { ok: true, value: null };
      }
      return { ok: true, value: profile };
    }
    if (request.type === "auth:login") {
      const config = await loadGatewayConfig();
      const token = await new BrowserOAuthClient(config.baseUrl).login();
      await chatContextStore.clear();
      await chrome.storage.session.set({ [TOKEN_KEY]: token });
      return { ok: true, value: true };
    }
    if (request.type === "auth:logout") {
      await clearSessionIdentity();
      return { ok: true, value: false };
    }
    if (request.type === "chat-context:ensure") {
      const tabId = contentTabId(sender);
      const client = await loadGatewayClient();
      const coordinator = new ChatContextCoordinator(chatContextStore, client);
      const value = await coordinator.ensure(
        tabId,
        projectId(request.projectId),
      );
      return { ok: true, value };
    }
    if (request.type === "chat-context:bind") {
      const tabId = contentTabId(sender);
      const client = await loadGatewayClient();
      const coordinator = new ChatContextCoordinator(chatContextStore, client);
      const value = await coordinator.bind(
        tabId,
        projectId(request.projectId),
        conversationRef(request.conversationRef),
      );
      return { ok: true, value };
    }
    if (request.type === "chat-context:resolve") {
      const tabId = contentTabId(sender);
      const client = await loadGatewayClient();
      const coordinator = new ChatContextCoordinator(chatContextStore, client);
      const value = await coordinator.resolve(
        tabId,
        projectId(request.projectId),
        conversationRef(request.conversationRef),
      );
      return { ok: true, value };
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
    if (error instanceof GatewayRequestError && error.status === 401) {
      await clearSessionIdentity();
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "extension request failed",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    const request = message as RuntimeRequest;
    void handle(request, sender).then(sendResponse);
    return true;
  },
);

import { browserFetch } from "./browserFetch";
import {
  parseChatContextBinding,
  parseChatContextLease,
  type ChatContextBinding,
  type ChatContextLease,
} from "./chatContext";
import type { AuthProfile, PromptBundle, PromptManifest } from "./types";

export type GatewayResult<T> =
  | { status: 200; body: T; etag: string }
  | { status: 304 }
  | { status: 401 | 404 | 410 | 502 | 503 };

function isHexSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function parseManifest(value: unknown): PromptManifest {
  if (value === null || typeof value !== "object")
    throw new Error("invalid manifest");
  const x = value as Record<string, unknown>;
  if (
    x.schema_version !== 1 ||
    typeof x.channel !== "string" ||
    typeof x.release_id !== "string" ||
    !Number.isInteger(x.generation) ||
    !Number.isInteger(x.release_generation) ||
    !isHexSha(x.bundle_id) ||
    !isHexSha(x.sha256) ||
    x.bundle_id !== x.sha256 ||
    typeof x.etag !== "string" ||
    typeof x.cache_scope_id !== "string" ||
    x.cache_scope_id.length === 0 ||
    !Number.isInteger(x.max_stale_seconds) ||
    Number(x.max_stale_seconds) < 0
  ) {
    throw new Error("invalid manifest");
  }
  return x as PromptManifest;
}

export function parseBundle(value: unknown): PromptBundle {
  if (value === null || typeof value !== "object")
    throw new Error("invalid bundle");
  const x = value as Record<string, unknown>;
  if (
    x.schema_version !== 1 ||
    typeof x.release_id !== "string" ||
    !Number.isInteger(x.generation) ||
    !Array.isArray(x.prompts)
  ) {
    throw new Error("invalid bundle");
  }
  for (const prompt of x.prompts) {
    if (prompt === null || typeof prompt !== "object")
      throw new Error("invalid prompt");
    const item = prompt as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !Number.isInteger(item.version) ||
      typeof item.content !== "string" ||
      typeof item.content_type !== "string" ||
      item.variables_schema === null ||
      typeof item.variables_schema !== "object" ||
      !isHexSha(item.sha256)
    ) {
      throw new Error("invalid prompt");
    }
  }
  if (x.sha256 !== undefined && !isHexSha(x.sha256))
    throw new Error("invalid bundle sha256");
  return x as PromptBundle;
}

export function parseUserInfo(value: unknown): AuthProfile {
  if (value === null || typeof value !== "object")
    throw new Error("invalid Gateway userinfo response");
  const username = (value as Record<string, unknown>).preferred_username;
  if (
    typeof username !== "string" ||
    !username.trim() ||
    username.length > 256
  ) {
    throw new Error("invalid Gateway userinfo response");
  }
  return { displayName: username.trim() };
}

export class GatewayRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = browserFetch,
  ) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("Gateway base URL must use HTTPS");
    }
  }

  private authorizationHeaders(): Headers {
    return new Headers({ Authorization: `Bearer ${this.accessToken}` });
  }

  private async postJson<T>(
    path: string,
    body: Record<string, unknown>,
    parse: (value: unknown) => T,
    allowNotFound = false,
  ): Promise<T | null> {
    const headers = this.authorizationHeaders();
    headers.set("Content-Type", "application/json");
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
    });
    if (allowNotFound && response.status === 404) return null;
    if (response.status !== 200) {
      throw new GatewayRequestError(
        response.status,
        `Gateway request failed with status ${response.status}`,
      );
    }
    return parse((await response.json()) as unknown);
  }

  private async get<T>(
    path: string,
    etag: string | null,
    parse: (value: unknown) => T,
  ): Promise<GatewayResult<T>> {
    const headers = this.authorizationHeaders();
    if (etag) headers.set("If-None-Match", etag);
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      method: "GET",
      headers,
      credentials: "omit",
      cache: "no-store",
    });
    if (response.status === 304) return { status: 304 };
    if ([401, 404, 410, 502, 503].includes(response.status)) {
      return { status: response.status as 401 | 404 | 410 | 502 | 503 };
    }
    if (response.status !== 200)
      throw new Error(`unexpected Gateway status ${response.status}`);
    const responseEtag = response.headers.get("ETag");
    if (!responseEtag) throw new Error("Gateway response missing ETag");
    const body = parse((await response.json()) as unknown);
    return { status: 200, body, etag: responseEtag };
  }

  async getUserInfo(): Promise<AuthProfile | null> {
    const response = await this.fetcher(
      new URL("/oauth/userinfo", this.baseUrl),
      {
        method: "GET",
        headers: this.authorizationHeaders(),
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (response.status === 401) return null;
    if (response.status !== 200) {
      throw new Error(`unexpected Gateway userinfo status ${response.status}`);
    }
    return parseUserInfo((await response.json()) as unknown);
  }

  async createChatContext(input: {
    clientNonce: string;
    projectRef: string;
  }): Promise<ChatContextLease> {
    if (!input.clientNonce || input.clientNonce.length > 128) {
      throw new Error("invalid chat context nonce");
    }
    if (!input.projectRef || input.projectRef.length > 255) {
      throw new Error("invalid chat context project");
    }
    const result = await this.postJson(
      "/api/chat-contexts/v1/contexts",
      { client_nonce: input.clientNonce, project_ref: input.projectRef },
      parseChatContextLease,
    );
    if (!result) throw new Error("chat context create returned no lease");
    return result;
  }

  async bindChatContext(
    contextId: string,
    conversationRef: string,
  ): Promise<ChatContextBinding> {
    if (!contextId || contextId.length > 64) {
      throw new Error("invalid chat context id");
    }
    if (!conversationRef || conversationRef.length > 512) {
      throw new Error("invalid conversation reference");
    }
    const result = await this.postJson(
      `/api/chat-contexts/v1/contexts/${encodeURIComponent(contextId)}/bind`,
      { conversation_ref: conversationRef },
      parseChatContextBinding,
    );
    if (!result) throw new Error("chat context bind returned no receipt");
    return result;
  }

  resolveChatContext(
    conversationRef: string,
  ): Promise<ChatContextLease | null> {
    if (!conversationRef || conversationRef.length > 512) {
      throw new Error("invalid conversation reference");
    }
    return this.postJson(
      "/api/chat-contexts/v1/resolve",
      { conversation_ref: conversationRef },
      parseChatContextLease,
      true,
    );
  }

  getManifest(
    channel: string,
    etag: string | null,
  ): Promise<GatewayResult<PromptManifest>> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(channel))
      throw new Error("invalid channel");
    return this.get(
      `/api/prompts/v1/releases/${encodeURIComponent(channel)}/manifest`,
      etag,
      parseManifest,
    );
  }

  getBundle(
    bundleId: string,
    etag: string | null,
  ): Promise<GatewayResult<PromptBundle>> {
    if (!isHexSha(bundleId)) throw new Error("invalid bundle id");
    return this.get(`/api/prompts/v1/bundles/${bundleId}`, etag, parseBundle);
  }
}

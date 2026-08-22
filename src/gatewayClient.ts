import type { PromptBundle, PromptManifest } from "./types";

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

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("Gateway base URL must use HTTPS");
    }
  }

  private async get<T>(
    path: string,
    etag: string | null,
    parse: (value: unknown) => T,
  ): Promise<GatewayResult<T>> {
    const headers = new Headers({
      Authorization: `Bearer ${this.accessToken}`,
    });
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

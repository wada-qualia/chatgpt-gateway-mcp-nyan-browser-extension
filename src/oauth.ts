import { browserFetch } from "./browserFetch";

export const EXTENSION_CLIENT_ID = "atlas-chatgpt-browser-extension";
export const EXTENSION_SCOPE = "workspace:read";
export const EXTENSION_REDIRECT_URI =
  "https://cgaalfflopmcbaodnlphklclnnhmdhcn.chromiumapp.org/oauth2";
export const EXTENSION_ACCESS_TOKEN_TTL_SECONDS = 3600;

export type OAuthSessionToken = {
  accessToken: string;
  expiresAtMs: number;
  scope: typeof EXTENSION_SCOPE;
};

type OAuthDependencies = {
  getRedirectUrl?: () => string;
  launchWebAuthFlow?: (url: string) => Promise<string>;
  fetcher?: typeof fetch;
  now?: () => number;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function randomBase64Url(length = 32): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function pkceS256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function normalizeGatewayOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Gateway base URL must be an exact HTTPS origin");
  }
  return url.origin;
}

function validateRedirectUri(value: string): string {
  if (value !== EXTENSION_REDIRECT_URI) {
    throw new Error(
      "Chrome OAuth redirect URI does not match pinned extension ID",
    );
  }
  return value;
}

function parseCallback(value: string, expectedState: string): string {
  const callback = new URL(value);
  const expected = new URL(EXTENSION_REDIRECT_URI);
  if (
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    callback.hash
  ) {
    throw new Error(
      "OAuth callback URI does not match pinned extension redirect",
    );
  }
  const error = callback.searchParams.get("error");
  if (error) throw new Error(`OAuth authorization failed: ${error}`);
  if (callback.searchParams.get("state") !== expectedState) {
    throw new Error("OAuth state mismatch");
  }
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("OAuth callback is missing authorization code");
  return code;
}

function parseTokenResponse(value: unknown, nowMs: number): OAuthSessionToken {
  if (value === null || typeof value !== "object") {
    throw new Error("Invalid OAuth token response");
  }
  const token = value as Record<string, unknown>;
  const scopeParts =
    typeof token.scope === "string"
      ? token.scope.trim().split(/\s+/u).filter(Boolean)
      : [];
  if (
    typeof token.access_token !== "string" ||
    token.access_token.length === 0 ||
    token.token_type !== "Bearer" ||
    token.expires_in !== EXTENSION_ACCESS_TOKEN_TTL_SECONDS ||
    scopeParts.length !== 1 ||
    scopeParts[0] !== EXTENSION_SCOPE ||
    token.refresh_token !== undefined
  ) {
    throw new Error("Invalid OAuth token response");
  }
  return {
    accessToken: token.access_token,
    expiresAtMs: nowMs + EXTENSION_ACCESS_TOKEN_TTL_SECONDS * 1000,
    scope: EXTENSION_SCOPE,
  };
}

export function isOAuthSessionTokenUsable(
  value: unknown,
  nowMs = Date.now(),
): value is OAuthSessionToken {
  if (value === null || typeof value !== "object") return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.accessToken === "string" &&
    token.accessToken.length > 0 &&
    token.scope === EXTENSION_SCOPE &&
    typeof token.expiresAtMs === "number" &&
    Number.isFinite(token.expiresAtMs) &&
    token.expiresAtMs > nowMs
  );
}

async function launchChromeWebAuthFlow(url: string): Promise<string> {
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: true,
  });
  if (!responseUrl) throw new Error("OAuth flow did not return a callback URL");
  return responseUrl;
}

export class BrowserOAuthClient {
  private readonly gatewayOrigin: string;
  private readonly getRedirectUrl: () => string;
  private readonly launchWebAuthFlow: (url: string) => Promise<string>;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(baseUrl: string, dependencies: OAuthDependencies = {}) {
    this.gatewayOrigin = normalizeGatewayOrigin(baseUrl);
    this.getRedirectUrl =
      dependencies.getRedirectUrl ??
      (() => chrome.identity.getRedirectURL("oauth2"));
    this.launchWebAuthFlow =
      dependencies.launchWebAuthFlow ?? launchChromeWebAuthFlow;
    this.fetcher = dependencies.fetcher ?? browserFetch;
    this.now = dependencies.now ?? Date.now;
  }

  async login(): Promise<OAuthSessionToken> {
    const redirectUri = validateRedirectUri(this.getRedirectUrl());
    const verifier = randomBase64Url();
    const state = randomBase64Url();
    const challenge = await pkceS256(verifier);

    const authorize = new URL("/oauth/authorize", this.gatewayOrigin);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", EXTENSION_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("scope", EXTENSION_SCOPE);
    authorize.searchParams.set("state", state);

    const nextPath = `${authorize.pathname}${authorize.search}`;
    const login = new URL("/auth/login", this.gatewayOrigin);
    login.searchParams.set("next", nextPath);

    const callbackUrl = await this.launchWebAuthFlow(login.toString());
    const code = parseCallback(callbackUrl, state);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: EXTENSION_CLIENT_ID,
      code_verifier: verifier,
    });
    const response = await this.fetcher(
      new URL("/oauth/token", this.gatewayOrigin),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (response.status !== 200) {
      throw new Error(
        `OAuth token exchange failed with status ${response.status}`,
      );
    }
    return parseTokenResponse((await response.json()) as unknown, this.now());
  }
}

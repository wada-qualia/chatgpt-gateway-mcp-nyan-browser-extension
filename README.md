# ChatGPT MCP Browser Extension

First-party Chrome Manifest V3 development extension that adds ATLAS workflow controls to `chatgpt.com` while keeping ChatGPT as the owner of conversation state and native branching.

## Boundaries

- The extension owns its Manifest V3 client, ChatGPT DOM adapter, extension UI, browser-local prompt cache and immutable browser artifact.
- ChatGPT MCP Gateway owns browser authentication/authorization and is the only network API used by the extension.
- Prompt Registry owns prompt identities, immutable prompt versions/releases, channel pointers and revocation. The extension never calls Prompt Registry directly.
- Prompt text is data, never executable code. ChatGPT cookies/tokens and private ChatGPT HTTP APIs are not read or used.

## Identity and security

The deterministic development extension ID is `cgaalfflopmcbaodnlphklclnnhmdhcn`. The repository stores only the public manifest key; no private signing key is required or committed. The Gateway browser-client contract pins the corresponding exact OAuth redirect to `https://cgaalfflopmcbaodnlphklclnnhmdhcn.chromiumapp.org/oauth2`. The public client ID is `atlas-chatgpt-browser-extension`, and its only OAuth scope is `workspace:read`.

The content script runs in the isolated world. Gateway bearer credentials are confined to the MV3 service worker and `chrome.storage.session`. The manifest grants only `identity`, `storage`, and exact HTTPS origins. There is no `<all_urls>`, `eval`, remote executable code, `tabs`, or `webRequest` permission.

## Authentication

The ATLAS menu exposes explicit **Sign in** / **Sign out** controls. Sign in is always initiated by a user click and stays in the service worker: it resolves the exact Chromium redirect with `chrome.identity.getRedirectURL("oauth2")`, verifies that it equals the pinned redirect above, generates high-entropy `state` and an S256 PKCE verifier/challenge, resumes the Gateway `/oauth/authorize` request through `/auth/login`, validates callback origin/path/state, and exchanges the code at `/oauth/token` as a public client without a `client_secret`.

Only the bearer access token, expiry timestamp and `workspace:read` scope are stored in `chrome.storage.session`. Expired, legacy or wrong-scope tokens fail closed and are removed. No bearer value is returned to the content script or written to DOM/page JavaScript. Sign out clears the session token locally; the Gateway access token is additionally bounded by the one-hour browser-client TTL.

## Prompt delivery

The service worker consumes the accepted Gateway Prompt Registry facade:

- `GET /api/prompts/v1/releases/{channel}/manifest`
- `GET /api/prompts/v1/bundles/{bundle_id}`

It performs explicit ETag revalidation, verifies per-prompt and aggregate SHA-256, atomically stores the validated bundle in `chrome.storage.local`, keys policy state by opaque `cache_scope_id`, permits last-known-good fallback only inside `max_stale_seconds`, and purges/fails closed on known HTTP `410` revocation. A scope change never reuses a previous scope's bundle validator.

## User interaction

The content script mounts extension-owned controls next to a uniquely resolved composer. Takeoff, Plan, Phases and Current phase insert prompt text but never send automatically. Assistant `atlas-actions` blocks are treated as untrusted model output and only allow `compose`, `copy_prompt`, and native-DOM `branch_and_compose` after schema validation and an explicit click. DOM ambiguity fails closed.

## Development

Required CI toolchain is Node `22.22.0` and npm `10.9.4`.

```bash
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run check
npm run package
node scripts/generate-sbom.mjs
node scripts/generate-provenance.mjs
```

Set `ATLAS_GATEWAY_ORIGIN` to the approved exact HTTPS Gateway origin when producing a build that may contact Gateway, and optionally set `ATLAS_PROMPT_CHANNEL` (default `dev`). The build injects the origin into both the service-worker runtime configuration and the exact matching `host_permissions` entry; it rejects non-HTTPS/non-origin values and invalid channel names. The accepted current public Gateway origin is `https://gateway.example.com`, but it is intentionally not an implicit build default: networking remains an explicit build-time opt-in.

## CI/CD and artifacts

GitLab CI is independent from Gateway and Prompt Registry deployment. It validates dependencies, formatting, lint, typecheck, unit/DOM/cache tests, build and manifest policy, then produces:

- `chatgpt-mcp-browser-extension.zip`
- SHA-256 checksum
- CycloneDX 1.5 SBOM
- provenance JSON bound to source SHA and deterministic extension identity

Extension-only CI performs no Gateway blue/green deployment and no Prompt Registry deployment or publication.

The GitLab project must have an online untagged-capable Docker runner assigned, and the identity that creates a pipeline must retain project membership sufficient to read the repository. Keep repository visibility and CI job-token protections intact; fix missing runner assignment or membership instead of weakening those controls. When a pipeline fails before source checkout, prefer a new push pipeline after repairing project configuration rather than retrying a terminal job whose ephemeral pipeline ref may already have been removed.

## Rollback

Extension rollback is artifact-local: restore the previous verified ZIP/unpacked directory and reload the controlled development profile. Prompt-data rollback remains a Prompt Registry channel-pointer operation, and Gateway rollback is independent. No rollback domain rewrites another domain's data.

## Current integration status

The extension runtime/cache/action/DOM skeleton, Gateway OAuth public-client PKCE/login-resume path, exact Chromium redirect pinning, least-privilege `workspace:read` scope and independent artifact lane are implemented on the development feature line. Root control-plane placement registration and the controlled live Chrome pilot remain separate acceptance work and are not claimed complete here.

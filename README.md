# ChatGPT MCP Browser Extension

First-party Chrome Manifest V3 development extension that adds ATLAS workflow controls to `chatgpt.com` while keeping ChatGPT as the owner of conversation state and native branching.

## Boundaries

- The extension owns its Manifest V3 client, ChatGPT DOM adapter, extension UI, browser-local prompt cache and immutable browser artifact.
- ChatGPT MCP Gateway owns browser authentication/authorization and is the only network API used by the extension.
- Prompt Registry owns prompt identities, immutable prompt versions/releases, channel pointers and revocation. The extension never calls Prompt Registry directly.
- Prompt text is data, never executable code. ChatGPT cookies/tokens and private ChatGPT HTTP APIs are not read or used.

## Identity and security

The deterministic development extension ID is `cgaalfflopmcbaodnlphklclnnhmdhcn`. The repository stores only the public manifest key; no private signing key is required or committed. The corresponding exact OAuth redirect planned for Gateway integration is `https://cgaalfflopmcbaodnlphklclnnhmdhcn.chromiumapp.org/oauth2`.

The content script runs in the isolated world. Gateway bearer credentials are confined to the MV3 service worker and `chrome.storage.session`. The manifest grants only `identity`, `storage`, and exact HTTPS origins. There is no `<all_urls>`, `eval`, remote executable code, `tabs`, or `webRequest` permission.

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

Set `ATLAS_GATEWAY_ORIGIN` to the approved exact HTTPS Gateway origin when producing a build that may contact Gateway. The build injects only that exact origin into `host_permissions`; it rejects non-HTTPS or non-origin values.

## CI/CD and artifacts

GitLab CI is independent from Gateway and Prompt Registry deployment. It validates dependencies, formatting, lint, typecheck, unit/DOM/cache tests, build and manifest policy, then produces:

- `chatgpt-mcp-browser-extension.zip`
- SHA-256 checksum
- CycloneDX 1.5 SBOM
- provenance JSON bound to source SHA and deterministic extension identity

Extension-only CI performs no Gateway blue/green deployment and no Prompt Registry deployment or publication.

## Rollback

Extension rollback is artifact-local: restore the previous verified ZIP/unpacked directory and reload the controlled development profile. Prompt-data rollback remains a Prompt Registry channel-pointer operation, and Gateway rollback is independent. No rollback domain rewrites another domain's data.

## Current integration status

The extension runtime/cache/action/DOM skeleton and independent artifact lane are implemented on the development feature line. Gateway OAuth PKCE/login-resume, exact Chromium redirect registration, least-privilege extension scopes, root control-plane placement registration, and controlled live Chrome pilot remain separate acceptance work and are not claimed complete here.

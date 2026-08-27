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

The ATLAS menu exposes an explicit **Sign in** control when unauthenticated. After authentication it shows the Gateway `preferred_username` next to a user icon; clicking that profile opens a nested account menu containing **Sign out**. The display name is read through Gateway `/oauth/userinfo` by the service worker and is not persisted by the extension. Sign in is always initiated by a user click and stays in the service worker: it resolves the exact Chromium redirect with `chrome.identity.getRedirectURL("oauth2")`, verifies that it equals the pinned redirect above, generates high-entropy `state` and an S256 PKCE verifier/challenge, resumes the Gateway `/oauth/authorize` request through `/auth/login`, validates callback origin/path/state, and exchanges the code at `/oauth/token` as a public client without a `client_secret`.

Only the bearer access token, expiry timestamp and `workspace:read` scope are stored in `chrome.storage.session`. Expired, legacy or wrong-scope tokens fail closed and are removed. No bearer value is returned to the content script or written to DOM/page JavaScript. Sign out clears the session token locally; the Gateway access token is additionally bounded by the one-hour browser-client TTL.

## Prompt delivery

The service worker consumes the accepted Gateway Prompt Registry facade:

- `GET /api/prompts/v1/releases/{channel}/manifest`
- `GET /api/prompts/v1/bundles/{bundle_id}`

It performs explicit ETag revalidation, verifies per-prompt and aggregate SHA-256, atomically stores the validated bundle in `chrome.storage.local`, keys policy state by opaque `cache_scope_id`, permits last-known-good fallback only inside `max_stale_seconds`, and purges/fails closed on known HTTP `410` revocation. A scope change never reuses a previous scope's bundle validator.

## User interaction

The content script mounts extension-owned controls next to a uniquely resolved composer. Takeoff, Plan, Phases and Current phase insert prompt text but never send automatically. The prompt menu closes on outside click and `Escape`. Authenticated users are represented by a profile row with a nested sign-out menu instead of a direct logout action.

Settings opens an extension-owned full-screen overlay where projects are discovered from the visible native ChatGPT project links in the left sidebar and offered through a dropdown instead of requiring manual name entry. Adding a project stores its stable native `g-p-*` project id and display name locally; the user may select any subset and edit the project bootstrap prompt. Project names, selection state and the bootstrap template stay in `chrome.storage.local`; the extension does not call undocumented ChatGPT project APIs. A selected-project bootstrap is automatically inserted only when ChatGPT exposes a unique empty composer and there are no existing user/assistant messages; the extension never auto-sends it and never overwrites existing composer or conversation state. Each composer is bootstrapped at most once so manually clearing the draft does not cause immediate re-insertion. The supported template placeholder is `{{projects}}`. Hidden/private ChatGPT system prompts are intentionally not used because they would cross the documented ChatGPT ownership boundary.

Assistant `atlas-actions` blocks are treated as untrusted model output and only allow `compose`, `copy_prompt`, and native-DOM `branch_and_compose` after schema validation and an explicit click. DOM ambiguity fails closed.

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

For a controlled unpacked Chrome installation, build into one stable reload directory instead of a per-worktree `dist` path:

```bash
ATLAS_GATEWAY_ORIGIN=https://gateway.example.com ATLAS_PROMPT_CHANNEL=dev npm run build:unpacked
```

By default `build:unpacked` resolves the repository's primary Git worktree and atomically refreshes `<primary-worktree>/.atlas-unpacked/chatgpt-mcp-browser-extension`. Load that directory once with Chrome **Load unpacked**; subsequent builds keep the same path, so Chrome's **Reload** button is sufficient. `ATLAS_BUILD_INFO.json` records the source `HEAD`, extension version and `working_tree_dirty`; a clean build therefore has an exact source-SHA receipt while a development build is explicitly marked dirty. The stable unpacked directory is ignored by Git and is not a release source of truth. `ATLAS_UNPACKED_DIR` may override the target only for an explicitly controlled local install.

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

The extension runtime/cache/action/DOM integration, Gateway OAuth public-client PKCE/login-resume path, exact Chromium redirect pinning, least-privilege `workspace:read` scope, local project-aware settings, safe empty-chat bootstrap and independent artifact lane are implemented. Root control-plane placement is registered, and the controlled isolated Chrome-for-Testing pilot has accepted composer placement, outside-click/Escape dismissal, project persistence/multi-select, non-overwrite bootstrap semantics, authenticated username rendering, nested sign-out and logout token cleanup. This remains a controlled development/pilot extension; Chrome Web Store publication, managed-enterprise distribution and broad production rollout are not implied.

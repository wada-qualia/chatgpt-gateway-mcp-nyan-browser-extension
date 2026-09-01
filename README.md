# ChatGPT Gateway MCP Nyan Browser Extension

Chrome Manifest V3 extension that adds ChatGPT-side controls for [ChatGPT Gateway MCP Nyan](https://github.com/wada-qualia/chatgpt-gateway-mcp-nyan).

The extension keeps ChatGPT as the owner of conversation state. It provides Gateway authentication, project/bootstrap settings, chat-context binding and explicit user-triggered workflow actions without injecting a remote script or taking over native conversation branching.

## Security boundary

The extension is deliberately narrow:

- content scripts run in Chrome's `ISOLATED` world;
- permissions are limited to `identity` and `storage`;
- the default host permission is only `https://chatgpt.com/*`;
- a Gateway origin is injected only at build time and must be an exact HTTPS origin;
- the public build exposes no `web_accessible_resources`;
- OAuth uses PKCE and a public client without a client secret;
- assistant action blocks are treated as untrusted model output and require schema validation plus an explicit click.

The deterministic manifest public key produces extension ID `cgaalfflopmcbaodnlphklclnnhmdhcn` and redirect URI `https://cgaalfflopmcbaodnlphklclnnhmdhcn.chromiumapp.org/oauth2`. The Gateway deployment must register the public client ID `chatgpt-gateway-mcp-nyan-browser-extension` with that exact redirect and the required scope.

No private signing key is stored in this repository.

## Build

```bash
npm ci
npm run check
```

PowerShell:

```powershell
npm ci
npm run check
```

A build with no Gateway origin remains network-disabled apart from ChatGPT itself. To build for a specific Gateway:

```bash
ATLAS_GATEWAY_ORIGIN=https://gateway.example.com npm run build
```

PowerShell:

```powershell
$env:ATLAS_GATEWAY_ORIGIN = "https://gateway.example.com"
npm run build
```

`ATLAS_GATEWAY_ORIGIN`, `ATLAS_PROMPT_CHANNEL`, `atlas.*` storage keys, `atlas-actions` envelopes and `data-atlas-*` DOM attributes are retained as versioned compatibility identifiers from the existing deployed client. They are not a requirement that downstream deployments use ATLAS as their public product name. Renaming them requires an explicit migration/compatibility plan.

## Load unpacked

After `npm run build`, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`.

For local development the legacy `npm run build:unpacked` helper maintains a stable `.atlas-unpacked/` directory so Chrome can reload the same extension path between builds.

## OAuth and user interaction

Sign-in is initiated only by an explicit user action. The service worker obtains the exact Chrome redirect URI, creates high-entropy state and an S256 PKCE verifier/challenge, validates the callback, then exchanges the authorization code at the configured Gateway.

The content script never receives or stores a client secret. Session/access state should still be treated as sensitive browser data.

## Workflow actions

The extension recognizes the existing fenced `atlas-actions` envelope for compatibility. Supported actions are bounded and validated before display. The extension never treats arbitrary assistant text as executable code.

## Related repositories

- Gateway core: https://github.com/wada-qualia/chatgpt-gateway-mcp-nyan
- CLI/thin client: https://github.com/wada-qualia/chatgpt-gateway-mcp-nyan-cli

## License

The publication candidate uses Apache License 2.0. Final public visibility remains subject to the repository owner's OSS license approval.

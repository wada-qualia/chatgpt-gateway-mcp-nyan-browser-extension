# Security Policy

## Scope

This repository contains the ChatGPT-side browser extension for ChatGPT Gateway MCP Nyan. It does not contain Gateway server credentials, private signing keys, production browser profiles or deployment secrets.

## Trust model

The extension runs on `https://chatgpt.com/*` in Chrome's isolated content-script world and communicates only with an explicitly configured exact HTTPS Gateway origin. A user should connect only to a Gateway operator and authorization policy they trust.

## OAuth

The extension is a public OAuth client. It uses PKCE and an exact Chromium redirect URI and does not use or store a `client_secret`. Access/session state in browser storage is still sensitive and should not be copied into public diagnostics or issues.

## Permissions

The public manifest is intentionally bounded to `identity` and `storage`, the ChatGPT host permission, and an optional exact build-time Gateway origin. Public builds must not contain `<all_urls>`, remote executable code, `eval`, wildcard Gateway origins or web-accessible extension assets.

## Model output

`atlas-actions` is a compatibility protocol for bounded workflow actions. Assistant output is untrusted. Actions must pass schema validation and require explicit user interaction before any supported operation is performed.

## Compatibility identifiers

Legacy `ATLAS_*`, `atlas.*`, `atlas-actions` and `data-atlas-*` identifiers are versioned compatibility surfaces. Security-sensitive renaming requires an explicit state/protocol migration rather than a cosmetic search-and-replace.

## Reporting

Use GitHub private vulnerability reporting once enabled for the public repository. Do not include credentials, active access tokens, private infrastructure details, browser profiles or unrelated user data in public issues.

# Contributing

Contributions should preserve the extension's least-privilege browser boundary and compatibility with deployed Gateway clients.

## Setup

```bash
npm ci
npm run check
```

PowerShell:

```powershell
npm ci
npm run check
```

## Required properties

Changes to OAuth, ChatGPT DOM integration, chat-context binding, local storage, action parsing, permissions or build-time Gateway origin handling should include focused tests and remain fail-closed on ambiguity.

Do not add private Gateway endpoints, credentials, browser cookies/profiles, private signing keys, production-only topology or assets without redistribution provenance.

Legacy `ATLAS_*`, `atlas.*`, `atlas-actions` and `data-atlas-*` names are compatibility surfaces. A rename requires a versioned migration and backward-compatibility plan.

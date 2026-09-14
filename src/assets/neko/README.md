# Neko toggle assets

Repository-owned static PNG assets for the ATLAS composer toggle. The current inventory was imported 1:1 from the user-provided icon set on 2026-08-27; no runtime filesystem access or remote asset fetch is allowed.

`index.ts` is the typed asset catalog used by TypeScript UI code and is compatible with React/TS consumers. Runtime code resolves catalog paths through `chrome.runtime.getURL()`. The build copies only `waiting/*.png` and `interesting/*.png` into `dist/assets/neko`, while Manifest V3 exposes those files only to `https://chatgpt.com/*`.

Inventory invariants are enforced by `tests/nekoAssets.test.ts` and `scripts/validate-manifest.mjs`.

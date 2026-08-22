#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
npm run build
npm run manifest:check
rm -rf artifacts
mkdir -p artifacts
find dist -type f -exec touch -t 198001010000 {} +
(
  cd dist
  find . -type f -print | LC_ALL=C sort | zip -X -q "../artifacts/chatgpt-mcp-browser-extension.zip" -@
)
shasum -a 256 artifacts/chatgpt-mcp-browser-extension.zip > artifacts/chatgpt-mcp-browser-extension.zip.sha256
cat artifacts/chatgpt-mcp-browser-extension.zip.sha256

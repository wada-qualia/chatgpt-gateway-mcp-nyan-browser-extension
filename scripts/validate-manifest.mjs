import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "dist/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3 required");
if (!Array.isArray(manifest.permissions))
  throw new Error("permissions missing");
for (const forbidden of [
  "tabs",
  "scripting",
  "webRequest",
  "webRequestBlocking",
]) {
  if (manifest.permissions.includes(forbidden))
    throw new Error(`forbidden permission: ${forbidden}`);
}
if (
  !manifest.permissions.includes("storage") ||
  !manifest.permissions.includes("identity")
) {
  throw new Error("storage + identity permissions required");
}
if (
  !Array.isArray(manifest.host_permissions) ||
  manifest.host_permissions.includes("<all_urls>")
) {
  throw new Error("invalid host permissions");
}
for (const host of manifest.host_permissions) {
  if (
    host !== "https://chatgpt.com/*" &&
    !/^https:\/\/[^/*]+\/\*$/.test(host)
  ) {
    throw new Error(`host permission must be exact-origin scoped: ${host}`);
  }
}
const content = manifest.content_scripts?.[0];
if (content?.world !== "ISOLATED")
  throw new Error("content script must use isolated world");
if (
  manifest.content_security_policy?.extension_pages !==
  "script-src 'self'; object-src 'self'"
) {
  throw new Error("unexpected extension CSP");
}
const serialized = JSON.stringify(manifest);
for (const forbidden of ["eval(", "http://", "https://*."]) {
  if (serialized.includes(forbidden))
    throw new Error(`forbidden manifest token: ${forbidden}`);
}
console.log("manifest policy: passed");

import { readdir, readFile } from "node:fs/promises";
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

const expectedNekoResources = [
  "assets/neko/interesting/*.png",
  "assets/neko/waiting/*.png",
];
const webAccessibleResources = manifest.web_accessible_resources;
if (
  !Array.isArray(webAccessibleResources) ||
  webAccessibleResources.length !== 1
) {
  throw new Error("exactly one web-accessible resource group is required");
}
const nekoResources = webAccessibleResources[0];
if (
  !Array.isArray(nekoResources?.resources) ||
  JSON.stringify([...nekoResources.resources].sort()) !==
    JSON.stringify(expectedNekoResources) ||
  JSON.stringify(nekoResources.matches) !==
    JSON.stringify(["https://chatgpt.com/*"])
) {
  throw new Error("neko assets must stay scoped to chatgpt.com");
}
for (const [mood, expectedCount] of [
  ["waiting", 26],
  ["interesting", 25],
]) {
  const entries = await readdir(
    resolve(process.cwd(), "dist/assets/neko", mood),
    { withFileTypes: true },
  );
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  if (
    files.length !== expectedCount ||
    files.some((name) => !/^icon_[0-9]{2}\.png$/u.test(name))
  ) {
    throw new Error(`unexpected ${mood} neko asset inventory`);
  }
}

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

for (const scriptName of ["content.js", "serviceWorker.js"]) {
  const script = await readFile(
    resolve(process.cwd(), "dist", scriptName),
    "utf8",
  );
  for (const [label, pattern] of [
    ["eval", /\beval\s*\(/u],
    ["Function constructor", /\bnew\s+Function\s*\(/u],
  ]) {
    if (pattern.test(script)) {
      throw new Error(`${scriptName} contains CSP-unsafe ${label}`);
    }
  }
}
console.log("manifest policy: passed");

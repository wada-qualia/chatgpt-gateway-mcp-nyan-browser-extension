import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const checksumLine = (
  await readFile(
    resolve(root, "artifacts/chatgpt-mcp-browser-extension.zip.sha256"),
    "utf8",
  )
).trim();
const artifactSha256 = checksumLine.split(/\s+/)[0];
if (!/^[0-9a-f]{64}$/.test(artifactSha256))
  throw new Error("invalid artifact SHA-256");
const sourceSha =
  process.env.CI_COMMIT_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("invalid source SHA");
const sourceRef =
  process.env.CI_COMMIT_REF_NAME ??
  execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim();

const provenance = {
  schema_version: 1,
  project: "products/2026q3-int-web-chatgpt-mcp-browser-extension",
  package: pkg.name,
  version: pkg.version,
  source_sha: sourceSha,
  source_ref: sourceRef,
  extension_id: "cgaalfflopmcbaodnlphklclnnhmdhcn",
  manifest_public_key_sha256:
    "2600b55befc210e3dbf7ab2bdd7c372d58b57ca79f7589e5ed98107ed7b48109",
  artifact: "chatgpt-mcp-browser-extension.zip",
  artifact_sha256: artifactSha256,
  gateway_contract: "prompt-registry-facade/v1",
  prompt_registry_direct_access: false,
  node: process.version,
  npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
};
await writeFile(
  resolve(root, "artifacts/provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
console.log(`PROVENANCE_SOURCE_SHA=${sourceSha}`);
console.log(`PROVENANCE_ARTIFACT_SHA256=${artifactSha256}`);

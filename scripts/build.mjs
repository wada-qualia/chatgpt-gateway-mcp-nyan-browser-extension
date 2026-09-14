import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const gatewayOriginInput = process.env.ATLAS_GATEWAY_ORIGIN?.trim() ?? "";
let gatewayOrigin = "";
if (gatewayOriginInput) {
  const url = new URL(gatewayOriginInput);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("ATLAS_GATEWAY_ORIGIN must be an exact HTTPS origin");
  }
  gatewayOrigin = url.origin;
}

const promptChannel = process.env.ATLAS_PROMPT_CHANNEL?.trim() || "dev";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(promptChannel)) {
  throw new Error("ATLAS_PROMPT_CHANNEL is invalid");
}

await build({
  absWorkingDir: root,
  entryPoints: ["src/content.ts", "src/serviceWorker.ts"],
  bundle: true,
  format: "esm",
  target: ["chrome131"],
  outdir: "dist",
  entryNames: "[name]",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  define: {
    __ATLAS_GATEWAY_ORIGIN__: JSON.stringify(gatewayOrigin),
    __ATLAS_PROMPT_CHANNEL__: JSON.stringify(promptChannel),
  },
});

await cp(resolve(root, "src/styles.css"), resolve(dist, "styles.css"));
const nekoAssetTarget = resolve(dist, "assets/neko");
await mkdir(nekoAssetTarget, { recursive: true });
for (const mood of ["waiting", "interesting"]) {
  await cp(
    resolve(root, "src/assets/neko", mood),
    resolve(nekoAssetTarget, mood),
    { recursive: true },
  );
}
const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8"),
);
if (gatewayOrigin) {
  manifest.host_permissions = [
    ...new Set([...manifest.host_permissions, `${gatewayOrigin}/*`]),
  ].sort();
}
await writeFile(
  resolve(dist, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

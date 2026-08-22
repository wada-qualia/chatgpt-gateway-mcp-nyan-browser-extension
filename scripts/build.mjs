import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

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
});

await cp(resolve(root, "src/styles.css"), resolve(dist, "styles.css"));
const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8"),
);
const gatewayOrigin = process.env.ATLAS_GATEWAY_ORIGIN?.trim();
if (gatewayOrigin) {
  const url = new URL(gatewayOrigin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("ATLAS_GATEWAY_ORIGIN must be an HTTPS origin");
  }
  manifest.host_permissions = [
    ...new Set([...manifest.host_permissions, `${url.origin}/*`]),
  ].sort();
}
await writeFile(
  resolve(dist, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

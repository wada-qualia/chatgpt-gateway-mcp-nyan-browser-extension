import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const lock = JSON.parse(
  await readFile(resolve(root, "package-lock.json"), "utf8"),
);
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

const components = [];
for (const [path, value] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith("node_modules/")) continue;
  const item = value;
  if (!item || typeof item !== "object" || typeof item.version !== "string")
    continue;
  const name =
    typeof item.name === "string"
      ? item.name
      : path.slice("node_modules/".length);
  components.push({
    type: "library",
    name,
    version: item.version,
    purl: `pkg:npm/${encodeURIComponent(name)}@${item.version}`,
    scope: item.dev === true ? "optional" : "required",
  });
}
components.sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${encodeURIComponent(pkg.name)}@${pkg.version}`,
    },
  },
  components,
};
await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(
  resolve(root, "artifacts/sbom.cdx.json"),
  `${JSON.stringify(sbom, null, 2)}\n`,
);
console.log(`SBOM_COMPONENTS=${components.length}`);

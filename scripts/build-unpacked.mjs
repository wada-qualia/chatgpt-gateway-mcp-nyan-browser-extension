import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [resolve(root, "scripts/build.mjs")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
const firstWorktree = worktrees
  .split(/\r?\n/u)
  .find((line) => line.startsWith("worktree "))
  ?.slice("worktree ".length)
  .trim();
if (!firstWorktree) throw new Error("unable to resolve primary Git worktree");

const stableBase = resolve(firstWorktree, ".atlas-unpacked");
const configuredTarget = process.env.ATLAS_UNPACKED_DIR?.trim();
const target = configuredTarget
  ? resolve(configuredTarget)
  : resolve(stableBase, "chatgpt-mcp-browser-extension");
const safeDefaultPrefix = `${stableBase}${sep}`;
if (!configuredTarget && !target.startsWith(safeDefaultPrefix)) {
  throw new Error("refusing to write unpacked build outside .atlas-unpacked");
}
if (
  target === resolve(firstWorktree) ||
  target === resolve(firstWorktree, ".git")
) {
  throw new Error("refusing unsafe unpacked build target");
}

const temporary = `${target}.tmp-${process.pid}`;
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });
await cp(resolve(root, "dist"), temporary, { recursive: true });
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const workingTreeDirty =
  execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  }).trim().length > 0;
const manifest = JSON.parse(
  await readFile(resolve(temporary, "manifest.json"), "utf8"),
);
await writeFile(
  resolve(temporary, "ATLAS_BUILD_INFO.json"),
  `${JSON.stringify(
    {
      source_sha: sourceSha,
      working_tree_dirty: workingTreeDirty,
      extension_id_source: "manifest.key",
      version: manifest.version,
    },
    null,
    2,
  )}\n`,
);
await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(temporary, target, { recursive: true });
await rm(temporary, { recursive: true, force: true });

console.log(`ATLAS_UNPACKED_DIR=${target}`);
console.log(`ATLAS_UNPACKED_SOURCE_SHA=${sourceSha}`);
console.log(`ATLAS_UNPACKED_WORKING_TREE_DIRTY=${String(workingTreeDirty)}`);

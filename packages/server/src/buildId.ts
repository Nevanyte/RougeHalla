import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The wire build: a hash of the TypeScript under packages/shared/src, the contract both ends decode (the fx codec, the schema, the
 * messages, the constants). The production client build bakes it in (client/vite.config.ts) and a server that serves the page
 * requires it at join (RaidRoom.onAuth), so a tab that outlived a deploy of a changed contract is told to reload instead of
 * dropping what it can no longer read. It covers shared sources only: a server-only or client-only change keeps every open tab
 * valid. Only `.ts` files, so a stray .DS_Store or build leftover cannot make two checkouts of one commit differ.
 */
export function computeWireBuildId(root = fileURLToPath(new URL("../../../", import.meta.url))): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(name);
    }
  };
  walk("packages/shared/src");
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(file).update("\0").update(fs.readFileSync(path.join(root, file))).update("\0");
  return hash.digest("hex");
}

let wireBuildOnce: string | null | undefined;

/** computeWireBuildId() once per process, or undefined when the sources are not there to read (the check then stays off). */
export function wireBuildId(): string | undefined {
  if (wireBuildOnce === undefined) {
    try { wireBuildOnce = computeWireBuildId(); } catch { wireBuildOnce = null; }
  }
  return wireBuildOnce ?? undefined;
}

/** Hash the executable sources, map worker and dependency lock independently of image labels. */
export function computeServerBuildId(root = fileURLToPath(new URL("../../../", import.meta.url))): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push(name);
    }
  };
  walk("packages/server/src");
  walk("packages/shared/src");
  files.push("package-lock.json", "packages/server/package.json", "packages/shared/package.json");
  for (const file of ["index.mjs", "mapWorker.mjs", "mapWorkerBoot.mjs"]) {
    const compiled = `packages/server/dist/${file}`;
    if (fs.existsSync(path.join(root, compiled))) files.push(compiled);
  }
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(file).update("\0").update(fs.readFileSync(path.join(root, file))).update("\0");
  return hash.digest("hex");
}

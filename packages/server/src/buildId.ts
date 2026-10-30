import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

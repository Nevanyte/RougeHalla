import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = `${root}packages/server/dist`;
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["packages/server/src/index.ts", "packages/server/src/mapWorker.ts"],
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node24",
  format: "esm",
  alias: {
    "@raid/shared/schema": `${root}packages/shared/src/schema.ts`,
    "@raid/shared": `${root}packages/shared/src/index.ts`,
  },
  sourcemap: true,
  logLevel: "info",
});
// The production worker starts compiled JavaScript; development keeps its existing tsx boot file.
await writeFile(`${outdir}/mapWorkerBoot.mjs`, 'await import("./mapWorker.mjs");\n');

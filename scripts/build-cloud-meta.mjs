import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { computeServerBuildId } from "../packages/server/src/buildId.ts";

const root = new URL("../", import.meta.url);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
await fs.mkdir(new URL("deployment/cloudflare/", root), { recursive: true });
await fs.writeFile(new URL("deployment/cloudflare/build-meta.json", root), `${JSON.stringify({ serverBuild: computeServerBuildId() })}\n`);
await fs.mkdir(new URL("packages/client/dist/", root), { recursive: true });
await fs.writeFile(new URL("packages/client/dist/build-info.json", root), `${JSON.stringify({
  sourceCommit, serverBuild: computeServerBuildId(), builtAt: new Date().toISOString(),
})}\n`);

import fs from "node:fs/promises";
import { computeServerBuildId } from "../packages/server/src/buildId.ts";

const root = new URL("../", import.meta.url);
await fs.mkdir(new URL("deployment/cloudflare/", root), { recursive: true });
await fs.writeFile(new URL("deployment/cloudflare/build-meta.json", root), `${JSON.stringify({ serverBuild: computeServerBuildId() })}\n`);
await fs.mkdir(new URL("packages/client/dist/", root), { recursive: true });
await fs.writeFile(new URL("packages/client/dist/build-info.json", root), `${JSON.stringify({
  gameplayCommit: "377bbfb530004dd005b22c763f45775dac5777f8", serverBuild: computeServerBuildId(), builtAt: new Date().toISOString(),
})}\n`);

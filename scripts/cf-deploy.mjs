// `npm run deploy`'s publish step: `wrangler deploy` for the Cloudflare Worker and its game container image.
//
// Wrangler logs Docker in to Cloudflare's image registry before it pushes. On a Mac whose Docker keeps logins in the keychain
// (`"credsStore": "desktop"` or `"osxkeychain"` in ~/.docker/config.json), saving that login runs `docker-credential-desktop store`,
// which can wait forever on a keychain prompt nobody sees (2026-11-03: a deploy sat 1.5 h on it and published nothing). So when the
// user's Docker uses a keychain helper, the push runs with a private throwaway DOCKER_CONFIG instead: no credential helper (the
// short-lived registry token sits in a 0600 file in a 0700 temp directory, deleted when wrangler exits), Docker Desktop's CLI
// plugins (buildx) still found, and the Docker Desktop socket named directly since the config's contexts are not carried over.
// Anywhere else (CI, Linux, a file store) wrangler runs with the environment as it is.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = ["wrangler", "deploy", "--config", "deployment/cloudflare/wrangler.jsonc", ...process.argv.slice(2)];
const home = os.homedir();
const userConfigDir = process.env.DOCKER_CONFIG ?? path.join(home, ".docker");
const env = { ...process.env };
let tmp = null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const userConfig = readJson(path.join(userConfigDir, "config.json"));
const keychain = userConfig !== null && ["desktop", "osxkeychain"].includes(userConfig.credsStore);
if (keychain) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roguehalla-docker-"));
  fs.chmodSync(tmp, 0o700);
  const plugins = [path.join(userConfigDir, "cli-plugins"), "/Applications/Docker.app/Contents/Resources/cli-plugins"]
    .filter((dir) => fs.existsSync(dir));
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ auths: {}, cliPluginsExtraDirs: plugins }, null, 2), { mode: 0o600 });
  env.DOCKER_CONFIG = tmp;
  const socket = path.join(home, ".docker", "run", "docker.sock");
  if (!env.DOCKER_HOST && fs.existsSync(socket)) env.DOCKER_HOST = `unix://${socket}`;
  console.log(`[cf-deploy] Docker keeps logins in the keychain (credsStore "${userConfig.credsStore}"): publishing with a private Docker config instead`);
}

const cleanup = () => {
  if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
};
const child = spawn("npx", args, { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});

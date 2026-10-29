import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { alive, productionEnvironment, readJson, validateConfig, writeJson } from "../../../scripts/deploy-lib.mjs";
import { switchRelease } from "../../../scripts/deploy.mjs";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtures: string[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await check()) return; await delay(30); }
  throw new Error("Temporary deployment process did not reach its expected state");
}
async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No temporary TCP port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    let ledger = "";
    try { ledger = await fs.readFile(path.join(root, "state/server-pids"), "utf8"); } catch { /* no server started */ }
    for (const pid of new Set(ledger.trim().split("\n").filter(Boolean).map(Number))) {
      if (!alive(pid)) continue;
      const actual = (await execute("ps", ["-p", String(pid), "-o", "command="])).stdout;
      // Only these tests' isolated launchers may receive teardown signals.
      if (!actual.includes(path.join(root, "releases"))) throw new Error("Temporary PID no longer belongs to this fixture");
      process.kill(pid, "SIGTERM");
      await waitFor(async () => !alive(pid));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "rougehalla-deploy-lifecycle-")));
  fixtures.push(root);
  const stateDir = path.join(root, "state");
  await fs.mkdir(stateDir, { mode: 0o700 });
  const port = await availablePort();
  const config = validateConfig({ repository: "file:///unused-test-repo.git", stateDir,
    releasesDir: path.join(root, "releases"), port, publicUrl: `http://127.0.0.1:${port}`,
    readyTimeoutMs: 1000, verifyTimeoutMs: 1000 });
  const original = '{"profiles":{"tester":{"token":"fixture-only-token","gv":7}}}\n';
  await fs.writeFile(config.stashFile, original, { mode: 0o600 });
  await writeJson(path.join(stateDir, "server-environment.json"), {});
  return { root, config, original };
}

async function release(config: ReturnType<typeof validateConfig>, name: string, mode = "healthy") {
  const releaseDir = path.join(config.releasesDir, name);
  const cwd = path.join(releaseDir, "packages/server");
  const client = path.join(releaseDir, "packages/client/dist");
  await fs.mkdir(path.join(cwd, "src"), { recursive: true });
  await fs.mkdir(path.join(client, "assets"), { recursive: true });
  await fs.mkdir(path.join(releaseDir, "scripts"), { recursive: true });
  // Resolve the real tsx loader while keeping fixture server code isolated.
  await fs.symlink(path.join(repositoryRoot, "node_modules"), path.join(releaseDir, "node_modules"), "dir");
  await fs.writeFile(path.join(cwd, "src/config.ts"), "// Environment-free fixture\n");
  const commit = (name === "previous" ? "a" : "b").repeat(40);
  await writeJson(path.join(client, "build-info.json"), { commit });
  await fs.writeFile(path.join(client, "assets", `${name}-hashed.js`), name);
  await writeJson(path.join(releaseDir, ".rougehalla-release.json"), { owner: "rougehalla-deployer-v1", commit, assets: [`${name}-hashed.js`] });
  const launcher = path.join(releaseDir, "scripts/deploy-server.mjs");
  await fs.writeFile(launcher, `
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const mode = ${JSON.stringify(mode)};
const stash = process.env.STASH_FILE;
const lock = stash + ".lock";
fs.appendFileSync(path.join(path.dirname(stash), "server-pids"), process.pid + "\\n");
if (mode === "before-lock") {
  setInterval(() => {}, 1000);
} else {
  fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
  if (mode === "crash-after-lock") process.exit(1);
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url.startsWith("/api/health")) response.end('{"ok":true}');
    else if (request.url.startsWith("/build-info.json")) {
      if (mode === "wrong-public-commit") {
        const progress = JSON.parse(fs.readFileSync(stash, "utf8"));
        progress.profiles.tester.gv = 19;
        fs.writeFileSync(stash, JSON.stringify(progress) + "\\n");
        response.end('{"commit":"unexpected"}');
      } else response.end(fs.readFileSync(path.join(process.env.CLIENT_DIR, "build-info.json")));
    } else { response.statusCode = 404; response.end('{}'); }
  });
  process.on("SIGTERM", () => {
    if (fs.existsSync(lock) && fs.readFileSync(lock, "utf8").trim() === String(process.pid)) fs.unlinkSync(lock);
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
  server.listen(Number(process.env.RAID_PORT), "0.0.0.0");
}
`);
  return { releaseDir, commit, port: config.port, launcher, cwd };
}

async function initialServer(config: ReturnType<typeof validateConfig>, previous: Awaited<ReturnType<typeof release>>) {
  // Deliberately use different arguments from deploy's launcher to test that a
  // restored server gets fresh command metadata rather than old argv.
  const child = spawn(config.nodeBinary, ["--no-warnings", "--import", "tsx", previous.launcher], {
    cwd: previous.cwd, env: productionEnvironment({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, {}, config, previous.releaseDir), stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  await waitFor(async () => {
    try {
      const owner = await fs.readFile(`${config.stashFile}.lock`, "utf8");
      const response = await fetch(`${config.publicUrl}/api/health`);
      return owner.trim() === String(child.pid) && response.ok;
    } catch { return false; }
  });
  const command = (await execute("ps", ["-p", String(child.pid), "-o", "command="])).stdout.trim();
  const record = { ...previous, pid: child.pid!, command, health: "ok" };
  await writeJson(path.join(config.stateDir, "deployment.json"), record);
  return record;
}

describe("real deployment process lifecycle", () => {
  it("switches verified processes while preserving profile bytes and hashed assets", async () => {
    const { config, original } = await fixture();
    const previous = await initialServer(config, await release(config, "previous"));
    const target = await release(config, "next");
    const result = await switchRelease(config, previous, target);
    expect(alive(previous.pid)).toBe(false);
    expect(alive(result.pid)).toBe(true);
    expect(await fs.readFile(`${config.stashFile}.lock`, "utf8")).toBe(String(result.pid));
    expect(await fs.readFile(config.stashFile, "utf8")).toBe(original);
    expect(await fs.readFile(path.join(result.backup, "profiles-after-shutdown.json"), "utf8")).toBe(original);
    expect((await fs.stat(path.join(result.backup, "profiles-after-shutdown.json"))).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(path.join(target.releaseDir, "packages/client/dist/assets/previous-hashed.js"), "utf8")).toBe("previous");
    expect(result.previous.commit).toBe(previous.commit);
    expect(await readJson(path.join(config.stateDir, "deploy-pending.json"))).toBeNull();
  });

  it("stops an attested startup hung before its profile lock and restores the previous release", async () => {
    const { config, original } = await fixture();
    const previous = await initialServer(config, await release(config, "previous"));
    const target = await release(config, "next", "before-lock");
    await expect(switchRelease(config, previous, target)).rejects.toThrow("local health/profile-lock check");
    const restored = await readJson(path.join(config.stateDir, "deployment.json"));
    expect(restored.commit).toBe(previous.commit);
    expect(restored.pid).not.toBe(previous.pid);
    expect(alive(restored.pid)).toBe(true);
    expect(restored.command).not.toContain("--no-warnings");
    expect(await fs.readFile(config.stashFile, "utf8")).toBe(original);
    expect(await fs.readFile(`${config.stashFile}.lock`, "utf8")).toBe(String(restored.pid));
    const pids = (await fs.readFile(path.join(config.stateDir, "server-pids"), "utf8")).trim().split("\n").map(Number);
    expect(pids).toHaveLength(3);
    expect(pids.filter((pid) => alive(pid))).toEqual([restored.pid]);
    expect(await readJson(path.join(config.stateDir, "deploy-pending.json"))).toBeNull();
  });

  it("rolls back public verification failure without reverting progress earned by the failed release", async () => {
    const { config } = await fixture();
    const previous = await initialServer(config, await release(config, "previous"));
    const target = await release(config, "next", "wrong-public-commit");
    await expect(switchRelease(config, previous, target)).rejects.toThrow("Public build-info does not match");
    const restored = await readJson(path.join(config.stateDir, "deployment.json"));
    expect(restored.commit).toBe(previous.commit);
    expect(alive(restored.pid)).toBe(true);
    expect((await readJson(config.stashFile)).profiles.tester).toEqual({ token: "fixture-only-token", gv: 19 });
    expect(await fs.readFile(`${config.stashFile}.lock`, "utf8")).toBe(String(restored.pid));
    const pids = (await fs.readFile(path.join(config.stateDir, "server-pids"), "utf8")).trim().split("\n").map(Number);
    expect(pids).toHaveLength(3);
    expect(pids.filter((pid) => alive(pid))).toEqual([restored.pid]);
    expect(await readJson(path.join(config.stateDir, "deploy-pending.json"))).toBeNull();
  });

  it("reclaims only a crashed attested child's stale lock before restoring the previous process", async () => {
    const { config, original } = await fixture();
    const previous = await initialServer(config, await release(config, "previous"));
    const target = await release(config, "next", "crash-after-lock");
    await expect(switchRelease(config, previous, target)).rejects.toThrow("New server exited before");
    const restored = await readJson(path.join(config.stateDir, "deployment.json"));
    expect(restored.commit).toBe(previous.commit);
    expect(await fs.readFile(config.stashFile, "utf8")).toBe(original);
    expect(await fs.readFile(`${config.stashFile}.lock`, "utf8")).toBe(String(restored.pid));
    const pids = (await fs.readFile(path.join(config.stateDir, "server-pids"), "utf8")).trim().split("\n").map(Number);
    expect(pids).toHaveLength(3);
    expect(pids.filter((pid) => alive(pid))).toEqual([restored.pid]);
    expect(await readJson(path.join(config.stateDir, "deploy-pending.json"))).toBeNull();
  });
});

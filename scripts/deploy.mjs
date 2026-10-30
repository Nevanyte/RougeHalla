#!/usr/bin/env node
// Builds immutable releases before touching the live process. No user checkout is modified.
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { acquireLock, alive, assertLocalHostingUrl, parseArgs, productionEnvironment, readJson, sleep, validateConfig, writeJson } from "./deploy-lib.mjs";

const execute = promisify(execFile);
const spawnedServers = new Map();
let diagnosticsFile;
const HELP = `Usage: node scripts/deploy.mjs [deploy|status|rollback] [options]
  deploy              fetch, install, typecheck, build, smoke-test, then switch (default)
  status              show the recorded release and current local/public health
  rollback            switch to the previous release, keeping current player progress
  --config <file>     private JSON config (default ~/.rougehalla/deploy-config.json)
  --ref <branch|SHA>   deploy a specific remote branch or commit
  --retry             retry a commit previously rejected by deployment checks
  --json              print a single machine-readable result; progress goes to stderr
  -h, --help          show this help`;
const dist = (root) => path.join(root, "packages/client/dist");
const recordFile = (config) => path.join(config.stateDir, "deployment.json");
const failureFile = (config) => path.join(config.stateDir, "deploy-failure.json");
const within = (root, file) => { const relative = path.relative(root, file); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
async function exists(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function command(binary, args, options = {}) {
  try { return (await execute(binary, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options })).stdout.trim(); }
  catch (error) {
    if (diagnosticsFile) {
      const details = `${new Date().toISOString()} ${path.basename(binary)} failed\n${String(error.stderr ?? error.message).slice(-16_384)}\n`;
      await fs.appendFile(diagnosticsFile, details, { mode: 0o600 });
    }
    throw new Error(`${path.basename(binary)} ${args[0] ?? ""} failed; inspect the private deployment log`);
  }
}
async function git(config, args) {
  return command("git", ["--git-dir", config.repositoryDir, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
async function portFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    server.listen(port, "0.0.0.0", () => server.close(() => resolve(true)));
  });
}
async function lockPid(config) {
  try { const text = (await fs.readFile(`${config.stashFile}.lock`, "utf8")).trim(); return /^\d+$/.test(text) ? Number(text) : -1; }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function localHealth(config) {
  try { const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(2000) }); return response.ok && (await response.json()).ok === true; }
  catch { return false; }
}
async function publicCommit(config, commit) {
  try {
    const text = await command("curl", ["--fail", "--silent", "--show-error", "--max-time", "8", "--header", "Cache-Control: no-cache",
      `${config.publicUrl}/build-info.json?deploy=${encodeURIComponent(commit)}-${Date.now()}`], { timeout: 10_000 });
    return JSON.parse(text).commit === commit;
  } catch { return false; }
}
async function waitFor(check, seconds, message) {
  const until = Date.now() + seconds * 1000;
  do { if (await check()) return; await sleep(250); } while (Date.now() < until);
  throw new Error(message);
}
function releaseRoot(config, record) {
  const root = record?.releaseDir ?? config.legacyRoot;
  if (!root || !path.isAbsolute(root) || !(within(config.releasesDir, root) && root !== config.releasesDir || root === config.legacyRoot)) throw new Error("Deployment record has no trusted release directory");
  return root;
}
async function verifyProcess(config, record, allowMissingLock = false) {
  const owner = await lockPid(config);
  if (!record || !alive(record.pid) || record.port !== config.port || !(owner === record.pid || allowMissingLock && owner === null)) throw new Error("Live PID does not own the configured profile lock; refusing to signal it");
  const root = releaseRoot(config, record);
  const launcher = record.launcher ?? path.join(root, "scripts/deploy-server.mjs");
  const expectedCwd = record.cwd ?? path.join(root, "packages/server");
  if (!within(root, expectedCwd) || !path.isAbsolute(launcher)) throw new Error("Untrusted server launch metadata");
  const actual = await command("ps", ["-p", String(record.pid), "-o", "command="]);
  const cwdInfo = await command("lsof", ["-a", "-p", String(record.pid), "-d", "cwd", "-Fn"]);
  const actualCwd = cwdInfo.split("\n").find((line) => line.startsWith("n"))?.slice(1);
  if (actualCwd !== expectedCwd || !actual.includes(launcher) || record.command && actual !== record.command) throw new Error("Live process command/cwd changed; refusing to signal it");
  if (root !== config.legacyRoot && launcher !== path.join(root, "scripts/deploy-server.mjs")) throw new Error("Untrusted release launcher");
  return { ...record, releaseDir: root, launcher, cwd: expectedCwd, command: actual };
}
async function stop(config, record) {
  await verifyProcess(config, record);
  process.kill(record.pid, "SIGTERM");
  await waitFor(async () => !alive(record.pid) && await portFree(config.port) && await lockPid(config) === null, 30,
    "Graceful shutdown did not complete within 30 seconds; no forced kill performed");
}
async function stopSpawned(config, record) {
  if (spawnedServers.get(record.pid) !== record.spawnToken) throw new Error("Failed server is not an attested child of this deployment");
  await verifyProcess(config, record, true);
  let listeners = "";
  try { listeners = (await execute("lsof", ["-nP", `-iTCP:${config.port}`, "-sTCP:LISTEN", "-Fp"], { timeout: 5000 })).stdout; }
  catch (error) { if (error.code !== 1) throw new Error("Could not verify the failed server's port ownership"); }
  if (listeners.split("\n").some((line) => line.startsWith("p") && Number(line.slice(1)) !== record.pid)) throw new Error("A foreign process owns the server port; refusing rollback signals");
  process.kill(record.pid, "SIGTERM");
  await waitFor(async () => !alive(record.pid) && await portFree(config.port) && await lockPid(config) === null, 30,
    "Failed server did not finish graceful shutdown; no forced kill performed");
}
async function removeCrashedChildLock(config, record) {
  if (spawnedServers.get(record.pid) !== record.spawnToken || alive(record.pid)) throw new Error("Cannot reclaim an unattested or live server's profile lock");
  const owner = await lockPid(config);
  if (owner === null) return;
  if (owner !== record.pid || !await portFree(config.port) || alive(record.pid)) throw new Error("A foreign process owns the profile lock or port; refusing recovery");
  if (await lockPid(config) !== record.pid) throw new Error("Profile lock owner changed during recovery");
  await fs.unlink(`${config.stashFile}.lock`);
}
async function captureEnvironment(config, current) {
  const file = config.environmentFile ?? path.join(config.stateDir, "server-environment.json");
  if (await exists(file)) {
    const stat = await fs.stat(file);
    if (stat.mode & 0o077) throw new Error("Server environment file must have mode 0600");
    const values = await readJson(file);
    if (!values || Array.isArray(values) || Object.values(values).some((value) => typeof value !== "string")) throw new Error("Server environment must be a JSON map of strings");
    const root = current ? releaseRoot(config, current) : null;
    if (!root) return values;
    const source = await fs.readFile(path.join(root, "packages/server/src/config.ts"), "utf8");
    const keys = new Set([...source.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
    return Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
  }
  const values = {};
  if (current && alive(current.pid)) {
    await verifyProcess(config, current);
    const source = await fs.readFile(path.join(releaseRoot(config, current), "packages/server/src/config.ts"), "utf8");
    const keys = new Set([...source.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
    // ps environment is kept in memory; never put its output in a log or diagnostic.
    const environment = await command("ps", ["eww", "-p", String(current.pid), "-o", "command="]);
    const assignments = [...environment.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g)];
    for (let i = 0; i < assignments.length; i++) {
      const match = assignments[i];
      if (keys.has(match[1])) values[match[1]] = environment.slice(match.index + match[0].length, assignments[i + 1]?.index ?? environment.length).trimEnd();
    }
  }
  await writeJson(file, values);
  return values;
}
async function start(config, record, environment) {
  if (!await portFree(config.port) || await lockPid(config) !== null) throw new Error("Server port or profile lock is occupied; refusing to start");
  const root = releaseRoot(config, record);
  const launcher = record.launcher ?? path.join(root, "scripts/deploy-server.mjs");
  const cwd = record.cwd ?? path.join(root, "packages/server");
  const log = path.join(config.stateDir, "live-server.log");
  const output = openSync(log, "a", 0o600);
  let child;
  try {
    const inherited = Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "LOGNAME"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    child = spawn(config.nodeBinary, ["--import", "tsx", launcher], { cwd, env: productionEnvironment(inherited, environment, config, root),
      detached: true, stdio: ["ignore", output, output] });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  } finally { closeSync(output); }
  child.unref();
  const spawnToken = crypto.randomUUID();
  spawnedServers.set(child.pid, spawnToken);
  const { command: previousCommand, ...launchRecord } = record;
  const result = { ...launchRecord, releaseDir: root, pid: child.pid, port: config.port, launcher, cwd, log, spawnToken };
  if (process.platform === "darwin" && await exists("/usr/bin/caffeinate")) {
    const awake = spawn("/usr/bin/caffeinate", ["-is", "-w", String(child.pid)], { detached: true, stdio: "ignore" });
    awake.on("error", () => {});
    awake.unref();
  }
  // Persist intent before readiness: another invocation can diagnose an interrupted cutover.
  await writeJson(path.join(config.stateDir, "deploy-pending.json"), result);
  await waitFor(async () => {
    if (!alive(child.pid)) throw new Error("New server exited before its local health/profile-lock check");
    return await lockPid(config) === child.pid && await localHealth(config);
  }, (config.readyTimeoutMs ?? 30_000) / 1000, "New server failed its local health/profile-lock check");
  result.command = await command("ps", ["-p", String(child.pid), "-o", "command="]);
  return result;
}
async function runCheck(binary, args, cwd, log, timeoutMs) {
  const output = openSync(log, "a", 0o600);
  try {
    await new Promise((resolve, reject) => {
      const env = Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "LOGNAME", "CI"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
      env.GIT_TERMINAL_PROMPT = "0";
      for (const key of ["VITE_SERVER_URL", "NODE_OPTIONS", "COLYSEUS_LATENCY", "NET_JITTER_MS", "NET_LOSS_PCT", "NET_SEED", "ALLOW_NETSIM_WHEN_HOSTING"]) delete env[key];
      const child = spawn(binary, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", output, output] });
      const signalCheck = (signal) => {
        try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
        catch (error) { if (error.code !== "ESRCH") reject(error); }
      };
      let timedOut = false;
      let forceStop;
      const deadline = setTimeout(() => {
        timedOut = true;
        signalCheck("SIGTERM");
        // Only the isolated preflight process group is force-ended. Live server
        // shutdown above always waits for its profile flush and never escalates.
        forceStop = setTimeout(() => signalCheck("SIGKILL"), 5000);
      }, timeoutMs);
      child.once("error", () => reject(new Error(`Could not start ${path.basename(binary)}`)));
      child.once("close", (code) => {
        clearTimeout(deadline); clearTimeout(forceStop);
        if (code === 0 && !timedOut) resolve();
        else reject(new Error(`${path.basename(binary)} ${args.join(" ")} ${timedOut ? "timed out" : "failed"}; see ${log}`));
      });
    });
  } finally { closeSync(output); }
}
export async function prepareRelease(config, ref, report = () => {}) {
  if (!await exists(config.repositoryDir)) {
    await fs.mkdir(path.dirname(config.repositoryDir), { recursive: true, mode: 0o700 });
    await command("git", ["init", "--bare", config.repositoryDir]);
    await git(config, ["remote", "add", "origin", config.repository]);
  }
  if (await git(config, ["rev-parse", "--is-bare-repository"]) !== "true" || await git(config, ["remote", "get-url", "origin"]) !== config.repository) throw new Error("Deployment mirror does not match configuration");
  report("Fetching remote changes");
  await git(config, ["fetch", "--prune", "origin", `+refs/heads/${config.branch}:refs/remotes/origin/${config.branch}`]);
  let resolved = `refs/remotes/origin/${config.branch}`;
  if (ref && ref !== config.branch) {
    await git(config, ["fetch", "origin", ref]);
    resolved = "FETCH_HEAD";
  }
  const commit = await git(config, ["rev-parse", "--verify", `${resolved}^{commit}`]);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Remote did not resolve to a commit");
  return { commit, async build() {
    const releaseDir = path.join(config.releasesDir, `${Date.now()}-${commit.slice(0, 12)}-${crypto.randomBytes(3).toString("hex")}`);
    await fs.mkdir(releaseDir, { recursive: true, mode: 0o700 });
    const archive = path.join(releaseDir, ".source.tar");
    await git(config, ["archive", "--format=tar", `--output=${archive}`, commit]);
    await command("tar", ["-xf", archive, "-C", releaseDir]);
    await fs.rm(archive);
    await writeJson(path.join(releaseDir, ".rougehalla-release.json"), { owner: "rougehalla-deployer-v1", commit, createdAt: new Date().toISOString() });
    const log = path.join(releaseDir, "deploy-checks.log");
    for (const args of [["ci"], ["run", "typecheck"], ["run", "build"]]) {
      report(`Checking ${args.join(" ")}`);
      await runCheck("npm", args, releaseDir, log, config.checkTimeoutMs);
    }
    if (!await exists(path.join(releaseDir, "scripts/deploy-smoke.mjs")) || !await exists(path.join(releaseDir, "scripts/deploy-server.mjs"))) throw new Error("Release lacks the deployment launcher/smoke check");
    report("Checking production HTTP and two WebSocket clients");
    await runCheck(config.nodeBinary, ["--import", "tsx", "scripts/deploy-smoke.mjs"], releaseDir, log, config.checkTimeoutMs);
    const markerFile = path.join(releaseDir, ".rougehalla-release.json");
    const marker = await readJson(markerFile);
    await writeJson(markerFile, { ...marker, assets: await fs.readdir(path.join(dist(releaseDir), "assets")) });
    await writeJson(path.join(dist(releaseDir), "build-info.json"), { commit, builtAt: new Date().toISOString() });
    return { commit, releaseDir, port: config.port };
  } };
}
async function preserveAssets(previous, next) {
  const source = path.join(dist(previous), "assets");
  if (!await exists(source)) return;
  const marker = await readJson(path.join(previous, ".rougehalla-release.json"));
  const names = marker?.owner === "rougehalla-deployer-v1" && Array.isArray(marker.assets) ? marker.assets : await fs.readdir(source);
  for (const name of names) {
    if (typeof name !== "string" || path.basename(name) !== name) throw new Error("Unsafe asset name in release marker");
    await fs.cp(path.join(source, name), path.join(dist(next), "assets", name), { recursive: true, force: false, errorOnExist: false });
  }
}
async function assertProfilesPreserved(before, config) {
  if (!before) return;
  const after = await readJson(config.stashFile);
  for (const [name, profile] of Object.entries(before.profiles ?? {})) {
    if (!after?.profiles?.[name] || profile.token !== after.profiles[name].token) throw new Error("Profile identity changed during cutover");
  }
}
export async function switchRelease(config, current, target, report = () => {}) {
  const environment = await captureEnvironment(config, current);
  let previous = current ? await verifyProcess(config, current) : null;
  if (!previous && (!await portFree(config.port) || await lockPid(config) !== null)) throw new Error("No verified deployment owns the occupied port/profile lock");
  if (previous) await preserveAssets(previous.releaseDir, target.releaseDir);
  let stopped = false;
  let launched;
  try {
    if (previous) { report("Gracefully stopping the current server and flushing player progress"); await stop(config, previous); }
    stopped = true;
    const backup = path.join(config.stateDir, "deployments", `${Date.now()}-${target.commit.slice(0, 12)}`);
    await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    const profiles = await readJson(config.stashFile);
    if (profiles) { await fs.copyFile(config.stashFile, path.join(backup, "profiles-after-shutdown.json")); await fs.chmod(path.join(backup, "profiles-after-shutdown.json"), 0o600); }
    report("Starting the checked release");
    launched = await start(config, target, environment);
    await assertProfilesPreserved(profiles, config);
    await waitFor(() => publicCommit(config, target.commit), (config.verifyTimeoutMs ?? 30_000) / 1000, "Public build-info does not match the new commit");
    const { previous: ignored, ...prior } = previous ?? {};
    const result = { ...launched, deployedAt: new Date().toISOString(), health: "ok", backup, previous: previous ? prior : null };
    await writeJson(recordFile(config), result);
    await fs.rm(path.join(config.stateDir, "deploy-pending.json"), { force: true });
    return result;
  } catch (error) {
    // A start that failed readiness still recorded its PID. Never signal any other occupant.
    if (stopped) {
      const pending = launched ?? await readJson(path.join(config.stateDir, "deploy-pending.json"));
      if (pending && alive(pending.pid)) await stopSpawned(config, pending);
      else if (pending) await removeCrashedChildLock(config, pending);
      if (previous) {
        report("Verification failed; restoring the previous server with current player progress");
        const restored = await start(config, previous, environment);
        await waitFor(() => publicCommit(config, restored.commit), (config.verifyTimeoutMs ?? 30_000) / 1000, "Previous server restarted but public verification failed");
        await writeJson(recordFile(config), { ...restored, health: "ok", restoredAt: new Date().toISOString() });
        await fs.rm(path.join(config.stateDir, "deploy-pending.json"), { force: true });
      }
    }
    throw error;
  }
}
async function prune(config, current) {
  const protectedRoots = new Set([current.releaseDir, current.previous?.releaseDir]);
  const entries = [];
  for (const entry of await fs.readdir(config.releasesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(config.releasesDir, entry.name);
    const marker = await readJson(path.join(root, ".rougehalla-release.json"));
    if (marker?.owner === "rougehalla-deployer-v1" && /^[a-f0-9]{40,64}$/.test(marker.commit)) entries.push({ root, created: marker.createdAt });
  }
  entries.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  let kept = protectedRoots.size;
  for (const entry of entries) {
    if (protectedRoots.has(entry.root)) continue;
    if (kept++ < config.keepReleases) continue;
    await fs.rm(entry.root, { recursive: true });
  }
}
export async function status(config) {
  const deployment = await readJson(recordFile(config));
  const local = await localHealth(config);
  const owner = await lockPid(config);
  let healthy = !!deployment && local && alive(deployment.pid) && owner === deployment.pid;
  if (healthy) {
    try { await verifyProcess(config, deployment); } catch { healthy = false; }
  }
  const publicHealthy = healthy && await publicCommit(config, deployment.commit);
  return { status: healthy && publicHealthy ? "healthy" : "unhealthy", deployment, localHealthy: healthy,
    publicHealthy: !!publicHealthy, failed: await readJson(failureFile(config)), pending: await readJson(path.join(config.stateDir, "deploy-pending.json")) };
}
export async function run(options, operations = {}) {
  if (options.help) return { help: HELP };
  const config = validateConfig(await readJson(options.config));
  const stat = await fs.stat(options.config);
  if (stat.mode & 0o077) throw new Error("Deployment config must have mode 0600");
  if (options.command === "status") return status(config);
  assertLocalHostingUrl(config.publicUrl);
  const unlock = await acquireLock(config.stateDir);
  const report = (message) => process.stderr.write(`[deploy] ${message}\n`);
  let commit;
  const prepare = operations.prepareRelease ?? prepareRelease;
  const switchTo = operations.switchRelease ?? switchRelease;
  const checkStatus = operations.status ?? status;
  const cleanup = operations.prune ?? prune;
  try {
    diagnosticsFile = path.join(config.stateDir, "deploy-diagnostics.log");
    await fs.appendFile(diagnosticsFile, "", { mode: 0o600 });
    await fs.chmod(diagnosticsFile, 0o600);
    if (await readJson(path.join(config.stateDir, "deploy-pending.json"))) throw new Error("An interrupted cutover needs inspection (deploy-pending.json); refusing another deployment");
    const current = await readJson(recordFile(config));
    if (options.command === "rollback") {
      if (!current?.previous) throw new Error("No previous release is recorded");
      const target = { ...current.previous };
      releaseRoot(config, target);
      const result = await switchTo(config, current, target, report);
      await writeJson(failureFile(config), { commit: current.commit, failedAt: new Date().toISOString(), reason: "operator-rollback", error: "Operator rolled back this commit; use --retry to deploy it again" });
      return { status: "rolled-back", deployment: result };
    }
    const prepared = await prepare(config, options.ref, report);
    commit = prepared.commit;
    if (current?.commit === commit && (await checkStatus(config)).status === "healthy") return { status: "unchanged", deployment: current };
    if ((await readJson(failureFile(config)))?.commit === commit && !options.retry) return { status: "failed-previously", commit, message: "Use --retry after fixing the recorded failure" };
    if (!options.ref && current?.commit && current.commit !== commit && !operations.prepareRelease) {
      try { await git(config, ["merge-base", "--is-ancestor", current.commit, commit]); }
      catch { throw new Error("Remote branch no longer descends from the deployed commit; use an explicit --ref after review"); }
    }
    const target = await prepared.build();
    const result = await switchTo(config, current, target, report);
    await fs.rm(failureFile(config), { force: true });
    await cleanup(config, result);
    return { status: "deployed", deployment: result };
  } catch (error) {
    if (commit) await writeJson(failureFile(config), { commit, failedAt: new Date().toISOString(), error: error.message });
    throw error;
  } finally { await unlock(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const result = await run(options);
    console.log(result.help ?? (options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)));
    if (["unhealthy", "failed-previously"].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.error(options?.json ? JSON.stringify({ status: "error", error: error.message }) : `[deploy] ${error.message}`);
    process.exitCode = 1;
  }
}

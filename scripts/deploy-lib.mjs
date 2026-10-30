import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const DEFAULT_CONFIG = path.join(os.homedir(), ".rougehalla/deploy-config.json");
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function safeRef(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value)
    && !value.includes("..") && !value.includes("//") && !value.endsWith("/")
    && !value.endsWith(".") && !value.split("/").some((part) => part.endsWith(".lock"));
}
export function parseArgs(argv) {
  const options = { command: "deploy", config: DEFAULT_CONFIG, json: false, retry: false };
  let command = false;
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (["deploy", "status", "rollback"].includes(value) && !command) { options.command = value; command = true; }
    else if (value === "--json") options.json = true;
    else if (value === "--retry") options.retry = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else if (value === "--config" || value === "--ref") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) throw new Error(`${value} requires a value`);
      options[value.slice(2)] = next;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (options.ref && !safeRef(options.ref)) throw new Error("Invalid --ref");
  if (options.command !== "deploy" && (options.ref || options.retry)) throw new Error("--ref and --retry apply only to deploy");
  options.config = path.resolve(options.config);
  return options;
}
export function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Configuration must be an object");
  const stateDir = raw.stateDir ?? path.join(os.homedir(), ".rougehalla");
  const config = { branch: "main", port: 2600, publicUrl: `http://127.0.0.1:${raw.port ?? 2600}`, keepReleases: 4,
    stateDir, stashFile: path.join(stateDir, "playtest-profiles.json"),
    repositoryDir: path.join(stateDir, "deploy-repo.git"), releasesDir: path.join(stateDir, "releases"),
    nodeBinary: process.execPath, ...raw };
  if (typeof config.repository !== "string" || /[\s\x00-\x1f]/.test(config.repository)
      || !/^(https:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(config.repository)) throw new Error("Invalid repository");
  if (!safeRef(config.branch)) throw new Error("Invalid branch");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Invalid port");
  if (!Number.isInteger(config.keepReleases) || config.keepReleases < 3 || config.keepReleases > 5) throw new Error("keepReleases must be 3–5");
  config.checkTimeoutMs ??= 300_000;
  if (!Number.isInteger(config.checkTimeoutMs) || config.checkTimeoutMs < 1000 || config.checkTimeoutMs > 1_800_000) throw new Error("checkTimeoutMs must be 1000–1800000");
  for (const key of ["readyTimeoutMs", "verifyTimeoutMs"]) {
    config[key] ??= 30_000;
    if (!Number.isInteger(config[key]) || config[key] < 250 || config[key] > 120_000) throw new Error(`${key} must be 250–120000`);
  }
  for (const key of ["stateDir", "stashFile", "repositoryDir", "releasesDir", "nodeBinary", "legacyRoot", "environmentFile"]) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !path.isAbsolute(config[key]) || /[\x00-\x1f]/.test(config[key]))) throw new Error(`${key} must be an absolute path`);
  }
  for (const key of ["repositoryDir", "releasesDir"]) {
    if (path.resolve(config[key]) === path.parse(config[key]).root || path.resolve(config[key]) === path.resolve(config.stateDir)) throw new Error(`Unsafe ${key}`);
  }
  const url = new URL(config.publicUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("publicUrl must be an HTTP(S) origin");
  config.publicUrl = url.origin;
  return config;
}
export function assertLocalHostingUrl(value) {
  const hostname = new URL(value).hostname.replace(/\.$/, "");
  if (["play.roguehalla.com", "rougehalla.mckinnonnevin.workers.dev"].includes(hostname)) {
    throw new Error(`${hostname} is hosted by Cloudflare. Use npm run deploy for the public game; choose a different hostname for a local playtest.`);
  }
}
export function productionEnvironment(base, overrides, config, releaseDir) {
  const env = { ...base, ...overrides, NODE_ENV: "production", CLIENT_DIR: path.join(releaseDir, "packages/client/dist"),
    STASH_FILE: config.stashFile, RAID_PORT: String(config.port) };
  for (const key of ["COLYSEUS_LATENCY", "NET_JITTER_MS", "NET_LOSS_PCT", "NET_SEED", "ALLOW_NETSIM_WHEN_HOSTING", "RAID_EXIT_ON_STDIN_END", "NODE_OPTIONS"]) delete env[key];
  return env;
}
export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${file}`); throw error; }
}
export async function writeJson(file, data) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.rename(temporary, file);
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
export async function acquireLock(stateDir) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const directory = path.join(stateDir, "deploy.lock");
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = await readJson(path.join(directory, "owner.json"));
      if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 1) throw new Error("Deployment lock has no valid owner; inspect it before removing it");
      if (alive(owner.pid)) throw new Error(`Another deployment is running (PID ${owner.pid})`);
      // Serialize stale-owner reclamation inside the existing directory. Recheck
      // after claiming it: this path could now refer to a newly acquired lock.
      const reclamation = path.join(directory, "reaping.json");
      try { await fs.writeFile(reclamation, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 }); }
      catch (claimError) {
        if (claimError.code === "ENOENT") continue;
        if (claimError.code === "EEXIST") throw new Error("Deployment lock is being reclaimed; retry after inspecting its owner");
        throw claimError;
      }
      const confirmed = await readJson(path.join(directory, "owner.json"));
      if (!confirmed || confirmed.pid !== owner.pid || confirmed.token !== owner.token || alive(confirmed.pid)) {
        await fs.rm(reclamation, { force: true });
        throw new Error("Deployment lock owner changed; retry");
      }
      const stale = `${directory}.stale-${token}`;
      try { await fs.rename(directory, stale); } catch (renameError) { if (renameError.code === "ENOENT") continue; throw renameError; }
      await fs.rm(stale, { recursive: true });
      continue;
    }
    await writeJson(path.join(directory, "owner.json"), { pid: process.pid, token, startedAt: new Date().toISOString() });
    return async () => {
      if ((await readJson(path.join(directory, "owner.json")))?.token === token) await fs.rm(directory, { recursive: true });
    };
  }
  throw new Error("Could not acquire deployment lock");
}

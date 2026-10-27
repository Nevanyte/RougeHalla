#!/usr/bin/env node
// One command to host a playtest from this machine: builds the client, runs the production server (one process, which
// also serves the client and the websocket on the same port), and opens a Cloudflare quick tunnel so friends can join
// from anywhere. Plain Node, no dependencies.
//
//   npm run playtest -- [--no-tunnel] [--port 2567] [--no-build]
//
// The `--` is npm's: without it npm keeps the flags for itself. Environment: PLAYTEST_PASSCODE (ask players for a passcode),
// STASH_FILE (the profile file; default ~/.rougehalla/playtest-profiles.json), RAID_PORT (the default port), and every
// other server setting in packages/server/src/config.ts (MAX_ARENA_ROOMS, ORDER_PER_SECOND, ...).
//
// A quick tunnel's address is new at every start and a browser keeps a callsign's token per address, so returning players
// need a sign-in link: `npm run playtest:signin -- <callsign>` (scripts/playtest-signin.mjs). While the tunnel is up this
// script records its address next to the profile file (playtestLink.mjs) for that command, and removes it on exit.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linkFilePath, removeLinkFile, stashFileFrom, writeLinkFile } from "./playtestLink.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "packages", "client", "dist");
const DEFAULT_PORT = 2567;
const HEALTH_TIMEOUT_MS = 60_000;
const TUNNEL_URL_TIMEOUT_MS = 40_000;
/** After cloudflared names the tunnel, how long to wait for its connection to register before sharing the address anyway. */
const TUNNEL_REGISTER_GRACE_MS = 15_000;
/** The check of the public link from this Mac: a first look this long after the link is up, then one every so often, for this long. */
const TUNNEL_VERIFY_FIRST_MS = 6_000;
const TUNNEL_VERIFY_EVERY_MS = 12_000;
const TUNNEL_VERIFY_TIMEOUT_MS = 100_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A server that does not finish its graceful shutdown (it flushes the profiles last) in this long is killed. */
const STOP_TIMEOUT_MS = 30_000;

const USAGE = `usage: npm run playtest -- [--no-tunnel] [--port <n>] [--no-build]
  --no-tunnel   serve on this machine and the local network only; no Cloudflare tunnel
  --port <n>    port to serve on (default $RAID_PORT, else ${DEFAULT_PORT})
  --no-build    skip the client build and serve the one in packages/client/dist
  -h, --help    this text
The flags need npm's own "--" in front of them. Set PLAYTEST_PASSCODE to ask players for a passcode.`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const log = (msg = "") => console.log(msg);
const note = (msg) => console.log(`[playtest] ${msg}`);

function fail(msg, code = 1) {
  console.error(`[playtest] ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const args = { tunnel: true, build: true, port: Number(process.env.RAID_PORT) || DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    if (flag === "--no-tunnel") args.tunnel = false;
    else if (flag === "--no-build") args.build = false;
    else if (flag === "--port") {
      const v = inline ?? argv[++i];
      if (!/^\d+$/.test(v ?? "") || Number(v) < 1 || Number(v) > 65535) fail(`--port needs a number from 1 to 65535\n${USAGE}`, 2);
      args.port = Number(v);
    } else if (flag === "-h" || flag === "--help") {
      log(USAGE);
      process.exit(0);
    } else fail(`unexpected argument: ${arg}\n${USAGE}`, 2);
  }
  return args;
}

// ---------------------------------------------------------------- shutdown
/** Everything this script started; `stop` ends them in order. */
const children = { server: null, tunnel: null, caffeinate: null };
let stopping = false;
let stopSignal = "SIGINT";
let building = null;

const alive = (child) => child && child.exitCode === null && child.signalCode === null;

/**
 * The first Ctrl+C (or SIGTERM) stops everything, once: ONE signal to the server (a second one would end it in the middle
 * of its shutdown, which is where the last second of profile writes happens). npm forwards the signal it gets as well as
 * the terminal sending it to the whole foreground group, so the same Ctrl+C arrives here twice; every later one is
 * only noted.
 */
function onSignal(signal) {
  if (stopping) {
    note("already stopping: waiting for the server to save the profiles");
    return;
  }
  stopping = true;
  stopSignal = signal;
  log();
  note("stopping (the server saves the profiles first; this can take a few seconds)...");
  if (building && alive(building)) building.kill("SIGTERM");
  if (alive(children.tunnel)) children.tunnel.kill("SIGTERM");
  if (alive(children.caffeinate)) children.caffeinate.kill("SIGTERM");
  if (alive(children.server)) {
    children.server.kill(signal === "SIGTERM" ? "SIGTERM" : "SIGINT");
    setTimeout(() => {
      if (alive(children.server)) {
        note("the server did not stop in time: killing it");
        children.server.kill("SIGKILL");
      }
    }, STOP_TIMEOUT_MS).unref();
  } else if (!building) {
    process.exit(0);
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => onSignal(signal));

// ---------------------------------------------------------------- steps
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

function run(cmd, args, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, options);
    building = child;
    child.on("error", (err) => { note(`could not run ${cmd}: ${err.message}`); resolve(1); });
    child.on("exit", (code) => { building = null; resolve(code ?? 1); });
  });
}

async function buildClient() {
  note("building the client (VITE_SERVER_URL unset: it talks to the page's own origin)...");
  const env = { ...process.env };
  delete env.VITE_SERVER_URL;
  const code = await run("npm", ["run", "build"], { cwd: root, env, stdio: "inherit" });
  if (stopping) process.exit(0);
  if (code !== 0) fail("the client build failed, see above");
}

function startServer(port, stashFile) {
  const env = { ...process.env, NODE_ENV: "production", CLIENT_DIR: clientDir, RAID_PORT: String(port), STASH_FILE: stashFile };
  // One process: tsx's CLI wrapper would relay a signal to a child as well, so Ctrl+C would reach the server twice. Its own
  // process group (detached) keeps the terminal's Ctrl+C from reaching it directly: it gets the single signal we forward.
  // Its stdin is a pipe whose write end only this script holds. However this script dies (a crash, SIGKILL), the pipe
  // closes, and the server, told by RAID_EXIT_ON_STDIN_END, shuts down gracefully (profiles flushed, lock freed) instead
  // of staying behind on the port. Nothing is ever written to it, and it is never closed on purpose.
  const server = spawn(process.execPath, ["--import", "tsx", path.join("packages", "server", "src", "index.ts")], {
    cwd: root, env: { ...env, RAID_EXIT_ON_STDIN_END: "1" }, stdio: ["pipe", "inherit", "inherit"], detached: true,
  });
  server.stdin.on("error", () => {}); // a server that is already gone: nothing to tell it
  children.server = server;
  return server;
}

async function waitForHealth(port, server) {
  const end = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < end) {
    if (!alive(server)) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

function haveCloudflared() {
  return spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).error === undefined;
}

/**
 * Starts cloudflared and resolves with the https://....trycloudflare.com URL it prints, or null (with the reason printed).
 * It prints the address as soon as it is allotted, well before the connection that serves it is up (and before the name
 * is in DNS), so this waits for "Registered tunnel connection" (or a few seconds' grace) before handing the address out.
 */
function startTunnel(port) {
  return new Promise((resolve) => {
    const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    children.tunnel = tunnel;
    const tail = [];
    let url = null;
    let done = false;
    let graceTimer = null;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve(value);
    };
    const onData = (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) { tail.push(line.trim()); if (tail.length > 30) tail.shift(); }
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line);
        if (m && !url) { url = m[0]; graceTimer = setTimeout(() => finish(url), TUNNEL_REGISTER_GRACE_MS); }
        if (url && /Registered tunnel connection/i.test(line)) finish(url);
      }
    };
    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);
    timer = setTimeout(() => {
      if (!url) { note("cloudflared gave no tunnel address in time. Its last output:"); for (const l of tail) log(`  ${dim(l)}`); finish(null); }
    }, TUNNEL_URL_TIMEOUT_MS);
    tunnel.on("error", (err) => { note(`could not start cloudflared: ${err.message}`); finish(null); });
    tunnel.on("exit", (code) => {
      if (stopping) { finish(null); return; }
      if (!done) { note(`cloudflared stopped (exit ${code}) before the tunnel was up. Its last output:`); for (const l of tail) log(`  ${dim(l)}`); finish(null); }
      else {
        log();
        note(bold("THE TUNNEL STOPPED. The public link no longer works."));
        note("Stop this (Ctrl+C) and run it again for a new link: a quick tunnel's address changes every start.");
      }
    });
  });
}

/**
 * Checks the public link from this Mac. A brand-new name is not in DNS for a few seconds, and a resolver that looked it up
 * too early keeps answering "no such name" for the SOA's 60 s: so the first look waits, and the looks that follow are spread
 * out (polling every second only keeps the answer wrong). Returns null when it answered, else the last problem.
 */
async function verifyTunnel(url) {
  const end = Date.now() + TUNNEL_VERIFY_TIMEOUT_MS;
  let last = "no answer";
  await sleep(TUNNEL_VERIFY_FIRST_MS);
  while (!stopping) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return null;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = `${err?.cause?.code ?? err?.message ?? err}`;
    }
    if (Date.now() + TUNNEL_VERIFY_EVERY_MS > end) break;
    await sleep(TUNNEL_VERIFY_EVERY_MS);
  }
  return last;
}

function startCaffeinate() {
  if (process.platform !== "darwin") return;
  // -i: no idle sleep, -s: no system sleep on power; -w: ends on its own when this script does, however it ends.
  const c = spawn("caffeinate", ["-is", "-w", String(process.pid)], { stdio: "ignore" });
  c.on("error", () => note("could not run caffeinate: keep this Mac awake yourself (System Settings, or `caffeinate -dis`)"));
  children.caffeinate = c;
}

function banner({ port, stashFile, shareUrl, passcode }) {
  const bar = "=".repeat(64);
  const lan = lanAddresses().slice(0, 3).map((ip) => `http://${ip}:${port}`);
  log();
  log(bar);
  log(bold("  RougeHalla playtest is running"));
  log();
  if (shareUrl) {
    log(bold("  SHARE THIS LINK WITH YOUR FRIENDS:"));
    log(`    ${bold(shareUrl)}`);
  } else {
    log(bold("  No public link: friends outside this network cannot join."));
  }
  log();
  log(`  This Mac:   http://localhost:${port}${passcode ? `/?code=${encodeURIComponent(passcode)}` : ""}`);
  for (const url of lan) log(`  Same Wi-Fi: ${url}${passcode ? `/?code=${encodeURIComponent(passcode)}` : ""}`);
  log(`  Passcode:   ${passcode ? "on (it is in the links above)" : "off"}`);
  if (!passcode) {
    log("              Anyone with the link can claim new callsigns (30 an hour). To ask for a");
    log("              passcode:  PLAYTEST_PASSCODE=<a word> npm run playtest");
  }
  log(`  Profiles:   ${stashFile}`);
  log();
  if (shareUrl) {
    log(bold("  RETURNING PLAYERS need their sign-in link."));
    log("  This address is new, and a browser keeps a callsign only for the address it was");
    log("  made on. Print a player's link and send it to that player alone:");
    log("      npm run playtest:signin -- <callsign>        (--all: every callsign)");
    log("  New players just pick a callsign. A stable address that survives restarts needs");
    log("  a named Cloudflare tunnel on your own domain (README, Hosting a playtest).");
    log();
  }
  log("  Ctrl+C once to stop. It saves the profiles first.");
  log(bar);
  log();
}

// ---------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const passcode = process.env.PLAYTEST_PASSCODE || "";
  if (passcode && !/^[\x21-\x7e]+$/.test(passcode)) {
    fail("PLAYTEST_PASSCODE may use only visible ASCII characters, no spaces (it travels in a link and an HTTP header)");
  }
  if (!(await portIsFree(args.port))) {
    fail(`port ${args.port} is already in use (another playtest, or npm run dev?). Stop it, or pick another: npm run playtest -- --port ${args.port + 1}`);
  }
  const stashFile = stashFileFrom();
  fs.mkdirSync(path.dirname(stashFile), { recursive: true });

  if (args.build) await buildClient();
  else if (!fs.existsSync(path.join(clientDir, "index.html"))) fail("--no-build, but there is no build in packages/client/dist: run npm run build first");
  if (stopping) return;

  note(`starting the server on :${args.port} (profiles: ${stashFile})...`);
  const server = startServer(args.port, stashFile);
  const exited = new Promise((resolve) => server.on("exit", (code, signal) => resolve({ code, signal })));
  server.on("error", (err) => fail(`could not start the server: ${err.message}`));
  startCaffeinate();

  // From here on the script lives as long as the server does, and ends with it.
  exited.then(({ code, signal }) => {
    if (alive(children.tunnel)) children.tunnel.kill("SIGTERM");
    if (alive(children.caffeinate)) children.caffeinate.kill("SIGTERM");
    if (stopping) {
      const clean = code === 0 && !signal;
      note(clean ? "stopped. Profiles saved." : `stopped, but the server ended abnormally (${signal ?? `exit ${code}`}): the last second of profile changes may be lost`);
      process.exit(clean ? 0 : 1);
    }
    fail(`the server stopped by itself (${signal ?? `exit ${code}`}), see its messages above`, code || 1);
  });

  if (!(await waitForHealth(args.port, server))) {
    if (!stopping && alive(server)) { note("the server did not answer in time"); server.kill("SIGTERM"); }
    return; // the exit handler above ends the script
  }
  if (stopping) return;

  // The server holds the profile file's lock now, so a link file still here is from a launcher that died without cleaning up.
  fs.rmSync(linkFilePath(stashFile), { force: true });
  process.on("exit", () => removeLinkFile(stashFile));

  let shareUrl = null;
  if (args.tunnel) {
    if (!haveCloudflared()) {
      note("cloudflared is not installed, so there is no public link. Install it with:  brew install cloudflared");
      note("(other systems: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Serving locally meanwhile.");
    } else {
      note("opening a Cloudflare quick tunnel...");
      const url = await startTunnel(args.port);
      if (url && !stopping) {
        writeLinkFile(stashFile, { url, port: args.port, pid: process.pid, passcode: passcode || null });
        shareUrl = `${url}/${passcode ? `?code=${encodeURIComponent(passcode)}` : ""}`;
        banner({ port: args.port, stashFile, shareUrl, passcode });
        const problem = await verifyTunnel(url);
        if (problem === null) note("tunnel checked: the public link answers.");
        else if (!stopping) note(`this Mac could not reach the public link yet (${problem}). A new address can take a minute or two to resolve, and a name this Mac looked up too early can stay unresolved for a while on it; friends elsewhere may get through before it does. If it never works, stop and run again.`);
        return;
      }
    }
  }
  if (!stopping) banner({ port: args.port, stashFile, shareUrl, passcode });
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));

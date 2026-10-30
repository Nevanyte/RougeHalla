#!/usr/bin/env node
// One command to host a playtest from this machine: builds the client, runs the production server (one process, which
// also serves the client and the websocket on the same port), and opens a Cloudflare quick tunnel so friends can join
// from anywhere. Plain Node, no dependencies.
//
//   npm run playtest -- [--no-tunnel] [--port 2567] [--no-build] [--named <tunnel> --hostname <host>]
//
// The `--` is npm's: without it npm keeps the flags for itself. Environment: PLAYTEST_PASSCODE (ask players for a passcode),
// STASH_FILE (the profile file; default ~/.rougehalla/playtest-profiles.json), RAID_PORT (the default port), PLAYTEST_TUNNEL and
// PLAYTEST_HOSTNAME (the named tunnel, as --named and --hostname), and every other server setting in packages/server/src/config.ts
// (MAX_ARENA_ROOMS, ORDER_PER_SECOND, ...). The network simulator's variables (COLYSEUS_LATENCY, NET_JITTER_MS, NET_LOSS_PCT) are
// dropped: a public server must not slow its players.
//
// A quick tunnel's address is new at every start and a browser keeps a callsign's token per address, so returning players
// need a sign-in link: `npm run playtest:signin -- <callsign>` (scripts/playtest-signin.mjs). While the tunnel is up this
// script records its address next to the profile file (playtestLink.mjs) for that command, marks it dead if the tunnel stops
// and removes it on exit. A NAMED tunnel (the owner's own Cloudflare account and domain, set up once: README) has the same
// address every time, so browsers keep their callsigns and the links are only for a new device.
//
// The tunnel runs under scripts/tunnelGuard.mjs, which ends cloudflared when this script goes away however it goes (SIGKILL
// included); the guard's and cloudflared's pids are recorded next to the profile file (tunnelPids.mjs) and the next launch stops
// what a launcher that died left behind.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linkFilePath, markLinkDown, removeLinkFile, stashFileFrom, writeLinkFile } from "./playtestLink.mjs";
import { reapStaleTunnel, tunnelPidFilePath } from "./tunnelPids.mjs";
import { assertLocalHostingUrl } from "./deploy-lib.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, "..");
/** The built client the server serves (PLAYTEST_CLIENT_DIR is for the launcher's own tests). */
const clientDir = process.env.PLAYTEST_CLIENT_DIR ? path.resolve(process.env.PLAYTEST_CLIENT_DIR) : path.join(root, "packages", "client", "dist");
const guardScript = path.join(scriptsDir, "tunnelGuard.mjs");
const DEFAULT_PORT = 2567;
const HEALTH_TIMEOUT_MS = 60_000;
/** How long cloudflared gets to name (or, for a named tunnel, connect) its tunnel; PLAYTEST_TUNNEL_TIMEOUT_MS is for the launcher's own tests. */
const TUNNEL_URL_TIMEOUT_MS = Number(process.env.PLAYTEST_TUNNEL_TIMEOUT_MS) > 0 ? Number(process.env.PLAYTEST_TUNNEL_TIMEOUT_MS) : 40_000;
/** After cloudflared names the tunnel, how long to wait for its connection to register before sharing the address anyway. */
const TUNNEL_REGISTER_GRACE_MS = 15_000;
/** The check of the public link from this Mac: a first look this long after the link is up, then one every so often, for this long. */
const TUNNEL_VERIFY_FIRST_MS = 6_000;
const TUNNEL_VERIFY_EVERY_MS = 12_000;
const TUNNEL_VERIFY_TIMEOUT_MS = 100_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A server that does not finish its graceful shutdown (it flushes the profiles last) in this long is killed. */
const STOP_TIMEOUT_MS = 30_000;

const USAGE = `usage: npm run playtest -- [--no-tunnel] [--port <n>] [--no-build] [--named <tunnel> --hostname <host>] [--quick]
  --no-tunnel        serve on this machine and the local network only; no Cloudflare tunnel
  --port <n>         port to serve on (default $RAID_PORT, else ${DEFAULT_PORT})
  --no-build         skip the client build and serve the one in packages/client/dist
  --named <tunnel>   use your own named Cloudflare tunnel (a stable address) instead of a quick one;
                     also $PLAYTEST_TUNNEL. Set up once, see the README ("A stable link")
  --hostname <host>  the address that tunnel serves, e.g. playtest.example.com; also $PLAYTEST_HOSTNAME
  --quick            a quick tunnel (a new address at every start) even if those variables are set
  -h, --help         this text
Stable link, after the one-time setup:  npm run playtest -- --named roguehalla --hostname playtest.example.com
The flags need npm's own "--" in front of them. Set PLAYTEST_PASSCODE to ask players for a passcode.`;

/** What cloudflared accepts as a tunnel name (or UUID); it also becomes a command-line argument, so it can never start with "-". */
const TUNNEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** The variables that switch the network simulator on (packages/server/src/net/netSim.ts). */
const NETSIM_VARS = ["COLYSEUS_LATENCY", "NET_JITTER_MS", "NET_LOSS_PCT", "NET_SEED", "ALLOW_NETSIM_WHEN_HOSTING"];

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
/** A hostname as typed (maybe with https:// and a trailing slash), or null when it is not a plain DNS name. */
function cleanHostname(value) {
  const host = String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return HOSTNAME_RE.test(host) ? host : null;
}

function parseArgs(argv, env = process.env) {
  const args = { tunnel: true, build: true, port: Number(env.RAID_PORT) || DEFAULT_PORT, named: null, hostname: null };
  let quick = false;
  let namedFlag = null;
  let hostnameFlag = null;
  const value = (flag, inline, i) => {
    const v = inline ?? argv[i];
    if (v === undefined || v === "" || v.startsWith("--")) fail(`${flag} needs a value\n${USAGE}`, 2);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    if (flag === "--no-tunnel") args.tunnel = false;
    else if (flag === "--no-build") args.build = false;
    else if (flag === "--quick") quick = true;
    else if (flag === "--named") { namedFlag = value(flag, inline, i + 1); if (inline === undefined) i++; }
    else if (flag === "--hostname") { hostnameFlag = value(flag, inline, i + 1); if (inline === undefined) i++; }
    else if (flag === "--port") {
      const v = inline ?? argv[++i];
      if (!/^\d+$/.test(v ?? "") || Number(v) < 1 || Number(v) > 65535) fail(`--port needs a number from 1 to 65535\n${USAGE}`, 2);
      args.port = Number(v);
    } else if (flag === "-h" || flag === "--help") {
      log(USAGE);
      process.exit(0);
    } else fail(`unexpected argument: ${arg}\n${USAGE}`, 2);
  }

  // The named tunnel: the flags, else the environment. A flag for one is an error where the run has no tunnel or wants a quick one.
  if ((namedFlag || hostnameFlag) && quick) fail(`--quick is a quick tunnel: it cannot take --named or --hostname\n${USAGE}`, 2);
  if ((namedFlag || hostnameFlag) && !args.tunnel) fail(`--named and --hostname are for a tunnel: drop --no-tunnel\n${USAGE}`, 2);
  if (args.tunnel && !quick) {
    const named = namedFlag ?? (env.PLAYTEST_TUNNEL || null);
    const hostname = hostnameFlag ?? (env.PLAYTEST_HOSTNAME || null);
    if (named && !hostname) fail(`a named tunnel needs the address it serves: --hostname <host> (or $PLAYTEST_HOSTNAME), e.g. --hostname playtest.example.com\n${USAGE}`, 2);
    if (hostname && !named) fail(`--hostname (or $PLAYTEST_HOSTNAME) needs the tunnel's name: --named <tunnel> (or $PLAYTEST_TUNNEL). For a quick tunnel, add --quick.\n${USAGE}`, 2);
    if (named) {
      if (!TUNNEL_NAME_RE.test(named)) fail(`"${named}" is not a tunnel name: letters, digits, "." "_" "-", not starting with "-"\n${USAGE}`, 2);
      const host = cleanHostname(hostname);
      if (!host) fail(`"${hostname}" is not a hostname: give the plain address of the tunnel, like playtest.example.com\n${USAGE}`, 2);
      try { assertLocalHostingUrl(`https://${host}`); }
      catch (error) { fail(error.message, 2); }
      args.named = named;
      args.hostname = host;
    }
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
  // The network simulator would delay and drop every friend's connection, and a variable exported in this shell for a netcode
  // test is easy to forget (the server refuses it while hosting too, but a launcher that hosts should not even ask).
  for (const name of NETSIM_VARS) delete env[name];
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

/** Takes what a secret would look like out of a line of cloudflared's output before it is printed. */
function scrub(line) {
  return line
    .replace(/("?(?:TunnelSecret|AccountTag|TunnelID|Secret)"?\s*[:=]\s*)"?[^",\s}]+"?/gi, "$1<hidden>")
    .replace(/eyJ[A-Za-z0-9_\-+/=]{16,}/g, "<hidden>");
}

/** Whether cloudflared's output says the named tunnel's credentials (or the login behind them) are missing or the tunnel unknown. */
const CREDENTIALS_PROBLEM_RE = /credentials?|cert\.pem|origin ?cert|origincert|couldn.?t find|could not find|not found|no such tunnel|doesn.?t exist|unauthorized/i;

/** Resolves when the tunnel (its guard, so cloudflared too) has ended; set by startTunnel. */
let tunnelGone = new Promise(() => {});

/**
 * Starts cloudflared under the guard and resolves with the public address, or null (with the reason printed).
 * A quick tunnel prints its https://....trycloudflare.com address as soon as it is allotted, well before the connection that
 * serves it is up (and before the name is in DNS), so this waits for "Registered tunnel connection" (or a few seconds'
 * grace) before handing the address out. A named tunnel's address is the owner's hostname; it is handed out once a connection
 * has registered. `onGone` runs if the tunnel ends after the address was handed out, and only then: a tunnel that never
 * came up (it exited, or the wait ran out, before any address was handed out) shared no link, so nothing "stopped".
 */
function startTunnel({ port, named, hostname, stashFile, onGone }) {
  return new Promise((resolve) => {
    const origin = `http://127.0.0.1:${port}`;
    const tunnelArgs = named
      ? ["tunnel", "--no-autoupdate", "run", "--url", origin, named]
      : ["tunnel", "--no-autoupdate", "--url", origin];
    // The guard's stdin is a pipe only this script holds and never writes: when this script dies, however it dies, the guard
    // sees it close and stops cloudflared (tunnelGuard.mjs), so the old address never keeps pointing at the port.
    const tunnel = spawn(
      process.execPath,
      [guardScript, "--pidfile", tunnelPidFilePath(stashFile), "--owner", String(process.pid), "--", "cloudflared", ...tunnelArgs],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    tunnel.stdin.on("error", () => {});
    children.tunnel = tunnel;
    tunnelGone = new Promise((r) => tunnel.once("exit", r));
    const tail = [];
    let url = null;
    let done = false;
    let handedOut = false; // an address went to the caller, so a link may be out there
    let graceTimer = null;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      handedOut = value !== null;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve(value);
    };
    const printTail = () => { for (const l of tail) log(`  ${dim(scrub(l))}`); };
    const onData = (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) { tail.push(line.trim()); if (tail.length > 30) tail.shift(); }
        if (named) {
          if (!url && /Registered tunnel connection/i.test(line)) { url = `https://${hostname}`; finish(url); }
          continue;
        }
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line);
        if (m && !url && !/^https:\/\/api\./i.test(m[0])) { url = m[0]; graceTimer = setTimeout(() => finish(url), TUNNEL_REGISTER_GRACE_MS); }
        if (url && /Registered tunnel connection/i.test(line)) finish(url);
      }
    };
    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);
    timer = setTimeout(() => {
      if (url) return;
      note(named
        ? `cloudflared did not connect the tunnel "${named}" to Cloudflare in time, so no public link was opened. Its last output:`
        : "cloudflared gave no tunnel address in time, so no public link was opened. Its last output:");
      printTail();
      finish(null);
      if (alive(tunnel)) tunnel.kill("SIGTERM"); // a tunnel nobody was told about must not keep running
    }, TUNNEL_URL_TIMEOUT_MS);
    tunnel.on("error", (err) => { note(`could not start the tunnel: ${err.message}`); finish(null); });
    tunnel.on("exit", (code) => {
      if (stopping) { finish(null); return; }
      if (handedOut) {
        log();
        note(bold("THE TUNNEL STOPPED. The public link no longer works."));
        note(named
          ? `Stop this (Ctrl+C) and run it again: the address stays https://${hostname}/.`
          : "Stop this (Ctrl+C) and run it again for a new link: a quick tunnel's address changes every start.");
        onGone();
        return;
      }
      // No address was ever handed out, so no link was shared and nothing "stopped". Either this is the first we hear of the
      // failure (say why), or the wait ran out / the start failed and that handler has said so already (the timeout kills
      // the tunnel, which lands here).
      if (done) return;
      if (named && CREDENTIALS_PROBLEM_RE.test(tail.join("\n"))) {
        note(bold(`cloudflared could not run the tunnel "${named}": its credentials (or the login behind them) were not found, or the tunnel does not exist.`));
        note("Set it up once on this Mac (README, A stable link):");
        note(`  cloudflared tunnel login`);
        note(`  cloudflared tunnel create ${named}`);
        note(`  cloudflared tunnel route dns ${named} ${hostname}`);
        note("cloudflared said:");
      } else {
        note(`cloudflared stopped (exit ${code}) before the tunnel was up, so no public link was opened. Its last output:`);
      }
      printTail();
      finish(null);
    });
  });
}

/** What verifyTunnel returns when the tunnel ended while it was looking: the tunnel's own note has said so already. */
const TUNNEL_STOPPED = Symbol("tunnel stopped");

/**
 * Checks the public link from this Mac. A brand-new name is not in DNS for a few seconds, and a resolver that looked it up
 * too early keeps answering "no such name" for the SOA's 60 s: so the first look waits, and the looks that follow are spread
 * out (polling every second only keeps the answer wrong). Returns null when it answered, else the last problem, or
 * TUNNEL_STOPPED as soon as the tunnel is gone (there is nothing left to check).
 */
async function verifyTunnel(url) {
  const end = Date.now() + TUNNEL_VERIFY_TIMEOUT_MS;
  let last = "no answer";
  const wait = (ms) => Promise.race([sleep(ms), tunnelGone]);
  await wait(TUNNEL_VERIFY_FIRST_MS);
  while (!stopping) {
    if (!alive(children.tunnel)) return TUNNEL_STOPPED;
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return null;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = `${err?.cause?.code ?? err?.message ?? err}`;
    }
    if (Date.now() + TUNNEL_VERIFY_EVERY_MS > end) break;
    await wait(TUNNEL_VERIFY_EVERY_MS);
  }
  return alive(children.tunnel) ? last : TUNNEL_STOPPED;
}

function startCaffeinate() {
  if (process.platform !== "darwin") return;
  // -i: no idle sleep, -s: no system sleep on power; -w: ends on its own when this script does, however it ends.
  const c = spawn("caffeinate", ["-is", "-w", String(process.pid)], { stdio: "ignore" });
  c.on("error", () => note("could not run caffeinate: keep this Mac awake yourself (System Settings, or `caffeinate -dis`)"));
  children.caffeinate = c;
}

function banner({ port, stashFile, shareUrl, passcode, named }) {
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
  if (shareUrl && named) {
    log(bold(`  STABLE ADDRESS (your tunnel "${named}")`));
    log("  The address is the same at every start, so your friends' browsers keep their");
    log("  callsigns between sessions and nobody needs a sign-in link. One is only needed");
    log("  for a callsign on a new browser or device (or after clearing site data):");
    log("      npm run playtest:signin -- <callsign>        (--all: every callsign)");
    log();
  } else if (shareUrl) {
    log(bold("  RETURNING PLAYERS need their sign-in link."));
    log("  This address is new, and a browser keeps a callsign only for the address it was");
    log("  made on. Print a player's link and send it to that player alone:");
    log("      npm run playtest:signin -- <callsign>        (--all: every callsign)");
    log("  New players just pick a callsign. A stable address that survives restarts needs");
    log("  a named Cloudflare tunnel on your own domain (README, A stable link).");
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

  // A tunnel a launcher left behind when it died keeps its public address pointing at this port: whatever listens here now
  // would be on the internet. Stopped before anything else starts.
  const stale = await reapStaleTunnel(tunnelPidFilePath(stashFile));
  if (stale.length > 0) note(`stopped a cloudflared tunnel left behind by a playtest that died (pid ${stale.join(", ")}): its old public address no longer reaches this Mac`);

  const dropped = NETSIM_VARS.filter((name) => process.env[name] !== undefined && process.env[name] !== "");
  if (dropped.length > 0) {
    note(`ignoring ${dropped.map((n) => `${n}=${process.env[n]}`).join(", ")}: the network simulator would delay and drop every friend's connection. To test lag, run the server yourself (README, Hosting a playtest).`);
  }

  if (args.build) await buildClient();
  else if (!fs.existsSync(path.join(clientDir, "index.html"))) fail(`--no-build, but there is no build in ${clientDir}: run npm run build first`);
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
  process.on("exit", () => {
    removeLinkFile(stashFile);
    // Any way out of here (fail() included) takes the tunnel with it; the guard does the same if this never runs (SIGKILL).
    if (alive(children.tunnel)) children.tunnel.kill("SIGTERM");
  });

  let shareUrl = null;
  if (args.tunnel) {
    if (!haveCloudflared()) {
      note("cloudflared is not installed, so there is no public link. Install it with:  brew install cloudflared");
      note("(other systems: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Serving locally meanwhile.");
    } else {
      note(args.named ? `opening your Cloudflare tunnel "${args.named}" (${args.hostname})...` : "opening a Cloudflare quick tunnel...");
      const url = await startTunnel({
        port: args.port, named: args.named, hostname: args.hostname, stashFile,
        // The launcher goes on, but its address is dead: `playtest:signin` must not print links to it.
        onGone: () => markLinkDown(stashFile),
      });
      if (url && !stopping) {
        writeLinkFile(stashFile, { url, port: args.port, pid: process.pid, passcode: passcode || null, named: !!args.named, tunnelName: args.named });
        shareUrl = `${url}/${passcode ? `?code=${encodeURIComponent(passcode)}` : ""}`;
        banner({ port: args.port, stashFile, shareUrl, passcode, named: args.named });
        const problem = await verifyTunnel(url);
        if (problem === null) note("tunnel checked: the public link answers.");
        else if (problem !== TUNNEL_STOPPED && !stopping) note(`this Mac could not reach the public link yet (${problem}). A new address can take a minute or two to resolve, and a name this Mac looked up too early can stay unresolved for a while on it; friends elsewhere may get through before it does. If it never works, stop and run again.`);
        return;
      }
    }
  }
  if (!stopping) banner({ port: args.port, stashFile, shareUrl, passcode, named: args.named });
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));

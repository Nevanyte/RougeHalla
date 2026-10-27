#!/usr/bin/env node
// Runs the tunnel for `npm run playtest` and ends it when the launcher goes away, however the launcher goes. A tunnel left
// behind keeps its public address pointing at the port, and whatever listens there next (a dev server with no guards) would
// be reachable from the internet through the old link. Plain Node, no dependencies.
//
//   node scripts/tunnelGuard.mjs [--pidfile <file>] [--owner <pid>] -- <command> [args...]
//
// The launcher gives this process a stdin pipe it never writes; when the launcher dies (a crash, SIGKILL) the pipe closes and
// the command is stopped: SIGTERM, then SIGKILL after TUNNEL_GUARD_GRACE_MS (default 5000). `--owner` is a second watch for
// the same thing: the launcher's pid, checked every couple of seconds. The command's output goes straight through. The record
// in `--pidfile` (scripts/tunnelPids.mjs) lets the next launcher find a tunnel this guard could not stop (it was SIGKILLed too).
// Exits with the command's exit code (127 when it could not be started).
import { spawn } from "node:child_process";
import { pidIsAlive } from "./playtestLink.mjs";
import { removeTunnelPidFile, writeTunnelPidFile } from "./tunnelPids.mjs";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split < 0 || split === argv.length - 1) {
  console.error("usage: tunnelGuard.mjs [--pidfile <file>] [--owner <pid>] -- <command> [args...]");
  process.exit(2);
}
let pidfile = null;
let owner = null;
for (let i = 0; i < split; i++) {
  if (argv[i] === "--pidfile") pidfile = argv[++i];
  else if (argv[i] === "--owner") owner = Number(argv[++i]);
  else { console.error(`unexpected argument: ${argv[i]}`); process.exit(2); }
}
const [command, ...commandArgs] = argv.slice(split + 1);
const GRACE_MS = Number(process.env.TUNNEL_GUARD_GRACE_MS) > 0 ? Number(process.env.TUNNEL_GUARD_GRACE_MS) : 5000;

const child = spawn(command, commandArgs, { stdio: ["ignore", "inherit", "inherit"] });
let stopping = false;

child.on("error", (err) => {
  console.error(`[tunnel-guard] could not start ${command}: ${err.message}`);
  if (pidfile) removeTunnelPidFile(pidfile);
  process.exit(127);
});
child.on("exit", (code) => {
  if (pidfile) removeTunnelPidFile(pidfile);
  process.exit(code ?? (stopping ? 0 : 1)); // a null code: the command was ended by a signal
});
if (pidfile && child.pid) writeTunnelPidFile(pidfile, { owner: Number.isInteger(owner) ? owner : null, guard: process.pid, tunnel: child.pid });

function stop() {
  if (stopping) return;
  stopping = true;
  try { child.kill("SIGTERM"); } catch { /* already gone */ }
  setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, GRACE_MS).unref();
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, stop);
process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.on("error", stop);
process.stdin.resume(); // reading is what notices the end
if (Number.isInteger(owner) && owner > 0) {
  setInterval(() => { if (!pidIsAlive(owner)) stop(); }, 2000).unref();
}

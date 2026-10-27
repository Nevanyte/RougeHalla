// The record of the tunnel `npm run playtest` started, next to the profile file, so that a tunnel left behind by a launcher
// that died abnormally can be found and stopped by the next one. Plain Node, no dependencies.
//
//   <profile file>.tunnel.json   { owner, guard, tunnel, startedAt }   (mode 0600)
//
// `owner` is the playtest launcher's pid, `guard` the tunnel guard's (scripts/tunnelGuard.mjs, which ends the tunnel when the
// launcher goes away) and `tunnel` cloudflared's own. A recorded pid is only ever signalled when the process that holds it now
// still looks like what was recorded (a cloudflared, the guard), so a pid the system handed to something else is left alone.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pidIsAlive } from "./playtestLink.mjs";

export const tunnelPidFilePath = (stashFile) => `${stashFile}.tunnel.json`;

export function writeTunnelPidFile(file, info) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...info, startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readTunnelPidFile(file) {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    return info && typeof info === "object" ? info : null;
  } catch {
    return null;
  }
}

/** Removes the record when it is the one written by this guard (`guard` pid). Never throws. */
export function removeTunnelPidFile(file, guardPid = process.pid) {
  try {
    if (readTunnelPidFile(file)?.guard === guardPid) fs.rmSync(file, { force: true });
  } catch {
    // Nothing there, or not ours.
  }
}

/** The command line of a process, or "" when there is none. `ps` takes a pid on macOS and Linux alike. */
export function commandOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops the tunnel a dead launcher left behind. Does nothing when there is no record, when the launcher it names is still
 * running a playtest (that tunnel is not stale), or when the recorded pids no longer belong to a cloudflared or a guard.
 * Returns the pids it stopped.
 */
export async function reapStaleTunnel(file, { signalTimeoutMs = 3000 } = {}) {
  const info = readTunnelPidFile(file);
  if (!info) return [];
  if (pidIsAlive(info.owner) && /playtest\.mjs/.test(commandOf(info.owner))) return [];
  const stopped = [];
  // The guard first: it takes its cloudflared down with it. Then whatever is left of the cloudflared itself.
  for (const [pid, looksLike] of [[info.guard, /tunnelGuard\.mjs/], [info.tunnel, /cloudflared/]]) {
    if (!pidIsAlive(pid) || !looksLike.test(commandOf(pid))) continue;
    try { process.kill(pid, "SIGTERM"); } catch { continue; }
    const end = Date.now() + signalTimeoutMs;
    while (pidIsAlive(pid) && Date.now() < end) await sleep(100);
    if (pidIsAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    stopped.push(pid);
  }
  fs.rmSync(file, { force: true });
  return stopped;
}

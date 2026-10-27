// The file `npm run playtest` writes next to the profile file while its tunnel is up: the CURRENT public address, which
// `npm run playtest:signin` needs to print links that work. Plain Node, no dependencies.
//
//   <profile file>.link.json   { url, port, pid, passcode, named, tunnelName, startedAt, down?, downAt? }   (mode 0600: the passcode is in it)
//
// `pid` is the playtest launcher's, so a file left by a launcher that was killed (SIGKILL, power loss) can be told from a
// live one: its address no longer works. `down` is set when the launcher is still running but its tunnel has stopped (cloudflared
// exited after the link was shared): the address is dead until the launcher is restarted. `named` marks a named tunnel, whose
// address is the same after a restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_STASH = path.join(os.homedir(), ".rougehalla", "playtest-profiles.json");

/** The profile file the server uses: STASH_FILE, else the playtest default. */
export const stashFileFrom = (env = process.env) => env.STASH_FILE || DEFAULT_STASH;

export const linkFilePath = (stashFile) => `${stashFile}.link.json`;

/** True while a process with this id exists (EPERM means it exists but is not ours). */
export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/** Writes the link file atomically and readable by this user only. */
export function writeLinkFile(stashFile, info) {
  const file = linkFilePath(stashFile);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...info, startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The link file, or null when there is none or it cannot be read. `live`: the launcher that wrote it is still running; `down`: its tunnel is not. */
export function readLinkFile(stashFile) {
  try {
    const info = JSON.parse(fs.readFileSync(linkFilePath(stashFile), "utf8"));
    if (!info || typeof info.url !== "string") return null;
    return { ...info, live: pidIsAlive(info.pid), down: info.down === true };
  } catch {
    return null;
  }
}

/** Removes the link file when it is ours (`pid`): another launcher's, if one ever shares the path, stays. Never throws. */
export function removeLinkFile(stashFile, pid = process.pid) {
  try {
    const file = linkFilePath(stashFile);
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (info?.pid === pid) fs.rmSync(file, { force: true });
  } catch {
    // No file, or not ours to judge: nothing to remove.
  }
}

/** Marks the address dead (its tunnel stopped) when the file is ours (`pid`), keeping the rest so the command can say what died. Never throws. */
export function markLinkDown(stashFile, pid = process.pid) {
  try {
    const file = linkFilePath(stashFile);
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (info?.pid !== pid) return;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ ...info, down: true, downAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // No file, or not ours to judge.
  }
}

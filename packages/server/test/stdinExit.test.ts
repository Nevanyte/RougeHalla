// An orphaned playtest server: `scripts/playtest.mjs` gives the server a stdin pipe and sets RAID_EXIT_ON_STDIN_END, so
// when the launcher dies without a signal (SIGKILL, a crash) the pipe closes and the server shuts down the way a SIGTERM
// does instead of keeping the port and the profile file's lock. The entry block of src/index.ts is the code under test, so
// this runs the real entry in a child process.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProfileResponse } from "@raid/shared";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

interface Child { proc: ChildProcess; output: () => string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }

let dir = "";
let profileFile = "";
let port = 0;
let child: Child | null = null;

function startEntry(extraEnv: Record<string, string>): Promise<Child> {
  // The launcher's own way of starting it: node + tsx from the repo root, a pipe for stdin.
  const proc = spawn(process.execPath, ["--import", "tsx", path.join("packages", "server", "src", "index.ts")], {
    cwd: ROOT,
    env: { ...process.env, RAID_PORT: String(port), STASH_FILE: profileFile, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let text = "";
  proc.stdout!.on("data", (d: Buffer) => { text += d.toString(); });
  proc.stderr!.on("data", (d: Buffer) => { text += d.toString(); });
  proc.stdin!.on("error", () => {});
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => proc.on("exit", (code, signal) => resolve({ code, signal })));
  const c: Child = { proc, output: () => text, exited };
  child = c;
  return (async () => {
    const end = Date.now() + 30_000;
    while (!/listening on/.test(text)) {
      if (proc.exitCode !== null) throw new Error(`the server ended before it listened:\n${text}`);
      if (Date.now() > end) throw new Error(`the server did not start:\n${text}`);
      await sleep(50);
    }
    return c;
  })();
}

async function claim(name: string): Promise<ProfileResponse> {
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ProfileResponse;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stdin-exit-"));
  profileFile = path.join(dir, "profiles.json");
  port = await freePort();
});

afterEach(async () => {
  if (child && child.proc.exitCode === null && child.proc.signalCode === null) {
    child.proc.kill("SIGTERM");
    await Promise.race([child.exited, sleep(10_000)]);
    if (child.proc.exitCode === null && child.proc.signalCode === null) child.proc.kill("SIGKILL");
  }
  child = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a server started with RAID_EXIT_ON_STDIN_END", () => {
  it("shuts down cleanly when its stdin pipe closes: profiles flushed, lock freed, exit 0", async () => {
    const c = await startEntry({ RAID_EXIT_ON_STDIN_END: "1" });
    const amy = await claim("orphan1"); // a write is only scheduled (up to a second away): the shutdown must flush it
    expect(amy.created).toBe(true);
    expect(fs.existsSync(`${profileFile}.lock`)).toBe(true);

    c.proc.stdin!.end(); // what the kernel does when the launcher is killed: the write end of the pipe goes away
    const { code, signal } = await Promise.race([c.exited, sleep(20_000).then(() => "timeout" as const)]) as { code: number | null; signal: string | null };
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(c.output()).toMatch(/launcher is gone/);

    expect(fs.existsSync(`${profileFile}.lock`)).toBe(false);
    const saved = JSON.parse(fs.readFileSync(profileFile, "utf8")) as { profiles: Record<string, { token: string }> };
    expect(saved.profiles.orphan1?.token).toBe(amy.token);
    await expect(fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow(); // the port is free
  }, 60_000);

  it("a SIGTERM still stops it the same single-signal way", async () => {
    const c = await startEntry({ RAID_EXIT_ON_STDIN_END: "1" });
    const bob = await claim("orphan2");
    c.proc.kill("SIGTERM");
    const { code } = await c.exited;
    expect(code).toBe(0);
    expect(c.output()).not.toMatch(/launcher is gone/);
    expect(fs.existsSync(`${profileFile}.lock`)).toBe(false);
    expect((JSON.parse(fs.readFileSync(profileFile, "utf8")) as { profiles: Record<string, unknown> }).profiles.orphan2).toBeDefined();
    expect(bob.created).toBe(true);
  }, 60_000);
});

describe("a server started without the flag", () => {
  it("keeps running when its stdin ends (a closed or /dev/null stdin is normal outside the launcher)", async () => {
    const c = await startEntry({});
    c.proc.stdin!.end();
    await sleep(1500);
    expect(c.proc.exitCode).toBeNull();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.ok).toBe(true);
    expect(c.output()).not.toMatch(/launcher is gone/);
  }, 60_000);
});

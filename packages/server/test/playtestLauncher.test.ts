// `npm run playtest` (scripts/playtest.mjs) run for real against a FAKE `cloudflared` on PATH: no account, no network, no real
// tunnel. What matters is what happens around the tunnel: it must not outlive the launcher however the launcher dies, a dead
// tunnel must not leave a usable-looking address behind, the named-tunnel flags must reach cloudflared as its CLI wants them,
// a missing credentials error must read plainly (and print no secret), and the network simulator must never be live.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPTS = path.join(ROOT, "scripts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

async function until(pred: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(50);
  }
}

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

/** A cloudflared that behaves like the real one's output, for the cases that matter (it registers, it lacks credentials, it names no address, it exits early), and logs how it was called. */
const FAKE_CLOUDFLARED = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("cloudflared version 0.0.0-fake"); process.exit(0); }
fs.appendFileSync(process.env.FAKE_CF_LOG, JSON.stringify({ pid: process.pid, args }) + "\\n");
const mode = process.env.FAKE_CF_MODE || "ok";
const out = (s) => process.stderr.write("2026-10-26T12:00:00Z " + s + "\\n");
process.on("SIGTERM", () => { if (!process.env.FAKE_CF_IGNORE_TERM) process.exit(0); });
if (mode === "silent") {
  out("INF Requesting new quick Tunnel on trycloudflare.com...");
  out("WRN Retrying connection in up to 2s");
} else if (mode === "earlyexit") {
  out("INF Requesting new quick Tunnel on trycloudflare.com...");
  out("ERR failed to request quick Tunnel: Post https://api.trycloudflare.com/tunnel: dial tcp: lookup api.trycloudflare.com: no such host");
  process.exit(3);
} else if (args.includes("run")) {
  if (mode === "nocreds") {
    out("INF Starting tunnel tunnelID=00000000-0000-0000-0000-000000000000");
    out("ERR Tunnel credentials file '/Users/test/.cloudflared/00000000-0000-0000-0000-000000000000.json' doesn't exist or is not a file");
    out('ERR {"AccountTag":"acct123","TunnelSecret":"SUPERSECRETVALUE9876","TunnelID":"tid"}');
    process.exit(1);
  }
  out("INF Starting tunnel tunnelID=00000000-0000-0000-0000-000000000000");
  out("INF Generated Connector ID: 11111111-1111-1111-1111-111111111111");
  out("INF Initial protocol quic");
  out("INF Registered tunnel connection connIndex=0 connection=22222222-2222-2222-2222-222222222222 event=0 ip=198.41.200.23 location=sjc01 protocol=quic");
} else {
  out("INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.");
  out("INF Requesting new quick Tunnel on trycloudflare.com...");
  out("INF +--------------------------------------------------------------------------------------------+");
  out("INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |");
  out("INF |  https://fake-words-here.trycloudflare.com                                                 |");
  out("INF +--------------------------------------------------------------------------------------------+");
  out("INF Registered tunnel connection connIndex=0 connection=22222222-2222-2222-2222-222222222222 event=0 ip=198.41.200.23 location=sjc01 protocol=quic");
}
if (process.env.FAKE_CF_DIE_AFTER_MS) setTimeout(() => process.exit(8), Number(process.env.FAKE_CF_DIE_AFTER_MS));
setInterval(() => {}, 1000);
`;

interface Launcher {
  proc: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

let dir = "";
let stash = "";
let cfLog = "";
let clientDir = "";
let port = 0;
const launchers: Launcher[] = [];
const extraPids: number[] = [];

/** The pids the fake cloudflared logged, in start order. */
const fakePids = (): number[] => (fs.existsSync(cfLog) ? fs.readFileSync(cfLog, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { pid: number }).pid) : []);
const fakeCalls = (): Array<{ pid: number; args: string[] }> => (fs.existsSync(cfLog) ? fs.readFileSync(cfLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; args: string[] }) : []);

function launch(args: string[], env: Record<string, string> = {}): Launcher {
  const proc = spawn(process.execPath, [path.join(SCRIPTS, "playtest.mjs"), "--no-build", "--port", String(port), ...args], {
    cwd: ROOT,
    env: {
      ...process.env, PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`, NO_COLOR: "1",
      STASH_FILE: stash, PLAYTEST_CLIENT_DIR: clientDir, FAKE_CF_LOG: cfLog, MIN_PLAYERS: "99", ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  proc.stdout!.on("data", (d: Buffer) => { text += d.toString(); });
  proc.stderr!.on("data", (d: Buffer) => { text += d.toString(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => proc.on("exit", (code, signal) => resolve({ code, signal })));
  const l: Launcher = { proc, output: () => text, exited };
  launchers.push(l);
  return l;
}

const waitForOutput = (l: Launcher, re: RegExp, timeoutMs = 60_000) =>
  until(() => re.test(l.output()) || l.proc.exitCode !== null, `${re} in:\n${l.output()}`, timeoutMs).then(() => {
    if (!re.test(l.output())) throw new Error(`the launcher ended before printing ${re}:\n${l.output()}`);
  });

const linkInfo = () => JSON.parse(fs.readFileSync(`${stash}.link.json`, "utf8")) as Record<string, unknown>;
const healthy = (p = port) => fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "playtest-launcher-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin", "cloudflared"), FAKE_CLOUDFLARED, { mode: 0o755 });
  clientDir = path.join(dir, "client");
  fs.mkdirSync(clientDir);
  fs.writeFileSync(path.join(clientDir, "index.html"), "<!doctype html><title>fake client</title>");
  stash = path.join(dir, "data", "profiles.json");
  cfLog = path.join(dir, "cloudflared.log");
  port = await freePort();
});

afterEach(async () => {
  for (const l of launchers.splice(0)) {
    if (l.proc.exitCode === null && l.proc.signalCode === null) {
      l.proc.kill("SIGTERM");
      await Promise.race([l.exited, sleep(15_000)]);
      if (l.proc.exitCode === null && l.proc.signalCode === null) l.proc.kill("SIGKILL");
    }
  }
  // Whatever a failed test left running (the fake tunnels, a decoy), by pid.
  for (const pid of [...fakePids(), ...extraPids.splice(0)]) if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the tunnel does not outlive the launcher", () => {
  it("a SIGKILLed launcher takes cloudflared and the server with it; the record of the tunnel goes too; a netsim variable was dropped", async () => {
    const l = launch([], { COLYSEUS_LATENCY: "150", NET_LOSS_PCT: "5" });
    await waitForOutput(l, /is running/);
    expect(l.output()).toMatch(/ignoring COLYSEUS_LATENCY=150, NET_LOSS_PCT=5: the network simulator/);
    expect(l.output()).not.toMatch(/network simulator (ON|REFUSED)/); // the server never saw it
    const [fake] = fakePids();
    expect(fake).toBeGreaterThan(0);
    expect(alive(fake!)).toBe(true);
    expect(linkInfo()).toMatchObject({ url: "https://fake-words-here.trycloudflare.com", pid: l.proc.pid, named: false });
    const record = JSON.parse(fs.readFileSync(`${stash}.tunnel.json`, "utf8")) as { owner: number; guard: number; tunnel: number };
    expect(record).toMatchObject({ owner: l.proc.pid, tunnel: fake });
    expect(alive(record.guard)).toBe(true);
    expect(await healthy()).toBe(true);

    const killedAt = Date.now();
    process.kill(l.proc.pid!, "SIGKILL");
    await until(() => !alive(fake!), "cloudflared to end after its launcher was SIGKILLed", 10_000);
    expect(Date.now() - killedAt).toBeLessThan(6000);
    await until(() => !alive(record.guard), "the guard to end", 10_000);
    await until(() => !fs.existsSync(`${stash}.tunnel.json`), "the tunnel record to go", 5000);
    for (let i = 0; i < 100 && (await healthy()); i++) await sleep(100);
    expect(await healthy()).toBe(false);
  }, 90_000);

  it("a clean Ctrl+C stops the tunnel, the server and the address file", async () => {
    const l = launch([]);
    await waitForOutput(l, /is running/);
    const [fake] = fakePids();
    l.proc.kill("SIGINT");
    const { code } = await l.exited;
    expect(code).toBe(0);
    expect(alive(fake!)).toBe(false);
    expect(fs.existsSync(`${stash}.link.json`)).toBe(false);
    expect(fs.existsSync(`${stash}.tunnel.json`)).toBe(false);
  }, 90_000);

  it("the next launch stops a cloudflared a dead launcher left recorded, and leaves a recorded pid that is something else alone", async () => {
    // A stale tunnel, as if its launcher and guard were SIGKILLed: only the cloudflared survived.
    const stale = spawn(path.join(dir, "bin", "cloudflared"), ["tunnel", "--url", "http://127.0.0.1:1"], { env: { ...process.env, FAKE_CF_LOG: cfLog }, stdio: "ignore", detached: true });
    stale.unref();
    const decoy = spawn("sleep", ["120"], { stdio: "ignore", detached: true });
    decoy.unref();
    extraPids.push(decoy.pid!);
    await until(() => fakePids().length === 1, "the stale fake to start", 10_000);
    fs.mkdirSync(path.dirname(stash), { recursive: true });
    fs.writeFileSync(`${stash}.tunnel.json`, JSON.stringify({ owner: 2_000_000_000, guard: decoy.pid, tunnel: stale.pid }));

    const l = launch(["--no-tunnel"]);
    await waitForOutput(l, /is running/);
    expect(l.output()).toMatch(/stopped a cloudflared tunnel left behind by a playtest that died/);
    expect(alive(stale.pid!)).toBe(false);
    expect(alive(decoy.pid!)).toBe(true); // `sleep` is not a tunnel guard: never signalled just because its pid was written down
    expect(fs.existsSync(`${stash}.tunnel.json`)).toBe(false);
  }, 90_000);
});

describe("a tunnel that stops after the link was shared", () => {
  it("marks the address dead for playtest:signin, says so once, and no longer reports the link as unreachable", async () => {
    const l = launch([], { FAKE_CF_DIE_AFTER_MS: "1500" });
    await waitForOutput(l, /THE TUNNEL STOPPED/);
    // The address file stays (the launcher is running) but says the tunnel is down.
    await until(() => linkInfo().down === true, "the link file to be marked down", 5000);
    const signin = (await import(/* @vite-ignore */ pathToFileURL(path.join(SCRIPTS, "playtest-signin.mjs")).href)) as {
      resolveTarget(args: { url: string | null }, stash: string, env: Record<string, string>): unknown;
    };
    expect(() => signin.resolveTarget({ url: null }, stash, {})).toThrow(/tunnel of the running playtest has stopped.*no longer works/s);
    expect(signin.resolveTarget({ url: "https://other.example" }, stash, {})).toMatchObject({ url: "https://other.example" }); // --url still works
    // The look at the public link starts 6 s after the banner: it must give up when the tunnel is gone instead of reporting it.
    await sleep(8000);
    expect(l.output()).not.toMatch(/could not reach the public link/);
    expect(l.output().match(/THE TUNNEL STOPPED/g)).toHaveLength(1);
    expect(l.output()).not.toMatch(/no public link was opened/);
    expect(l.proc.exitCode).toBeNull(); // the server goes on
    expect(await healthy()).toBe(true);
  }, 90_000);
});

describe("a tunnel that never came up", () => {
  // No address was handed out, so no link was shared: nothing "stopped", and no link file was ever written to mark down.
  const expectNoLinkWasShared = async (l: Launcher) => {
    await sleep(1500); // an exit (the timeout kills the tunnel) lands after the banner; give a wrong report time to show
    const text = l.output();
    expect(text).toMatch(/is running/);
    expect(text).toMatch(/No public link: friends outside this network cannot join/);
    expect(text).not.toContain("THE TUNNEL STOPPED");
    expect(text).not.toMatch(/public link no longer works/);
    expect(text).not.toContain("SHARE THIS LINK");
    expect(fs.existsSync(`${stash}.link.json`)).toBe(false);
    expect(l.proc.exitCode).toBeNull(); // the server goes on locally
    expect(await healthy()).toBe(true);
  };

  it("one that gives no address before the wait runs out: says so with its last output, stops that cloudflared, reports no stopped link", async () => {
    const l = launch([], { FAKE_CF_MODE: "silent", PLAYTEST_TUNNEL_TIMEOUT_MS: "1500" });
    await waitForOutput(l, /is running/);
    const text = l.output();
    expect(text).toMatch(/cloudflared gave no tunnel address in time, so no public link was opened\. Its last output:/);
    expect(text).toContain("Retrying connection in up to 2s"); // its last output is shown
    const [fake] = fakePids();
    await until(() => !alive(fake!), "the silent cloudflared to be stopped (a tunnel nobody was told about must not keep running)", 10_000);
    await expectNoLinkWasShared(l);
  }, 90_000);

  it("one that exits before it registered: says why with its last output, reports no stopped link", async () => {
    const l = launch([], { FAKE_CF_MODE: "earlyexit" });
    await waitForOutput(l, /is running/);
    const text = l.output();
    expect(text).toMatch(/cloudflared stopped \(exit 3\) before the tunnel was up, so no public link was opened\. Its last output:/);
    expect(text).toContain("failed to request quick Tunnel");
    await expectNoLinkWasShared(l);
  }, 90_000);
});

describe("a named tunnel", () => {
  it("runs `cloudflared tunnel --no-autoupdate run --url <origin> <name>`, shares https://<hostname>/ with the passcode, records it, and says sign-in links are not needed", async () => {
    const l = launch([], { PLAYTEST_TUNNEL: "testtun", PLAYTEST_HOSTNAME: "Play.Example.Invalid", PLAYTEST_PASSCODE: "open-sesame" });
    await waitForOutput(l, /is running/);
    expect(fakeCalls().map((c) => c.args)).toEqual([["tunnel", "--no-autoupdate", "run", "--url", `http://127.0.0.1:${port}`, "testtun"]]);
    expect(l.output()).toContain("https://play.example.invalid/?code=open-sesame");
    expect(l.output()).toMatch(/STABLE ADDRESS \(your tunnel "testtun"\)/);
    expect(l.output()).toMatch(/nobody needs a sign-in link/);
    expect(l.output()).not.toMatch(/RETURNING PLAYERS need their sign-in link/);
    expect(linkInfo()).toMatchObject({ url: "https://play.example.invalid", named: true, tunnelName: "testtun", passcode: "open-sesame", pid: l.proc.pid });
    // Under the guard too: a SIGKILLed launcher takes this tunnel with it.
    const [fake] = fakePids();
    process.kill(l.proc.pid!, "SIGKILL");
    await until(() => !alive(fake!), "the named tunnel's cloudflared to end", 10_000);
  }, 90_000);

  it("flags work like the variables, and --quick overrides them", async () => {
    const l = launch(["--named", "viaflag", "--hostname", "https://play.example.invalid/"]);
    await waitForOutput(l, /is running/);
    expect(fakeCalls()[0]!.args.slice(-1)).toEqual(["viaflag"]);
    expect(linkInfo()).toMatchObject({ url: "https://play.example.invalid" });
    l.proc.kill("SIGINT");
    await l.exited;
    const q = launch(["--quick"], { PLAYTEST_TUNNEL: "viaenv", PLAYTEST_HOSTNAME: "play.example.invalid" });
    await waitForOutput(q, /is running/);
    expect(fakeCalls()[1]!.args).toEqual(["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`]);
    expect(linkInfo()).toMatchObject({ url: "https://fake-words-here.trycloudflare.com", named: false });
  }, 120_000);

  it("missing credentials read plainly: what to run, cloudflared's own error, no secret from it; the server goes on locally", async () => {
    const l = launch(["--named", "roguehalla", "--hostname", "play.roguehalla.com"], { FAKE_CF_MODE: "nocreds" });
    await waitForOutput(l, /is running/);
    const text = l.output();
    expect(text).toMatch(/could not run the tunnel "roguehalla": its credentials .* were not found/);
    expect(text).toContain("cloudflared tunnel login");
    expect(text).toContain("cloudflared tunnel create roguehalla");
    expect(text).toContain("cloudflared tunnel route dns roguehalla play.roguehalla.com");
    expect(text).toMatch(/credentials file .* doesn't exist/); // cloudflared's own words are shown...
    expect(text).not.toContain("SUPERSECRETVALUE9876"); // ...but nothing that looks like a secret in them
    expect(text).not.toContain("acct123");
    expect(text).toMatch(/No public link: friends outside this network cannot join/);
    expect(fs.existsSync(`${stash}.link.json`)).toBe(false);
    expect(await healthy()).toBe(true);
  }, 90_000);
});

describe("the launcher's arguments", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [path.join(SCRIPTS, "playtest.mjs"), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env, PLAYTEST_TUNNEL: "", PLAYTEST_HOSTNAME: "", NO_COLOR: "1", ...env } });

  it("--help shows the stable-link example", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--named roguehalla --hostname play.roguehalla.com");
  });

  it("refuses a tunnel name without its address, an address without its tunnel, and names that are not names", () => {
    const cases: Array<[string[], Record<string, string>, RegExp]> = [
      [["--named", "x"], {}, /needs the address it serves/],
      [["--hostname", "play.example.com"], {}, /needs the tunnel's name.*--quick/],
      [["--named", "x", "--hostname", "not a host"], {}, /is not a hostname/],
      [["--named", "x", "--hostname", "play.example.com/path"], {}, /is not a hostname/],
      [["--named", "-rf", "--hostname", "play.example.com"], {}, /needs a value|is not a tunnel name/],
      [["--named", "a b", "--hostname", "play.example.com"], {}, /is not a tunnel name/],
      [["--named", "x", "--hostname", "play.example.com", "--quick"], {}, /--quick is a quick tunnel/],
      [["--named", "x", "--hostname", "play.example.com", "--no-tunnel"], {}, /drop --no-tunnel/],
      [[], { PLAYTEST_HOSTNAME: "play.example.com" }, /needs the tunnel's name/],
    ];
    for (const [args, env, re] of cases) {
      const r = run(args, env);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr + r.stdout, args.join(" ")).toMatch(re);
    }
  });
});

describe("the tunnel guard on its own", () => {
  const GUARD = path.join(SCRIPTS, "tunnelGuard.mjs");
  /** The guard, with its exit code as a promise made at spawn (an exit that came before anyone listened would be missed). */
  const guard = (args: string[], env: Record<string, string> = {}) => {
    const proc = spawn(process.execPath, [GUARD, ...args], { env: { ...process.env, FAKE_CF_LOG: cfLog, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const code = new Promise<number | null>((resolve) => proc.on("exit", (c) => resolve(c)));
    return Object.assign(proc, { code });
  };
  const fake = () => path.join(dir, "bin", "cloudflared");

  it("ends its command when its stdin pipe closes, and ignores a SIGTERM-proof command no longer than the grace", async () => {
    const g = guard(["--", fake(), "tunnel", "--url", "http://127.0.0.1:1"], { FAKE_CF_IGNORE_TERM: "1", TUNNEL_GUARD_GRACE_MS: "600" });
    await until(() => fakePids().length === 1, "the command to start", 10_000);
    const [pid] = fakePids();
    expect(alive(pid!)).toBe(true);
    g.stdin!.end();
    await until(() => !alive(pid!), "the SIGTERM-proof command to be SIGKILLed", 10_000);
    expect(await g.code).toBe(0);
  }, 30_000);

  it("ends its command when the owner it was told about is gone", async () => {
    const g = guard(["--owner", "2000000000", "--", fake(), "tunnel", "--url", "http://127.0.0.1:1"]);
    const [pid] = await (async () => { await until(() => fakePids().length === 1, "the command to start", 10_000); return fakePids(); })();
    await until(() => !alive(pid!), "the command to end for want of an owner", 10_000);
    expect(await g.code).toBe(0);
  }, 30_000);

  it("passes its command's exit code through, and answers 127 for a command that does not exist", async () => {
    const dies = guard(["--", fake(), "tunnel", "--url", "http://127.0.0.1:1"], { FAKE_CF_DIE_AFTER_MS: "300" });
    expect(await dies.code).toBe(8);
    const missing = guard(["--", path.join(dir, "bin", "no-such-command")]);
    expect(await missing.code).toBe(127);
  }, 30_000);
});

// TRACE_INPUTS on a server that hosts a public link (CLIENT_DIR or NODE_ENV=production): it records every player's movement, so it
// is refused there with one warning, as the network simulator is, unless ALLOW_TRACE_WHEN_HOSTING=1 asks for it.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@colyseus/sdk";
import { ROOM_NAME } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer } from "../src/index";
import { traceWritesSettled } from "../src/rooms/traceWriter";

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

async function until(pred: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(10);
  }
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A hosting server with TRACE_INPUTS set plays one arena run for about 1.5 s (a flush is due every second); returns the trace file. */
async function hostedRun(extraEnv: Record<string, string>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-trace-hosting-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clientDir = path.join(dir, "client");
  fs.mkdirSync(clientDir);
  fs.writeFileSync(path.join(clientDir, "index.html"), "<!doctype html><title>hosted</title>");
  const traceFile = path.join(dir, "trace.jsonl");
  const port = await freePort();
  const config = loadConfig({ BOTS_FILL_TO: "0", CLIENT_DIR: clientDir, TRACE_INPUTS: traceFile, ...extraEnv });
  expect(config.sameOriginOnly).toBe(true);
  const server = await startServer({
    ...config, port, minPlayers: 1, fillSeconds: 0, lobbySeconds: 30, planSeconds: 0, firstPatienceSeconds: 0,
    patienceSeconds: 600, patienceMinSeconds: 600, suddenDeathSeconds: 600, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"),
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const { token } = (await (await fetch(`${base}/api/profile/hosted`)).json()) as { token: string };
    const room = await new Client(base).create<RaidState>(ROOM_NAME, { profile: "hosted", token });
    for (const type of ["fxs", "toast", "result", "plan", "vision"]) room.onMessage(type, () => {});
    await until(() => room.state.phase === "active", "the arena run");
    const me = room.state.players.get(room.sessionId)!;
    room.send("move", { x: me.x + 200, y: me.y, seq: 1 });
    await sleep(1500);
  } finally {
    await server.stop();
    await traceWritesSettled();
  }
  return traceFile;
}

describe("TRACE_INPUTS on a hosting server", () => {
  it("is refused with one warning: nothing is recorded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanups.push(() => warn.mockRestore());
    const file = await hostedRun({});
    expect(fs.existsSync(file)).toBe(false);
    const refusals = warn.mock.calls.map((c) => String(c[0])).filter((m) => /movement trace REFUSED/.test(m));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/ALLOW_TRACE_WHEN_HOSTING/);
  });

  it("ALLOW_TRACE_WHEN_HOSTING=1 records anyway, and says so", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    cleanups.push(() => log.mockRestore());
    const file = await hostedRun({ ALLOW_TRACE_WHEN_HOSTING: "1" });
    expect(fs.readFileSync(file, "utf8").trim().split("\n").length).toBeGreaterThan(10);
    expect(log.mock.calls.map((c) => String(c[0])).filter((m) => /movement trace ON while hosting/.test(m))).toHaveLength(1);
  });
});

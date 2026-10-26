import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@colyseus/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { mulberry32, ROOM_NAME } from "@raid/shared";
import { loadConfig } from "../src/config";
import { startServer } from "../src/index";
import { DelayLine, LinkModel, MIN_RTO_MS, netSimEnabled, type Clock } from "../src/net/netSim";

const params = (over: Partial<{ rttMs: number; jitterMs: number; lossPct: number }> = {}) => ({ rttMs: 40, jitterMs: 0, lossPct: 0, ...over });

/** A clock that only moves when told, with timers run in time order. */
class FakeClock implements Clock {
  t = 0;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private next = 1;
  now(): number { return this.t; }
  setTimer(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimer(h: unknown): void { this.timers = this.timers.filter((x) => x.id !== h); }
  /** Runs every timer due up to `t`, moving time to each one's moment. */
  advanceTo(t: number): void {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const due = this.timers[0];
      if (!due || due.at > t) break;
      this.timers.shift();
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = t;
  }
}

describe("LinkModel", () => {
  it("is a fixed half round trip with no jitter and no loss", () => {
    const m = new LinkModel(params({ rttMs: 60 }), mulberry32(1));
    for (const now of [0, 5, 1000, 1000.5]) expect(m.deliveryAt(now)).toBe(now + 30);
  });

  it("jitter is right-skewed: the extra delay has the configured mean, a long tail and never goes below the base", () => {
    // Messages far apart in time, so the ordering clamp never binds and the draws are seen raw.
    const m = new LinkModel(params({ rttMs: 40, jitterMs: 10 }), mulberry32(7));
    const extras: number[] = [];
    for (let i = 0; i < 20000; i++) extras.push(m.deliveryAt(i * 10000) - i * 10000 - 20);
    const mean = extras.reduce((a, b) => a + b, 0) / extras.length;
    expect(Math.min(...extras)).toBeGreaterThanOrEqual(0);
    expect(mean).toBeGreaterThan(9.5);
    expect(mean).toBeLessThan(10.5);
    const sorted = [...extras].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]!).toBeLessThan(mean); // right-skewed: the median sits under the mean
    expect(sorted[Math.floor(sorted.length * 0.99)]!).toBeGreaterThan(35); // exp(10): p99 = 46
  });

  it("never delivers a message before one handed over earlier, whatever the jitter and loss", () => {
    const m = new LinkModel(params({ rttMs: 30, jitterMs: 25, lossPct: 5 }), mulberry32(3));
    let prev = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const at = m.deliveryAt(i * 7);
      expect(at).toBeGreaterThanOrEqual(prev);
      expect(at).toBeGreaterThanOrEqual(i * 7 + 15); // still after its own send plus the base delay
      prev = at;
    }
  });

  it("a lost message waits one retransmission timeout and holds back everything sent behind it (head-of-line blocking)", () => {
    // Scripted draws (no jitter): each message draws once for its loss; < 5% means lost, and a retransmission draws again.
    const draws = [0.9, 0.01, 0.9, 0.9, 0.9, 0.9];
    const m = new LinkModel(params({ rttMs: 40, lossPct: 5 }), () => draws.shift()!);
    expect(m.rto).toBe(MIN_RTO_MS);
    const a = m.deliveryAt(0); // fine
    const b = m.deliveryAt(50); // lost once, its retransmission goes through
    const c = m.deliveryAt(100); // sent after b: has to wait for it
    const d = m.deliveryAt(150);
    const e = m.deliveryAt(500); // far enough behind: unaffected
    expect(a).toBe(20);
    expect(b).toBe(50 + 20 + MIN_RTO_MS);
    expect(c).toBe(b);
    expect(d).toBe(b);
    expect(e).toBe(520);
  });

  it("the timeout grows with the round trip and the jitter, never below 200 ms, and doubles when the retransmission is lost too", () => {
    expect(new LinkModel(params({ rttMs: 300, jitterMs: 20 }), mulberry32(1)).rto).toBe(380);
    expect(new LinkModel(params({ rttMs: 10, jitterMs: 5 }), mulberry32(1)).rto).toBe(MIN_RTO_MS);
    const draws = [0.01, 0.01, 0.9];
    const m = new LinkModel(params({ rttMs: 40, lossPct: 5 }), () => draws.shift()!);
    expect(m.deliveryAt(0)).toBe(20 + MIN_RTO_MS + 2 * MIN_RTO_MS);
  });

  it("about lossPct of the messages stall", () => {
    const m = new LinkModel(params({ rttMs: 20, lossPct: 1 }), mulberry32(11));
    let stalled = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) if (m.deliveryAt(i * 10000) - i * 10000 > 10 + 1) stalled++;
    expect(stalled / n).toBeGreaterThan(0.007);
    expect(stalled / n).toBeLessThan(0.013);
  });

  it("is repeatable from a seed", () => {
    const run = (seed: number) => {
      const m = new LinkModel(params({ jitterMs: 12, lossPct: 2 }), mulberry32(seed));
      return Array.from({ length: 50 }, (_, i) => m.deliveryAt(i * 11));
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it("is on when anything is set", () => {
    expect(netSimEnabled({ rttMs: 0, jitterMs: 0, lossPct: 0 })).toBe(false);
    expect(netSimEnabled({ rttMs: 1, jitterMs: 0, lossPct: 0 })).toBe(true);
    expect(netSimEnabled({ rttMs: 0, jitterMs: 1, lossPct: 0 })).toBe(true);
    expect(netSimEnabled({ rttMs: 0, jitterMs: 0, lossPct: 0.1 })).toBe(true);
  });
});

describe("DelayLine", () => {
  it("hands items over in order at their delivery times", () => {
    const clock = new FakeClock();
    const line = new DelayLine(new LinkModel(params({ rttMs: 40 }), mulberry32(1)), clock);
    const got: Array<[string, number]> = [];
    const send = (name: string) => line.push(() => got.push([name, clock.t]));
    send("a");
    clock.advanceTo(10);
    send("b");
    clock.advanceTo(19);
    expect(got).toEqual([]);
    clock.advanceTo(20);
    expect(got).toEqual([["a", 20]]);
    clock.advanceTo(100);
    expect(got).toEqual([["a", 20], ["b", 30]]);
    expect(line.pending).toBe(0);
  });

  it("a stalled message delays the ones behind it, which then arrive together, still in order", () => {
    const clock = new FakeClock();
    // The second message draws a loss (and its retransmission goes through); the rest are fine.
    const draws = [0.9, 0.01, 0.9, 0.9, 0.9, 0.9, 0.9];
    const line = new DelayLine(new LinkModel(params({ rttMs: 40, lossPct: 5 }), () => draws.shift()!), clock);
    const got: Array<[string, number]> = [];
    const send = (name: string) => line.push(() => got.push([name, clock.t]));
    send("1");
    clock.advanceTo(50);
    send("2"); // lost: delivered at 50 + 20 + 200 = 270
    clock.advanceTo(100);
    send("3");
    clock.advanceTo(150);
    send("4");
    clock.advanceTo(200);
    send("5");
    clock.advanceTo(269);
    expect(got.map((g) => g[0])).toEqual(["1"]); // 3, 4 and 5 were due long ago but are stuck behind 2
    clock.advanceTo(270);
    expect(got.map((g) => g[0])).toEqual(["1", "2", "3", "4", "5"]);
    expect(got.slice(1).every(([, t]) => t === 270)).toBe(true);
  });

  it("dispose drops what is in flight", () => {
    const clock = new FakeClock();
    const line = new DelayLine(new LinkModel(params({ rttMs: 40 }), mulberry32(1)), clock);
    let n = 0;
    line.push(() => n++);
    line.dispose();
    line.push(() => n++);
    clock.advanceTo(1000);
    expect(n).toBe(0);
  });

  it("a delivery that throws does not stop the ones behind it", () => {
    const clock = new FakeClock();
    const line = new DelayLine(new LinkModel(params({ rttMs: 0 }), mulberry32(1)), clock);
    const got: number[] = [];
    const quiet = console.error;
    console.error = () => {};
    try {
      line.push(() => { throw new Error("boom"); });
      line.push(() => got.push(2));
      clock.advanceTo(1);
    } finally {
      console.error = quiet;
    }
    expect(got).toEqual([2]);
  });
});

// ------------------------------------------------------------------------------------------------------ against the real server

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

describe("installed on a server", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function pings(env: Record<string, string>, n = 6): Promise<number[]> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-netsim-"));
    const port = await freePort();
    const saved = process.env.COLYSEUS_LATENCY;
    process.env.COLYSEUS_LATENCY = env.COLYSEUS_LATENCY ?? "";
    const server = await startServer({
      ...loadConfig({ ...env, MIN_PLAYERS: "2", LOBBY_SECONDS: "120" }), port, stashFile: path.join(dir, "stash.json"),
    });
    if (saved === undefined) delete process.env.COLYSEUS_LATENCY;
    else process.env.COLYSEUS_LATENCY = saved;
    cleanups.push(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${port}`;
    const prof = (await (await fetch(`${base}/api/profile/netsim1`)).json()) as { token: string };
    const room = await new Client(base).joinOrCreate(ROOM_NAME, { profile: "netsim1", token: prof.token });
    cleanups.push(async () => { room.reconnection.enabled = false; await room.leave(true).catch(() => {}); });
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(await new Promise<number>((res) => room.ping(res)));
    return out;
  }

  it("with the round trip set, a ping takes about that long, and not twice as long (Colyseus's own COLYSEUS_LATENCY is out)", async () => {
    const rtts = await pings({ COLYSEUS_LATENCY: "120" });
    const med = [...rtts].sort((a, b) => a - b)[Math.floor(rtts.length / 2)]!;
    expect(med).toBeGreaterThanOrEqual(115);
    expect(med).toBeLessThan(160);
  }, 30000);

  it("with nothing set, a ping is near zero", async () => {
    const rtts = await pings({});
    expect(Math.max(...rtts)).toBeLessThan(40);
  }, 30000);
});

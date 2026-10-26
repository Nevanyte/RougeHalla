// Client-side prediction of the local fighter (net/localMotion.ts). A small fake server stands in for the room: it ticks every
// TICK_MS, applies the orders that reached it (one per tick, the last wins), walks the player along the same shared A* path
// at PLAYER_SPEED, and sends each tick's patch (position, server time, moveSeq) back after the downlink delay. The client
// clock reads a patch's server time when the patch arrives, as ServerClock does: c = now - downlink.
import { describe, expect, it } from "vitest";
import {
  findPath, mapFromTiles, mulberry32, PLAYER_RADIUS, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WORLD_H, WORLD_W, withGates,
  type GameMap, type Vec2,
} from "@raid/shared";
import {
  clampToWorld, CORRECT_SPEED_MOVING_MAX, LocalMotion, ORDER_EXPIRE_MS, REBASE_DEADZONE, SNAP_DISTANCE, VISUAL_SNAP_DISTANCE,
  type FrameInput,
} from "../src/net/localMotion";

const W = 60;
const H = 30;
/** A walled room, all floor inside, with `walls` (tile coordinates) as obstacles. */
function arena(walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  for (const [x, y] of walls) tiles[y * W + x] = TILE_WALL;
  return mapFromTiles(W, H, tiles);
}
const centre = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const ALIVE: FrameInput = { alive: true, speedMult: 1, rooted: false, aiming: false };
const FRAME_MS = 1000 / 60;

interface Options {
  map?: GameMap;
  /** Milliseconds a message takes up and down. */
  up?: number;
  down?: number;
  /** Random extra milliseconds on each message, up to this (a fixed seed). */
  jitter?: number;
  start?: Vec2;
}

/** The fake room and the client in one loop; `run(ms)` advances true time one millisecond at a time. */
class Rig {
  readonly motion = new LocalMotion();
  readonly map: GameMap;
  now = 0;
  readonly up: number;
  readonly down: number;
  private readonly jitter: number;
  private readonly rnd = mulberry32(5);
  // The server.
  server: Vec2;
  serverPath: Vec2[] = [];
  serverSeq = 0;
  serverSpeedMult = 1;
  /** The server holds a lock (a move or a stop it applies ends it; `lockNow` and `target` start it). */
  serverLocked = false;
  private serverTime = 0;
  private inbox: Array<{ at: number; kind: "move" | "stop" | "chase"; seq: number; to?: Vec2 }> = [];
  private patches: Array<{ at: number; x: number; y: number; t: number; moveSeq: number; locked: boolean }> = [];
  // The client.
  private seq = 0;
  private lastFrame = 0;
  input: FrameInput = { ...ALIVE };
  /** Every drawn position, one per frame. */
  readonly drawnLog: Vec2[] = [];
  readonly offsetLog: number[] = [];
  /** Server tick stamps at which a patch was sent. */
  patchCount = 0;

  constructor(o: Options = {}) {
    this.map = o.map ?? arena();
    this.up = o.up ?? 40;
    this.down = o.down ?? 40;
    this.jitter = o.jitter ?? 0;
    this.server = { ...(o.start ?? centre(10, 10)) };
    // The first patch, as the join delivers it.
    this.motion.observe({ x: this.server.x, y: this.server.y, t: 0, moveSeq: 0 }, this.clock);
    this.frame();
  }

  /** The client clock: what the patches stamped now arrived with. */
  get clock(): number { return this.now - this.down; }

  private delay(base: number): number { return base + Math.floor(this.rnd() * (this.jitter + 1)); }

  /** The player right-clicks `to`. */
  /** The player right-clicks `to`. `lost`: the message never reaches the server (sent while the connection was down). */
  move(to: Vec2, lost = false): void {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.order("move", seq, this.clock, to, this.map);
    if (!lost) this.inbox.push({ at: this.now + this.delay(this.up), kind: "move", seq, to });
  }

  /**
   * The player clicks a fighter: the prediction stops predicting the walk it interrupts at once; the server starts its chase to `to`
   * when the order reaches it, and the client only learns of it in a patch. `refused`: the server never takes it.
   */
  target(to: Vec2, refused = false): void {
    this.motion.expectLock(this.clock);
    if (!refused) this.inbox.push({ at: this.now + this.delay(this.up), kind: "chase", seq: 0, to });
  }

  /** The server has locked a fighter this instant: it chases to `to` and its patches say so. */
  lockNow(to: Vec2): void {
    this.serverPath = findPath(this.map, this.server, to, PLAYER_RADIUS);
    this.serverLocked = true;
  }

  stop(): void {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.order("stop", seq, this.clock, undefined, this.map);
    this.inbox.push({ at: this.now + this.delay(this.up), kind: "stop", seq });
  }

  /** One client frame at the current time. */
  frame(): void {
    const dt = this.lastFrame === 0 && this.drawnLog.length === 0 ? FRAME_MS : this.now - this.lastFrame;
    this.lastFrame = this.now;
    this.motion.frame(this.clock, dt, this.input);
    this.drawnLog.push({ x: this.motion.drawn.x, y: this.motion.drawn.y });
    this.offsetLog.push(this.motion.visualOffset);
  }

  run(ms: number): void {
    const end = this.now + ms;
    let nextFrame = this.lastFrame + FRAME_MS;
    while (this.now < end) {
      this.now++;
      if (this.now % TICK_MS === 0) this.tick();
      this.patches = this.patches.filter((p) => {
        if (p.at > this.now) return true;
        this.motion.observe({ x: p.x, y: p.y, t: p.t, moveSeq: p.moveSeq, locked: p.locked }, this.clock);
        return false;
      });
      if (this.now >= nextFrame) {
        this.frame();
        nextFrame += FRAME_MS;
      }
    }
  }

  private tick(): void {
    this.serverTime += TICK_MS;
    const arrived = this.inbox.filter((m) => m.at <= this.now);
    this.inbox = this.inbox.filter((m) => m.at > this.now);
    const last = arrived[arrived.length - 1];
    if (last) {
      if (last.kind === "stop") this.serverPath = [];
      else {
        // A move, or a lock's chase (which is not a move order: it carries no seq, so moveSeq stays).
        const path = findPath(this.map, this.server, last.to!, PLAYER_RADIUS);
        if (path.length > 0) this.serverPath = path;
      }
      this.serverLocked = last.kind === "chase";
      if (last.kind !== "chase") this.serverSeq = last.seq;
    }
    let budget = (PLAYER_SPEED * this.serverSpeedMult * TICK_MS) / 1000;
    while (budget > 0 && this.serverPath.length > 0) {
      const t = this.serverPath[0]!;
      const d = dist(this.server, t);
      if (d <= budget) { this.server = { ...t }; budget -= d; this.serverPath.shift(); }
      else {
        this.server.x += ((t.x - this.server.x) / d) * budget;
        this.server.y += ((t.y - this.server.y) / d) * budget;
        budget = 0;
      }
    }
    this.patchCount++;
    this.patches.push({ at: this.now + this.delay(this.down), x: this.server.x, y: this.server.y, t: this.serverTime, moveSeq: this.serverSeq, locked: this.serverLocked });
  }

  /** Largest distance between two consecutive drawn positions. */
  maxStep(from = 0): number {
    let m = 0;
    for (let i = Math.max(1, from); i < this.drawnLog.length; i++) m = Math.max(m, dist(this.drawnLog[i]!, this.drawnLog[i - 1]!));
    return m;
  }
}

describe("a move", () => {
  it("walks at once along the A* path: the first frame after the order has moved", () => {
    const r = new Rig();
    r.run(300);
    const before = { ...r.motion.drawn };
    const to = centre(30, 10);
    r.move(to);
    r.run(FRAME_MS + 1); // one frame, long before the server has heard
    expect(dist(r.motion.drawn, before)).toBeGreaterThan(1);
    expect(r.motion.drawn.x).toBeGreaterThan(before.x);
    expect(r.motion.drawn.y).toBeCloseTo(before.y, 6);
    expect(r.motion.mode).toBe("predict");
    expect(r.motion.pendingOrders).toBe(1);
  });

  it("follows the same path the server plans around a wall, at PLAYER_SPEED", () => {
    const wall = Array.from({ length: 14 }, (_, i): [number, number] => [20, 3 + i]);
    const r = new Rig({ map: arena(wall) });
    r.run(200);
    const to = centre(30, 10);
    const path = findPath(r.map, r.server, to, PLAYER_RADIUS);
    expect(path.length).toBeGreaterThan(1); // it has to go round
    r.move(to);
    r.run(500);
    // Half a second at 170 u/s along the polyline from where it started.
    let left = PLAYER_SPEED * 0.5;
    let at = centre(10, 10);
    for (const p of path) {
      const d = dist(at, p);
      if (d >= left) { at = { x: at.x + ((p.x - at.x) / d) * left, y: at.y + ((p.y - at.y) / d) * left }; left = 0; break; }
      left -= d;
      at = p;
    }
    // (frame times are not exactly 500 ms: a frame's worth of walking at most)
    expect(dist(r.motion.predicted, at)).toBeLessThan(PLAYER_SPEED * (FRAME_MS / 1000) * 2 + 2);
  });

  it("to a point it cannot reach changes nothing", () => {
    const wall = [...Array.from({ length: 5 }, (_, i): [number, number] => [40 + i, 5]), ...Array.from({ length: 5 }, (_, i): [number, number] => [40 + i, 9]),
      ...Array.from({ length: 3 }, (_, i): [number, number] => [40, 6 + i]), ...Array.from({ length: 3 }, (_, i): [number, number] => [44, 6 + i])];
    const r = new Rig({ map: arena(wall) });
    r.run(300);
    const inside = centre(42, 7); // walled in
    expect(findPath(r.map, r.server, inside, PLAYER_RADIUS)).toEqual([]);
    const before = { ...r.motion.drawn };
    r.move(inside);
    r.run(200);
    expect(r.motion.drawn).toEqual(before);
    expect(r.motion.walking).toBe(false);
    expect(r.motion.mode).toBe("predict");
  });

  it("an unreachable click while walking keeps the walk going, as the server does", () => {
    const wall = [...Array.from({ length: 5 }, (_, i): [number, number] => [40 + i, 5]), ...Array.from({ length: 5 }, (_, i): [number, number] => [40 + i, 9]),
      ...Array.from({ length: 3 }, (_, i): [number, number] => [40, 6 + i]), ...Array.from({ length: 3 }, (_, i): [number, number] => [44, 6 + i])];
    const r = new Rig({ map: arena(wall) });
    r.run(100);
    r.move(centre(30, 10));
    r.run(200);
    r.move(centre(42, 7));
    const x = r.motion.drawn.x;
    r.run(200);
    expect(r.motion.drawn.x).toBeGreaterThan(x + 20);
  });

  it("a stop halts the walk at once, before the server has heard of it", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(100);
    r.move(centre(40, 10));
    r.run(300);
    r.stop();
    r.run(FRAME_MS + 1);
    const at = { ...r.motion.predicted };
    expect(r.motion.walking).toBe(false);
    expect(r.motion.facing()).toBeNull();
    r.run(100); // the stop reaches the server in 60 ms, its patch is back after 120
    expect(r.motion.predicted).toEqual(at);
    expect(dist(r.motion.drawn, at)).toBeLessThan(2); // only what an earlier correction still has to run out
    // Later it settles on the server's own stopping point (within a tick of walking of the predicted one).
    r.run(1500);
    expect(dist(r.motion.drawn, at)).toBeLessThan(PLAYER_SPEED * (TICK_MS / 1000) + 0.1);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
  });

  it("is drawn at the server's resting position once both have stopped (a walk to a point and a stop in the middle)", () => {
    for (const [up, down] of [[2, 2], [40, 40], [90, 60]] as const) {
      const r = new Rig({ up, down });
      r.run(100);
      r.move(centre(40, 12));
      r.run(600);
      r.stop();
      r.run(1200);
      expect(dist(r.motion.drawn, r.server), `${up}/${down}`).toBeLessThan(0.2);
      expect(r.motion.visualOffset).toBeLessThan(0.2);
      r.move(centre(20, 6));
      r.run(4000); // arrives
      expect(dist(r.motion.drawn, r.server), `${up}/${down} arrive`).toBeLessThan(0.2);
      expect(dist(r.server, centre(20, 6))).toBeLessThan(0.5);
    }
  });
});

describe("acknowledging orders", () => {
  it("the patch that first shows a seq gives the order's delay and moves the estimate", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(200);
    expect(r.motion.delay).toBe(TICK_MS); // nothing measured yet
    r.move(centre(30, 10));
    expect(r.motion.pendingOrders).toBe(1);
    r.run(600);
    expect(r.motion.pendingOrders).toBe(0);
    // Round trip 120 ms plus 0..50 ms to the next tick, minus the tick the server walks in the tick it applies the order.
    expect(r.motion.delay).toBeGreaterThanOrEqual(120 - TICK_MS - 1);
    expect(r.motion.delay).toBeLessThanOrEqual(120 + 1);
  });

  it("follows later measurements smoothly, and ignores a seq it does not know", () => {
    const r = new Rig({ up: 20, down: 20 });
    r.run(200);
    r.move(centre(30, 10));
    r.run(400);
    const first = r.motion.delay;
    r.motion.ack(200, 1e6); // a stranger's
    r.motion.ack(0, 1e6);
    expect(r.motion.delay).toBe(first);
    // Latency jumps to 100 ms each way: the estimate heads there but does not jump.
    const slow = new Rig({ up: 20, down: 20 });
    slow.run(200);
    slow.move(centre(30, 10));
    slow.run(400);
    const d0 = slow.motion.delay;
    expect(d0).toBeLessThan(60);
    // Measured by hand: an order at clock c applied in the tick stamped t.
    slow.motion.order("stop", 77, 1000, undefined, slow.map);
    slow.motion.ack(77, 1000 + 300);
    expect(slow.motion.delay).toBeGreaterThan(d0);
    expect(slow.motion.delay).toBeLessThan(300 - TICK_MS);
  });

  it("a move that is acknowledged at once does not hold back the next patches", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(100);
    r.move(centre(40, 10));
    r.run(200);
    expect(r.motion.pendingOrders).toBe(0);
  });

  it("two orders that reach one tick: the earlier counts as applied too", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(100);
    r.move(centre(40, 10));
    r.move(centre(40, 14));
    r.run(300);
    expect(r.motion.pendingOrders).toBe(0);
  });
});

describe("reconciling with the server", () => {
  it("absorbs a constant server lag without a visible jump, and the drawn position stays on the walk", () => {
    for (const [up, down] of [[2, 2], [40, 40], [80, 80], [150, 100]] as const) {
      const r = new Rig({ up, down });
      r.run(200);
      r.move(centre(50, 10));
      const from = r.drawnLog.length;
      r.run(2000);
      const step = PLAYER_SPEED * (FRAME_MS / 1000);
      // Never faster than a walk plus the catch-up allowance, never a frame's worth of jump.
      expect(r.maxStep(from), `${up}/${down}`).toBeLessThanOrEqual(step + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.01);
      // And the offset it kept for the server's lag is gone within a moment of the walk (nothing left to correct).
      expect(r.motion.visualOffset, `${up}/${down}`).toBeLessThan(0.5);
      // It stays ahead of the server by about the delay, never behind it.
      const lead = dist(r.motion.drawn, r.server);
      expect(lead, `${up}/${down}`).toBeLessThanOrEqual(PLAYER_SPEED * ((up + down + TICK_MS) / 1000) + 4);
    }
  });

  it("keeps the prediction smooth over a long walk with latency jitter", () => {
    const r = new Rig({ up: 30, down: 30, jitter: 30 });
    r.run(200);
    r.move(centre(30, 10));
    const from = r.drawnLog.length;
    r.run(3000);

    const step = PLAYER_SPEED * (FRAME_MS / 1000);
    expect(r.maxStep(from)).toBeLessThanOrEqual(step + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.01);
    expect(Math.max(...r.offsetLog)).toBeLessThan(10);
    r.run(1500);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.3);
  });

  it("holding the right button re-sends the walk every 100 ms in a slowly changing direction without wobble", () => {
    const r = new Rig({ up: 35, down: 35, jitter: 25 });
    r.run(200);
    let maxOffset = 0;
    const from = r.drawnLog.length;
    for (let i = 0; i < 25; i++) {
      r.move({ x: centre(48, 10).x, y: centre(0, 10).y + 150 + i * 6 });
      r.run(100);
      maxOffset = Math.max(maxOffset, ...r.offsetLog.slice(-6));
    }
    const step = PLAYER_SPEED * (FRAME_MS / 1000);
    expect(r.maxStep(from)).toBeLessThanOrEqual(step + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.01);
    expect(maxOffset).toBeLessThan(12);
    // No frame goes backwards against the walk (the walk heads +x).
    for (let i = from + 1; i < r.drawnLog.length; i++) expect(r.drawnLog[i]!.x).toBeGreaterThanOrEqual(r.drawnLog[i - 1]!.x - 1e-6);
  });

  it("turning while walking turns the prediction on the spot and the server follows one delay later", () => {
    const r = new Rig({ up: 50, down: 50 });
    r.run(200);
    r.move(centre(50, 10));
    r.run(600);
    r.move(centre(30, 25));
    const at = { ...r.motion.drawn };
    r.run(FRAME_MS * 3);
    // Within three frames it has already turned south.
    expect(r.motion.drawn.y - at.y).toBeGreaterThan(3);
    const from = r.drawnLog.length;
    r.run(2500);
    expect(r.maxStep(from - 4)).toBeLessThanOrEqual(PLAYER_SPEED * (FRAME_MS / 1000) + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.01);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.3);
  });

  it("a server that walks at another speed than the client expected is followed, in small corrections", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(200);
    r.serverSpeedMult = 0.7; // a chill the client did not know of
    r.move(centre(50, 10));
    r.run(1500);
    // The error grows 0.3 x 170 u/s; each patch corrects what it can: the drawn position stays within a snap of the server.
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(SNAP_DISTANCE + 40);
    r.stop();
    r.run(1500);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.3);
  });

  it("walking at the multiplier it is told matches a server with the same one", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.serverSpeedMult = 0.7;
    r.input = { ...ALIVE, speedMult: 0.7 };
    r.run(200);
    r.move(centre(50, 10));
    r.run(1500);
    expect(Math.max(...r.offsetLog)).toBeLessThan(1);
    expect(Math.abs(r.motion.drawn.x - centre(10, 10).x - PLAYER_SPEED * 0.7 * 1.5)).toBeLessThan(PLAYER_SPEED * 0.7 * 0.12);
  });

  it("does not move while the client knows the fighter is rooted, and walks on when the root ends", () => {
    const r = new Rig();
    r.run(200);
    r.input = { ...ALIVE, rooted: true };
    r.serverSpeedMult = 0; // the same root, on the server
    r.move(centre(40, 10));
    const at = { ...r.motion.drawn };
    r.run(300);
    expect(dist(r.motion.drawn, at)).toBeLessThan(1e-9);
    r.input = { ...ALIVE };
    r.serverSpeedMult = 1;
    r.run(100);
    expect(dist(r.motion.drawn, at)).toBeGreaterThan(5);
  });

  it("a root it did not know of is paid back in small corrections: the drawn position stays with the server", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(200);
    r.move(centre(50, 10));
    r.run(300);
    r.serverSpeedMult = 0; // the server roots the fighter (an attack the client had not heard of)
    r.run(300);
    r.serverSpeedMult = 1;
    r.run(300);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(SNAP_DISTANCE);
    expect(r.maxStep(r.drawnLog.length - 60)).toBeLessThanOrEqual(PLAYER_SPEED * (FRAME_MS / 1000) + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.01);
  });

  it("snaps to the server when the two are far apart (a teleport) and forgets the walk", () => {
    const r = new Rig();
    r.run(200);
    r.move(centre(50, 10));
    r.run(300);
    // The server puts the fighter 300 u away (coliseum teleport).
    r.motion.observe({ x: 1500, y: 800, t: 99999, moveSeq: 0 }, r.clock);
    r.frame();
    expect(r.motion.drawn).toEqual({ x: 1500, y: 800 });
    expect(r.motion.visualOffset).toBe(0);
    expect(r.motion.walking).toBe(false);
    r.run(200);
    expect(r.motion.drawn).toEqual({ x: 1500, y: 800 });
  });

  it("snaps when the divergence is beyond SNAP_DISTANCE but below a teleport", () => {
    const r = new Rig();
    r.run(300);
    const s = r.server;
    r.motion.observe({ x: s.x + SNAP_DISTANCE + 20, y: s.y, t: 5000, moveSeq: 0 }, r.clock);
    r.frame();
    expect(dist(r.motion.drawn, { x: s.x + SNAP_DISTANCE + 20, y: s.y })).toBeLessThan(1e-9);
  });

  it("ignores errors under the dead zone while moving", () => {
    expect(REBASE_DEADZONE).toBeGreaterThan(0);
    const r = new Rig();
    r.run(300);
    r.move(centre(50, 10));
    r.run(1000);
    const off = r.motion.visualOffset;
    expect(off).toBeLessThan(REBASE_DEADZONE + 1);
  });

  it("an old or repeated sample changes nothing", () => {
    const r = new Rig();
    r.run(300);
    const drawn = { ...r.motion.drawn };
    r.motion.observe({ x: 5, y: 5, t: 10, moveSeq: 0 }, r.clock);
    r.frame();
    expect(r.motion.drawn).toEqual(drawn);
  });
});

describe("long random play", () => {
  /** Clicks, stops and targets at random for 25 orders, then stops: what the player would see throughout. */
  function play(seed: number, o: Options): Rig {
    const rnd = mulberry32(seed);
    const r = new Rig(o);
    r.run(300);
    for (let i = 0; i < 25; i++) {
      const roll = rnd();
      if (roll < 0.7) r.move({ x: 100 + rnd() * (W * TILE - 200), y: 100 + rnd() * (H * TILE - 200) });
      else if (roll < 0.85) r.stop();
      else {
        // A lock: the server chases on its own for a while, then the player walks off again.
        r.target({ x: 100 + rnd() * (W * TILE - 200), y: 100 + rnd() * (H * TILE - 200) });
      }
      r.run(150 + rnd() * 700);
    }
    r.stop();
    r.run(2500);
    return r;
  }

  it.each([
    { up: 2, down: 2 }, { up: 30, down: 30, jitter: 10 }, { up: 60, down: 60, jitter: 30 }, { up: 120, down: 100, jitter: 60 },
  ])("never jumps, never snaps and ends where the server is, at %o", (o) => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = play(seed, o);
      const tag = `${JSON.stringify(o)} seed ${seed}`;
      // The largest frame-to-frame move is a walk plus the most a correction may add: no frame is a jump.
      expect(r.maxStep(), tag).toBeLessThanOrEqual(PLAYER_SPEED * (FRAME_MS / 1000) + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.1);
      // The drawn position stays within a few delays' walk of the model: the worst is a lock, then a walk away, then another (the
      // lead is given up at the first and taken again at the second); most orders leave a few units.
      const rtt = (o.up + o.down) / 1000;
      expect(Math.max(...r.offsetLog), tag).toBeLessThan(3 * PLAYER_SPEED * rtt + 25);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
    }
  });

  it("an offset nearly always lasts well under a second, whatever the orders", () => {
    const r = play(3, { up: 60, down: 60, jitter: 30 });
    const long = r.offsetLog.filter((o) => o > 8).length;
    expect(long / r.offsetLog.length).toBeLessThan(0.1); // frames spent more than 8 u from the model
  });
});

describe("staying honest when the server does something the client did not order", () => {
  /** A fresh model standing at (x, y) with the server's first sample at server time 0 (client clock 0). */
  function standing(x: number, y: number, map = arena()): LocalMotion {
    const m = new LocalMotion();
    m.observe({ x, y, t: 0, moveSeq: 0 }, 0);
    m.frame(0, FRAME_MS, ALIVE);
    return m;
  }

  it("an order the server never applies is forgotten, and the walk it started is brought back to the server", () => {
    for (const [up, down] of [[40, 40], [90, 60]] as const) {
      const r = new Rig({ up, down });
      r.run(300);
      r.move(centre(50, 10), true); // sent while the connection was down: lost
      expect(r.motion.pendingOrders).toBe(1);
      r.run(ORDER_EXPIRE_MS + 100);
      expect(r.motion.pendingOrders, `${up}/${down}`).toBe(0);
      r.run(3000);
      // The server never moved; the model does not either, and the drawn fighter is where the server has it.
      expect(dist(r.server, centre(10, 10)), `${up}/${down}`).toBeLessThan(1e-6);
      expect(dist(r.motion.drawn, r.server), `${up}/${down}`).toBeLessThan(0.5);
      expect(r.motion.walking).toBe(false);
      // And never far from it on the way: nothing like the 600 u an unexpired order let it wander.
      expect(Math.max(...r.drawnLog.map((p) => dist(p, r.server))), `${up}/${down}`).toBeLessThan(VISUAL_SNAP_DISTANCE);
    }
  });

  it("a lost order does not hold back the reconciliation of the ones after it", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.move(centre(50, 10), true);
    r.run(100);
    r.move(centre(10, 20)); // the next one gets through
    r.run(2500);
    expect(r.motion.pendingOrders).toBe(0);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.5);
    expect(dist(r.server, centre(10, 20))).toBeLessThan(0.5);
  });

  it("an order pending longer than the delay explains is given up on, sooner at a short delay", () => {
    const m = standing(300, 300);
    m.order("move", 1, 100, { x: 900, y: 300 }, arena());
    m.frame(100 + 300, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(1); // 300 ms: not yet (the floor is 350 ms)
    m.frame(100 + 400, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(0);
    m.order("move", 2, 1000, { x: 900, y: 300 }, arena());
    m.observe({ x: 300, y: 300, t: 50, moveSeq: 0 }, 1000 + ORDER_EXPIRE_MS + 10);
    expect(m.pendingOrders).toBe(0);
  });

  it("the server stopping the fighter with no order (a revive, a halt) does not make the drawn fighter run away from it", () => {
    for (const [up, down] of [[40, 40], [100, 80]] as const) {
      const r = new Rig({ up, down });
      r.run(300);
      r.move(centre(50, 10));
      r.run(900);
      expect(r.motion.walking).toBe(true);
      r.serverPath = []; // the server halts it
      const from = r.drawnLog.length;
      r.run(4000);
      const tag = `${up}/${down}`;
      expect(r.motion.walking, tag).toBe(false);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.5);
      expect(Math.max(...r.offsetLog.slice(from)), tag).toBeLessThan(VISUAL_SNAP_DISTANCE);
      // It overshoots by a few samples' walk at most, never the 100+ u an unbounded drift gave.
      expect(Math.max(...r.drawnLog.slice(from).map((p) => dist(p, r.server))), tag).toBeLessThan(PLAYER_SPEED * ((up + down + 300) / 1000));
    }
  });

  it("a walk the server is walking is not taken for a stall, however long", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    r.move(centre(55, 10));
    r.run(4000);
    expect(r.motion.walking).toBe(true);
    expect(r.motion.visualOffset).toBeLessThan(1);
  });

  it("a server that walks off on its own is followed in bounds: the offset never reaches the snap limit unnoticed", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(300);
    r.move(centre(55, 10));
    r.run(400);
    // From here the server walks the other way (a halt and a new walk the client did not order).
    r.serverPath = findPath(r.map, r.server, centre(10, 25), PLAYER_RADIUS);
    r.run(3000);
    expect(Math.max(...r.offsetLog)).toBeLessThanOrEqual(VISUAL_SNAP_DISTANCE + 1);
    expect(r.maxStep()).toBeLessThan(PLAYER_SPEED * (FRAME_MS / 1000) + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.1 + SNAP_DISTANCE);
    r.serverPath = [];
    r.run(3000);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.5);
  });

  it("a speed the client has no idea of (the server crawling at a tenth) cannot leave the drawn fighter running ahead of it for good", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(300);
    r.serverSpeedMult = 0.1; // a slow the client was not told of, and the model walks the same way
    r.move(centre(55, 10));
    r.run(9000);
    // Corrections slow the drawn walk, but not enough: the offset reaches its limit and the fighter is brought back to the server.
    expect(Math.max(...r.offsetLog)).toBeLessThanOrEqual(VISUAL_SNAP_DISTANCE + 1);
    expect(Math.max(...r.drawnLog.map((p) => dist(p, r.server)))).toBeLessThan(VISUAL_SNAP_DISTANCE + 60);
  });

  it("an error past SNAP_DISTANCE snaps even with an order still on its way, and plans the walk again from there", () => {
    const m = standing(300, 300);
    const map = arena();
    m.order("move", 1, 10, { x: 900, y: 300 }, map);
    for (let i = 1; i <= 6; i++) m.frame(10 + i * 16, 16, ALIVE);
    expect(m.pendingOrders).toBe(1);
    // A sample 150 u off the line, the order not applied (moveSeq 0): not an order's doing.
    m.observe({ x: 320, y: 450, t: 100, moveSeq: 0 }, 110);
    m.frame(126, 16, ALIVE);
    expect(dist(m.predicted, { x: 320, y: 450 })).toBeLessThan(4);
    expect(m.visualOffset).toBe(0);
    expect(m.pendingOrders).toBe(0);
    // It walks on toward where it was going, from where the server has it.
    expect(m.walking).toBe(true);
    const x = m.drawn.x;
    for (let i = 1; i <= 10; i++) m.frame(126 + i * 16, 16, ALIVE);
    expect(m.drawn.x).toBeGreaterThan(x + 10);
    for (let i = 1; i <= 300; i++) m.frame(300 + i * 16, 16, ALIVE);
    expect(dist(m.predicted, { x: 900, y: 300 })).toBeLessThan(1);
  });

  it("a snap that is not a reconciliation (a teleport, a death) stands still instead", () => {
    const m = standing(300, 300);
    m.order("move", 1, 10, { x: 900, y: 300 }, arena());
    m.frame(30, 16, ALIVE);
    m.observe({ x: 1500, y: 800, t: 100, moveSeq: 0 }, 110); // a jump past TELEPORT_DISTANCE
    m.frame(126, 16, ALIVE);
    expect(m.walking).toBe(false);
    expect(m.drawn).toEqual({ x: 1500, y: 800 });
  });

  it("a cut (the teleport's fx, a training revive) makes the next sample snap however short the jump, and forgets the walk", () => {
    // Without a cut a 40 u error is an ordinary correction: the drawn fighter eases to the server.
    const control = standing(300, 300);
    control.observe({ x: 340, y: 300, t: 100, moveSeq: 0 }, 110);
    control.frame(126, 16, ALIVE);
    expect(control.visualOffset).toBeGreaterThan(5);

    const m = standing(300, 300);
    m.order("move", 1, 10, { x: 900, y: 300 }, arena());
    m.frame(30, 16, ALIVE);
    expect(m.walking).toBe(true);
    m.cut(100);
    expect(m.pendingOrders).toBe(0);
    expect(m.walking).toBe(false);
    m.observe({ x: 325, y: 300, t: 50, moveSeq: 0 }, 60); // before the cut: an ordinary correction
    expect(m.visualOffset).toBeGreaterThan(5);
    m.observe({ x: 340, y: 300, t: 100, moveSeq: 0 }, 110);
    m.frame(126, 16, ALIVE);
    expect(m.drawn).toEqual({ x: 340, y: 300 });
    expect(m.visualOffset).toBe(0);
    expect(m.walking).toBe(false);
    // One cut, one snap: the next ordinary sample is ordinary again.
    m.observe({ x: 360, y: 300, t: 200, moveSeq: 0 }, 210);
    m.frame(226, 16, ALIVE);
    expect(m.visualOffset).toBeGreaterThan(5);
    m.order("move", 2, 230, { x: 900, y: 300 }, arena());
    m.frame(250, 16, ALIVE);
    expect(m.walking).toBe(true);
  });
});

describe("the click is clamped to the world, as the server's parsePoint clamps it", () => {
  /** A full-size open arena: the world's rectangle, walled on its border. */
  function worldArena(): GameMap {
    const w = WORLD_W / TILE, h = WORLD_H / TILE;
    const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
    for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
    for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
    return mapFromTiles(w, h, tiles);
  }

  it("clampToWorld is parsePoint's clamp", () => {
    expect(clampToWorld({ x: -500, y: 300 })).toEqual({ x: 0, y: 300 });
    expect(clampToWorld({ x: WORLD_W + 5, y: WORLD_H + 9e9 })).toEqual({ x: WORLD_W, y: WORLD_H });
    expect(clampToWorld({ x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });

  it("an edge click plans to the clamped point, the same walk the server plans", () => {
    const map = worldArena();
    const from = centre(2, 6);
    for (const click of [{ x: from.x - 500, y: from.y + 300 }, { x: WORLD_W + 400, y: 600 }, { x: 900, y: -700 }]) {
      const m = new LocalMotion();
      m.observe({ x: from.x, y: from.y, t: 0, moveSeq: 0 }, 0);
      m.frame(0, FRAME_MS, ALIVE);
      m.order("move", 1, 0, click, map);
      const serverPath = findPath(map, from, clampToWorld(click), PLAYER_RADIUS);
      expect(serverPath.length).toBeGreaterThan(0);
      for (let i = 1; i <= 2000 && m.walking !== false || i === 1; i++) m.frame(i * 16, 16, ALIVE);
      expect(dist(m.predicted, serverPath[serverPath.length - 1]!), JSON.stringify(click)).toBeLessThan(1);
    }
  });
});

describe("the lock: the server's word, with the click's hope", () => {
  const lockedSample = (x: number, t: number, moveSeq: number, locked: boolean) => ({ x, y: 300, t, moveSeq, locked });

  it("a lock the patches show puts the model in follow, and the lock ending takes it out", () => {
    const m = new LocalMotion();
    m.observe(lockedSample(300, 0, 0, false), 0);
    m.frame(0, FRAME_MS, ALIVE);
    expect(m.mode).toBe("predict");
    m.observe(lockedSample(308, 50, 0, true), 50);
    expect(m.mode).toBe("follow");
    m.observe(lockedSample(316, 100, 0, true), 100);
    expect(m.mode).toBe("follow");
    m.observe(lockedSample(316, 150, 0, false), 150);
    expect(m.mode).toBe("predict");
    m.frame(160, FRAME_MS, ALIVE);
    expect(m.walking).toBe(false);
  });

  it("not while a move or stop of ours is still on its way: that order ends the lock the patch shows", () => {
    const m = new LocalMotion();
    m.observe(lockedSample(300, 0, 0, false), 0);
    m.frame(0, FRAME_MS, ALIVE);
    m.order("move", 1, 10, { x: 900, y: 300 }, arena());
    m.observe(lockedSample(308, 50, 0, true), 60); // the lock was applied first; the move is still in flight
    expect(m.mode).toBe("predict");
    expect(m.pendingOrders).toBe(1);
    m.observe(lockedSample(316, 100, 1, false), 110); // the move applied: the lock is gone
    expect(m.mode).toBe("predict");
    expect(m.pendingOrders).toBe(0);
  });

  it("a move after the click leaves follow at once, and a lock still showing in the patches before it applies does not bring it back", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    r.target(centre(50, 10));
    expect(r.motion.mode).toBe("follow");
    r.run(400);
    expect(r.motion.mode).toBe("follow");
    r.move(centre(5, 10));
    expect(r.motion.mode).toBe("predict");
    r.run(300); // the patches still say locked for a while
    expect(r.motion.mode).toBe("predict");
    r.run(2500);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.5);
  });

  it("a click the server refuses: the walk it interrupted is taken up again, and the fighter stays with the server", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.move(centre(50, 10));
    r.run(500);
    r.target(centre(30, 25), true); // refused: no lock ever shows, the server walks on
    expect(r.motion.mode).toBe("follow");
    r.run(ORDER_EXPIRE_MS + 200);
    expect(r.motion.mode).toBe("predict");
    expect(r.motion.walking).toBe(true); // predicting the old walk again
    r.run(300);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(PLAYER_SPEED * 0.25);
    r.run(6000);
    expect(dist(r.server, centre(50, 10))).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.5);
  });

  it("a lock the patch shows within the hope window confirms it: follow stays after the window", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.target(centre(40, 10));
    r.run(ORDER_EXPIRE_MS + 400);
    expect(r.motion.mode).toBe("follow");
  });

  it("a first sample that already shows a lock starts in follow", () => {
    const m = new LocalMotion();
    m.observe(lockedSample(300, 0, 0, true), 0);
    m.frame(0, FRAME_MS, ALIVE);
    expect(m.mode).toBe("follow");
  });
});

describe("not alive", () => {
  it("a dead fighter, or one in the lobby, is drawn where the server has it and its walk is dropped", () => {
    const r = new Rig();
    r.run(200);
    r.move(centre(50, 10));
    r.run(300);
    r.input = { ...ALIVE, alive: false };
    r.run(100);
    const s = r.server;
    // The last patch seen is a little behind the server: the drawn position is that sample.
    expect(r.motion.drawn.x).toBeLessThanOrEqual(s.x + 1e-6);
    expect(r.motion.drawn.x).toBeGreaterThan(centre(10, 10).x);
    expect(r.motion.walking).toBe(false);
    expect(r.motion.pendingOrders).toBe(0);
    expect(r.motion.visualOffset).toBe(0);
    // Back on its feet (training revives in place): standing where the server has it.
    r.serverPath = [];
    r.input = { ...ALIVE };
    r.run(1000);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.3);
    expect(r.motion.visualOffset).toBeLessThan(0.3);
  });

  it("is not ready before the first sample, and draws nothing until then", () => {
    const m = new LocalMotion();
    expect(m.ready).toBe(false);
    m.frame(100, 16, ALIVE);
    m.order("move", 1, 100, { x: 100, y: 100 }, arena());
    expect(m.ready).toBe(false);
    expect(m.drawn).toEqual({ x: 0, y: 0 });
    m.observe({ x: 50, y: 60, t: 100, moveSeq: 0 }, 100);
    expect(m.ready).toBe(true);
    m.frame(110, 16, ALIVE);
    expect(m.drawn).toEqual({ x: 50, y: 60 });
  });
});

describe("a lock (follow)", () => {
  /** The server chases on its own, as the lock does, and says so in its patches. */
  const chase = (r: Rig, to: Vec2): void => r.lockNow(to);

  it("draws the newest server sample carried on by its velocity, with no lead of its own", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(200);
    expect(r.motion.mode).toBe("predict");
    chase(r, centre(40, 10));
    r.run(1000);
    expect(r.motion.mode).toBe("follow");
    // The drawn position is within a patch of walking of the latest sample the client has seen, never ahead of the server.
    const seen = r.server.x - PLAYER_SPEED * ((r.down + TICK_MS) / 1000);
    expect(r.motion.drawn.x).toBeGreaterThan(seen - 2);
    expect(r.motion.drawn.x).toBeLessThanOrEqual(r.server.x + 1e-6);
    // And smooth: steps stay near the walk.
    expect(r.maxStep(r.drawnLog.length - 40)).toBeLessThanOrEqual(PLAYER_SPEED * (FRAME_MS / 1000) * 1.5 + 0.5);
  });

  it("does not overshoot the server's stop by more than a tick of walking", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(200);
    chase(r, centre(30, 10));
    r.run(5000); // arrives and rests
    const rest = r.server;
    expect(dist(rest, centre(30, 10))).toBeLessThan(0.5);
    expect(Math.max(...r.drawnLog.map((p) => p.x))).toBeLessThanOrEqual(rest.x + PLAYER_SPEED * (TICK_MS / 1000) + 0.01);
    expect(dist(r.motion.drawn, rest)).toBeLessThan(0.3);
  });

  it("from a walk: the lead is given up smoothly (slower, never backwards), then the drawn position is the server's", () => {
    const r = new Rig({ up: 80, down: 80 });
    r.run(200);
    r.move(centre(55, 10));
    r.run(800);
    const from = r.drawnLog.length;
    const beforeX = r.motion.drawn.x;
    chase(r, centre(55, 10));
    r.run(600);
    for (let i = from; i < r.drawnLog.length; i++) expect(r.drawnLog[i]!.x).toBeGreaterThanOrEqual(r.drawnLog[i - 1]!.x - 1e-6);
    expect(r.motion.drawn.x).toBeGreaterThan(beforeX);
    r.serverPath = [];
    r.run(1500);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.3);
  });

  it("a move after it predicts again from where the server will be, not from the stale sample", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(200);
    chase(r, centre(55, 10));
    r.run(900);
    const x = r.motion.drawn.x;
    r.move(centre(5, 10)); // turn tail
    expect(r.motion.mode).toBe("predict");
    r.run(FRAME_MS * 2);
    // Drawn position is continuous across the order.
    expect(Math.abs(r.motion.drawn.x - x)).toBeLessThan(PLAYER_SPEED * 0.06 + 40);
    const from = r.drawnLog.length;
    r.run(3000);
    expect(r.maxStep(from)).toBeLessThanOrEqual(PLAYER_SPEED * (FRAME_MS / 1000) + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.3);
  });
});

describe("the map used for planning", () => {
  /** A wall across the room with a gap at rows 13-16 that a gate can close. */
  function gated(): { open: GameMap; locked: GameMap } {
    const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
    for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
    for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
    const gateTiles: Array<{ x: number; y: number }> = [];
    for (let y = 1; y < H - 1; y++) {
      if (y >= 13 && y <= 16) gateTiles.push({ x: 30, y });
      else tiles[y * W + 30] = TILE_WALL;
    }
    const open = mapFromTiles(W, H, tiles);
    open.coliseum.gates.push({ side: "w", tiles: gateTiles, x: 30 * TILE + 16, y: 15 * TILE });
    return { open, locked: withGates(open) };
  }

  it("a locked-gates map makes the far side unreachable; the open map walks through the gap", () => {
    const { open, locked } = gated();
    const from = centre(10, 15);
    const beyond = centre(45, 15);
    const a = new LocalMotion();
    a.observe({ x: from.x, y: from.y, t: 0, moveSeq: 0 }, 0);
    a.frame(0, 16, ALIVE);
    a.order("move", 1, 10, beyond, locked);
    a.frame(30, 20, ALIVE);
    expect(a.walking).toBe(false); // behind a closed gate: nothing to walk
    const b = new LocalMotion();
    b.observe({ x: from.x, y: from.y, t: 0, moveSeq: 0 }, 0);
    b.frame(0, 16, ALIVE);
    b.order("move", 1, 10, beyond, open);
    b.frame(30, 20, ALIVE);
    expect(b.walking).toBe(true);
    expect(b.drawn.x).toBeGreaterThan(from.x);
  });
});

describe("facing", () => {
  it("is the direction of the current leg of the predicted path while walking it", () => {
    const wall = Array.from({ length: 14 }, (_, i): [number, number] => [20, 3 + i]);
    const r = new Rig({ map: arena(wall) });
    r.run(200);
    expect(r.motion.facing()).toBeNull(); // standing
    const to = centre(30, 10);
    r.move(to);
    r.run(FRAME_MS * 2);
    const path = findPath(r.map, centre(10, 10), to, PLAYER_RADIUS);
    const a = Math.atan2(path[0]!.y - r.motion.predicted.y, path[0]!.x - r.motion.predicted.x);
    expect(r.motion.facing()).toBeCloseTo(a, 2);
    // Later on the second leg it faces that leg.
    r.run(2500);
    const f = r.motion.facing();
    if (f !== null) expect(Math.abs(f)).toBeLessThan(Math.PI);
  });

  it("changes at once on a right-click in another direction", () => {
    const r = new Rig();
    r.run(200);
    r.move(centre(50, 10));
    r.run(300);
    expect(r.motion.facing()).toBeCloseTo(0, 3);
    r.move(centre(10, 10));
    r.run(FRAME_MS * 2);
    expect(Math.abs(r.motion.facing()!)).toBeCloseTo(Math.PI, 2);
  });

  it("is null while the aim streams, while rooted, in follow mode and after a stop", () => {
    const r = new Rig();
    r.run(200);
    r.move(centre(50, 10));
    r.run(200);
    r.input = { ...ALIVE, aiming: true };
    r.run(50);
    expect(r.motion.facing()).toBeNull();
    r.input = { ...ALIVE, rooted: true };
    r.run(50);
    expect(r.motion.facing()).toBeNull();
    r.input = { ...ALIVE };
    r.run(50);
    expect(r.motion.facing()).not.toBeNull();
    r.stop();
    r.run(50);
    expect(r.motion.facing()).toBeNull();
    r.move(centre(50, 10));
    r.run(400);
    r.lockNow(centre(50, 10));
    r.run(200);
    expect(r.motion.mode).toBe("follow");
    expect(r.motion.facing()).toBeNull();
  });
});

describe("the smoothing offset", () => {
  it("never pushes the fighter backwards however large the correction, and runs out", () => {
    const m = new LocalMotion();
    m.observe({ x: 500, y: 500, t: 0, moveSeq: 0 }, 0);
    m.frame(0, 16, ALIVE);
    m.order("move", 1, 0, { x: 900, y: 500 }, arena());
    let prev = m.drawn.x;
    for (let i = 1; i <= 20; i++) m.frame(i * 16, 16, ALIVE);
    // A rebase pulling the model 40 u back: the drawn x must keep rising.
    m.ack(1, 100);
    m.observe({ x: 500 + 8, y: 500, t: 50, moveSeq: 1 }, 320);
    prev = m.drawn.x;
    for (let i = 21; i <= 80; i++) {
      m.frame(i * 16, 16, ALIVE);
      expect(m.drawn.x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = m.drawn.x;
    }
  });
});

// Client-side prediction of the local fighter (net/localMotion.ts). A small fake server stands in for the room: it ticks every
// TICK_MS, applies the orders that reached it (one per tick, the last wins), walks the player along the same shared A* path
// at PLAYER_SPEED, and sends each tick's patch (position, server time, moveSeq) back after the downlink delay. The client
// clock reads a patch's server time when the patch arrives, as ServerClock does: c = now - downlink.
import { describe, expect, it } from "vitest";
import {
  circleClear, findPath, mapFromTiles, mulberry32, newSlip, PLAYER_RADIUS, PLAYER_SPEED, slipWalk, TELEPORT_DISTANCE, TERRAIN_FENCE, TICK_MS, TILE,
  TILE_FLOOR, TILE_LOW, TILE_WALL, WORLD_H, WORLD_W, withGates, worldToTile,
  type GameMap, type Vec2,
} from "@raid/shared";
import {
  clampToWorld, CORRECT_SPEED_MOVING_MAX, DELAY_MAX_MS, DIVERGE_ERR, DIVERGE_ERR_SLIP, JUMP_ORDER_EXPIRE_MS, LocalMotion, ORDER_EXPIRE_MS,
  REBASE_DEADZONE, SLIP_GRACE_MS, SNAP_DISTANCE, VISUAL_SNAP_DISTANCE, seqAcked, type FrameInput,
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
/** The same room with `low` (tile coordinates) as LOW fence tiles: they stop bodies, and the terrain layer says which kind. */
function fenced(low: ReadonlyArray<readonly [number, number]>): GameMap {
  const base = arena();
  const terrain = new Uint8Array(W * H);
  for (const [x, y] of low) { base.tiles[y * W + x] = TILE_LOW; terrain[y * W + x] = TERRAIN_FENCE; }
  return mapFromTiles(W, H, base.tiles, 0, terrain);
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
  private inbox: Array<{ at: number; kind: "move" | "stop" | "chase" | "blink"; seq: number; to?: Vec2 }> = [];
  private patches: Array<{ at: number; x: number; y: number; t: number; moveSeq: number; locked: boolean; displaceSeq: number }> = [];
  /** `PlayerState.displaceSeq`: +1 (wrapping) whenever the server displaces the fighter. */
  displaceSeq = 0;
  /** The server displaces the fighter on its own at the next tick (a pull): where to. */
  private forced: Vec2 | null = null;
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
    this.motion.observe({ x: this.server.x, y: this.server.y, t: 0, moveSeq: 0, displaceSeq: 0 }, this.clock);
    this.frame();
  }

  /** The client clock: what the patches stamped now arrived with. */
  get clock(): number { return this.now - this.down; }

  private delay(base: number): number { return base + Math.floor(this.rnd() * (this.jitter + 1)); }

  /** The player right-clicks `to`. */
  /** The player right-clicks `to`. `lost`: the message never reaches the server (sent while the connection was down). */
  move(to: Vec2, lost = false, up = this.up): number {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.order("move", seq, this.clock, to, this.map);
    if (!lost) this.inbox.push({ at: this.now + this.delay(up), kind: "move", seq, to });
    return seq;
  }

  /**
   * The player casts a blink: the model jumps to `landing` at once. The server blinks to `serverLanding` (default the same; null:
   * it refuses the cast, which it still echoes in moveSeq) when the order reaches it. `lost`: the message never arrives.
   */
  blink(landing: Vec2, serverLanding: Vec2 | null = landing, lost = false, up = this.up): number {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.blink(seq, this.clock, landing);
    if (!lost) this.inbox.push({ at: this.now + this.delay(up), kind: "blink", seq, ...(serverLanding ? { to: serverLanding } : {}) });
    return seq;
  }

  /** The server moves the fighter by itself at its next tick (a pull, a knock): its patches say so with a new displaceSeq. */
  displace(to: Vec2): void {
    this.forced = to;
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
        this.motion.observe({ x: p.x, y: p.y, t: p.t, moveSeq: p.moveSeq, locked: p.locked, displaceSeq: p.displaceSeq }, this.clock);
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
    // The orders that reached it this tick apply in the order they arrived (a later one replaces what an earlier one set).
    for (const last of arrived) {
      if (last.kind === "stop") this.serverPath = [];
      else if (last.kind === "blink") {
        // The cast drops the walk and the lock, and moves the fighter in this very tick. Refused (no `to`), it changes nothing
        // but the echo: the fighter walks on, and a lock it holds stays.
        if (last.to) {
          this.serverPath = [];
          this.server = { ...last.to };
          this.displaceSeq = (this.displaceSeq + 1) & 255;
        }
      } else {
        // A move, or a lock's chase (which is not a move order: it carries no seq, so moveSeq stays).
        const path = findPath(this.map, this.server, last.to!, PLAYER_RADIUS);
        if (path.length > 0) this.serverPath = path;
      }
      if (last.kind !== "blink" || last.to) this.serverLocked = last.kind === "chase";
      if (last.kind !== "chase") this.serverSeq = last.seq;
    }
    if (this.forced) {
      const end = this.serverPath[this.serverPath.length - 1];
      this.server = { ...this.forced };
      this.displaceSeq = (this.displaceSeq + 1) & 255;
      this.serverPath = end ? findPath(this.map, this.server, end, PLAYER_RADIUS) : [];
      this.forced = null;
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
    this.patches.push({ at: this.now + this.delay(this.down), x: this.server.x, y: this.server.y, t: this.serverTime, moveSeq: this.serverSeq, locked: this.serverLocked, displaceSeq: this.displaceSeq });
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

describe("a move across a LOW fence", () => {
  // A fence at column 20, rows 3..16 (x 640..672); the gap is rows 17..28.
  const fence = Array.from({ length: 14 }, (_, i): [number, number] => [20, 3 + i]);

  it("plans round the end of the fence, as the server does, and never puts the model or the drawn centre on it", () => {
    const map = fenced(fence);
    const r = new Rig({ map });
    r.run(200);
    const to = centre(30, 10);
    expect(findPath(map, r.server, to, PLAYER_RADIUS).length).toBeGreaterThan(1); // the straight hop is not clear: it must go round
    r.move(to);
    let maxY = 0;
    const bad: string[] = [];
    for (let i = 0; i < 600; i++) {
      r.run(FRAME_MS);
      maxY = Math.max(maxY, r.motion.predicted.y);
      if (!circleClear(map, r.motion.predicted, PLAYER_RADIUS)) bad.push(`model ${i}`);
      const d = r.motion.drawn;
      if (map.tiles[worldToTile(d.y) * W + worldToTile(d.x)] === TILE_LOW) bad.push(`drawn ${i}`);
    }
    expect(bad).toEqual([]);
    expect(maxY).toBeGreaterThan(17 * TILE); // through the gap
    expect(dist(r.server, to)).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
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

  it("an order pending longer than the delay explains is given up on, sooner once a short delay is known", () => {
    const m = standing(300, 300);
    m.order("move", 1, 100, { x: 900, y: 300 }, arena());
    // No delay has been measured yet: a slow link must be able to learn its own, so the order waits for ORDER_EXPIRE_MS.
    m.frame(100 + 400, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(1);
    m.frame(100 + ORDER_EXPIRE_MS - 1, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(1);
    m.frame(100 + ORDER_EXPIRE_MS + 1, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(0);
    // A short delay measured (20 ms): the next order is given up on after the floor (350 ms).
    m.order("move", 2, 1000, { x: 900, y: 300 }, arena());
    m.observe({ x: 300, y: 300, t: 1000 + TICK_MS + 20, moveSeq: 2 }, 1090);
    expect(m.pendingOrders).toBe(0);
    expect(m.delay).toBe(20);
    m.order("move", 3, 1200, { x: 900, y: 300 }, arena());
    m.frame(1200 + 300, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(1); // 300 ms: not yet (the floor is 350 ms)
    m.frame(1200 + 400, FRAME_MS, ALIVE);
    expect(m.pendingOrders).toBe(0);
    m.order("move", 4, 2000, { x: 900, y: 300 }, arena());
    m.observe({ x: 300, y: 300, t: 4000, moveSeq: 0 }, 2000 + ORDER_EXPIRE_MS + 10);
    expect(m.pendingOrders).toBe(0);
  });

  it("a slow link learns its delay: the first orders wait for their ack instead of being forgotten before it arrives", () => {
    // 250 ms each way: the ack is over 500 ms away, past the 350 ms an unmeasured delay used to allow.
    const r = new Rig({ up: 250, down: 250 });
    r.run(300);
    r.move(centre(20, 10));
    r.run(450); // the unmeasured window used to end at 350 ms
    expect(r.motion.pendingOrders).toBe(1);
    r.run(300);
    expect(r.motion.pendingOrders).toBe(0);
    expect(r.motion.delay).toBe(DELAY_MAX_MS); // 500 ms less a tick, held at the estimate's ceiling: measured, not left at 50
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

describe("a blink", () => {
  /** Where a 300 u blink east from the model's position lands, on the arena's bare floor. */
  const east = (r: Rig, d = 300): Vec2 => ({ x: r.motion.predicted.x + d, y: r.motion.predicted.y });

  it("moves the model and the drawn fighter to the landing at once, with the server not yet heard", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const from = { ...r.motion.predicted };
    const landing = east(r);
    expect(dist(from, landing)).toBeGreaterThan(TELEPORT_DISTANCE);
    r.blink(landing);
    r.run(FRAME_MS + 1);
    expect(dist(r.motion.predicted, landing)).toBeLessThan(1e-6);
    expect(dist(r.motion.drawn, landing)).toBeLessThan(1e-6);
    expect(r.motion.pendingOrders).toBe(1);
    expect(r.motion.walking).toBe(false);
    expect(r.motion.mode).toBe("predict");
  });

  it("is no snap while the server has not applied it: the patches from before it leave the drawn fighter at the landing", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const landing = east(r);
    const from = r.drawnLog.length;
    r.blink(landing);
    r.run(100); // applied after 60 ms, its patch is back after 120: patches in between still show the old place
    for (let i = from; i < r.drawnLog.length; i++) expect(dist(r.drawnLog[i]!, landing)).toBeLessThan(1e-6);
    expect(r.motion.pendingOrders).toBe(1);
  });

  it("acked with the same landing: no pop, no offset, and the delay is measured like a move's", () => {
    for (const [up, down] of [[2, 2], [40, 40], [90, 60]] as const) {
      const r = new Rig({ up, down });
      r.run(300);
      const landing = east(r);
      r.blink(landing);
      r.run(FRAME_MS + 1); // the jump is this frame's
      const from = r.drawnLog.length;
      r.run(700);
      const tag = `${up}/${down}`;
      expect(r.motion.pendingOrders, tag).toBe(0);
      expect(r.displaceSeq, tag).toBe(1);
      expect(dist(r.server, landing), tag).toBeLessThan(1e-6);
      expect(r.maxStep(from), tag).toBeLessThan(0.01);
      expect(dist(r.motion.drawn, landing), tag).toBeLessThan(0.01);
      expect(r.motion.visualOffset, tag).toBeLessThan(0.01);
      expect(r.motion.delay, tag).toBeGreaterThanOrEqual(up + down - TICK_MS - 1);
      expect(r.motion.delay, tag).toBeLessThanOrEqual(up + down + 1);
    }
  });

  it("a landing a few units off the server's is absorbed smoothly, never back toward the origin", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    const from0 = { ...r.motion.predicted };
    const landing = east(r);
    r.blink(landing, { x: landing.x + 4, y: landing.y + 3 });
    r.run(FRAME_MS + 1);
    const from = r.drawnLog.length;
    r.run(1200);
    expect(r.maxStep(from)).toBeLessThan(5);
    for (let i = from; i < r.drawnLog.length; i++) expect(dist(r.drawnLog[i]!, from0)).toBeGreaterThan(290);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.2);
    expect(r.motion.visualOffset).toBeLessThan(0.2);
  });

  it("refused by the server (echoed in moveSeq, no displacement): the drawn fighter snaps back to where the server has it at the ack", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const origin = { ...r.server };
    const landing = east(r);
    r.blink(landing, null);
    r.run(100);
    expect(dist(r.motion.drawn, landing)).toBeLessThan(1e-6); // not yet known
    r.run(400);
    expect(r.motion.pendingOrders).toBe(0);
    expect(r.displaceSeq).toBe(0);
    expect(dist(r.motion.drawn, origin)).toBeLessThan(0.01);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
    expect(r.motion.visualOffset).toBe(0);
  });

  it("refused over a short jump (inside SNAP_DISTANCE, down to the 64 u minimum): snapped back at the ack, not slid", () => {
    for (const d of [64, 30, 90]) {
      const r = new Rig({ up: 40, down: 40 });
      r.run(300);
      const origin = { ...r.server };
      const landing = east(r, d);
      expect(d).toBeLessThan(SNAP_DISTANCE);
      r.blink(landing, null);
      r.run(FRAME_MS + 1);
      expect(dist(r.motion.drawn, landing), `${d}`).toBeLessThan(1e-6);
      // The ack is back after one round trip (80 ms) and the tick the server waits for: past it, it is where the server is.
      r.run(80 + TICK_MS + 30);
      expect(r.motion.pendingOrders, `${d}`).toBe(0);
      expect(dist(r.motion.drawn, origin), `${d}`).toBeLessThan(0.01);
      expect(r.motion.visualOffset, `${d}`).toBe(0);
    }
  });

  it("refused while walking: the server walks on, so the walk the blink dropped is planned again from where the server is", () => {
    for (const [up, down] of [[40, 40], [90, 60]] as const) {
      const tag = `${up}/${down}`;
      const r = new Rig({ up, down });
      r.run(300);
      const goal = centre(50, 10);
      r.move(goal);
      r.run(700);
      expect(r.motion.walking, tag).toBe(true);
      r.blink({ x: r.motion.predicted.x, y: r.motion.predicted.y + 250 }, null);
      r.run(FRAME_MS + 1);
      expect(r.motion.walking, tag).toBe(false); // the blink dropped it, as far as the client knows
      r.run(up + down + TICK_MS + 40);
      expect(r.motion.pendingOrders, tag).toBe(0);
      expect(r.motion.walking, tag).toBe(true); // refused: the walk is on again
      // It stays with the server (a delay's walk behind its latest sample at most), however long the walk lasts.
      const bound = PLAYER_SPEED * ((down + 2 * TICK_MS + 40) / 1000);
      for (let i = 0; i < 6; i++) {
        r.run(300);
        expect(dist(r.motion.drawn, r.server), `${tag} +${i}`).toBeLessThan(bound);
      }
      r.run(9000);
      expect(dist(r.server, goal), tag).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.2);
    }
  });

  it("refused with a move sent after it: that move stays in flight and is walked from the server, not the dropped walk", () => {
    const r = new Rig({ up: 80, down: 80 });
    r.run(300);
    r.move(centre(50, 10));
    r.run(700);
    r.blink({ x: r.motion.predicted.x, y: r.motion.predicted.y + 250 }, null);
    r.run(80); // a later tick than the blink's
    const goal = centre(40, 20);
    r.move(goal);
    r.run(FRAME_MS + 1);
    // Until the blink's ack (160 ms and a tick after the press) and past it, the later move is still to be acked.
    for (let i = 0; i < 400 && r.motion.pendingOrders === 2; i++) r.run(1);
    expect(r.motion.pendingOrders).toBe(1);
    r.run(FRAME_MS + 1);
    expect(r.motion.walking).toBe(true);
    r.run(500);
    expect(r.motion.pendingOrders).toBe(0);
    r.run(9000);
    expect(dist(r.server, goal)).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.2);
  });

  it("refused while locked: the lock the server kept is followed again", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.lockNow(centre(40, 10));
    r.run(400);
    expect(r.motion.mode).toBe("follow");
    r.blink({ x: r.motion.predicted.x, y: r.motion.predicted.y + 200 }, null);
    expect(r.motion.mode).toBe("predict");
    r.run(400);
    expect(r.motion.pendingOrders).toBe(0);
    expect(r.motion.mode).toBe("follow");
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(PLAYER_SPEED * ((r.down + 2 * TICK_MS) / 1000) + 8);
  });

  it("a blink the server never hears of waits out JUMP_ORDER_EXPIRE_MS (not the shorter window of a move), then snaps back to the server", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    const landing = east(r);
    r.blink(landing, landing, true);
    r.run(ORDER_EXPIRE_MS + 100); // a move would be forgotten by now
    expect(dist(r.motion.drawn, landing)).toBeLessThan(1e-6); // held off, as for any order in flight
    expect(r.motion.pendingJump).toBe(true);
    r.run(JUMP_ORDER_EXPIRE_MS - ORDER_EXPIRE_MS - 100 + 300);
    expect(r.motion.pendingOrders).toBe(0);
    expect(r.motion.pendingJump).toBe(false);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
  });

  it("an accepted blink whose ack is late (the cast message stalls on the uplink) does not pop back and forward: one jump, then nothing", () => {
    for (const stall of [400, 700, 1000, 1400]) {
      const r = new Rig({ up: 60, down: 60 });
      r.run(300);
      r.move(centre(12, 10)); // a delay estimate, as in a play session
      r.run(700);
      const landing = east(r);
      r.blink(landing, landing, false, stall);
      r.run(FRAME_MS + 1);
      const first = r.drawnLog.length;
      r.run(stall + 1500);
      expect(r.displaceSeq, `${stall}`).toBe(1);
      expect(r.motion.pendingOrders, `${stall}`).toBe(0);
      expect(r.maxStep(first), `${stall}`).toBeLessThan(2);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(0.01);
    }
  });

  it("the same at a high round trip with no ack yet to learn the delay from (220 ms each way, 300 ms in)", () => {
    const r = new Rig({ up: 220, down: 220 });
    r.run(300);
    const landing = east(r);
    r.blink(landing);
    r.run(FRAME_MS + 1);
    const first = r.drawnLog.length;
    r.run(1500);
    expect(r.displaceSeq).toBe(1);
    expect(r.motion.pendingOrders).toBe(0);
    expect(r.maxStep(first)).toBeLessThan(2);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
  });

  it("a blink acked after its order was given up on (past JUMP_ORDER_EXPIRE_MS) ends on the server's landing: no third place", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const landing = east(r);
    r.blink(landing, landing, false, JUMP_ORDER_EXPIRE_MS + 400);
    r.run(FRAME_MS + 1);
    r.run(JUMP_ORDER_EXPIRE_MS + 400 + 1500);
    expect(r.displaceSeq).toBe(1);
    expect(r.motion.pendingOrders).toBe(0);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
    expect(dist(r.motion.drawn, landing)).toBeLessThan(0.01);
  });

  it("a short blink acked after its order was given up on is slid into, not jumped: the late ack is recognised by where it lands", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const landing = east(r, 64);
    r.blink(landing, landing, false, JUMP_ORDER_EXPIRE_MS + 300);
    r.run(FRAME_MS + 1);
    const first = r.drawnLog.length;
    r.run(JUMP_ORDER_EXPIRE_MS + 300 + 1500);
    expect(r.displaceSeq).toBe(1);
    expect(r.maxStep(first)).toBeLessThan(6); // every correction runs under the speed caps, the late ack's included
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
  });

  it("drops the offset of an older correction at the blink: the drawn fighter jumps to the landing itself", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.move(centre(50, 10));
    r.serverSpeedMult = 0.8; // the server walks slower than the client expects: corrections pile up in the offset
    r.run(1500);
    expect(r.motion.visualOffset).toBeGreaterThan(1);
    const landing = east(r, 200);
    r.blink(landing);
    r.run(FRAME_MS + 1);
    expect(dist(r.motion.drawn, landing)).toBeLessThan(1e-6);
    expect(r.motion.visualOffset).toBe(0);
  });

  it("a sample from just before the blink is compared with where the model was then, not a point between it and its landing", () => {
    const m = new LocalMotion();
    const map = arena();
    const start = centre(10, 10);
    m.observe({ x: start.x, y: start.y, t: 0, moveSeq: 0, displaceSeq: 0 }, 0);
    m.frame(0, 16, ALIVE);
    m.order("move", 1, 0, centre(50, 10), map);
    for (let c = 16; c <= 208; c += 16) m.frame(c, 16, ALIVE);
    // The server applied the move in the tick stamped 100 (one tick of walking in it): delay 50.
    m.observe({ x: start.x + PLAYER_SPEED * 0.05, y: start.y, t: 100, moveSeq: 1, displaceSeq: 0 }, 150);
    const landing = { x: m.predicted.x + 300, y: m.predicted.y };
    m.blink(2, 210, landing);
    // t = 259: the model at 209 is a frame and a bit into the walk, a millisecond before the blink. The server at 259 is there.
    m.observe({ x: start.x + PLAYER_SPEED * (0.05 + 0.159), y: start.y, t: 259, moveSeq: 1, displaceSeq: 0 }, 300);
    m.frame(310, 16, ALIVE);
    expect(m.pendingOrders).toBe(1);
    expect(dist(m.drawn, landing)).toBeLessThan(1);
    expect(m.visualOffset).toBeLessThan(1);
  });

  it("a walk in hand is dropped by it and a move after it walks on from the landing", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.move(centre(50, 10));
    r.run(400);
    expect(r.motion.walking).toBe(true);
    const x0 = r.motion.predicted.x;
    const landing = east(r);
    r.blink(landing, { x: landing.x - 7, y: landing.y }); // the server was a few units behind the model when it applied it
    r.run(FRAME_MS + 1);
    expect(r.motion.walking).toBe(false);
    expect(r.motion.predicted.x).toBeGreaterThan(x0 + 290);
    r.run(200);
    const from = r.drawnLog.length;
    r.move(centre(50, 14));
    r.run(8000);
    expect(r.maxStep(from)).toBeLessThanOrEqual(PLAYER_SPEED * (FRAME_MS / 1000) + (CORRECT_SPEED_MOVING_MAX * FRAME_MS) / 1000 + 0.01);
    expect(dist(r.server, centre(50, 14))).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.2);
  });

  it("leaves a lock in follow: it stops being predicted, the server's lock goes and the model walks from the landing", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.lockNow(centre(40, 10));
    r.run(400);
    expect(r.motion.mode).toBe("follow");
    const landing = { x: r.motion.predicted.x, y: r.motion.predicted.y + 200 };
    r.blink(landing, landing);
    expect(r.motion.mode).toBe("predict");
    r.run(600);
    expect(r.motion.mode).toBe("predict");
    expect(dist(r.motion.drawn, landing)).toBeLessThan(1);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(1);
  });

  it("does nothing before the first sample", () => {
    const m = new LocalMotion();
    m.blink(1, 0, { x: 5, y: 5 });
    expect(m.pendingOrders).toBe(0);
    expect(m.ready).toBe(false);
  });

  it("two blinks in a row (the first acked after the second was cast) are each acked and settle on the server's second landing", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const first = east(r, 200);
    r.blink(first);
    r.run(30);
    const second = { x: first.x, y: first.y + 200 };
    r.blink(second);
    r.run(FRAME_MS + 1);
    const from = r.drawnLog.length;
    r.run(900);
    expect(r.motion.pendingOrders).toBe(0);
    expect(dist(r.server, second)).toBeLessThan(1e-6);
    expect(dist(r.motion.drawn, second)).toBeLessThan(0.5);
    expect(r.maxStep(from)).toBeLessThan(1);
  });
});

describe("a displacement the client did not order (a pull, a knock)", () => {
  it("moves the model, its history and the drawn fighter by what the server did, and the walk in hand goes on to its destination", () => {
    for (const [up, down] of [[2, 2], [40, 40], [90, 60]] as const) {
      const r = new Rig({ up, down });
      r.run(300);
      const goal = centre(50, 10);
      r.move(goal);
      r.run(700);
      expect(r.motion.walking).toBe(true);
      const from = r.drawnLog.length;
      r.displace({ x: r.server.x, y: r.server.y + 100 });
      r.run(down + TICK_MS * 2 + 20);
      const tag = `${up}/${down}`;
      // It jumped (no slide), once, and is still walking.
      expect(r.maxStep(from), tag).toBeGreaterThan(90);
      expect(r.motion.walking, tag).toBe(true);
      expect(r.motion.visualOffset, tag).toBeLessThan(1);
      r.run(9000);
      expect(dist(r.server, goal), tag).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.2);
      expect(r.motion.visualOffset, tag).toBeLessThan(0.2);
    }
  });

  it("is not a snap: an order still in flight stays pending and is acked when the server applies it", () => {
    const r = new Rig({ up: 80, down: 80 });
    r.run(300);
    r.move(centre(50, 10));
    r.run(700);
    const y0 = r.motion.drawn.y;
    r.displace({ x: r.server.x, y: r.server.y + 60 });
    r.run(10);
    r.move(centre(50, 20)); // sent just after: the server applies it after the pull, and its ack is a round trip later
    // Until the pull's patch reaches the client (the drawn fighter jumps 60 u), which is before the order's ack.
    for (let i = 0; i < 400 && r.motion.drawn.y < y0 + 50; i++) r.run(1);
    expect(r.motion.drawn.y).toBeGreaterThan(y0 + 50);
    expect(r.displaceSeq).toBe(1);
    expect(r.motion.pendingOrders).toBe(1);
    r.run(400);
    expect(r.motion.pendingOrders).toBe(0);
    r.run(9000);
    expect(dist(r.server, centre(50, 20))).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.2);
  });

  it("past SNAP_DISTANCE and TELEPORT_DISTANCE alike it is followed, not snapped away from the walk", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    const goal = centre(50, 10);
    r.move(goal);
    r.run(500);
    r.displace({ x: r.server.x - 150, y: r.server.y }); // pulled back, past the snap distance and short of a teleport
    r.run(200);
    expect(r.motion.walking).toBe(true);
    r.run(8000);
    expect(dist(r.server, goal)).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.2);
  });

  it("every displacement counts, the counter wrapping 255 to 0 included", () => {
    const r = new Rig({ up: 20, down: 20 });
    r.run(300);
    for (let i = 0; i < 260; i++) {
      r.displace({ x: r.server.x + (i % 2 === 0 ? 40 : -40), y: r.server.y });
      r.run(TICK_MS * 4);
      expect(dist(r.motion.drawn, r.server), `displacement ${i}`).toBeLessThan(0.1);
    }
    expect(r.displaceSeq).toBe(260 & 255);
  });

  it("in follow the model snaps to the server and goes on following", () => {
    const r = new Rig({ up: 40, down: 40 });
    r.run(300);
    r.lockNow(centre(50, 10));
    r.run(400);
    expect(r.motion.mode).toBe("follow");
    r.displace({ x: r.server.x, y: r.server.y + 90 });
    r.run(200);
    expect(r.motion.mode).toBe("follow");
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(PLAYER_SPEED * ((r.down + 2 * TICK_MS) / 1000) + 8);
  });

  it("a first sample sets the counter: a client that joins late does not read the displacements before it as new", () => {
    const m = new LocalMotion();
    m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, displaceSeq: 77 }, 0);
    m.frame(0, 16, ALIVE);
    m.observe({ x: 300, y: 300, t: 50, moveSeq: 0, displaceSeq: 77 }, 50);
    m.frame(50, 50, ALIVE);
    expect(m.drawn).toEqual({ x: 300, y: 300 });
    // One later: a displacement of 10 u is followed at once, with no slide.
    m.observe({ x: 310, y: 300, t: 100, moveSeq: 0, displaceSeq: 78 }, 100);
    m.frame(100, 50, ALIVE);
    expect(m.drawn).toEqual({ x: 310, y: 300 });
    expect(m.visualOffset).toBe(0);
  });

  it("a sample with no displaceSeq (an older caller) never counts as a displacement", () => {
    const m = new LocalMotion();
    m.observe({ x: 300, y: 300, t: 0, moveSeq: 0 }, 0);
    m.frame(0, 16, ALIVE);
    m.observe({ x: 310, y: 300, t: 50, moveSeq: 0 }, 50);
    m.frame(50, 50, ALIVE);
    // A plain (small) correction: slid, not jumped.
    expect(m.drawn.x).toBeLessThan(310);
  });
});

describe("a displacement that arrives while our own blink is still in flight", () => {
  it("is measured against the model without the pending jump: the pull moves the fighter by what it did, the blink stays", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(400);
    const origin = { ...r.server };
    const landing = { x: origin.x + 300, y: origin.y };
    // The pull reaches the server's next tick, before the cast (60 ms up) does: the server then blinks from where it was pulled to.
    r.blink(landing, { x: landing.x, y: landing.y + 80 });
    r.run(FRAME_MS + 1);
    const first = r.drawnLog.length;
    r.displace({ x: origin.x, y: origin.y + 80 });
    r.run(1500);
    expect(r.displaceSeq).toBe(2);
    expect(r.motion.pendingOrders).toBe(0);
    const jumps: number[] = [];
    for (let i = first + 1; i < r.drawnLog.length; i++) {
      const d = dist(r.drawnLog[i]!, r.drawnLog[i - 1]!);
      if (d > 10) jumps.push(Math.round(d));
    }
    // One jump of the pull (80 u), then the blink's landing is where it was: not back to the origin and forward again.
    expect(jumps).toEqual([80]);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
  });
});

describe("an echo that names a later order acks the blink before it", () => {
  const east = (r: Rig, d = 300): Vec2 => ({ x: r.motion.predicted.x + d, y: r.motion.predicted.y });

  it("seqAcked reads the order numbers as a count that wraps: the echo of an order or a later one covers it", () => {
    expect(seqAcked(5, 5)).toBe(true);
    expect(seqAcked(5, 6)).toBe(true);
    expect(seqAcked(5, 4)).toBe(false);
    expect(seqAcked(5, 0)).toBe(false); // 0: no order applied yet
    expect(seqAcked(254, 2)).toBe(true); // 254, 255, 1, 2
    expect(seqAcked(2, 254)).toBe(false);
    expect(seqAcked(1, 255)).toBe(false); // 255 comes before the 1 that follows it
    expect(seqAcked(255, 1)).toBe(true);
  });

  it("a blink and a click sent after it, both held up and handled in one tick: no pop, the blink is acked by the click's number", () => {
    for (const stall of [500, 700, 1000]) {
      const r = new Rig({ up: 30, down: 30 });
      r.run(300);
      const landing = east(r);
      r.blink(landing, landing, false, stall);
      r.run(50);
      const goal = { x: landing.x, y: landing.y + 3 * TILE };
      r.move(goal, false, stall - 49); // reaches the server in the same tick as the blink
      r.run(FRAME_MS + 1);
      const first = r.drawnLog.length;
      r.run(stall + 3000);
      expect(r.displaceSeq, `${stall}`).toBe(1);
      expect(r.motion.pendingOrders, `${stall}`).toBe(0);
      expect(r.motion.pendingJump, `${stall}`).toBe(false);
      // The model walked the click's 96 u to its end while the sim only started it: the stalled click costs at most one correction
      // of that size, never the blink's 300 u twice.
      expect(r.maxStep(first), `${stall}`).toBeLessThan(SNAP_DISTANCE + 5);
      expect(dist(r.server, goal), `${stall}`).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(0.1);
    }
  });

  it("the same when the blink is refused: the echo of the click acks the blink, the model snaps back and walks the click's walk from the server", () => {
    for (const stall of [500, 700, 1000]) {
      const r = new Rig({ up: 30, down: 30 });
      r.run(300);
      const origin = { ...r.server };
      const landing = east(r);
      r.blink(landing, null, false, stall);
      r.run(50);
      const goal = { x: landing.x, y: landing.y + 3 * TILE };
      r.move(goal, false, stall - 49);
      r.run(FRAME_MS + 1);
      const first = r.drawnLog.length;
      for (let i = 0; i < stall + 800 && r.motion.pendingJump; i++) r.run(1);
      expect(r.motion.pendingJump, `${stall}`).toBe(false);
      // Just after the answer: the model walks the click's walk from the server (its own copy had already run to the end), and
      // keeps up with the server instead of standing and being dragged along by the corrections.
      r.run(300);
      expect(r.motion.walking, `${stall}`).toBe(true);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(PLAYER_SPEED * ((r.down + 2 * TICK_MS + 40) / 1000));
      r.run(stall + 3000 + 2000);
      expect(r.displaceSeq, `${stall}`).toBe(0);
      expect(r.motion.pendingOrders, `${stall}`).toBe(0);
      expect(r.motion.pendingJump, `${stall}`).toBe(false);
      // One snap back (the refusal), then the model walks the click's walk from where the server is.
      const jumps: number[] = [];
      for (let i = first + 1; i < r.drawnLog.length; i++) {
        const d = dist(r.drawnLog[i]!, r.drawnLog[i - 1]!);
        if (d > 20) jumps.push(Math.round(d));
      }
      expect(jumps.length, `${stall} ${jumps}`).toBeLessThanOrEqual(1);
      expect(dist(r.server, goal), `${stall}`).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(0.1);
      expect(origin.x).toBeLessThan(goal.x);
    }
  });

  it("orders after a blink that has not been answered wait as long as it does (a click shortly after a blink is not forgotten)", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(300);
    // Learn a short delay first: the adaptive window is then at its 350 ms floor.
    r.move(centre(12, 10));
    r.run(500);
    expect(r.motion.delay).toBeLessThan(100);
    const landing = east(r);
    r.blink(landing, landing, false, 900);
    r.run(50);
    r.move({ x: landing.x, y: landing.y + 3 * TILE }, false, 851);
    r.run(600);
    expect(r.motion.pendingOrders).toBe(2); // past 350 ms: a click alone would have been given up on
    r.run(600);
    expect(r.motion.pendingOrders).toBe(0);
  });

  it("an echo of a later number acks the blinks and orders before it even though that number's own order is not in the list", () => {
    const m = new LocalMotion();
    const map = arena();
    m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, displaceSeq: 0 }, 0);
    m.frame(0, FRAME_MS, ALIVE);
    m.order("move", 1, 100, { x: 900, y: 300 }, map);
    m.blink(2, 110, { x: 600, y: 300 });
    expect(m.pendingOrders).toBe(2);
    m.ack(5, 300); // number 5 was a click the prediction has forgotten
    expect(m.pendingOrders).toBe(0);
    expect(m.delay).toBe(300 - TICK_MS - 110); // measured on the newest order the echo covers
    m.ack(5, 350); // a repeated echo changes nothing
    expect(m.delay).toBe(300 - TICK_MS - 110);
    m.ack(0, 400);
    m.ack(200, 400); // a stranger's, far ahead of ours: it covers nothing
    expect(m.delay).toBe(300 - TICK_MS - 110);
  });

  it("a displacement acked by such a number is our own blink: its error to the landing is slid into, not jumped (as a forced displacement would)", () => {
    const m = new LocalMotion();
    m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, displaceSeq: 0 }, 0);
    m.frame(0, FRAME_MS, ALIVE);
    m.blink(2, 100, { x: 600, y: 300 });
    m.frame(116, FRAME_MS, ALIVE);
    // The server handled the blink and a click of ours (number 3) in one tick, and landed 20 u from where the model did.
    m.observe({ x: 620, y: 300, t: 700, moveSeq: 3, displaceSeq: 1 }, 760);
    m.frame(776, FRAME_MS, ALIVE);
    expect(m.pendingJump).toBe(false);
    expect(dist(m.drawn, { x: 600, y: 300 })).toBeLessThan(3); // a frame of the slide (a forced displacement would have jumped 20 u)
    expect(m.visualOffset).toBeGreaterThan(15);
    for (let c = 792; c < 1700; c += 16) m.frame(c, 16, ALIVE);
    expect(dist(m.drawn, { x: 620, y: 300 })).toBeLessThan(0.5);
  });

  it("a click is not kept for that long when no blink is waiting for an answer", () => {
    const r = new Rig({ up: 30, down: 30 });
    r.run(300);
    r.move(centre(12, 10));
    r.run(500);
    r.move(centre(14, 10), false, 2000);
    r.run(500);
    expect(r.motion.pendingOrders).toBe(0);
  });

  it("orderPending tells whether the server has answered an order number, and an unknown one is not pending", () => {
    const r = new Rig({ up: 60, down: 60 });
    r.run(300);
    const seq = r.move(centre(12, 10));
    expect(r.motion.orderPending(seq)).toBe(true);
    expect(r.motion.orderPending(seq % 255 + 1)).toBe(false);
    r.run(400);
    expect(r.motion.orderPending(seq)).toBe(false);
  });
});


describe("ice: the model slides where the server slides", () => {
  /** Traction 425 everywhere: 400 ms from rest to PLAYER_SPEED, 34 u to stop. */
  const ICE: FrameInput = { ...ALIVE, slipAt: () => 425 };
  const ACCEL = 425;
  const STOP = (PLAYER_SPEED * PLAYER_SPEED) / (2 * ACCEL);

  /** A model standing at (x, y), ready on ice, having given no order. */
  function onIce(x = 300, y = 300, input: FrameInput = ICE): LocalMotion {
    const m = new LocalMotion();
    m.observe({ x, y, t: 0, moveSeq: 0 }, 0);
    m.frame(0, FRAME_MS, input);
    return m;
  }
  /** Runs frames of FRAME_MS from client time `from`, `n` of them; returns the clock after the last. */
  function frames(m: LocalMotion, from: number, n: number, input: FrameInput = ICE): number {
    let c = from;
    for (let i = 0; i < n; i++) { c += FRAME_MS; m.frame(c, FRAME_MS, input); }
    return c;
  }

  it("with the traction at 425 everywhere, the first 100 ms of a move are the shared slipWalk's, not a plain walk", () => {
    const map = arena();
    const m = onIce();
    const goal = { x: 900, y: 300 };
    m.order("move", 1, 0, goal, map);
    const p = { x: 300, y: 300 };
    const slip = newSlip(300, 300, 0, 0);
    const path = findPath(map, p, goal, PLAYER_RADIUS);
    let c = 0;
    for (let i = 0; i < 6; i++) {
      c += FRAME_MS;
      m.frame(c, FRAME_MS, ICE);
      slipWalk(map, p, slip, path, FRAME_MS, PLAYER_SPEED, () => ACCEL, c, PLAYER_RADIUS);
      expect(m.predicted.x).toBe(p.x);
      expect(m.predicted.y).toBe(p.y);
    }
    // A start from rest on ice: 1/2 a t^2 = 2.1 u in 100 ms, against 17 u of a walk that is at full speed at once.
    expect(m.drawn.x - 300).toBeCloseTo(0.5 * ACCEL * 0.1 * 0.1, 0);
    expect(m.drawn.x - 300).toBeLessThan(4);
    expect(m.slipVelocity!.x).toBeCloseTo(ACCEL * 0.1, 5);
  });

  it("a stop at full speed slides 34 u and then rests", () => {
    const m = onIce();
    m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
    let c = frames(m, 0, 60); // 1 s: at full speed since 400 ms
    expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 6);
    const at = m.predicted.x;
    m.order("stop", 2, c, undefined, arena());
    c = frames(m, c, 60);
    expect(m.predicted.x - at).toBeCloseTo(STOP, 1);
    expect(STOP).toBeCloseTo(34, 0);
    expect(m.slipVelocity!.x).toBe(0);
    expect(m.walking).toBe(false);
    const rest = m.predicted.x;
    frames(m, c, 5);
    expect(m.predicted.x).toBe(rest);
  });

  it("a turn at full speed swings wide and comes back on line: the velocity is carried through a new order", () => {
    const m = onIce();
    m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
    let c = frames(m, 0, 60);
    const here = { x: m.predicted.x, y: m.predicted.y };
    m.order("move", 2, c, { x: here.x, y: 700 }, arena()); // straight back-turn: 90 degrees
    c = frames(m, c, 30);
    // Half a second on, it has still gone on east a good way (a plain walk would be walking south by now).
    expect(m.predicted.x - here.x).toBeGreaterThan(25);
    expect(m.predicted.y - here.y).toBeGreaterThan(5);
  });

  it("walking onto ice keeps its speed: the slide starts from the velocity the model walked at, not from rest", () => {
    const map = arena();
    const edge = 600;
    const input: FrameInput = { ...ALIVE, slipAt: (x) => (x >= edge ? ACCEL : 0) };
    const m = onIce(300, 300, input);
    m.order("move", 1, 0, { x: 1500, y: 300 }, map);
    let c = 0;
    for (let i = 0; i < 300 && m.predicted.x < edge + 1; i++) { c += FRAME_MS; m.frame(c, FRAME_MS, input); }
    expect(m.predicted.x).toBeGreaterThan(edge);
    c += FRAME_MS;
    m.frame(c, FRAME_MS, input);
    expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 6);
    const x = m.predicted.x;
    c = frames(m, c, 1, input);
    expect(m.predicted.x - x).toBeCloseTo(PLAYER_SPEED * (FRAME_MS / 1000), 1);
  });

  it("leaving the ice grips at once: the slide is gone, the walk goes on exactly", () => {
    const edge = 600;
    const input: FrameInput = { ...ALIVE, slipAt: (x) => (x < edge ? ACCEL : 0) };
    const m = onIce(300, 300, input);
    m.order("move", 1, 0, { x: 1500, y: 300 }, arena());
    let c = 0;
    for (let i = 0; i < 300 && m.predicted.x <= edge; i++) { c += FRAME_MS; m.frame(c, FRAME_MS, input); }
    c += FRAME_MS;
    m.frame(c, FRAME_MS, input);
    expect(m.slipVelocity).toBeNull();
    const x = m.predicted.x;
    c += FRAME_MS;
    m.frame(c, FRAME_MS, input);
    expect(m.predicted.x - x).toBeCloseTo(PLAYER_SPEED * (FRAME_MS / 1000), 6);
  });

  it("leaving the ice plans the walk again when the slide left its next leg blocked (here: the gates locked behind the order)", () => {
    // The order was planned on the open map, straight east; by the time the model grips the gates are walls across that line.
    const open = arena();
    const gate = [8, 9, 10, 11].map((y) => ({ x: 30, y }));
    open.coliseum.gates.push({ side: "w", tiles: gate, x: 30 * TILE + 16, y: 10 * TILE });
    const locked = withGates(open);
    const input: FrameInput = { ...ALIVE, slipAt: (x) => (x < 600 ? ACCEL : 0), map: locked };
    const m = onIce(300, 300, input);
    m.order("move", 1, 0, { x: 1500, y: 300 }, open);
    let c = 0;
    const inside: number[] = [];
    let aside = 0;
    for (let i = 0; i < 400; i++) {
      c += FRAME_MS;
      m.frame(c, FRAME_MS, input);
      if (!circleClear(locked, m.predicted, PLAYER_RADIUS)) inside.push(i);
      aside = Math.max(aside, Math.abs(m.predicted.y - 300));
    }
    expect(m.predicted.x).toBeGreaterThan(1100); // 6.7 s: past the wall
    expect(inside).toEqual([]);
    expect(aside).toBeGreaterThan(40); // it went round
  });

  it("a rooted fighter is planted on ice: the slide stops at once, and the walk starts again from rest", () => {
    const m = onIce();
    m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
    let c = frames(m, 0, 45);
    expect(m.slipVelocity!.x).toBeGreaterThan(100);
    const rooted: FrameInput = { ...ICE, rooted: true };
    c = frames(m, c, 1, rooted);
    const x = m.predicted.x;
    expect(m.slipVelocity!.x).toBe(0);
    c = frames(m, c, 10, rooted);
    expect(m.predicted.x).toBe(x);
    frames(m, c, 3);
    expect(m.predicted.x - x).toBeLessThan(2); // accelerating from rest, not at full speed
  });

  it("after cut() the next frame does not move: no walk, and no slide carried across the teleport", () => {
    const m = onIce();
    m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
    const c = frames(m, 0, 45);
    expect(m.walking).toBe(true);
    const at = { x: m.predicted.x, y: m.predicted.y };
    m.cut(100);
    m.frame(c + FRAME_MS, FRAME_MS, ICE);
    expect(m.predicted).toEqual(at);
    expect(m.walking).toBe(false);
    const v = m.slipVelocity;
    expect(v === null || (v.x === 0 && v.y === 0)).toBe(true);
    m.frame(c + 2 * FRAME_MS, FRAME_MS, ICE);
    expect(m.predicted).toEqual(at);
  });

  it("a blink drops the slide: the model stands where it lands, however fast it was sliding", () => {
    const m = onIce();
    m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
    const c = frames(m, 0, 45);
    m.blink(2, c, { x: 900, y: 500 });
    const v0 = m.slipVelocity;
    expect(v0).toBeNull();
    m.frame(c + FRAME_MS, FRAME_MS, ICE);
    expect(m.predicted).toEqual({ x: 900, y: 500 });
    expect(m.slipVelocity).toEqual({ x: 0, y: 0 });
  });

  it("a displacement the client did not order drops it too, and the server's pull is taken with no slide of the old velocity", () => {
    const map = arena();
    const m = onIce();
    m.order("move", 1, 0, { x: 1700, y: 300 }, map);
    let c = frames(m, 0, 45);
    m.observe({ x: 330, y: 300, t: 50, moveSeq: 1, displaceSeq: 0 }, c);
    c = frames(m, c, 3);
    expect(m.slipVelocity!.x).toBeGreaterThan(100);
    m.observe({ x: 330, y: 400, t: 100, moveSeq: 1, displaceSeq: 1 }, c);
    const v = m.slipVelocity;
    expect(v === null || (v.x === 0 && v.y === 0)).toBe(true);
  });

  describe("a snap or a hand-over takes the server's velocity, when the server is sliding on ice", () => {
    /** A model on ice with a walk in hand, whose server samples run east at 170 u/s: 8.5 u per 50 ms tick. */
    function sliding(input: FrameInput = ICE): { m: LocalMotion; c: number } {
      const m = onIce(300, 300, input);
      m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
      let c = frames(m, 0, 6, input);
      m.observe({ x: 308.5, y: 300, t: 50, moveSeq: 1, displaceSeq: 0 }, c);
      c = frames(m, c, 3, input);
      m.observe({ x: 317, y: 300, t: 100, moveSeq: 1, displaceSeq: 0 }, c);
      return { m, c };
    }

    it("snapTo (here a refused blink: the server answers with the echo alone and is where it was)", () => {
      const { m, c } = sliding();
      m.blink(2, c, { x: 700, y: 300 });
      m.observe({ x: 325.5, y: 300, t: 150, moveSeq: 2, displaceSeq: 0 }, c + 50);
      expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 6);
      expect(m.slipVelocity!.y).toBeCloseTo(0, 6);
      expect(m.predicted.x).toBeCloseTo(325.5, 6);
    });

    it("the same sample on ground that grips: nothing slides on from it", () => {
      const grip: FrameInput = { ...ALIVE, slipAt: () => 0 };
      const { m, c } = sliding(grip);
      m.blink(2, c, { x: 700, y: 300 });
      m.observe({ x: 325.5, y: 300, t: 150, moveSeq: 2, displaceSeq: 0 }, c + 50);
      expect(m.slipVelocity).toBeNull();
      expect(m.predicted.x).toBeCloseTo(325.5, 6);
    });

    it("a teleport's jump is not a velocity: a snap from a cut or a jump slides on from nothing", () => {
      const { m, c } = sliding();
      m.cut(150);
      m.observe({ x: 325.5, y: 300, t: 150, moveSeq: 1, displaceSeq: 0 }, c + 50); // 8.5 u: a plausible-looking 'speed'
      expect(m.slipVelocity).toBeNull();
      const far = sliding().m;
      far.observe({ x: 1500, y: 700, t: 150, moveSeq: 1, displaceSeq: 0 }, 400); // 1200 u in 50 ms
      expect(far.slipVelocity).toBeNull();
    });

    it("leaveFollow: a lock that ends on ice leaves the server sliding to a stop, and the model slides with it, 34 u", () => {
      const map = arena();
      const input: FrameInput = { ...ICE, map };
      const m = new LocalMotion();
      m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, locked: true }, 0);
      expect(m.mode).toBe("follow");
      m.frame(0, FRAME_MS, input);
      m.observe({ x: 308.5, y: 300, t: 50, moveSeq: 0, locked: true }, 60);
      m.frame(70, FRAME_MS, input);
      m.observe({ x: 317, y: 300, t: 100, moveSeq: 0, locked: false }, 110); // the lock is over; the server's last velocity is 170 east
      expect(m.mode).toBe("predict");
      expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 6);
      const at = m.predicted.x;
      frames(m, 110, 60, input);
      expect(m.predicted.x - at).toBeCloseTo(STOP, 1);
      expect(m.slipVelocity!.x).toBe(0);
    });

    it("leaveFollow with no velocity (the server standing) or on ground that grips slides nowhere", () => {
      const map = arena();
      for (const [slipAt, vx] of [[() => 425, 0], [() => 0, 8.5]] as const) {
        const input: FrameInput = { ...ALIVE, slipAt, map };
        const m = new LocalMotion();
        m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, locked: true }, 0);
        m.frame(0, FRAME_MS, input);
        m.observe({ x: 300 + vx, y: 300, t: 50, moveSeq: 0, locked: true }, 60);
        m.observe({ x: 300 + 2 * vx, y: 300, t: 100, moveSeq: 0, locked: false }, 110);
        expect(m.mode).toBe("predict");
        const v = m.slipVelocity;
        expect(v === null || (v.x === 0 && v.y === 0)).toBe(true);
        const at = m.predicted.x;
        frames(m, 110, 10, input);
        expect(m.predicted.x).toBe(at);
      }
    });

    it("an order from follow carries the chase's velocity: the model goes on at speed and turns by the traction", () => {
      const map = arena();
      const input: FrameInput = { ...ICE, map };
      const m = new LocalMotion();
      m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, locked: true }, 0);
      m.frame(0, FRAME_MS, input);
      m.observe({ x: 308.5, y: 300, t: 50, moveSeq: 0, locked: true }, 60);
      m.frame(70, FRAME_MS, input);
      m.order("move", 1, 80, { x: 300, y: 700 }, map); // turn round to the south at full speed
      expect(m.mode).toBe("predict");
      expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 6);
      const x = m.predicted.x;
      frames(m, 80, 12, input);
      expect(m.predicted.x - x).toBeGreaterThan(20); // it carries on east before it can turn
    });

    it("the map of the frame is the one the slide collides with (the gated copy), and it is enough with no order ever given", () => {
      const map = arena();
      const input: FrameInput = { ...ICE, map };
      const m = new LocalMotion();
      m.observe({ x: 300, y: 300, t: 0, moveSeq: 0, locked: true }, 0);
      m.frame(0, FRAME_MS, input);
      m.observe({ x: 308.5, y: 300, t: 50, moveSeq: 0, locked: true }, 60);
      m.observe({ x: 317, y: 300, t: 100, moveSeq: 0, locked: false }, 110);
      expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 6);
      // And without it (no order, no map in the frame) the model has nothing to collide on: it stands.
      const bare = new LocalMotion();
      bare.observe({ x: 300, y: 300, t: 0, moveSeq: 0, locked: true }, 0);
      bare.frame(0, FRAME_MS, ICE);
      bare.observe({ x: 308.5, y: 300, t: 50, moveSeq: 0, locked: true }, 60);
      bare.observe({ x: 317, y: 300, t: 100, moveSeq: 0, locked: false }, 110);
      expect(bare.slipVelocity).toBeNull();
    });
  });

  it("ground that grips (traction 0 everywhere) changes nothing: a long random run draws the same fighter, frame for frame, as with no ice term", () => {
    for (const o of [{ up: 30, down: 30, jitter: 10 }, { up: 90, down: 70, jitter: 40 }]) {
      for (let seed = 1; seed <= 4; seed++) {
        const play = (input: FrameInput): Rig => {
          const rnd = mulberry32(seed);
          const r = new Rig(o);
          r.input = input;
          r.run(300);
          for (let i = 0; i < 25; i++) {
            const roll = rnd();
            const to = { x: 100 + rnd() * (W * TILE - 200), y: 100 + rnd() * (H * TILE - 200) };
            if (roll < 0.6) r.move(to);
            else if (roll < 0.75) r.stop();
            else if (roll < 0.9) r.target(to);
            else r.blink(to);
            r.run(150 + rnd() * 700);
          }
          r.stop();
          r.run(2500);
          return r;
        };
        const plain = play({ ...ALIVE });
        const grip = play({ ...ALIVE, slipAt: () => 0 });
        const tag = `${JSON.stringify(o)} seed ${seed}`;
        expect(grip.drawnLog.length, tag).toBe(plain.drawnLog.length);
        expect(grip.drawnLog, tag).toEqual(plain.drawnLog);
        expect(grip.offsetLog, tag).toEqual(plain.offsetLog);
        expect(grip.motion.slipVelocity, tag).toBeNull();
      }
    }
  });

  describe("the divergence rule: DIVERGE_ERR_SLIP while sliding and for SLIP_GRACE_MS after", () => {
    it("the constants", () => {
      expect(DIVERGE_ERR_SLIP).toBe(16);
      expect(SLIP_GRACE_MS).toBe(500);
      expect(DIVERGE_ERR_SLIP).toBeGreaterThan(DIVERGE_ERR);
    });

    // A rebase puts the model on the server's sample, so a server that stands while the model walks on shows an error of the
    // model's advance since the last sample: 8.5 u per 50 ms at PLAYER_SPEED, 19.8 u per 117 ms.
    const THREE = 3 * FRAME_MS;
    const SEVEN = 7 * FRAME_MS;

    /** A model at full speed east on `input`'s ground, its order acked (delay 0), the clock at `c`. */
    function fullSpeed(input: FrameInput): { m: LocalMotion; c: number } {
      const m = onIce(300, 300, input);
      m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
      m.observe({ x: 300, y: 300, t: 50, moveSeq: 1 }, 0);
      return { m, c: frames(m, 0, 40, input) };
    }
    /** `n` samples `gap` ms apart from a server that stands at (x, 300), the model walking on between them. Returns the clock. */
    function standingSamples(m: LocalMotion, c: number, x: number, n: number, gap: number, input: FrameInput): number {
      for (let i = 0; i < n; i++) {
        c = frames(m, c, Math.round(gap / FRAME_MS), input);
        m.observe({ x, y: 300, t: c, moveSeq: 1 }, c);
      }
      return c;
    }
    /** Whether the model still walks a second after the samples (it was dropped if it has come to rest). */
    const keepsWalking = (m: LocalMotion, c: number, input: FrameInput): boolean => {
      frames(m, c, 60, input);
      return m.walking;
    };

    it("on ice, three samples 8.5 u off from a standing server keep the walk; off ice that is a divergence and drops it", () => {
      const grip: FrameInput = { ...ALIVE };
      for (const [name, input, kept] of [["ice", ICE, true], ["floor", grip, false]] as const) {
        const { m, c } = fullSpeed(input);
        m.observe({ x: m.predicted.x, y: 300, t: c, moveSeq: 1 }, c); // the server is where the model is, and stands
        const x = m.predicted.x;
        const end = standingSamples(m, c, x, 3, THREE, input);
        expect(keepsWalking(m, end, input), name).toBe(kept);
      }
    });

    it("on ice, three samples 20 u off from a standing server drop it", () => {
      const { m, c } = fullSpeed(ICE);
      m.observe({ x: m.predicted.x, y: 300, t: c, moveSeq: 1 }, c);
      const end = standingSamples(m, c, m.predicted.x, 3, SEVEN, ICE);
      expect(keepsWalking(m, end, ICE)).toBe(false);
    });

    it("on ice, samples more than DIVERGE_ERR_SLIP off from a server moving along the slide velocity keep the walk, though that is not toward the next waypoint", () => {
      // A slow slide (traction 100) keeps its velocity through a turn: the next waypoint is north, the slide still goes east.
      const input: FrameInput = { ...ALIVE, slipAt: (x) => (x >= 600 ? 100 : 0) };
      const m = onIce(300, 300, input);
      const map = arena();
      m.order("move", 1, 0, { x: 1700, y: 300 }, map);
      m.observe({ x: 300, y: 300, t: 50, moveSeq: 1 }, 0);
      let c = 0;
      for (let i = 0; i < 400 && m.predicted.x < 700; i++) {
        c += FRAME_MS;
        m.frame(c, FRAME_MS, input);
        if (i % 3 === 2) m.observe({ x: m.predicted.x, y: 300, t: c, moveSeq: 1 }, c); // the server is where the model is
      }
      expect(m.slipVelocity!.x).toBeCloseTo(PLAYER_SPEED, 3); // on the slow ice at the speed it walked in at
      m.order("move", 2, c, { x: m.predicted.x, y: 100 }, map);
      m.observe({ x: m.predicted.x, y: 300, t: c + 50, moveSeq: 2 }, c); // acked: the delay is 0
      // The server crawls east at 10 u/s; the model runs on at about 150 east, more than DIVERGE_ERR_SLIP further than it per 150 ms.
      const errs: number[] = [];
      const mm = m as unknown as { noteDivergence(e: number): void };
      const nd = mm.noteDivergence.bind(m);
      mm.noteDivergence = (e) => { errs.push(e); nd(e); };
      let sx = m.predicted.x;
      for (let i = 0; i < 3; i++) {
        c = frames(m, c, 9, input);
        sx += (10 * 9 * FRAME_MS) / 1000;
        m.observe({ x: sx, y: 300, t: c, moveSeq: 2 }, c);
      }
      expect(errs.length).toBe(3);
      for (const e of errs) expect(e).toBeGreaterThan(DIVERGE_ERR_SLIP); // each sample counts as off
      expect(m.slipVelocity!.y).toBeLessThan(-5); // it has begun to turn north, and is going east still
      expect(m.slipVelocity!.x).toBeGreaterThan(120);
      const y0 = m.predicted.y;
      frames(m, c, 90, input);
      expect(m.predicted.y).toBeLessThan(y0 - 40); // the walk north went on
    });

    it("after leaving the ice the slide's tolerance holds for SLIP_GRACE_MS, then today's rule is back", () => {
      const edge = 700;
      const input: FrameInput = { ...ALIVE, slipAt: (x) => (x < edge ? 425 : 0) };
      const m = onIce(300, 300, input);
      m.order("move", 1, 0, { x: 1700, y: 300 }, arena());
      m.observe({ x: 300, y: 300, t: 50, moveSeq: 1 }, 0);
      let c = 0;
      for (let i = 0; i < 400 && m.predicted.x <= edge; i++) { c += FRAME_MS; m.frame(c, FRAME_MS, input); }
      c = frames(m, c, 1, input); // the frame that finds it off the ice
      expect(m.slipVelocity).toBeNull();
      const left = c;
      // Inside the grace: 8.5 u errors from a standing server are not divergences.
      m.observe({ x: m.predicted.x, y: 300, t: c, moveSeq: 1 }, c);
      c = standingSamples(m, c, m.predicted.x, 3, THREE, input);
      expect(c - left).toBeLessThan(SLIP_GRACE_MS);
      // Past it: the same errors are.
      c = frames(m, c, 25, input);
      expect(c - left).toBeGreaterThan(SLIP_GRACE_MS);
      m.observe({ x: m.predicted.x, y: 300, t: c, moveSeq: 1 }, c);
      c = standingSamples(m, c, m.predicted.x, 3, THREE, input);
      expect(keepsWalking(m, c, input)).toBe(false);
    });

    it("the grace is what kept the walk: the same samples without it (a model that never slid) drop it", () => {
      const grip: FrameInput = { ...ALIVE };
      const { m, c } = fullSpeed(grip);
      m.observe({ x: m.predicted.x, y: 300, t: c, moveSeq: 1 }, c);
      const end = standingSamples(m, c, m.predicted.x, 3, THREE, grip);
      expect(keepsWalking(m, end, grip)).toBe(false);
    });
  });
});

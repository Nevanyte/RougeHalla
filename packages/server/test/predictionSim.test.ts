// The client's prediction of its own fighter (client/src/net/localMotion.ts) against the REAL sim: orders go through the input
// parser and the fixed step, patches carry the state's own position, server time and moveSeq, with latency each way. It checks
// what the client's unit tests can only assume about the server: that an order is applied and walked one tick in the same step,
// that moveSeq names it, and that the prediction therefore stays in line with the sim through starts, turns, stops and a lock.
import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { LocalMotion, type FrameInput } from "../../client/src/net/localMotion";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import type { World } from "../src/sim/world";

const W = 60;
const H = 30;
function arenaMap(walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  for (const [x, y] of walls) tiles[y * W + x] = TILE_WALL;
  return { ...mapFromTiles(W, H, tiles), spawns: [{ x: 10 * TILE + 16, y: 10 * TILE + 16 }, { x: 50 * TILE + 16, y: 20 * TILE + 16 }] };
}
const centre = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const ALIVE: FrameInput = { alive: true, speedMult: 1, rooted: false, aiming: false };
const FRAME_MS = 1000 / 60;

/** A real world of one player (and any mob a test adds) and a client that predicts it, with `up` / `down` ms of latency. */
class SimRig {
  readonly world: World;
  readonly motion = new LocalMotion();
  readonly map: GameMap;
  now = 0;
  private seq = 0;
  private lastFrame = 0;
  private readonly rnd = mulberry32(11);
  private inbox: Array<{ at: number; type: string; msg: unknown }> = [];
  private patches: Array<{ at: number; x: number; y: number; t: number; moveSeq: number }> = [];
  readonly drawn: Vec2[] = [];
  readonly offsets: number[] = [];

  constructor(readonly up: number, readonly down: number, readonly jitter = 0, faction: FactionId = "plague", weapon: WeaponId = "sword") {
    this.map = arenaMap();
    this.world = createGameWorld({
      seed: 3,
      config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
      random: mulberry32(4),
    }, { signatures: false });
    this.world.map = this.map;
    const p = addPlayer(this.world, "me", "me");
    p.faction = faction;
    p.weapon0 = weapon;
    p.hp = p.maxHp = 1e9;
    step(this.world, TICK_MS); // the first step starts the run
    this.now = this.world.state.serverTime; // true time and server time run together from here
    this.server.x = 10 * TILE + 16;
    this.server.y = 10 * TILE + 16;
    this.world.players.get("me")!.history = [{ t: this.world.state.serverTime, x: this.server.x, y: this.server.y }];
    this.send();
    this.motion.observe({ x: this.server.x, y: this.server.y, t: this.world.state.serverTime, moveSeq: 0 }, this.clock);
    this.frame();
  }

  get server() { return this.world.state.players.get("me")!; }
  get clock(): number { return this.now - this.down; }
  private lag(base: number): number { return base + Math.floor(this.rnd() * (this.jitter + 1)); }

  /** Queues the state as the patch of the step just run. */
  private send(): void {
    const p = this.server;
    this.patches.push({
      at: this.now + this.lag(this.down), x: Math.fround(p.x), y: Math.fround(p.y), t: this.world.state.serverTime, moveSeq: p.moveSeq,
    });
  }

  move(to: Vec2): void {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.order("move", seq, this.clock, to, this.map);
    this.inbox.push({ at: this.now + this.lag(this.up), type: "move", msg: { x: to.x, y: to.y, seq } });
  }

  stop(): void {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.order("stop", seq, this.clock, undefined, this.map);
    this.inbox.push({ at: this.now + this.lag(this.up), type: "stop", msg: { seq } });
  }

  target(id: string): void {
    this.motion.order("target", 0, this.clock, undefined, this.map);
    this.inbox.push({ at: this.now + this.lag(this.up), type: "target", msg: { id } });
  }

  frame(): void {
    const dt = this.drawn.length === 0 ? FRAME_MS : this.now - this.lastFrame;
    this.lastFrame = this.now;
    this.motion.frame(this.clock, dt, ALIVE);
    this.drawn.push({ x: this.motion.drawn.x, y: this.motion.drawn.y });
    this.offsets.push(this.motion.visualOffset);
  }

  run(ms: number): void {
    const end = this.now + ms;
    let nextFrame = this.lastFrame + FRAME_MS;
    while (this.now < end) {
      this.now++;
      if (this.now % TICK_MS === 0) {
        const rt = this.world.players.get("me")!;
        for (const m of this.inbox.filter((i) => i.at <= this.now)) enqueueClientMessage(rt.inputs, m.type, m.msg);
        this.inbox = this.inbox.filter((i) => i.at > this.now);
        step(this.world, TICK_MS);
        this.send();
      }
      this.patches = this.patches.filter((p) => {
        if (p.at > this.now) return true;
        this.motion.observe({ x: p.x, y: p.y, t: p.t, moveSeq: p.moveSeq }, this.clock);
        return false;
      });
      if (this.now >= nextFrame) {
        this.frame();
        nextFrame += FRAME_MS;
      }
    }
  }

  maxStep(from = 1): number {
    let m = 0;
    for (let i = Math.max(1, from); i < this.drawn.length; i++) m = Math.max(m, dist(this.drawn[i]!, this.drawn[i - 1]!));
    return m;
  }
}

const WALK_STEP = PLAYER_SPEED * (FRAME_MS / 1000);
/** A walk plus the most the smoothing offset may add on top of it in one frame. */
const MAX_STEP = WALK_STEP + (120 * FRAME_MS) / 1000 + 0.01;

describe("prediction against the real sim", () => {
  it("the sim echoes the order in moveSeq on the tick it applies it, and walks a tick in the same step", () => {
    const r = new SimRig(0, 0);
    const x0 = r.server.x;
    r.move(centre(40, 10));
    r.run(TICK_MS * 2);
    expect(r.server.moveSeq).toBe(1);
    // Applied in the first step after it arrived: one step of walking by then, two steps by the second.
    expect(r.server.x - x0).toBeGreaterThan(PLAYER_SPEED * (TICK_MS / 1000) - 1e-6);
    expect(r.server.x - x0).toBeLessThanOrEqual(PLAYER_SPEED * ((TICK_MS * 2) / 1000) + 1e-6);
  });

  it("the delay it measures is what the arrangement predicts: the round trip, less the tick the sim walks while applying", () => {
    for (const [up, down] of [[0, 0], [30, 30], [60, 90]] as const) {
      const r = new SimRig(up, down);
      r.run(200);
      r.move(centre(40, 10));
      r.run(600);
      expect(r.motion.pendingOrders, `${up}/${down}`).toBe(0);
      expect(r.motion.delay, `${up}/${down}`).toBeGreaterThanOrEqual(up + down - TICK_MS - 1);
      expect(r.motion.delay, `${up}/${down}`).toBeLessThanOrEqual(up + down + 1);
    }
  });

  it("keeps in line with the sim through starts, turns and stops, and rests exactly where it rests", () => {
    for (const [up, down, jitter] of [[1, 1, 0], [40, 40, 10], [90, 70, 40]] as const) {
      const r = new SimRig(up, down, jitter);
      r.run(300);
      const orders: Array<() => void> = [
        () => r.move(centre(30, 10)), () => r.move(centre(30, 24)), () => r.stop(), () => r.move(centre(12, 20)),
        () => r.move(centre(14, 8)), () => r.stop(), () => r.move(centre(40, 15)),
      ];
      const rnd = mulberry32(2);
      for (const o of orders) {
        o();
        r.run(150 + rnd() * 650);
      }
      r.stop();
      r.run(1500);
      const tag = `${up}/${down}/${jitter}`;
      expect(r.maxStep(), tag).toBeLessThanOrEqual(MAX_STEP);
      expect(Math.max(...r.offsets), tag).toBeLessThan(20);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
      expect(r.motion.visualOffset, tag).toBeLessThan(0.1);
    }
  });

  it("holding the button (a new walk every 100 ms, the direction drifting) stays smooth", () => {
    const r = new SimRig(40, 40, 20);
    r.run(300);
    const from = r.drawn.length;
    for (let i = 0; i < 30; i++) {
      r.move({ x: 40 * TILE, y: 330 + i * 8 });
      r.run(100);
    }
    expect(r.maxStep(from)).toBeLessThanOrEqual(MAX_STEP);
    expect(Math.max(...r.offsets)).toBeLessThan(12);
  });

  it("a lock hands over to the server's chase: drawn is the server's position, never ahead, and catches the dummy up", () => {
    const r = new SimRig(40, 40);
    const dummy = addMob(r.world, { kind: "dummy", name: "dummy", at: centre(30, 10) });
    r.run(300);
    r.move(centre(14, 10)); // walking when the order comes
    r.run(250);
    r.target(dummy);
    r.run(400);
    expect(r.motion.mode).toBe("follow");
    expect(r.server.attackTarget).toBe(dummy);
    const me = r.server;
    // Never ahead of where the server has the fighter, and within a patch's walking of it.
    expect(r.motion.drawn.x).toBeLessThanOrEqual(me.x + 1e-6);
    expect(me.x - r.motion.drawn.x).toBeLessThan(PLAYER_SPEED * ((r.down + 2 * TICK_MS) / 1000) + 8);
    r.run(3000);
    expect(r.server.x).toBeGreaterThan(centre(24, 10).x); // it walked up to the dummy and is hitting it
    expect(combatant(r.world, "me")!.rt.weapon.lock).toBe(dummy);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(PLAYER_SPEED * ((r.down + 2 * TICK_MS) / 1000) + 8);
    // Walking away again: predicted at once, and the lock is gone.
    r.move(centre(10, 10));
    r.run(FRAME_MS * 2 + 1);
    expect(r.motion.mode).toBe("predict");
    r.run(5000); // 19 tiles to walk
    expect(combatant(r.world, "me")!.rt.weapon.lock).toBeNull();
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
  });
});

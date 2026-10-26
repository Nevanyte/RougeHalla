// The client's prediction of its own fighter (client/src/net/localMotion.ts) against the REAL sim: orders go through the input
// parser and the fixed step, patches carry the state's own position, server time and moveSeq, with latency each way. It checks
// what the client's unit tests can only assume about the server: that an order is applied and walked one tick in the same step,
// that moveSeq names it, and that the prediction therefore stays in line with the sim through starts, turns, stops and a lock.
// And through a blink (Blaze Step: the `cast` input, the shared blinkLanding, `displaceSeq`) and a displacement the client did not
// order (the sim's own `displace`).
import { describe, expect, it } from "vitest";
import {
  blinkLanding, mapFromTiles, mulberry32, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type GameMap, type Vec2,
  type WeaponId,
} from "@raid/shared";
import { LocalMotion, type FrameInput } from "../../client/src/net/localMotion";
import { combatant } from "../src/sim/combatant";
import { displace } from "../src/sim/displace";
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
  private patches: Array<{ at: number; x: number; y: number; t: number; moveSeq: number; locked: boolean; displaceSeq: number }> = [];
  readonly drawn: Vec2[] = [];
  readonly offsets: number[] = [];

  constructor(readonly up: number, readonly down: number, readonly jitter = 0, faction: FactionId = "plague", weapon: WeaponId = "sword") {
    this.map = arenaMap();
    this.world = createGameWorld({
      seed: 3,
      config: {
        minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
        wishLockSeconds: 0, // the Wish is ready from the start of the run
      },
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
    this.motion.observe({ x: this.server.x, y: this.server.y, t: this.world.state.serverTime, moveSeq: 0, displaceSeq: 0 }, this.clock);
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
      locked: p.attackTarget !== "", displaceSeq: p.displaceSeq,
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

  /**
   * The player casts the Wish at the cursor point `to`: as the scene does, the shared blinkLanding from the model's position
   * moves the model at once, and the cast goes up with the order number. Returns the predicted landing (null: the client
   * would not have cast).
   */
  blink(to: Vec2): { landing: Vec2 | null; seq: number } {
    const landing = blinkLanding(this.map, false, this.motion.predicted, to);
    const seq = (this.seq = (this.seq % 255) + 1);
    if (landing) this.motion.blink(seq, this.clock, landing);
    this.inbox.push({ at: this.now + this.lag(this.up), type: "cast", msg: { slot: "wish", x: to.x, y: to.y, seq } });
    return { landing, seq };
  }

  /** The sim moves the player on its own between two steps (a pull): the next step's patch shows it. */
  pull(to: Vec2): void {
    displace(this.world, combatant(this.world, "me")!, to);
  }

  target(id: string): void {
    this.motion.expectLock(this.clock); // the click; whether the server took it is for its patches to say
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
        this.motion.observe({ x: p.x, y: p.y, t: p.t, moveSeq: p.moveSeq, locked: p.locked, displaceSeq: p.displaceSeq }, this.clock);
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

  it("a target the real server refuses (out of reach): the walk it interrupted is taken up again from where the server has it", () => {
    const r = new SimRig(40, 40);
    const far = addMob(r.world, { kind: "dummy", name: "far", at: centre(58, 10) });
    r.run(300);
    r.move(centre(30, 20));
    r.run(400);
    r.target(far);
    expect(r.motion.mode).toBe("follow"); // hoped for
    r.run(900);
    expect(r.server.attackTarget).toBe(""); // refused: more than TARGET_RANGE away
    expect(r.motion.mode).toBe("predict");
    expect(r.motion.walking).toBe(true);
    r.run(6000);
    expect(dist(r.server, centre(30, 20))).toBeLessThan(0.5);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
  });

  it("a lock the server drops by itself (its target is gone) takes the model out of follow", () => {
    const r = new SimRig(40, 40);
    const dummy = addMob(r.world, { kind: "dummy", name: "dummy", at: centre(20, 10) });
    r.run(300);
    r.target(dummy);
    r.run(1500);
    expect(r.motion.mode).toBe("follow");
    expect(r.server.attackTarget).toBe(dummy);
    r.world.state.mobs.get(dummy)!.status = "dead";
    r.run(600);
    expect(r.server.attackTarget).toBe("");
    expect(r.motion.mode).toBe("predict");
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.5);
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

describe("a blink against the real sim (Blaze Step)", () => {
  it("the sim lands where the client predicted, in the same step it echoes the order, and the drawn fighter never jumps back", () => {
    for (const [up, down, jitter] of [[1, 1, 0], [40, 40, 0], [90, 70, 40]] as const) {
      const tag = `${up}/${down}/${jitter}`;
      const r = new SimRig(up, down, jitter, "fire");
      r.run(300);
      const from = { x: r.server.x, y: r.server.y }; // (a schema object does not spread)
      const { landing, seq } = r.blink({ x: from.x + 400, y: from.y + 60 }); // past its range: the landing is 300 u along the ray
      expect(landing, tag).not.toBeNull();
      expect(dist(from, landing!), tag).toBeGreaterThan(299);
      r.run(FRAME_MS + 1);
      expect(dist(r.motion.drawn, landing!), tag).toBeLessThan(1e-6); // drawn at once, before the server has heard
      const first = r.drawn.length;
      r.run(900);
      expect(r.server.displaceSeq, tag).toBe(1);
      expect(r.server.moveSeq, tag).toBe(seq);
      expect(dist(r.server, landing!), tag).toBeLessThan(1e-3);
      expect(r.motion.pendingOrders, tag).toBe(0);
      expect(r.motion.visualOffset, tag).toBeLessThan(2);
      expect(r.maxStep(first), tag).toBeLessThan(2);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.01);
      // The Wish is spent: its cooldown started, and the sim has no walk or lock for it to carry on.
      expect(r.server.wishReadyAt, tag).toBeGreaterThan(r.world.state.serverTime);
    }
  });

  it("a blink the sim refuses (here: still cooling down) is echoed in moveSeq without a displacement, and the drawn fighter snaps back at that ack", () => {
    const r = new SimRig(40, 40, 0, "fire");
    r.run(300);
    const origin = { x: r.server.x, y: r.server.y };
    r.server.wishReadyAt = r.world.state.serverTime + 100_000; // the client has no way to know
    const { landing, seq } = r.blink({ x: origin.x + 300, y: origin.y });
    expect(landing).not.toBeNull();
    r.run(FRAME_MS + 1);
    expect(dist(r.motion.drawn, landing!)).toBeLessThan(1e-6);
    r.run(500);
    expect(r.server.moveSeq).toBe(seq);
    expect(r.server.displaceSeq).toBe(0);
    expect(dist(r.server, origin)).toBeLessThan(1e-3);
    expect(r.motion.pendingOrders).toBe(0);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
    expect(r.motion.visualOffset).toBe(0);
  });

  it("a walk right after it stays in line with the sim, which re-plans from the landing", () => {
    for (const [up, down, jitter] of [[1, 1, 0], [40, 40, 10], [90, 70, 40]] as const) {
      const tag = `${up}/${down}/${jitter}`;
      const r = new SimRig(up, down, jitter, "fire");
      r.run(300);
      const { landing } = r.blink({ x: r.server.x + 250, y: r.server.y });
      r.run(30);
      r.move(centre(40, 20));
      r.run(FRAME_MS + 1);
      const from = r.drawn.length;
      r.run(7000);
      expect(landing, tag).not.toBeNull();
      expect(dist(r.server, centre(40, 20)), tag).toBeLessThan(0.5);
      expect(r.maxStep(from), tag).toBeLessThanOrEqual(MAX_STEP);
      expect(Math.max(...r.offsets.slice(from)), tag).toBeLessThan(12);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
      expect(r.motion.visualOffset, tag).toBeLessThan(0.1);
    }
  });

  it("while walking: the model is a delay ahead of the server, the landings differ by a few units, which are absorbed without a snap", () => {
    const r = new SimRig(40, 40, 0, "fire");
    r.run(300);
    r.move(centre(50, 10));
    r.run(700);
    expect(r.motion.walking).toBe(true);
    const { landing } = r.blink({ x: r.motion.predicted.x + 150, y: r.motion.predicted.y + 250 });
    expect(landing).not.toBeNull();
    r.run(FRAME_MS + 1);
    const first = r.drawn.length;
    r.run(1500);
    expect(r.server.displaceSeq).toBe(1);
    expect(r.motion.pendingOrders).toBe(0);
    // The blink dropped the walk on both sides; the landings differ by the model's lead over the server (at most about a delay's walk).
    expect(dist(r.server, landing!)).toBeLessThan(PLAYER_SPEED * ((TICK_MS + 40 + 40) / 1000) + 2);
    expect(r.maxStep(first)).toBeLessThan(WALK_STEP + 2);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
    expect(r.motion.walking).toBe(false);
  });

  it("a displacement the client did not order (the sim's own displace) rebases the model by the jump and the walk in hand goes on", () => {
    for (const [up, down, jitter] of [[1, 1, 0], [40, 40, 10], [90, 70, 40]] as const) {
      const tag = `${up}/${down}/${jitter}`;
      const r = new SimRig(up, down, jitter, "fire");
      r.run(300);
      const goal = centre(50, 10);
      r.move(goal);
      r.run(900);
      expect(r.motion.walking, tag).toBe(true);
      const first = r.drawn.length;
      r.pull({ x: r.server.x, y: r.server.y + 100 });
      r.run(down + TICK_MS * 2 + 60);
      expect(r.server.displaceSeq, tag).toBe(1);
      // One jump of about the pull, and the model is still walking: its walk was planned again, not dropped.
      expect(r.maxStep(first), tag).toBeGreaterThan(90);
      expect(r.motion.walking, tag).toBe(true);
      expect(r.motion.visualOffset, tag).toBeLessThan(2);
      r.run(9000);
      expect(dist(r.server, goal), tag).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
      expect(r.motion.visualOffset, tag).toBeLessThan(0.1);
    }
  });
});

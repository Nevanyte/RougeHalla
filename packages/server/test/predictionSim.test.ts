// The client's prediction of its own fighter (client/src/net/localMotion.ts) against the REAL sim: orders go through the input
// parser and the fixed step, patches carry the state's own position, server time and moveSeq, with latency each way. It checks
// what the client's unit tests can only assume about the server: that an order is applied and walked one tick in the same step,
// that moveSeq names it, and that the prediction therefore stays in line with the sim through starts, turns, stops and a lock.
// And through a blink (Blaze Step: the `cast` input, the shared blinkLanding, `displaceSeq`) and a displacement the client did not
// order (the sim's own `displace`).
import { describe, expect, it } from "vitest";
import {
  blinkLanding, FREEZE_CAST_MS, mapFromTiles, mulberry32, PLAYER_SPEED, REGION_COLISEUM, SWARM_CAST_MS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type GameMap,
  type Vec2, type WeaponId,
} from "@raid/shared";
import { type FrameInput } from "../../client/src/net/localMotion";
import { LocalPrediction, castUnanswered, type LocalFighter } from "../../client/src/net/localPrediction";
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
  /** The client's prediction; its motion is what most tests read. */
  readonly predict = new LocalPrediction();
  get motion() { return this.predict.motion; }
  /** Frames are fed what the client knows of its own speed and roots (the fx and the synced bits), not a constant. */
  readonly usePredict: boolean;
  readonly map: GameMap;
  now = 0;
  private seq = 0;
  private lastFrame = 0;
  private readonly rnd = mulberry32(11);
  private inbox: Array<{ at: number; type: string; msg: unknown }> = [];
  private patches: Array<{ at: number; x: number; y: number; t: number; moveSeq: number; locked: boolean; displaceSeq: number; me: LocalFighter }> = [];
  private fxQueue: Array<{ at: number; fx: Parameters<LocalPrediction["noteFx"]>[0] }> = [];
  /** What the client last heard of its own fighter (as of the newest patch delivered). */
  private heard!: LocalFighter;
  readonly drawn: Vec2[] = [];
  readonly offsets: number[] = [];

  /** What the client believes about the coliseum gates when it predicts a blink (it can lag the server's flag). */
  clientGatesLocked: boolean;

  constructor(
    readonly up: number, readonly down: number, readonly jitter = 0, faction: FactionId = "plague", weapon: WeaponId = "sword",
    opts: { map?: GameMap; start?: Vec2; gatesLocked?: boolean; clientGatesLocked?: boolean; usePredict?: boolean } = {},
  ) {
    this.usePredict = opts.usePredict ?? false;
    this.map = opts.map ?? arenaMap();
    this.clientGatesLocked = opts.clientGatesLocked ?? opts.gatesLocked ?? false;
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
    this.server.x = opts.start?.x ?? 10 * TILE + 16;
    this.server.y = opts.start?.y ?? 10 * TILE + 16;
    if (opts.gatesLocked) this.world.state.gatesLocked = true; // the coliseum's gates are walls on the server from here
    this.world.players.get("me")!.history = [{ t: this.world.state.serverTime, x: this.server.x, y: this.server.y }];
    this.heard = this.fighter();
    this.send();
    this.predict.observe({ x: this.server.x, y: this.server.y, t: this.world.state.serverTime, moveSeq: 0, displaceSeq: 0 }, this.clock);
    this.frame();
  }

  /** The synced fields of the local player the prediction reads. */
  private fighter(): LocalFighter {
    const p = this.server;
    return {
      x: p.x, y: p.y, faction: p.faction, sig: p.sig, stacksHp: p.stacksHp, stacksAs: p.stacksAs, stacksMs: p.stacksMs, effects: p.effects,
      asMult: p.asMult, speedMult: p.speedMult,
    };
  }

  get server() { return this.world.state.players.get("me")!; }
  get clock(): number { return this.now - this.down; }
  private lag(base: number): number { return base + Math.floor(this.rnd() * (this.jitter + 1)); }

  /** Queues the state as the patch of the step just run. */
  private send(): void {
    const p = this.server;
    this.patches.push({
      at: this.now + this.lag(this.down), x: Math.fround(p.x), y: Math.fround(p.y), t: this.world.state.serverTime, moveSeq: p.moveSeq,
      locked: p.attackTarget !== "", displaceSeq: p.displaceSeq, me: this.fighter(),
    });
  }

  /** `uplinkMs`: this message alone is held up this long (a retransmit, a stall), the rest of the link is as it was. */
  move(to: Vec2, uplinkMs?: number): void {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.motion.order("move", seq, this.clock, to, this.map);
    this.inbox.push({ at: this.now + (uplinkMs ?? this.lag(this.up)), type: "move", msg: { x: to.x, y: to.y, seq } });
  }

  /** The player casts a Wish that needs no aim (Swarm, Last Stand: a self cast; Freeze: pass the target's id). `castMs`: its telegraph. */
  selfCast(castMs: number, id?: string): number {
    const seq = (this.seq = (this.seq % 255) + 1);
    this.predict.noteCast(this.clock, { castMs, seq });
    const at = this.motion.predicted;
    this.inbox.push({ at: this.now + this.lag(this.up), type: "cast", msg: { slot: "wish", x: at.x, y: at.y, seq, ...(id ? { id } : {}) } });
    return seq;
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
  blink(to: Vec2, uplinkMs?: number): { landing: Vec2 | null; seq: number } {
    const landing = blinkLanding(this.map, this.clientGatesLocked, this.motion.predicted, to);
    const seq = (this.seq = (this.seq % 255) + 1);
    if (landing) this.motion.blink(seq, this.clock, landing);
    // `uplinkMs`: the cast message alone is held up this long (a retransmit, a stall), the rest of the link is as it was.
    this.inbox.push({ at: this.now + (uplinkMs ?? this.lag(this.up)), type: "cast", msg: { slot: "wish", x: to.x, y: to.y, seq } });
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
    this.motion.frame(this.clock, dt, this.usePredict ? this.predict.frameInput(this.clock, true, this.heard, [], false) : ALIVE);
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
        const events = step(this.world, TICK_MS);
        // The fx of a step reach the client before its patch (one socket, one order).
        for (const e of events) {
          if (e.type === "fx") this.fxQueue.push({ at: this.now + this.lag(this.down), fx: { ...e.fx, t: this.world.state.serverTime } as never });
        }
        this.send();
      }
      this.fxQueue = this.fxQueue.filter((q) => {
        if (q.at > this.now) return true;
        this.predict.noteFx(q.fx, "me", this.heard);
        return false;
      });
      this.patches = this.patches.filter((p) => {
        if (p.at > this.now) return true;
        this.heard = p.me;
        this.predict.observe({ x: p.x, y: p.y, t: p.t, moveSeq: p.moveSeq, locked: p.locked, displaceSeq: p.displaceSeq }, this.clock);
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

describe("a blink against the real sim: the cases a review found", () => {
  it("refused while walking: the sim keeps walking (it answers a refused cast with the echo alone), and the model takes the walk up again", () => {
    for (const [up, down] of [[40, 40], [90, 60]] as const) {
      const tag = `${up}/${down}`;
      const r = new SimRig(up, down, 0, "fire");
      r.run(300);
      const goal = centre(45, 10);
      r.move(goal);
      r.run(600);
      r.server.wishReadyAt = r.world.state.serverTime + 100_000; // the client cannot know
      const { landing, seq } = r.blink({ x: r.motion.predicted.x, y: r.motion.predicted.y + 300 });
      expect(landing, tag).not.toBeNull();
      r.run(FRAME_MS + 1);
      expect(r.motion.walking, tag).toBe(false);
      r.run(up + down + 2 * TICK_MS + 20);
      expect(r.server.moveSeq, tag).toBe(seq);
      expect(r.server.displaceSeq, tag).toBe(0);
      expect(r.motion.pendingOrders, tag).toBe(0);
      expect(r.motion.walking, tag).toBe(true);
      // It stays with the sim, a delay's walk behind its latest sample at most, instead of creeping after it for good.
      const bound = PLAYER_SPEED * ((down + 2 * TICK_MS + 40) / 1000);
      for (let i = 0; i < 6; i++) {
        r.run(300);
        expect(dist(r.motion.drawn, r.server), `${tag} +${i}`).toBeLessThan(bound);
      }
      r.run(7000);
      expect(dist(r.server, goal), tag).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
    }
  });

  it("a short refused blink (the 64 u minimum) snaps back within a round trip", () => {
    const r = new SimRig(40, 40, 0, "fire");
    r.run(300);
    const origin = { x: r.server.x, y: r.server.y };
    r.server.wishReadyAt = r.world.state.serverTime + 100_000;
    const { landing } = r.blink({ x: origin.x + 30, y: origin.y }); // nearer than 64 u: it still blinks 64
    expect(dist(origin, landing!)).toBeCloseTo(64, 0);
    r.run(FRAME_MS + 1);
    expect(dist(r.motion.drawn, landing!)).toBeLessThan(1e-6);
    r.run(2 * 40 + 2 * TICK_MS); // a round trip, and the tick the sim waits for
    expect(r.motion.pendingOrders).toBe(0);
    expect(dist(r.motion.drawn, origin)).toBeLessThan(0.01);
    expect(r.motion.visualOffset).toBe(0);
  });

  it("an accepted blink whose ack is late (the cast stalls on the uplink 500 to 1400 ms, or the link itself is 440 ms round trip) does not pop back and forward", () => {
    const cases: Array<{ tag: string; up: number; down: number; stall?: number }> = [
      { tag: "stall 500", up: 60, down: 60, stall: 500 }, { tag: "stall 700", up: 60, down: 60, stall: 700 },
      { tag: "stall 1400", up: 60, down: 60, stall: 1400 }, { tag: "rtt 440", up: 220, down: 220 },
      { tag: "rtt 440 + stall", up: 220, down: 220, stall: 700 },
    ];
    for (const { tag, up, down, stall } of cases) {
      const r = new SimRig(up, down, 0, "fire");
      r.run(300);
      const from = { x: r.server.x, y: r.server.y };
      const { landing } = r.blink({ x: from.x + 400, y: from.y }, stall);
      r.run(FRAME_MS + 1);
      const first = r.drawn.length;
      r.run((stall ?? up) + down + 2000);
      expect(r.server.displaceSeq, tag).toBe(1);
      expect(r.motion.pendingOrders, tag).toBe(0);
      expect(r.maxStep(first), tag).toBeLessThan(2); // one jump (the press), then nothing
      expect(dist(r.server, landing!), tag).toBeLessThan(1e-3);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.01);
    }
  });

  it("from follow mode (a lock on a dummy): the sim drops the lock, the landings differ by the chase's lead, and nothing pops", () => {
    const r = new SimRig(60, 60, 0, "fire");
    const dummy = addMob(r.world, { kind: "dummy", name: "d", at: centre(25, 10) });
    r.run(300);
    r.target(dummy);
    r.run(700);
    expect(r.motion.mode).toBe("follow");
    expect(r.server.attackTarget).toBe(dummy);
    const { landing } = r.blink({ x: r.motion.predicted.x, y: r.motion.predicted.y + 400 });
    expect(landing).not.toBeNull();
    expect(r.motion.visualOffset).toBe(0); // no older offset rides along to the landing
    r.run(FRAME_MS + 1);
    const first = r.drawn.length;
    r.run(1500);
    expect(r.server.attackTarget).toBe("");
    expect(r.motion.mode).toBe("predict");
    expect(r.server.displaceSeq).toBe(1);
    expect(r.motion.pendingOrders).toBe(0);
    // The server blinked from where the chase had it, a few units ahead of the model's follow position: absorbed smoothly.
    expect(dist(r.server, landing!)).toBeLessThan(PLAYER_SPEED * ((60 + 60 + TICK_MS) / 1000) + 2);
    expect(r.maxStep(first)).toBeLessThan(WALK_STEP + 2);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.1);
  });

  describe("with the coliseum's gates locked", () => {
    /** A 30 x 20 room with a 10 x 10 coliseum block at tiles 10..19 x 5..14: a wall ring with a two tile gate in its west side. */
    function miniColiseum(): GameMap {
      const tiles = new Uint8Array(30 * 20).fill(TILE_FLOOR);
      for (let x = 0; x < 30; x++) { tiles[x] = TILE_WALL; tiles[19 * 30 + x] = TILE_WALL; }
      for (let y = 0; y < 20; y++) { tiles[y * 30] = TILE_WALL; tiles[y * 30 + 29] = TILE_WALL; }
      const map = mapFromTiles(30, 20, tiles);
      const gate = [{ x: 10, y: 9 }, { x: 10, y: 10 }];
      for (let y = 5; y <= 14; y++) {
        for (let x = 10; x <= 19; x++) {
          map.regionGrid[y * 30 + x] = REGION_COLISEUM;
          if (x === 10 || x === 19 || y === 5 || y === 14) map.tiles[y * 30 + x] = TILE_WALL;
        }
      }
      for (const t of gate) map.tiles[t.y * 30 + t.x] = TILE_FLOOR;
      map.coliseum = { ...map.coliseum, rect: { x: 10, y: 5, w: 10, h: 10 }, gates: [{ side: "w", tiles: gate, x: 336, y: 320 }] };
      map.spawns = [centre(14, 9)];
      return map;
    }
    const inside = centre(14, 9);

    it("both sides lock: the landing is the shortened point inside the arena, on both, with no pop", () => {
      const r = new SimRig(40, 40, 0, "fire", "sword", { map: miniColiseum(), start: inside, gatesLocked: true });
      r.run(300);
      const { landing, seq } = r.blink({ x: inside.x + 400, y: inside.y }); // the arena's east wall is nearer than 300 u
      expect(landing).not.toBeNull();
      expect(dist(inside, landing!)).toBeLessThan(299);
      r.run(FRAME_MS + 1);
      const first = r.drawn.length;
      r.run(800);
      expect(r.server.moveSeq).toBe(seq);
      expect(r.server.displaceSeq).toBe(1);
      expect(dist(r.server, landing!)).toBeLessThan(1e-3);
      expect(r.maxStep(first)).toBeLessThan(2);
      expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
    });

    it("the client has not heard the gates lock yet and predicts a blink in through the gate: the sim refuses it, free, and the drawn fighter snaps back at the ack", () => {
      const outsideGate = { x: 308, y: 304 }; // just west of the ring's wall, on the gate's row
      const r = new SimRig(40, 40, 0, "fire", "sword", { map: miniColiseum(), start: outsideGate, gatesLocked: true, clientGatesLocked: false });
      r.run(300);
      const { landing, seq } = r.blink({ x: outsideGate.x + 100, y: outsideGate.y }); // through the gate to the arena (open); sealed (locked)
      expect(landing).not.toBeNull();
      expect(landing!.x).toBeGreaterThan(400);
      r.run(FRAME_MS + 1);
      expect(dist(r.motion.drawn, landing!)).toBeLessThan(1e-6);
      r.run(2 * 40 + 2 * TICK_MS + 20);
      expect(r.server.moveSeq).toBe(seq);
      expect(r.server.displaceSeq).toBe(0);
      expect(r.server.wishReadyAt).toBeLessThanOrEqual(r.world.state.serverTime); // a refusal costs nothing
      expect(r.motion.pendingOrders).toBe(0);
      expect(dist(r.motion.drawn, outsideGate)).toBeLessThan(0.01);
    });
  });

  it("a displacement lands while our own blink is in flight (the sim's test-only displace): one jump of the pull, never back to the origin and forward again", () => {
    const r = new SimRig(60, 60, 0, "fire");
    r.run(400);
    const origin = { x: r.server.x, y: r.server.y };
    r.blink({ x: origin.x + 400, y: origin.y });
    r.run(FRAME_MS + 1);
    const first = r.drawn.length;
    r.run(10);
    r.pull({ x: origin.x, y: origin.y + 80 }); // before the cast (60 ms up) reaches the sim: it then blinks from the pulled position
    r.run(1500);
    expect(r.server.displaceSeq).toBe(2);
    expect(r.motion.pendingOrders).toBe(0);
    const big: number[] = [];
    for (let i = first + 1; i < r.drawn.length; i++) {
      const d = dist(r.drawn[i]!, r.drawn[i - 1]!);
      if (d > 10) big.push(Math.round(d));
    }
    expect(big).toEqual([80]);
    expect(dist(r.motion.drawn, r.server)).toBeLessThan(0.01);
  });
});

describe("a blink and a click sent after it, both held up and handled by the sim in one tick", () => {
  const goalOf = (landing: Vec2): Vec2 => ({ x: landing.x, y: landing.y + 3 * TILE });

  it("accepted: one jump of the press, no pop of the blink's 300 u back and forward (the echo names the click, whose order was forgotten)", () => {
    for (const stall of [500, 700, 1000]) {
      const r = new SimRig(30, 30, 0, "fire");
      r.run(300);
      const { landing } = r.blink({ x: r.server.x + 400, y: r.server.y }, stall);
      r.run(50);
      const goal = goalOf(landing!);
      r.move(goal, stall - 49); // arrives a millisecond after the blink: the sim handles both in one tick
      r.run(FRAME_MS + 1);
      const first = r.drawn.length;
      r.run(stall + 3500);
      expect(r.server.displaceSeq, `${stall}`).toBe(1);
      expect(r.motion.pendingOrders, `${stall}`).toBe(0);
      expect(r.motion.pendingJump, `${stall}`).toBe(false);
      // The model walked the click's 96 u to its end while the sim only started it: at most one correction of that size.
      expect(r.maxStep(first), `${stall}`).toBeLessThan(100);
      expect(dist(r.server, goal), `${stall}`).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(0.1);
    }
  });

  it("refused (still cooling down): one snap back, then the click's walk from where the sim is, kept up with", () => {
    for (const stall of [500, 700, 1000]) {
      const r = new SimRig(30, 30, 0, "fire");
      r.run(300);
      r.server.wishReadyAt = r.world.state.serverTime + 100_000;
      const { landing } = r.blink({ x: r.server.x + 400, y: r.server.y }, stall);
      r.run(50);
      const goal = goalOf(landing!);
      r.move(goal, stall - 49);
      r.run(FRAME_MS + 1);
      const first = r.drawn.length;
      for (let i = 0; i < stall + 800 && r.motion.pendingJump; i++) r.run(1);
      expect(r.motion.pendingJump, `${stall}`).toBe(false);
      r.run(300);
      expect(r.motion.walking, `${stall}`).toBe(true);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(PLAYER_SPEED * ((30 + 2 * TICK_MS + 40) / 1000));
      r.run(stall + 3500);
      expect(r.server.displaceSeq, `${stall}`).toBe(0);
      expect(r.motion.pendingOrders, `${stall}`).toBe(0);
      let big = 0;
      for (let i = first + 1; i < r.drawn.length; i++) if (dist(r.drawn[i]!, r.drawn[i - 1]!) > 20) big++;
      expect(big, `${stall}`).toBeLessThanOrEqual(1);
      expect(dist(r.server, goal), `${stall}`).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), `${stall}`).toBeLessThan(0.1);
    }
  });
});

describe("Swarm: an escape Wish that drops only the lock, so the walk in hand goes on after its 250 ms cast", () => {
  const runWalk = (up: number, down: number) => {
    const r = new SimRig(up, down, 0, "plague", "sword", { usePredict: true });
    r.run(300);
    const goal = centre(50, 10);
    r.move(goal);
    r.run(600);
    const first = r.drawn.length;
    const seq = r.selfCast(SWARM_CAST_MS);
    return { r, goal, first, seq };
  };

  it("while walking: the sim keeps the path, the model holds for the cast root and walks on with it: no overshoot, no slide back", () => {
    for (const [up, down] of [[30, 30], [60, 60], [100, 100]] as const) {
      const tag = `${up}/${down}`;
      const { r, goal, first, seq } = runWalk(up, down);
      // The cast has landed (up, a tick, the 250 ms root and the patch back) and the sim goes on walking.
      r.run(up + 2 * TICK_MS + SWARM_CAST_MS + down + 100);
      expect(r.server.moveSeq, tag).toBe(seq);
      expect(r.world.players.get("me")!.cast, tag).toBeNull();
      const x0 = r.server.x;
      r.run(1000);
      expect(r.server.x - x0, `${tag} walked on`).toBeGreaterThan(PLAYER_SPEED * 0.8);
      r.run(9000);
      let back = 0;
      for (let i = first + 1; i < r.drawn.length; i++) back += Math.max(0, r.drawn[i - 1]!.x - r.drawn[i]!.x);
      expect(back, `${tag} backward`).toBeLessThan(1);
      expect(dist(r.server, goal), tag).toBeLessThan(0.5);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
    }
  });

  it("the model stands still for the root and is never ahead of the sim's path by more than the usual lead", () => {
    const { r, first } = runWalk(60, 60);
    r.run(600);
    // Past the root and the walk resumed: the drawn fighter leads the sim by about a delay's walk, never by more.
    let over = 0;
    for (let i = first; i < r.drawn.length; i++) over = Math.max(over, r.drawn[i]!.x - r.server.x);
    expect(over).toBeLessThan(PLAYER_SPEED * ((60 + 60 + 2 * TICK_MS + SWARM_CAST_MS) / 1000));
  });

  it("while locked on a dummy (the model follows the chase): the sim drops the lock and stands, the model leaves follow and stands with it", () => {
    for (const [up, down] of [[30, 30], [60, 60], [100, 100]] as const) {
      const tag = `${up}/${down}`;
      const r = new SimRig(up, down, 0, "plague", "sword", { usePredict: true });
      const dummy = addMob(r.world, { kind: "dummy", name: "d", at: centre(25, 10) }); // within TARGET_RANGE, 14 tiles of chase
      r.run(300);
      r.target(dummy);
      r.run(900);
      expect(r.motion.mode, tag).toBe("follow");
      expect(r.server.attackTarget, tag).toBe(dummy);
      r.selfCast(SWARM_CAST_MS);
      r.run(up + 2 * TICK_MS + SWARM_CAST_MS + down + 300);
      expect(r.server.attackTarget, tag).toBe("");
      expect(r.motion.mode, tag).toBe("predict");
      const x0 = r.server.x;
      const first = r.drawn.length;
      r.run(1500);
      expect(r.server.x, `${tag} stands`).toBe(x0);
      expect(r.motion.walking, tag).toBe(false);
      let back = 0;
      for (let i = first + 1; i < r.drawn.length; i++) back += Math.max(0, r.drawn[i - 1]!.x - r.drawn[i]!.x);
      expect(back, `${tag} backward`).toBeLessThan(1);
      expect(dist(r.motion.drawn, r.server), tag).toBeLessThan(0.1);
    }
  });
});

describe("a cast the sim refuses frees its slot at the echo of its order number", () => {
  it("Freeze on a target the sim refuses (out of its reach): pending until the echo, then answered; the predicted root is dropped, the walk goes on", () => {
    for (const [up, down] of [[40, 40], [100, 100]] as const) {
      const tag = `${up}/${down}`;
      const r = new SimRig(up, down, 0, "frost", "sword", { usePredict: true });
      const far = addMob(r.world, { kind: "dummy", name: "far", at: centre(55, 25) }); // about 1700 u away: far past 450 + 32
      r.run(300);
      r.move(centre(20, 10));
      r.run(500);
      const seq = r.selfCast(FREEZE_CAST_MS, far);
      const sent = { slot: "wish", seq, readyAt: r.server.wishReadyAt, until: r.now + 600 };
      expect(r.motion.orderPending(seq), tag).toBe(true);
      expect(castUnanswered(sent, "wish", r.now, r.server.wishReadyAt, r.motion.orderPending(seq)), tag).toBe(true);
      r.run(up + down + 2 * TICK_MS + 20);
      expect(r.server.moveSeq, tag).toBe(seq); // echoed though refused
      expect(r.server.wishReadyAt, tag).toBe(sent.readyAt); // nothing spent
      // The ready time never changed, yet the slot is free: the ack alone answered the cast.
      expect(r.motion.orderPending(seq), tag).toBe(false);
      expect(castUnanswered(sent, "wish", r.now, r.server.wishReadyAt, r.motion.orderPending(seq)), tag).toBe(false);
      expect(r.predict.castEndsAt(r.clock + r.motion.delay), tag).toBe(0); // the predicted root is gone with the refusal
      r.run(300);
      expect(r.motion.walking, tag).toBe(true);
    }
  });
});

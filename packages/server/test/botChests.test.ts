// How a bot treats a camp's shared chest (roguelike R5): bots/chestHunt.ts (pure: which option, pick or walk or nothing) and the
// way BotClient carries it out (one `choose`, a `move`, never a retry). The brain is driven by hand over a fake room and a fake
// clock, as in botLock.test.ts; nothing here touches a socket or the real server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHEST_RANGE, CHEST_SECONDS, mapFromTiles, PLAYER_SPEED, TILE, TILE_FLOOR, TILE_WALL, type TimedFx, type Vec2,
} from "@raid/shared";
import { BotClient } from "../src/bots/BotClient";
import {
  CHEST_HUNT, chooseOption, ChestHunter, optionScore, type ChestInput, type ChestLike, type ChestSelf,
} from "../src/bots/chestHunt";

const ME = "me";
const FIRE_SWORD: Pick<ChestSelf, "faction" | "weapons" | "build"> = { faction: "fire", weapons: ["sword", null], build: null };

// ---------------------------------------------------------------------------------------------------------------- the options

describe("which chest option a bot takes", () => {
  it("is the first free one it can use when nothing sets them apart", () => {
    // Witness and Bounty Hunter are both a +damage rider for a Fire bot: the same worth, so the first stands.
    expect(optionScore("witness", FIRE_SWORD)).toBe(optionScore("bountyHunter", FIRE_SWORD));
    expect(chooseOption(["witness", "bountyHunter"], ["", ""], FIRE_SWORD)).toBe(0);
    expect(chooseOption(["bountyHunter", "witness"], ["", ""], FIRE_SWORD)).toBe(0);
  });

  it("passes over an option somebody took and one it holds at the top rank", () => {
    const build = { thickHide: 2 };
    expect(chooseOption(["thickHide", "whetstone", "swiftBoots"], ["", "", ""], { ...FIRE_SWORD, build })).toBe(1);
    expect(chooseOption(["whetstone", "swiftBoots"], ["other", ""], FIRE_SWORD)).toBe(1);
    expect(chooseOption(["whetstone", "swiftBoots", "thickHide"], ["a", "b", "c"], FIRE_SWORD), "all taken").toBe(-1);
    expect(chooseOption(["whetstone", "swiftBoots"], ["", ""], { ...FIRE_SWORD, build: { whetstone: 2, swiftBoots: 2 } }), "all maxed").toBe(-1);
    expect(chooseOption([], [], FIRE_SWORD), "an empty chest").toBe(-1);
  });

  it("takes a skill it holds at rank 1 (that gives rank 2), and counts the upgrade a little", () => {
    const build = new Map([["whetstone", 1]]);
    expect(chooseOption(["whetstone"], [""], { ...FIRE_SWORD, build })).toBe(0);
    expect(optionScore("whetstone", { ...FIRE_SWORD, build })).toBeGreaterThan(optionScore("whetstone", FIRE_SWORD));
  });

  it("prefers its own faction's skill and the fight stats (damage, attack speed, hp) to the walking ones", () => {
    // Fire has no live passive until R4b: a Plague bot's own pool (Pestilence) beats the neutrals.
    const plague = { faction: "plague", weapons: ["bow", null] as const, build: null };
    expect(chooseOption(["whetstone", "pestilence", "swiftBoots"], ["", "", ""], plague)).toBe(1);
    expect(optionScore("whetstone", FIRE_SWORD)).toBeGreaterThan(optionScore("swiftBoots", FIRE_SWORD));
    expect(chooseOption(["swiftBoots", "whetstone"], ["", ""], FIRE_SWORD)).toBe(1);
  });

  it("holds back a skill that needs a weapon it does not carry", () => {
    // Quickdraw is for the bow and axe (the wand's floor is its whole windup): a sword bot takes the boots over it, an axe bot the other way round.
    expect(chooseOption(["quickdraw", "swiftBoots"], ["", ""], FIRE_SWORD)).toBe(1);
    expect(chooseOption(["quickdraw", "swiftBoots"], ["", ""], { ...FIRE_SWORD, weapons: ["axe", null] })).toBe(0);
  });

  it("is a pure function of what it is given: the same chest, the same answer, nothing changed", () => {
    const options = ["swiftBoots", "thickHide", "whetstone"];
    const taken = ["", "", ""];
    const build = { whetstone: 1 };
    const first = chooseOption(options, taken, { ...FIRE_SWORD, build });
    for (let i = 0; i < 5; i++) expect(chooseOption(options, taken, { ...FIRE_SWORD, build })).toBe(first);
    expect(options).toEqual(["swiftBoots", "thickHide", "whetstone"]);
    expect(taken).toEqual(["", "", ""]);
    expect(build).toEqual({ whetstone: 1 });
  });

  it("still takes an id the catalog does not know (newer server content)", () => {
    expect(chooseOption(["fromTheFuture"], [""], FIRE_SWORD)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------- the hunt (pure)

const NOW = 50_000;
const SERVER = 1_000_000;

function chest(id: string, x: number, y: number, o: Partial<ChestLike> = {}): ChestLike {
  return {
    id, kind: "reward", x, y, expiresAt: SERVER + CHEST_SECONDS * 1000,
    options: ["whetstone", "swiftBoots", "thickHide"], takenBy: ["", "", ""], pickers: [], ...o,
  };
}

/** One scene for the pure hunt: a bot at the origin, chests by id, a straight-line walk and open sight, all overridable. */
class Scene {
  now = NOW;
  serverTime = SERVER;
  self: ChestSelf = { id: ME, x: 0, y: 0, faction: "fire", weapons: ["sword", null], build: null };
  chests: ChestLike[] = [];
  fighting = false;
  retreating = false;
  inColiseum = false;
  sight = true;
  walkLen: (to: Vec2) => number | null = (to) => Math.hypot(to.x - this.self.x, to.y - this.self.y);
  walkCalls = 0;
  readonly hunter = new ChestHunter();

  input(): ChestInput {
    return {
      now: this.now, serverTime: this.serverTime, self: this.self, chests: this.chests,
      walk: (to) => { this.walkCalls++; return this.walkLen(to); },
      sight: () => this.sight, fighting: this.fighting, retreating: this.retreating, inColiseum: this.inColiseum,
    };
  }

  /** One decision, `ms` after the last (the server clock runs with it). */
  step(ms = 50) {
    this.now += ms;
    this.serverTime += ms;
    return this.hunter.decide(this.input());
  }
}

describe("the chest hunt", () => {
  it("picks once at a chest in range with sight, and never asks for it again", () => {
    const s = new Scene();
    s.chests = [chest("c1", 60, 0)];
    expect(s.step()).toMatchObject({ kind: "pick", chest: "c1", option: 2 }); // thick hide: hp and both resists
    for (let i = 0; i < 20; i++) expect(s.step()).toEqual({ kind: "none" });
    expect(s.hunter.tried("c1")).toBe(true);
  });

  it("picks from inside the range the server checks, less the client panel's slack", () => {
    expect(CHEST_HUNT.pickRange).toBe(CHEST_RANGE - 8);
    const near = new Scene();
    near.chests = [chest("c1", CHEST_HUNT.pickRange - 1, 0)];
    expect(near.step().kind).toBe("pick");
    const far = new Scene();
    far.chests = [chest("c1", CHEST_HUNT.pickRange + 1, 0)];
    expect(far.step().kind, "just past it: walk closer").toBe("walk");
  });

  it("skips when every option is taken or maxed", () => {
    const taken = new Scene();
    taken.chests = [chest("c1", 40, 0, { takenBy: ["a", "b", "c"] })];
    expect(taken.step()).toMatchObject({ kind: "pick", chest: "c1", option: -1 });

    const maxed = new Scene();
    maxed.self = { ...maxed.self, build: { whetstone: 2, swiftBoots: 2, thickHide: 2 } };
    maxed.chests = [chest("c1", 40, 0)];
    expect(maxed.step()).toMatchObject({ kind: "pick", chest: "c1", option: -1 });
  });

  it("takes the free option when the others are gone", () => {
    const s = new Scene();
    s.chests = [chest("c1", 40, 0, { takenBy: ["a", "", "b"] })];
    expect(s.step()).toMatchObject({ kind: "pick", option: 1 });
  });

  it("walks to a chest it cannot reach from here, and picks on arrival", () => {
    const s = new Scene();
    s.chests = [chest("c1", 400, 0)];
    expect(s.step()).toMatchObject({ kind: "walk", chest: "c1", to: { x: 400, y: 0 } });
    s.self = { ...s.self, x: 330 }; // 70 u away now
    expect(s.step()).toMatchObject({ kind: "pick", chest: "c1" });
  });

  it("walks to a chest it cannot see until it can, and does not pick through a wall", () => {
    const s = new Scene();
    s.chests = [chest("c1", 50, 0)];
    s.sight = false;
    expect(s.step().kind).toBe("walk");
    s.sight = true;
    expect(s.step().kind).toBe("pick");
  });

  it("ignores a chest that has expired, and one the state still shows in its last instant", () => {
    const s = new Scene();
    s.chests = [chest("gone", 40, 0, { expiresAt: SERVER - 1 })];
    expect(s.step()).toEqual({ kind: "none" });
    // 350 ms of life is too little for a message to make it: no pick (and so no wasted one try)...
    const late = new Scene();
    late.chests = [chest("late", 40, 0, { expiresAt: SERVER + 50 + CHEST_HUNT.pickMarginMs })];
    expect(late.step()).toEqual({ kind: "none" });
    expect(late.hunter.tried("late")).toBe(false);
  });

  it("does not walk to a chest it cannot reach before it vanishes", () => {
    const s = new Scene();
    const reachable = (CHEST_SECONDS * 1000 - CHEST_HUNT.arriveSlackMs) / 1000 * PLAYER_SPEED * CHEST_HUNT.paceShare + CHEST_HUNT.pickRange;
    s.chests = [chest("far", reachable + 200, 0)];
    expect(s.step()).toEqual({ kind: "none" });
    s.chests = [chest("edge", reachable - 100, 0)];
    expect(s.step().kind).toBe("walk");
  });

  it("does not walk to a chest with no path", () => {
    const blocked = new Scene();
    blocked.chests = [chest("c1", 400, 0)];
    blocked.walkLen = () => null;
    expect(blocked.step()).toEqual({ kind: "none" });
  });

  it("decides a walk from what a player sees from afar (a position, a clock, its own pick), not from the options or who took them", () => {
    // A far chest whose three options are all taken still draws the walk: from here its contents are not on show.
    const far = new Scene();
    far.chests = [chest("c1", 400, 0, { takenBy: ["a", "b", "c"] })];
    expect(far.step()).toMatchObject({ kind: "walk", chest: "c1" });
    // ...and on arrival, where the panel shows them, the bot reads them: nothing usable is a skip.
    far.self = { ...far.self, x: 330 };
    expect(far.step()).toMatchObject({ kind: "pick", chest: "c1", option: -1 });

    // Beyond pick range nothing reads the contents at all, however many thinks go by; within it they are read.
    let reads = 0;
    const watched = (id: string, x: number): ChestLike => {
      const base = chest(id, x, 0);
      return {
        ...base,
        get options() { reads++; return ["whetstone", "swiftBoots", "thickHide"]; },
        get takenBy() { reads++; return ["", "", ""]; },
      };
    };
    const s = new Scene();
    s.chests = [watched("far", 400), watched("farther", 600)];
    for (let i = 0; i < 5; i++) expect(s.step().kind).toBe("walk");
    expect(reads, "the walk never looked inside").toBe(0);
    s.self = { ...s.self, x: 340 };
    expect(s.step()).toMatchObject({ kind: "pick", chest: "far" });
    expect(reads).toBeGreaterThan(0);
  });

  it("two far chests are told apart by distance alone: the nearer wins even if the farther one has the better contents", () => {
    const s = new Scene();
    s.chests = [chest("near", 300, 0, { takenBy: ["a", "b", "c"] }), chest("far", 500, 0)];
    expect(s.step()).toMatchObject({ kind: "walk", chest: "near" });
  });

  it("does not walk into a fight for a far chest, nor run to one at low hp, but picks at a chest already in range", () => {
    const s = new Scene();
    s.fighting = true;
    s.chests = [chest("far", 12 * TILE + 100, 0)];
    expect(s.step(), "past 12 tiles").toEqual({ kind: "none" });
    s.chests = [chest("near", 12 * TILE - 40, 0)];
    expect(s.step(), "inside 12 tiles").toMatchObject({ kind: "walk", chest: "near" });

    const low = new Scene();
    low.retreating = true;
    low.chests = [chest("near", 200, 0)];
    expect(low.step()).toEqual({ kind: "none" });
    low.chests = [chest("here", 40, 0)];
    expect(low.step(), "a pick costs no walking").toMatchObject({ kind: "pick", chest: "here" });

    const fight = new Scene();
    fight.fighting = true;
    fight.chests = [chest("here", 40, 0)];
    expect(fight.step().kind, "and none of the fight").toBe("pick");
  });

  it("gives up on a walk that stops closing in, and never goes back to that chest", () => {
    const s = new Scene();
    s.chests = [chest("c1", 400, 0)];
    expect(s.step().kind).toBe("walk");
    let kinds: string[] = [];
    for (let t = 0; t < CHEST_HUNT.stallMs + 500; t += 50) kinds.push(s.step().kind); // the bot never moves
    expect(kinds.at(-1)).toBe("none");
    expect(s.hunter.stats.gaveUp).toBe(1);
    kinds = [];
    for (let i = 0; i < 40; i++) kinds.push(s.step().kind);
    expect(new Set(kinds)).toEqual(new Set(["none"]));
  });

  it("a fight that keeps interrupting the walk does not reset the stall count: the record is the chest's, and counts walking only", () => {
    // A chest 500 u off: walkable in peace, past fightWalk (12 tiles) while fighting. The bot is stuck and never moves.
    const s = new Scene();
    s.chests = [chest("c1", 500, 0)];
    let gaveUp = -1;
    for (let round = 0; round < 8 && gaveUp < 0; round++) {
      s.fighting = false;
      for (let t = 0; t < 1000; t += 50) if (s.step().kind === "none") { gaveUp = round; break; } // 1 s of walking...
      s.fighting = true;
      s.step(); // ...then a fight tick that drops the walk, and a walk again
    }
    expect(gaveUp, "given up on in the fourth round of walking, 3 s of it in all").toBeGreaterThanOrEqual(2);
    expect(gaveUp).toBeLessThanOrEqual(3);
    expect(s.hunter.stats.gaveUp).toBe(1);
    expect(s.hunter.stats.walks, "one chest, one walk, however often it was interrupted").toBe(1);
    expect(s.hunter.tried("c1")).toBe(true);
  });

  it("time spent away from a chest (fighting, retreating) is not stalling: the walk resumes with what it had", () => {
    const s = new Scene();
    s.chests = [chest("c1", 500, 0)];
    for (let t = 0; t < 2000; t += 50) expect(s.step().kind).toBe("walk"); // 2 s of walking, going nowhere
    s.fighting = true;
    for (let t = 0; t < 6000; t += 500) expect(s.step(500).kind).toBe("none"); // 6 s of fighting (the chest is up for 15)
    s.fighting = false;
    for (let t = 0; t < 800; t += 50) expect(s.step().kind, "0.8 s more walking: 2.8 s of the 3").toBe("walk");
    expect(s.hunter.stats.gaveUp).toBe(0);
    for (let t = 0; t < 600; t += 50) s.step();
    expect(s.hunter.stats.gaveUp).toBe(1);
  });

  it("a record for a chest that has gone from the state is dropped, and a new chest starts fresh", () => {
    const s = new Scene();
    s.chests = [chest("c1", 500, 0)];
    for (let t = 0; t < 2500; t += 50) s.step();
    s.chests = [];
    s.step();
    s.chests = [chest("c2", 500, 0)];
    for (let t = 0; t < 2500; t += 50) expect(s.step().kind).toBe("walk");
    expect(s.hunter.stats.gaveUp).toBe(0);
    expect(s.hunter.stats.walks).toBe(2);
  });

  it("does not give up on a walk that keeps closing in", () => {
    const s = new Scene();
    s.chests = [chest("c1", 1000, 0)];
    for (let i = 0; i < 100; i++) {
      s.self = { ...s.self, x: s.self.x + 5 }; // 100 u/s
      expect(s.step().kind).toBe("walk");
    }
    expect(s.hunter.stats.gaveUp).toBe(0);
  });

  it("leaves a chest it has already picked at, and one in another kind of container", () => {
    const s = new Scene();
    s.chests = [chest("mine", 40, 0, { pickers: ["x", ME] }), { ...chest("box", 40, 0), kind: "chest" }];
    expect(s.step()).toEqual({ kind: "none" });
    expect(s.hunter.tried("mine")).toBe(true);
  });

  it("goes to the nearest of two chests, one at a time", () => {
    const s = new Scene();
    s.chests = [chest("b", 500, 0), chest("a", 300, 0)];
    expect(s.step()).toMatchObject({ kind: "walk", chest: "a" });
  });

  it("looks at no chest in the coliseum", () => {
    const s = new Scene();
    s.inColiseum = true;
    s.chests = [chest("c1", 40, 0)];
    expect(s.step()).toEqual({ kind: "none" });
  });

  it("does not search for a path every think", () => {
    const s = new Scene();
    s.chests = [chest("c1", 400, 0)];
    for (let i = 0; i < 20; i++) s.step(); // one second
    expect(s.walkCalls).toBeLessThanOrEqual(1 + Math.ceil(1000 / CHEST_HUNT.walkCacheMs));
  });
});

// ---------------------------------------------------------------------------------------------------------------- the bot

interface FakeFighter {
  x: number; y: number; status: string; weapon0: string; weapon1: string; slot: number; attackTarget: string;
  [k: string]: unknown;
}
type Sent = Array<{ type: string; msg: Record<string, unknown> }>;

/** The private parts of the brain the test reaches into. */
interface Brain {
  room: unknown;
  map: unknown;
  think(): void;
  onToast(text: string): void;
  onFx(fx: TimedFx): void;
  chestChoices: ReadonlyMap<string, number>;
  chestStats: { seen: number; tried: number; taken: number; skipped: number };
  attacking: boolean;
}

const W = 60;
const H = 20;
function arena(): ReturnType<typeof mapFromTiles> {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let i = 0; i < W; i++) { tiles[i] = TILE_WALL; tiles[(H - 1) * W + i] = TILE_WALL; }
  for (let i = 0; i < H; i++) { tiles[i * W] = TILE_WALL; tiles[i * W + W - 1] = TILE_WALL; }
  return mapFromTiles(W, H, tiles);
}

const START = { x: 600, y: 300 };
const CLOCK = 100_000;
const SERVER_NOW = 5_000_000;

function rewardChest(id: string, x: number, y: number, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, kind: "reward", x, y, label: "", items: [], camp: 1, expiresAt: SERVER_NOW + CHEST_SECONDS * 1000,
    options: ["whetstone", "swiftBoots", "thickHide"], takenBy: ["", "", ""], pickers: [], ...o,
  };
}

interface BotScene {
  b: Brain;
  sent: Sent;
  me: FakeFighter;
  state: { serverTime: number; inColiseum: boolean; players: Map<string, FakeFighter>; containers: Map<string, Record<string, unknown>> };
  tick(ms?: number): void;
  types(): string[];
  /** The `choose` messages sent. */
  chooses(): Array<Record<string, unknown>>;
}

function scene(opts: { me?: Partial<FakeFighter>; foes?: Record<string, Partial<FakeFighter>> } = {}): BotScene {
  const players = new Map<string, FakeFighter>();
  const base = (o: Partial<FakeFighter>): FakeFighter => ({ ...START, status: "alive", weapon0: "sword", weapon1: "", slot: 0, attackTarget: "", ...o });
  const me = Object.assign(base(opts.me ?? {}), {
    faction: "fire", hp: 500, maxHp: 500, stacksHp: 0, stacksAs: 0, stacksMs: 0, mobKills: 0, drawStartedAt: 0, readyAt: 0, build: new Map<string, number>(),
  });
  players.set(ME, me);
  for (const [id, o] of Object.entries(opts.foes ?? {})) players.set(id, base(o));
  const containers = new Map<string, Record<string, unknown>>();
  const sent: Sent = [];
  const b = new BotClient() as unknown as Brain;
  b.map = arena();
  const state = {
    phase: "active", serverTime: SERVER_NOW, raidStartedAt: 0, inColiseum: false, gatesLocked: false, players, mobs: new Map(), containers,
  };
  b.room = { sessionId: ME, send: (type: string, msg: Record<string, unknown>) => sent.push({ type, msg }), state };
  return {
    b, sent, me, state,
    tick(ms = 50) { b.think(); vi.advanceTimersByTime(ms); state.serverTime += ms; },
    types() { return sent.map((m) => m.type); },
    chooses() { return sent.filter((m) => m.type === "choose").map((m) => m.msg); },
  };
}

describe("a bot at a camp's shared chest", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(CLOCK); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends one choose with the best free option it can use, and never another for that chest", () => {
    const s = scene();
    s.state.containers.set("r1", rewardChest("r1", START.x + 50, START.y));
    s.tick();
    expect(s.chooses()).toEqual([{ chest: "r1", pick: 2 }]); // thick hide
    expect(s.sent[0]).toEqual({ type: "choose", msg: { chest: "r1", pick: 2 } });
    // The server has not answered yet (or refused it): the state never changes, and the bot never asks again.
    for (let i = 0; i < 100; i++) s.tick();
    expect(s.chooses()).toHaveLength(1);
    expect(s.b.chestChoices.get("r1")).toBe(1);
    expect(s.types().filter((t) => t === "aim" || t === "attack" || t === "release")).toEqual([]);
  });

  it("takes the first free option when the first ones are gone", () => {
    const s = scene();
    s.state.containers.set("r1", rewardChest("r1", START.x + 50, START.y, { options: ["thickHide", "whetstone", "swiftBoots"], takenBy: ["rival", "", ""] }));
    s.tick();
    expect(s.chooses()).toEqual([{ chest: "r1", pick: 1 }]);
  });

  it("skips when every option is taken, or it holds every one at the top rank", () => {
    const taken = scene();
    taken.state.containers.set("r1", rewardChest("r1", START.x + 50, START.y, { takenBy: ["a", "b", "c"] }));
    taken.tick();
    expect(taken.chooses()).toEqual([{ chest: "r1", pick: -1 }]);

    const maxed = scene();
    maxed.me.build = new Map([["whetstone", 2], ["swiftBoots", 2], ["thickHide", 2]]);
    maxed.state.containers.set("r1", rewardChest("r1", START.x + 50, START.y));
    maxed.tick();
    expect(maxed.chooses()).toEqual([{ chest: "r1", pick: -1 }]);
  });

  it("ignores an expired chest and one that is not a reward chest", () => {
    const s = scene();
    s.state.containers.set("old", rewardChest("old", START.x + 50, START.y, { expiresAt: SERVER_NOW - 1 }));
    s.state.containers.set("weapons", { ...rewardChest("weapons", START.x + 50, START.y), kind: "chest", items: [{ def: "sword" }] });
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.chooses()).toEqual([]);
    expect(s.types().filter((t) => t === "move")).toEqual([]);
  });

  it("stops looking at a chest the moment it vanishes", () => {
    const s = scene();
    s.state.containers.set("r1", rewardChest("r1", START.x + 400, START.y));
    s.tick();
    expect(s.types()).toEqual(["move"]);
    s.state.containers.delete("r1");
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.chooses()).toEqual([]);
    expect(s.types().filter((t) => t === "move")).toHaveLength(1);
  });

  it("walks to a chest out of reach, picks on arrival, and walks to it no more", () => {
    const s = scene();
    s.state.containers.set("r1", rewardChest("r1", START.x + 400, START.y));
    s.tick();
    expect(s.sent).toEqual([{ type: "move", msg: { x: START.x + 400, y: START.y } }]);
    s.me.x = START.x + 400 - 70; // arrived, as the server's patch shows it
    s.tick();
    expect(s.chooses()).toEqual([{ chest: "r1", pick: 2 }]);
    const moves = s.types().filter((t) => t === "move").length;
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.chooses()).toHaveLength(1);
    expect(s.types().filter((t) => t === "move").length, "no more walking to it").toBe(moves);
  });

  it("does not walk to a chest across the map in 15 s", () => {
    const s = scene({ me: { x: 100 } });
    s.state.containers.set("r1", rewardChest("r1", 1800, START.y, { expiresAt: SERVER_NOW + 4000 }));
    for (let i = 0; i < 10; i++) s.tick();
    expect(s.types().filter((t) => t === "move")).toEqual([]);
  });

  it("does not walk into a fight for a far chest, and takes a near one", () => {
    // A foe is on top of it: that fight comes first, and the chest 20 tiles away waits (and vanishes).
    const far = scene({ foes: { foe: { x: START.x + 100 } } });
    far.state.containers.set("r1", rewardChest("r1", START.x - 20 * TILE, START.y));
    far.tick();
    expect(far.types()).toEqual(["target"]);
    for (let i = 0; i < 10; i++) far.tick();
    expect(far.sent.filter((m) => m.type === "move"), "no walk away from the fight").toEqual([]);
    expect(far.chooses()).toEqual([]);

    const near = scene({ foes: { foe: { x: START.x + 100 } } });
    near.state.containers.set("r1", rewardChest("r1", START.x - 8 * TILE, START.y));
    near.tick();
    expect(near.sent[0]).toEqual({ type: "move", msg: { x: START.x - 8 * TILE, y: START.y } });
  });

  it("picks at a chest in range in the middle of a fight without leaving it", () => {
    const s = scene({ foes: { foe: { x: START.x + 60 } } });
    s.me.attackTarget = "foe";
    s.state.containers.set("r1", rewardChest("r1", START.x - 50, START.y));
    s.tick();
    expect(s.sent).toEqual([{ type: "choose", msg: { chest: "r1", pick: 2 } }]);
    expect(s.types()).not.toContain("move");
    expect(s.types()).not.toContain("stop");
  });

  it("does not retry a pick that was refused", () => {
    const s = scene();
    s.state.containers.set("r1", rewardChest("r1", START.x + 50, START.y));
    s.tick();
    s.b.onToast("Too far from the chest"); // whatever the server said: the state still shows no pick
    s.b.onToast("That one is taken");
    for (let i = 0; i < 200; i++) s.tick(50);
    expect(s.chooses()).toHaveLength(1);
    expect(s.b.chestChoices.get("r1")).toBe(1);
    expect(s.b.chestStats).toEqual({ seen: 1, tried: 1, taken: 0, skipped: 0 });
  });

  it("counts the chests it saw, tried, took and skipped, from the state and from the chestTaken fx, once each", () => {
    const s = scene();
    s.state.containers.set("a", rewardChest("a", START.x + 50, START.y));
    s.state.containers.set("b", rewardChest("b", START.x - 50, START.y, { takenBy: ["x", "y", "z"] }));
    s.state.containers.set("c", rewardChest("c", START.x + 20 * TILE, START.y + 120)); // far, never picked at yet
    s.tick();
    s.tick(); // one pick per think
    expect(s.b.chestStats).toMatchObject({ seen: 3, tried: 2, taken: 0, skipped: 0 });
    // The server's answer: ours is in `pickers` and in `takenBy` for a, in `pickers` alone for b.
    const a = s.state.containers.get("a")!;
    a.takenBy = ["", "", ME];
    a.pickers = [ME];
    s.state.containers.get("b")!.pickers = ["x", ME];
    s.tick();
    s.b.onFx({ kind: "chestTaken", chest: "a", by: ME, option: 2, t: 0 }); // the fx for a pick the state already showed
    s.b.onFx({ kind: "chestTaken", chest: "b", by: "other", option: 0, t: 0 }); // somebody else's
    for (let i = 0; i < 10; i++) s.tick();
    expect(s.b.chestStats).toEqual({ seen: 3, tried: 2, taken: 1, skipped: 1 });
    expect(s.chooses()).toHaveLength(2);
  });

  it("takes its pick from the chestTaken fx when the chest is gone from the state by the next think", () => {
    const s = scene();
    s.state.containers.set("r1", rewardChest("r1", START.x + 50, START.y));
    s.tick();
    s.state.containers.delete("r1");
    s.b.onFx({ kind: "chestTaken", chest: "r1", by: ME, option: 2, t: 0 });
    s.tick();
    expect(s.b.chestStats).toEqual({ seen: 1, tried: 1, taken: 1, skipped: 0 });
  });

  it("asks at several chests once each, and never twice at one", () => {
    const s = scene();
    s.state.containers.set("a", rewardChest("a", START.x + 40, START.y));
    s.state.containers.set("b", rewardChest("b", START.x - 40, START.y + 20));
    for (let i = 0; i < 40; i++) s.tick();
    expect([...s.b.chestChoices.entries()].sort()).toEqual([["a", 1], ["b", 1]]);
    expect(s.chooses()).toHaveLength(2);
  });

  it("sends no choose at all from the coliseum", () => {
    const s = scene();
    s.state.inColiseum = true;
    s.state.containers.set("r1", rewardChest("r1", START.x + 40, START.y));
    for (let i = 0; i < 10; i++) s.tick();
    expect(s.chooses()).toEqual([]);
  });

  it("is deterministic: the same room gives the same messages, tick for tick", () => {
    const play = (): Sent => {
      const s = scene({ foes: { foe: { x: START.x + 700 } } });
      s.state.containers.set("r1", rewardChest("r1", START.x + 300, START.y + 40, { options: ["bountyHunter", "quickdraw", "witness"] }));
      for (let i = 0; i < 60; i++) {
        if (i === 20) s.me.x = START.x + 300 - 70; // arrives
        s.tick();
      }
      return s.sent;
    };
    const first = play();
    expect(first.filter((m) => m.type === "choose")).toHaveLength(1);
    vi.setSystemTime(CLOCK);
    expect(play()).toEqual(first);
  });

  it("does not pick through a wall: a chest 80 u away behind one is out of sight", () => {
    const s = scene({ me: { x: 24 * TILE } });
    const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
    for (let y = 0; y < H; y++) tiles[y * W + 25] = TILE_WALL; // a solid wall at column 25, between the bot and the chest
    s.b.map = mapFromTiles(W, H, tiles);
    s.state.containers.set("r1", rewardChest("r1", 26 * TILE + 16, START.y));
    for (let i = 0; i < 10; i++) s.tick();
    expect(s.chooses()).toEqual([]);
  });
});

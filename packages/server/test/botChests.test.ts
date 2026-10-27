// How a bot treats a camp's shared chest (roguelike R5): bots/chestHunt.ts (pure: which option, pick or walk or nothing). The brain's
// chests module adopts it (test/bots/chestsModule.test.ts has the module, perception's rule for what a chest shows, and whole games).
import { describe, expect, it } from "vitest";
import { CHEST_RANGE, CHEST_SECONDS, PLAYER_SPEED, TILE, type Vec2 } from "@raid/shared";
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
    // Quickdraw is for the bow, wand and axe: a sword bot takes the boots over it, an axe bot the other way round.
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

  it("does not walk to a chest with no path, or to one with nothing left to take", () => {
    const blocked = new Scene();
    blocked.chests = [chest("c1", 400, 0)];
    blocked.walkLen = () => null;
    expect(blocked.step()).toEqual({ kind: "none" });
    const empty = new Scene();
    empty.chests = [chest("c1", 400, 0, { takenBy: ["a", "b", "c"] })];
    expect(empty.step(), "a skip is not worth a walk").toEqual({ kind: "none" });
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

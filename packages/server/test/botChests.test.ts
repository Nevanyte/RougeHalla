// How a bot treats a camp's shared chest (roguelike R5): bots/chestHunt.ts (pure: which option, pick or walk or nothing). The brain's
// chests module adopts it (test/bots/chestsModule.test.ts has the module, perception's rule for what a chest shows, and whole games).
import { describe, expect, it } from "vitest";
import { AUGMENT_IDS, CARDS, CHEST_RANGE, CHEST_SECONDS, PLAYER_SPEED, TICK_MS, TILE, cardDef, type Vec2 } from "@raid/shared";
import {
  CHEST_HUNT, DANGER_RISK, TRADEOFF_RISK, activeWeapon, cardScore, chooseOption, ChestHunter, costsSomething, optionScore, type ChestInput,
  type ChestLike, type ChestSelf,
} from "../src/bots/chestHunt";
import { PERSONAS, PERSONA_IDS } from "../src/bots/brain/types";

const ME = "me";
/** Three base cards: for a Fire sword bot with no build, Attack Damage II (index 2) is the best (tier II, its weapon's stat). */
const OPTIONS = ["vitality1", "armor1", "ad2"];
const FIRE_SWORD: Pick<ChestSelf, "faction" | "weapons" | "build" | "slot" | "risk"> = { faction: "fire", weapons: ["sword", null], build: null };

// ---------------------------------------------------------------------------------------------------------------- the options

describe("which chest option a bot takes", () => {
  it("is the first free one it can use when nothing sets them apart", () => {
    // Witness and Bounty Hunter are both a tier I augment with a damage rider: the same worth, so the first stands.
    expect(optionScore("witness", FIRE_SWORD)).toBe(optionScore("bountyHunter", FIRE_SWORD));
    expect(chooseOption(["witness", "bountyHunter"], ["", ""], FIRE_SWORD)).toBe(0);
    expect(chooseOption(["bountyHunter", "witness"], ["", ""], FIRE_SWORD)).toBe(0);
  });

  it("passes over an option somebody took, a card it cannot take and one it already holds", () => {
    // A conditional card needs a base card of its stat (Bloodthirst: leech), a unique card is held once.
    expect(chooseOption(["bloodthirst", "witness", "ad1"], ["", "", ""], FIRE_SWORD), "no leech card: Bloodthirst is refused").not.toBe(0);
    expect(chooseOption(["witness", "ad1"], ["", ""], { ...FIRE_SWORD, build: { witness: 1 } }), "Witness is held").toBe(1);
    expect(chooseOption(["ad2", "vitality1"], ["other", ""], FIRE_SWORD)).toBe(1);
    expect(chooseOption(["ad1", "ad2", "vitality1"], ["a", "b", "c"], FIRE_SWORD), "all taken").toBe(-1);
    expect(chooseOption(["bloodthirst", "secondSkin", "hearty"], ["", "", ""], FIRE_SWORD), "all refused").toBe(-1);
    expect(chooseOption(["witness", "bountyHunter"], ["", ""], { ...FIRE_SWORD, build: { witness: 1, bountyHunter: 1 } }), "all held").toBe(-1);
    expect(chooseOption([], [], FIRE_SWORD), "an empty chest").toBe(-1);
  });

  it("takes a base card it already holds again: it stacks, and a stat it holds counts for more than a new one", () => {
    expect(chooseOption(["ad1"], [""], { ...FIRE_SWORD, build: { ad1: 3 } }), "never maxed").toBe(0);
    expect(optionScore("ad1", { ...FIRE_SWORD, build: { ad2: 1 } })).toBeGreaterThan(optionScore("ad1", FIRE_SWORD));
    expect(optionScore("vitality2", FIRE_SWORD)).toBeGreaterThan(optionScore("vitality1", FIRE_SWORD)); // the higher tier is worth more
  });

  it("takes a conditional card it can use ahead of a plain augment, and a stat it can build on ahead of a new one", () => {
    const leech = { ...FIRE_SWORD, build: { leech1: 1 } };
    expect(optionScore("bloodthirst", FIRE_SWORD)).toBe(-Infinity);
    expect(optionScore("bloodthirst", leech)).toBeGreaterThan(optionScore("witness", leech));
    expect(chooseOption(["witness", "bloodthirst"], ["", ""], leech)).toBe(1);
    expect(chooseOption(["vitality1", "ad1"], ["", ""], { ...FIRE_SWORD, build: { vitality1: 1 } }), "deepen the stat it holds").toBe(0);
  });

  it("prefers the stat that suits its weapon, and holds back a card that gives something up", () => {
    // Ability power is for the wand (and fists); attack damage for the sword, axe and bow.
    const wand = { ...FIRE_SWORD, weapons: ["wand", null] as const };
    expect(optionScore("ap1", wand)).toBeGreaterThan(optionScore("ap1", FIRE_SWORD));
    expect(optionScore("ad1", FIRE_SWORD)).toBeGreaterThan(optionScore("ad1", wand));
    expect(optionScore("ad1", { ...FIRE_SWORD, weapons: ["axe", null] })).toBe(optionScore("ad1", FIRE_SWORD));
    expect(chooseOption(["ap1", "ad1"], ["", ""], wand)).toBe(0);
    expect(chooseOption(["ap1", "ad1"], ["", ""], FIRE_SWORD)).toBe(1);
    // Armor is for a shield; Glass Cannon trades defence for damage and the default persona (risk 0.5) steers clear of such a card.
    const shield = { ...FIRE_SWORD, weapons: ["shield", null] as const };
    expect(optionScore("armor1", shield)).toBeGreaterThan(optionScore("armor1", FIRE_SWORD));
    expect(optionScore("glassCannon", FIRE_SWORD)).toBeLessThan(optionScore("witness", FIRE_SWORD));
  });

  it("is a pure function of what it is given: the same chest, the same answer, nothing changed", () => {
    const options = ["vitality1", "ad2", "witness"];
    const taken = ["", "", ""];
    const build = { ad1: 1 };
    const first = chooseOption(options, taken, { ...FIRE_SWORD, build });
    for (let i = 0; i < 5; i++) expect(chooseOption(options, taken, { ...FIRE_SWORD, build })).toBe(first);
    expect(options).toEqual(["vitality1", "ad2", "witness"]);
    expect(taken).toEqual(["", "", ""]);
    expect(build).toEqual({ ad1: 1 });
  });

  it("still takes an id the catalog does not know (newer server content)", () => {
    expect(chooseOption(["fromTheFuture"], [""], FIRE_SWORD)).toBe(0);
  });
});

describe("cardScore: the contract's weights", () => {
  const PLAIN: Pick<ChestSelf, "faction" | "weapons" | "build" | "slot" | "risk"> = { faction: "frost", weapons: ["sword", null], build: null, risk: 0.5 };
  const at = (over: Partial<typeof PLAIN>) => ({ ...PLAIN, ...over });

  it("scores a base card +3 when its stat is owned and +1.5 when new, plus one per tier, and the fit of the stat to the weapon in hand", () => {
    // Haste has no weapon fit: the bare weights show.
    expect(cardScore("haste1", PLAIN)).toBe(1.5 + 1);
    expect(cardScore("haste2", PLAIN)).toBe(1.5 + 2);
    expect(cardScore("haste3", PLAIN)).toBe(1.5 + 3);
    expect(cardScore("haste1", at({ build: { haste3: 1 } }))).toBe(3 + 1);
    expect(cardScore("haste1", at({ build: { haste1: 4 } }))).toBe(3 + 1);
  });

  it("scores a conditional whose base it owns +4 plus its tier, and refuses one whose base it lacks", () => {
    expect(cardScore("bloodthirst", PLAIN)).toBe(-Infinity);
    const owner = at({ build: { leech1: 1 } });
    expect(cardScore("bloodthirst", owner)).toBe(4 + 2);
    expect(cardScore("hearty", at({ build: { vitality2: 1 } }))).toBe(4 + 2);
    expect(cardScore("hearty", at({ build: { vitality2: 1, hearty: 1 } }))).toBe(-Infinity);
  });

  it("fits a stat to the weapon in hand (the slot, not the other one): AD on AD weapons, AP on a wand, armor and MR on a shield, fists a hybrid", () => {
    const hand = (weapons: ChestSelf["weapons"], slot: 0 | 1 = 0, faction = "frost") => ({ ...PLAIN, weapons, slot, faction });
    for (const w of ["sword", "axe", "bow"] as const) expect(cardScore("ad1", hand([w, null])), w).toBe(1.5 + 1 + 1);
    expect(cardScore("ad1", hand(["wand", null]))).toBe(1.5 + 1 - 0.5);
    expect(cardScore("ad1", hand(["shield", null]))).toBe(1.5 + 1 - 1);
    expect(cardScore("ad1", hand([null, null]))).toBe(1.5 + 1 + 0.5); // fists
    expect(cardScore("ap1", hand(["wand", null]))).toBe(1.5 + 1 + 1);
    expect(cardScore("ap1", hand([null, null]))).toBe(1.5 + 1 + 0.5);
    expect(cardScore("ap1", hand(["sword", null]))).toBe(1.5 + 1 - 1);
    // A damage-over-time faction gets something from AP on any weapon (AP feeds every DoT).
    expect(cardScore("ap1", hand(["sword", null], 0, "plague"))).toBe(1.5 + 1);
    expect(cardScore("armor1", hand(["shield", null]))).toBe(1.5 + 1 + 1);
    expect(cardScore("mr1", hand(["shield", null]))).toBe(1.5 + 1 + 1);
    expect(cardScore("armor1", hand(["sword", null]))).toBe(1.5 + 1);
    // The weapon IN HAND counts: a wand in the second slot with the sword up is a sword fit.
    expect(cardScore("ad1", hand(["sword", "wand"], 0))).toBe(1.5 + 1 + 1);
    expect(cardScore("ad1", hand(["sword", "wand"], 1))).toBe(1.5 + 1 - 0.5);
    expect(activeWeapon({ weapons: ["sword", null], slot: 1 })).toBe("fists");
    expect(activeWeapon({ weapons: ["sword", "bow"], slot: 1 })).toBe("bow");
    expect(activeWeapon({ weapons: [null, null] })).toBe("fists");
  });

  it("scores an augment by its tier and the persona's risk: 1 + 2 x risk on top, so +1 for a timid persona and +3 for a bold one", () => {
    expect(cardScore("witness", at({ risk: 0 }))).toBe(1 + 1);
    expect(cardScore("witness", at({ risk: 1 }))).toBe(1 + 3);
    expect(cardScore("coupDeGrace", at({ risk: 0.5 }))).toBe(2 + 1 + 2 * 0.5); // tier II, a rule that needs no weapon
    expect(cardScore("witness", at({ risk: 0.9 }))).toBeGreaterThan(cardScore("witness", at({ risk: 0.2 })));
  });

  it("refuses a card that gives something up below risk 0.5, and A Race to 0 and Glass Cannon at or below 0.7", () => {
    expect(TRADEOFF_RISK).toBe(0.5);
    expect(DANGER_RISK).toBe(0.7);
    const tradeoffs = ["hereComesTheBoom", "machineGun", "thickSkull", "vampiricPact", "slowStarter", "committed", "arcaneOverload", "slowBurn", "gambler"];
    for (const id of tradeoffs) {
      expect(costsSomething(cardDef(id)!), id).toBe(true);
      expect(cardScore(id, at({ risk: 0.49 })), `${id} at 0.49`).toBe(-Infinity);
      expect(cardScore(id, at({ risk: 0.5 })), `${id} at 0.5`).toBeGreaterThan(-Infinity);
    }
    for (const id of ["raceToZero", "glassCannon"]) {
      expect(cardScore(id, at({ risk: 0.6 })), `${id} at 0.6`).toBe(-Infinity);
      expect(cardScore(id, at({ risk: 0.7 })), `${id} at 0.7`).toBe(-Infinity);
      expect(cardScore(id, at({ risk: 0.71 })), `${id} at 0.71`).toBeGreaterThan(-Infinity);
    }
    // A plain augment never needs risk.
    for (const id of ["witness", "wellspring", "ironWill", "packLeader", "lastRites"]) expect(cardScore(id, at({ risk: 0 })), id).toBeGreaterThan(-Infinity);
  });

  it("knows which augments cost something: exactly the ones that trade a stat, a rule or a bigger risk for their power", () => {
    const costly = AUGMENT_IDS.filter((id) => costsSomething(cardDef(id)!));
    const expected = ["hereComesTheBoom", "machineGun", "glassCannon", "thickSkull", "vampiricPact", "arcaneOverload", "committed", "slowBurn", "slowStarter", "gambler", "raceToZero"];
    expect([...costly].sort()).toEqual([...expected].sort());
    // A negative windup is the benefit (Quickdraw), and a flag that only turns a hook on (Fists of Fury's second application) is no price.
    for (const id of ["witness", "bountyHunter", "fistsOfFury", "coupDeGrace", "wellspring", "quickdraw", "secondWind", "lastRites", "cruelWounds", "plantYourFeet"]) {
      expect(costly, id).not.toContain(id);
    }
  });

  it("gives the rule-bound augments a fit: Fists of Fury only unarmed, Gathering Storm only to the mark, Quickdraw to melee, block to a shield", () => {
    const fists = at({ weapons: [null, null] });
    expect(cardScore("fistsOfFury", fists)).toBeGreaterThan(cardScore("fistsOfFury", PLAIN) + 4);
    expect(cardScore("gatheringStorm", at({ faction: "sentenced" }))).toBeGreaterThan(cardScore("gatheringStorm", PLAIN) + 2);
    expect(cardScore("quickdraw", PLAIN)).toBeGreaterThan(cardScore("quickdraw", at({ weapons: ["bow", null] })));
    expect(cardScore("tankEngine", at({ weapons: ["shield", null] }))).toBeGreaterThan(cardScore("tankEngine", PLAIN));
    // Committed locks the second slot: worse while the bot carries two weapons.
    expect(cardScore("committed", at({ risk: 0.9, weapons: ["sword", null] }))).toBeGreaterThan(cardScore("committed", at({ risk: 0.9, weapons: ["sword", "bow"] })));
  });

  it("is finite or -Infinity for every card in the catalog, for every persona, and never NaN", () => {
    for (const id of PERSONA_IDS) {
      for (const c of CARDS) {
        const v = cardScore(c.id, { faction: "holy", weapons: ["axe", "shield"], slot: 0, build: { ad1: 1, leech1: 1, vitality1: 1, haste1: 1, fleet1: 1, ap1: 1, armor1: 1 }, risk: PERSONAS[id].risk });
        expect(Number.isNaN(v), `${id} ${c.id}`).toBe(false);
      }
    }
  });
});

describe("personas differ in what they take from the same chest (persona.risk)", () => {
  const BASE: Pick<ChestSelf, "faction" | "weapons" | "build" | "slot"> = { faction: "fire", weapons: ["sword", null], build: { ad1: 1 }, slot: 0 };
  const as = (id: keyof typeof PERSONAS) => ({ ...BASE, risk: PERSONAS[id].risk });
  // A deepening base card (tier II), a tier III trade-off augment and a plain tier I augment.
  const CHEST = ["ad2", "hereComesTheBoom", "witness"];

  it("gives the four personas a spread of risk with the hunter boldest and the cautious one most careful", () => {
    const risks = PERSONA_IDS.map((id) => PERSONAS[id].risk);
    expect(Math.max(...risks)).toBe(PERSONAS.hunter.risk);
    expect(Math.min(...risks)).toBe(PERSONAS.cautious.risk);
    expect(PERSONAS.hunter.risk).toBeGreaterThan(DANGER_RISK);
    expect(PERSONAS.opportunist.risk).toBeGreaterThanOrEqual(TRADEOFF_RISK);
    expect(PERSONAS.opportunist.risk).toBeLessThanOrEqual(DANGER_RISK);
    expect(PERSONAS.farmer.risk).toBeLessThan(TRADEOFF_RISK);
    expect(PERSONAS.cautious.risk).toBeLessThan(TRADEOFF_RISK);
    for (const r of risks) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); }
  });

  it("a timid persona (farmer, cautious) deepens the stat it holds and never takes a trade-off", () => {
    for (const id of ["farmer", "cautious"] as const) {
      expect(chooseOption(CHEST, ["", "", ""], as(id)), id).toBe(0);
      expect(chooseOption(["hereComesTheBoom", "witness"], ["", ""], as(id)), `${id}: Boom is passed over for a plain augment`).toBe(1);
      expect(chooseOption(["hereComesTheBoom", "machineGun", "raceToZero"], ["", "", ""], as(id)), `${id}: only trade-offs: skip`).toBe(-1);
    }
  });

  it("a moderate persona (opportunist) will take a trade-off but not the two that can kill it", () => {
    expect(chooseOption(["hereComesTheBoom", "witness"], ["", ""], as("opportunist"))).toBe(0);
    expect(chooseOption(["raceToZero", "glassCannon", "witness"], ["", "", ""], as("opportunist"))).toBe(2);
    expect(chooseOption(["raceToZero", "glassCannon"], ["", ""], as("opportunist"))).toBe(-1);
  });

  it("a bold persona (hunter) takes Race to 0 and Glass Cannon, and a tier III trade-off ahead of a plain augment", () => {
    expect(chooseOption(["witness", "raceToZero"], ["", ""], as("hunter"))).toBe(1);
    expect(chooseOption(["witness", "glassCannon"], ["", ""], as("hunter"))).toBe(1);
    expect(chooseOption(["witness", "hereComesTheBoom"], ["", ""], as("hunter"))).toBe(1);
  });

  it("the same chest gets three different answers from the three kinds of persona, and a stable one for each", () => {
    // Race to 0 and Here Comes the Boom are both tier III (an equal score), so the bold persona takes the first of them.
    const chest = ["witness", "raceToZero", "hereComesTheBoom"];
    const picks = Object.fromEntries(PERSONA_IDS.map((id) => [id, chooseOption(chest, ["", "", ""], as(id))]));
    expect(picks).toEqual({ farmer: 0, hunter: 1, opportunist: 2, cautious: 0 });
    expect(PERSONA_IDS.map((id) => chooseOption(chest, ["", "", ""], as(id)))).toEqual(PERSONA_IDS.map((id) => picks[id]));
  });

  it("every persona still takes an owned-base conditional ahead of a plain augment, whatever its risk", () => {
    for (const id of PERSONA_IDS) {
      const self = { ...as(id), build: { leech1: 1, ad1: 1 } };
      expect(chooseOption(["witness", "bloodthirst"], ["", ""], self), id).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------- the hunt (pure)

const NOW = 50_000;
const SERVER = 1_000_000;

/** A chest made OLD ms before SERVER: past its birth hold, so a test that is not about the hold picks at its first look. */
const OLD = 1000;
/** A chest made at the very tick the first step looks at it (Scene.step moves the clock 50 ms before it decides): age 0. */
const BORN_AT_FIRST_LOOK = SERVER + 50 + CHEST_SECONDS * 1000;

function chest(id: string, x: number, y: number, o: Partial<ChestLike> = {}): ChestLike {
  return {
    id, kind: "reward", x, y, expiresAt: SERVER - OLD + CHEST_SECONDS * 1000,
    options: OPTIONS, takenBy: ["", "", ""], pickers: [], ...o,
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
    expect(s.step()).toMatchObject({ kind: "pick", chest: "c1", option: 2 }); // Attack Damage II
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

  it("skips when every option is taken or refused to it", () => {
    const taken = new Scene();
    taken.chests = [chest("c1", 40, 0, { takenBy: ["a", "b", "c"] })];
    expect(taken.step()).toMatchObject({ kind: "pick", chest: "c1", option: -1 });

    // Conditional cards without their base card are refused by the server: nothing usable is a skip.
    const refused = new Scene();
    refused.chests = [chest("c1", 40, 0, { options: ["bloodthirst", "secondSkin", "hearty"] })];
    expect(refused.step()).toMatchObject({ kind: "pick", chest: "c1", option: -1 });
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
    const reachable = (CHEST_SECONDS * 1000 - OLD - CHEST_HUNT.arriveSlackMs) / 1000 * PLAYER_SPEED * CHEST_HUNT.paceShare + CHEST_HUNT.pickRange;
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
        get options() { reads++; return OPTIONS; },
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

describe("the chest hunt and a chest's birth hold", () => {
  it("holds the one try for the server's hold (two ticks) and one tick more", () => {
    expect(CHEST_HUNT.holdMs).toBe(3 * TICK_MS);
    expect(CHEST_HUNT.holdMs).toBeGreaterThan(2 * TICK_MS);
    expect(CHEST_HUNT.holdMs).toBeLessThan(CHEST_SECONDS * 1000 - CHEST_HUNT.pickMarginMs); // it never eats the chest's life
  });

  it("a chest in reach at the first look gets no pick in its first ticks, then one pick, and no walk, read or try in between", () => {
    let reads = 0;
    const s = new Scene();
    s.chests = [{
      ...chest("c1", 60, 0, { expiresAt: BORN_AT_FIRST_LOOK }),
      get options() { reads++; return OPTIONS; },
    }];
    // The looks at ages 0, 50 and 100 ms wait...
    expect([s.step().kind, s.step().kind, s.step().kind]).toEqual(["none", "none", "none"]);
    expect(s.hunter.tried("c1")).toBe(false);
    expect(reads, "the options are not read while it waits").toBe(0);
    // ...the one at 150 ms picks.
    expect(s.step()).toMatchObject({ kind: "pick", chest: "c1", option: 2 });
    expect(reads).toBeGreaterThan(0);
    expect(s.walkCalls, "waiting started no walk").toBe(0);
    expect(s.hunter.stats.walks).toBe(0);
    for (let i = 0; i < 20; i++) expect(s.step()).toEqual({ kind: "none" });
  });

  it("a chest first seen already old is picked at once: the age is the chest's own, not the time since the bot looked", () => {
    for (const ageMs of [CHEST_HUNT.holdMs, CHEST_HUNT.holdMs + 1, 700, 6000]) {
      const s = new Scene();
      s.chests = [chest("c1", 60, 0, { expiresAt: SERVER + 50 + CHEST_SECONDS * 1000 - ageMs })];
      expect(s.step().kind, `${ageMs} ms old`).toBe("pick");
    }
    const young = new Scene();
    young.chests = [chest("c1", 60, 0, { expiresAt: SERVER + 50 + CHEST_SECONDS * 1000 - (CHEST_HUNT.holdMs - 1) })];
    expect(young.step().kind, "one ms short of the hold").toBe("none");
    expect(young.step().kind, "and 50 ms on").toBe("pick");
  });

  it("a young chest out of reach is walked to as ever: the hold only delays the pick, and a bot that arrives early waits", () => {
    const s = new Scene();
    s.chests = [chest("c1", 400, 0, { expiresAt: BORN_AT_FIRST_LOOK })];
    expect(s.step()).toMatchObject({ kind: "walk", chest: "c1" }); // age 0
    s.self = { ...s.self, x: 330 }; // in reach at age 50 (an early arrival)
    expect(s.step().kind).toBe("none"); // 50
    expect(s.step().kind).toBe("none"); // 100
    expect(s.step().kind).toBe("pick"); // 150
  });

  it("waiting for a young chest does not hold back a pick at an old one in reach, and walks to no third chest meanwhile", () => {
    const s = new Scene();
    s.chests = [chest("young", 60, 0, { expiresAt: BORN_AT_FIRST_LOOK }), chest("old", -60, 0)];
    expect(s.step()).toMatchObject({ kind: "pick", chest: "old" });
    s.chests = [chest("young", 60, 0, { expiresAt: BORN_AT_FIRST_LOOK + 50 }), chest("far", 500, 0)];
    expect(s.step(), "the far chest waits while the one in reach is still in its hold").toEqual({ kind: "none" });
    expect(s.hunter.stats.walks).toBe(0);
  });

  it("a young chest behind a wall is walked to (the hold applies to a pick, which needs the sight)", () => {
    const s = new Scene();
    s.sight = false;
    s.chests = [chest("c1", 50, 0, { expiresAt: BORN_AT_FIRST_LOOK })];
    expect(s.step().kind).toBe("walk");
  });
});

// sim/ledger.ts with arena.applyHits: the per-tick damage ledger. Every source (the projectile sweep, melee) only records
// hits; applyLedger applies them all at once, each mitigated by its victim's armor and shield, through the one way down.
// What is pinned here: simultaneous hits and deaths, who is credited, the damage law per entry, scale, the hit fx,
// teleport immunity, mobs, stagger, and hits from combatants who are gone.
//
// Hits are recorded by hand inside a real step: `inStep` swaps the pickup handler for the test's function and queues one
// pickup, so the function runs in the inputs phase of a tick, after the ledger was reset and before it is applied.
// (A `world.systems` entry would be too late: systems run after applyLedger.) Projectile tests loose real arrows.
import { describe, expect, it } from "vitest";
import {
  damagePerHit, damageShares, FACTIONS, GV_KILL, mapFromTiles, mitigate, mitigateShares, mulberry32, pacedFaction,
  SIGNATURE_WEAPONS, STAGGER_IMMUNITY_SECONDS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type DamageShares, type FactionId,
  type FxEvent, type GameMap, type RunResult, type Vec2, type WeaponId,
} from "@raid/shared";
import { applyDamage } from "../src/sim/arena";
import { combatant, timingsOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { addStatus } from "../src/sim/status";
import { actionOrder, addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, SimEvent, World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;
type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

// ---------------------------------------------------------------------------------------------------------------
// Scenario helpers

const W_TILES = 40;
const H_TILES = 20;
const SEED = 11;

const tileCentre = (t: number): number => t * TILE + TILE / 2;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + i), y: tileCentre(3) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

interface Fighter { id: string; faction: FactionId; at?: Vec2; hp?: number; weapon?: WeaponId }

const nameOf = (id: string): string => id[0]!.toUpperCase() + id.slice(1);
const fighter = (id: string, faction: FactionId = "fire", hp?: number): Fighter => ({ id, faction, hp });

const P = (world: World, id: string) => world.state.players.get(id)!;
const RT = (world: World, id: string) => world.players.get(id)!;

/** An active run (the first step starts it) of these fighters, spread along a line unless `at` says where. */
function arena(fighters: Fighter[], orderSalt?: number): World {
  const world = createGameWorld({
    seed: SEED,
    config: {
      minPlayers: fighters.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600, pvpRules: false,
    },
    random: mulberry32(SEED + 1),
  }, { signatures: false });
  world.map = openMap();
  for (const f of fighters) {
    const p = addPlayer(world, f.id, nameOf(f.id));
    p.faction = f.faction;
    p.hp = p.maxHp = FACTIONS[f.faction].hp;
    p.weapon0 = f.weapon ?? SIGNATURE_WEAPONS[f.faction];
  }
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  fighters.forEach((f, i) => {
    const at = f.at ?? { x: 200 + 60 * i, y: 320 };
    const p = P(world, f.id);
    p.x = at.x;
    p.y = at.y;
    RT(world, f.id).history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
    if (f.hp !== undefined) p.hp = f.hp;
  });
  if (orderSalt !== undefined) world.orderSalt = orderSalt;
  return world;
}

const tick = (world: World): SimEvent[] => step(world, TICK_MS);

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return ofType(events, "fx").map((e) => e.fx).filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** Result of each player resolved in `events`, by id. */
function resultsOf(events: SimEvent[]): Record<string, RunResult> {
  const out: Record<string, RunResult> = {};
  for (const e of ofType(events, "resolved")) {
    expect(out[e.id], `second result for ${e.id}`).toBeUndefined();
    out[e.id] = e.result;
  }
  return out;
}

/**
 * One tick in which `fn` runs in the inputs phase, where it records its hits. They are applied at the ledger step of
 * that same tick, with the real weapon, movement, sweep, system and settle phases around them.
 */
function inStep(world: World, fn: () => void): SimEvent[] {
  const actor = [...world.players.values()].find((rt) => !rt.down && !rt.resolved)!;
  const prev = world.actions.pickup;
  world.actions.pickup = () => fn();
  actor.inputs.pushAction({ kind: "pickup", containerId: "none" });
  try {
    return tick(world);
  } finally {
    world.actions.pickup = prev;
  }
}

/** Like inStep, but every standing player queues the pickup, so `fn(id)` runs once per player in the tick's shuffled order. */
function inStepEach(world: World, fn: (id: string) => void): SimEvent[] {
  const prev = world.actions.pickup;
  world.actions.pickup = (_w, c) => fn(c.id);
  for (const rt of world.players.values()) if (!rt.down && !rt.resolved) rt.inputs.pushAction({ kind: "pickup", containerId: "none" });
  try {
    return tick(world);
  } finally {
    world.actions.pickup = prev;
  }
}

const PHYSICAL: DamageShares = { phys: 1, magic: 0, true: 0 };
const MAGIC: DamageShares = { phys: 0, magic: 1, true: 0 };
const TRUE: DamageShares = { phys: 0, magic: 0, true: 1 };

interface HitOpts { shares?: DamageShares; weapon?: WeaponId; scale?: number; stagger?: boolean; name?: string }

/** Records a hit of `raw` on `victim` by `by`. Armor-free victims (Fire, Holy, a dummy) take a physical `raw` as it is. */
function hit(world: World, victim: string, by: string, raw: number, o: HitOpts = {}): LedgerEntry {
  return recordHit(world, {
    victim, by: { id: by, name: o.name ?? nameOf(by) }, packet: { raw, ...(o.shares ?? PHYSICAL) }, weapon: o.weapon ?? "axe",
    stagger: o.stagger ?? false, scale: o.scale,
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe("recordHit and applyLedger", () => {
  it("queues an entry at scale 1 unless given one, and hands it back", () => {
    const w = arena([fighter("v"), fighter("x")]);
    const e = hit(w, "v", "x", 10);
    expect(e.scale).toBe(1);
    expect(hit(w, "v", "x", 10, { scale: 0.5 }).scale).toBe(0.5);
    expect(w.combat.ledger).toHaveLength(2);
    expect(w.combat.ledger[0]).toBe(e);
  });

  it("applies and empties the ledger; an empty one does nothing", () => {
    const w = arena([fighter("v"), fighter("x")]);
    applyLedger(w);
    expect(w.events).toEqual([]);
    hit(w, "v", "x", 10);
    applyLedger(w);
    expect(w.combat.ledger).toEqual([]);
    expect(P(w, "v").hp).toBe(FACTIONS.fire.hp - 10);
    applyLedger(w);
    expect(P(w, "v").hp).toBe(FACTIONS.fire.hp - 10);
  });

  it("drops what the tick did not apply: the ledger starts empty every active tick", () => {
    const w = arena([fighter("v"), fighter("x")]);
    hit(w, "v", "x", 10);
    tick(w);
    expect(P(w, "v").hp).toBe(FACTIONS.fire.hp);
  });
});

describe("all the hits of a tick land at once", () => {
  it("adds up every hit on a victim: the sum is the damage, and two hits that each fall short kill together", () => {
    const short = arena([fighter("v", "fire", 100), fighter("x"), fighter("y"), fighter("z")]);
    inStep(short, () => { hit(short, "v", "x", 30); hit(short, "v", "y", 30); hit(short, "v", "z", 30); });
    expect(P(short, "v")).toMatchObject({ hp: 10, status: "alive" });

    const w = arena([fighter("v", "fire", 100), fighter("x"), fighter("y"), fighter("z")]);
    const order = actionOrder(w, w.state.tick + 1);
    const events = inStep(w, () => { hit(w, "v", "x", 60); hit(w, "v", "y", 60); });
    expect(P(w, "v")).toMatchObject({ hp: 0, status: "dead" });
    // An exact tie: the kill goes to whichever of the two comes first in this tick's secret order.
    const killer = order.indexOf("x") < order.indexOf("y") ? "X" : "Y";
    expect(resultsOf(events).v).toMatchObject({ outcome: "died", killedBy: killer });
  });

  /** a and b each land a lethal hit on the other, recorded as each is processed, so the salt decides who records first. */
  const mutual = (hpA: number | undefined, hpB: number | undefined, salt?: number) => {
    const w = arena([fighter("a", "fire", hpA), fighter("b", "sentenced", hpB)], salt);
    const first = actionOrder(w, w.state.tick + 1)[0]!;
    const events = inStepEach(w, (id) => hit(w, id === "a" ? "b" : "a", id, 5000));
    return { w, events, results: resultsOf(events), first };
  };

  it("lets two players who kill each other in the same tick both go down, and both land their hit", () => {
    const { w, events } = mutual(undefined, undefined);
    expect([P(w, "a").hp, P(w, "b").hp]).toEqual([0, 0]);
    expect([P(w, "a").status, P(w, "b").status]).toEqual(["dead", "dead"]);
    expect(fxOf(events, "death").map((d) => [d.id, d.by]).sort()).toEqual([["a", "b"], ["b", "a"]]);
    expect([P(w, "a").kills, P(w, "b").kills]).toEqual([1, 1]);
  });

  it("gives the win to the higher hp fraction at the start of the tick, whichever player was processed first", () => {
    const processedFirst = new Set<string>();
    for (const salt of [1, 2, 3, 4, 5, 6]) {
      const { w, results, first } = mutual(400, 210, salt); // 0.8 against 0.3
      processedFirst.add(first);
      expect(results.a, `salt ${salt}`).toMatchObject({ outcome: "won", place: 1, killedBy: null, kills: 1 });
      expect(results.b, `salt ${salt}`).toMatchObject({ outcome: "died", place: 2, killedBy: "A", kills: 1 });
      expect(w.state.winner).toBe("A");
      const swapped = mutual(100, 700, salt); // 0.2 against 1
      expect(swapped.results.b, `salt ${salt}`).toMatchObject({ outcome: "won", place: 1 });
      expect(swapped.results.a, `salt ${salt}`).toMatchObject({ outcome: "died", place: 2 });
    }
    expect([...processedFirst].sort()).toEqual(["a", "b"]); // both orders were exercised
  });

  it("compares hp fractions, not hp: the smaller pool at a higher fraction wins", () => {
    const { results } = mutual(500, 630); // Fire 500 of 500 against Sentenced 630 of 700: more hp, lower fraction
    expect(results.a).toMatchObject({ outcome: "won" });
    expect(results.b).toMatchObject({ outcome: "died" });
  });

  it("calls an exact tie a draw: both share place 1, nobody is the winner", () => {
    const { w, events, results } = mutual(undefined, undefined);
    expect(results.a).toMatchObject({ outcome: "draw", place: 1, killedBy: null });
    expect(results.b).toMatchObject({ outcome: "draw", place: 1, killedBy: null });
    expect(w.state.winner).toBe("");
    expect(fxOf(events, "victory")).toEqual([{ kind: "victory", id: null, name: null, draw: true }]);
  });

  it("uses the hp of the tick's start, not what the hits left: damage dealt does not break the tie", () => {
    const w = arena([fighter("a", "fire"), fighter("b", "fire")]);
    const events = inStep(w, () => { hit(w, "b", "a", 9000); hit(w, "a", "b", 5000); });
    expect(resultsOf(events).a).toMatchObject({ outcome: "draw" });
  });

  it("leaves the survivor the winner when two others kill each other", () => {
    const w = arena([fighter("a", "fire"), fighter("b", "sentenced"), fighter("c", "plague")]);
    const events = inStep(w, () => { hit(w, "b", "a", 5000); hit(w, "a", "b", 5000); });
    const results = resultsOf(events);
    expect(results.c).toMatchObject({ outcome: "won", place: 1 });
    expect(results.a).toMatchObject({ outcome: "died", place: 2 });
    expect(results.b).toMatchObject({ outcome: "died", place: 2 });
  });
});

describe("who is credited", () => {
  const four = (hp = 100): World => arena([fighter("v", "fire", hp), fighter("x"), fighter("y"), fighter("z")]);

  it("pays the kill to the largest hit by a rival, whatever the order the hits came in", () => {
    for (const order of [["x", "y", "z"], ["y", "z", "x"], ["z", "x", "y"]]) {
      const w = four();
      const raw: Record<string, number> = { x: 20, y: 70, z: 30 };
      const events = inStep(w, () => { for (const by of order) hit(w, "v", by, raw[by]!); });
      expect(resultsOf(events).v, order.join()).toMatchObject({ outcome: "died", killedBy: "Y" });
      expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "v", by: "y" })]);
      expect([P(w, "x").kills, P(w, "y").kills, P(w, "z").kills]).toEqual([0, 1, 0]);
      expect(P(w, "y").gv).toBe(GV_KILL);
    }
  });

  it("pays the victim's bounty with it, once, to the same player", () => {
    const w = four();
    P(w, "v").bounty = 25;
    const claimed: Array<[string, string, number]> = [];
    w.hooks.bountyClaimed = (_w, killer, victim, bounty) => claimed.push([killer.id, victim.id, bounty]);
    const events = inStep(w, () => { hit(w, "v", "x", 40); hit(w, "v", "y", 90); hit(w, "v", "z", 40); });
    expect(RT(w, "y").gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 25, quest: 0 });
    expect(P(w, "y").gv).toBe(GV_KILL + 25);
    expect(ofType(events, "gv")).toEqual([
      { type: "gv", id: "y", amount: GV_KILL, reason: "kill" },
      { type: "gv", id: "y", amount: 25, reason: "bounty" },
    ]);
    expect(claimed).toEqual([["y", "v", 25]]);
    expect([RT(w, "x").gv.bounty, RT(w, "z").gv.bounty]).toEqual([0, 0]);
  });

  it("breaks an exact tie by the tick's secret order, not by entry order or join order", () => {
    const seen = new Set<string>();
    for (let salt = 1; salt <= 12; salt++) {
      for (const [first, second] of [["x", "y"], ["y", "x"]] as const) {
        const w = arena([fighter("v", "fire", 90), fighter("x"), fighter("y"), fighter("z")], salt);
        const order = actionOrder(w, w.state.tick + 1);
        const want = order.indexOf("x") < order.indexOf("y") ? "x" : "y";
        const events = inStep(w, () => { hit(w, "v", first, 50); hit(w, "v", second, 50); });
        expect(resultsOf(events).v.killedBy, `salt ${salt}, ${first} then ${second}`).toBe(nameOf(want));
        seen.add(want);
      }
    }
    expect(seen.size, "both attackers win some ties").toBe(2);
  });

  it("an arrow starting inside two bodies meets the one whose centre is nearer, whoever joined first", () => {
    for (const order of [["a", "n", "f"], ["a", "f", "n"]]) {
      const at: Record<string, Vec2> = { a: { x: 200, y: 320 }, n: { x: 204, y: 320 }, f: { x: 212, y: 324 } };
      const w = arena(order.map((id) => ({ id, faction: id === "a" ? "sentenced" : "fire", at: at[id] })));
      loose(w, [{ id: "a", a: 0 }]);
      const events = untilEvent(w, "projEnd");
      expect(fxOf(events, "hit").map((h) => h.id), order.join()).toEqual(["n"]);
    }
  });

  it("prefers a rival's smaller hit to a larger one from the victim itself or from a combatant that is gone", () => {
    const self = four();
    const selfEvents = inStep(self, () => { hit(self, "v", "v", 90); hit(self, "v", "x", 20); });
    expect(resultsOf(selfEvents).v).toMatchObject({ killedBy: "X" });
    expect(P(self, "x").kills).toBe(1);
    expect(RT(self, "v").damaged.has("v")).toBe(false);

    const gone = four();
    const goneEvents = inStep(gone, () => { hit(gone, "v", "ghost", 90); hit(gone, "v", "y", 20); });
    expect(resultsOf(goneEvents).v).toMatchObject({ killedBy: "Y" });
    expect(P(gone, "y").kills).toBe(1);
  });

  it("names the largest hit when no rival is among them, and pays nobody", () => {
    const w = four();
    P(w, "v").bounty = 25;
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 } });
    const events = inStep(w, () => {
      hit(w, "v", "ghost", 60, { name: "Ghost" });
      hit(w, "v", mob, 70, { name: "Warden" });
      hit(w, "v", "ghost", 20, { name: "Ghost" });
    });
    expect(resultsOf(events).v).toMatchObject({ outcome: "died", killedBy: "Warden" });
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "v", by: null })]);
    expect([...w.state.players.values()].map((p) => p.kills)).toEqual([0, 0, 0, 0]);
    expect(ofType(events, "gv")).toEqual([]);
  });

  it("makes a lethal hit by the victim itself nobody's kill", () => {
    const w = four();
    P(w, "v").bounty = 25;
    const events = inStep(w, () => hit(w, "v", "v", 500));
    expect(resultsOf(events).v).toMatchObject({ outcome: "died", killedBy: "V" });
    expect([...w.state.players.values()].map((p) => [p.kills, p.gv])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
    expect([...RT(w, "v").damaged]).toEqual([]);
    expect(RT(w, "v").lastHit).toBeNull();
  });

  it("puts the victim in the damaged set of every rival among the sources, killing hit or not, and no one else's", () => {
    const w = four(500);
    inStep(w, () => { hit(w, "v", "x", 30); hit(w, "v", "y", 20); hit(w, "v", "ghost", 10); hit(w, "v", "v", 5); });
    expect([...RT(w, "x").damaged]).toEqual(["v"]);
    expect([...RT(w, "y").damaged]).toEqual(["v"]);
    expect([...RT(w, "z").damaged]).toEqual([]);
    expect([...RT(w, "v").damaged]).toEqual([]);
  });

  it("sets lastHit to the largest rival of the tick", () => {
    const w = four(500);
    expect(RT(w, "v").lastHit).toBeNull();
    inStep(w, () => { hit(w, "v", "x", 10); hit(w, "v", "z", 40); hit(w, "v", "y", 20); hit(w, "v", "v", 400); });
    expect(RT(w, "v").lastHit).toEqual({ by: "z", at: w.state.serverTime });
  });

  it("pays an arrow's kill to its shooter", () => {
    const w = arena([
      { ...fighter("archer", "sentenced"), at: { x: 200, y: 320 } }, { ...fighter("target", "fire", 1), at: { x: 400, y: 320 } },
      { ...fighter("idle", "frost"), at: { x: 1200, y: 600 } },
    ]);
    loose(w, [{ id: "archer", a: 0 }]);
    const events = untilEvent(w, "death");
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "target", by: "archer" })]);
    expect(resultsOf(events).target).toMatchObject({ outcome: "died", killedBy: "Archer" });
    expect([P(w, "archer").kills, P(w, "archer").gv]).toEqual([1, GV_KILL]);
  });
});

describe("mitigation", () => {
  /** One hit of 100 raw on a victim of this faction; the hp it lost. */
  function lost(victim: FactionId, shares: DamageShares): number {
    const w = arena([fighter("v", victim), fighter("x")]);
    inStep(w, () => hit(w, "v", "x", 100, { shares }));
    return FACTIONS[victim].hp - P(w, "v").hp;
  }

  // Armor cuts the physical share, shield the magic share, true none: each as 1 / (1 + stat / 100).
  it("cuts the physical share by armor, the magic share by shield, and true damage by neither, for every faction", () => {
    const expected: Record<FactionId, { physical: number; magic: number }> = {
      fire: { physical: 100, magic: 100 / 2.25 }, // armor 0, shield 125
      sentenced: { physical: 100 / 2, magic: 100 / 1.5 }, // armor 100, shield 50
      plague: { physical: 100 / 3, magic: 100 }, // armor 200, shield 0
      frost: { physical: 100 / 2, magic: 100 / 2 }, // armor 100, shield 100
      holy: { physical: 100, magic: 100 / 3.5 }, // armor 0, shield 250
    };
    for (const [victim, want] of Object.entries(expected) as Array<[FactionId, { physical: number; magic: number }]>) {
      expect(lost(victim, PHYSICAL), `${victim} physical`).toBeCloseTo(want.physical, 9);
      expect(lost(victim, MAGIC), `${victim} magic`).toBeCloseTo(want.magic, 9);
      expect(lost(victim, TRUE), `${victim} true`).toBeCloseTo(100, 9);
    }
  });

  it("splits a mixed packet by its shares", () => {
    const shares: DamageShares = { phys: 0.5, magic: 0.25, true: 0.25 };
    expect(lost("sentenced", shares)).toBeCloseTo(100 * (0.5 / 2 + 0.25 / 1.5 + 0.25), 9);
  });

  it("agrees with the faction damage law for a real faction's packet", () => {
    // Plague hits are 80% physical, 20% magic.
    const plague = pacedFaction(FACTIONS.plague);
    expect(lost("frost", { phys: plague.phys, magic: 1 - plague.phys, true: plague.trueShare })).toBeCloseTo(mitigate(100, plague, FACTIONS.frost), 9);
  });

  it("mitigates every entry on its own, by the victim's defence, and adds them up", () => {
    const w = arena([fighter("v", "sentenced"), fighter("x"), fighter("y")]);
    inStep(w, () => {
      hit(w, "v", "x", 100, { shares: PHYSICAL });
      hit(w, "v", "y", 100, { shares: MAGIC });
      hit(w, "v", "x", 100, { shares: TRUE });
    });
    expect(FACTIONS.sentenced.hp - P(w, "v").hp).toBeCloseTo(100 / 2 + 100 / 1.5 + 100, 9);
  });
});

describe("scale", () => {
  it("multiplies the raw damage before the damage law", () => {
    const w = arena([fighter("v", "sentenced"), fighter("x")]);
    inStep(w, () => hit(w, "v", "x", 100, { scale: 0.5 }));
    expect(FACTIONS.sentenced.hp - P(w, "v").hp).toBeCloseTo(25, 9);
  });

  it("makes a scale-0 entry deal nothing: no hp, no hit fx, no credit, no lastHit", () => {
    const w = arena([fighter("v"), fighter("x")]);
    const events = inStep(w, () => hit(w, "v", "x", 100, { scale: 0, stagger: true }));
    expect(P(w, "v").hp).toBe(FACTIONS.fire.hp);
    expect(fxOf(events, "hit")).toEqual([]);
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(RT(w, "x").damaged.size).toBe(0);
    expect(RT(w, "v").lastHit).toBeNull();
  });

  it("lets a scale-0 entry sit beside a real one without changing it", () => {
    const w = arena([fighter("v", "fire", 100), fighter("x"), fighter("y")]);
    const events = inStep(w, () => { hit(w, "v", "x", 500, { scale: 0 }); hit(w, "v", "y", 30); });
    expect(P(w, "v").hp).toBe(70);
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id: "v", by: "y", amount: 30 })]);
    expect(RT(w, "x").damaged.size).toBe(0);
    expect(RT(w, "v").lastHit).toEqual({ by: "y", at: w.state.serverTime });
  });
});

describe("the hit fx", () => {
  it("emits one per entry, in entry order, with the mitigated amount and the weapon", () => {
    const w = arena([fighter("v", "sentenced"), fighter("x"), fighter("y")]);
    const events = inStep(w, () => {
      hit(w, "v", "x", 100, { weapon: "sword" });
      hit(w, "v", "y", 100, { shares: MAGIC, weapon: "wand" });
      hit(w, "v", "x", 50, { shares: TRUE, weapon: "bow" });
    });
    expect(fxOf(events, "hit")).toEqual([
      { kind: "hit", id: "v", by: "x", amount: expect.closeTo(50, 9), weapon: "sword" },
      { kind: "hit", id: "v", by: "y", amount: expect.closeTo(100 / 1.5, 9), weapon: "wand" },
      { kind: "hit", id: "v", by: "x", amount: expect.closeTo(50, 9), weapon: "bow" },
    ]);
  });

  it("names the source's id even when that combatant is gone", () => {
    const w = arena([fighter("v"), fighter("x")]);
    const events = inStep(w, () => hit(w, "v", "ghost", 10));
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id: "v", by: "ghost" })]);
  });

  it("is also emitted for the hit that kills", () => {
    const w = arena([fighter("v", "fire", 10), fighter("x"), fighter("y")]);
    const events = inStep(w, () => hit(w, "v", "x", 50));
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id: "v", amount: 50 })]);
    expect(fxOf(events, "death")).toHaveLength(1);
  });
});

/** A Trial's zone on `subject` from `caster`: what it deals is x0.8, what it takes from the caster x1.2 (the status carries the numbers). */
function zone(world: World, subject: string, caster: string): void {
  const c = combatant(world, subject)!;
  addStatus(world, c, {
    kind: "zoned", source: { id: caster, name: nameOf(caster) }, ms: 5000, ability: "trial",
    data: { fieldId: "f", dealtMult: 0.8, takenFromSourceMult: 1.2 },
  });
}

describe("a zone's factor (D9) and named ability damage (D10)", () => {
  it("multiplies each non-arena entry once, before mitigation: the subject's outgoing x0.8, the caster's hits on it x1.2", () => {
    const w = arena([fighter("v", "frost"), fighter("subject"), fighter("caster")]);
    zone(w, "subject", "caster");
    const hpV = P(w, "v").hp;
    const hpSubject = P(w, "subject").hp;
    inStep(w, () => {
      hit(w, "v", "subject", 100);
      hit(w, "subject", "caster", 100);
      hit(w, "subject", "v", 100);
    });
    expect(hpV - P(w, "v").hp).toBeCloseTo(mitigateShares(100 * 0.8, PHYSICAL, FACTIONS.frost), 9);
    expect(hpSubject - P(w, "subject").hp).toBeCloseTo(120 + 100, 9);
  });

  it("leaves the arena's own damage alone (sudden death is no one's hit)", () => {
    const w = arena([fighter("v"), fighter("subject"), fighter("caster")]);
    zone(w, "subject", "caster");
    const hp = P(w, "subject").hp;
    inStep(w, () => recordHit(w, { victim: "subject", by: { id: "caster", name: "Caster" }, packet: { raw: 100, ...TRUE }, weapon: "axe", stagger: false, arena: true }));
    expect(hp - P(w, "subject").hp).toBeCloseTo(100, 9);
  });

  it("names an ability: the landed record and the hit fx carry it, the weapon is null", () => {
    const w = arena([fighter("v"), fighter("x")]);
    const events = inStep(w, () => recordHit(w, { victim: "v", by: { id: "x", name: "X" }, packet: { raw: 30, ...TRUE }, weapon: null, ability: "freeze", stagger: false }));
    expect(fxOf(events, "hit")).toEqual([{ kind: "hit", id: "v", by: "x", amount: 30, weapon: null, ability: "freeze" }]);
    expect(w.combat.landed).toEqual([expect.objectContaining({ victim: "v", by: "x", amount: 30, weapon: null, ability: "freeze" })]);
    expect(w.combat.landed[0]!.dot).toBeUndefined();
  });

  it("a dot hit lands (hp, landed, lifesteal, the kill) but emits no hit fx of its own", () => {
    const w = arena([fighter("v"), fighter("x")]);
    const events = inStep(w, () => recordHit(w, { victim: "v", by: { id: "x", name: "X" }, packet: { raw: 12, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false }));
    expect(fxOf(events, "hit")).toEqual([]);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.fire.hp - 12, 9);
    expect(w.combat.landed).toEqual([expect.objectContaining({ victim: "v", by: "x", amount: 12, ability: "blaze", dot: true })]);
    const kill = arena([fighter("v", "fire", 5), fighter("x"), fighter("y")]);
    const killing = inStep(kill, () => recordHit(kill, { victim: "v", by: { id: "x", name: "X" }, packet: { raw: 12, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false }));
    expect(fxOf(killing, "death")).toEqual([expect.objectContaining({ id: "v", by: "x" })]);
    expect(fxOf(killing, "hit")).toEqual([]);
  });
});

describe("teleport immunity", () => {
  it("ignores every hit on an immune victim: no hp, no hit fx, no stagger, no credit", () => {
    const w = arena([fighter("v"), fighter("x"), fighter("y")]);
    P(w, "v").immuneUntil = w.state.serverTime + 2 * TICK_MS;
    const events = inStep(w, () => { hit(w, "v", "x", 100, { stagger: true }); hit(w, "v", "y", 100); });
    expect(P(w, "v").hp).toBe(FACTIONS.fire.hp);
    expect(fxOf(events, "hit")).toEqual([]);
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(RT(w, "v").weapon.staggerImmuneUntil).toBe(0);
    expect([RT(w, "x").damaged.size, RT(w, "y").damaged.size]).toEqual([0, 0]);
    expect(RT(w, "v").lastHit).toBeNull();
  });

  it("cannot be killed through immunity either", () => {
    const w = arena([fighter("v", "fire", 1), fighter("x"), fighter("y")]);
    P(w, "v").immuneUntil = w.state.serverTime + 2 * TICK_MS;
    const events = inStep(w, () => hit(w, "v", "x", 1000));
    expect(P(w, "v")).toMatchObject({ hp: 1, status: "alive" });
    expect(fxOf(events, "death")).toEqual([]);
  });

  it("lands again from the tick the immunity ends (immuneUntil is exclusive)", () => {
    const w = arena([fighter("v"), fighter("x")]);
    P(w, "v").immuneUntil = w.state.serverTime + TICK_MS; // the next tick's time
    inStep(w, () => hit(w, "v", "x", 40));
    expect(P(w, "v").hp).toBe(FACTIONS.fire.hp - 40);
  });
});

describe("mobs", () => {
  const dummyWorld = (hp?: number) => {
    const w = arena([fighter("x"), fighter("y"), fighter("z")]);
    const id = addMob(w, { kind: "dummy", name: "Dummy", at: { x: 800, y: 320 }, hp });
    return { w, id, mob: w.state.mobs.get(id)! };
  };

  it("takes the sum of its hits with no armor or shield to cut them", () => {
    const { w, id, mob } = dummyWorld();
    const full = mob.hp;
    const events = inStep(w, () => {
      hit(w, id, "x", 100, { shares: PHYSICAL });
      hit(w, id, "y", 50, { shares: MAGIC });
      hit(w, id, "x", 25, { shares: TRUE, weapon: "bow" });
    });
    expect(mob.hp).toBe(full - 175);
    expect(fxOf(events, "hit")).toEqual([
      expect.objectContaining({ id, by: "x", amount: 100, weapon: "axe" }),
      expect.objectContaining({ id, by: "y", amount: 50 }),
      expect.objectContaining({ id, by: "x", amount: 25, weapon: "bow" }),
    ]);
    expect(w.mobs.get(id)!.lastHitAt).toBe(w.state.serverTime);
  });

  it("never dies: a hit that would empty it refills it, with no death, no result and no GV", () => {
    const { w, id, mob } = dummyWorld(100);
    const events = inStep(w, () => hit(w, id, "x", 500));
    expect(mob).toMatchObject({ hp: 100, status: "alive" });
    expect(fxOf(events, "death")).toEqual([]);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(ofType(events, "gv")).toEqual([]);
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id, amount: 500 })]);
  });

  it("does not count as damage to a player: no damaged entry, no kills, no GV", () => {
    const { w, id } = dummyWorld(100);
    inStep(w, () => { hit(w, id, "x", 500); hit(w, id, "y", 5); });
    for (const p of ["x", "y", "z"]) {
      expect(RT(w, p).damaged.size, p).toBe(0);
      expect([P(w, p).kills, P(w, p).gv, P(w, p).bounty], p).toEqual([0, 0, 0]);
    }
    expect(w.state.phase).toBe("active");
  });

  it("can be staggered: the immunity starts, and with no windup or cast to cancel there is no mark", () => {
    const { w, id } = dummyWorld();
    const events = inStep(w, () => hit(w, id, "x", 10, { stagger: true }));
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(w.mobs.get(id)!.weapon.staggerImmuneUntil).toBe(w.state.serverTime + STAGGER_IMMUNITY_SECONDS * 1000);
  });
});

describe("stagger", () => {
  /** `v` is drawing a bow (Sentenced's, a 400 ms full draw); the draw began three ticks ago. */
  function drawing(): World {
    const w = arena([fighter("v", "sentenced"), fighter("x"), fighter("y")]);
    RT(w, "v").inputs.pushAction({ kind: "attack", a: 0 });
    tick(w);
    tick(w);
    tick(w);
    expect(RT(w, "v").weapon.action?.kind).toBe("draw");
    expect(P(w, "v").drawStartedAt).toBe(w.state.serverTime - 2 * TICK_MS);
    return w;
  }

  it("staggers the victim once, however many stagger entries land: the bow draw carries on, no mark, and the immunity starts", () => {
    const w = drawing();
    const started = P(w, "v").drawStartedAt;
    const events = inStep(w, () => { hit(w, "v", "x", 10, { stagger: true }); hit(w, "v", "y", 10, { stagger: true }); });
    const now = w.state.serverTime;
    expect(fxOf(events, "stagger")).toEqual([]); // the draw was not interrupted: nothing to mark
    expect(P(w, "v").drawStartedAt).toBe(started);
    expect(RT(w, "v").weapon.action).toMatchObject({ kind: "draw", startedAt: started });
    expect(RT(w, "v").weapon.staggerImmuneUntil).toBe(now + STAGGER_IMMUNITY_SECONDS * 1000);
  });

  it("marks a stagger once, however many stagger entries land, when a windup was cancelled", () => {
    const w = arena([fighter("v", "holy"), fighter("x"), fighter("y")]);
    const now = w.state.serverTime;
    RT(w, "v").weapon.action = { kind: "swing", weapon: "sword", startedAt: now, landsAt: now + 5000, a: 0, packet: { raw: 10, phys: 1, magic: 0, true: 0 } };
    const events = inStep(w, () => { hit(w, "v", "x", 10, { stagger: true }); hit(w, "v", "y", 10, { stagger: true }); });
    expect(fxOf(events, "stagger")).toEqual([{ kind: "stagger", id: "v" }]);
    expect(RT(w, "v").weapon.action).toBeNull();
    expect(RT(w, "v").weapon.staggerImmuneUntil).toBe(w.state.serverTime + STAGGER_IMMUNITY_SECONDS * 1000);
  });

  it("does not stagger on a hit that is not a stagger entry", () => {
    const w = drawing();
    const started = P(w, "v").drawStartedAt;
    const events = inStep(w, () => hit(w, "v", "x", 10));
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(P(w, "v").drawStartedAt).toBe(started);
  });

  it("deals the damage but does not stagger a victim that is still staggered-immune", () => {
    const w = drawing();
    const started = P(w, "v").drawStartedAt;
    RT(w, "v").weapon.staggerImmuneUntil = w.state.serverTime + 1000;
    const events = inStep(w, () => hit(w, "v", "x", 10, { stagger: true }));
    expect(fxOf(events, "hit")).toHaveLength(1);
    expect(fxOf(events, "stagger")).toEqual([]);
    expect(P(w, "v").drawStartedAt).toBe(started);
  });

  it("does not stagger on a stagger entry that did nothing (scale 0), nor on a victim the hits killed", () => {
    const w = drawing();
    const none = inStep(w, () => { hit(w, "v", "x", 10, { stagger: true, scale: 0 }); hit(w, "v", "y", 10); });
    expect(fxOf(none, "stagger")).toEqual([]);

    const dying = arena([fighter("v", "fire", 5), fighter("x"), fighter("y")]);
    const events = inStep(dying, () => hit(dying, "v", "x", 10, { stagger: true }));
    expect(fxOf(events, "death")).toHaveLength(1);
    expect(fxOf(events, "stagger")).toEqual([]);
  });
});

describe("hits from combatants that are gone", () => {
  it("credits the name on the entry, with no kill, GV or damaged entry for anyone", () => {
    const w = arena([fighter("v", "fire", 10), fighter("x"), fighter("y")]);
    const events = inStep(w, () => hit(w, "v", "departed", 50, { name: "Zed" }));
    expect(resultsOf(events).v).toMatchObject({ outcome: "died", killedBy: "Zed" });
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "v", by: null })]);
    expect(fxOf(events, "hit")).toEqual([expect.objectContaining({ id: "v", by: "departed", amount: 50 })]);
    expect([...w.state.players.values()].map((p) => [p.kills, p.gv])).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(RT(w, "v").lastHit).toBeNull();
  });

  it("credits a mob's hit on a player by the mob's name", () => {
    const w = arena([fighter("v", "fire", 10), fighter("x"), fighter("y")]);
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 } });
    const events = inStep(w, () => hit(w, "v", mob, 50, { name: "Warden" }));
    expect(resultsOf(events).v).toMatchObject({ outcome: "died", killedBy: "Warden" });
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ by: null })]);
  });

  it("credits a shooter whose result is already out by name only: a living rival's smaller hit takes the kill and the bounty", () => {
    const w = arena([fighter("a"), fighter("c", "fire", 100), fighter("d"), fighter("e")]);
    P(w, "c").bounty = 25;
    applyDamage(w, P(w, "a"), RT(w, "a"), 5000, "test"); // a is down and its result is out, but it is still in the room
    expect(RT(w, "a").resolved).toBe(true);
    w.events = [];
    const events = inStep(w, () => { hit(w, "c", "a", 90); hit(w, "c", "d", 20); });
    expect(resultsOf(events).c).toMatchObject({ outcome: "died", killedBy: "D" });
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "c", by: "d" })]);
    expect([P(w, "d").kills, P(w, "d").gv]).toEqual([1, GV_KILL + 25]);
    expect(RT(w, "d").gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 25, quest: 0 });
    expect([P(w, "a").kills, P(w, "a").gv]).toEqual([0, 0]);
    expect([...RT(w, "a").damaged]).toEqual([]);
    expect(RT(w, "c").lastHit).toEqual({ by: "d", at: w.state.serverTime });
  });

  it("a resolved shooter's hit on its own is nobody's kill: its name, no death credit", () => {
    const w = arena([fighter("a"), fighter("c", "fire", 100), fighter("d"), fighter("e")]);
    P(w, "c").bounty = 25;
    applyDamage(w, P(w, "a"), RT(w, "a"), 5000, "test");
    w.events = [];
    const events = inStep(w, () => hit(w, "c", "a", 150));
    expect(resultsOf(events).c).toMatchObject({ outcome: "died", killedBy: "A" });
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "c", by: null })]);
    expect([...w.state.players.values()].map((p) => [p.kills, p.gv])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
    expect(ofType(events, "gv")).toEqual([]);
  });

  it("skips entries for a victim that is not in the room or is already down", () => {
    const w = arena([fighter("v", "fire", 10), fighter("x"), fighter("y")]);
    applyDamage(w, P(w, "v"), RT(w, "v"), 1000, "test");
    w.events = [];
    const events = inStep(w, () => { hit(w, "v", "x", 50); hit(w, "nobody", "x", 50); });
    expect(fxOf(events, "hit")).toEqual([]);
    expect(fxOf(events, "death")).toEqual([]);
    expect(ofType(events, "resolved")).toEqual([]);
    expect(RT(w, "x").damaged.size).toBe(0);
  });
});

describe("hits from projectiles", () => {
  // Two archers 50 u above and below the line to the target: their arrows fly the same distance and land together.
  const crossfire = (hp?: number) => arena([
    { ...fighter("sent", "sentenced"), at: { x: 300, y: 270 } }, { ...fighter("plague", "plague"), at: { x: 300, y: 370 } },
    { ...fighter("target", "fire", hp), at: { x: 500, y: 320 } }, { ...fighter("idle", "frost"), at: { x: 1200, y: 600 } },
  ]);
  const aim = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

  it("lands the arrows of two shooters in the same tick together, with a hit fx for each", () => {
    const w = crossfire();
    loose(w, [{ id: "sent", a: aim({ x: 300, y: 270 }, { x: 500, y: 320 }) }, { id: "plague", a: aim({ x: 300, y: 370 }, { x: 500, y: 320 }) }]);
    const events = untilEvent(w, "projEnd");
    expect(fxOf(events, "projEnd").map((e) => e.reason)).toEqual(["hit", "hit"]);
    const fromSent = hitAmount("sentenced", "bow", "fire");
    const fromPlague = hitAmount("plague", "bow", "fire");
    expect(fxOf(events, "hit").map((h) => [h.by, h.amount])).toEqual([
      ["sent", expect.closeTo(fromSent, 9)], ["plague", expect.closeTo(fromPlague, 9)],
    ]);
    expect(FACTIONS.fire.hp - P(w, "target").hp).toBeCloseTo(fromSent + fromPlague, 9);
  });

  it("pays the kill of two arrows to the larger one, and both shooters have damaged the victim", () => {
    const w = crossfire(12); // Plague's arrow is far the larger and kills alone; Sentenced's adds a little
    loose(w, [{ id: "sent", a: aim({ x: 300, y: 270 }, { x: 500, y: 320 }) }, { id: "plague", a: aim({ x: 300, y: 370 }, { x: 500, y: 320 }) }]);
    const events = untilEvent(w, "death");
    expect(fxOf(events, "death")).toEqual([expect.objectContaining({ id: "target", by: "plague" })]);
    expect(resultsOf(events).target).toMatchObject({ killedBy: "Plague" });
    expect([P(w, "sent").kills, P(w, "plague").kills]).toEqual([0, 1]);
    expect([...RT(w, "sent").damaged]).toEqual(["target"]);
    expect([...RT(w, "plague").damaged]).toEqual(["target"]);
  });

  /** Two Sentenced archers face to face, each about to hit the other. */
  function duel(hpA: number, hpB: number): { w: World; events: SimEvent[] } {
    const w = arena([
      { ...fighter("a", "sentenced", hpA), at: { x: 350, y: 320 } }, { ...fighter("b", "sentenced", hpB), at: { x: 550, y: 320 } },
    ]);
    loose(w, [{ id: "a", a: 0 }, { id: "b", a: Math.PI }]);
    return { w, events: untilEvent(w, "death") };
  }

  it("takes two archers who shoot each other dead in the same tick down together; equal fractions are a draw", () => {
    const { w, events } = duel(1, 1);
    expect(fxOf(events, "death").map((d) => d.id).sort()).toEqual(["a", "b"]);
    const results = resultsOf(events);
    expect(results.a).toMatchObject({ outcome: "draw", place: 1 });
    expect(results.b).toMatchObject({ outcome: "draw", place: 1 });
    expect(w.state.winner).toBe("");
  });

  it("gives that duel to the archer with the higher hp fraction at the start of the tick", () => {
    const { w, events } = duel(1, 2);
    const results = resultsOf(events);
    expect(results.b).toMatchObject({ outcome: "won", place: 1 });
    expect(results.a).toMatchObject({ outcome: "died", place: 2, killedBy: "B" });
    expect(w.state.winner).toBe("B");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Real shots, for the projectile tests above

/** Arrows from these Sentenced/Plague archers, taps timed so that all of them leave in the same tick. Cooldowns are not under test. */
function loose(world: World, shots: Array<{ id: string; a: number }>): void {
  const need = shots.map((s) => {
    P(world, s.id).readyAt = 0;
    return Math.ceil((timingsOf(P(world, s.id), "bow")!.windup * 1000) / TICK_MS - 1e-9);
  });
  const total = Math.max(...need);
  for (let i = 0; i <= total; i++) {
    shots.forEach((s, k) => {
      const q = RT(world, s.id).inputs;
      if (i === total - need[k]!) {
        q.pushAction({ kind: "attack", a: s.a });
        q.pushAction({ kind: "release", a: s.a });
      }
    });
    tick(world);
  }
  expect(world.projectiles.size).toBe(shots.length);
}

/** Ticks until `kind` of fx appears; returns that tick's events. */
function untilEvent(world: World, kind: FxEvent["kind"]): SimEvent[] {
  for (let i = 0; i < 60; i++) {
    const events = tick(world);
    if (fxOf(events, kind as "death").length > 0) return events;
  }
  throw new Error(`no ${kind} fx within 60 ticks`);
}

/** What one full hit of `weapon` by a `from` fighter costs a `to` fighter after the damage law (DUEL_PACE applied). */
function hitAmount(from: FactionId, weapon: WeaponId, to: FactionId): number {
  const spec = pacedFaction(FACTIONS[from]);
  return mitigateShares(damagePerHit(spec, weapon), damageShares(spec), FACTIONS[to]);
}

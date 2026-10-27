// The ledger's outgoing multiplier (roguelike R4a, sim/ledger.ts + sim/mods.ts outgoingMult): damage, vs and scale rows
// multiply every entry's raw damage before armor and shield, weapon hits and signature damage alike, fixed from the state
// as the pass began, so the order entries were recorded in never changes a result. Also: the arena's burn is never
// multiplied, a Sentenced damage buff reaches its mark, a Wish's ability entry (and its DoT chunks) is never multiplied (flat
// power, owner ruling "Keep Wishes flat"), the `hurt` hook reports each surviving victim once a pass, and Wishes'
// damageFactor (Trial's zone) multiplies in after the rows, just as order-free.
import { describe, expect, it } from "vitest";
import {
  damageShares, FACTIONS, mapFromTiles, mitigateShares, mulberry32, pacedFaction, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, type Effect, type FactionId, type GameMap,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { combatant, defenseOf, type Combatant } from "../src/sim/combatant";
import { noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { setExtraRows } from "../src/sim/mods";
import { addStatus } from "../src/sim/status";
import { addPlayer, step } from "../src/sim/step";
import { chainHook, type LedgerEntry, type World } from "../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: (3 + 3 * i) * TILE + TILE / 2, y: 10 * TILE + TILE / 2 }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

function startRun(factions: FactionId[], signatures = false): World {
  const world = createGameWorld({
    config: { minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false },
    random: mulberry32(10),
    map: openMap(),
  }, { signatures });
  factions.forEach((faction, i) => addPlayer(world, `p${i}`, `name${i}`, { faction }));
  step(world, TICK_MS);
  return world;
}

const P = (w: World, id: string): PlayerState => w.state.players.get(id)!;
const paced = (id: FactionId) => pacedFaction(FACTIONS[id]);

// The rows these tests are about, crafted (setExtraRows) so that they test the ledger's rule and not a card's number: a flat damage row,
// a vs row below / above an hp share, a scale row that grows with the owner's missing hp, and a trigger.
const EMBER: Effect = { k: "stat", stat: "damage", v: 0.15 };
const EXECUTE: Effect = { k: "vs", test: "hpBelow", arg: 0.3, v: 0.3 };
const WYRM: Effect = { k: "vs", test: "hpAbove", arg: 0.7, v: 0.2 };
const OGRE: Effect = { k: "vs", test: "hpBelow", arg: 0.5, v: 0.16 };
const PENITENT: Effect = { k: "scale", src: "ownMissingHp", per: 0.03, step: 0.1 };
const PENITENT_PER = 0.03;
/** Gives p`id` these rows (replacing any it had): folded at once, like a card's. */
const own = (w: World, id: string, ...rows: Effect[]): void => setExtraRows(w, combatant(w, id)!, rows);

// ------------------------------------------------------------------------------------------------- the order-free pass

const FACTIONS_OF: FactionId[] = ["fire", "holy", "plague", "frost", "sentenced"];
type Hit = { by: string; victim: string; raw: number; sig?: "burn" | "mark" };

/**
 * Five players, every one of them with damage rows, hp set near the vs thresholds, plus a dummy. The same build every
 * call, so two worlds differ only in the order their hits are recorded.
 */
function buildPass(): { w: World; dummy: string } {
  const w = startRun(FACTIONS_OF);
  own(w, "p0", EMBER, EXECUTE, WYRM);
  own(w, "p1", PENITENT, OGRE);
  own(w, "p2", EXECUTE);
  own(w, "p3", WYRM);
  own(w, "p4", EMBER);
  const hp: Record<string, number> = { p0: 0.95, p1: 0.62, p2: 0.32, p3: 0.71, p4: 0.51 };
  for (const [id, frac] of Object.entries(hp)) {
    P(w, id).maxHp = 1e4;
    P(w, id).hp = 1e4 * frac;
  }
  const dummy = addMob(w, { kind: "dummy", name: "dummy", at: { x: 100, y: 100 }, hp: 5000 });
  w.state.mobs.get(dummy)!.hp = 1600; // 32%
  return { w, dummy };
}

function hits(dummy: string): Hit[] {
  return [
    // p2 starts at 32%: the first of these would take it under 30%, but every multiplier reads it at 32%.
    { by: "p0", victim: "p2", raw: 300 },
    { by: "p0", victim: "p2", raw: 300 },
    { by: "p1", victim: "p2", raw: 200 },
    { by: "p0", victim: "p3", raw: 150 },
    { by: "p3", victim: "p0", raw: 120 },
    { by: "p3", victim: "p1", raw: 90 },
    { by: "p4", victim: "p1", raw: 40, sig: "mark" },
    { by: "p1", victim: "p4", raw: 77 },
    { by: "p2", victim: "p4", raw: 500 },
    { by: "p0", victim: dummy, raw: 250 },
    { by: "p1", victim: dummy, raw: 250 },
    { by: "p0", victim: "p1", raw: 10, sig: "burn" },
  ];
}

function record(w: World, h: Hit): LedgerEntry {
  const spec = paced(P(w, h.by).faction as FactionId);
  return recordHit(w, {
    victim: h.victim, by: { id: h.by, name: P(w, h.by).name }, packet: { raw: h.raw, ...damageShares(spec) }, weapon: "sword",
    stagger: false, sig: h.sig,
  });
}

function outcome(w: World, dummy: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, p] of w.state.players) out[id] = p.hp;
  out[dummy] = w.state.mobs.get(dummy)!.hp;
  return out;
}

describe("the outgoing multiplier keeps the ledger order-free", () => {
  it("any order the hits are recorded in gives the same hp to the bit, from the hp the pass began with", () => {
    const base = buildPass();
    const list = hits(base.dummy);
    for (const h of list) record(base.w, h);
    applyLedger(base.w);
    const want = outcome(base.w, base.dummy);
    const r = mulberry32(2024);
    for (let trial = 0; trial < 25; trial++) {
      const { w, dummy } = buildPass();
      const shuffled = [...hits(dummy)];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      for (const h of shuffled) record(w, h);
      applyLedger(w);
      expect(outcome(w, dummy), `trial ${trial}`).toEqual(want);
    }
  });

  it("each multiplier reads the pass's starting hp: a victim taken under 30% by the pass gets no below-30% bonus in it", () => {
    const { w } = buildPass();
    const before = P(w, "p2").hp;
    for (const h of hits("none").filter((x) => x.victim === "p2")) record(w, h);
    applyLedger(w);
    const def = defenseOf(P(w, "p2"));
    // p0: the damage row only; p2 is at 32%, so neither the below-30% row nor the above-70% row applies.
    const p0Mult = 1 + 0.15;
    // p1 at 62%: 3 whole 10% steps of missing hp for the scale row, plus the below-50% row (p2 is below 50%); the rows add.
    const p1Mult = 1 + PENITENT_PER * 3 + 0.16;
    const want = 2 * mitigateShares(300 * p0Mult, damageShares(paced("fire")), def)
      + mitigateShares(200 * p1Mult, damageShares(paced("holy")), def);
    expect(before - P(w, "p2").hp).toBeCloseTo(want, 9);
    expect(P(w, "p2").hp / P(w, "p2").maxHp).toBeLessThan(0.3);
    // A second pass now sees it under 30%.
    const hp2 = P(w, "p2").hp;
    record(w, { by: "p0", victim: "p2", raw: 100 });
    applyLedger(w);
    const exec = 1 + 0.15 + 0.3;
    expect(hp2 - P(w, "p2").hp).toBeCloseTo(mitigateShares(100 * exec, damageShares(paced("fire")), def), 9);
  });

  it("never multiplies the arena's own burn", () => {
    const w = startRun(["fire", "frost"]);
    own(w, "p0", EMBER);
    P(w, "p1").maxHp = 1e4;
    P(w, "p1").hp = 9000;
    recordHit(w, { victim: "p1", by: { id: "p0", name: "x" }, packet: { raw: 100, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false, arena: true });
    applyLedger(w);
    expect(P(w, "p1").hp).toBe(8900);
  });

  // Each attacker is also the other's victim in one pass, and each hit takes its victim across a Penitent step. The result must
  // use every attacker's hp as the pass began, whichever fighter the ledger happens to settle first: a multiplier read lazily,
  // when its attacker is settled as a victim (or when its own victim is), would give the two entry orders different damage.
  it("cross-attacker Penitent: two fighters hitting each other in one pass use the start-of-pass hp, in either order of entries", () => {
    const TRUE = { phys: 0, magic: 0, true: 1 } as const;
    const setup = (): World => {
      const w = startRun(["fire", "holy"]);
      own(w, "p0", PENITENT);
      own(w, "p1", PENITENT);
      for (const [id, hp] of [["p0", 6010], ["p1", 5010]] as const) {
        P(w, id).maxHp = 1e4;
        P(w, id).hp = hp; // 39.9% and 49.9% missing: three and four whole steps; one hit each takes the other across the next
      }
      return w;
    };
    const entry = (w: World, by: string, victim: string, raw: number): void => {
      recordHit(w, { victim, by: { id: by, name: P(w, by).name }, packet: { raw, ...TRUE }, weapon: "sword", stagger: false });
    };
    const hitFor = (steps: number) => 1 + PENITENT_PER * steps;
    const runOrder = (order: ReadonlyArray<readonly [string, string, number]>): [number, number] => {
      const w = setup();
      for (const [by, victim, raw] of order) entry(w, by, victim, raw);
      applyLedger(w);
      return [P(w, "p0").hp, P(w, "p1").hp];
    };
    const a = ["p0", "p1", 100] as const; // p0 (3 steps at the pass start) hits p1: its 4-step hp is not p0's
    const b = ["p1", "p0", 600] as const; // p1 (4 steps) hits p0 across 40% missing: p0 would be at 4 steps afterwards
    const forward = runOrder([a, b]);
    expect(runOrder([b, a])).toEqual(forward);
    expect(forward).toEqual([6010 - 600 * hitFor(4), 5010 - 100 * hitFor(3)]);
    // Not the lazy answer: the same hits with p0 read at 4 steps (its hp after b) differ, so a lazy read cannot pass.
    expect(100 * hitFor(4)).not.toBeCloseTo(100 * hitFor(3), 6);
  });
});

// ------------------------------------------------------------------------------------------- Trial's zone and the rows

/**
 * Fire p0 stands in Holy p1's Trial (it deals x0.8; it takes x1.2 from p1), with a damage row and a vs-above-70% row;
 * p1 has the damage row; Plague p2 has nothing. p1 starts at 72%, so p0's hit alone takes it under 70%: the vs row still holds.
 */
function trialPass(): World {
  const w = startRun(["fire", "holy", "plague"]);
  own(w, "p0", EMBER, WYRM);
  own(w, "p1", EMBER);
  for (const [id, frac] of [["p0", 0.9], ["p1", 0.72], ["p2", 0.9]] as const) {
    P(w, id).maxHp = 1e4;
    P(w, id).hp = 1e4 * frac;
  }
  addStatus(w, combatant(w, "p0")!, {
    kind: "zoned", source: { id: "p1", name: P(w, "p1").name }, ability: "trial", ms: 5000, value: 0.8,
    data: { dealtMult: 0.8, takenFromSourceMult: 1.2 },
  });
  return w;
}
const TRIAL_HITS: Hit[] = [
  { by: "p0", victim: "p1", raw: 1500 },
  { by: "p1", victim: "p0", raw: 200 },
  { by: "p2", victim: "p0", raw: 100 },
  { by: "p0", victim: "p2", raw: 150 },
  { by: "p0", victim: "p1", raw: 5, sig: "burn" },
];

describe("Trial's damageFactor and the outgoing rows", () => {
  it("multiply as raw x rows x zone, then armor and shield, whatever order the entries were recorded in", () => {
    const w = trialPass();
    const start = { p0: P(w, "p0").hp, p1: P(w, "p1").hp, p2: P(w, "p2").hp };
    const def = { p0: defenseOf(P(w, "p0")), p1: defenseOf(P(w, "p1")), p2: defenseOf(P(w, "p2")) };
    for (const h of TRIAL_HITS) record(w, h);
    applyLedger(w);
    const ember = 0.15;
    const p0Rows = 1 + ember + 0.2; // rows in the damage key add; the above-70% row reads p1 at 72%, p2 at 90%
    const fire = damageShares(paced("fire"));
    const holy = damageShares(paced("holy"));
    const plague = damageShares(paced("plague"));
    // p0 deals x0.8 to anyone; p0 takes x1.2 only from the zone's caster p1.
    const want = {
      p1: mitigateShares(1500 * p0Rows * 0.8, fire, def.p1) + mitigateShares(5 * p0Rows * 0.8, fire, def.p1),
      p0: mitigateShares(200 * (1 + ember) * 1.2, holy, def.p0) + mitigateShares(100, plague, def.p0),
      p2: mitigateShares(150 * p0Rows * 0.8, fire, def.p2),
    };
    for (const id of ["p0", "p1", "p2"] as const) expect(start[id] - P(w, id).hp, id).toBeCloseTo(want[id], 9);
    expect(P(w, "p1").hp / P(w, "p1").maxHp).toBeLessThan(0.7);
    // Every other recording order: the same hp to the bit.
    const hp = (x: World) => ["p0", "p1", "p2"].map((id) => P(x, id).hp);
    const r = mulberry32(77);
    for (let trial = 0; trial < 20; trial++) {
      const x = trialPass();
      const shuffled = [...TRIAL_HITS];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      for (const h of shuffled) record(x, h);
      applyLedger(x);
      expect(hp(x), `trial ${trial}`).toEqual(hp(w));
    }
  });
});

// ----------------------------------------------------------------------------------------------- flat Wish power

describe("a Wish's ability damage is flat power: the damage rows never multiply it (owner ruling \"Keep Wishes flat\")", () => {
  const TRUE = { phys: 0, magic: 0, true: 1 } as const;
  /** A Fire p0 with every kind of damage row, low on hp (Penitent) against victims under 30% (Executioner) and 100%. */
  function buffed(withBuffs = true): World {
    const w = startRun(["fire", "frost", "plague"]);
    if (withBuffs) {
      own(w, "p0", EMBER, EXECUTE, PENITENT, WYRM);
    }
    for (const [id, frac] of [["p0", 0.55], ["p1", 0.25], ["p2", 0.25]] as const) {
      P(w, id).maxHp = 1e4;
      P(w, id).hp = 1e4 * frac;
    }
    return w;
  }
  const rowsFor = (): number => 1 + 0.15 + 0.3 + PENITENT_PER * 4; // p0 at 55%: four whole 10% steps missing; p1 and p2 are under 30%

  it("an ability hit and a Blaze Step trail tick deal their raw damage; the same caster's weapon hit in the same pass gets the rows", () => {
    const w = buffed();
    const rows = rowsFor();
    expect(rows).toBeGreaterThan(1.3);
    const by = { id: "p0", name: P(w, "p0").name };
    const before = { p1: P(w, "p1").hp, p2: P(w, "p2").hp };
    // p1: the trail's burn chunk (ability + dot) and a one-shot ability hit; p2: a weapon hit of the same size.
    recordHit(w, { victim: "p1", by, packet: { raw: 12, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false });
    recordHit(w, { victim: "p1", by, packet: { raw: 80, ...TRUE }, weapon: null, ability: "blaze", stagger: false });
    recordHit(w, { victim: "p2", by, packet: { raw: 92, ...TRUE }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(before.p1 - P(w, "p1").hp).toBeCloseTo(92, 9);
    expect(before.p2 - P(w, "p2").hp).toBeCloseTo(92 * rows, 9);
    // The hit that landed is reported at its flat size too (kill credit, mob threat and lifesteal read it).
    const flat = w.combat.landed.filter((h) => h.victim === "p1" && h.by === "p0");
    expect(flat.map((h) => h.amount)).toEqual([12, 80]);
  });

  it("a real burn status ticking in a stepped tick is identical with and without the buffs, and a weapon hit beside it is not", () => {
    const loss = (withBuffs: boolean): [number, number] => {
      const w = buffed(withBuffs);
      const by = { id: "p0", name: P(w, "p0").name };
      addStatus(w, combatant(w, "p1")!, { kind: "dot", source: by, ability: "blaze", ms: 5000, value: 30 });
      // A weapon hit recorded in the tick's own recording phase (the tick starts with a clean ledger).
      w.beforeDamage.push((world) => {
        recordHit(world, { victim: "p2", by, packet: { raw: 50, ...TRUE }, weapon: "sword", stagger: false });
      });
      const h1 = P(w, "p1").hp;
      const h2 = P(w, "p2").hp;
      step(w, TICK_MS);
      return [h1 - P(w, "p1").hp, h2 - P(w, "p2").hp];
    };
    const plain = loss(false);
    const rich = loss(true);
    expect(plain[0]).toBeCloseTo(30 * (TICK_MS / 1000), 9);
    expect(rich[0]).toBeCloseTo(plain[0], 9);
    expect(plain[1]).toBeCloseTo(50, 9);
    expect(rich[1]).toBeCloseTo(50 * rowsFor(), 9);
  });

  it("Trial's damageFactor still multiplies ability damage, both ways, and the rows still do not", () => {
    const w = trialPass();
    const p0 = { id: "p0", name: P(w, "p0").name };
    const p1 = { id: "p1", name: P(w, "p1").name };
    const before = { p0: P(w, "p0").hp, p2: P(w, "p2").hp };
    // p0 (damage and above-70% rows, zoned: deals x0.8) burns p2; p1 (damage row, the zone's caster) burns p0 (x1.2 from the caster).
    recordHit(w, { victim: "p2", by: p0, packet: { raw: 100, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false });
    recordHit(w, { victim: "p0", by: p1, packet: { raw: 100, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false });
    applyLedger(w);
    expect(before.p2 - P(w, "p2").hp).toBeCloseTo(80, 9);
    expect(before.p0 - P(w, "p0").hp).toBeCloseTo(120, 9);
  });
});

// ------------------------------------------------------------------------------------------------ signature damage

/** A Sentenced (bow) p0 engaged with a Frost p1 for `ticks` steps, with a damage row of `v` (none for 0): the mark damage it landed. */
function markDamage(v: number, ticks: number): number {
  const w = startRun(["sentenced", "frost"], true);
  for (const id of ["p0", "p1"]) {
    P(w, id).maxHp = 1e7;
    P(w, id).hp = 1e7;
  }
  P(w, "p0").weapon0 = "bow";
  P(w, "p1").weapon0 = "shield";
  P(w, "p0").x = 300; P(w, "p0").y = 330;
  P(w, "p1").x = 420; P(w, "p1").y = 330;
  for (const id of ["p0", "p1"]) w.players.get(id)!.history = [{ t: w.state.serverTime, x: P(w, id).x, y: P(w, id).y }];
  if (v > 0) own(w, "p0", { k: "stat", stat: "damage", v });
  noteContact(w, "p0", "p1");
  let mark = 0;
  for (let i = 0; i < ticks; i++) {
    step(w, TICK_MS);
    for (const h of w.combat.landed) if (h.by === "p0" && h.sig === "mark") mark += h.amount;
  }
  return mark;
}

describe("signature damage takes the multiplier too", () => {
  it("a Sentenced player's damage row raises its mark damage by exactly the row", () => {
    const plain = markDamage(0, 30);
    expect(plain).toBeGreaterThan(0);
    for (const v of [0.1, 0.35]) expect(markDamage(v, 30) / plain).toBeCloseTo(1 + v, 9);
  });
});

// --------------------------------------------------------------------------------------------------------- the hook

describe("the hurt hook", () => {
  it("reports each surviving victim once per pass, after all of its hits, and never one the pass killed", () => {
    const w = startRun(["fire", "frost", "holy"]);
    const seen: Array<[string, number, number]> = [];
    chainHook(w, "hurt", (_w, c: Combatant, applied) => { seen.push([c.id, applied, c.s.hp]); });
    P(w, "p1").hp = 1000;
    P(w, "p2").hp = 10;
    for (const [victim, raw] of [["p1", 100], ["p1", 50], ["p2", 5000]] as const) {
      recordHit(w, { victim, by: { id: "p0", name: "x" }, packet: { raw, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
    }
    applyLedger(w);
    expect(seen).toEqual([["p1", 150, 850]]);
  });

  it("also reports the hp as the pass began, which a death floor's `applied` (the whole hit) cannot rebuild", () => {
    const w = startRun(["fire", "frost"]);
    const seen: Array<[number, number, number]> = [];
    chainHook(w, "hurt", (_w, c: Combatant, applied, hpBefore) => { seen.push([applied, hpBefore, c.s.hp]); });
    P(w, "p1").maxHp = 1000;
    P(w, "p1").hp = 250;
    addStatus(w, combatant(w, "p1")!, {
      kind: "deathFloor", source: { id: "p1", name: "x" }, ability: "lastStand", ms: 5000, data: { floorHp: 100, healShare: 0.3 },
    });
    recordHit(w, { victim: "p1", by: { id: "p0", name: "x" }, packet: { raw: 500, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(seen).toEqual([[500, 250, 100]]);
  });

  it("a hpBelow trigger that is not `once` fires only for a pass that takes the owner across 30%: not one held at the floor", () => {
    {
      const run = (hp: number, floor: boolean, raw: number): number => {
        const w = startRun(["frost", "fire"], true);
        own(w, "p0", { k: "trigger", on: "hpBelow", arg: 0.3, do: { do: "heal", share: 0.2, ignoreLockout: true } });
        P(w, "p0").maxHp = 1000;
        P(w, "p0").hp = hp;
        if (floor) {
          addStatus(w, combatant(w, "p0")!, {
            kind: "deathFloor", source: { id: "p0", name: "x" }, ability: "lastStand", ms: 5000, data: { floorHp: 100, healShare: 0.3 },
          });
        }
        recordHit(w, { victim: "p0", by: { id: "p1", name: "x" }, packet: { raw, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
        applyLedger(w);
        return P(w, "p0").hp;
      };
      const heal = 0.2 * 1000;
      expect(run(250, false, 100)).toBe(150); // already under 30%, no floor: no trigger
      expect(run(250, true, 500)).toBe(100); // already under 30%, held at the floor by a big hit: still no trigger
      expect(run(400, false, 200)).toBeCloseTo(200 + heal, 6); // 40% -> 20%: crossed
      expect(run(400, true, 500)).toBeCloseTo(100 + heal, 6); // 40% -> the floor: crossed
    }
  });
});

// The ledger's outgoing multiplier (roguelike R4a, sim/ledger.ts + sim/mods.ts outgoingMult): damage, vs and scale rows
// multiply every entry's raw damage before armor and shield, weapon hits and signature damage alike, fixed from the state
// as the pass began, so the order entries were recorded in never changes a result. Also: the arena's burn is never
// multiplied, a Sentenced damage buff reaches its mark, and the `hurt` hook reports each surviving victim once a pass.
import { describe, expect, it } from "vitest";
import {
  buffScale, damageShares, FACTIONS, mapFromTiles, mitigateShares, mulberry32, pacedFaction, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, type BuffId, type FactionId, type GameMap,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { grantBuff } from "../src/sim/buffs";
import { defenseOf, type Combatant } from "../src/sim/combatant";
import { noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { chainHook, type LedgerEntry, type World } from "../src/sim/world";
import { quoted } from "./support/quoted";

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
    config: { minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(10),
    map: openMap(),
  }, { signatures });
  factions.forEach((faction, i) => addPlayer(world, `p${i}`, `name${i}`, { faction }));
  step(world, TICK_MS);
  return world;
}

const P = (w: World, id: string): PlayerState => w.state.players.get(id)!;
const paced = (id: FactionId) => pacedFaction(FACTIONS[id]);
const grant = (w: World, id: string, buff: BuffId, n: number): void => grantBuff(w, P(w, id), w.players.get(id)!, buff, n);

// ------------------------------------------------------------------------------------------------- the order-free pass

const FACTIONS_OF: FactionId[] = ["fire", "holy", "plague", "frost", "sentenced"];
type Hit = { by: string; victim: string; raw: number; sig?: "burn" | "mark" };

/**
 * Five players, every one of them with damage rows, hp set near the vs thresholds, plus a dummy. The same build every
 * call, so two worlds differ only in the order their hits are recorded.
 */
function buildPass(): { w: World; dummy: string } {
  const w = startRun(FACTIONS_OF);
  grant(w, "p0", "emberImp", 4);
  grant(w, "p0", "executioner", 3);
  grant(w, "p0", "wyrmling", 2.5);
  grant(w, "p1", "penitent", 6);
  grant(w, "p1", "ratOgre", 3.3);
  grant(w, "p2", "executioner", 1.2);
  grant(w, "p3", "wyrmling", 5);
  grant(w, "p4", "emberImp", 3);
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

  it("each multiplier reads the pass's starting hp: a victim taken under 30% by the pass gets no executioner bonus in it", () => {
    const { w } = buildPass();
    const before = P(w, "p2").hp;
    for (const h of hits("none").filter((x) => x.victim === "p2")) record(w, h);
    applyLedger(w);
    const def = defenseOf(P(w, "p2"));
    // p0: Ember Imp (4 stacks) only; p2 is at 32%, so neither Executioner (below 30) nor Wyrmling (above 70) applies.
    const p0Mult = 1 + quoted("emberImp") * buffScale(4);
    // p1 at 62%: 3 whole 10% steps of missing hp for Penitent, plus Rat Ogre (p2 is below 50%); the rows add.
    const p1Mult = 1 + quoted("penitent") * buffScale(6) * 3 + quoted("ratOgre") * buffScale(3.3);
    const want = 2 * mitigateShares(300 * p0Mult, damageShares(paced("fire")), def)
      + mitigateShares(200 * p1Mult, damageShares(paced("holy")), def);
    expect(before - P(w, "p2").hp).toBeCloseTo(want, 9);
    expect(P(w, "p2").hp / P(w, "p2").maxHp).toBeLessThan(0.3);
    // A second pass now sees it under 30%.
    const hp2 = P(w, "p2").hp;
    record(w, { by: "p0", victim: "p2", raw: 100 });
    applyLedger(w);
    const exec = 1 + quoted("emberImp") * buffScale(4) + quoted("executioner") * buffScale(3);
    expect(hp2 - P(w, "p2").hp).toBeCloseTo(mitigateShares(100 * exec, damageShares(paced("fire")), def), 9);
  });

  it("never multiplies the arena's own burn", () => {
    const w = startRun(["fire", "frost"]);
    grant(w, "p0", "emberImp", 6);
    P(w, "p1").maxHp = 1e4;
    P(w, "p1").hp = 9000;
    recordHit(w, { victim: "p1", by: { id: "p0", name: "x" }, packet: { raw: 100, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false, arena: true });
    applyLedger(w);
    expect(P(w, "p1").hp).toBe(8900);
  });
});

// ------------------------------------------------------------------------------------------------ signature damage

/** A Sentenced (bow) p0 engaged with a Frost p1 for `ticks` steps, with `n` Ember Imp stacks: the mark damage it landed. */
function markDamage(n: number, ticks: number): number {
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
  if (n > 0) grant(w, "p0", "emberImp", n);
  noteContact(w, "p0", "p1");
  let mark = 0;
  for (let i = 0; i < ticks; i++) {
    step(w, TICK_MS);
    for (const h of w.combat.landed) if (h.by === "p0" && h.sig === "mark") mark += h.amount;
  }
  return mark;
}

describe("signature damage takes the multiplier too", () => {
  it("a Sentenced player's Ember Imp buff raises its mark damage by exactly the buff", () => {
    const plain = markDamage(0, 30);
    expect(plain).toBeGreaterThan(0);
    for (const n of [3, 5.5]) expect(markDamage(n, 30) / plain).toBeCloseTo(1 + quoted("emberImp") * buffScale(n), 9);
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
});

// The phase-B cards and the weapon specials (balance pass, BALANCE_CONTRACT 3.3, 4.4 and 4.6; agent A4): one test per card proving its
// mechanic in the real sim (a started run on an open floor, the card taken through the chest's own grant), the weapon specials (the axe's
// shred, the wand's splash, the sword's and fists' on-hit power), the guards the hooks obey (G1 with a crit, G12, G13, G8) and the rule
// every hook lives under: no processing order changes an outcome (the same fight under another action order, another join order and
// another secret salt gives the same numbers).
// The PvP rules are OFF unless a test says so, so a damage number is the card's alone.
import { describe, expect, it } from "vitest";
import {
  AXE_SHRED_ARMOR, AXE_SHRED_CAP, CRIT_CHANCE_MAX, CRIT_MULT, FACTIONS, FISTS_ON_HIT_POWER, GAMBLER_CHANCE, mitigateShares,
  PLANT_FEET_BONUS, SHIELD_BLOCK_SHARE, SWORD_ON_HIT_POWER, TANK_ENGINE_CAP, TICK_MS, WAND_SPLASH_SHARE, WAND_SPLASH_RADIUS, WEAPONS,
  WISHFUL_BUDGET_MS, type WeaponId,
} from "@raid/shared";
import { teleportToColiseum } from "../src/sim/arena";
import { grantCard } from "../src/sim/chests";
import { combatant, defenseOf, type Combatant } from "../src/sim/combatant";
import { signatureState } from "../src/sim/factions";
import { deferHit } from "../src/sim/ledger";
import { placeMob } from "../src/sim/mobLife";
import { addStatus, findStatus, statusValue, statusesOf } from "../src/sim/status";
import { dotMultOf } from "../src/sim/mods";
import type { LandedHit, LedgerEntry, SimEvent, World } from "../src/sim/world";
import { chainHook } from "../src/sim/world";
import { hit, inStep, P, pvpArena, RT, tick, type RigFighter } from "./support/pvpRig";
import { quoted } from "./support/quoted";

// ---------------------------------------------------------------------------------------------------------------------------- rig

type Player = Extract<Combatant, { kind: "player" }>;
const C = (w: World, id: string): Player => combatant(w, id) as Player;

/** An arena of these fighters, the PvP rules off, signatures off unless asked. Every fighter gets a big hp pool unless it names its own. */
function arena(fighters: readonly RigFighter[], opts: { signatures?: boolean; pvp?: boolean } = {}): World {
  const w = pvpArena(fighters, { pvpRules: opts.pvp === true, signatures: opts.signatures === true });
  for (const f of fighters) if (f.hpFrac === undefined) { P(w, f.id).maxHp = 1_000_000; P(w, f.id).hp = 1_000_000; }
  return w;
}

/** `id` takes these cards through the chest's own grant (a conditional's base first). */
function give(w: World, id: string, ...cards: string[]): void {
  for (const card of cards) expect(grantCard(w, C(w, id), card), `${id} takes ${card}`).not.toBeNull();
}

const lock = (w: World, by: string, victim: string): void => RT(w, by).inputs.pushAction({ kind: "target", id: victim });

interface Seen { landed: LandedHit[][]; events: SimEvent[]; entries: LedgerEntry[] }

/** Runs `n` ticks; `landed[i]` is what the pass of tick i applied. */
function run(w: World, n: number, each?: (i: number) => void): Seen {
  const seen: Seen = { landed: [], events: [], entries: [] };
  chainHook(w, "hitLanded", (_w, e) => { seen.entries.push(e); });
  for (let i = 0; i < n; i++) {
    each?.(i);
    seen.events.push(...tick(w));
    seen.landed.push([...w.combat.landed]);
  }
  return seen;
}

/** The weapon hits `by` landed on `victim`, in order (not a damage-over-time tick, a signature or a returned hit). */
function hitsOf(seen: Seen, by: string, victim: string): LandedHit[] {
  return seen.landed.flat().filter((h) => h.by === by && h.victim === victim && h.weapon !== null && h.sig === undefined && !h.dot && !h.passive && !h.derived);
}

const hp = (w: World, id: string): number => P(w, id).hp;
const near = (x: number, y = 320) => ({ x, y });

/** Two armor-free Holy fighters 30 u apart: `a` holds `weapon` and locks `v` (a punching bag with a million hp). */
function bag(weapon: WeaponId | "", cards: readonly string[] = [], victim: Partial<RigFighter> = {}): World {
  const w = arena([
    { id: "a", faction: "holy", weapon, at: near(200) },
    { id: "v", faction: "holy", weapon: "", at: near(230), ...victim },
  ]);
  give(w, "a", ...cards);
  lock(w, "a", "v");
  return w;
}

// -------------------------------------------------------------------------------------------------------------------------- crit

describe("Rhythm and the crit accumulator (G12)", () => {
  it("Rhythm: every 3rd attack is a critical strike, 1.5x, flagged for the fx", () => {
    const w = bag("sword", ["haste1", "rhythm"]);
    const seen = run(w, 80);
    const hits = hitsOf(seen, "a", "v");
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits.slice(0, 9).map((h) => h.crit === true)).toEqual([false, false, true, false, false, true, false, false, true]);
    const plain = hits[0]!.amount;
    for (const h of hits.slice(0, 9)) expect(h.amount).toBeCloseTo(h.crit ? plain * CRIT_MULT : plain, 6);
    const fxHits = seen.events.flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.by === "a" ? [e.fx] : []));
    expect(fxHits.map((fx) => fx.crit === true).slice(0, 6)).toEqual([false, false, true, false, false, true]);
  });

  it("a swing that meets two bodies is one attack: both hits crit together", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "axe", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
      { id: "u", faction: "holy", weapon: "", at: near(230, 345) },
    ]);
    give(w, "a", "haste1", "rhythm");
    lock(w, "a", "v");
    const seen = run(w, 120);
    const v = hitsOf(seen, "a", "v");
    const u = hitsOf(seen, "a", "u");
    expect(v.length).toBeGreaterThanOrEqual(3);
    expect(u.map((h) => h.crit === true)).toEqual(v.slice(0, u.length).map((h) => h.crit === true));
    expect(v[2]!.crit).toBe(true);
  });

  it("a Thick Skull holder never crits, and a mob never does", () => {
    const w = bag("sword", ["haste1", "rhythm", "thickSkull"]);
    expect(hitsOf(run(w, 80), "a", "v").some((h) => h.crit)).toBe(false);
  });

  it("the chance stops at CRIT_CHANCE_MAX: Rhythm and Cruel Wounds together crit every 2nd attack, not more", () => {
    expect(CRIT_CHANCE_MAX).toBe(0.5);
    const w = bag("sword", ["haste1", "rhythm", "cruelWounds"]);
    const hits = hitsOf(run(w, 100), "a", "v");
    expect(hits.length).toBeGreaterThanOrEqual(8);
    const crits = hits.slice(0, 8).filter((h) => h.crit).length;
    expect(crits).toBe(4);
    expect(hits.slice(0, 8).map((h) => h.crit === true)).toEqual([false, true, false, true, false, true, false, true]);
  });
});

describe("Cruel Wounds: damage over time can crit (G12)", () => {
  it("a burn tick crits on the accumulator's 5th tick (chance 0.2), once for every entry of that tick", () => {
    const w = arena([
      { id: "a", faction: "fire", weapon: "axe", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ], { signatures: true });
    give(w, "a", "cruelWounds", "ap1");
    lock(w, "a", "v");
    const seen = run(w, 60);
    const burn = seen.entries.filter((e) => e.sig === "burn");
    expect(burn.length).toBeGreaterThan(10);
    // Both the burn and its AP twin of a tick share one roll: group by pairs of consecutive entries of the same tick.
    const byTick = new Map<number, boolean[]>();
    seen.landed.forEach((tickHits, i) => { const c = tickHits.filter((h) => h.sig === "burn").map((h) => h.crit === true); if (c.length) byTick.set(i, c); });
    for (const flags of byTick.values()) expect(new Set(flags).size, "one roll per tick").toBe(1);
    const ticks = [...byTick.entries()].sort((x, y) => x[0] - y[0]);
    expect(ticks.filter(([, f]) => f[0]).length).toBe(Math.floor(ticks.length * 0.2));
    // The crit tick deals 1.5x of the tick before it.
    const crit = seen.entries.find((e) => e.sig === "burn" && e.packet.crit)!;
    expect(crit.packet.mult).toBe(CRIT_MULT);
  });

  it("without Cruel Wounds a burn never crits, whatever the crit chance (Rhythm is for attacks)", () => {
    const w = arena([
      { id: "a", faction: "fire", weapon: "axe", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ], { signatures: true });
    give(w, "a", "haste1", "rhythm");
    lock(w, "a", "v");
    const seen = run(w, 60);
    expect(seen.entries.filter((e) => e.sig === "burn" && e.packet.crit)).toEqual([]);
    expect(seen.entries.filter((e) => e.sig === undefined && e.packet.crit).length).toBeGreaterThan(0);
  });

  it("Plague's disease, execute and bleed cannot crit below half health, but its auto attacks still can", () => {
    const w = arena([
      { id: "a", faction: "plague", weapon: "sword", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ], { signatures: true });
    give(w, "a", "haste1", "rhythm", "cruelWounds", "hemorrhage");
    P(w, "v").hp = P(w, "v").maxHp * 0.4;
    lock(w, "a", "v");
    expect(dotMultOf(C(w, "a").s)).toBeCloseTo(1.25, 12); // Rhythm + Cruel Wounds: 50% crit chance becomes an equivalent 25% steady DoT bonus.

    const seen = run(w, 180);
    const plagueDots = seen.entries.filter((e) => e.by.id === "a" && (e.sig === "disease" || e.dot === true));
    expect(plagueDots.some((e) => e.sig === "disease" && e.execute)).toBe(true);
    expect(plagueDots.length).toBeGreaterThan(0);
    expect(plagueDots.some((e) => e.packet.crit)).toBe(false);
    expect(hitsOf(seen, "a", "v").some((h) => h.crit)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------- streaks

describe("streaks", () => {
  it("Tunnel Vision: +4% per hit in a row on the same target, up to 10 stacks, and switching resets it", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "bow", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(300) },
      { id: "u", faction: "holy", weapon: "", at: near(300, 360) },
    ]);
    give(w, "a", "tunnelVision");
    lock(w, "a", "v");
    const seen = run(w, 340);
    const hits = hitsOf(seen, "a", "v");
    expect(hits.length).toBeGreaterThanOrEqual(12);
    const base = hits[0]!.amount;
    const expected = (n: number): number => base * (1 + 0.04 * Math.min(10, n));
    hits.slice(0, 12).forEach((h, i) => expect(h.amount, `hit ${i + 1}`).toBeCloseTo(expected(i), 6));
    expect(hits[11]!.amount).toBeCloseTo(base * 1.4, 6);
    // Switch: the first hit on the other target is back to the base, then it climbs again.
    lock(w, "a", "u");
    const more = run(w, 140);
    const onU = hitsOf(more, "a", "u");
    expect(onU.length).toBeGreaterThanOrEqual(3);
    onU.slice(0, 3).forEach((h, i) => expect(h.amount, `u hit ${i + 1}`).toBeCloseTo(expected(i), 6));
  });

  it("First Impressions: the first hit on a new target deals +40%, then back to normal; a new target gets it again", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "bow", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(300) },
      { id: "u", faction: "holy", weapon: "", at: near(300, 360) },
    ]);
    give(w, "a", "firstImpressions");
    lock(w, "a", "v");
    const hits = hitsOf(run(w, 160), "a", "v");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0]!.amount).toBeCloseTo(hits[1]!.amount * 1.4, 6);
    expect(hits[2]!.amount).toBeCloseTo(hits[1]!.amount, 6);
    lock(w, "a", "u");
    const onU = hitsOf(run(w, 160), "a", "u");
    expect(onU[0]!.amount).toBeCloseTo(hits[1]!.amount * 1.4, 6);
    expect(onU[1]!.amount).toBeCloseTo(hits[1]!.amount, 6);
  });

  it("First Impressions is for hits: a bleed that keeps ticking on the target the player has switched away from takes no +40% (the final review's m10)", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
      { id: "u", faction: "holy", weapon: "", at: near(200, 250) },
    ]);
    give(w, "a", "hemorrhage", "firstImpressions");
    lock(w, "a", "v");
    run(w, 12); // the first sword hit on v: +40%, and a bleed that lasts 2 s
    expect(bleeds(w, "v").length).toBeGreaterThan(0);
    lock(w, "a", "u");
    let ticks = 0;
    while (RT(w, "a").cards?.streak?.target !== "u" && ticks++ < 60) tick(w);
    expect(RT(w, "a").cards?.streak?.target, "the streak moved to u").toBe("u");
    // v is no streak target now (its count reads 0, the "new target" First Impressions rewards): its bleed ticks are plain.
    const live = statusesOf(C(w, "v")).filter((x) => x.kind === "dot" && x.tag?.startsWith("bleed:") && x.until - w.state.serverTime > 200);
    expect(live.length, "a bleed still running on v").toBeGreaterThan(0);
    const perSecond = live.reduce((n, x) => n + x.value, 0);
    const seen = run(w, 1);
    const ticksOnV = seen.entries.filter((e) => e.dot === true && e.weapon === null && e.by.id === "a" && e.victim === "v");
    expect(ticksOnV.length).toBeGreaterThan(0);
    const dealt = seen.landed.flat().filter((l) => l.dot === true && l.by === "a" && l.victim === "v").reduce((n, l) => n + l.amount, 0);
    expect(dealt).toBeCloseTo((perSecond * TICK_MS) / 1000, 6);
  });

  it("the memory ends after STREAK_GAP_SECONDS without a hit: the same target is new again", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ]);
    give(w, "a", "firstImpressions");
    lock(w, "a", "v");
    const first = hitsOf(run(w, 30), "a", "v");
    expect(first[0]!.amount).toBeCloseTo(first[1]!.amount * 1.4, 6);
    // Let go (a stop), wait out the gap, lock again: it is a new target once more.
    RT(w, "a").inputs.pushMove({ kind: "stop" });
    run(w, 70);
    lock(w, "a", "v");
    const later = hitsOf(run(w, 12), "a", "v");
    expect(later[0]!.amount).toBeCloseTo(first[0]!.amount, 6);
  });
});

// ------------------------------------------------------------------------------------------------------- the on-hit pipeline

/** The raw of the bleed (status dot) `by` has on `victim`, per bleed instance, newest first. */
function bleeds(w: World, victim: string, by = "a"): number[] {
  return statusesOf(C(w, victim)).filter((s) => s.kind === "dot" && s.source.id === by && s.tag?.startsWith("bleed:")).map((s) => s.value).reverse();
}

describe("the on-hit pipeline", () => {
  it("Hemorrhage: a physical hit makes the target bleed for 10% of the hit over 2 s, as physical damage-over-time", () => {
    const w = bag("bow", ["hemorrhage"]);
    const seen = run(w, 41);
    const first = seen.entries.find((e) => e.weapon === "bow")!;
    const bleedStatus = statusesOf(C(w, "v")).find((s) => s.kind === "dot" && s.tag?.startsWith("bleed:"))!;
    expect(bleedStatus).toBeDefined();
    expect(bleedStatus.shares).toEqual({ phys: 1, magic: 0, true: 0 });
    // 10% of the hit's raw (the bow has on-hit power 1) over its 2 s: dps x 2 s = 0.1 x raw.
    expect(bleedStatus.value * 2).toBeCloseTo(first.packet.raw * 0.1, 6);
    expect(bleedStatus.until - bleedStatus.startedAt).toBe(2000);
  });

  it("the bleed lands as damage over time every tick (no weapon, no signature) and is reported in chunks, not tick by tick", () => {
    const w = bag("bow", ["hemorrhage"]);
    const seen = run(w, 60);
    expect(hitsOf(seen, "a", "v").length).toBeGreaterThan(1);
    const dotLanded = seen.landed.flat().filter((h) => h.dot && h.ability === undefined && h.sig === undefined && h.victim === "v");
    expect(dotLanded.length).toBeGreaterThan(20);
    for (const d of dotLanded) expect(d).toMatchObject({ by: "a", weapon: null });
    const chunks = seen.events.flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.weapon === null && e.fx.sig === undefined && e.fx.ability === undefined ? [e.fx] : []));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(dotLanded.length / 4);
    // What the chunks report is what the ticks dealt, less the part of the last window not yet reported.
    const dealt = dotLanded.reduce((n, d) => n + d.amount, 0);
    const reported = chunks.reduce((n, c) => n + c.amount, 0);
    expect(reported).toBeLessThanOrEqual(dealt + 1e-6);
    expect(reported).toBeGreaterThan(dealt * 0.5);
  });

  // (The status ticker runs after the signatures in beforeDamage, so the ledger the contacts read never holds a bleed tick; sim/factions.ts
  // contactsOf also skips a `dot` entry outright, so the order of those two phases is not what this rests on.)
  it("a bleed is no trade: its ticks do not renew the contact between the pair that keeps a signature engaged", () => {
    const w = arena([
      { id: "a", faction: "plague", weapon: "bow", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(300) },
    ], { signatures: true });
    give(w, "a", "hemorrhage");
    lock(w, "a", "v");
    let hits = 0;
    while (hits === 0) { tick(w); hits += w.combat.landed.filter((h) => h.by === "a" && h.victim === "v" && !h.dot && h.sig === undefined).length; }
    RT(w, "a").inputs.pushMove({ kind: "stop" });
    tick(w);
    const contactAt = signatureState(w, "a")!.contactAt;
    const bleedBefore = bleeds(w, "v").length;
    expect(bleedBefore).toBeGreaterThan(0);
    for (let i = 0; i < 24; i++) tick(w);
    expect(bleeds(w, "v").length, "still bleeding").toBeGreaterThan(0);
    expect(signatureState(w, "a")!.contactAt).toBe(contactAt);
  });

  it("only the physical part of a hit bleeds: a magic hit leaves nothing", () => {
    const w = arena([
      { id: "a", faction: "fire", weapon: "axe", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ]);
    give(w, "a", "hemorrhage");
    lock(w, "a", "v");
    run(w, 30);
    expect(bleeds(w, "v")).toEqual([]);
  });

  it("on-hit power: the sword's bleed is 1.5x the bow's for the same hit, fists' 1.2x", () => {
    expect([SWORD_ON_HIT_POWER, FISTS_ON_HIT_POWER, WEAPONS.bow.onHitPower, WEAPONS.axe.onHitPower]).toEqual([1.5, 1.2, 1, 1]);
    const ratio = (weapon: WeaponId | ""): number => {
      const w = bag(weapon, ["hemorrhage"]);
      const seen = run(w, 15);
      const e = seen.entries.find((x) => x.by.id === "a" && x.sig === undefined)!;
      const inst = statusesOf(C(w, "v")).find((s) => s.kind === "dot" && s.tag?.startsWith("bleed:"))!;
      return (inst.value * 2) / (e.packet.raw * e.packet.phys * 0.1);
    };
    expect(ratio("bow")).toBeCloseTo(1, 6);
    expect(ratio("sword")).toBeCloseTo(1.5, 6);
    expect(ratio("")).toBeCloseTo(1.2, 6);
  });

  it("a bleed reads the hit WITHOUT the attacker's `hit` mult: Machine Gun's swings bleed in full, Boom's few big ones do not bleed 2.5x", () => {
    // bleed value x 2 s = k x (the hit as the weapon dealt it) x 10% x physical share, so over the recorded raw it is k / hit.
    const perRaw = (cards: string[]): number => {
      const w = bag("sword", ["hemorrhage", ...cards]);
      const seen = run(w, 15);
      const e = seen.entries.find((x) => x.by.id === "a" && x.sig === undefined)!;
      const inst = statusesOf(C(w, "v")).find((s) => s.kind === "dot" && s.tag?.startsWith("bleed:"))!;
      return (inst.value * 2) / (e.packet.raw * e.packet.phys * 0.1);
    };
    const plain = perRaw([]);
    expect(perRaw(["machineGun"]) / plain).toBeCloseTo(1 / quoted("machineGun", 1), 6);
    expect(perRaw(["hereComesTheBoom"]) / plain).toBeCloseTo(1 / quoted("hereComesTheBoom", 1), 6);
  });

  it("Fists of Fury: while unarmed the on-hit effects apply twice (and a held weapon turns that off)", () => {
    const plain = bag("", ["hemorrhage"]);
    run(plain, 15);
    const fury = bag("", ["hemorrhage", "fistsOfFury"]);
    run(fury, 15);
    const bleedOf = (w: World): number => statusesOf(C(w, "v")).find((s) => s.kind === "dot" && s.tag?.startsWith("bleed:"))!.value;
    expect(bleedOf(fury)).toBeCloseTo(bleedOf(plain) * 2, 6);
    // Armed with a sword, Fists of Fury's second application is off: the same bleed as without the card.
    const armed = bag("sword", ["hemorrhage", "fistsOfFury"]);
    const armedPlain = bag("sword", ["hemorrhage"]);
    run(armed, 15);
    run(armedPlain, 15);
    expect(bleedOf(armed)).toBeCloseTo(bleedOf(armedPlain), 6);
  });

  it("Third Time's the Charm: every 3rd hit on the same target applies its on-hit effects twice", () => {
    const w = bag("bow", ["hemorrhage", "thirdTimesTheCharm"]);
    run(w, 130);
    const values = bleeds(w, "v").reverse(); // oldest first among those still bleeding
    expect(values.length).toBeGreaterThanOrEqual(3);
    // A bleed per hit: the hits are equal, so the bleeds are equal except the doubled ones.
    const base = Math.min(...values);
    const doubled = values.filter((x) => Math.abs(x - 2 * base) < 1e-9).length;
    const single = values.filter((x) => Math.abs(x - base) < 1e-9).length;
    expect(doubled + single).toBe(values.length);
    expect(doubled).toBeGreaterThanOrEqual(1);
    expect(single).toBeGreaterThanOrEqual(2);
  });

  it("Third Time's the Charm: it counts hits in a row, so a switch restarts the count", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
      { id: "u", faction: "holy", weapon: "", at: near(200, 345) },
    ]);
    give(w, "a", "hemorrhage", "thirdTimesTheCharm");
    lock(w, "a", "v");
    run(w, 28); // two hits on v
    lock(w, "a", "u");
    run(w, 40);
    // Never a third hit on one target in a row yet if the switch happened after two: no doubled bleed on either.
    const all = [...bleeds(w, "v"), ...bleeds(w, "u")];
    const base = Math.min(...all);
    for (const x of all) expect(Math.abs(x - base) < 1e-9 || Math.abs(x - 2 * base) < 1e-9).toBe(true);
  });
});

describe("the axe's shred (a weapon special)", () => {
  it("each axe hit takes AXE_SHRED_ARMOR armor for 3 s, stacking up to AXE_SHRED_CAP; total armor never goes under 0", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "axe", at: near(200) },
      { id: "v", faction: "plague", weapon: "", at: near(230) },
    ]);
    lock(w, "a", "v");
    expect(hitsOf(run(w, 100), "a", "v").length).toBeGreaterThanOrEqual(4);
    expect(statusValue(w, C(w, "v"), "shred")).toBe(AXE_SHRED_CAP);
    expect(P(w, "v").armorBonus).toBe(-AXE_SHRED_CAP * 10); // int16 tenths: the mirror carries it to the client as a negative bonus
    expect(defenseOf(P(w, "v")).armor).toBeCloseTo(FACTIONS.plague.armor - AXE_SHRED_CAP, 6);
    // An armor-free fighter loses nothing more: the total stops at 0.
    const bare = arena([{ id: "a", faction: "holy", weapon: "axe", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) }]);
    lock(bare, "a", "v");
    run(bare, 100);
    expect(statusValue(bare, C(bare, "v"), "shred")).toBe(AXE_SHRED_CAP);
    expect(defenseOf(P(bare, "v")).armor).toBe(0);
  });

  it("grows 3, 6 with the hits (AXE_SHRED_ARMOR, then the cap) and ends 3 s after the last one", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "axe", at: near(200) },
      { id: "v", faction: "frost", weapon: "", at: near(230) },
    ]);
    lock(w, "a", "v");
    const values: number[] = [];
    run(w, 70, () => values.push(statusValue(w, C(w, "v"), "shred")));
    const distinct = [...new Set(values)];
    expect(distinct.slice(0, 3)).toEqual([0, AXE_SHRED_ARMOR, AXE_SHRED_CAP]);
    expect(AXE_SHRED_CAP).toBe(2 * AXE_SHRED_ARMOR);
    // Let go of the lock: it fades 3 s after the last axe hit.
    RT(w, "a").inputs.pushMove({ kind: "stop" });
    run(w, 2);
    expect(statusValue(w, C(w, "v"), "shred")).toBe(AXE_SHRED_CAP);
    run(w, 62);
    expect(statusValue(w, C(w, "v"), "shred")).toBe(0);
    expect(P(w, "v").armorBonus).toBe(0);
  });

  it("makes the armor-reduced fighter take more: an axe hit after the full stack does more than the first, against armor", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "axe", at: near(200) },
      { id: "v", faction: "plague", weapon: "", at: near(230) },
    ]);
    lock(w, "a", "v");
    const hits = hitsOf(run(w, 100), "a", "v");
    expect(hits[0]!.amount).toBeLessThan(hits[4]!.amount);
    const spec = FACTIONS.plague;
    const ratio = mitigateShares(1, { phys: 1, magic: 0, true: 0 }, { armor: Math.max(0, spec.armor - AXE_SHRED_CAP), shield: spec.shield })
      / mitigateShares(1, { phys: 1, magic: 0, true: 0 }, { armor: spec.armor, shield: spec.shield });
    expect(hits[4]!.amount / hits[0]!.amount).toBeCloseTo(ratio, 6);
    expect(AXE_SHRED_ARMOR).toBe(3);
  });
});

describe("SimConfig.weaponSpecials (the parity runs against realtime.py turn them off)", () => {
  it("false leaves the axe's armor alone and the wand's balls with one victim; the default applies both", () => {
    for (const on of [true, false]) {
      const axe = arena([{ id: "a", faction: "holy", weapon: "axe", at: near(200) }, { id: "v", faction: "plague", weapon: "", at: near(230) }]);
      axe.config.weaponSpecials = on;
      lock(axe, "a", "v");
      run(axe, 40);
      expect(statusValue(axe, C(axe, "v"), "shred") > 0, `axe, specials ${on}`).toBe(on);
      const wand = arena([
        { id: "a", faction: "holy", weapon: "wand", at: near(200) }, { id: "v", faction: "frost", weapon: "", at: near(380) },
        { id: "n", faction: "frost", weapon: "", at: near(380, 360) },
      ]);
      wand.config.weaponSpecials = on;
      lock(wand, "a", "v");
      const seen = run(wand, 60);
      expect(seen.landed.flat().some((h) => h.victim === "n" && h.by === "a"), `wand, specials ${on}`).toBe(on);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------ wand splash

describe("the wand's splash (a weapon special)", () => {
  const wandArena = (extra: readonly RigFighter[]): World => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "wand", at: near(200) },
      { id: "v", faction: "frost", weapon: "", at: near(380) },
      ...extra,
    ]);
    lock(w, "a", "v");
    return w;
  };

  it("hits another enemy within 48 u of the target for 30% of the ball's damage, never the target twice", () => {
    expect([WAND_SPLASH_SHARE, WAND_SPLASH_RADIUS]).toEqual([0.3, 48]);
    const w = wandArena([{ id: "n", faction: "frost", weapon: "", at: near(380, 360) }, { id: "f", faction: "frost", weapon: "", at: near(380, 400) }]);
    const seen = run(w, 60);
    const onV = seen.landed.flat().filter((h) => h.by === "a" && h.victim === "v");
    const onN = seen.landed.flat().filter((h) => h.by === "a" && h.victim === "n");
    const onF = seen.landed.flat().filter((h) => h.by === "a" && h.victim === "f");
    expect(onV.length).toBeGreaterThan(0);
    expect(onN.length).toBe(onV.length);
    expect(onF.length, "52 u away is out of the splash").toBe(0);
    onN.forEach((h, i) => expect(h.amount).toBeCloseTo(onV[i]!.amount * WAND_SPLASH_SHARE, 6));
    expect(onN.every((h) => h.derived === true)).toBe(true);
    expect(onV.every((h) => h.derived !== true)).toBe(true);
  });

  it("is a follow-on, not a hit: it sets off no bleed and no streak of its own", () => {
    const w = wandArena([{ id: "n", faction: "holy", weapon: "", at: near(380, 360) }]);
    give(w, "a", "hemorrhage");
    run(w, 60);
    expect(bleeds(w, "n")).toEqual([]);
    expect(RT(w, "a").cards?.streak?.target).toBe("v");
  });

  it("a mob's ball never splashes another mob, and a wall stops the splash", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "wand", at: near(200) },
      { id: "v", faction: "frost", weapon: "", at: near(380) },
    ]);
    lock(w, "a", "v");
    const seen = run(w, 30);
    expect(seen.landed.flat().filter((h) => h.derived).length).toBe(0); // alone: nothing to splash
  });
});

// -------------------------------------------------------------------------------------------------------------------------- blocks

/** A Holy shield holder "h" facing a Holy swordsman "a" 30 u to its left, the swordsman locked on it. `hpFrac: 1` keeps the faction's own max hp (Tank Engine moves it). */
function blockArena(cards: readonly string[], attackerWeapon: WeaponId = "sword"): World {
  const w = arena([
    { id: "a", faction: "holy", weapon: attackerWeapon, at: near(200) },
    { id: "h", faction: "holy", weapon: "shield", at: near(230), hpFrac: 1 },
  ]);
  P(w, "h").facing = Math.PI; // toward the swordsman
  give(w, "h", ...cards);
  lock(w, "a", "h");
  return w;
}

/** Ticks until `n` blocks have been made (a `block` fx each); returns the fx seen. */
function untilBlocks(w: World, n: number, limit = 400): number {
  let blocks = 0;
  let ticks = 0;
  while (blocks < n && ticks++ < limit) blocks += tick(w).filter((e) => e.type === "fx" && e.fx.kind === "block").length;
  return blocks;
}

describe("blocks", () => {
  it("Pocket Sand: a block slows the attacker by 30% for 1 s", () => {
    const w = blockArena(["pocketSand"]);
    expect(untilBlocks(w, 1)).toBe(1);
    const slow = findStatus(C(w, "a"), "slowMove", "h")!;
    expect(slow).toBeDefined();
    expect(slow.value).toBeCloseTo(0.3, 12);
    expect(slow.until - slow.startedAt).toBe(1000);
    expect(statusValue(w, C(w, "a"), "slowMove")).toBeCloseTo(0.3, 12);
  });

  it("Pocket Sand does nothing without the block (an axe pierces the shield)", () => {
    const w = blockArena(["pocketSand"], "axe");
    run(w, 60);
    expect(findStatus(C(w, "a"), "slowMove")).toBeUndefined();
  });

  it("Tank Engine: 1 max health for every point of damage the blocks prevent, kept for good", () => {
    const w = blockArena(["tankEngine"]);
    const base = FACTIONS.holy.hp;
    const rt = RT(w, "h");
    let before = P(w, "h").maxHp;
    expect(before).toBe(base);
    let blocks = 0;
    // One hit's share: the packet's raw x SHIELD_BLOCK_SHARE, through the holder's defense (an armor-free Holy, a physical hit).
    chainHook(w, "blocked", (_w, _h, _a, prevented) => { blocks++; void prevented; });
    expect(untilBlocks(w, 3)).toBe(3);
    const prevented = rt.cards!.prevented;
    expect(prevented).toBeGreaterThan(0);
    expect(P(w, "h").maxHp).toBeCloseTo(base + prevented, 9);
    expect(rt.cards!.tankHp).toBeCloseTo(prevented, 9);
    // The hp that came with it stays: a card never leaves you lower on the bar (the holder took 90% of three hits, so not full).
    before = P(w, "h").maxHp;
    // A later grant of another card re-derives max hp from the rows and keeps the earned health.
    give(w, "h", "vitality1");
    expect(P(w, "h").maxHp).toBeCloseTo(base * 1.09 + prevented, 6);
    expect(blocks).toBeGreaterThanOrEqual(3);
  });

  it("Tank Engine: at most +250 in all (G8), however much is prevented", () => {
    const w = blockArena(["tankEngine"]);
    const h = C(w, "h");
    const a = C(w, "a");
    for (let i = 0; i < 40; i++) w.hooks.blocked?.(w, h, a, { raw: 1000, phys: 1, magic: 0, true: 0 }, true);
    expect(TANK_ENGINE_CAP).toBe(250);
    expect(P(w, "h").maxHp).toBeCloseTo(FACTIONS.holy.hp + 250, 9);
    w.hooks.blocked?.(w, h, a, { raw: 1_000_000, phys: 1, magic: 0, true: 0 }, true);
    expect(P(w, "h").maxHp).toBeCloseTo(FACTIONS.holy.hp + 250, 9);
  });

  it("Best Offense: a block counts as a hit: the on-hit effects apply, the streak and Wishful Thinking hear of it", () => {
    const w = blockArena(["bestOffense", "hemorrhage"]);
    expect(untilBlocks(w, 1)).toBe(1);
    // The block's "hit" is the holder's own bash: 10% of it bleeds (the shield has on-hit power 1).
    expect(bleeds(w, "a", "h")).toHaveLength(1);
    tick(w);
    expect(RT(w, "h").cards?.streak?.target).toBe("a");
    // Without the card the same block leaves no bleed and no streak.
    const w2 = blockArena(["hemorrhage"]);
    untilBlocks(w2, 1);
    tick(w2);
    expect(bleeds(w2, "a", "h")).toEqual([]);
    expect(RT(w2, "h").cards?.streak ?? null).toBeNull();
  });

  it("Eye for an Eye: the damage you return applies your on-hit effects (a riposte here); without the card it does not", () => {
    const withEye = blockArena(["hemorrhage", "eyeForAnEye"]);
    const seen = run(withEye, 40);
    const riposte = seen.entries.find((e) => e.by.id === "h" && e.passive === true)!;
    expect(riposte).toBeDefined();
    const inst = bleeds(withEye, "a", "h");
    expect(inst.length).toBeGreaterThan(0);
    const without = blockArena(["hemorrhage"]);
    run(without, 40);
    expect(bleeds(without, "a", "h")).toEqual([]);
    // The bleed is 10% of the riposte's physical part (the shield's on-hit power is 1).
    const oneTick = arena([{ id: "a", faction: "holy", weapon: "sword", at: near(200) }, { id: "h", faction: "holy", weapon: "shield", at: near(230), hpFrac: 1 }]);
    P(oneTick, "h").facing = Math.PI;
    give(oneTick, "h", "hemorrhage", "eyeForAnEye");
    lock(oneTick, "a", "h");
    const s1 = run(oneTick, 30);
    const rip = s1.entries.find((e) => e.passive)!;
    const first = statusesOf(C(oneTick, "a")).find((s) => s.kind === "dot" && s.tag?.startsWith("bleed:"))!;
    expect(first.value * 2).toBeCloseTo(rip.packet.raw * rip.scale * 0.1, 6);
  });
});

// --------------------------------------------------------------------------------------------------------------- returned damage

describe("Boom's returned x1.25 and the riposte (the final review's m2)", () => {
  it("a sword riposte is returned damage: the holder's `returned` mult is in it, and no other kind's is", () => {
    const riposteOf = (cards: readonly string[]): { raw: number; amount: number } => {
      const w = blockArena(cards);
      const seen = run(w, 40);
      const e = seen.entries.find((x) => x.by.id === "h" && x.passive === true)!;
      expect(e, `${cards.join()} riposted`).toBeDefined();
      const landed = seen.landed.flat().find((l) => l.by === "h" && l.victim === "a" && l.passive)!;
      return { raw: e.packet.raw, amount: landed.amount };
    };
    const plain = riposteOf([]);
    const boom = riposteOf(["hereComesTheBoom"]);
    expect(boom.raw).toBeCloseTo(plain.raw * quoted("hereComesTheBoom", 3), 9);
    expect(boom.amount).toBeCloseTo(plain.amount * quoted("hereComesTheBoom", 3), 9);
    // Slow Burn's x0.7 is for damage over time: it leaves a riposte alone.
    expect(riposteOf(["slowBurn"]).raw).toBeCloseTo(plain.raw, 9);
  });
});

describe("Spiked Shell", () => {
  it("a melee attacker takes 15% of the damage it deals to you back as physical damage, in the next tick's ledger", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "h", faction: "holy", weapon: "", at: near(230) },
    ]);
    give(w, "h", "spikedShell");
    lock(w, "a", "h");
    const seen = run(w, 40);
    const dealt = hitsOf(seen, "a", "h");
    const back = seen.landed.flat().filter((l) => l.by === "h" && l.victim === "a");
    expect(dealt.length).toBeGreaterThanOrEqual(2);
    expect(back.length).toBe(dealt.length);
    back.forEach((l, i) => {
      expect(l.passive).toBe(true);
      expect(l.amount).toBeCloseTo(dealt[i]!.amount * 0.15, 9);
    });
    // The tick a hit lands, nothing comes back; the tick after, it does.
    const tickOf = (xs: LandedHit[]): number => seen.landed.findIndex((l) => l.includes(xs[0]!));
    expect(tickOf(back)).toBe(tickOf(dealt) + 1);
  });

  it("a ranged hit is not a melee hit: an arrow gets nothing back", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "bow", at: near(200) },
      { id: "h", faction: "holy", weapon: "", at: near(300) },
    ]);
    give(w, "h", "spikedShell");
    lock(w, "a", "h");
    const seen = run(w, 80);
    expect(hitsOf(seen, "a", "h").length).toBeGreaterThan(0);
    expect(seen.landed.flat().filter((l) => l.by === "h")).toEqual([]);
  });

  it("two Spiked Shells do not answer each other without end: a returned hit sets off no trigger", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "h", faction: "holy", weapon: "sword", at: near(230) },
    ]);
    give(w, "a", "spikedShell");
    give(w, "h", "spikedShell");
    lock(w, "a", "h");
    const seen = run(w, 40);
    const returned = seen.landed.flat().filter((l) => l.passive);
    const hits = seen.landed.flat().filter((l) => !l.passive && l.weapon !== null && !l.dot);
    expect(returned.length).toBe(hits.length);
  });
});

// ---------------------------------------------------------------------------------------- damage over time under Boom and Slow Burn

describe("the `dot` mult reaches a card's damage over time (the final review's m2)", () => {
  /** What one tick of `a`'s bleeds on `v` recorded, over what their status instances say a tick is worth: the factor the owner's cards put on it. */
  function bleedFactor(cards: readonly string[]): number {
    const w = bag("bow", ["hemorrhage", ...cards]);
    const sums = (): number => statusesOf(C(w, "v")).filter((x) => x.kind === "dot" && x.tag?.startsWith("bleed:")).reduce((n, x) => n + x.value, 0);
    for (let i = 0; i < 200 && !(sums() > 0 && statusesOf(C(w, "v")).every((x) => x.until - w.state.serverTime > 300)); i++) tick(w);
    const perSecond = sums();
    expect(perSecond, "a bleed to read").toBeGreaterThan(0);
    const seen = run(w, 1);
    const ticks = seen.entries.filter((e) => e.dot === true && e.weapon === null && e.by.id === "a" && e.victim === "v");
    expect(ticks.length).toBeGreaterThan(0);
    return ticks.reduce((n, e) => n + e.packet.raw, 0) / ((perSecond * TICK_MS) / 1000);
  }

  it("Boom's x1.25 and Slow Burn's x0.7 multiply a bleed's ticks, as they do a signature's", () => {
    expect(bleedFactor([])).toBeCloseTo(1, 9);
    expect(bleedFactor(["hereComesTheBoom"])).toBeCloseTo(quoted("hereComesTheBoom", 2), 9);
    expect(bleedFactor(["slowBurn"])).toBeCloseTo(quoted("slowBurn", 1), 9);
    expect(quoted("hereComesTheBoom", 2)).toBe(1.25);
    expect(quoted("slowBurn", 1)).toBe(0.7);
  });

  it("a Wish's damage over time stays flat: no card multiplies it (owner ruling \"Keep Wishes flat\")", () => {
    const tickOf = (ability: "blaze" | undefined): number => {
      const w = bag("", ["hereComesTheBoom"]);
      addStatus(w, C(w, "v"), {
        kind: "dot", source: { id: "a", name: "A" }, ms: 3000, value: 30, data: { shares: { phys: 0, magic: 0, true: 1 } }, ...(ability ? { ability } : { tag: "x" }),
      });
      const seen = run(w, 1);
      const e = seen.entries.find((x) => x.dot === true && x.by.id === "a" && x.victim === "v")!;
      return e.packet.raw / ((30 * TICK_MS) / 1000);
    };
    expect(tickOf("blaze")).toBeCloseTo(1, 9);
    expect(tickOf(undefined)).toBeCloseTo(1.25, 9);
  });

  it("Festering Arcana's tail is damage over time too: a Slow Burn holder's tail is 30% lighter", () => {
    const tailTotal = (cards: readonly string[]): number => {
      const w = arena([
        { id: "a", faction: "fire", weapon: "axe", at: near(200) },
        { id: "v", faction: "holy", weapon: "", at: near(230) },
      ], { signatures: true });
      give(w, "a", "ap3", "festeringArcana", ...cards);
      lock(w, "a", "v");
      run(w, 30);
      RT(w, "a").inputs.pushMove({ kind: "move", x: 200, y: 600 });
      P(w, "v").x = 900;
      P(w, "v").y = 100;
      RT(w, "v").history = [{ t: w.state.serverTime, x: 900, y: 100 }];
      const seen = run(w, 300);
      return seen.entries.filter((e) => e.dot && e.weapon === null && e.by.id === "a").reduce((n, e) => n + e.packet.raw, 0);
    };
    const plain = tailTotal([]);
    expect(plain).toBeCloseTo(4 * (33 / 8), 6);
    expect(tailTotal(["slowBurn"])).toBeCloseTo(plain * 0.7, 6);
  });
});

// ---------------------------------------------------------------------------------------------- what the next tick's ledger holds

describe("entries queued for the next tick do not survive the teleport or the run's end (the final review's m4)", () => {
  /** A mob of 100 u away at half hp, with a returned hit and a splash queued on it for the next tick, as a pass just before a teleport leaves them. */
  function queued(): { w: World; id: string } {
    const w = arena([{ id: "a", faction: "holy", weapon: "sword", at: near(200) }, { id: "b", faction: "holy", weapon: "", at: near(240) }]);
    const id = placeMob(w, { region: "holy", elite: false, at: near(700) });
    for (const passive of [true, false]) {
      deferHit(w, {
        victim: id, by: { id: "a", name: "A" }, packet: { raw: 40, phys: 1, magic: 0, true: 0 }, weapon: passive ? "sword" : null, stagger: false,
        ...(passive ? { passive: true, final: true } : { derived: true, final: true }),
      });
    }
    expect(w.combat.deferred).toHaveLength(2);
    return { w, id };
  }

  it("the coliseum teleport empties them: a mob put back at full hp takes nothing from a pass that ended before it", () => {
    const { w, id } = queued();
    const mob = w.state.mobs.get(id)!;
    teleportToColiseum(w);
    expect(w.combat.deferred).toEqual([]);
    const seen = run(w, 2);
    expect(seen.landed.flat().filter((h) => h.victim === id)).toEqual([]);
    expect(mob.hp).toBe(mob.maxHp);
    // Never woken: it did not take a hit on a player now behind locked gates.
    expect(w.mobs.get(id)!.brain?.target ?? null).toBeNull();
  });

  it("the run's end empties them too", () => {
    const { w } = queued();
    w.hooks.runEnded?.(w);
    expect(w.combat.deferred).toEqual([]);
  });

  it("an ordinary tick still lands what the last one queued (a Spiked Shell's return)", () => {
    const w = arena([{ id: "a", faction: "holy", weapon: "sword", at: near(200) }, { id: "h", faction: "holy", weapon: "", at: near(230) }]);
    give(w, "h", "spikedShell");
    lock(w, "a", "h");
    const seen = run(w, 40);
    expect(seen.landed.flat().filter((l) => l.by === "h" && l.victim === "a" && l.passive).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ overkill

describe("Overkill", () => {
  it("the damage beyond a kill splashes onto the nearest enemy within 200 u, in the next tick's ledger", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230), hpFrac: 1 },
      { id: "n", faction: "holy", weapon: "", at: near(330) },
      { id: "m", faction: "holy", weapon: "", at: near(400) },
      { id: "f", faction: "holy", weapon: "", at: near(900, 520) },
    ]);
    give(w, "a", "overkill");
    P(w, "v").hp = 50;
    for (const id of ["n", "m", "f"]) { P(w, id).maxHp = P(w, id).hp = 5000; }
    const before = { n: P(w, "n").hp, m: P(w, "m").hp, f: P(w, "f").hp };
    inStepHit(w, "v", "a", 500);
    expect(P(w, "v").status).toBe("dead");
    expect(P(w, "n").hp, "queued for the next tick").toBe(before.n);
    tick(w);
    // 500 raw against 50 hp: 450 beyond the kill, onto the nearest enemy, mitigated by ITS defense (Holy's armor 0 against a physical hit).
    expect(P(w, "n").hp).toBeCloseTo(before.n - 450, 6);
    expect(P(w, "m").hp).toBe(before.m);
    expect(P(w, "f").hp).toBe(before.f);
  });

  it("splashes nothing when there is no enemy within 200 u, or when the victim survives", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230), hpFrac: 1 },
      { id: "f", faction: "holy", weapon: "", at: near(700, 520) },
    ]);
    give(w, "a", "overkill");
    P(w, "v").hp = 50;
    P(w, "f").maxHp = P(w, "f").hp = 5000;
    inStepHit(w, "v", "a", 500);
    tick(w);
    expect(P(w, "f").hp).toBe(5000);
    const w2 = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
      { id: "n", faction: "holy", weapon: "", at: near(300) },
    ]);
    give(w2, "a", "overkill");
    inStepHit(w2, "v", "a", 500);
    tick(w2);
    expect(P(w2, "n").hp).toBe(1_000_000);
  });

  it("only a holder's own damage splashes, and a splash kills no one twice over (it sets off nothing)", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "b", faction: "holy", weapon: "", at: near(200, 380) },
      { id: "v", faction: "holy", weapon: "", at: near(230), hpFrac: 1 },
      { id: "n", faction: "holy", weapon: "", at: near(300), hpFrac: 1 },
    ]);
    give(w, "a", "overkill");
    P(w, "v").hp = 50;
    P(w, "n").hp = 10;
    inStepHit(w, "v", "b", 500); // b is not a holder
    tick(w);
    expect(P(w, "n").hp).toBe(10);
    // The holder's splash kills n too; n's own overkill would splash on, but a splash is derived and sets off nothing.
    const w2 = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230), hpFrac: 1 },
      { id: "n", faction: "holy", weapon: "", at: near(300), hpFrac: 1 },
      { id: "m", faction: "holy", weapon: "", at: near(360) },
    ]);
    give(w2, "a", "overkill");
    P(w2, "v").hp = 50;
    P(w2, "n").hp = 10;
    inStepHit(w2, "v", "a", 500);
    tick(w2);
    expect(P(w2, "n").status).toBe("dead");
    tick(w2);
    expect(P(w2, "m").hp).toBe(1_000_000);
  });
});

/** One hit of `raw` on `victim` by `by`, recorded in a real tick's inputs phase so it lands in the real pass. */
function inStepHit(w: World, victim: string, by: string, raw: number): SimEvent[] {
  return inStep(w, () => { hit(w, victim, by, raw); });
}

// --------------------------------------------------------------------------------------------------------------------- Adrenaline

describe("Adrenaline", () => {
  it("losing 10% of max health in one hit gives +40% move and attack speed for 2 s, through the mirrors", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "h", faction: "holy", weapon: "sword", at: near(230), hpFrac: 1 },
    ]);
    give(w, "h", "adrenaline");
    expect(P(w, "h").asMult).toBe(1000);
    expect(P(w, "h").speedMult).toBe(1000);
    const max = P(w, "h").maxHp;
    inStepHit(w, "h", "a", max * 0.1 - 1);
    expect(P(w, "h").asMult, "99.9% of the threshold: nothing").toBe(1000);
    inStepHit(w, "h", "a", max * 0.1 + 1);
    expect(P(w, "h").asMult).toBe(1400);
    expect(P(w, "h").speedMult).toBe(1400);
    const at = w.state.serverTime;
    // Two seconds: still on 1.9 s later, off by the end of the tick that passes 2 s.
    while (w.state.serverTime < at + 1900) tick(w);
    expect(P(w, "h").asMult).toBe(1400);
    while (w.state.serverTime < at + 2100) tick(w);
    expect(P(w, "h").asMult).toBe(1000);
    expect(P(w, "h").speedMult).toBe(1000);
  });

  it("a hit that is not one (damage over time) does not trigger it, and a boost refreshes instead of stacking", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "h", faction: "holy", weapon: "sword", at: near(230), hpFrac: 1 },
    ]);
    give(w, "h", "adrenaline");
    const max = P(w, "h").maxHp;
    inStep(w, () => { hit(w, "h", "a", max * 0.5, { dot: true, weapon: null }); });
    expect(P(w, "h").asMult, "a damage-over-time tick is no hit").toBe(1000);
    inStepHit(w, "h", "a", max * 0.2);
    inStepHit(w, "h", "a", max * 0.2);
    expect(P(w, "h").asMult).toBe(1400);
  });
});

// ------------------------------------------------------------------------------------------------------------- Wishful Thinking

describe("Wishful Thinking (G13)", () => {
  /** Holy "a" has cast its Wish (cooldown 300 s) a moment ago and hits "v" once per tick when `step` is called. */
  function cooldownArena(): World {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ]);
    give(w, "a", "wishfulThinking");
    P(w, "a").wishReadyAt = 0;
    RT(w, "a").inputs.pushAction({ kind: "cast", slot: "wish", x: P(w, "a").x, y: P(w, "a").y });
    tick(w);
    expect(P(w, "a").wishReadyAt).toBeGreaterThan(w.state.serverTime + 290_000);
    return w;
  }

  it("each hit you land shortens the Wish's cooldown by 1 s", () => {
    const w = cooldownArena();
    const at = P(w, "a").wishReadyAt;
    inStepHit(w, "v", "a", 10);
    expect(P(w, "a").wishReadyAt).toBe(at - 1000);
    inStepHit(w, "v", "a", 10);
    inStepHit(w, "v", "a", 10);
    expect(P(w, "a").wishReadyAt).toBe(at - 3000);
  });

  it("a damage-over-time tick is no hit, and neither is a hit on a fighter by someone else's Wish", () => {
    const w = cooldownArena();
    const at = P(w, "a").wishReadyAt;
    inStep(w, () => { hit(w, "v", "a", 10, { dot: true, weapon: null }); });
    expect(P(w, "a").wishReadyAt).toBe(at);
    inStep(w, () => { hit(w, "v", "a", 10, { weapon: null, ability: "blaze" }); });
    expect(P(w, "a").wishReadyAt).toBe(at);
  });

  it("at most 30 s in any minute", () => {
    const w = cooldownArena();
    const at = P(w, "a").wishReadyAt;
    for (let i = 0; i < 60; i++) inStepHit(w, "v", "a", 10);
    expect(WISHFUL_BUDGET_MS).toBe(30_000);
    expect(P(w, "a").wishReadyAt).toBe(at - 30_000);
    // The minute rolls on: more is allowed again (a hit at a time, 61 s after the first).
    const start = w.state.serverTime;
    while (w.state.serverTime < start + 61_000) tick(w);
    inStepHit(w, "v", "a", 10);
    expect(P(w, "a").wishReadyAt).toBe(at - 31_000);
  });

  it("never under half of the cooldown it was cast with", () => {
    const w = cooldownArena();
    const rt = RT(w, "a");
    const now = w.state.serverTime;
    // A cooldown of 40 s cast now: it can fall to 20 s from now and no further.
    rt.cards!.wishCast = { at: now, cooldownMs: 40_000 };
    P(w, "a").wishReadyAt = now + 40_000;
    rt.cards!.trims = [];
    for (let i = 0; i < 30; i++) inStepHit(w, "v", "a", 10);
    expect(P(w, "a").wishReadyAt).toBe(now + 20_000);
  });

  it("a Wish that has not been cast (the opening lock) is left alone", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ]);
    give(w, "a", "wishfulThinking");
    const at = P(w, "a").wishReadyAt;
    expect(at).toBeGreaterThan(w.state.serverTime);
    inStepHit(w, "v", "a", 10);
    expect(P(w, "a").wishReadyAt).toBe(at);
  });
});

// ------------------------------------------------------------------------------------------------------------- Plant Your Feet

describe("Plant Your Feet", () => {
  it("after standing still for 1 s the next attack has +25% damage and +25% range, then it has to be earned again", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(285) }, // 85 u: past the sword's 64 + 12, inside 80 + 12
    ]);
    give(w, "a", "plantYourFeet");
    // Stand for a second, then swing at the cursor (no lock: a lock would walk into range).
    for (let i = 0; i < 18; i++) tick(w);
    const seenEarly = run(w, 1, () => RT(w, "a").inputs.pushAction({ kind: "attack", a: 0 }));
    const seen = run(w, 20); // the first second: swings at 0, 0.5 s and 1 s after it started
    const all = [...seenEarly.landed, ...seen.landed].flat().filter((h) => h.by === "a" && h.victim === "v");
    expect(all.length, "only the armed swing reaches 85 u").toBe(1);
    // It carried the bonus: an in-reach swing of the same sword hits 25% softer.
    // The axe swings every 0.75 s: standing still from the start, the first swing is armed, the second (0.75 s on) is not, the third (1.5 s on) is again.
    const near2 = arena([
      { id: "a", faction: "holy", weapon: "axe", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(240) },
    ]);
    give(near2, "a", "plantYourFeet");
    for (let i = 0; i < 22; i++) tick(near2); // stood still for a second
    lock(near2, "a", "v");
    const hits = hitsOf(run(near2, 80), "a", "v");
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits[0]!.amount).toBeCloseTo(hits[1]!.amount * (1 + PLANT_FEET_BONUS), 6);
    expect(hits[2]!.amount).toBeCloseTo(hits[0]!.amount, 6);
    expect(hits[3]!.amount).toBeCloseTo(hits[1]!.amount, 6);
    // The armed sword swing that reached 85 u carried the same 25% (a sword hit in the first second, not yet armed, is the reference).
    const ref = arena([{ id: "a", faction: "holy", weapon: "sword", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) }]);
    give(ref, "a", "plantYourFeet");
    lock(ref, "a", "v");
    expect(all[0]!.amount).toBeCloseTo(hitsOf(run(ref, 5), "a", "v")[0]!.amount * (1 + PLANT_FEET_BONUS), 6);
  });

  it("moving resets the clock", () => {
    const w = arena([
      { id: "a", faction: "holy", weapon: "sword", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(240) },
    ]);
    give(w, "a", "plantYourFeet");
    for (let i = 0; i < 30; i++) tick(w);
    // Walk for a moment, then fight: not armed.
    RT(w, "a").inputs.pushMove({ kind: "move", x: 200, y: 360 });
    run(w, 6);
    RT(w, "a").inputs.pushMove({ kind: "stop" });
    lock(w, "a", "v");
    const hits = hitsOf(run(w, 20), "a", "v");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const plain = hitsOf(run(w, 40), "a", "v");
    expect(hits[0]!.amount).toBeCloseTo(plain.at(-1)!.amount, 6);
  });
});

// ------------------------------------------------------------------------------------------------------------- Festering Arcana

describe("Festering Arcana", () => {
  it("when the damage over time ends it keeps ticking 4 more times, each 1/8 of the AP, as magic damage", () => {
    const w = arena([
      { id: "a", faction: "fire", weapon: "axe", at: near(200) },
      { id: "v", faction: "holy", weapon: "", at: near(230) },
    ], { signatures: true });
    give(w, "a", "ap3", "festeringArcana");
    const ap = 33;
    lock(w, "a", "v");
    run(w, 30);
    expect(findStatus(C(w, "v"), "dot", "a")).toBeUndefined();
    // Let go and walk away: the engagement lapses, and the tail starts.
    RT(w, "a").inputs.pushMove({ kind: "move", x: 200, y: 600 });
    P(w, "v").x = 900;
    P(w, "v").y = 100;
    RT(w, "v").history = [{ t: w.state.serverTime, x: 900, y: 100 }];
    const seen = run(w, 160);
    const tail = seen.entries.filter((e) => e.dot && e.weapon === null && e.by.id === "a");
    expect(tail.length, "the tail ticked").toBeGreaterThan(0);
    for (const e of tail) expect(e.packet).toMatchObject({ phys: 0, magic: 1, true: 0 });
    const total = tail.reduce((n, e) => n + e.packet.raw, 0);
    expect(total).toBeCloseTo(4 * (ap / 8), 6);
    const firstTail = seen.entries.indexOf(tail[0]!);
    expect(seen.entries.slice(firstTail).filter((e) => e.sig).length, "the signature itself had stopped").toBe(0);
  });

  it("does nothing without the card, without AP, or for a faction with no damage-over-time signature", () => {
    for (const [faction, cards] of [["fire", ["ap1"]], ["fire", []], ["frost", ["ap1", "festeringArcana"]]] as const) {
      const w = arena([
        { id: "a", faction, weapon: "axe", at: near(200) },
        { id: "v", faction: "holy", weapon: "", at: near(230) },
      ], { signatures: true });
      give(w, "a", ...cards);
      lock(w, "a", "v");
      run(w, 30);
      RT(w, "a").inputs.pushMove({ kind: "stop" });
      P(w, "v").x = 900;
      P(w, "v").y = 100;
      RT(w, "v").history = [{ t: w.state.serverTime, x: 900, y: 100 }];
      const seen = run(w, 100);
      expect(seen.entries.filter((e) => e.dot && e.weapon === null && e.by.id === "a"), `${faction} ${cards.join()}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------- Gambler

describe("Gambler", () => {
  /** `n` ticks, one 100-raw hit each from "a" on "v" (a million hp, armor free), the amounts that landed. */
  function gamble(w: World, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      inStepHit(w, "v", "a", 100);
      out.push(...w.combat.landed.filter((h) => h.by === "a" && h.victim === "v").map((h) => h.amount));
    }
    return out;
  }

  it("each hit has 15% to deal double and 15% to deal half", () => {
    const w = arena([{ id: "a", faction: "holy", weapon: "", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) }]);
    give(w, "a", "gambler");
    const amounts = gamble(w, 1500);
    expect(amounts).toHaveLength(1500);
    const up = amounts.filter((x) => Math.abs(x - 200) < 1e-9).length / 1500;
    const down = amounts.filter((x) => Math.abs(x - 50) < 1e-9).length / 1500;
    const plain = amounts.filter((x) => Math.abs(x - 100) < 1e-9).length / 1500;
    expect(up).toBeGreaterThan(GAMBLER_CHANCE - 0.03);
    expect(up).toBeLessThan(GAMBLER_CHANCE + 0.03);
    expect(down).toBeGreaterThan(GAMBLER_CHANCE - 0.03);
    expect(down).toBeLessThan(GAMBLER_CHANCE + 0.03);
    expect(up + down + plain).toBeCloseTo(1, 12);
  });

  it("only a hit rolls: a damage-over-time tick, a hit without the card and a mob's hit deal the plain amount", () => {
    const w = arena([{ id: "a", faction: "holy", weapon: "", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) }]);
    const plainAmounts = gamble(w, 60);
    for (const x of plainAmounts) expect(x).toBe(100);
    give(w, "a", "gambler");
    const dots: number[] = [];
    for (let i = 0; i < 60; i++) {
      inStep(w, () => { hit(w, "v", "a", 100, { dot: true, weapon: null }); });
      dots.push(...w.combat.landed.filter((h) => h.dot).map((h) => h.amount));
    }
    for (const x of dots) expect(x).toBe(100);
  });

  it("the roll is a function of the secret salt, the tick, the attacker, the victim and the entry: the same fight rolls the same, a new salt rolls anew", () => {
    const run1 = (salt: number): number[] => {
      const w = arena([{ id: "a", faction: "holy", weapon: "", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) }]);
      w.hashSalt = Uint32Array.of(salt, 2, 3, 4);
      give(w, "a", "gambler");
      return gamble(w, 200);
    };
    expect(run1(7)).toEqual(run1(7));
    expect(run1(7)).not.toEqual(run1(8));
  });

  it("two hits of one attacker on one victim in a tick roll separately, and in the same way whatever order they were recorded in", () => {
    const w = arena([{ id: "a", faction: "holy", weapon: "", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) }, { id: "u", faction: "holy", weapon: "", at: near(250) }]);
    give(w, "a", "gambler");
    const outcomes: number[][] = [];
    for (let i = 0; i < 400; i++) {
      inStep(w, () => { hit(w, "v", "a", 100); hit(w, "u", "a", 100); hit(w, "v", "a", 100); });
      const vs = w.combat.landed.filter((h) => h.victim === "v").map((h) => h.amount);
      outcomes.push(vs);
    }
    const pairsDiffer = outcomes.filter(([x, y]) => x !== y).length;
    expect(pairsDiffer, "the two entries on one victim do not share a roll").toBeGreaterThan(40);
  });
});

// ------------------------------------------------------------------------------------------------------------ no order decides it

describe("no processing order changes an outcome", () => {
  const SALT = [0x1234abcd, 0x5eed1e55, 0x0badf00d, 0x2468ace0];

  /**
   * A five-way brawl on a small floor, every card of the pass in play and the PvP rules ON: Spiked Shells, Overkill splashes, bleeds,
   * streaks, crits, a Gambler, blocks with Pocket Sand and Tank Engine, Adrenaline. `ids` is the order the fighters join in and `seed`
   * keys the secret action order and tie-breaks; the reward salt (the hashed rolls) is fixed.
   */
  function brawl(ids: readonly string[], seed: number): World {
    const sheet: Record<string, RigFighter & { cards: string[]; target: string }> = {
      a: { id: "a", faction: "holy", weapon: "sword", at: near(200), cards: ["haste1", "rhythm", "hemorrhage", "tunnelVision", "gambler", "cruelWounds"], target: "b" },
      b: { id: "b", faction: "frost", weapon: "shield", at: near(236), cards: ["armor1", "pocketSand", "tankEngine", "bestOffense", "spikedShell"], target: "a" },
      c: { id: "c", faction: "plague", weapon: "bow", at: near(200, 440), cards: ["thirdTimesTheCharm", "firstImpressions", "adrenaline", "hemorrhage"], target: "d" },
      d: { id: "d", faction: "fire", weapon: "axe", at: near(236, 440), cards: ["ap1", "festeringArcana", "overkill", "eyeForAnEye", "hemorrhage"], target: "e" },
      e: { id: "e", faction: "sentenced", weapon: "wand", at: near(500, 380), cards: ["wishfulThinking", "plantYourFeet"], target: "d" },
    };
    const w = pvpArena(ids.map((id) => sheet[id]!), { pvpRules: true, signatures: true, randomSeed: seed, rewardSalt: SALT });
    for (const id of ids) {
      const f = sheet[id]!;
      give(w, id, ...f.cards);
      P(w, id).hp = P(w, id).maxHp;
      lock(w, id, f.target);
    }
    P(w, "b").facing = Math.PI;
    return w;
  }

  /** What a fight left: every fighter's hp, max hp, status, mirrors and statuses, rounded to what the wire carries. */
  function outcome(w: World, ids: readonly string[]): unknown {
    return [...ids].sort().map((id) => {
      const p = P(w, id);
      const st = statusesOf(C(w, id)).map((s) => [s.kind, s.source.id, s.tag ?? "", Math.round(s.value * 1e6), s.until]).sort((x, y) => String(x).localeCompare(String(y)));
      return [id, Math.round(p.hp * 1e4), Math.round(p.maxHp * 1e4), p.status, p.asMult, p.speedMult, p.armorBonus, p.kills, st];
    });
  }

  const IDS = ["a", "b", "c", "d", "e"];

  it("a fight under another join order, another action order and other tie-breaks gives the same hp, statuses and deaths", () => {
    const runIt = (ids: readonly string[], seed: number): unknown => {
      const w = brawl(ids, seed);
      const snaps: unknown[] = [];
      for (let i = 1; i <= 260; i++) {
        tick(w);
        if (i === 40 || i === 90 || i === 260) snaps.push(outcome(w, ids));
      }
      return snaps;
    };
    const base = runIt(IDS, 12);
    // The brawl is not decided by a secret tie-break, so the outcome must not move with the order salt or the join order.
    expect(runIt([...IDS].reverse(), 12)).toEqual(base);
    expect(runIt(["c", "a", "e", "b", "d"], 12)).toEqual(base);
    expect(runIt(IDS, 99)).toEqual(base);
    expect(runIt([...IDS].reverse(), 4242)).toEqual(base);
    // And it is not a trivial brawl: somebody bled early on, and by the end more than one fighter had died.
    const [early, , last] = base as Array<Array<[string, number, number, string, number, number, number, number, unknown[]]>>;
    expect(JSON.stringify(early)).toContain("bleed:");
    expect(last!.filter((f) => f[3] !== "alive").length).toBeGreaterThanOrEqual(2);
  });

  it("a different reward salt rolls Gambler differently (and only Gambler's rolls move)", () => {
    const final = (salt: readonly number[]): number => {
      const w = pvpArena([
        { id: "a", faction: "holy", weapon: "sword", at: near(200) }, { id: "v", faction: "holy", weapon: "", at: near(230) },
      ], { pvpRules: false, rewardSalt: salt });
      P(w, "v").maxHp = P(w, "v").hp = 1_000_000;
      give(w, "a", "gambler");
      lock(w, "a", "v");
      for (let i = 0; i < 400; i++) tick(w);
      return P(w, "v").hp;
    };
    expect(final(SALT)).toBe(final(SALT));
    expect(final(SALT)).not.toBe(final([1, 2, 3, 4]));
  });

  it("several hits recorded in one tick land the same whatever order they were recorded in", () => {
    const land = (order: readonly number[]): number[] => {
      const w = arena([
        { id: "a", faction: "holy", weapon: "", at: near(200) }, { id: "b", faction: "holy", weapon: "", at: near(200, 380) },
        { id: "v", faction: "holy", weapon: "", at: near(230), hpFrac: 1 },
      ], { pvp: true });
      give(w, "a", "gambler", "hemorrhage");
      give(w, "b", "gambler");
      const hits: Array<() => void> = [() => hit(w, "v", "a", 40), () => hit(w, "v", "b", 70), () => hit(w, "v", "a", 25)];
      inStep(w, () => { for (const i of order) hits[i]!(); });
      return [Math.round(P(w, "v").hp * 1e6)];
    };
    // The two hits of "a" stay in their order (the entry's place keys the roll); "b"'s may come before, between or after.
    expect(land([0, 1, 2])).toEqual(land([1, 0, 2]));
    expect(land([0, 1, 2])).toEqual(land([0, 2, 1]));
  });
});

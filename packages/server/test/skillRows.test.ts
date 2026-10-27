// The R5 passives in the sim (shared/skills.ts rows, folded by sim/mods.ts with the buffs): one rig per live passive, rank 1
// and rank 2, each proving the passive does what its text says; then what is not live stays inert, buffs and passives share
// the damage sum, and the ledger stays order-free with the new `vs` rows (higherFeed, thirdParty, Pestilence's hpBelow).
import { describe, expect, it } from "vitest";
import {
  buffScale, damageShares, decodeFlat, decodeMult, diseaseDps, encodeFlat, encodeMult, EXECUTE_BAND, FACTIONS, HEAL_OVER_TIME_STEP_MS,
  healOverTimeSpanMs, healOverTimeSteps, mapFromTiles, mitigateShares, mulberry32, pacedFaction, SIG_EXECUTE, skillRows, skillText, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type Effect, type FactionId, type GameMap, type SkillId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { teleportToColiseum } from "../src/sim/arena";
import { grantBuff } from "../src/sim/buffs";
import { grantSkill } from "../src/sim/chests";
import { combatant, defenseOf, timingsOf, type Combatant } from "../src/sim/combatant";
import { noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { placeMob } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { executeBandOf, modRowsOf, updateMods } from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, World } from "../src/sim/world";
import { quoted } from "./support/quoted";

// ---------------------------------------------------------------------------------------------------------------- rig

const W_TILES = 40;
const H_TILES = 20;
const tileCentre = (t: number): number => t * TILE + TILE / 2;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + 3 * i), y: tileCentre(10) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

function startRun(factions: FactionId[], opts: { signatures?: boolean } = {}): World {
  const world = createGameWorld({
    seed: 5,
    config: { minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(6),
    map: openMap(),
  }, { signatures: opts.signatures ?? false });
  factions.forEach((faction, i) => addPlayer(world, `p${i}`, `name${i}`, { faction }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const C = (w: World, i: number) => combatant(w, `p${i}`)! as Extract<Combatant, { kind: "player" }>;
const paced = (id: FactionId) => pacedFaction(FACTIONS[id]);

/** p`i` takes `id` up to `rank` through the chest's own grant. */
function give(w: World, i: number, id: SkillId, rank: 1 | 2): void {
  for (let r = 1; r <= rank; r++) expect(grantSkill(w, C(w, i), id)).toBe(r);
}

/** The rank's one `v` (rows read from the catalog, so a retune is a data edit). */
function v(id: SkillId, rank: number, i = 0, faction?: string): number {
  const e: Effect = skillRows(id, rank, faction)[i]!;
  if (e.k === "stat" || e.k === "flat" || e.k === "vs" || e.k === "while") return e.v;
  if (e.k === "trigger" && e.do.do === "heal") return e.do.share;
  return Number.NaN;
}

function setHpFrac(w: World, i: number, frac: number, max = 10_000): void {
  P(w, i).maxHp = max;
  P(w, i).hp = max * frac;
}

/** What one ledger hit of `raw` from p`a` takes off victim `victim` (outside a step). */
function hitFor(w: World, a: number, victim: string, raw: number): number {
  const spec = paced(P(w, a).faction as FactionId);
  const s = w.state.players.get(victim) ?? w.state.mobs.get(victim)!;
  const before = s.hp;
  recordHit(w, { victim, by: { id: `p${a}`, name: P(w, a).name }, packet: { raw, ...damageShares(spec) }, weapon: "sword", stagger: false });
  applyLedger(w);
  return before - s.hp;
}

/** The same hit through the victim's defense at multiplier `mult`. */
function expectedHit(w: World, a: number, victim: string, raw: number, mult: number): number {
  const s = w.state.players.get(victim) ?? w.state.mobs.get(victim)!;
  return mitigateShares(raw * mult, damageShares(paced(P(w, a).faction as FactionId)), defenseOf(s));
}

// ---------------------------------------------------------------------------------------------------- one rig per skill

type Rig = (rank: 1 | 2) => void;

const RIGS: Partial<Record<SkillId, Rig>> = {
  whetstone: (r) => {
    const w = startRun(["fire", "frost"]);
    setHpFrac(w, 1, 0.9);
    give(w, 0, "whetstone", r);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1 + v("whetstone", r)), 9);
  },
  swiftBoots: (r) => {
    const w = startRun(["fire", "frost"]);
    give(w, 0, "swiftBoots", r);
    expect(P(w, 0).speedMult).toBe(encodeMult(1 + v("swiftBoots", r)));
    // The walk: one tick's step is the mirror's speed (nothing else moves it here).
    const x0 = P(w, 0).x;
    RT(w, 0).path = [{ x: x0 + 300, y: P(w, 0).y }];
    step(w, TICK_MS);
    const plain = startRun(["fire", "frost"]);
    const px0 = P(plain, 0).x;
    RT(plain, 0).path = [{ x: px0 + 300, y: P(plain, 0).y }];
    step(plain, TICK_MS);
    expect((P(w, 0).x - x0) / (P(plain, 0).x - px0)).toBeCloseTo(decodeMult(encodeMult(1 + v("swiftBoots", r))), 6);
  },
  quickdraw: (r) => {
    // Melee windups only (owner ruling "Melee windups only"): Fire's axe shortens by the rank's cut, its bow and wand do not.
    const w = startRun(["fire", "frost"]);
    const axe = timingsOf(P(w, 0), "axe")!;
    const bow = timingsOf(P(w, 0), "bow")!;
    const wand = timingsOf(P(w, 0), "wand")!;
    expect(bow.windup).toBe(0.6);
    give(w, 0, "quickdraw", r);
    const m = decodeMult(encodeMult(1 + v("quickdraw", r)));
    expect(P(w, 0).windupMult).toBe(encodeMult(1 + v("quickdraw", r)));
    expect(m).toBeLessThan(1);
    expect(timingsOf(P(w, 0), "axe")!.windup).toBeCloseTo(axe.windup * m, 9);
    expect(timingsOf(P(w, 0), "axe")!.root).toBeCloseTo(axe.root * m, 9);
    expect(timingsOf(P(w, 0), "sword")!.windup).toBeCloseTo(0.1 * m, 9);
    expect(timingsOf(P(w, 0), "bow")).toEqual(bow);
    expect(timingsOf(P(w, 0), "wand")).toEqual(wand);
  },
  thickHide: (r) => {
    const w = startRun(["holy", "fire"]);
    const hp0 = P(w, 0).hp;
    give(w, 0, "thickHide", r);
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.holy.hp * (1 + v("thickHide", r, 0)), 9);
    expect(P(w, 0).hp - hp0).toBeCloseTo(FACTIONS.holy.hp * v("thickHide", r, 0), 9);
    expect(P(w, 0).armorBonus).toBe(encodeFlat(v("thickHide", r, 1)));
    expect(P(w, 0).shieldBonus).toBe(encodeFlat(v("thickHide", r, 2)));
    expect(defenseOf(P(w, 0))).toEqual({
      armor: paced("holy").armor + decodeFlat(encodeFlat(v("thickHide", r, 1))),
      shield: paced("holy").shield + decodeFlat(encodeFlat(v("thickHide", r, 2))),
    });
  },
  bountyHunter: (r) => {
    const w = startRun(["fire", "frost", "holy"]);
    give(w, 0, "bountyHunter", r);
    setHpFrac(w, 1, 0.9);
    setHpFrac(w, 2, 0.9);
    // Same feed: nothing.
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    // p1 has a kill (feed 1 against 0): the bonus.
    P(w, 1).kills = 1;
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1 + v("bountyHunter", r)), 9);
    // Mob kills count a quarter each: 3 mob kills (0.75) against p0's own 1 mob kill (0.25) is higher too.
    RT(w, 2).mobKills = 3;
    RT(w, 0).mobKills = 1;
    expect(hitFor(w, 0, "p2", 100)).toBeCloseTo(expectedHit(w, 0, "p2", 100, 1 + v("bountyHunter", r)), 9);
    // A lower feed, or a mob (no feed at all): nothing.
    RT(w, 0).mobKills = 8;
    expect(hitFor(w, 0, "p2", 100)).toBeCloseTo(expectedHit(w, 0, "p2", 100, 1), 9);
    const dummy = addMob(w, { kind: "dummy", name: "d", at: { x: 300, y: 300 }, hp: 5000 });
    expect(hitFor(w, 0, dummy, 100)).toBeCloseTo(100, 9);
  },
  witness: (r) => {
    const w = startRun(["sentenced", "frost", "fire"], { signatures: true });
    give(w, 0, "witness", r);
    setHpFrac(w, 1, 0.9);
    const bonus = 1 + v("witness", r);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    // p1's lock is on p2: a third party.
    RT(w, 1).weapon.lock = "p2";
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, bonus), 9);
    // p1's lock is on p0 itself: not a third party.
    RT(w, 1).weapon.lock = "p0";
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    // No lock, but p1's last hit (its signature target) is on p2.
    RT(w, 1).weapon.lock = null;
    noteContact(w, "p1", "p2");
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, bonus), 9);
    // A mob fighting someone else is a third party too.
    const mob = placeMob(w, { region: "frost", elite: false, at: { x: tileCentre(20), y: tileCentre(5) } });
    w.mobs.get(mob)!.brain!.mode = "fight";
    w.mobs.get(mob)!.brain!.target = "p2";
    w.state.mobs.get(mob)!.hp = 1e6;
    w.state.mobs.get(mob)!.maxHp = 1e6;
    expect(hitFor(w, 0, mob, 100)).toBeCloseTo(expectedHit(w, 0, mob, 100, bonus), 9);
  },
  pestilence: (r) => {
    // Anyone but Plague: +damage to targets below 60%.
    const w = startRun(["fire", "frost"]);
    give(w, 0, "pestilence", r);
    setHpFrac(w, 1, 0.59);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1 + v("pestilence", r)), 9);
    setHpFrac(w, 1, 0.6);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    expect(executeBandOf(P(w, 0))).toBe(EXECUTE_BAND);
    // Plague: no damage row, a wider execute instead.
    const band = EXECUTE_BAND + v("pestilence", r, 0, "plague");
    const pw = plagueRig(true, r);
    expect(executeBandOf(P(pw, 0))).toBeCloseTo(band, 12);
    setHpFrac(pw, 1, 0.55);
    expect(hitFor(pw, 0, "p1", 100)).toBeCloseTo(expectedHit(pw, 0, "p1", 100, 1), 9);
  },
  lastRites: (r) => {
    const w = startRun(["holy", "fire"]);
    give(w, 0, "lastRites", r);
    const arg = (skillRows("lastRites", r)[0] as Extract<Effect, { k: "while" }>).arg;
    const on = encodeMult(1 + v("lastRites", r));
    setHpFrac(w, 0, arg + 0.01);
    updateMods(w);
    expect(P(w, 0).asMult).toBe(1000);
    setHpFrac(w, 0, arg - 0.01);
    updateMods(w);
    expect(P(w, 0).asMult).toBe(on);
    expect(timingsOf(P(w, 0), "wand")!.interval).toBeLessThan(timingsOf(P(startRun(["holy"]), 0), "wand")!.interval);
    setHpFrac(w, 0, arg + 0.05);
    updateMods(w);
    expect(P(w, 0).asMult).toBe(1000);
  },
  secondWind: (r) => {
    const w = startRun(["frost", "fire"], { signatures: true });
    give(w, 0, "secondWind", r);
    const share = v("secondWind", r);
    setHpFrac(w, 0, 0.3);
    const max = P(w, 0).maxHp;
    // The hit takes p0 to 20%: the first quarter of the heal comes with the pass, despite the lockout.
    const dmg = expectedHit(w, 1, "p0", 2000, 1);
    hitFor(w, 1, "p0", 2000);
    const after = 0.3 * max - dmg;
    expect(after / max).toBeLessThan(0.25);
    expect(P(w, 0).hp).toBeCloseTo(after + share * max / 4, 6);
    // Then a quarter every HEAL_OVER_TIME_STEP_MS: all of it within 2 s.
    const t0 = w.state.serverTime;
    while (w.state.serverTime < t0 + 3 * HEAL_OVER_TIME_STEP_MS) step(w, TICK_MS);
    expect(P(w, 0).hp).toBeCloseTo(after + share * max, 6);
    for (let i = 0; i < 20; i++) step(w, TICK_MS);
    expect(P(w, 0).hp).toBeCloseTo(after + share * max, 6);
    // Once: under 25% again, nothing.
    setHpFrac(w, 0, 0.2);
    hitFor(w, 1, "p0", 10);
    for (let i = 0; i < 40; i++) step(w, TICK_MS);
    expect(P(w, 0).hp / P(w, 0).maxHp).toBeLessThan(0.2);
    // The teleport re-arms rank 2 only.
    teleportToColiseum(w);
    P(w, 0).immuneUntil = 0;
    setHpFrac(w, 0, 0.2);
    const hp = P(w, 0).hp - expectedHit(w, 1, "p0", 10, 1);
    hitFor(w, 1, "p0", 10);
    for (let i = 0; i < 40; i++) step(w, TICK_MS);
    if (r === 2) expect(P(w, 0).hp).toBeCloseTo(hp + share * P(w, 0).maxHp, 6);
    else expect(P(w, 0).hp).toBe(hp);
  },
};

describe("Second Wind's heal over time", () => {
  it("spans 1.5 s (four steps 500 ms apart, the first at once), which is what its text says", () => {
    expect(healOverTimeSteps(2000)).toBe(4);
    expect(healOverTimeSpanMs(2000)).toBe(3 * HEAL_OVER_TIME_STEP_MS);
    expect(skillText("secondWind", 1)).toContain("over 1.5 s");
    expect(skillText("secondWind", 2)).toContain("over 1.5 s");
    const w = startRun(["frost", "fire"], { signatures: true });
    give(w, 0, "secondWind", 1);
    setHpFrac(w, 0, 0.3);
    const max = P(w, 0).maxHp;
    hitFor(w, 1, "p0", 2000);
    const first = P(w, 0).hp;
    const t0 = w.state.serverTime;
    const seen: Array<[number, number]> = [];
    while (w.state.serverTime < t0 + 2000) {
      step(w, TICK_MS);
      seen.push([w.state.serverTime - t0, P(w, 0).hp]);
    }
    const at = (ms: number): number => seen.find(([t]) => t >= ms)![1];
    expect(at(450)).toBeCloseTo(first, 6);
    expect(at(500)).toBeCloseTo(first + 0.05 * max, 6);
    expect(at(1450)).toBeCloseTo(first + 0.10 * max, 6);
    expect(at(1500)).toBeCloseTo(first + 0.15 * max, 6);
    expect(at(2000)).toBeCloseTo(first + 0.15 * max, 6); // nothing after the last step: 1.5 s, not 2 s
  });

  it("a teleport drops the steps still to come, so a re-armed rank 2 never pays the old heal on top of the new one", () => {
    const w = startRun(["frost", "fire"], { signatures: true });
    give(w, 0, "secondWind", 2);
    const share = v("secondWind", 2);
    setHpFrac(w, 0, 0.3);
    hitFor(w, 1, "p0", 2000); // fires: a quarter at once, three steps to come
    expect(P(w, 0).hp / P(w, 0).maxHp).toBeLessThan(0.6);
    step(w, TICK_MS);
    expect(RT(w, 0).hots?.length ?? 0).toBe(1);
    teleportToColiseum(w);
    expect(RT(w, 0).hots?.length ?? 0).toBe(0);
    P(w, 0).immuneUntil = 0;
    setHpFrac(w, 0, 0.2);
    const hp = P(w, 0).hp - expectedHit(w, 1, "p0", 10, 1);
    hitFor(w, 1, "p0", 10);
    for (let i = 0; i < 60; i++) step(w, TICK_MS);
    expect(P(w, 0).hp).toBeCloseTo(hp + share * P(w, 0).maxHp, 6); // exactly one heal
  });
});

/** A Plague p0 (Pestilence at `rank`, or none) engaged with a Frost p1 at bow range, signatures on. */
function plagueRig(withSkill: boolean, rank: 1 | 2 = 1): World {
  const w = startRun(["plague", "frost"], { signatures: true });
  if (withSkill) give(w, 0, "pestilence", rank);
  P(w, 1).x = P(w, 0).x + 100;
  P(w, 1).y = P(w, 0).y;
  return w;
}

const LIVE: SkillId[] = ["whetstone", "swiftBoots", "quickdraw", "thickHide", "bountyHunter", "witness", "pestilence", "lastRites", "secondWind"];

describe("every live passive does what its text says", () => {
  it("has a rig for every live passive", () => {
    expect(Object.keys(RIGS).sort()).toEqual([...LIVE].sort());
  });
  for (const id of LIVE) {
    for (const r of [1, 2] as const) it(`${id}, rank ${r}`, () => RIGS[id]!(r));
  }
});

describe("Pestilence widens a Plague owner's execute in the signature itself", () => {
  it("diseases harder between 50% and 60% and shows the execute there", () => {
    const run = (withSkill: boolean): { lost: number; sig: number } => {
      const w = plagueRig(withSkill);
      setHpFrac(w, 1, 0.55, 1e5);
      noteContact(w, "p0", "p1");
      const before = P(w, 1).hp;
      for (let i = 0; i < 10; i++) step(w, TICK_MS);
      return { lost: before - P(w, 1).hp, sig: P(w, 1).sig };
    };
    const plain = run(false);
    const pest = run(true);
    expect(plain.lost).toBeGreaterThan(0);
    expect(pest.lost).toBeGreaterThan(plain.lost);
    expect(plain.sig & SIG_EXECUTE).toBe(0);
    expect(pest.sig & SIG_EXECUTE).toBe(SIG_EXECUTE);
    // The shared formula: the same slope, from the wider band.
    const spec = paced("plague");
    expect(diseaseDps(spec, 0.55, 0.6) - diseaseDps(spec, 0.55)).toBeCloseTo(spec.params.execute! * 0.05, 9);
    expect(diseaseDps(spec, 0.3, 0.6) - diseaseDps(spec, 0.3)).toBeCloseTo(spec.params.execute! * 0.1, 9);
  });
});

describe("what is not live stays inert", () => {
  it("an r4b, r6 or r7 passive in the build folds nothing", () => {
    const w = startRun(["frost", "fire"]);
    for (const id of ["firebrand", "hoarfrostArmor", "shatter", "ashwalk", "quartermaster", "scout"] as SkillId[]) P(w, 0).build.set(id, 2);
    grantBuff(w, P(w, 0), RT(w, 0), "iceGolem", 0.0001); // any refold
    expect(modRowsOf(P(w, 0)).filter((e) => e.k === "flat" && e.stat === "armor")).toEqual([]);
    expect(P(w, 0).armorBonus).toBe(0);
    expect(P(w, 0).speedMult).toBe(1000);
  });
});

describe("buffs and passives fold together", () => {
  it("a damage buff and Whetstone add in the one damage sum", () => {
    const w = startRun(["fire", "frost"]);
    setHpFrac(w, 1, 0.9);
    grantBuff(w, P(w, 0), RT(w, 0), "emberImp", 3);
    give(w, 0, "whetstone", 1);
    const whet = v("whetstone", 1);
    const ember = quoted("emberImp") * buffScale(3);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1 + ember + whet), 9);
  });
});

describe("a Wish's damage stays flat with every live passive held", () => {
  const TRUE = { phys: 0, magic: 0, true: 1 } as const;

  for (const faction of ["fire", "sentenced", "holy", "plague", "frost"] as const) {
    it(`${faction}: an ability dot entry is untouched while the weapon entry beside it gets the passives' damage and vs rows`, () => {
      const w = startRun([faction, "frost", "frost"], { signatures: true });
      for (const id of LIVE) give(w, 0, id, 2);
      // Every vs row holds against both victims: below 60% hp (Pestilence), a lock on a third party (Witness), a higher feed (Bounty Hunter).
      for (const i of [1, 2]) {
        setHpFrac(w, i, 0.25);
        P(w, i).kills = 3;
      }
      RT(w, 1).weapon.lock = "p2";
      RT(w, 2).weapon.lock = "p1";
      let rows = 1;
      for (const id of LIVE) {
        for (const e of skillRows(id, 2, faction)) if ((e.k === "stat" && e.stat === "damage") || e.k === "vs") rows += e.v;
      }
      expect(rows, "the rig holds the damage and vs rows").toBeGreaterThan(1.3);
      const by = { id: "p0", name: P(w, 0).name };
      const before = { p1: P(w, 1).hp, p2: P(w, 2).hp };
      recordHit(w, { victim: "p1", by, packet: { raw: 100, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false });
      recordHit(w, { victim: "p2", by, packet: { raw: 100, ...TRUE }, weapon: "sword", stagger: false });
      applyLedger(w);
      expect(before.p1 - P(w, 1).hp).toBeCloseTo(100, 9);
      expect(before.p2 - P(w, 2).hp).toBeCloseTo(100 * rows, 9);
      // What the landed hit reports (kill credit, lifesteal) is flat too.
      expect(w.combat.landed.find((h) => h.victim === "p1")!.amount).toBeCloseTo(100, 9);
    });
  }
});

// ------------------------------------------------------------------------------------------------- the order-free pass

describe("the new vs rows keep the ledger order-free", () => {
  type Hit = { by: string; victim: string; raw: number };

  function buildPass(): World {
    const w = startRun(["fire", "holy", "plague", "frost", "sentenced"], { signatures: true });
    give(w, 0, "bountyHunter", 2);
    give(w, 0, "witness", 1);
    give(w, 1, "pestilence", 2);
    give(w, 2, "pestilence", 1); // Plague: the execute band, no damage row
    give(w, 3, "witness", 2);
    give(w, 4, "whetstone", 1);
    give(w, 4, "bountyHunter", 1);
    const hp: Record<string, number> = { p0: 0.95, p1: 0.62, p2: 0.07, p3: 0.58, p4: 0.04 };
    for (const [id, frac] of Object.entries(hp)) {
      P(w, Number(id[1])).maxHp = 1e4;
      P(w, Number(id[1])).hp = 1e4 * frac;
    }
    // Feeds: p2 and p4 are fed (and die in the pass: their killers' feed rises only after it).
    P(w, 2).kills = 2;
    P(w, 4).kills = 1;
    RT(w, 3).mobKills = 2;
    // Fights: p1 locks p2, p3 locks p4, p2's last hit was on p0.
    RT(w, 1).weapon.lock = "p2";
    RT(w, 3).weapon.lock = "p4";
    noteContact(w, "p2", "p0");
    return w;
  }

  const HITS: Hit[] = [
    { by: "p0", victim: "p1", raw: 300 },
    { by: "p0", victim: "p2", raw: 900 },
    { by: "p1", victim: "p2", raw: 200 },
    { by: "p3", victim: "p1", raw: 150 },
    { by: "p4", victim: "p3", raw: 120 },
    { by: "p3", victim: "p4", raw: 700 },
    { by: "p4", victim: "p2", raw: 90 },
    { by: "p1", victim: "p3", raw: 40 },
    { by: "p2", victim: "p0", raw: 77 },
    { by: "p0", victim: "p4", raw: 400 },
  ];

  function record(w: World, h: Hit): LedgerEntry {
    const p = w.state.players.get(h.by)!;
    return recordHit(w, {
      victim: h.victim, by: { id: h.by, name: p.name }, packet: { raw: h.raw, ...damageShares(paced(p.faction as FactionId)) },
      weapon: "sword", stagger: false,
    });
  }

  const outcome = (w: World) => [...w.state.players].map(([id, p]) => [id, p.hp, p.status, p.kills] as const);

  it("any order the hits are recorded in gives the same result to the bit", () => {
    const base = buildPass();
    for (const h of HITS) record(base, h);
    base.stepping = true;
    applyLedger(base);
    base.stepping = false;
    const want = outcome(base);
    // Someone died in it, and the fed victims were worth the bonus.
    expect(want.some(([, , status]) => status === "dead")).toBe(true);
    const r = mulberry32(77);
    for (let trial = 0; trial < 25; trial++) {
      const w = buildPass();
      const list = [...HITS];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [list[i], list[j]] = [list[j]!, list[i]!];
      }
      for (const h of list) record(w, h);
      w.stepping = true;
      applyLedger(w);
      w.stepping = false;
      expect(outcome(w), `trial ${trial}`).toEqual(want);
    }
  });
});

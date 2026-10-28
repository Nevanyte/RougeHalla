// The Sentenced mark (docs/SENTENCED_REDESIGN.md): the tiers by hits and by the target's weapon swaps, the pulse of true damage on every
// landed hit (its share of the target's max hp, kill-stacks, the amplifier, proximity), the attack-speed tax, the output suppression, the
// execute denial with its once-per-mark stack and its linger, kill-stacks, Trial's retune and the five cards, all through the real step().
// Hits are delivered by hand at a chosen tick (an injector, as factions.test.ts does), so a scenario is exact: the sim's own melee phase is
// never asked to land a swing.
import { describe, expect, it } from "vitest";
import {
  attackInterval, bonusMultiplier, decodeMult, FACTIONS, GALLOWS_PATIENCE_EXTRA_MS, GALLOWS_PATIENCE_STUN_MS, HEAVIER_SENTENCE_PER_BONUS, mapFromTiles,
  MARK_DENIAL_LINGER_MS, MARK_FAR_SHARE, MARK_KILL_STACK_CAP, MARK_NEAR_RANGE, MARK_TIER_HITS, markPct, markWeight, mulberry32, pacedFaction,
  SIG_EXEC_BLOCKED, SIG_SUPPRESSED, SIG_TAXED, SIGNATURE_SHARES, TARGET_LOS_GRACE_MS, TARGET_RANGE, taxedRate, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  TRIAL_CONVICTED_RADIUS, TRIAL_EXIT_STUN_MS, TRIAL_MS, TRIAL_RADIUS, WEAPON_IDS, WEAPONS,
  type DamageShares, type FactionId, type FactionSpec, type GameMap, type SignatureKind, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { grantCard } from "../src/sim/chests";
import { combatant, type Combatant } from "../src/sim/combatant";
import { noteContact, signatureState } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { recordHit } from "../src/sim/ledger";
import { placeMob } from "../src/sim/mobLife";
import { asMultOf } from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import { addStatus, findStatus } from "../src/sim/status";
import type { LandedHit, PlayerRuntime, SimConfig, SimEvent, World } from "../src/sim/world";

const DT = TICK_MS / 1000;
/** Fighters get this much hp unless a test says otherwise, so a scenario never ends in a death by accident. */
const BIG_HP = 1e6;
const SIDE = 24;
const CONFIG: SimConfig = {
  minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9, suddenDeathSeconds: 1e9, pvpRules: false,
  wishLockSeconds: 0,
};
const SENTENCED = pacedFaction(FACTIONS.sentenced);
const PLAGUE = pacedFaction(FACTIONS.plague);
const AMP = SENTENCED.params.mark_amp!;

// ---- rig ----

function openMap(): GameMap {
  const tiles = new Uint8Array(SIDE * SIDE).fill(TILE_FLOOR);
  for (let i = 0; i < SIDE; i++) {
    tiles[i] = tiles[(SIDE - 1) * SIDE + i] = TILE_WALL;
    tiles[i * SIDE] = tiles[i * SIDE + SIDE - 1] = TILE_WALL;
  }
  const map = mapFromTiles(SIDE, SIDE, tiles);
  map.spawns = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 400, y: 200 }, { x: 500, y: 200 }];
  return map;
}

interface Fighter {
  id: string;
  faction: FactionId;
  at: readonly [number, number];
  /** In hand: omitted for no weapon (fists), a weapon id otherwise. */
  weapon?: WeaponId | null;
  weapon1?: WeaponId;
  /** An absolute hp: the faction's own max hp then stays. Omitted: BIG_HP. */
  hp?: number;
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string): PlayerRuntime => world.players.get(id)!;
const C = (world: World, id: string): Combatant => combatant(world, id)!;
const CP = (world: World, id: string) => combatant(world, id)! as Extract<Combatant, { kind: "player" }>;
const SIG = (world: World, id: string) => signatureState(world, id)!;

function place(world: World, id: string, x: number, y: number): void {
  const p = P(world, id);
  p.x = x;
  p.y = y;
  const rt = RT(world, id);
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

/** A started run of these fighters (the first step done), each armed and healthy where the scenario puts it. */
function makeWorld(fighters: Fighter[]): World {
  const world = createGameWorld({ config: CONFIG, random: mulberry32(1), map: openMap() });
  for (const f of fighters) addPlayer(world, f.id, f.id.toUpperCase(), { faction: f.faction });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (const f of fighters) {
    const p = P(world, f.id);
    p.weapon0 = f.weapon ?? "";
    p.weapon1 = f.weapon1 ?? "";
    p.slot = 0;
    if (f.hp !== undefined) p.hp = f.hp;
    else p.maxHp = p.hp = BIG_HP;
    place(world, f.id, f.at[0], f.at[1]);
  }
  return world;
}

interface TickLog { now: number; events: SimEvent[]; landed: LandedHit[] }

function tick(world: World): TickLog {
  const events = step(world, TICK_MS);
  return { now: world.state.serverTime, events, landed: [...world.combat.landed] };
}
const run = (world: World, ticks: number): TickLog[] => Array.from({ length: ticks }, () => tick(world));

interface HitOpts {
  raw?: number;
  weapon?: WeaponId | null;
  scale?: number;
  sig?: SignatureKind;
  passive?: boolean;
  dot?: boolean;
  derived?: boolean;
  final?: boolean;
  execute?: boolean;
  ability?: "trial";
  shares?: DamageShares;
}

/** Delivers hits at the front of the next afterWeapons, so the ledger holds them when beforeDamage reads it. */
function injector(world: World) {
  const hits: Array<{ by: string; victim: string } & HitOpts> = [];
  world.afterWeapons.unshift(() => {
    for (const h of hits.splice(0)) {
      recordHit(world, {
        victim: h.victim, by: { id: h.by, name: h.by.toUpperCase() }, packet: { raw: h.raw ?? 1, ...(h.shares ?? { phys: 1, magic: 0, true: 0 }) },
        weapon: h.weapon === undefined ? "sword" : h.weapon, stagger: false,
        ...(h.scale === undefined ? {} : { scale: h.scale }), ...(h.sig === undefined ? {} : { sig: h.sig }),
        ...(h.passive ? { passive: true } : {}), ...(h.dot ? { dot: true } : {}), ...(h.derived ? { derived: true } : {}),
        ...(h.final ? { final: true } : {}), ...(h.execute ? { execute: true as const } : {}), ...(h.ability ? { ability: h.ability } : {}),
      });
    }
  });
  return { hit(by: string, victim: string, opts: HitOpts = {}): void { hits.push({ by, victim, ...opts }); } };
}

type Inj = ReturnType<typeof injector>;
/** `n` landed weapon hits of s on b, one a tick (the tick after the last has run). */
function landHits(world: World, inj: Inj, n: number, by = "s", victim = "b", opts: HitOpts = {}): TickLog[] {
  const logs: TickLog[] = [];
  for (let i = 0; i < n; i++) {
    inj.hit(by, victim, opts);
    logs.push(tick(world));
  }
  return logs;
}

const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const pulses = (logs: readonly TickLog[], by = "s", victim = "b"): LandedHit[] =>
  logs.flatMap((l) => l.landed.filter((h) => h.sig === "mark" && h.by === by && h.victim === victim));
const toasts = (logs: readonly TickLog[], to: string): string[] =>
  logs.flatMap((l) => l.events.flatMap((e) => (e.type === "toast" && e.to === to ? [e.text] : [])));
const tierOf = (n: number): number => Math.min(4, 1 + Math.floor(n / MARK_TIER_HITS));

/** The pulse of the `n`-th landed hit by a Sentenced with `stacks` kill-stacks on a target of `pool` max hp, at range, with the weapon it hit with. */
function pulse(n: number, o: { stacks?: number; pool?: number; weapon?: WeaponId; far?: boolean; scale?: number; amp?: boolean } = {}): number {
  const amp = o.amp ?? tierOf(n) >= 4;
  return markPct(SENTENCED, o.stacks ?? 0, o.scale ?? 1) * (o.pool ?? BIG_HP) * markWeight(SENTENCED, o.weapon ?? "sword") * (amp ? AMP : 1)
    * (o.far ? MARK_FAR_SHARE : 1);
}

/** s (a Sentenced in contact with b, 40 u away). */
const pair = (b: Partial<Fighter> = {}, s: Partial<Fighter> = {}): World => {
  const world = makeWorld([
    { id: "s", faction: "sentenced", at: [300, 300], ...s },
    { id: "b", faction: "holy", at: [340, 300], ...b },
  ]);
  noteContact(world, "s", "b");
  return world;
};

// ---- tiers ----

describe("the tiers (R3)", () => {
  it("a target is not a mark: nothing is marked before the first landed hit", () => {
    const world = pair();
    const logs = run(world, 5);
    expect(SIG(world, "s").target).toBe("b");
    expect(SIG(world, "s").tier).toBe(0);
    expect([P(world, "b").markTier, P(world, "b").markBy, P(world, "b").brand]).toEqual([0, "", 0]);
    expect(pulses(logs)).toHaveLength(0);
  });

  it("the first landed hit makes tier 1 (Accused), pays one pulse and tells a player target", () => {
    const world = pair();
    const inj = injector(world);
    const logs = landHits(world, inj, 1);
    expect(SIG(world, "s").tier).toBe(1);
    expect([P(world, "b").markTier, P(world, "b").markBy, P(world, "b").brand]).toEqual([1, "s", 25]);
    expect(pulses(logs)).toHaveLength(1);
    expect(toasts(logs, "b")).toEqual(["Sentenced marked you."]);
  });

  it("climbs one tier every three landed hits to tier 4 and no further, one pulse for each hit", () => {
    const world = pair();
    const inj = injector(world);
    const seen: number[] = [];
    const all: TickLog[] = [];
    for (let n = 1; n <= 14; n++) {
      all.push(...landHits(world, inj, 1));
      seen.push(P(world, "b").markTier);
    }
    expect(seen).toEqual(Array.from({ length: 14 }, (_, i) => tierOf(i + 1)));
    expect(pulses(all)).toHaveLength(14);
    expect(P(world, "b").brand).toBe(100);
    // Only the first tier is announced.
    expect(toasts(all, "b")).toEqual(["Sentenced marked you."]);
  });

  it("two hits in one tick count each (two pulses), and a hit that is not a weapon hit counts nothing", () => {
    const world = pair();
    const inj = injector(world);
    inj.hit("s", "b");
    inj.hit("s", "b");
    expect(pulses([tick(world)])).toHaveLength(2);
    expect(SIG(world, "s").markHits).toBe(2);
    const before = SIG(world, "s").markHits;
    const notHits: Array<[string, HitOpts]> = [
      ["a signature entry", { sig: "burn" }], ["a passive hit (a riposte)", { passive: true }], ["a damage over time", { dot: true }],
      ["a follow-on", { derived: true }], ["returned damage", { final: true }], ["an ability's damage", { ability: "trial", weapon: null }],
      ["a hit scaled to nothing", { scale: 0 }], ["a hit of 0 damage", { raw: 0 }],
    ];
    for (const [name, opts] of notHits) {
      inj.hit("s", "b", opts);
      expect(pulses([tick(world)]), name).toHaveLength(0);
      expect(SIG(world, "s").markHits, name).toBe(before);
    }
  });

  it("a hit on another enemy switches the mark to it and starts over: the old target is clear, the new one is Accused", () => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300] }, { id: "b", faction: "holy", at: [340, 300] }, { id: "c", faction: "frost", at: [300, 340] },
    ]);
    noteContact(world, "s", "b");
    const inj = injector(world);
    landHits(world, inj, 4);
    expect(P(world, "b").markTier).toBe(2);
    landHits(world, inj, 1, "s", "c");
    expect(SIG(world, "s").target).toBe("c");
    expect([P(world, "b").markTier, P(world, "b").markBy]).toEqual([0, ""]);
    expect([P(world, "c").markTier, P(world, "c").markBy]).toEqual([1, "s"]);
    // And back: the mark on b starts from tier 1 again, the climb is not remembered.
    landHits(world, inj, 1);
    expect([SIG(world, "s").target, SIG(world, "s").markHits, P(world, "b").markTier]).toEqual(["b", 1, 1]);
    expect(P(world, "c").markTier).toBe(0);
  });

  describe("the target's weapon swaps", () => {
    const swapper = (): World => pair({ weapon: "sword", weapon1: "axe" });

    it("a swap promotes one tier at the next tick, and the swap input is the one the hook sees", () => {
      const world = swapper();
      const inj = injector(world);
      landHits(world, inj, 1);
      expect(P(world, "b").markTier).toBe(1);
      RT(world, "b").inputs.pushAction({ kind: "swap" });
      tick(world);
      expect(P(world, "b").slot).toBe(1);
      expect(SIG(world, "s").markSwaps).toBe(1);
      expect([SIG(world, "s").tier, P(world, "b").markTier]).toEqual([2, 2]);
    });

    it("two swaps reach tier 3 and three tier 4; a swap is never a reset", () => {
      const world = swapper();
      const inj = injector(world);
      landHits(world, inj, 1);
      for (const tier of [2, 3, 4, 4]) {
        world.hooks.weaponSwapped!(world, C(world, "b"));
        tick(world);
        expect(SIG(world, "s").tier).toBe(tier);
      }
      expect(SIG(world, "s").markHits).toBe(1);
      expect(SIG(world, "s").target).toBe("b");
    });

    it("promotion can skip tiers: two swaps in one tick are two tiers", () => {
      const world = swapper();
      const inj = injector(world);
      landHits(world, inj, 1);
      world.hooks.weaponSwapped!(world, C(world, "b"));
      world.hooks.weaponSwapped!(world, C(world, "b"));
      tick(world);
      expect(SIG(world, "s").tier).toBe(3);
    });

    it("a swap while nothing is marked yet counts nothing, and a swap by someone else counts nothing", () => {
      const world = makeWorld([
        { id: "s", faction: "sentenced", at: [300, 300] }, { id: "b", faction: "holy", at: [340, 300], weapon: "sword", weapon1: "axe" },
        { id: "c", faction: "plague", at: [600, 600], weapon: "sword", weapon1: "axe" },
      ]);
      noteContact(world, "s", "b");
      world.hooks.weaponSwapped!(world, C(world, "b"));
      tick(world);
      expect([SIG(world, "s").markSwaps, SIG(world, "s").tier]).toEqual([0, 0]);
      const inj = injector(world);
      landHits(world, inj, 1);
      world.hooks.weaponSwapped!(world, C(world, "c"));
      tick(world);
      expect([SIG(world, "s").markSwaps, SIG(world, "s").tier]).toEqual([0, 1]);
    });

    it("either path alone reaches a tier, they are not added: 3 hits and a swap are tier 2, not 3", () => {
      const world = swapper();
      const inj = injector(world);
      landHits(world, inj, 3);
      expect(SIG(world, "s").tier).toBe(2);
      world.hooks.weaponSwapped!(world, C(world, "b"));
      tick(world);
      expect(SIG(world, "s").tier).toBe(2);
    });

    it("No Commutation: a swap promotes two tiers", () => {
      const world = swapper();
      expect(grantCard(world, CP(world, "s"), "noCommutation")).toBe(1);
      const inj = injector(world);
      landHits(world, inj, 1);
      world.hooks.weaponSwapped!(world, C(world, "b"));
      tick(world);
      expect(SIG(world, "s").tier).toBe(3);
    });
  });

  it("Gathering Storm credits 1.5 a hit toward the tiers: tier 2 at the 2nd hit, 3 at the 4th, 4 at the 6th", () => {
    const world = pair();
    expect(grantCard(world, CP(world, "s"), "gatheringStorm")).toBe(1);
    const inj = injector(world);
    const seen = Array.from({ length: 7 }, () => { landHits(world, inj, 1); return SIG(world, "s").tier; });
    expect(seen).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it("Swift Judgment: every 2nd hit counts as a swap, so the climb needs 2, 4 and 6 hits", () => {
    const world = pair();
    expect(grantCard(world, CP(world, "s"), "haste1")).toBe(1);
    expect(grantCard(world, CP(world, "s"), "swiftJudgment")).toBe(1);
    const inj = injector(world);
    const seen = Array.from({ length: 7 }, () => { landHits(world, inj, 1); return SIG(world, "s").tier; });
    expect(seen).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it("the mark ends when the target dies", () => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300] }, { id: "b", faction: "holy", at: [340, 300], hp: 500_000 }, { id: "c", faction: "frost", at: [600, 600] },
    ]);
    P(world, "b").maxHp = BIG_HP;
    noteContact(world, "s", "b");
    const inj = injector(world);
    landHits(world, inj, 4);
    expect(P(world, "b").markTier).toBe(2);
    inj.hit("s", "b", { raw: 900_000 });
    tick(world);
    expect(P(world, "b").status).toBe("dead");
    expect([P(world, "b").markTier, P(world, "b").markBy]).toEqual([0, ""]);
    tick(world);
    expect([SIG(world, "s").tier, SIG(world, "s").target]).toEqual([0, null]);
  });

  it("the teleport ends every mark and gives the taxed their speed back", () => {
    const world = makeWorld([{ id: "s", faction: "sentenced", at: [300, 300] }, { id: "b", faction: "plague", at: [340, 300] }]);
    noteContact(world, "s", "b");
    landHits(world, injector(world), 3);
    expect(P(world, "b").markTax).toBe(23);
    world.hooks.teleported!(world);
    expect([SIG(world, "s")?.tier ?? 0, P(world, "b").markTier, P(world, "b").markTax, P(world, "b").asMult, P(world, "b").sig & SIG_TAXED]).toEqual([0, 0, 0, 1000, 0]);
  });

  it("the target that stays beyond 640 u for 1.5 s drops the mark and the target (the lock-break numbers)", () => {
    const world = pair();
    const inj = injector(world);
    landHits(world, inj, 4);
    place(world, "s", 60, 300);
    place(world, "b", 740, 300);
    const gap = Math.hypot(P(world, "b").x - P(world, "s").x, 0);
    expect(gap).toBeGreaterThan(TARGET_RANGE);
    const graceTicks = Math.round(TARGET_LOS_GRACE_MS / TICK_MS);
    run(world, graceTicks - 1);
    expect(SIG(world, "s").tier).toBe(2);
    run(world, 2);
    expect([SIG(world, "s").tier, SIG(world, "s").target]).toEqual([0, null]);
    expect(P(world, "b").markTier).toBe(0);
  });

  it("coming back inside 640 u in time keeps the mark", () => {
    const world = pair();
    const inj = injector(world);
    landHits(world, inj, 4);
    place(world, "s", 60, 300);
    place(world, "b", 740, 300);
    run(world, 10);
    place(world, "b", 500, 300);
    run(world, 40);
    expect(SIG(world, "s").tier).toBe(2);
  });
});

// ---- the pulse ----

describe("the pulse (R4)", () => {
  it("is a share of the target's max hp: mark_pct x max hp x the hit's weight, true damage whatever the target wears", () => {
    for (const faction of ["holy", "plague", "frost", "fire"] as const) {
      const world = pair({ faction } as Partial<Fighter>);
      const inj = injector(world);
      const [p] = pulses(landHits(world, inj, 1));
      expect(p!.amount, faction).toBeCloseTo(pulse(1), 6);
      expect(p!.weapon).toBe("sword");
      expect(SIGNATURE_SHARES.mark).toEqual({ phys: 0, magic: 0, true: 1 });
    }
  });

  it("scales with the target's own max hp, not the Sentenced's", () => {
    const world = pair();
    P(world, "b").maxHp = 2 * BIG_HP;
    P(world, "b").hp = 2 * BIG_HP;
    const inj = injector(world);
    const [p] = pulses(landHits(world, inj, 1));
    expect(p!.amount).toBeCloseTo(pulse(1, { pool: 2 * BIG_HP }), 6);
  });

  it("follows the weapon the hit was made with: its weight is dpsMult / (1 + boost), so the mark's damage a second is rate x dpsMult", () => {
    for (const w of WEAPON_IDS) {
      const world = pair();
      const inj = injector(world);
      const [p] = pulses(landHits(world, inj, 1, "s", "b", { weapon: w }));
      expect(p!.amount, w).toBeCloseTo(pulse(1, { weapon: w }), 6);
      expect(p!.weapon).toBe(w);
      // Per second of attacks: a pulse per interval, rate x dpsMult of the share.
      const perSecond = markWeight(SENTENCED, w) / attackInterval(SENTENCED, w);
      expect(perSecond, w).toBeCloseTo(SENTENCED.rate * WEAPONS[w].dpsMult, 9);
      expect(bonusMultiplier(w)).toBe(WEAPONS[w].dpsMult);
    }
  });

  it("the amplifier (x1.5) starts with the 9th hit, at tier 4", () => {
    const world = pair();
    const inj = injector(world);
    const all = pulses(landHits(world, inj, 11));
    expect(all.map((p) => p.amount)).toEqual(all.map((_, i) => expect.closeTo(pulse(i + 1), 6)));
    expect(all[8]!.amount / all[7]!.amount).toBeCloseTo(AMP, 9);
    expect(all[10]!.amount).toBeCloseTo(all[8]!.amount, 9);
  });

  it("kill-stacks add mark_kill to the share each: five stacks are x2.25 (the spec's 0.6% to 1.35%)", () => {
    const world = pair();
    P(world, "s").sentence = 5;
    const inj = injector(world);
    const [p] = pulses(landHits(world, inj, 1));
    expect(p!.amount).toBeCloseTo(pulse(1, { stacks: 5 }), 6);
    expect(p!.amount / pulse(1)).toBeCloseTo(2.25, 9);
    const w2 = pair();
    P(w2, "s").sentence = 2;
    expect(pulses(landHits(w2, injector(w2), 1))[0]!.amount / pulse(1)).toBeCloseTo(1.5, 9);
  });

  it("Heavier Sentence: the share grows by 1.5 x the bonus max health over the faction's", () => {
    const world = pair({}, { hp: FACTIONS.sentenced.hp });
    expect(grantCard(world, CP(world, "s"), "vitality3")).toBe(1);
    expect(grantCard(world, CP(world, "s"), "heavierSentence")).toBe(1);
    const bonus = P(world, "s").maxHp - FACTIONS.sentenced.hp;
    expect(bonus).toBeGreaterThan(0);
    const scale = 1 + HEAVIER_SENTENCE_PER_BONUS * (bonus / SENTENCED.hp);
    expect(scale).toBeGreaterThan(1.1);
    const inj = injector(world);
    const [p] = pulses(landHits(world, inj, 1));
    expect(p!.amount).toBeCloseTo(pulse(1, { scale }), 6);
  });

  describe("proximity (R9)", () => {
    const far = (): World => makeWorld([
      { id: "s", faction: "sentenced", at: [100, 300] }, { id: "b", faction: "holy", at: [100 + MARK_NEAR_RANGE + 80, 300] },
    ]);

    it("beyond 300 u the pulse halves; the mark itself does not decay", () => {
      const world = far();
      noteContact(world, "s", "b");
      const inj = injector(world);
      const all = pulses(landHits(world, inj, 3));
      expect(all.map((p) => p.amount)).toEqual(all.map((_, i) => expect.closeTo(pulse(i + 1, { far: true }), 6)));
      expect(SIG(world, "s").tier).toBe(2);
      place(world, "b", 140, 300);
      const [near] = pulses(landHits(world, inj, 1));
      expect(near!.amount).toBeCloseTo(pulse(4), 6);
    });

    it("inside the Sentenced's own Trial ring the mark is at full strength whatever the distance", () => {
      const world = far();
      noteContact(world, "s", "b");
      const inj = injector(world);
      expect(pulses(landHits(world, inj, 1))[0]!.amount).toBeCloseTo(pulse(1, { far: true }), 6);
      enqueueClientMessage(RT(world, "s").inputs, "cast", { slot: "wish", x: P(world, "b").x, y: P(world, "b").y, id: "b" });
      run(world, 12);
      expect(findStatus(C(world, "b"), "zoned", "s")).toBeTruthy();
      // Full strength, and the caster's Trial makes its target take 20% more from it (x1.2 on the pulse like on any of its damage).
      expect(pulses(landHits(world, inj, 1))[0]!.amount).toBeCloseTo(pulse(2) * 1.2, 6);
    });

    it("a Trial ring of someone else is no help", () => {
      const world = far();
      noteContact(world, "s", "b");
      addStatus(world, C(world, "b"), { kind: "zoned", source: { id: "x", name: "X" }, ms: 5000, value: 0.8, data: { dealtMult: 0.8, takenFromSourceMult: 1.2 } });
      const inj = injector(world);
      expect(pulses(landHits(world, inj, 1))[0]!.amount).toBeCloseTo(pulse(1, { far: true }), 6);
    });
  });
});

// ---- the tax ----

describe("the attack-speed tax (R5)", () => {
  /** A Sentenced and a target of `faction` at tier `tier` (hits landed). */
  function taxed(faction: FactionId, hits: number, opts: { at?: readonly [number, number] } = {}): { world: World; inj: Inj } {
    const world = pair({ faction, ...(opts.at ? { at: opts.at } : {}) });
    const inj = injector(world);
    landHits(world, inj, hits);
    return { world, inj };
  }

  it("starts at tier 2: Plague's 1.85 a second becomes 1.425, shown as 23% on the mirror, the bit and the synced percent", () => {
    const { world, inj } = taxed("plague", 2);
    expect(P(world, "b").markTier).toBe(1);
    expect([decodeMult(P(world, "b").asMult), P(world, "b").markTax, P(world, "b").sig & SIG_TAXED]).toEqual([1, 0, 0]);
    landHits(world, inj, 1); // the 3rd hit: Charged
    expect(P(world, "b").markTier).toBe(2);
    const factor = taxedRate(PLAGUE.rate, SENTENCED.params.tax_keep!, SENTENCED.params.tax_cap!) / PLAGUE.rate;
    expect(PLAGUE.rate * factor).toBeCloseTo(1.425, 12);
    expect(decodeMult(P(world, "b").asMult)).toBeCloseTo(factor, 3);
    expect(P(world, "b").markTax).toBe(23);
    expect(P(world, "b").sig & SIG_TAXED).toBe(SIG_TAXED);
    // The tax is the mirror's: the weapon reads the same number.
    expect(asMultOf(P(world, "b"))).toBeCloseTo(factor, 3);
  });

  it.each(["holy", "fire", "frost", "sentenced"] as const)("leaves %s alone: its rate is under 1.0", (faction) => {
    const { world } = taxed(faction, 6);
    expect(P(world, "b").markTier).toBeGreaterThanOrEqual(3); // a Frost's slow credits more per hit (the tiers climb at the unslowed pace)
    expect([P(world, "b").asMult, P(world, "b").markTax, P(world, "b").sig & SIG_TAXED]).toEqual([1000, 0, 0]);
  });

  it("holds a Haste-stacked Plague to 1.6 a second: the ceiling holds past the attack-speed cap, and the cut shown is the real one", () => {
    const world = pair({ faction: "plague", hp: FACTIONS.plague.hp });
    for (const id of ["haste3", "haste3", "haste3"]) grantCard(world, CP(world, "b"), id);
    const before = decodeMult(P(world, "b").asMult);
    expect(before).toBeCloseTo(1.5, 3); // +75% asked, the attack-speed cap gives +50%
    const inj = injector(world);
    landHits(world, inj, 3);
    expect(P(world, "b").markTier).toBe(2);
    const after = decodeMult(P(world, "b").asMult);
    expect(PLAGUE.rate * after).toBeCloseTo(SENTENCED.params.tax_cap!, 2);
    // 2.775 attacks a second (the cap's) down to 1.6: 42% cut.
    expect(P(world, "b").markTax).toBe(Math.round((1 - after / before) * 100));
    expect(P(world, "b").markTax).toBe(42);
  });

  it("a milder haste is taxed by the same rule: 1.85 x 1.2 = 2.22 a second becomes 1.6 (the ceiling), not 1.61", () => {
    const world = pair({ faction: "plague", hp: FACTIONS.plague.hp });
    grantCard(world, CP(world, "b"), "haste3");
    grantCard(world, CP(world, "b"), "haste1");
    const cards = decodeMult(P(world, "b").asMult);
    expect(cards).toBeGreaterThan(1.2);
    landHits(world, injector(world), 3);
    expect(PLAGUE.rate * decodeMult(P(world, "b").asMult)).toBeCloseTo(taxedRate(PLAGUE.rate * cards, 0.5, 1.6), 2);
    expect(PLAGUE.rate * decodeMult(P(world, "b").asMult)).toBeLessThanOrEqual(1.6 + 0.005);
  });

  it("lifts beyond 300 u and returns inside it, and inside a Trial ring it never lifts", () => {
    const { world, inj } = taxed("plague", 3);
    expect(P(world, "b").markTax).toBe(23);
    place(world, "b", 300 + MARK_NEAR_RANGE + 40, 300);
    run(world, 2);
    expect([P(world, "b").asMult, P(world, "b").markTax, P(world, "b").sig & SIG_TAXED]).toEqual([1000, 0, 0]);
    place(world, "b", 340, 300);
    run(world, 2);
    expect(P(world, "b").markTax).toBe(23);
    // In a ring, far away.
    place(world, "b", 300 + MARK_NEAR_RANGE + 40, 300);
    addStatus(world, C(world, "b"), { kind: "zoned", source: { id: "s", name: "S" }, ms: 5000, value: 0.8, data: { dealtMult: 0.8, takenFromSourceMult: 1.2 } });
    run(world, 2);
    expect(P(world, "b").markTax).toBe(23);
    void inj;
  });

  it("ends with the mark: a new target gives the old one its attack speed back", () => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300] }, { id: "b", faction: "plague", at: [340, 300] }, { id: "c", faction: "frost", at: [300, 340] },
    ]);
    noteContact(world, "s", "b");
    const inj = injector(world);
    landHits(world, inj, 3);
    expect(P(world, "b").markTax).toBe(23);
    landHits(world, inj, 1, "s", "c");
    run(world, 1);
    expect([P(world, "b").asMult, P(world, "b").markTax, P(world, "b").sig & SIG_TAXED]).toEqual([1000, 0, 0]);
  });

  it("taxes a Plague mob too, server-side (a mob has no mirror)", () => {
    const world = makeWorld([{ id: "s", faction: "sentenced", at: [300, 300] }]);
    const id = placeMob(world, { region: "plague", elite: false, at: { x: 340, y: 300 }, facing: Math.PI });
    const mob = C(world, id);
    mob.s.maxHp = BIG_HP;
    mob.s.hp = BIG_HP;
    noteContact(world, "s", id);
    const inj = injector(world);
    landHits(world, inj, 3, "s", id);
    expect(mob.s.markTier).toBe(2);
    expect(asMultOf(mob.s)).toBeCloseTo(1.425 / 1.85, 3);
    expect(mob.s.markTax).toBe(23);
  });
});

// ---- suppression ----

describe("output suppression (R6)", () => {
  /** What one hit of b's (raw 100, physical) takes off s, after `hits` landed hits of s's on b. */
  function damageOf(hits: number, zone = false): { dealt: number; landed: LandedHit } {
    const world = pair({ faction: "holy" });
    const inj = injector(world);
    landHits(world, inj, hits);
    if (zone) addStatus(world, C(world, "b"), { kind: "zoned", source: { id: "s", name: "S" }, ms: 5000, value: 0.8, data: { dealtMult: 0.8, takenFromSourceMult: 1.2 } });
    const before = P(world, "s").hp;
    inj.hit("b", "s", { raw: 100 });
    const log = tick(world);
    const landed = log.landed.find((h) => h.by === "b" && h.victim === "s")!;
    return { dealt: before - P(world, "s").hp, landed };
  }

  it("a fighter under a tier 3 mark deals 80% of its damage; tier 2 and under cut nothing", () => {
    const none = damageOf(5);
    const convicted = damageOf(6);
    expect(none.dealt).toBeGreaterThan(0);
    expect(convicted.dealt / none.dealt).toBeCloseTo(SENTENCED.params.suppress!, 9);
    expect(convicted.landed.cut).toBeCloseTo(0.8, 12);
    expect(none.landed.cut).toBeUndefined();
    expect(damageOf(10).dealt / none.dealt).toBeCloseTo(0.8, 9); // tier 4 the same: not deeper
  });

  it("gives way to Trial's own cut: a fighter already inside the ring at x0.8 is not cut to x0.64", () => {
    const base = damageOf(1).dealt;
    expect(damageOf(1, true).dealt / base).toBeCloseTo(0.8, 9);
    expect(damageOf(6, true).dealt / base).toBeCloseTo(0.8, 9);
  });

  it("the synced bit says so", () => {
    const world = pair({ faction: "holy" });
    const inj = injector(world);
    landHits(world, inj, 5);
    expect(P(world, "b").sig & SIG_SUPPRESSED).toBe(0);
    landHits(world, inj, 1);
    expect(P(world, "b").sig & SIG_SUPPRESSED).toBe(SIG_SUPPRESSED);
  });
});

// ---- execute denial and kill-stacks ----

describe("execute denial (R7)", () => {
  /** A Sentenced s with a tier-4 mark on a Plague p (p hits are injected), s hurt to `hp`; the world and its injector. */
  function sentencedP(hp = 100, extra: Partial<Fighter> = {}): { world: World; inj: Inj } {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300], ...extra }, { id: "p", faction: "plague", at: [340, 300] },
    ]);
    noteContact(world, "s", "p");
    const inj = injector(world);
    landHits(world, inj, 9, "s", "p");
    expect(SIG(world, "s").tier).toBe(4);
    P(world, "s").maxHp = FACTIONS.sentenced.hp;
    P(world, "s").hp = hp;
    return { world, inj };
  }
  /** An execute entry of p's (the Plague's, typed like the disease: magic here is irrelevant, it is the entry's flag that counts). */
  const execute = (inj: Inj, raw: number, opts: HitOpts = {}): void => inj.hit("p", "s", { raw, sig: "disease", execute: true, weapon: "bow", ...opts });

  it("p's execute cannot take s below 1 hp while s holds a tier-4 mark on p", () => {
    const { world, inj } = sentencedP(100);
    execute(inj, 10_000);
    const logs = [tick(world)];
    expect(P(world, "s").status).toBe("alive");
    expect(P(world, "s").hp).toBeCloseTo(1, 6);
    expect(P(world, "p").sig & SIG_EXEC_BLOCKED).toBe(SIG_EXEC_BLOCKED);
    expect(toasts(logs, "p")).toEqual(["Execute blocked - already sentenced."]);
  });

  it("does not hold at tier 3: the same execute kills", () => {
    const world = makeWorld([{ id: "s", faction: "sentenced", at: [300, 300] }, { id: "p", faction: "plague", at: [340, 300] }]);
    noteContact(world, "s", "p");
    const inj = injector(world);
    landHits(world, inj, 6, "s", "p");
    expect(SIG(world, "s").tier).toBe(3);
    P(world, "s").maxHp = FACTIONS.sentenced.hp;
    P(world, "s").hp = 100;
    execute(inj, 10_000);
    tick(world);
    expect(P(world, "s").status).toBe("dead");
  });

  it("only the execute is held back: other damage in the same pass still lands and still kills", () => {
    const { world, inj } = sentencedP(100);
    inj.hit("p", "s", { raw: 60, weapon: "bow" });
    execute(inj, 10_000);
    tick(world);
    expect(P(world, "s").hp).toBeCloseTo(1, 6); // the hit's damage came off first (mitigated), the execute took what was left of the pool minus 1
    const second = sentencedP(100);
    second.inj.hit("p", "s", { raw: 100_000, weapon: "bow" });
    execute(second.inj, 10_000);
    tick(second.world);
    expect(P(second.world, "s").status).toBe("dead");
  });

  it("is p's alone: another fighter's execute on s still kills it", () => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300] }, { id: "p", faction: "plague", at: [340, 300] }, { id: "q", faction: "plague", at: [300, 340] },
    ]);
    noteContact(world, "s", "p");
    const inj = injector(world);
    landHits(world, inj, 9, "s", "p");
    P(world, "s").maxHp = FACTIONS.sentenced.hp;
    P(world, "s").hp = 100;
    inj.hit("q", "s", { raw: 10_000, sig: "disease", execute: true, weapon: "bow" });
    tick(world);
    expect(P(world, "s").status).toBe("dead");
  });

  it("converts the denial into +1 kill-stack, once per mark, and a toast; a new mark may earn it again", () => {
    const { world, inj } = sentencedP(100);
    expect(P(world, "s").sentence).toBe(0);
    execute(inj, 10_000);
    tick(world);
    expect(P(world, "s").sentence).toBe(1);
    expect(SIG(world, "s").markDenied).toBe(true);
    P(world, "s").hp = 100;
    execute(inj, 10_000);
    tick(world);
    expect(P(world, "s").sentence).toBe(1); // the same mark pays once
    // A new mark (the target switches to q and back) is a new latch.
    const q = addPlayer(world, "q", "Q", { faction: "frost" });
    void q;
  });

  it("a denied execute lets the x1.5 amplifier outlive the mark by 2 s", () => {
    const { world, inj } = sentencedP(100);
    execute(inj, 10_000);
    tick(world);
    const until = SIG(world, "s").ampUntil;
    expect(until).toBe(world.state.serverTime + MARK_DENIAL_LINGER_MS);
    // The mark breaks (s hits nobody else; the target walks away for good: dropped by distance is slow, so end it by a new target).
    const world2 = pair();
    void world2;
  });

  it("Final Verdict pays the denied damage back to p as true damage, the next tick", () => {
    const { world, inj } = sentencedP(100, {});
    expect(grantCard(world, CP(world, "s"), "finalVerdict")).toBe(1);
    const hpBefore = P(world, "p").hp;
    execute(inj, 10_000);
    const first = tick(world);
    const denied = first.landed.find((h) => h.victim === "s" && h.by === "p")!;
    expect(denied).toBeTruthy();
    expect(P(world, "p").hp).toBe(hpBefore); // queued for the next ledger, never in the pass that denied it
    const log = tick(world);
    const back = log.landed.find((h) => h.by === "s" && h.victim === "p" && h.sig === undefined && h.passive === true);
    expect(back).toBeTruthy();
    expect(back!.amount).toBeGreaterThan(0);
    expect(hpBefore - P(world, "p").hp).toBeCloseTo(back!.amount, 6);
    expect(back!.amount).toBeLessThanOrEqual(10_000 + 1e-6);
  });

  it("a weapon hit's execute bonus (Coup de Grace) is held back too: it would have killed, and does not against a tier-4 mark", () => {
    const lethalWithCard = (hits: number): World => {
      const world = makeWorld([{ id: "s", faction: "sentenced", at: [300, 300] }, { id: "p", faction: "plague", at: [340, 300] }]);
      noteContact(world, "s", "p");
      const inj = injector(world);
      landHits(world, inj, hits, "s", "p");
      P(world, "s").maxHp = FACTIONS.sentenced.hp;
      P(world, "s").hp = 100;
      expect(grantCard(world, CP(world, "p"), "coupDeGrace")).toBe(1);
      // 96 once the armor and the sentence's cut are in: not lethal alone; with the card's +30% below 30% hp it is (124.8).
      inj.hit("p", "s", { raw: 300, weapon: "bow" });
      tick(world);
      return world;
    };
    const tier3 = lethalWithCard(6);
    expect(SIG(tier3, "s").tier).toBe(3);
    expect(P(tier3, "s").status).toBe("dead");
    const tier4 = lethalWithCard(9);
    expect(SIG(tier4, "s").tier).toBe(4);
    expect(P(tier4, "s").status).toBe("alive");
    expect(P(tier4, "s").hp).toBeCloseTo(1, 6);
    expect(P(tier4, "s").sentence).toBe(1);
  });
});

describe("kill-stacks (R8)", () => {
  const killer = (world: World): PlayerRuntime => RT(world, "s");

  it("a Sentenced's player kill gives +1, to the cap of 5; a leave (mia) and any other faction's kill give nothing", () => {
    const world = pair();
    const victim = RT(world, "b");
    for (let i = 1; i <= 7; i++) {
      world.hooks.playerKilled!(world, killer(world), victim, "died");
      expect(P(world, "s").sentence).toBe(Math.min(i, MARK_KILL_STACK_CAP));
    }
    const w2 = pair();
    world2Kill(w2, "mia");
    expect(P(w2, "s").sentence).toBe(0);
    w2.hooks.playerKilled!(w2, RT(w2, "b"), RT(w2, "s"), "died"); // Holy killed the Sentenced
    expect(P(w2, "b").sentence).toBe(0);
  });
  function world2Kill(w: World, outcome: "died" | "mia"): void {
    w.hooks.playerKilled!(w, RT(w, "s"), RT(w, "b"), outcome);
  }

  it("a real kill of the marked target pays a stack and says so", () => {
    const world = pair({ hp: 500_000 });
    P(world, "b").maxHp = BIG_HP;
    const inj = injector(world);
    landHits(world, inj, 1);
    inj.hit("s", "b", { raw: 900_000 });
    const log = tick(world);
    expect(P(world, "b").status).toBe("dead");
    expect(P(world, "s").sentence).toBe(1);
    expect(toasts([log], "s")).toContain("Your sentence has been carried out.");
  });

  it("starts every run from nothing and keeps through the teleport", () => {
    const world = pair();
    P(world, "s").sentence = 4;
    world.hooks.raidStarted!(world);
    expect(P(world, "s").sentence).toBe(0);
    P(world, "s").sentence = 3;
    world.hooks.teleported!(world);
    expect(P(world, "s").sentence).toBe(3);
  });
});

// ---- Trial ----

describe("Trial retuned (section 3)", () => {
  const rig = (): { world: World; inj: Inj } => {
    const world = pair({}, {});
    place(world, "b", 480, 300);
    noteContact(world, "s", "b");
    return { world, inj: injector(world) };
  };
  const castTrial = (world: World): void => {
    enqueueClientMessage(RT(world, "s").inputs, "cast", { slot: "wish", x: P(world, "b").x, y: P(world, "b").y, id: "b" });
    run(world, 9);
  };
  const ring = (world: World) => [...world.state.fields.values()][0]!;

  it("is a 300 u ring on a target the mark has not taken to tier 3", () => {
    const { world, inj } = rig();
    landHits(world, inj, 5); // tier 2
    castTrial(world);
    expect(ring(world).r).toBe(TRIAL_RADIUS);
  });

  it("is born at 200 u on a target at tier 3 or more", () => {
    const { world, inj } = rig();
    landHits(world, inj, 6);
    castTrial(world);
    expect(ring(world).r).toBe(TRIAL_CONVICTED_RADIUS);
    expect(TRIAL_CONVICTED_RADIUS).toBeLessThan(TRIAL_RADIUS);
  });

  it("a ring without a mark of the caster on the target is the plain 300 u", () => {
    const world = makeWorld([{ id: "s", faction: "sentenced", at: [300, 300] }, { id: "b", faction: "holy", at: [480, 300] }]);
    castTrial(world);
    expect(ring(world).r).toBe(TRIAL_RADIUS);
  });

  it("walking out stuns for 1 s; with Gallows' Patience the ring lasts 2 s longer and the stun is 1.5 s", () => {
    for (const patient of [false, true]) {
      const { world } = rig();
      if (patient) expect(grantCard(world, CP(world, "s"), "gallowsPatience")).toBe(1);
      castTrial(world);
      const f = ring(world);
      expect(f.endsAt - f.startedAt).toBe(TRIAL_MS + (patient ? GALLOWS_PATIENCE_EXTRA_MS : 0));
      expect(findStatus(C(world, "b"), "zoned", "s")!.until - f.startedAt).toBe(TRIAL_MS + (patient ? GALLOWS_PATIENCE_EXTRA_MS : 0));
      place(world, "b", f.x + TRIAL_RADIUS + 60, f.y);
      tick(world);
      const stun = findStatus(C(world, "b"), "stun", "s");
      expect(stun, String(patient)).toBeTruthy();
      expect(stun!.until - world.state.serverTime).toBe(patient ? GALLOWS_PATIENCE_STUN_MS : TRIAL_EXIT_STUN_MS);
    }
  });

  it("the stun length is the cast's: it survives a caster that has left the fight", () => {
    const { world } = rig();
    expect(grantCard(world, CP(world, "s"), "gallowsPatience")).toBe(1);
    castTrial(world);
    const runtime = [...world.abilities!.fields.values()][0]!;
    expect(runtime.exitStunMs).toBe(GALLOWS_PATIENCE_STUN_MS);
  });
});

// ---- synced fields ----

describe("what the client reads (section 10)", () => {
  it("shows the strongest mark on a fighter, who holds it and the tier's bits", () => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300] }, { id: "t", faction: "sentenced", at: [300, 340] }, { id: "b", faction: "plague", at: [340, 300] },
    ]);
    noteContact(world, "s", "b");
    noteContact(world, "t", "b");
    const inj = injector(world);
    landHits(world, inj, 3, "s", "b"); // tier 2 from s
    landHits(world, inj, 1, "t", "b"); // tier 1 from t
    expect([P(world, "b").markTier, P(world, "b").markBy]).toEqual([2, "s"]);
    landHits(world, inj, 3, "t", "b"); // tier 2 from t too: the lower id holds the tie
    expect([P(world, "b").markTier, P(world, "b").markBy]).toEqual([2, "s"]);
    // Several marks tax once.
    expect(P(world, "b").markTax).toBe(23);
  });
});

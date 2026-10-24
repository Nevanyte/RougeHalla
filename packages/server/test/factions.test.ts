import { describe, expect, it } from "vitest";
import {
  attackInterval, backlashPerSwing, bonusMultiplier, burnDps, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, chillMultiplier,
  damageShares, diseaseDps, DOT_FX_MS, ENGAGE_LINGER_SECONDS, ENGAGE_TRADE_SECONDS, ENGAGE_TRADE_SLACK_SECONDS, engageRange, FACTION_IDS, FACTIONS,
  HEAL_LOCKOUT_SECONDS,
  lifestealFraction, mapFromTiles, markDps, markShare, mitigateShares, mulberry32, pacedFaction, PLAYER_SPEED,
  SIG_BURNING, SIG_CHILLED, SIG_DISEASED, SIG_EXECUTE, SIGNATURE_WEAPONS, TARGET_FORGET_SECONDS, TICK_MS, TILE,
  TILE_FLOOR, TILE_WALL, WEAPON_IDS, WEAPONS,
  type FactionId, type FactionSpec, type FxEvent, type GameMap, type SignatureKind, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyHits, teleportToColiseum, type Attacker } from "../src/sim/arena";
import { combatant, type Combatant } from "../src/sim/combatant";
import { heal, noteContact, signatureState, stretchUntil, targetOf } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { recordHit } from "../src/sim/ledger";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { packetFor } from "../src/sim/weapons";
import { chainHook, emit } from "../src/sim/world";
import type { LandedHit, LedgerEntry, PlayerRuntime, SimConfig, SimEvent, World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const DT = TICK_MS / 1000;
/** Fighters get this much hp unless a test says otherwise, so a scenario never ends in a death by accident. */
const BIG_HP = 1e6;
const SIDE = 24;
const CONFIG: SimConfig = {
  minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9, suddenDeathSeconds: 1e9,
};
const LINGER_TICKS = Math.round((ENGAGE_LINGER_SECONDS * 1000) / TICK_MS);
const FORGET_TICKS = Math.round((TARGET_FORGET_SECONDS * 1000) / TICK_MS);
const TRADE_TICKS = Math.round((ENGAGE_TRADE_SECONDS * 1000) / TICK_MS);
/** A hit too small to matter, delivered every tick by `trade` to keep a pair trading (engaged) for as long as a test needs. */
const TRADE_RAW = 1e-6;
/** Frost's chill multiplier: the arena fights the paced spec, but the slow is not a damage number. */
const CHILL = chillMultiplier(FACTIONS.frost);

/** The factions as the sim fights them (DUEL_PACE applied). */
const SPEC = Object.fromEntries(FACTION_IDS.map((id) => [id, pacedFaction(FACTIONS[id])])) as Record<FactionId, FactionSpec>;

/** What a signature hit of `raw` by `owner` costs a `victim`: the owner's shares against the victim's armor and shield. */
const mitigated = (owner: FactionId, victim: FactionId, raw: number): number =>
  mitigateShares(raw, damageShares(SPEC[owner]), SPEC[victim]);

// ---- harness ----

/** Open floor with a wall border and `walls` (tile coordinates) as obstacles. */
function openMap(walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(SIDE * SIDE).fill(TILE_FLOOR);
  for (let i = 0; i < SIDE; i++) {
    tiles[i] = tiles[(SIDE - 1) * SIDE + i] = TILE_WALL;
    tiles[i * SIDE] = tiles[i * SIDE + SIDE - 1] = TILE_WALL;
  }
  for (const [tx, ty] of walls) tiles[ty * SIDE + tx] = TILE_WALL;
  const map = mapFromTiles(SIDE, SIDE, tiles);
  map.spawns = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 400, y: 200 }, { x: 500, y: 200 }];
  return map;
}

const column = (tx: number, ty0: number, ty1: number): Array<[number, number]> =>
  Array.from({ length: ty1 - ty0 + 1 }, (_, i) => [tx, ty0 + i]);

interface Fighter {
  id: string;
  faction: FactionId;
  at: readonly [number, number];
  /** In hand: omitted for the faction's signature weapon, null for an empty hand. */
  weapon?: WeaponId | null;
  weapon1?: WeaponId;
  /** Share of BIG_HP, or an absolute hp (the faction's own max hp then stays). */
  hpFrac?: number;
  hp?: number;
}

const P = (world: World, id: string): PlayerState => world.state.players.get(id)!;
const RT = (world: World, id: string): PlayerRuntime => world.players.get(id)!;
const C = (world: World, id: string): Combatant => combatant(world, id)!;
const hpOf = (world: World, id: string): number => P(world, id).hp;

/** A started run (first step done) with every fighter placed, armed and healthy. */
function makeWorld(fighters: Fighter[], walls: ReadonlyArray<readonly [number, number]> = []): World {
  const world = createGameWorld({ seed: 1, config: CONFIG, random: mulberry32(1), map: openMap(walls) });
  for (const f of fighters) addPlayer(world, f.id, f.id.toUpperCase(), f.faction);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (const f of fighters) {
    const p = P(world, f.id);
    const weapon = f.weapon === undefined ? SIGNATURE_WEAPONS[f.faction] : f.weapon;
    p.weapon0 = weapon ?? "";
    p.weapon1 = f.weapon1 ?? "";
    p.slot = 0;
    if (f.hp !== undefined) {
      p.hp = f.hp;
    } else {
      p.maxHp = BIG_HP;
      p.hp = BIG_HP * (f.hpFrac ?? 1);
    }
    place(world, f.id, f.at[0], f.at[1]);
  }
  return world;
}

function place(world: World, id: string, x: number, y: number): void {
  const p = P(world, id);
  p.x = x;
  p.y = y;
  const rt = RT(world, id);
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

interface TickLog { now: number; events: SimEvent[]; landed: LandedHit[] }

function tick(world: World): TickLog {
  const events = step(world, TICK_MS);
  return { now: world.state.serverTime, events, landed: [...world.combat.landed] };
}

function run(world: World, ticks: number): TickLog[] {
  return Array.from({ length: ticks }, () => tick(world));
}

/** Steps `n` ticks, calling `check` right after each, while the world still holds that tick's state. */
function runChecked(world: World, n: number, check: (log: TickLog, i: number) => void): void {
  for (let i = 0; i < n; i++) check(tick(world), i);
}

function runUntil(world: World, serverTime: number): TickLog[] {
  const out: TickLog[] = [];
  while (world.state.serverTime < serverTime) out.push(tick(world));
  expect(world.state.serverTime).toBe(serverTime);
  return out;
}

function fxOf<K extends FxEvent["kind"]>(events: readonly SimEvent[], kind: K): Array<Fx<K>> {
  return events
    .flatMap((e) => (e.type === "fx" ? [e.fx] : []))
    .filter((fx): fx is Fx<K> => fx.kind === kind);
}

const sigHits = (log: TickLog, sig: SignatureKind): LandedHit[] => log.landed.filter((h) => h.sig === sig);
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const sigTotal = (log: TickLog, sig: SignatureKind): number => sum(sigHits(log, sig).map((h) => h.amount));

interface HitOpts {
  raw?: number;
  weapon?: WeaponId;
  scale?: number;
  sig?: SignatureKind;
  stagger?: boolean;
  passive?: boolean;
  projectile?: string;
}

interface BlockOpts { weapon?: WeaponId; passive?: boolean }

/**
 * Delivers hits, blocks and swings at a chosen tick without the (still stubbed) melee phase. Hits and swings go in at
 * the front of afterWeapons, so the factions' own afterWeapons system sees the swings and the ledger holds the hits
 * when beforeDamage reads it. A block is emitted where melee would emit it: after melee, before the signature phase.
 */
function injector(world: World) {
  const hits: Array<{ by: string; victim: string } & HitOpts> = [];
  const swings: Array<{ by: string; weapon: WeaponId }> = [];
  const blocks: Array<{ holder: string; attacker: string; opts: BlockOpts }> = [];
  const trades: Array<{ by: string; victim: string }> = [];
  const record = (h: { by: string; victim: string } & HitOpts): void => {
    recordHit(world, {
      victim: h.victim,
      by: { id: h.by, name: h.by.toUpperCase() },
      packet: { raw: h.raw ?? 1, phys: 1, magic: 0, true: 0 },
      weapon: h.weapon ?? "sword",
      stagger: h.stagger ?? false,
      ...(h.scale === undefined ? {} : { scale: h.scale }),
      ...(h.sig === undefined ? {} : { sig: h.sig }),
      ...(h.passive === undefined ? {} : { passive: h.passive }),
      ...(h.projectile === undefined ? {} : { projectile: h.projectile }),
    });
  };
  world.afterWeapons.unshift(() => {
    for (const h of hits.splice(0)) record(h);
    for (const t of trades) record({ ...t, raw: TRADE_RAW });
    for (const s of swings.splice(0)) {
      world.combat.melee.push({
        attacker: s.by, weapon: s.weapon, a: 0, rewindT: world.state.serverTime, packet: { raw: 0, phys: 1, magic: 0, true: 0 },
      });
    }
  });
  world.beforeDamage.unshift(() => {
    for (const b of blocks.splice(0)) {
      emit(world, {
        type: "fx",
        fx: { kind: "block", id: b.holder, by: b.attacker, weapon: b.opts.weapon ?? "sword", ...(b.opts.passive ? { passive: true } : {}) },
      });
    }
  });
  return {
    hit(by: string, victim: string, opts: HitOpts = {}): void { hits.push({ by, victim, ...opts }); },
    swing(by: string, weapon: WeaponId): void { swings.push({ by, weapon }); },
    /** `holder`'s shield blocked a swing of `attacker`'s this tick. */
    block(holder: string, attacker: string, opts: BlockOpts = {}): void { blocks.push({ holder, attacker, opts }); },
    /** From the next tick on, `by` lands a negligible hit on `victim` every tick, until stopTrading. */
    trade(by: string, victim: string): void { trades.push({ by, victim }); },
    stopTrading(): void { trades.length = 0; },
  };
}

// ---- targets ----

describe("targets", () => {
  /** Nobody can reach anybody (empty hands), so only the bookkeeping of who targets whom is on show. */
  const trio = (): World => makeWorld([
    { id: "a", faction: "fire", at: [100, 100], weapon: null },
    { id: "b", faction: "holy", at: [300, 100], weapon: null },
    { id: "c", faction: "plague", at: [500, 100], weapon: null },
  ]);

  it("a hit makes the victim the attacker's target, and a victim without a target takes the attacker as its own", () => {
    const world = trio();
    injector(world).hit("a", "b");
    tick(world);
    expect(targetOf(world, "a")).toBe("b");
    expect(targetOf(world, "b")).toBe("a");
    expect(targetOf(world, "c")).toBeNull();
  });

  it("noteContact starts a pair in contact: each targets the other", () => {
    const world = trio();
    noteContact(world, "a", "b");
    expect(targetOf(world, "a")).toBe("b");
    expect(targetOf(world, "b")).toBe("a");
  });

  it("a victim that already has a target keeps it when a third fighter hits it", () => {
    const world = trio();
    const inj = injector(world);
    inj.hit("a", "b");
    tick(world);
    inj.hit("c", "b");
    tick(world);
    expect(targetOf(world, "b")).toBe("a");
    expect(targetOf(world, "c")).toBe("b");
    expect(targetOf(world, "a")).toBe("b");
  });

  it("a fighter that hits a different enemy switches its target to that one", () => {
    const world = trio();
    const inj = injector(world);
    inj.hit("a", "b");
    tick(world);
    inj.hit("a", "c");
    tick(world);
    expect(targetOf(world, "a")).toBe("c");
    expect(targetOf(world, "c")).toBe("a");
    expect(targetOf(world, "b")).toBe("a");
  });

  it.each<[string, HitOpts]>([
    ["a hit of 0 damage", { raw: 0 }],
    ["a hit scaled to nothing (an axe destroyed the ball)", { scale: 0 }],
    ["burn", { sig: "burn" }],
    ["backlash", { sig: "backlash" }],
    ["disease", { sig: "disease" }],
    ["mark", { sig: "mark" }],
  ])("%s does not make a target", (_name, opts) => {
    const world = trio();
    injector(world).hit("a", "b", opts);
    tick(world);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "b")).toBeNull();
  });

  it("a victim in teleport immunity neither becomes a target nor gives one", () => {
    const world = trio();
    P(world, "b").immuneUntil = world.state.serverTime + 5000;
    injector(world).hit("a", "b");
    tick(world);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "b")).toBeNull();
  });
});

describe("target choice within one tick", () => {
  const trio = (): World => makeWorld([
    { id: "a", faction: "fire", at: [100, 100], weapon: null },
    { id: "b", faction: "holy", at: [300, 100], weapon: null },
    { id: "c", faction: "plague", at: [500, 100], weapon: null },
  ]);
  /** Delivers `hits` (attacker, victim, options) in the given order in one tick on a fresh trio. */
  const oneTick = (hits: Array<[string, string, HitOpts?]>, before?: (world: World) => void): World => {
    const world = trio();
    before?.(world);
    const inj = injector(world);
    for (const [by, victim, opts] of hits) inj.hit(by, victim, opts);
    tick(world);
    return world;
  };

  it.each([
    ["the small one first", [["a", "b", { raw: 10 }], ["a", "c", { raw: 50 }]]],
    ["the large one first", [["a", "c", { raw: 50 }], ["a", "b", { raw: 10 }]]],
  ] as Array<[string, Array<[string, string, HitOpts]>]>)(
    "an attacker that hit two enemies takes the one it hit hardest (%s in the ledger)",
    (_name, hits) => {
      const world = oneTick(hits);
      expect(targetOf(world, "a")).toBe("c");
    },
  );

  it("a hit's size is its raw damage times its scale", () => {
    const world = oneTick([["a", "b", { raw: 100, scale: 0.3 }], ["a", "c", { raw: 40 }]]);
    expect(targetOf(world, "a")).toBe("c");
  });

  it("an attacker that hit its current target this tick keeps it, even when it hit another harder", () => {
    const world = oneTick([["a", "c", { raw: 100 }], ["a", "b", { raw: 1 }]], (w) => noteContact(w, "a", "b"));
    expect(targetOf(world, "a")).toBe("b");
  });

  it("an attacker that did not hit its current target this tick switches to the one it did hit", () => {
    const world = oneTick([["a", "c", { raw: 1 }]], (w) => noteContact(w, "a", "b"));
    expect(targetOf(world, "a")).toBe("c");
  });

  it("a fighter that is hit by its target and hits nobody keeps the target", () => {
    const world = oneTick([["b", "a", { raw: 10 }], ["c", "a", { raw: 99 }]], (w) => noteContact(w, "a", "b"));
    expect(targetOf(world, "a")).toBe("b");
  });

  it.each([
    ["the small one first", [["a", "b", { raw: 10 }], ["c", "b", { raw: 50 }]]],
    ["the large one first", [["c", "b", { raw: 50 }], ["a", "b", { raw: 10 }]]],
  ] as Array<[string, Array<[string, string, HitOpts]>]>)(
    "a victim without a target takes the attacker of the largest hit on it (%s in the ledger)",
    (_name, hits) => {
      const world = oneTick(hits);
      expect(targetOf(world, "b")).toBe("c");
      expect(targetOf(world, "a")).toBe("b");
      expect(targetOf(world, "c")).toBe("b");
    },
  );

  it("equal hits are tied by a salted per-tick hash: the same for any ledger order, and not always the same enemy", () => {
    const outcome = (salt: number, idle: number, order: readonly string[]): string | null => {
      const world = trio();
      world.orderSalt = salt;
      run(world, idle);
      const inj = injector(world);
      for (const victim of order) inj.hit("a", victim, { raw: 10 });
      tick(world);
      return targetOf(world, "a");
    };
    const seen = new Set<string | null>();
    for (const salt of [1, 2, 3, 4, 5, 6]) {
      for (const idle of [0, 1, 2, 3, 4, 5]) {
        const first = outcome(salt, idle, ["b", "c"]);
        expect(outcome(salt, idle, ["c", "b"]), `salt ${salt}, ${idle} idle ticks`).toBe(first);
        expect(["b", "c"]).toContain(first);
        seen.add(first);
      }
    }
    expect([...seen].sort()).toEqual(["b", "c"]);

    // Per tick: under one salt, the favoured enemy changes from tick to tick.
    for (const salt of [1, 2, 3]) {
      const perTick = new Set(Array.from({ length: 12 }, (_, idle) => outcome(salt, idle, ["b", "c"])));
      expect([...perTick].sort(), `salt ${salt}`).toEqual(["b", "c"]);
    }
  });

  describe("blocks", () => {
    it("a block is the attacker's contact with the holder, and the holder answers", () => {
      const world = trio();
      injector(world).block("b", "a");
      tick(world);
      expect(targetOf(world, "a")).toBe("b");
      expect(targetOf(world, "b")).toBe("a");
    });

    it("a block ranks below any hit: a fighter that hit one enemy and was blocked by another takes the one it hit", () => {
      const world = trio();
      const inj = injector(world);
      inj.block("b", "a");
      inj.hit("a", "c", { raw: 0.001 });
      tick(world);
      expect(targetOf(world, "a")).toBe("c");
      expect(targetOf(world, "b")).toBe("a");
    });

    describe("a block of a reflected arrow (passive)", () => {
      /** h1 is fighting o when its reflected arrow is blocked by h2's shield. */
      const reflected = (opts: BlockOpts): World => {
        const world = makeWorld([
          { id: "h1", faction: "holy", at: [100, 100], weapon: null },
          { id: "h2", faction: "holy", at: [300, 100], weapon: null },
          { id: "o", faction: "plague", at: [500, 100], weapon: null },
        ]);
        noteContact(world, "h1", "o");
        injector(world).block("h2", "h1", { weapon: "shield", ...opts });
        tick(world);
        return world;
      };

      it("leaves the target of a fighter that has one alone", () => {
        const world = reflected({ passive: true });
        expect(targetOf(world, "h1")).toBe("o");
        expect(targetOf(world, "h2")).toBe("h1"); // the holder had none and answers
      });

      it("is an ordinary contact without the passive flag: the arrow's owner switches to the holder", () => {
        const world = reflected({});
        expect(targetOf(world, "h1")).toBe("h2");
        expect(targetOf(world, "h2")).toBe("h1");
      });

      it("fills the target of a fighter that has none", () => {
        const world = trio();
        injector(world).block("b", "a", { weapon: "shield", passive: true });
        tick(world);
        expect(targetOf(world, "a")).toBe("b");
        expect(targetOf(world, "b")).toBe("a");
      });

      it("does not keep an existing pair in contact for the holder's target either way: it renews only the pair it names", () => {
        const world = makeWorld([
          { id: "h1", faction: "holy", at: [100, 100], weapon: null },
          { id: "h2", faction: "holy", at: [300, 100], weapon: null },
          { id: "o", faction: "plague", at: [500, 100], weapon: null },
        ]);
        noteContact(world, "h1", "o");
        const inj = injector(world);
        run(world, 100);
        inj.block("h2", "h1", { weapon: "shield", passive: true });
        tick(world);
        run(world, FORGET_TICKS - 100 - 1);
        expect(targetOf(world, "h1")).toBeNull(); // the block with h2 was no contact with o
        expect(targetOf(world, "o")).toBeNull();
        expect(targetOf(world, "h2")).toBe("h1");
      });
    });

    it("a block does not hurt", () => {
      const world = trio();
      const before = hpOf(world, "b");
      injector(world).block("b", "a");
      const log = tick(world);
      expect(log.landed).toHaveLength(0);
      expect(hpOf(world, "b")).toBe(before);
    });
  });

  describe("passive hits (a riposte, a reflected arrow) only give a target to a fighter that has none", () => {
    const PASSIVE: Array<[string, HitOpts]> = [
      ["a passive hit", { passive: true }],
      ["a reflected arrow", { projectile: "p1", weapon: "shield" }],
    ];

    it.each(PASSIVE)("%s by a fighter with a target leaves that target alone", (_name, opts) => {
      const world = oneTick([["b", "a", opts]], (w) => noteContact(w, "b", "c"));
      expect(targetOf(world, "b")).toBe("c");
      expect(targetOf(world, "a")).toBe("b"); // the one it hit has none, so it answers
    });

    it.each(PASSIVE)("%s by a fighter without a target gives it one", (_name, opts) => {
      const world = oneTick([["b", "a", opts]]);
      expect(targetOf(world, "b")).toBe("a");
      expect(targetOf(world, "a")).toBe("b");
    });

    it.each(PASSIVE)("%s on a fighter that has a target does not change it", (_name, opts) => {
      const world = oneTick([["b", "a", opts]], (w) => noteContact(w, "a", "c"));
      expect(targetOf(world, "a")).toBe("c");
    });

    it("an arrow that is not a reflection is an ordinary hit", () => {
      const world = oneTick([["b", "a", { projectile: "p1", weapon: "bow" }]], (w) => noteContact(w, "b", "c"));
      expect(targetOf(world, "b")).toBe("a");
    });
  });
});

describe("reach and engagement", () => {
  /** Fire with `weapon` at x = 100 and an empty-handed Holy `gap` to its right, already in contact. */
  const pair = (weapon: WeaponId | null, gap: number, walls: ReadonlyArray<readonly [number, number]> = []): World => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [100, 200], weapon },
      { id: "b", faction: "holy", at: [100 + gap, 200], weapon: null },
    ], walls);
    noteContact(world, "a", "b");
    return world;
  };

  it.each(WEAPON_IDS)("%s reaches engageRange(%s) centre to centre, and not a unit further", (weapon) => {
    const range = engageRange(weapon);
    for (const [gap, reached] of [[range - 1, true], [range, true], [range + 1, false]] as const) {
      const world = pair(weapon, gap);
      tick(world);
      const st = signatureState(world, "a")!;
      expect(st.inReach, `${weapon} at ${gap}`).toBe(reached);
      expect(st.engaged, `${weapon} at ${gap}`).toBe(reached);
    }
  });

  it("a fighter with an empty hand reaches nothing", () => {
    const world = pair(null, 20);
    tick(world);
    expect(signatureState(world, "a")!.inReach).toBe(false);
  });

  it("a wall between the two breaks the reach even inside the weapon's range", () => {
    // The wall tile (4, 6) spans x 128..160, y 192..224 and sits between x = 100 and x = 160.
    const walled = pair("sword", 60, [[4, 6]]);
    const open = pair("sword", 60);
    tick(walled);
    tick(open);
    expect(signatureState(open, "a")!.inReach).toBe(true);
    expect(signatureState(walled, "a")!.inReach).toBe(false);
    expect(signatureState(walled, "a")!.engaged).toBe(false);
  });

  it("stays engaged for ENGAGE_LINGER_SECONDS after the target leaves reach, then stops", () => {
    const world = pair("axe", 40);
    const inj = injector(world);
    const burnAmount = mitigated("fire", "holy", burnDps(SPEC.fire) * bonusMultiplier("axe") * DT);
    expect(sigTotal(tick(world), "burn")).toBeCloseTo(burnAmount, 9);

    place(world, "b", 300, 200); // 200 away: far beyond the axe
    for (let i = 1; i <= LINGER_TICKS; i++) {
      if (i === 3) inj.swing("b", "sword");
      const log = tick(world);
      const st = signatureState(world, "a")!;
      expect(st.inReach, `tick ${i}`).toBe(false);
      expect(st.engaged, `tick ${i}`).toBe(true);
      expect(sigTotal(log, "burn"), `tick ${i}`).toBeCloseTo(burnAmount, 9);
      expect(sigHits(log, "backlash"), `tick ${i}`).toHaveLength(i === 3 ? 1 : 0);
    }

    inj.swing("b", "sword");
    for (let i = 0; i < 4; i++) {
      const log = tick(world);
      expect(signatureState(world, "a")!.engaged).toBe(false);
      expect(sigHits(log, "burn")).toHaveLength(0);
      expect(sigHits(log, "backlash")).toHaveLength(0);
    }
  });
});

describe("engagement needs trading", () => {
  /** Fire with a sword and an empty-handed Holy 40 away: always in reach. Contact begins at the first tick. */
  const duel = (): World => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300], weapon: "sword" },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    return world;
  };
  const burning = (log: TickLog): boolean => sigHits(log, "burn").length > 0;

  it("one hit and then nobody swings: signatures run ENGAGE_TRADE_SECONDS, then stop though the pair is still in reach", () => {
    const world = duel();
    run(world, TRADE_TICKS).forEach((log, i) => expect(burning(log), `tick ${i + 1}`).toBe(true));
    runChecked(world, 10, (log) => {
      expect(burning(log)).toBe(false);
      const st = signatureState(world, "a")!;
      expect(st.inReach).toBe(true);
      expect(st.engaged).toBe(false);
    });
  });

  it.each([["a", "b"], ["b", "a"]] as const)("a hit by %s on %s renews it for another ENGAGE_TRADE_SECONDS", (by, victim) => {
    const world = duel();
    const inj = injector(world);
    run(world, 40);
    inj.hit(by, victim);
    const renewed = tick(world);
    expect(burning(renewed)).toBe(true);
    run(world, TRADE_TICKS).forEach((log, i) => expect(burning(log), `tick +${i + 1}`).toBe(true));
    expect(burning(tick(world))).toBe(false);
  });

  it.each([["b", "a"], ["a", "b"]] as const)("a shield block by %s of a swing by %s renews it, damage or not", (holder, attacker) => {
    const world = duel();
    const inj = injector(world);
    run(world, 40);
    inj.block(holder, attacker);
    expect(burning(tick(world))).toBe(true);
    run(world, TRADE_TICKS).forEach((log, i) => expect(burning(log), `tick +${i + 1}`).toBe(true));
    expect(burning(tick(world))).toBe(false);
  });

  it("a pair that keeps trading stays engaged indefinitely", () => {
    const world = duel();
    injector(world).trade("b", "a");
    for (const log of run(world, 200)) expect(burning(log)).toBe(true);
  });

  it("the mark's clock only runs while the pair is in reach and engaged", () => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    const inj = injector(world);
    noteContact(world, "s", "b");
    run(world, TRADE_TICKS);
    const stopped = signatureState(world, "s")!.markElapsed;
    expect(stopped).toBeCloseTo(TRADE_TICKS * DT, 9);
    runChecked(world, 20, (log) => {
      expect(sigTotal(log, "mark")).toBe(0);
      expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(stopped, 12);
      expect(signatureState(world, "s")!.inReach).toBe(true);
    });
    inj.hit("s", "b");
    tick(world);
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(stopped + DT, 12);
  });

  describe("the window follows the pair's cadence", () => {
    /** Every swing that lands hits the other fighter in the same tick (the harness's "trades" mode). */
    const autoTrade = (world: World, ids: readonly [string, string]): void => {
      world.afterWeapons.push(() => {
        for (const m of world.combat.melee) {
          recordHit(world, {
            victim: m.attacker === ids[0] ? ids[1] : ids[0], by: { id: m.attacker, name: m.attacker.toUpperCase() },
            packet: m.packet, weapon: m.weapon, stagger: false,
          });
        }
        world.combat.melee = [];
      });
    };
    const frostMirror = (): World => makeWorld([
      { id: "f1", faction: "frost", at: [300, 300], weapon: "axe" },
      { id: "f2", faction: "frost", at: [340, 300], weapon: "axe" },
    ]);
    const chilledInterval = attackInterval(SPEC.frost, "axe") / CHILL;

    it("two Frost axes trading on auto-repeat stay engaged and chilled on every tick, cycle after cycle", () => {
      expect(chilledInterval).toBeGreaterThan(ENGAGE_TRADE_SECONDS); // the gap between their hits outlasts the plain window
      const world = frostMirror();
      noteContact(world, "f1", "f2");
      autoTrade(world, ["f1", "f2"]);
      RT(world, "f1").inputs.pushAction({ kind: "attack", a: 0 });
      RT(world, "f2").inputs.pushAction({ kind: "attack", a: Math.PI });
      const hits = { f1: 0, f2: 0 };
      const cycles = 5;
      const ticks = Math.ceil((cycles * chilledInterval * 1000) / TICK_MS);
      runChecked(world, ticks, (log, i) => {
        for (const id of ["f1", "f2"] as const) {
          const st = signatureState(world, id)!;
          expect(st.engaged, `${id} tick ${i + 1}`).toBe(true);
          expect(st.chill, `${id} tick ${i + 1}`).toBeCloseTo(CHILL, 12);
          expect(P(world, id).sig & SIG_CHILLED, `${id} tick ${i + 1}`).toBe(SIG_CHILLED);
        }
        for (const h of log.landed) if (!h.sig && (h.by === "f1" || h.by === "f2")) hits[h.by]++;
      });
      expect(hits.f1).toBeGreaterThanOrEqual(cycles);
      expect(hits.f2).toBeGreaterThanOrEqual(cycles);
    });

    it("the same pair with no more hits lets go after the slower interval plus ENGAGE_TRADE_SLACK_SECONDS", () => {
      const window = Math.max(ENGAGE_TRADE_SECONDS, chilledInterval + ENGAGE_TRADE_SLACK_SECONDS) * 1000;
      expect(window).toBeGreaterThan(ENGAGE_TRADE_SECONDS * 1000);
      const lastEngaged = Math.floor((window + 1e-6) / TICK_MS); // contact begins one tick before tick 1
      const world = frostMirror();
      noteContact(world, "f1", "f2");
      for (let i = 1; i <= lastEngaged; i++) {
        tick(world);
        expect(signatureState(world, "f1")!.engaged, `tick ${i}`).toBe(true);
        expect(signatureState(world, "f2")!.engaged, `tick ${i}`).toBe(true);
      }
      tick(world);
      expect(signatureState(world, "f1")!.engaged).toBe(false);
      expect(signatureState(world, "f2")!.engaged).toBe(false);
      expect(signatureState(world, "f1")!.chill).toBe(1);
    });

    it("a fast pair (two Plague bows) still lets go ENGAGE_TRADE_SECONDS after the last hit", () => {
      expect(attackInterval(SPEC.plague, "bow") + ENGAGE_TRADE_SLACK_SECONDS).toBeLessThan(ENGAGE_TRADE_SECONDS);
      const world = makeWorld([
        { id: "p1", faction: "plague", at: [300, 300] },
        { id: "p2", faction: "plague", at: [340, 300] },
      ]);
      noteContact(world, "p1", "p2");
      runChecked(world, TRADE_TICKS, (log, i) => {
        expect(sigHits(log, "disease").map((h) => h.by).sort(), `tick ${i + 1}`).toEqual(["p1", "p2"]);
        expect(signatureState(world, "p1")!.engaged, `tick ${i + 1}`).toBe(true);
      });
      runChecked(world, 10, (log) => {
        expect(sigHits(log, "disease")).toHaveLength(0);
        expect(signatureState(world, "p1")!.engaged).toBe(false);
        expect(signatureState(world, "p1")!.inReach).toBe(true);
      });
    });
  });
});

describe("forgetting a target", () => {
  const apart = (): World => makeWorld([
    { id: "a", faction: "fire", at: [100, 100], weapon: null },
    { id: "b", faction: "holy", at: [300, 100], weapon: null },
    { id: "c", faction: "plague", at: [500, 100], weapon: null },
  ]);

  it("drops the target TARGET_FORGET_SECONDS after the last contact, on both sides", () => {
    const world = apart();
    injector(world).hit("a", "b");
    tick(world); // the hit: the last contact
    run(world, FORGET_TICKS - 1);
    expect(targetOf(world, "a")).toBe("b");
    expect(targetOf(world, "b")).toBe("a");
    run(world, 1);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "b")).toBeNull();
  });

  it.each([["a", "b"], ["b", "a"]] as const)("a hit by %s on %s is contact and restarts the wait", (by, victim) => {
    const world = apart();
    const inj = injector(world);
    inj.hit("a", "b");
    tick(world);
    run(world, 100);
    inj.hit(by, victim);
    tick(world);
    run(world, FORGET_TICKS - 1);
    expect(targetOf(world, "a")).toBe("b");
    expect(targetOf(world, "b")).toBe("a");
    run(world, 1);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "b")).toBeNull();
  });

  it("being in reach is not contact: a pair in reach with no hit forgets each other too", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [100, 200], weapon: "sword" },
      { id: "b", faction: "holy", at: [140, 200], weapon: "sword" },
    ]);
    noteContact(world, "a", "b");
    run(world, FORGET_TICKS - 1);
    expect(signatureState(world, "a")!.inReach).toBe(true);
    expect(targetOf(world, "a")).toBe("b");
    expect(targetOf(world, "b")).toBe("a");
    run(world, 1);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "b")).toBeNull();
  });

  it.each([["b", "a"], ["a", "b"]] as const)("a shield block by %s of a swing by %s is contact and restarts the wait", (holder, attacker) => {
    const world = apart();
    const inj = injector(world);
    inj.hit("a", "b");
    tick(world);
    run(world, 100);
    inj.block(holder, attacker);
    tick(world);
    run(world, FORGET_TICKS - 1);
    expect(targetOf(world, "a")).toBe("b");
    expect(targetOf(world, "b")).toBe("a");
    run(world, 1);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "b")).toBeNull();
  });

  it("a hit by a third fighter is not contact between the pair", () => {
    const world = apart();
    const inj = injector(world);
    inj.hit("a", "b");
    tick(world);
    run(world, 100);
    inj.hit("c", "b");
    run(world, FORGET_TICKS - 100);
    expect(targetOf(world, "b")).toBeNull();
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "c")).toBe("b");
  });
});

describe("a target that is gone", () => {
  const trio = (): World => makeWorld([
    { id: "a", faction: "fire", at: [100, 100], weapon: null },
    { id: "b", faction: "holy", at: [300, 100], weapon: null, hp: 10 },
    { id: "c", faction: "plague", at: [500, 100], weapon: null },
  ]);

  it("is cleared, with its record, once it has died", () => {
    const world = trio();
    noteContact(world, "a", "b");
    injector(world).hit("c", "b", { raw: 1000 });
    tick(world);
    expect(P(world, "b").status).toBe("dead");
    expect(world.state.phase).toBe("active");
    tick(world);
    expect(targetOf(world, "a")).toBeNull();
    expect(targetOf(world, "c")).toBeNull();
    expect(signatureState(world, "b")).toBeUndefined();
  });

  it("is cleared once it has left (removePlayer)", () => {
    const world = trio();
    noteContact(world, "a", "b");
    removePlayer(world, "b");
    tick(world);
    expect(targetOf(world, "a")).toBeNull();
    expect(signatureState(world, "b")).toBeUndefined();
  });
});

// ---- Fire ----

describe("Fire (dragonslayer)", () => {
  /** Fire with `weapon` 40 from an empty-handed `victim`, in contact. */
  const duel = (victim: FactionId = "holy", weapon: WeaponId = "axe"): World => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300], weapon },
      { id: "b", faction: victim, at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    return world;
  };

  it.each(["sentenced", "plague", "frost", "holy"] as const)(
    "burns a %s target burnDps x dpsMult x dt per tick, mitigated by its defense with Fire's shares",
    (victim) => {
      const world = duel(victim);
      const before = hpOf(world, "b");
      const expected = mitigated("fire", victim, burnDps(SPEC.fire) * bonusMultiplier("axe") * DT);
      for (const log of run(world, 4)) {
        const burns = sigHits(log, "burn");
        expect(burns).toHaveLength(1);
        expect(burns[0]).toMatchObject({ victim: "b", by: "a", weapon: "axe" });
        expect(burns[0]!.amount).toBeCloseTo(expected, 9);
      }
      expect(before - hpOf(world, "b")).toBeCloseTo(4 * expected, 6);
    },
  );

  it.each(WEAPON_IDS)("backlash for one swing of a %s by the target is backlashPerSwing x dpsMult, mitigated", (swung) => {
    const world = duel("holy");
    injector(world).swing("b", swung);
    const log = tick(world);
    const hits = sigHits(log, "backlash");
    expect(hits).toHaveLength(1);
    const raw = backlashPerSwing(SPEC.fire.params.backlash!, SPEC.holy, swung) * bonusMultiplier("axe");
    expect(hits[0]!.amount).toBeCloseTo(mitigated("fire", "holy", raw), 9);
    // Not damage over time: it is reported at once, as a hit fx on the swing.
    const fx = fxOf(log.events, "hit").filter((h) => h.sig === "backlash");
    expect(fx).toEqual([{ kind: "hit", id: "b", by: "a", amount: hits[0]!.amount, weapon: "axe", sig: "backlash" }]);
  });

  it("lands backlash once per attack the target performs, and none on a tick without one", () => {
    const world = duel("holy");
    const inj = injector(world);
    inj.swing("b", "sword");
    inj.swing("b", "sword");
    inj.swing("b", "axe");
    const busy = tick(world);
    const per = (w: WeaponId): number =>
      mitigated("fire", "holy", backlashPerSwing(SPEC.fire.params.backlash!, SPEC.holy, w) * bonusMultiplier("axe"));
    expect(sigHits(busy, "backlash")).toHaveLength(3);
    expect(sigTotal(busy, "backlash")).toBeCloseTo(2 * per("sword") + per("axe"), 9);
    expect(sigHits(tick(world), "backlash")).toHaveLength(0);
  });

  it("an attack by anyone but the engaged target feeds no backlash", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
      { id: "c", faction: "plague", at: [340, 340], weapon: null },
    ]);
    noteContact(world, "a", "b");
    injector(world).swing("c", "sword");
    expect(sigHits(tick(world), "backlash")).toHaveLength(0);
  });

  it("no backlash before the pair has any contact", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    injector(world).swing("b", "sword");
    const log = tick(world);
    expect(sigHits(log, "backlash")).toHaveLength(0);
    expect(sigHits(log, "burn")).toHaveLength(0);
  });

  it.each([
    ["wand", ["attack"]],
    ["bow", ["attack", "release"]],
  ] as const)("a %s shot leaving the target's weapon feeds backlash on the tick it leaves", (weapon, presses) => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon },
    ]);
    noteContact(world, "a", "b");
    for (const kind of presses) RT(world, "b").inputs.pushAction({ kind, a: Math.PI / 2 }); // aimed away from the Fire
    const seen: Array<{ backlash: LandedHit[]; spawned: boolean }> = [];
    for (let i = 0; i < 8; i++) {
      const before = world.state.projectiles.size;
      const log = tick(world);
      seen.push({ backlash: sigHits(log, "backlash"), spawned: world.state.projectiles.size > before });
    }
    const leftAt = seen.findIndex((s) => s.spawned);
    expect(leftAt).toBeGreaterThan(0);
    expect(seen.map((s) => s.backlash.length)).toEqual(seen.map((_, i) => (i === leftAt ? 1 : 0)));
    const raw = backlashPerSwing(SPEC.fire.params.backlash!, SPEC.holy, weapon) * bonusMultiplier("axe");
    expect(seen[leftAt]!.backlash[0]!.amount).toBeCloseTo(mitigated("fire", "holy", raw), 9);
  });
});

// ---- Plague ----

describe("Plague (rat king)", () => {
  const duel = (foeFrac: number): World => {
    const world = makeWorld([
      { id: "p", faction: "plague", at: [300, 300], weapon: "bow" },
      { id: "t", faction: "holy", at: [340, 300], weapon: null, hpFrac: foeFrac },
    ]);
    noteContact(world, "p", "t");
    return world;
  };
  const expectedDisease = (frac: number): number =>
    mitigated("plague", "holy", diseaseDps(SPEC.plague, frac) * bonusMultiplier("bow") * DT);

  it.each([1.0, 0.75, 0.5, 0.4, 0.1])(
    "at a target hp fraction of %s the disease per tick is diseaseDps(paced, fraction) x dpsMult x dt",
    (frac) => {
      const world = duel(frac);
      const hits = sigHits(tick(world), "disease");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ victim: "t", by: "p", weapon: "bow" });
      expect(hits[0]!.amount).toBeCloseTo(expectedDisease(frac), 9);
    },
  );

  it("the execute grows as the target falls below half hp", () => {
    const above = sigTotal(tick(duel(0.5)), "disease");
    const below = sigTotal(tick(duel(0.25)), "disease");
    const near = sigTotal(tick(duel(0.05)), "disease");
    expect(below).toBeGreaterThan(above * 5);
    expect(near).toBeGreaterThan(below);
  });

  it("the execute reads the hp fraction at the start of the tick, not after this tick's hits", () => {
    const world = duel(0.51);
    injector(world).hit("p", "t", { raw: 50_000 }); // 5% of max hp (Holy has no armor): below half by the end of the tick
    expect(sigTotal(tick(world), "disease")).toBeCloseTo(expectedDisease(0.51), 9);
    const frac = hpOf(world, "t") / BIG_HP;
    expect(frac).toBeLessThan(0.5);
    expect(sigTotal(tick(world), "disease")).toBeCloseTo(expectedDisease(frac), 9);
  });
});

// ---- Sentenced ----

describe("Sentenced (marked)", () => {
  /** A wall column at tile x = 9 (x 288..320) between the Sentenced and the far spot. */
  const WALL = column(9, 6, 13);
  const NEAR: readonly [number, number] = [240, 300];
  const HIDDEN: readonly [number, number] = [330, 300];

  const duel = (extra: Fighter[] = [], b: Partial<Fighter> = {}, walls: ReadonlyArray<readonly [number, number]> = []): World => {
    const world = makeWorld([
      { id: "s", faction: "sentenced", at: [200, 300] },
      { id: "b", faction: "holy", at: NEAR, weapon: null, ...b },
      ...extra,
    ], walls);
    noteContact(world, "s", "b");
    return world;
  };
  const expectedMark = (elapsed: number, weapon: WeaponId = "bow"): number =>
    mitigated("sentenced", "holy", markDps(SPEC.sentenced, elapsed) * bonusMultiplier(weapon) * DT);

  it("the mark per tick is markDps(paced, seconds in reach) x dpsMult x dt: nothing at first, a ramp, then the cap", () => {
    const world = duel();
    injector(world).trade("s", "b"); // keeps the pair engaged for the whole ramp
    run(world, 100).forEach((log, i) => {
      const elapsed = i * DT; // time in reach before this tick
      expect(sigTotal(log, "mark"), `tick ${i + 1}`).toBeCloseTo(expectedMark(elapsed), 9);
      for (const h of sigHits(log, "mark")) expect(h).toMatchObject({ victim: "b", by: "s", weapon: "bow" });
    });
    // By now the ramp has reached the cap: the damage no longer grows.
    expect(SPEC.sentenced.params.mark_ramp! * 99 * DT).toBeGreaterThan(SPEC.sentenced.params.mark_cap!);
    const [x, y] = [tick(world), tick(world)];
    expect(sigTotal(x, "mark")).toBeCloseTo(sigTotal(y, "mark"), 12);
    expect(sigTotal(y, "mark")).toBeCloseTo(
      mitigated("sentenced", "holy", SPEC.sentenced.params.mark_cap! * bonusMultiplier("bow") * DT), 9,
    );
  });

  it("freezes while the target is out of reach and resumes from where it stopped", () => {
    const world = duel([], {}, WALL);
    run(world, 20);
    const frozen = signatureState(world, "s")!.markElapsed;
    expect(frozen).toBeCloseTo(20 * DT, 9);

    place(world, "b", ...HIDDEN);
    for (let i = 1; i <= 30; i++) {
      const log = tick(world);
      const st = signatureState(world, "s")!;
      expect(st.inReach, `hidden tick ${i}`).toBe(false);
      expect(st.markElapsed, `hidden tick ${i}`).toBeCloseTo(frozen, 12);
      // The linger keeps the mark running, at the value it froze at.
      expect(sigTotal(log, "mark"), `hidden tick ${i}`).toBeCloseTo(i <= LINGER_TICKS ? expectedMark(frozen) : 0, 9);
    }

    place(world, "b", ...NEAR);
    const back = tick(world);
    expect(sigTotal(back, "mark")).toBeCloseTo(expectedMark(frozen), 9);
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(frozen + DT, 12);
  });

  it("restarts at 0 when the target swaps its weapon", () => {
    const world = duel([], { weapon: "sword", weapon1: "axe" });
    run(world, 20);
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(1, 9);
    RT(world, "b").inputs.pushAction({ kind: "swap" });
    const swapTick = tick(world);
    expect(P(world, "b").weapon0).toBe("sword");
    expect(P(world, "b").slot).toBe(1);
    expect(sigTotal(swapTick, "mark")).toBe(0);
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(DT, 12);
    expect(sigTotal(tick(world), "mark")).toBeCloseTo(expectedMark(DT), 9);
  });

  it("restarts at 0 when the weaponSwapped hook fires for the target", () => {
    const world = duel();
    run(world, 20);
    world.hooks.weaponSwapped!(world, C(world, "b"));
    expect(signatureState(world, "s")!.markElapsed).toBe(0);
    expect(targetOf(world, "s")).toBe("b");
  });

  it("keeps running when someone other than the target swaps", () => {
    const world = duel([{ id: "c", faction: "plague", at: [600, 600], weapon: "sword", weapon1: "axe" }]);
    run(world, 20);
    RT(world, "c").inputs.pushAction({ kind: "swap" });
    tick(world);
    expect(P(world, "c").slot).toBe(1);
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(21 * DT, 9);
  });

  it("keeps ramping when it hits the same target again", () => {
    const world = duel();
    const inj = injector(world);
    run(world, 20);
    inj.hit("s", "b");
    tick(world);
    expect(targetOf(world, "s")).toBe("b");
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(21 * DT, 9);
  });

  it("restarts at 0 on a target switch, and does not resume if it goes back", () => {
    const world = duel([{ id: "c", faction: "plague", at: [700, 300], weapon: null }]);
    const inj = injector(world);
    run(world, 20);
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(1, 9);

    inj.hit("s", "c"); // 500 away: beyond the bow
    tick(world);
    expect(targetOf(world, "s")).toBe("c");
    expect(signatureState(world, "s")!.markElapsed).toBe(0);

    inj.hit("s", "b");
    const back = tick(world);
    expect(targetOf(world, "s")).toBe("b");
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(DT, 12);
    expect(sigTotal(back, "mark")).toBe(0);
  });

  it("restarts at 0 after TARGET_FORGET_SECONDS without a hit or block", () => {
    const world = duel([], {}, WALL);
    const inj = injector(world);
    inj.trade("s", "b");
    run(world, 20); // the last hit is the 20th tick's
    inj.stopTrading();
    place(world, "b", ...HIDDEN);
    run(world, FORGET_TICKS - 1);
    expect(targetOf(world, "s")).toBe("b");
    expect(signatureState(world, "s")!.markElapsed).toBeCloseTo(1, 9);

    run(world, 1);
    expect(targetOf(world, "s")).toBeNull();
    expect(signatureState(world, "s")?.markElapsed ?? 0).toBe(0);

    place(world, "b", ...NEAR);
    for (const log of run(world, 5)) expect(sigHits(log, "mark")).toHaveLength(0);

    inj.hit("s", "b");
    expect(sigTotal(tick(world), "mark")).toBe(0);
    expect(sigTotal(tick(world), "mark")).toBeCloseTo(expectedMark(DT), 9);
  });

  it.each([[20, 25], [40, 50], [60, 75], [100, 100]])(
    "the target's brand after %d ticks in reach is %d percent: round(markShare x 20) x 5",
    (ticks, percent) => {
      const world = duel();
      injector(world).trade("s", "b");
      run(world, ticks);
      expect(Math.round(markShare(SPEC.sentenced, ticks * DT) * 20) * 5).toBe(percent);
      expect(P(world, "b").brand).toBe(percent);
      expect(P(world, "s").brand).toBe(0);
    },
  );

  it("the brand stays while the target hides and goes with the target", () => {
    const world = duel([], {}, WALL);
    const inj = injector(world);
    inj.trade("s", "b");
    run(world, 40);
    expect(P(world, "b").brand).toBe(50);
    inj.stopTrading();
    place(world, "b", ...HIDDEN);
    run(world, FORGET_TICKS - 1);
    expect(P(world, "b").brand).toBe(50);
    run(world, 1);
    expect(P(world, "b").brand).toBe(0);
  });

  it("only a Sentenced brands: the same fight with a Fire leaves no brand", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [200, 300] },
      { id: "b", faction: "holy", at: NEAR, weapon: null },
    ]);
    noteContact(world, "a", "b");
    run(world, 40);
    expect(P(world, "b").brand).toBe(0);
  });
});

// ---- Frost ----

describe("Frost (wall of ice)", () => {
  /** A Frost with a shield (reach 56) and a Holy 40 away with a wand (reach 434), in contact. */
  const pair = (b: Partial<Fighter> = {}): World => {
    const world = makeWorld([
      { id: "f", faction: "frost", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: "wand", ...b },
    ]);
    noteContact(world, "f", "b");
    return world;
  };
  const chillOf = (world: World, id: string): number => signatureState(world, id)!.chill;
  const chilled = (world: World, id: string): boolean => (P(world, id).sig & SIG_CHILLED) !== 0;

  it("chills Frost's own engaged target, and only that side", () => {
    const world = pair({ weapon: null });
    tick(world);
    expect(chillOf(world, "b")).toBeCloseTo(CHILL, 12);
    expect(chilled(world, "b")).toBe(true);
    expect(chillOf(world, "f")).toBe(1);
    expect(chilled(world, "f")).toBe(false);
  });

  it("chills a fighter whose engaged target is a Frost even when the Frost cannot reach it", () => {
    const world = pair({ at: [500, 300] }); // 200 apart: past the shield, inside the wand
    tick(world);
    expect(signatureState(world, "f")!.inReach).toBe(false);
    expect(signatureState(world, "b")!.inReach).toBe(true);
    expect(chillOf(world, "b")).toBeCloseTo(CHILL, 12);
    expect(chillOf(world, "f")).toBe(1);
  });

  it("chills nobody when neither is engaged with the Frost", () => {
    const world = pair({ at: [700, 700] });
    tick(world);
    expect(chillOf(world, "b")).toBe(1);
    expect(chilled(world, "b")).toBe(false);
  });

  it("does not chill a bystander who is next to the Frost but engaged with no one", () => {
    const world = makeWorld([
      { id: "f", faction: "frost", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
      { id: "c", faction: "holy", at: [300, 330], weapon: "wand" },
    ]);
    noteContact(world, "f", "b");
    tick(world);
    expect(chillOf(world, "b")).toBeCloseTo(CHILL, 12);
    expect(chillOf(world, "c")).toBe(1);
    expect(chilled(world, "c")).toBe(false);
  });

  it("lasts through the engagement linger and ends after it", () => {
    const world = pair();
    tick(world);
    place(world, "b", 700, 700); // 565 away: out of both reaches
    for (let i = 1; i <= LINGER_TICKS; i++) {
      tick(world);
      expect(chillOf(world, "b"), `tick ${i}`).toBeCloseTo(CHILL, 12);
    }
    tick(world);
    expect(chillOf(world, "b")).toBe(1);
    expect(chilled(world, "b")).toBe(false);
  });

  it("stretches a cooldown that has time left: its end moves back by (1 - m) x a tick each tick", () => {
    const world = pair();
    const next = world.state.serverTime + TICK_MS;
    P(world, "b").readyAt = next + 10_000;
    run(world, 3);
    expect(P(world, "b").readyAt).toBeCloseTo(next + 10_000 + 3 * (1 - CHILL) * TICK_MS, 9);
  });

  it("lets a nearly spent cooldown finish at now + left / m inside the tick", () => {
    const world = pair();
    const next = world.state.serverTime + TICK_MS;
    P(world, "b").readyAt = next + 5; // less than m x a tick of work left
    tick(world);
    expect(P(world, "b").readyAt).toBeCloseTo(next + 5 / CHILL, 9);
  });

  it("leaves an unchilled cooldown alone", () => {
    const world = pair({ at: [700, 700] });
    const next = world.state.serverTime + TICK_MS;
    P(world, "b").readyAt = next + 10_000;
    run(world, 3);
    expect(P(world, "b").readyAt).toBe(next + 10_000);
  });

  it("stretches the ranged recovery along with the cooldown", () => {
    const world = pair();
    const next = world.state.serverTime + TICK_MS;
    RT(world, "b").weapon.recoverUntil = next + 10_000;
    run(world, 2);
    expect(RT(world, "b").weapon.recoverUntil).toBeCloseTo(next + 10_000 + 2 * (1 - CHILL) * TICK_MS, 9);
  });

  it("stretches the press buffer along with the cooldown", () => {
    const world = pair();
    const next = world.state.serverTime + TICK_MS;
    P(world, "b").readyAt = next + 60_000; // not ready: the buffered press waits
    RT(world, "b").weapon.bufferedUntil = next + 10_000;
    run(world, 2);
    expect(RT(world, "b").weapon.bufferedUntil).toBeCloseTo(next + 10_000 + 2 * (1 - CHILL) * TICK_MS, 9);
  });

  describe("an attack started this tick from a carried remainder", () => {
    /**
     * The cooldown ended 30 ms into the past while the trigger was already down, so the wand attack starts at that
     * moment: its first 30 ms went by at full speed, but they belong to the tick that was chilled.
     */
    const carried = (staggered: boolean): { world: World; start: number; readyAt: number } => {
      const world = pair();
      const inj = injector(world);
      tick(world); // the chill is now in place for the next tick
      const next = world.state.serverTime + TICK_MS;
      const w = RT(world, "b").weapon;
      w.held = true;
      w.pressedAt = 0;
      w.aim = Math.PI / 2;
      P(world, "b").readyAt = next - 30;
      if (staggered) inj.hit("f", "b", { stagger: true });
      tick(world);
      return { world, start: next - 30, readyAt: P(world, "b").readyAt };
    };
    const interval = attackInterval(SPEC.holy, "wand") * 1000;

    it("has the chill of those 30 ms taken back off the cooldown it starts", () => {
      const { world, start, readyAt } = carried(false);
      expect(RT(world, "b").weapon.action?.startedAt).toBe(start);
      // start + interval, + (1 - m) x 30 ms of correction, + (1 - m) x the coming tick.
      expect(readyAt).toBeCloseTo(start + interval + (1 - CHILL) * 30 + (1 - CHILL) * TICK_MS, 9);
    });

    it("keeps that correction when a stagger cancels the attack in the same tick", () => {
      const { world, start, readyAt } = carried(true);
      expect(RT(world, "b").weapon.action).toBeNull();
      expect(readyAt).toBeCloseTo(start + interval + (1 - CHILL) * 30 + (1 - CHILL) * TICK_MS, 9);
    });
  });

  it("slows a bow draw: it starts later by (1 - m) x a tick each tick", () => {
    const world = pair({ weapon: "bow" });
    const startedAt = world.state.serverTime - 100;
    RT(world, "b").weapon.action = { kind: "draw", weapon: "bow", startedAt };
    P(world, "b").drawStartedAt = startedAt;
    for (let i = 1; i <= 3; i++) {
      tick(world);
      const expected = startedAt + i * (1 - CHILL) * TICK_MS;
      const action = RT(world, "b").weapon.action;
      expect(action?.kind).toBe("draw");
      expect(action!.startedAt, `tick ${i}`).toBeCloseTo(expected, 9);
      expect(P(world, "b").drawStartedAt, `tick ${i}`).toBeCloseTo(expected, 9);
    }
  });

  it("does not stack: a fighter engaged with two Frosts is slowed to 0.4, not 0.16", () => {
    const world = makeWorld([
      { id: "f1", faction: "frost", at: [300, 300] },
      { id: "f2", faction: "frost", at: [380, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: "wand" },
    ]);
    noteContact(world, "f1", "b");
    noteContact(world, "f2", "b");
    const next = world.state.serverTime + TICK_MS;
    P(world, "b").readyAt = next + 10_000;
    tick(world);
    const st = signatureState(world, "b")!;
    expect([...st.chillers].sort()).toEqual(["f1", "f2"]);
    expect(st.chill).toBeCloseTo(CHILL, 12);
    expect(P(world, "b").readyAt).toBeCloseTo(next + 10_000 + (1 - CHILL) * TICK_MS, 9);
  });

  it("two Frosts fighting chill each other at 0.4, not 0.16", () => {
    const world = makeWorld([
      { id: "f1", faction: "frost", at: [300, 300] },
      { id: "f2", faction: "frost", at: [340, 300] },
    ]);
    noteContact(world, "f1", "f2");
    const next = world.state.serverTime + TICK_MS;
    P(world, "f1").readyAt = next + 10_000;
    tick(world);
    expect(chillOf(world, "f1")).toBeCloseTo(CHILL, 12);
    expect(chillOf(world, "f2")).toBeCloseTo(CHILL, 12);
    expect(P(world, "f1").readyAt).toBeCloseTo(next + 10_000 + (1 - CHILL) * TICK_MS, 9);
  });

  describe("movement", () => {
    /** Tick 1 puts the chill in place; the walk of tick 2 is then measured with `b` `dist` from the Frost. */
    const walkAt = (dist: number): number => {
      const world = pair();
      tick(world);
      place(world, "b", 300 + dist, 300);
      RT(world, "b").path = [{ x: 700, y: 300 }];
      tick(world);
      return P(world, "b").x - (300 + dist);
    };

    it("a chilled fighter within CHILL_MOVE_RADIUS of the Frost walks at the chill multiplier", () => {
      expect(CHILL_MOVE_MULT).toBe(0.7);
      expect(walkAt(60)).toBeCloseTo(PLAYER_SPEED * DT * CHILL_MOVE_MULT, 9);
      expect(walkAt(CHILL_MOVE_RADIUS)).toBeCloseTo(PLAYER_SPEED * DT * CHILL_MOVE_MULT, 9);
    });

    it("beyond CHILL_MOVE_RADIUS it walks at full speed (it is still chilled)", () => {
      expect(walkAt(CHILL_MOVE_RADIUS + 0.5)).toBeCloseTo(PLAYER_SPEED * DT, 9);
      expect(walkAt(250)).toBeCloseTo(PLAYER_SPEED * DT, 9);
    });

    it.each([["frost first", ["f", "b"]], ["chilled first", ["b", "f"]]] as const)(
      "the slow does not depend on who moves first (%s): a Frost walking away does not free the fighter it chills",
      (_name, joinOrder) => {
        const fighters: Record<string, Fighter> = {
          f: { id: "f", faction: "frost", at: [300, 300] },
          b: { id: "b", faction: "holy", at: [340, 300], weapon: "wand" },
        };
        const world = makeWorld(joinOrder.map((id) => fighters[id]!));
        noteContact(world, "f", "b");
        tick(world); // the chill is in place for the next tick
        // 99 apart before the tick, 107.5 apart after the Frost has walked away from it.
        place(world, "f", 300, 300);
        place(world, "b", 399, 300);
        RT(world, "f").path = [{ x: 100, y: 300 }];
        RT(world, "b").path = [{ x: 700, y: 300 }];
        tick(world);
        expect(P(world, "b").x - 399).toBeCloseTo(PLAYER_SPEED * DT * CHILL_MOVE_MULT, 9);
        expect(300 - P(world, "f").x).toBeCloseTo(PLAYER_SPEED * DT, 9);
      },
    );

    it("an unchilled fighter walks at full speed next to a Frost", () => {
      const world = makeWorld([
        { id: "f", faction: "frost", at: [300, 300] },
        { id: "b", faction: "holy", at: [340, 300], weapon: "wand" },
      ]); // no contact: nobody is engaged
      tick(world);
      RT(world, "b").path = [{ x: 700, y: 300 }];
      tick(world);
      expect(P(world, "b").x - 340).toBeCloseTo(PLAYER_SPEED * DT, 9);
    });
  });

  describe("cadence", () => {
    /** Server times the wand user's attacks began, holding the trigger aimed away from `other`. */
    const attackStarts = (other: FactionId): number[] => {
      const world = makeWorld([
        { id: "x", faction: other, at: [300, 300], weapon: other === "frost" ? "shield" : null },
        { id: "w", faction: "holy", at: [340, 300], weapon: "wand" },
      ]);
      noteContact(world, "x", "w");
      injector(world).trade("x", "w"); // eight seconds of cadence: the pair has to keep trading to stay engaged
      RT(world, "w").inputs.pushAction({ kind: "attack", a: Math.PI / 2 });
      const starts: number[] = [];
      let last: object | null = null;
      for (let i = 0; i < 400 && starts.length < 6; i++) {
        tick(world);
        const action = RT(world, "w").weapon.action;
        if (action && action !== last) {
          starts.push(action.startedAt);
          last = action;
        }
      }
      expect(starts).toHaveLength(6);
      return starts;
    };
    const interval = attackInterval(SPEC.holy, "wand") * 1000;

    it("an unchilled wand user attacks every attackInterval", () => {
      const starts = attackStarts("holy");
      expect(Math.abs(starts[5]! - starts[0]! - 5 * interval)).toBeLessThanOrEqual(TICK_MS);
    });

    it("a chilled wand user holding its trigger attacks every interval / m, to within a tick over five cycles", () => {
      const starts = attackStarts("frost");
      expect(Math.abs(starts[5]! - starts[0]! - 5 * (interval / CHILL))).toBeLessThanOrEqual(TICK_MS);
      for (let i = 1; i < starts.length; i++) {
        expect(Math.abs(starts[i]! - starts[i - 1]! - interval / CHILL), `cycle ${i}`).toBeLessThanOrEqual(TICK_MS);
      }
    });
  });
});

// ---- Holy ----

describe("Holy (radiant)", () => {
  /** A Holy with a wand and a target far away, so only the injected hits make contact. */
  const apart = (h: Partial<Fighter> = {}, victim: FactionId = "plague"): World => makeWorld([
    { id: "h", faction: "holy", at: [100, 100], weapon: "wand", ...h },
    { id: "t", faction: victim, at: [700, 700], weapon: null },
  ]);
  const wandRaw = (world: World): number => packetFor(C(world, "h"), "wand").raw;
  const dealtTo = (victim: FactionId, raw: number): number => mitigated("holy", victim, raw);
  const healFx = (log: TickLog) => fxOf(log.events, "heal");

  it.each([0.8, 0.5, 0.2])(
    "at %s of its max hp it heals lifestealFraction(paced, that fraction) of the damage it landed, and emits a heal fx",
    (frac) => {
      const world = apart({ hpFrac: frac });
      injector(world).hit("h", "t", { raw: wandRaw(world), weapon: "wand" });
      const log = tick(world);
      const dealt = dealtTo("plague", wandRaw(world));
      const healed = dealt * lifestealFraction(SPEC.holy, frac);
      expect(sigTotal(log, "burn")).toBe(0);
      expect(hpOf(world, "h")).toBeCloseTo(BIG_HP * frac + healed, 6);
      const fx = healFx(log);
      expect(fx).toHaveLength(1);
      expect(fx[0]!.id).toBe("h");
      expect(fx[0]!.amount).toBeCloseTo(healed, 9);
    },
  );

  it("at full hp it gains nothing and emits no heal fx", () => {
    const world = apart({ hpFrac: 1 });
    injector(world).hit("h", "t", { raw: wandRaw(world), weapon: "wand" });
    const log = tick(world);
    expect(hpOf(world, "h")).toBe(BIG_HP);
    expect(healFx(log)).toHaveLength(0);
  });

  it("never heals above max hp, and the fx carries what was gained", () => {
    const world = apart({ hp: FACTIONS.holy.hp - 3 });
    injector(world).hit("h", "t", { raw: wandRaw(world), weapon: "wand" });
    const log = tick(world);
    expect(dealtTo("plague", wandRaw(world)) * lifestealFraction(SPEC.holy, (FACTIONS.holy.hp - 3) / FACTIONS.holy.hp)).toBeGreaterThan(3);
    expect(hpOf(world, "h")).toBe(FACTIONS.holy.hp);
    expect(healFx(log).map((f) => f.amount)).toEqual([3]);
  });

  it("reads its hp fraction at the start of the tick, not after the hits it takes in that tick", () => {
    const world = apart({ hpFrac: 0.8 });
    const inj = injector(world);
    inj.hit("h", "t", { raw: wandRaw(world), weapon: "wand" });
    inj.hit("t", "h", { raw: BIG_HP / 2 }); // Holy has no armor: 0.8 -> 0.3 within the tick
    tick(world);
    const healed = dealtTo("plague", wandRaw(world)) * lifestealFraction(SPEC.holy, 0.8);
    expect(hpOf(world, "h")).toBeCloseTo(BIG_HP * 0.3 + healed, 6);
  });

  it("heals from all the damage it lands on anyone in a tick, as one heal", () => {
    const world = makeWorld([
      { id: "h", faction: "holy", at: [100, 100], weapon: "wand", hpFrac: 0.8 },
      { id: "t1", faction: "plague", at: [700, 700], weapon: null },
      { id: "t2", faction: "frost", at: [700, 100], weapon: null },
    ]);
    const raw = wandRaw(world);
    const inj = injector(world);
    inj.hit("h", "t1", { raw, weapon: "wand" });
    inj.hit("h", "t2", { raw, weapon: "wand" });
    const log = tick(world);
    const healed = (dealtTo("plague", raw) + dealtTo("frost", raw)) * lifestealFraction(SPEC.holy, 0.8);
    expect(healFx(log)).toHaveLength(1);
    expect(healFx(log)[0]!.amount).toBeCloseTo(healed, 9);
    expect(hpOf(world, "h")).toBeCloseTo(BIG_HP * 0.8 + healed, 6);
  });

  it.each(["fire", "sentenced", "plague", "frost"] as const)("%s does not heal from the damage it lands", (faction) => {
    const half = FACTIONS[faction].hp / 2;
    const world = makeWorld([
      { id: "x", faction, at: [100, 100], hp: half },
      { id: "t", faction: "holy", at: [700, 700], weapon: null },
    ]);
    injector(world).hit("x", "t", { raw: 100 });
    const log = tick(world);
    expect(hpOf(world, "x")).toBe(half);
    expect(fxOf(log.events, "heal")).toHaveLength(0);
  });

  it("its lifesteal is exempt from the lockout it has itself just started", () => {
    const world = apart({ hpFrac: 0.5 });
    injector(world).hit("h", "t", { raw: wandRaw(world), weapon: "wand" });
    const log = tick(world);
    expect(healFx(log)).toHaveLength(1);
    expect(heal(world, C(world, "h"), 5)).toBe(0); // a plain heal in the same moment is refused
  });

  describe("heal() and the combat lockout", () => {
    interface Fight { world: World; lastCombat: number }
    const holies = (): World => makeWorld([
      { id: "h", faction: "holy", at: [100, 100], weapon: "wand" },
      { id: "t", faction: "holy", at: [700, 700], weapon: "wand" },
    ]);
    /** Each builds a world, makes the last combat happen, and returns the server time of that combat's last tick. */
    const SCENARIOS: Array<[string, () => Fight]> = [
      ["dealing damage", () => {
        const world = holies();
        injector(world).hit("h", "t");
        tick(world);
        return { world, lastCombat: world.state.serverTime };
      }],
      ["taking damage", () => {
        const world = holies();
        injector(world).hit("t", "h");
        tick(world);
        return { world, lastCombat: world.state.serverTime };
      }],
      ["damage over time, to the end of the linger", () => {
        const world = makeWorld([
          { id: "h", faction: "fire", at: [300, 300], weapon: "axe" },
          { id: "t", faction: "holy", at: [340, 300], weapon: null },
        ]);
        noteContact(world, "h", "t");
        run(world, 10);
        const lastInReach = world.state.serverTime;
        place(world, "t", 700, 700);
        return { world, lastCombat: lastInReach + ENGAGE_LINGER_SECONDS * 1000 };
      }],
    ];

    it.each(SCENARIOS)("is refused for HEAL_LOCKOUT_SECONDS after %s, then works", (_name, fight) => {
      const { world, lastCombat } = fight();
      for (const id of ["h", "t"]) P(world, id).hp = BIG_HP / 2;

      runUntil(world, lastCombat + HEAL_LOCKOUT_SECONDS * 1000 - TICK_MS);
      for (const id of ["h", "t"]) {
        world.events = [];
        const before = hpOf(world, id); // a burning fighter has lost some meanwhile
        expect(heal(world, C(world, id), 10), `${id} inside the lockout`).toBe(0);
        expect(hpOf(world, id)).toBe(before);
        expect(fxOf(world.events, "heal")).toHaveLength(0);
      }

      tick(world);
      expect(world.state.serverTime).toBe(lastCombat + HEAL_LOCKOUT_SECONDS * 1000);
      for (const id of ["h", "t"]) {
        world.events = [];
        const before = hpOf(world, id);
        expect(heal(world, C(world, id), 10), `${id} after the lockout`).toBe(10);
        expect(hpOf(world, id)).toBe(before + 10);
        expect(fxOf(world.events, "heal")).toEqual([{ kind: "heal", id, amount: 10 }]);
      }
    });

    it("being engaged is not combat: a pair in contact and in reach, trading no damage, can heal", () => {
      const world = holies();
      place(world, "t", 140, 100); // 40 from the wand
      noteContact(world, "h", "t");
      run(world, 10);
      expect(signatureState(world, "h")!.engaged).toBe(true);
      for (const id of ["h", "t"]) {
        P(world, id).hp = BIG_HP / 2;
        expect(heal(world, C(world, id), 10), id).toBe(10);
      }
    });

    it("the teleport keeps the lockout clock running", () => {
      const world = holies();
      injector(world).hit("h", "t");
      tick(world);
      const lastCombat = world.state.serverTime;
      for (const id of ["h", "t"]) P(world, id).hp = BIG_HP / 2;
      teleportToColiseum(world);
      for (const id of ["h", "t"]) expect(heal(world, C(world, id), 10), `${id} right after the teleport`).toBe(0);
      runUntil(world, lastCombat + HEAL_LOCKOUT_SECONDS * 1000 - TICK_MS);
      for (const id of ["h", "t"]) expect(heal(world, C(world, id), 10), `${id} just before the end`).toBe(0);
      tick(world);
      for (const id of ["h", "t"]) expect(heal(world, C(world, id), 10), `${id} after the lockout`).toBe(10);
    });

    it("heals a fighter that has not fought, never past max hp", () => {
      const world = holies();
      P(world, "h").maxHp = 1000;
      P(world, "h").hp = 996;
      expect(heal(world, C(world, "h"), 10)).toBe(4);
      expect(hpOf(world, "h")).toBe(1000);
    });

    it("ignores a heal of nothing, and one on a fighter who is no longer standing", () => {
      const world = holies();
      P(world, "h").hp = 10;
      expect(heal(world, C(world, "h"), 0)).toBe(0);
      expect(heal(world, C(world, "h"), -5)).toBe(0);
      P(world, "t").hp = 10;
      P(world, "t").status = "dead";
      expect(heal(world, C(world, "t"), 5)).toBe(0);
      expect(hpOf(world, "t")).toBe(10);
    });
  });
});

// ---- damage over time reports ----

describe("damage over time", () => {
  const fireDuel = (): World => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    return world;
  };

  it("lands every tick but reports one hit fx per DOT_FX_MS with the summed amount and the sig", () => {
    const world = fireDuel();
    const every = DOT_FX_MS / TICK_MS;
    let window = 0;
    let last = -1;
    let reports = 0;
    run(world, 35).forEach((log, i) => {
      window += sigTotal(log, "burn");
      expect(sigHits(log, "burn")).toHaveLength(1);
      const fx = fxOf(log.events, "hit").filter((h) => h.sig === "burn");
      if (fx.length === 0) return;
      reports++;
      expect(fx).toHaveLength(1);
      expect(fx[0]).toMatchObject({ id: "b", by: "a", weapon: "axe", sig: "burn" });
      expect(fx[0]!.amount).toBeCloseTo(window, 9);
      expect(i - last, `report at tick ${i + 1}`).toBe(every);
      window = 0;
      last = i;
    });
    expect(reports).toBe(3);
  });

  it.each<[string, () => World, SignatureKind]>([
    ["burn", fireDuel, "burn"],
    ["disease", () => {
      const world = makeWorld([
        { id: "a", faction: "plague", at: [300, 300] },
        { id: "b", faction: "holy", at: [340, 300], weapon: null },
      ]);
      noteContact(world, "a", "b");
      return world;
    }, "disease"],
    ["mark", () => {
      const world = makeWorld([
        { id: "a", faction: "sentenced", at: [300, 300] },
        { id: "b", faction: "holy", at: [340, 300], weapon: null },
      ]);
      noteContact(world, "a", "b");
      return world;
    }, "mark"],
  ])("%s emits no hit fx of its own in the ticks between reports", (_name, build, sig) => {
    const world = build();
    const every = DOT_FX_MS / TICK_MS;
    const logs = run(world, every);
    expect(logs.slice(0, every - 1).flatMap((l) => fxOf(l.events, "hit").filter((h) => h.sig === sig))).toHaveLength(0);
    const report = fxOf(logs[every - 1]!.events, "hit").filter((h) => h.sig === sig);
    expect(report).toHaveLength(1);
    expect(report[0]!.amount).toBeCloseTo(sum(logs.map((l) => sigTotal(l, sig))), 9);
    expect(sum(logs.map((l) => sigTotal(l, sig)))).toBeGreaterThan(0);
  });

  it("reports each attacker and victim pair on its own", () => {
    const world = makeWorld([
      { id: "a1", faction: "fire", at: [300, 300] },
      { id: "a2", faction: "fire", at: [300, 340], weapon: "sword" },
      { id: "b", faction: "holy", at: [330, 320], weapon: null },
    ]);
    noteContact(world, "a1", "b");
    noteContact(world, "a2", "b");
    const logs = run(world, DOT_FX_MS / TICK_MS);
    const report = fxOf(logs.at(-1)!.events, "hit").filter((h) => h.sig === "burn");
    expect(report.map((h) => h.by).sort()).toEqual(["a1", "a2"]);
    const burn = (weapon: WeaponId): number => mitigated("fire", "holy", burnDps(SPEC.fire) * bonusMultiplier(weapon) * DT);
    const byA1 = report.find((h) => h.by === "a1")!;
    const byA2 = report.find((h) => h.by === "a2")!;
    expect(byA1.amount).toBeCloseTo(10 * burn("axe"), 9);
    expect(byA2.amount).toBeCloseTo(10 * burn("sword"), 9);
  });
});

// ---- the synced bits ----

describe("synced sig bits", () => {
  const sigOfFighter = (world: World, id: string): number => P(world, id).sig;

  it("SIG_BURNING marks the target of an engaged Fire, and the Fire itself is clean", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    tick(world);
    expect(sigOfFighter(world, "b")).toBe(SIG_BURNING);
    expect(sigOfFighter(world, "a")).toBe(0);
  });

  it("SIG_BURNING ends with the engagement (after the linger)", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    tick(world);
    place(world, "b", 700, 700);
    run(world, LINGER_TICKS);
    expect(sigOfFighter(world, "b")).toBe(SIG_BURNING);
    tick(world);
    expect(sigOfFighter(world, "b")).toBe(0);
  });

  it.each([[0.9, SIG_DISEASED], [0.6, SIG_DISEASED], [0.45, SIG_DISEASED | SIG_EXECUTE], [0.1, SIG_DISEASED | SIG_EXECUTE]])(
    "an engaged Plague on a target at %s of its hp sets bits %i",
    (frac, bits) => {
      const world = makeWorld([
        { id: "p", faction: "plague", at: [300, 300] },
        { id: "t", faction: "holy", at: [340, 300], weapon: null, hpFrac: frac },
      ]);
      noteContact(world, "p", "t");
      tick(world);
      expect(sigOfFighter(world, "t")).toBe(bits);
      expect(sigOfFighter(world, "p")).toBe(0);
    },
  );

  it("Fire against Frost: the Frost burns, the Fire is chilled", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "f", faction: "frost", at: [340, 300] },
    ]);
    noteContact(world, "a", "f");
    tick(world);
    expect(sigOfFighter(world, "f")).toBe(SIG_BURNING);
    expect(sigOfFighter(world, "a")).toBe(SIG_CHILLED);
  });

  it("the bits combine on one fighter", () => {
    const world = makeWorld([
      { id: "p", faction: "plague", at: [300, 300] },
      { id: "f", faction: "frost", at: [340, 330] },
      { id: "h", faction: "holy", at: [340, 300], weapon: "wand", hpFrac: 0.3 },
    ]);
    noteContact(world, "p", "h");
    noteContact(world, "f", "h");
    tick(world);
    expect(sigOfFighter(world, "h")).toBe(SIG_CHILLED | SIG_DISEASED | SIG_EXECUTE);
  });

  it("all bits and the brand are zero for a fighter that is no longer standing", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "s", faction: "sentenced", at: [260, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null, hp: 100 },
      { id: "c", faction: "plague", at: [700, 700], weapon: null },
    ]);
    noteContact(world, "a", "b");
    noteContact(world, "s", "b");
    run(world, 40);
    expect(sigOfFighter(world, "b") & SIG_BURNING).toBe(SIG_BURNING);
    expect(P(world, "b").brand).toBeGreaterThan(0);

    injector(world).hit("c", "b", { raw: 1000 });
    tick(world);
    expect(P(world, "b").status).toBe("dead");
    expect(world.state.phase).toBe("active");
    expect(sigOfFighter(world, "b")).toBe(0);
    expect(P(world, "b").brand).toBe(0);
  });
});

// ---- the teleport ----

describe("the coliseum teleport", () => {
  const inContact = (): World => {
    const world = makeWorld([
      { id: "a", faction: "sentenced", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    run(world, 20);
    expect(targetOf(world, "a")).toBe("b");
    expect(signatureState(world, "a")!.markElapsed).toBeGreaterThan(0);
    expect(P(world, "b").brand).toBeGreaterThan(0);
    return world;
  };
  const cleared = (world: World): void => {
    for (const id of ["a", "b"]) {
      expect(targetOf(world, id), id).toBeNull();
      expect(signatureState(world, id)?.markElapsed ?? 0, id).toBe(0);
    }
  };

  it("teleportToColiseum clears every target and mark", () => {
    const world = inContact();
    teleportToColiseum(world);
    expect(world.state.inColiseum).toBe(true);
    cleared(world);
  });

  it("the teleported hook alone clears them", () => {
    const world = inContact();
    world.hooks.teleported!(world);
    cleared(world);
  });

  it("takes off the chill too", () => {
    const world = makeWorld([
      { id: "a", faction: "frost", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: "wand" },
    ]);
    noteContact(world, "a", "b");
    tick(world);
    expect(signatureState(world, "b")!.chill).toBeCloseTo(CHILL, 12);
    teleportToColiseum(world);
    expect(signatureState(world, "b")?.chill ?? 1).toBe(1);
    const next = world.state.serverTime + TICK_MS;
    P(world, "b").readyAt = next + 10_000;
    tick(world);
    expect(P(world, "b").readyAt).toBe(next + 10_000);
  });

  it("the patience teleport at the end of a tick clears even the contact that tick made, and nothing carries over", () => {
    const world = inContact();
    world.state.patienceEndsAt = world.state.serverTime + TICK_MS;
    injector(world).hit("a", "b");
    tick(world);
    expect(world.state.inColiseum).toBe(true);
    cleared(world);
    run(world, 5);
    cleared(world);
  });
});

// ---- fairness ----

describe("fairness", () => {
  it("signature damage joins the ledger with the tick's hits and lands in one application", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300] },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    const inj = injector(world);
    const snapshots: LedgerEntry[][] = [];
    world.beforeDamage.push(() => { snapshots.push(world.combat.ledger.map((e) => ({ ...e }))); }); // after the factions'

    const raw = 30;
    inj.hit("a", "b", { raw, weapon: "axe" });
    inj.swing("b", "sword");
    const before = hpOf(world, "b");
    const log = tick(world);

    const entries = snapshots[0]!;
    expect(entries.every((e) => e.victim === "b")).toBe(true);
    expect(entries.filter((e) => !e.sig)).toHaveLength(1);
    expect(entries.filter((e) => e.sig === "burn")).toHaveLength(1);
    expect(entries.filter((e) => e.sig === "backlash")).toHaveLength(1);
    expect(entries).toHaveLength(3);

    // The injected hit carries physical shares, and Holy has no armor.
    const plain = mitigateShares(raw, { phys: 1, magic: 0, true: 0 }, SPEC.holy);
    const burn = mitigated("fire", "holy", burnDps(SPEC.fire) * bonusMultiplier("axe") * DT);
    const backlash = mitigated("fire", "holy", backlashPerSwing(SPEC.fire.params.backlash!, SPEC.holy, "sword") * bonusMultiplier("axe"));
    expect(log.landed).toHaveLength(3);
    expect(before - hpOf(world, "b")).toBeCloseTo(plain + burn + backlash, 6);
  });

  // Phase 9's contract: applyHits gives exact ties to the earlier hit, and the ledger hands hits over in the tick's
  // secret rank (combat.rank), so neither join order nor ledger order decides. Signature damage rides the same ledger.
  describe("kill credit between equal hits follows the tick's secret rank, not the ledger order", () => {
    const SALTS = [1, 2, 3, 4, 5, 6];
    const IDLE_TICKS = [0, 1, 2, 3];
    const grid = SALTS.flatMap((salt) => IDLE_TICKS.map((idle) => [salt, idle] as const));
    const trio = (salt: number, idle: number): World => {
      const world = makeWorld([
        { id: "p1", faction: "fire", at: [100, 100], weapon: null },
        { id: "p2", faction: "plague", at: [300, 100], weapon: null },
        { id: "v", faction: "holy", at: [500, 100], weapon: null },
      ]);
      world.orderSalt = salt;
      run(world, idle);
      return world;
    };
    const asAttacker = (world: World, id: string): Attacker => ({ id, p: P(world, id), rt: RT(world, id) });
    const LETHAL = 2 * BIG_HP;

    /** Who gets the kill when `order` lands on the victim through applyHits, in the array's order. */
    const viaApplyHits = (salt: number, idle: number, order: readonly string[], amounts: Record<string, number> = {}): string | null => {
      const world = trio(salt, idle);
      applyHits(world, P(world, "v"), RT(world, "v"), order.map((id) => ({ amount: amounts[id] ?? LETHAL, source: asAttacker(world, id) })));
      expect(P(world, "v").status).toBe("dead");
      const killer = RT(world, "v").killedBy;
      for (const id of ["p1", "p2"]) expect(P(world, id).kills, `${id} kills`).toBe(killer === id.toUpperCase() ? 1 : 0);
      return killer;
    };
    /** The same through the real ledger, with the hits recorded in `order`. */
    const viaLedger = (salt: number, idle: number, order: readonly string[]): string | null => {
      const world = trio(salt, idle);
      const inj = injector(world);
      for (const id of order) inj.hit(id, "v", { raw: LETHAL });
      tick(world);
      expect(P(world, "v").status).toBe("dead");
      return RT(world, "v").killedBy;
    };

    it("through the ledger the killer is the same for either order of equal hits, and is not always the same player", () => {
      const killers = new Set<string | null>();
      for (const [salt, idle] of grid) {
        const first = viaLedger(salt, idle, ["p1", "p2"]);
        expect(viaLedger(salt, idle, ["p2", "p1"]), `salt ${salt}, ${idle} idle ticks`).toBe(first);
        expect(["P1", "P2"]).toContain(first);
        killers.add(first);
      }
      expect([...killers].sort()).toEqual(["P1", "P2"]);
    });

    it("applyHits on its own gives an exact tie to the earlier hit (the ledger decides the order)", () => {
      for (const [salt, idle] of grid) {
        expect(viaApplyHits(salt, idle, ["p1", "p2"]), `salt ${salt}, ${idle}`).toBe("P1");
        expect(viaApplyHits(salt, idle, ["p2", "p1"]), `salt ${salt}, ${idle}`).toBe("P2");
      }
    });

    it.each([["p1", "P1"], ["p2", "P2"]] as const)("the larger hit still takes the kill, whatever the hash says (%s larger)", (larger, name) => {
      const amounts = { p1: LETHAL, p2: LETHAL, [larger]: LETHAL + 1 };
      for (const [salt, idle] of grid) {
        expect(viaApplyHits(salt, idle, ["p1", "p2"], amounts), `salt ${salt}, ${idle}`).toBe(name);
        expect(viaApplyHits(salt, idle, ["p2", "p1"], amounts), `salt ${salt}, ${idle}`).toBe(name);
      }
    });
  });

  describe("the shuffled player order decides nothing", () => {
    const SALTS = [0, 1, 0xdeadbeef, 12345, 987654321];

    it("a three-way wand fight with every signature running ends identically under any order salt", () => {
      const traces = SALTS.map((salt) => {
        const world = makeWorld([
          { id: "a", faction: "fire", at: [300, 300], weapon: "wand" },
          { id: "b", faction: "holy", at: [420, 300], weapon: "wand", hpFrac: 0.7 },
          { id: "c", faction: "frost", at: [360, 400], weapon: "wand" },
        ]);
        world.orderSalt = salt;
        const aim = (from: string, to: string): number =>
          Math.atan2(P(world, to).y - P(world, from).y, P(world, to).x - P(world, from).x);
        RT(world, "a").inputs.pushAction({ kind: "attack", a: aim("a", "b") });
        RT(world, "b").inputs.pushAction({ kind: "attack", a: aim("b", "c") });
        RT(world, "c").inputs.pushAction({ kind: "attack", a: aim("c", "a") });
        noteContact(world, "a", "b");
        noteContact(world, "c", "a");
        return run(world, 120).map(() => ["a", "b", "c"].map((id) => hpOf(world, id)));
      });
      // The fight must actually involve damage, or the comparison proves nothing.
      expect(traces[0]!.at(-1)![0]).toBeLessThan(BIG_HP);
      expect(traces[0]!.at(-1)![1]).not.toBe(BIG_HP * 0.7);
      for (const trace of traces.slice(1)) expect(trace).toEqual(traces[0]);
    });

    it.each([
      ["a", 0.3, 0.2],
      ["b", 0.2, 0.3],
    ] as const)("two Fires burning each other to death in the same tick: %s, with the higher hp fraction, wins", (winner, hpA, hpB) => {
      for (const salt of SALTS) {
        const world = makeWorld([
          { id: "a", faction: "fire", at: [300, 300], hp: hpA },
          { id: "b", faction: "fire", at: [340, 300], hp: hpB },
        ]);
        world.orderSalt = salt;
        noteContact(world, "a", "b");
        tick(world);
        expect(P(world, "a").status, `salt ${salt}`).toBe("dead");
        expect(P(world, "b").status, `salt ${salt}`).toBe("dead");
        expect(world.state.winner, `salt ${salt}`).toBe(winner.toUpperCase());
      }
    });
  });
});

// ---- the weapon multiplier ----

describe("bonusMultiplier: every signature bonus follows the weapon in hand", () => {
  const OWNERS = ["fire", "plague", "sentenced"] as const;
  const SIG: Record<(typeof OWNERS)[number], SignatureKind> = { fire: "burn", plague: "disease", sentenced: "mark" };
  const TICKS = 30;

  /** The signature damage of tick `TICKS` for `owner` holding `weapon`, 40 from a Holy at full hp. */
  function amountAt(owner: (typeof OWNERS)[number], weapon: WeaponId): number {
    const world = makeWorld([
      { id: "a", faction: owner, at: [300, 300], weapon },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    return sigTotal(run(world, TICKS).at(-1)!, SIG[owner]);
  }
  const rawPerSecond = (owner: (typeof OWNERS)[number]): number =>
    owner === "fire" ? burnDps(SPEC.fire) : owner === "plague" ? diseaseDps(SPEC.plague, 1) : markDps(SPEC.sentenced, (TICKS - 1) * DT);

  it.each(OWNERS.flatMap((o) => WEAPON_IDS.map((w) => [o, w] as const)))("%s holding a %s", (owner, weapon) => {
    expect(amountAt(owner, weapon)).toBeCloseTo(mitigated(owner, "holy", rawPerSecond(owner) * WEAPONS[weapon].dpsMult * DT), 9);
  });

  it.each(OWNERS)("%s with a bow (0.8) deals 0.8 of what it deals with a sword (1.0)", (owner) => {
    expect(amountAt(owner, "bow")).toBeCloseTo(0.8 * amountAt(owner, "sword"), 9);
  });

  it("an empty hand deals no signature damage at all", () => {
    const world = makeWorld([
      { id: "a", faction: "fire", at: [300, 300], weapon: null },
      { id: "b", faction: "holy", at: [340, 300], weapon: null },
    ]);
    noteContact(world, "a", "b");
    for (const log of run(world, 5)) expect(log.landed).toHaveLength(0);
  });
});

// ---- stretchUntil ----

describe("stretchUntil", () => {
  const now = 1000;
  const dt = 50;

  it("leaves a time that has already passed (or is exactly now) alone", () => {
    expect(stretchUntil(now, now, dt, 0.4)).toBe(now);
    expect(stretchUntil(now - 10, now, dt, 0.4)).toBe(now - 10);
  });

  it("leaves it alone when nothing slows (m >= 1)", () => {
    expect(stretchUntil(now + 500, now, dt, 1)).toBe(now + 500);
    expect(stretchUntil(now + 500, now, dt, 1.5)).toBe(now + 500);
  });

  it("pushes it back by (1 - m) x dt while at least m x dt of work is left", () => {
    expect(stretchUntil(now + 500, now, dt, 0.4)).toBeCloseTo(now + 500 + 30, 12);
    expect(stretchUntil(now + 21, now, dt, 0.4)).toBeCloseTo(now + 21 + 30, 12);
    expect(stretchUntil(now + 20, now, dt, 0.4)).toBeCloseTo(now + 20 + 30, 12);
  });

  it("finishes the work inside the tick at now + left / m when less than m x dt is left", () => {
    expect(stretchUntil(now + 10, now, dt, 0.4)).toBeCloseTo(now + 25, 12);
    expect(stretchUntil(now + 1, now, dt, 0.4)).toBeCloseTo(now + 2.5, 12);
    expect(stretchUntil(now + 10, now, dt, 0.5)).toBeCloseTo(now + 20, 12);
  });

  it("is continuous where the two cases meet, and never ends before now or after one more tick", () => {
    expect(stretchUntil(now + 20, now, dt, 0.4)).toBeCloseTo(stretchUntil(now + 20 - 1e-9, now, dt, 0.4), 6);
    for (let left = 0.5; left < 200; left += 0.5) {
      const out = stretchUntil(now + left, now, dt, 0.4);
      expect(out).toBeGreaterThan(now);
      expect(out).toBeGreaterThanOrEqual(now + left);
      expect(out - (now + left)).toBeLessThanOrEqual((1 - 0.4) * dt + 1e-9);
    }
  });
});

// ---- hooks ----

describe("chainHook", () => {
  const pair = (): World => makeWorld([
    { id: "a", faction: "sentenced", at: [300, 300] },
    { id: "b", faction: "holy", at: [340, 300], weapon: null },
  ]);

  it("weaponSwapped: a hook chained on runs after the factions' own, which still restarts the mark", () => {
    const world = pair();
    noteContact(world, "a", "b");
    run(world, 10);
    const calls: string[] = [];
    chainHook(world, "weaponSwapped", (_w, c) => { calls.push(`first ${c.id}`); });
    chainHook(world, "weaponSwapped", (_w, c) => { calls.push(`second ${c.id}`); });
    world.hooks.weaponSwapped!(world, C(world, "b"));
    expect(calls).toEqual(["first b", "second b"]);
    expect(signatureState(world, "a")!.markElapsed).toBe(0);
  });

  it("bountyClaimed: chained hooks all run, in order, with the claim", () => {
    const world = pair();
    const calls: string[] = [];
    chainHook(world, "bountyClaimed", (_w, killer, victim, bounty) => { calls.push(`first ${killer.id} ${victim.id} ${bounty}`); });
    chainHook(world, "bountyClaimed", (_w, killer, victim, bounty) => { calls.push(`second ${killer.id} ${victim.id} ${bounty}`); });
    world.hooks.bountyClaimed!(world, RT(world, "a"), RT(world, "b"), 7);
    expect(calls).toEqual(["first a b 7", "second a b 7"]);
  });

  it.each(["teleported", "raidStarted"] as const)("%s: a hook chained on runs after the factions' own reset", (key) => {
    const world = pair();
    noteContact(world, "a", "b");
    const seen: Array<string | null> = [];
    chainHook(world, key, (w) => { seen.push(targetOf(w, "a")); });
    world.hooks[key]!(world);
    expect(seen).toEqual([null]); // the factions' reset had already cleared the target
  });
});

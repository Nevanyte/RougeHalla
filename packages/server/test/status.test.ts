// The status runtime (sim/status.ts), the area table (sim/fields.ts), forced displacement (sim/displace.ts) and the hooks
// they have in the rest of the sim (stun, untargetability, the death floor, the zone's damage factor, anti-heal).
// What is pinned here: instance identity, refresh, caps and stacking, how kinds combine, the cleanse classes, the freeze
// of the table while the ledger pass runs (D20), and every hook of the contract's table 3.8 that is not a cast.
import { describe, expect, it } from "vitest";
import {
  ABILITY_IDS, EFFECT_ANTI_HEAL, EFFECT_CASTING, EFFECT_DOT, EFFECT_HASTE, EFFECT_HIDDEN, EFFECT_LAST_STAND, EFFECT_ROOTED,
  EFFECT_SILENCED, EFFECT_SLOWED, EFFECT_STUNNED, EFFECT_UNTARGETABLE, EFFECT_ZONED, FACTIONS, FIELD_KINDS, mapFromTiles, mulberry32, PLAYER_SPEED,
  SIG_CHILLED, SIGNATURE_WEAPONS, STATUS_RULES, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type FxEvent, type GameMap,
  type StatusKind,
} from "@raid/shared";
import { combatant, type Combatant } from "../src/sim/combatant";
import { displace } from "../src/sim/displace";
import { heal } from "../src/sim/factions";
import { abilitiesRt, addField, fieldsOf, onTrail, removeField, removeFieldsWhere } from "../src/sim/fields";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { moveSpeedMult } from "../src/sim/buffs";
import { recomputeMods } from "../src/sim/mods";
import { placeMob } from "../src/sim/mobLife";
import { abandonPlayer, addPlayer, removePlayer, step } from "../src/sim/step";
import {
  actionBlocked, addStatus, attackSlowFactor, cannotMove, castBlocked, cleanse, damageFactor, effectsOf, findStatus, floorHp, healFactor,
  isCasting, isHidden, isRooted, isSilenced, isSlowed, isStunned, isUntargetable, isUntargetableId, refreshEffects, removeStatuses,
  reveal, statusesOf, statusMoveMultiplier, statusValue, type StatusApply,
} from "../src/sim/status";
import { chainHook, createWorld, payLater, type CastRuntime, type SimEvent, type StatusInstance, type World } from "../src/sim/world";

// ---------------------------------------------------------------------------------------------------------------
// Rig: an active raid of a few players on an open map, so a status has a real fighter to sit on.

const W_TILES = 40;
const H_TILES = 20;
const tileCentre = (t: number): number => t * TILE + TILE / 2;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + i), y: tileCentre(3) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

/** Two halves of the map, sealed from each other by a wall column. */
function splitMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; tiles[ty * W_TILES + 20] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + i), y: tileCentre(3) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

const nameOf = (id: string): string => id[0]!.toUpperCase() + id.slice(1);

interface Fighter { id: string; faction?: FactionId; at?: { x: number; y: number } }

/** An active run of these fighters (a, b, c by default), the first step already taken. */
function arena(fighters: Array<string | Fighter> = ["a", "b", "c"], opts: { signatures?: boolean; map?: GameMap } = {}): World {
  const list = fighters.map((f): Fighter => (typeof f === "string" ? { id: f } : f));
  const world = createGameWorld({
    seed: 11,
    config: {
      minPlayers: list.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false,
    },
    random: mulberry32(12),
  }, { signatures: opts.signatures ?? false });
  world.map = opts.map ?? openMap();
  for (const f of list) {
    const p = addPlayer(world, f.id, nameOf(f.id));
    p.faction = f.faction ?? "fire";
    p.hp = p.maxHp = FACTIONS[p.faction as FactionId].hp;
    p.weapon0 = SIGNATURE_WEAPONS[p.faction as FactionId];
  }
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  list.forEach((f, i) => put(world, f.id, f.at?.x ?? 200 + 60 * i, f.at?.y ?? 320));
  // Whatever the cast module installs, the movement factor of a status is part of the world (a no-op twice over would be wrong).
  if (!world.moveModifiers.includes(statusMoveMultiplier)) world.moveModifiers.push(statusMoveMultiplier);
  world.events = [];
  return world;
}

function put(world: World, id: string, x: number, y: number): void {
  const p = world.state.players.get(id)!;
  p.x = x;
  p.y = y;
  const rt = world.players.get(id)!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

const C = (world: World, id: string): Combatant => combatant(world, id)!;
const P = (world: World, id: string) => world.state.players.get(id)!;
const src = (id: string) => ({ id, name: nameOf(id) });
const tick = (world: World): SimEvent[] => step(world, TICK_MS);
const run = (world: World, ticks: number): SimEvent[] => Array.from({ length: ticks }, () => tick(world)).flat();
const fxOf = <K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Extract<FxEvent, { kind: K }>> =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Extract<FxEvent, { kind: K }>] : []));
const statusFx = (world: World) => fxOf(world.events, "status");
const now = (world: World): number => world.state.serverTime;

function apply(world: World, id: string, by: string, kind: StatusKind, ms: number, extra: Partial<StatusApply> = {}): StatusInstance | null {
  return addStatus(world, C(world, id), { kind, source: src(by), ms, ...extra });
}

/** Runs `fn` as if inside the ledger pass, then pays what it queued, as applyLedger does. */
function inPass(world: World, fn: () => void): void {
  world.combat.collecting = true;
  try { fn(); } finally { world.combat.collecting = false; }
  const payouts = world.combat.payouts;
  world.combat.payouts = [];
  for (const pay of payouts) pay();
}

// ---------------------------------------------------------------------------------------------------------------

describe("addStatus", () => {
  it("makes a fresh instance that lasts `ms`, sets its bit and announces it once", () => {
    const w = arena();
    const st = apply(w, "a", "b", "stun", 1000, { ability: "freeze" })!;
    expect(st).toMatchObject({ kind: "stun", source: { id: "b" }, ability: "freeze", startedAt: now(w), until: now(w) + 1000, value: 0 });
    expect(statusesOf(C(w, "a"))).toEqual([st]);
    expect(P(w, "a").effects).toBe(EFFECT_STUNNED);
    expect(statusFx(w)).toEqual([{ kind: "status", id: "a", status: "stun", ms: 1000, by: "b" }]);
  });

  it("quiet: no status fx", () => {
    const w = arena();
    addStatus(w, C(w, "a"), { kind: "dot", source: src("b"), ms: 500, value: 10 }, { quiet: true });
    expect(statusFx(w)).toEqual([]);
    expect(P(w, "a").effects).toBe(EFFECT_DOT);
  });

  it("caps an instance's remaining time at the kind's maxMs", () => {
    const w = arena();
    expect(apply(w, "a", "b", "stun", 99999)!.until).toBe(now(w) + STATUS_RULES.stun.maxMs);
    expect(apply(w, "a", "c", "slowMove", 99999, { value: 0.3 })!.until).toBe(now(w) + STATUS_RULES.slowMove.maxMs);
  });

  it("applying it again extends to the later time, never shortens, and is not announced again", () => {
    const w = arena();
    const first = apply(w, "a", "b", "stun", 1000)!;
    w.state.serverTime += 500;
    w.events = [];
    const again = apply(w, "a", "b", "stun", 1000)!;
    expect(again).toBe(first);
    expect(first.until).toBe(now(w) + 1000);
    expect(statusFx(w)).toEqual([]);
    apply(w, "a", "b", "stun", 100);
    expect(first.until).toBe(now(w) + 1000);
    apply(w, "a", "b", "stun", 99999);
    expect(first.until).toBe(now(w) + STATUS_RULES.stun.maxMs);
    expect(statusesOf(C(w, "a"))).toHaveLength(1);
  });

  it("an instance is (kind, source, ability or tag): other sources and other abilities are other instances", () => {
    const w = arena();
    apply(w, "a", "b", "slowMove", 1000, { value: 0.1, ability: "freeze" });
    apply(w, "a", "b", "slowMove", 1000, { value: 0.1, ability: "freeze" });
    expect(statusesOf(C(w, "a"))).toHaveLength(1);
    apply(w, "a", "c", "slowMove", 1000, { value: 0.1, ability: "freeze" });
    apply(w, "a", "b", "slowMove", 1000, { value: 0.1, ability: "trial" });
    apply(w, "a", "b", "slowMove", 1000, { value: 0.1, tag: "chainWarden" });
    apply(w, "a", "b", "slowMove", 1000, { value: 0.1 });
    expect(statusesOf(C(w, "a"))).toHaveLength(5);
    expect(findStatus(C(w, "a"), "slowMove", "c")?.source.id).toBe("c");
    expect(findStatus(C(w, "a"), "stun")).toBeUndefined();
  });

  it("value: the larger on a refresh; `add` accumulates up to its cap, the first application already counting once", () => {
    const w = arena();
    expect(apply(w, "a", "b", "slowMove", 1000, { value: 0.3 })!.value).toBe(0.3);
    expect(apply(w, "a", "b", "slowMove", 1000, { value: 0.2 })!.value).toBe(0.3);
    expect(apply(w, "a", "b", "slowMove", 1000, { value: 0.5 })!.value).toBe(0.5);
    const add = { per: 0.1, cap: 0.25 };
    expect(apply(w, "a", "c", "slowMove", 1000, { tag: "ward", add })!.value).toBeCloseTo(0.1, 9);
    expect(apply(w, "a", "c", "slowMove", 1000, { tag: "ward", add })!.value).toBeCloseTo(0.2, 9);
    expect(apply(w, "a", "c", "slowMove", 1000, { tag: "ward", add })!.value).toBe(0.25);
    expect(apply(w, "a", "c", "slowMove", 1000, { tag: "ward", add })!.value).toBe(0.25);
  });

  it("data is carried onto the instance and replaced by a later one", () => {
    const w = arena();
    const st = apply(w, "a", "b", "zoned", 1000, { ability: "trial", data: { fieldId: "f1", dealtMult: 0.8, takenFromSourceMult: 1.2 } })!;
    expect(st).toMatchObject({ fieldId: "f1", dealtMult: 0.8, takenFromSourceMult: 1.2 });
    apply(w, "a", "b", "zoned", 1000, { ability: "trial", data: { fieldId: "f2", dealtMult: 0.7, takenFromSourceMult: 1.3 } });
    expect(st).toMatchObject({ fieldId: "f2", dealtMult: 0.7, takenFromSourceMult: 1.3 });
  });

  it("is refused (null, nothing changed) for players-only kinds on a mob, for the dead, and for no time", () => {
    const w = arena();
    const mob = C(w, placeMob(w, { region: "fire", elite: false, at: { x: 600, y: 320 } }));
    for (const kind of ["hidden", "invulnerable", "deathFloor"] as const) {
      expect(addStatus(w, mob, { kind, source: src("a"), ms: 1000 })).toBeNull();
    }
    expect(statusesOf(mob)).toEqual([]);
    expect(addStatus(w, mob, { kind: "stun", source: src("a"), ms: 1000 })).not.toBeNull();
    expect(mob.s.effects).toBe(EFFECT_STUNNED);
    expect(apply(w, "a", "b", "stun", 0)).toBeNull();
    expect(apply(w, "a", "b", "stun", -5)).toBeNull();
    expect(apply(w, "a", "b", "stun", Number.NaN)).toBeNull();
    P(w, "c").status = "dead";
    expect(apply(w, "c", "a", "stun", 1000)).toBeNull();
    expect(statusesOf(C(w, "c"))).toEqual([]);
  });

  it("invulnerable raises immuneUntil (and never lowers it), so the ledger refuses the damage", () => {
    const w = arena();
    P(w, "a").immuneUntil = now(w) + 5000;
    apply(w, "a", "a", "invulnerable", 1000);
    expect(P(w, "a").immuneUntil).toBe(now(w) + 5000);
    apply(w, "b", "b", "invulnerable", 1000);
    expect(P(w, "b").immuneUntil).toBe(now(w) + 1000);
    expect(P(w, "b").effects).toBe(0);
    const hp = P(w, "b").hp;
    recordHit(w, { victim: "b", by: src("a"), packet: { raw: 50, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    expect(P(w, "b").hp).toBe(hp);
  });

  it("calls statusApplied after the bits are set, with fresh true then false", () => {
    const w = arena();
    const seen: Array<{ id: string; kind: string; fresh: boolean; bits: number }> = [];
    chainHook(w, "statusApplied", (_w, c, st, fresh) => { seen.push({ id: c.id, kind: st.kind, fresh, bits: c.s.effects }); });
    apply(w, "a", "b", "silence", 1000);
    apply(w, "a", "b", "silence", 1000);
    expect(seen).toEqual([
      { id: "a", kind: "silence", fresh: true, bits: 4 },
      { id: "a", kind: "silence", fresh: false, bits: 4 },
    ]);
  });

  it("an instance past its `until` that nobody removed is stale: applying it again is a fresh application", () => {
    const w = arena();
    const first = apply(w, "a", "b", "stun", 500)!;
    w.state.serverTime += 600;
    expect(isStunned(w, C(w, "a"))).toBe(false);
    w.events = [];
    const again = apply(w, "a", "b", "stun", 500)!;
    expect(again).toBe(first);
    expect(again.startedAt).toBe(now(w));
    expect(again.until).toBe(now(w) + 500);
    expect(statusFx(w)).toHaveLength(1);
    expect(isStunned(w, C(w, "a"))).toBe(true);
  });
});

describe("combining instances", () => {
  it("sum adds up to the kind's cap; max takes the largest up to its cap; any is on or off; a product of nothing is 1", () => {
    const w = arena();
    const a = C(w, "a");
    expect(statusValue(w, a, "slowMove")).toBe(0);
    expect(statusValue(w, a, "zoned")).toBe(1);
    apply(w, "a", "b", "slowMove", 1000, { value: 0.4 });
    expect(statusValue(w, a, "slowMove")).toBe(0.4);
    apply(w, "a", "c", "slowMove", 1000, { value: 0.4 });
    expect(statusValue(w, a, "slowMove")).toBe(STATUS_RULES.slowMove.cap);
    apply(w, "a", "b", "haste", 1000, { value: 0.3 });
    apply(w, "a", "c", "haste", 1000, { value: 0.9 });
    expect(statusValue(w, a, "haste")).toBe(STATUS_RULES.haste.cap);
    expect(statusValue(w, a, "stun")).toBe(0);
    apply(w, "a", "b", "stun", 1000);
    apply(w, "a", "c", "stun", 1000);
    expect(statusValue(w, a, "stun")).toBe(1);
    apply(w, "a", "b", "zoned", 1000, { value: 0.5 });
    apply(w, "a", "c", "zoned", 1000, { value: 0.5 });
    expect(statusValue(w, a, "zoned")).toBe(0.25);
  });

  it("an instance that has run out counts for nothing, whether or not it was removed", () => {
    const w = arena();
    apply(w, "a", "b", "slowMove", 1000, { value: 0.4 });
    apply(w, "a", "c", "slowMove", 3000, { value: 0.1 });
    w.state.serverTime += 1500;
    expect(statusValue(w, C(w, "a"), "slowMove")).toBeCloseTo(0.1, 9);
    w.state.serverTime += 2000;
    expect(statusValue(w, C(w, "a"), "slowMove")).toBe(0);
    expect(isSlowed(w, C(w, "a"))).toBe(false);
  });

  it("the queries: stunned, rooted, silenced, slowed (a slow status or Frost's chill), casting", () => {
    const w = arena();
    const a = C(w, "a");
    expect([isStunned(w, a), isRooted(w, a), isSilenced(w, a), isSlowed(w, a), isCasting(a)]).toEqual([false, false, false, false, false]);
    apply(w, "a", "b", "root", 1000);
    expect(isRooted(w, a)).toBe(true);
    expect(isStunned(w, a)).toBe(false);
    apply(w, "a", "b", "silence", 1000);
    expect(isSilenced(w, a)).toBe(true);
    apply(w, "a", "b", "slowMove", 1000, { value: 0.2 });
    expect(isSlowed(w, a)).toBe(true);
    expect(P(w, "a").effects).toBe(EFFECT_ROOTED | EFFECT_SILENCED | EFFECT_SLOWED);
    const b = C(w, "b");
    expect(isSlowed(w, b)).toBe(false);
    b.s.sig |= SIG_CHILLED;
    expect(isSlowed(w, b)).toBe(true);
  });

  it("cannotMove: stun, root or a pending cast; actionBlocked: stun or a pending cast; castBlocked reads the def's list", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "b", "root", 1000);
    expect([cannotMove(w, a), actionBlocked(w, a)]).toEqual([true, false]);
    expect(castBlocked(w, a, ["stun", "silence"])).toBe(false);
    expect(castBlocked(w, a, ["root"])).toBe(true);
    const b = C(w, "b");
    apply(w, "b", "a", "stun", 1000);
    expect([cannotMove(w, b), actionBlocked(w, b)]).toEqual([true, true]);
    expect(castBlocked(w, b, ["stun", "silence"])).toBe(true);
    const c = C(w, "c");
    c.rt.cast = pendingCast(w, 250);
    expect([cannotMove(w, c), actionBlocked(w, c), isCasting(c)]).toEqual([true, true, true]);
    apply(w, "c", "a", "silence", 1000);
    expect(castBlocked(w, c, ["silence"])).toBe(true);
    expect(castBlocked(w, c, [])).toBe(false);
  });
});

function pendingCast(world: World, castMs: number): CastRuntime {
  return {
    ability: "freeze", rank: 1, slot: "wish", startedAt: now(world), landsAt: now(world) + castMs, target: null, point: { x: 0, y: 0 },
    landing: null, prevReadyAt: 0, lagMs: TICK_MS,
  };
}

describe("hidden and untargetable", () => {
  it("hidden is untargetable until its own attack reveals it, and the reveal window ends by itself", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "a", "hidden", 8000);
    expect([isHidden(w, a), isUntargetable(w, a), isUntargetableId(w, "a")]).toEqual([true, true, true]);
    expect(P(w, "a").effects & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
    const start = now(w);
    reveal(w, a, start + 500);
    // A reveal takes effect from the next tick: nothing read during this one changes, whoever's attack started first.
    expect([isHidden(w, a), isUntargetable(w, a), isUntargetableId(w, "a")]).toEqual([true, true, true]);
    expect(P(w, "a").effects & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
    w.state.serverTime += TICK_MS;
    expect([isHidden(w, a), isUntargetable(w, a), isUntargetableId(w, "a")]).toEqual([false, false, false]);
    refreshEffects(w, a);
    expect(P(w, "a").effects & EFFECT_HIDDEN).toBe(0);
    w.state.serverTime = start + 499;
    expect(isHidden(w, a)).toBe(false);
    w.state.serverTime = start + 500;
    expect(isHidden(w, a)).toBe(true);
    // The bit follows the next refresh (updateAbilities does it every tick).
    expect(P(w, "a").effects & EFFECT_HIDDEN).toBe(0);
    refreshEffects(w, a);
    expect(P(w, "a").effects & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
  });

  it("a reveal that is running only grows; one that is over starts again a tick from now", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "a", "hidden", 8000);
    const start = now(w);
    reveal(w, a, start + 300);
    w.state.serverTime = start + 200;
    expect(isHidden(w, a)).toBe(false);
    reveal(w, a, start + 700); // grows: still one window, from the first from
    expect(findStatus(a, "hidden")).toMatchObject({ revealFrom: start + TICK_MS, revealUntil: start + 700 });
    w.state.serverTime = start + 700;
    expect(isHidden(w, a)).toBe(true);
    reveal(w, a, start + 1200); // a new window: from the tick after this one
    expect(findStatus(a, "hidden")).toMatchObject({ revealFrom: start + 700 + TICK_MS, revealUntil: start + 1200 });
    expect(isHidden(w, a)).toBe(true);
    w.state.serverTime = start + 700 + TICK_MS;
    expect(isHidden(w, a)).toBe(false);
  });

  it("reveal only raises, and a revealed fighter that is untargetable by status stays untargetable", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "a", "hidden", 8000);
    reveal(w, a, now(w) + 800);
    reveal(w, a, now(w) + 100);
    expect(findStatus(a, "hidden")!.revealUntil).toBe(now(w) + 800);
    w.state.serverTime += TICK_MS;
    apply(w, "a", "a", "untargetable", 2000);
    expect(isHidden(w, a)).toBe(false);
    expect(isUntargetable(w, a)).toBe(true);
    expect(isUntargetableId(w, "a")).toBe(true);
    expect(isUntargetableId(w, "nobody")).toBe(false);
    expect(P(w, "a").effects & EFFECT_UNTARGETABLE).toBe(EFFECT_UNTARGETABLE);
  });

  it("reveal does nothing for a fighter that is not hidden", () => {
    const w = arena();
    reveal(w, C(w, "a"), now(w) + 500);
    expect(P(w, "a").effects).toBe(0);
  });
});

describe("removeStatuses and cleanse", () => {
  it("cleanse removes by class and never the `never` ones; the bits follow", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "b", "slowMove", 2000, { value: 0.3 });
    apply(w, "a", "b", "antiHeal", 2000, { value: 0.3 });
    apply(w, "a", "b", "dot", 2000, { value: 5 });
    apply(w, "a", "b", "stun", 2000);
    apply(w, "a", "a", "untargetable", 2000);
    apply(w, "a", "a", "haste", 2000, { value: 0.3 });
    expect(cleanse(w, a, ["soft"]).map((s) => s.kind).sort()).toEqual(["antiHeal", "dot", "slowMove"]);
    expect(statusesOf(a).map((s) => s.kind).sort()).toEqual(["haste", "stun", "untargetable"]);
    expect(P(w, "a").effects).toBe(EFFECT_STUNNED | EFFECT_UNTARGETABLE | EFFECT_HASTE);
    expect(cleanse(w, a, ["soft", "hard"]).map((s) => s.kind)).toEqual(["stun"]);
    expect(cleanse(w, a, ["soft", "hard", "never"]).map((s) => s.kind)).toEqual([]);
    expect(statusesOf(a).map((s) => s.kind).sort()).toEqual(["haste", "untargetable"]);
    expect(cleanse(w, C(w, "b"), ["soft", "hard"])).toEqual([]);
  });

  it("removeStatuses takes what the predicate picks, with no side effects (no hook, no fx), and refreshes the bits", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "b", "stun", 2000, { ability: "freeze" });
    apply(w, "a", "c", "root", 2000, { ability: "trial" });
    const seen: string[] = [];
    chainHook(w, "statusApplied", (_w, _c, st) => { seen.push(st.kind); });
    w.events = [];
    const gone = removeStatuses(w, a, (st) => st.ability === "freeze");
    expect(gone.map((s) => s.kind)).toEqual(["stun"]);
    expect(statusesOf(a).map((s) => s.kind)).toEqual(["root"]);
    expect(P(w, "a").effects).toBe(EFFECT_ROOTED);
    expect(seen).toEqual([]);
    expect(w.events).toEqual([]);
    expect(removeStatuses(w, a, () => false)).toEqual([]);
  });
});

describe("the table is frozen while the ledger pass runs (D20)", () => {
  it("addStatus, removeStatuses, cleanse inside the pass return nothing, change nothing, and land after it", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "b", "slowMove", 5000, { value: 0.3 });
    w.combat.collecting = true;
    expect(addStatus(w, a, { kind: "stun", source: src("b"), ms: 1000 })).toBeNull();
    expect(cleanse(w, a, ["soft"])).toEqual([]);
    expect(removeStatuses(w, a, (st) => st.kind === "root")).toEqual([]);
    // One consistent table for every reader of the pass: the slow is still there, the stun is not yet.
    expect(isStunned(w, a)).toBe(false);
    expect(isSlowed(w, a)).toBe(true);
    expect(P(w, "a").effects).toBe(EFFECT_SLOWED);
    expect(w.combat.payouts).toHaveLength(3);
    w.combat.collecting = false;
    const payouts = w.combat.payouts;
    w.combat.payouts = [];
    for (const pay of payouts) pay();
    expect(statusesOf(a).map((s) => s.kind)).toEqual(["stun"]);
    expect(P(w, "a").effects).toBe(EFFECT_STUNNED);
  });

  it("a fighter who goes down in the pass gets no deferred status, and nothing in the pass saw it", () => {
    const w = arena();
    const seen: string[] = [];
    let stunnedInPass: boolean | null = null;
    chainHook(w, "fighterOut", (world, id) => {
      if (id !== "a") return;
      // The killer's side: `b` is stunned by the death (a deferred status), and the victim itself can't be.
      expect(addStatus(world, C(world, "a"), { kind: "stun", source: src("b"), ms: 1000 })).toBeNull();
      addStatus(world, C(world, "b"), { kind: "stun", source: src("a"), ms: 1000 });
      stunnedInPass = isStunned(world, C(world, "b"));
      payLater(world, () => seen.push("paid"));
    });
    P(w, "a").hp = 5;
    recordHit(w, { victim: "a", by: src("b"), packet: { raw: 50, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    expect(P(w, "a").status).toBe("dead");
    expect(statusesOf(C(w, "a"))).toEqual([]);
    expect(stunnedInPass).toBe(false);
    expect(seen).toEqual(["paid"]);
    expect(isStunned(w, C(w, "b"))).toBe(true);
  });

  it("a zone added inside the pass (a death's hook) does not change a later victim's damage in the same pass, and counts from the next", () => {
    const w = arena(["a", "b", "x", "y"]);
    chainHook(w, "fighterOut", (world, id) => {
      if (id !== "x") return;
      addStatus(world, C(world, "b"), { kind: "zoned", source: src("a"), ms: 5000, ability: "trial", data: { fieldId: "f", dealtMult: 0.5, takenFromSourceMult: 1 } });
    });
    const hit = (victim: string, by: string, raw: number): void => {
      recordHit(w, { victim, by: src(by), packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    };
    const hp = P(w, "y").hp;
    // `x` is first in the ledger, so it is processed (and dies) before `y` takes b's hit.
    hit("x", "a", 1e6);
    hit("y", "b", 100);
    applyLedger(w);
    expect(P(w, "x").status).toBe("dead");
    expect(hp - P(w, "y").hp).toBeCloseTo(100, 9);
    expect(damageFactor(w, "b", "y")).toBe(0.5);
    hit("y", "b", 100);
    applyLedger(w);
    expect(hp - P(w, "y").hp).toBeCloseTo(150, 9);
  });

  it("displace inside the pass waits for its end too", () => {
    const w = arena();
    const a = C(w, "a");
    const before = { x: a.s.x, y: a.s.y };
    w.combat.collecting = true;
    displace(w, a, { x: 400, y: 200 });
    expect({ x: a.s.x, y: a.s.y }).toEqual(before);
    expect(a.s.displaceSeq).toBe(0);
    w.combat.collecting = false;
    const payouts = w.combat.payouts;
    w.combat.payouts = [];
    for (const pay of payouts) pay();
    expect({ x: a.s.x, y: a.s.y }).toEqual({ x: 400, y: 200 });
    expect(a.s.displaceSeq).toBe(1);
  });
});

describe("damageFactor (a zone's modifiers, D9)", () => {
  const zone = (w: World, subject: string, caster: string, fieldId = "f1"): void => {
    apply(w, subject, caster, "zoned", 5000, { ability: "trial", data: { fieldId, dealtMult: 0.8, takenFromSourceMult: 1.2 } });
  };

  it("is 1 for fighters with no statuses, and for statuses that are not a zone", () => {
    const w = arena();
    expect(damageFactor(w, "a", "b")).toBe(1);
    expect(damageFactor(w, "nobody", "b")).toBe(1);
    apply(w, "a", "b", "stun", 1000);
    expect(damageFactor(w, "a", "b")).toBe(1);
  });

  it("the subject deals x0.8 to anyone and takes x1.2 from the caster only", () => {
    const w = arena();
    zone(w, "b", "a");
    expect(damageFactor(w, "b", "c")).toBeCloseTo(0.8, 12);
    expect(damageFactor(w, "b", "a")).toBeCloseTo(0.8, 12);
    expect(damageFactor(w, "a", "b")).toBeCloseTo(1.2, 12);
    expect(damageFactor(w, "c", "b")).toBe(1);
    expect(damageFactor(w, "a", "c")).toBe(1);
  });

  it("several zones multiply", () => {
    const w = arena();
    zone(w, "b", "a", "f1");
    zone(w, "b", "c", "f2");
    expect(damageFactor(w, "b", "a")).toBeCloseTo(0.64, 12);
    expect(damageFactor(w, "a", "b")).toBeCloseTo(1.2, 12);
    expect(damageFactor(w, "c", "b")).toBeCloseTo(1.2, 12);
  });

  it("ignores a zone that has run out", () => {
    const w = arena();
    zone(w, "b", "a");
    w.state.serverTime += 6000;
    expect(damageFactor(w, "b", "c")).toBe(1);
    expect(damageFactor(w, "a", "b")).toBe(1);
  });

  it("the ledger multiplies every non-arena entry by it before mitigation; the arena's own burn is no one's hit", () => {
    const w = arena();
    zone(w, "b", "a");
    const hp = { a: P(w, "a").hp, b: P(w, "b").hp, c: P(w, "c").hp };
    const hit = (victim: string, by: string, extra: Record<string, unknown> = {}): void => {
      recordHit(w, { victim, by: src(by), packet: { raw: 100, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false, ...extra });
    };
    hit("c", "b");
    hit("b", "a");
    hit("b", "c");
    applyLedger(w);
    expect(P(w, "c").hp).toBeCloseTo(hp.c - 80, 9);
    expect(P(w, "b").hp).toBeCloseTo(hp.b - 120 - 100, 9);
    hit("c", "b", { arena: true });
    applyLedger(w);
    expect(P(w, "c").hp).toBeCloseTo(hp.c - 80 - 100, 9);
  });
});

describe("the death floor (floorHp, D3)", () => {
  const floor = (w: World, id: string, ms = 5000): StatusInstance =>
    apply(w, id, id, "deathFloor", ms, { ability: "lastStand", data: { floorHp: 1, healShare: 0.3 } })!;

  it("no floor: hp after the damage, never below 0", () => {
    const w = arena();
    expect(floorHp(w, "a", 100, 30)).toBe(70);
    expect(floorHp(w, "a", 100, 130)).toBe(0);
    expect(floorHp(w, "nobody", 100, 130)).toBe(0);
  });

  it("holds hp at the floor, counting every point that reached the pool, overkill included", () => {
    const w = arena();
    const st = floor(w, "a");
    expect(floorHp(w, "a", 100, 30)).toBe(70);
    expect(st.taken).toBe(30);
    expect(floorHp(w, "a", 70, 200)).toBe(1);
    expect(st.taken).toBe(230);
    expect(floorHp(w, "a", 1, 10)).toBe(1);
    expect(st.taken).toBe(240);
    // Already below the floor (0.5 hp): it stays there, it does not rise to 1.
    expect(floorHp(w, "a", 0.5, 10)).toBe(0.5);
    expect(st.taken).toBe(250);
  });

  it("ends when it runs out", () => {
    const w = arena();
    const st = floor(w, "a", 1000);
    w.state.serverTime += 1000;
    expect(floorHp(w, "a", 50, 80)).toBe(0);
    expect(st.taken ?? 0).toBe(0);
  });

  it("through the ledger the fighter survives at 1 hp, no death, and `taken` excludes what the kill barrier absorbed", () => {
    const w = arena();
    const st = floor(w, "a");
    P(w, "a").barrier = 50;
    recordHit(w, { victim: "a", by: src("b"), packet: { raw: 100, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    recordHit(w, { victim: "a", by: src("c"), packet: { raw: 5000, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    expect(P(w, "a").hp).toBe(1);
    expect(P(w, "a").status).toBe("alive");
    expect(w.events.filter((e) => e.type === "fx" && e.fx.kind === "death")).toEqual([]);
    expect(st.taken).toBeCloseTo(5100 - 50, 6);
    w.state.serverTime += 6000;
    recordHit(w, { victim: "a", by: src("b"), packet: { raw: 10, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    expect(P(w, "a").status).toBe("dead");
  });

  it("the arena's own burn is held by it too", () => {
    const w = arena();
    const st = floor(w, "a");
    recordHit(w, { victim: "a", by: src("b"), packet: { raw: 1e6, phys: 0, magic: 0, true: 1 }, weapon: "axe", stagger: false, arena: true });
    applyLedger(w);
    expect(P(w, "a").hp).toBe(1);
    expect(st.taken).toBe(1e6);
  });
});

describe("anti-heal and attack slow", () => {
  it("healFactor and attackSlowFactor are 1 minus the capped sum", () => {
    const w = arena();
    const a = C(w, "a");
    expect([healFactor(w, a), attackSlowFactor(w, a)]).toEqual([1, 1]);
    apply(w, "a", "b", "antiHeal", 1000, { value: 0.25 });
    expect(healFactor(w, a)).toBe(0.75);
    apply(w, "a", "c", "antiHeal", 1000, { value: 0.5 });
    expect(healFactor(w, a)).toBeCloseTo(1 - STATUS_RULES.antiHeal.cap!, 12);
    apply(w, "a", "b", "slowAttack", 1000, { value: 0.4 });
    expect(attackSlowFactor(w, a)).toBe(0.6);
    expect(P(w, "a").effects & EFFECT_ANTI_HEAL).toBe(EFFECT_ANTI_HEAL);
  });

  it("heal() scales every heal by it, lifesteal included, and a full anti-heal gains nothing", () => {
    const w = arena(["a", "b"], { signatures: true });
    const a = C(w, "a");
    a.s.hp = 100;
    apply(w, "a", "b", "antiHeal", 5000, { value: 0.5 });
    expect(heal(w, a, 20, { lifesteal: true })).toBe(10);
    expect(a.s.hp).toBe(110);
    apply(w, "a", "b", "antiHeal", 5000, { value: 1 });
    expect(healFactor(w, a)).toBeCloseTo(1 - STATUS_RULES.antiHeal.cap!, 12);
  });

  it("heal({ ignoreLockout }) heals through the out-of-combat lockout; a plain heal does not", () => {
    const w = arena(["a", "b"], { signatures: true });
    const a = C(w, "a");
    a.s.hp = 100;
    const f = w.factions!.fighters;
    f.set("a", { ...(f.get("a") ?? blankSig()), combatAt: now(w) });
    expect(heal(w, a, 20)).toBe(0);
    expect(heal(w, a, 20, { ignoreLockout: true })).toBe(20);
    expect(a.s.hp).toBe(120);
    expect(heal(w, a, 20, { ignoreLockout: true, lifesteal: false })).toBe(20);
  });
});

function blankSig() {
  return {
    target: null, inReach: false, engaged: false, reachAt: -Infinity, contactAt: -Infinity, tier: 0, markGroup: null, markGroupSize: 1,
    markHits: 0, markProgress: 0, markSwaps: 0, markDenied: false, farSince: -Infinity, ampUntil: 0, hpFrac: 1,
    combatAt: -Infinity, chill: 1, chillers: [] as string[], seenAction: null, dotPausedUntil: 0,
  };
}

describe("movement: statusMoveMultiplier", () => {
  it("is 1 with nothing on the fighter, 0 while stunned, rooted or casting", () => {
    const w = arena();
    const a = C(w, "a");
    expect(statusMoveMultiplier(w, a)).toBe(1);
    apply(w, "a", "b", "root", 1000);
    expect(statusMoveMultiplier(w, a)).toBe(0);
    apply(w, "b", "a", "stun", 1000);
    expect(statusMoveMultiplier(w, C(w, "b"))).toBe(0);
    const c = C(w, "c");
    c.rt.cast = pendingCast(w, 250);
    expect(statusMoveMultiplier(w, c)).toBe(0);
    c.rt.cast = null;
    expect(statusMoveMultiplier(w, c)).toBe(1);
  });

  it("slows by the capped sum", () => {
    const w = arena();
    apply(w, "a", "b", "slowMove", 1000, { value: 0.25 });
    expect(statusMoveMultiplier(w, C(w, "a"))).toBeCloseTo(0.75, 12);
    apply(w, "a", "c", "slowMove", 1000, { value: 0.9 });
    expect(statusMoveMultiplier(w, C(w, "a"))).toBeCloseTo(1 - STATUS_RULES.slowMove.cap!, 12);
  });

  it("haste ADDS value x PLAYER_SPEED to whatever the speed mirror gives (D12), rather than multiplying it", () => {
    const w = arena();
    const a = C(w, "a");
    apply(w, "a", "a", "haste", 5000, { value: 0.3 });
    expect(moveSpeedMult(w, a) * statusMoveMultiplier(w, a)).toBeCloseTo(1.3, 12);
    w.modSources.push((_w, c) => (c.id === "a" ? { speedMult: 1.2 } : null));
    recomputeMods(w, a);
    const base = moveSpeedMult(w, a);
    expect(base).toBeGreaterThan(1);
    expect(base * statusMoveMultiplier(w, a)).toBeCloseTo(base + 0.3, 12);
    // Slowed and hasted: the slow scales the haste's total.
    apply(w, "a", "b", "slowMove", 5000, { value: 0.5 });
    expect(base * statusMoveMultiplier(w, a)).toBeCloseTo((base + 0.3) * 0.5, 12);
  });

  it("a stunned player's walk waits (the path is kept) and goes on when the stun ends", () => {
    const w = arena();
    enqueueClientMessage(w.players.get("a")!.inputs, "move", { x: 600, y: 320 });
    apply(w, "a", "b", "stun", 600);
    const x0 = P(w, "a").x;
    run(w, 6);
    expect(P(w, "a").x).toBe(x0);
    expect(w.players.get("a")!.path.length).toBeGreaterThan(0);
    run(w, 20);
    expect(P(w, "a").x).toBeGreaterThan(x0 + 20);
  });

  it("a hasted player walks faster by value x PLAYER_SPEED", () => {
    const w = arena();
    enqueueClientMessage(w.players.get("a")!.inputs, "move", { x: 600, y: 320 });
    apply(w, "a", "a", "haste", 5000, { value: 0.3 });
    put(w, "a", 200, 320);
    run(w, 1);
    const ax = P(w, "a").x;
    run(w, 10);
    expect((P(w, "a").x - ax) / (10 * TICK_MS / 1000)).toBeCloseTo(PLAYER_SPEED * 1.3, 0);
  });
});

describe("effects bits", () => {
  it("effectsOf is the bits of the active kinds, CASTING for a pending cast with a telegraph, and hidden only outside its reveal", () => {
    const w = arena();
    const a = C(w, "a");
    expect(effectsOf(w, a)).toBe(0);
    apply(w, "a", "b", "stun", 1000);
    apply(w, "a", "b", "dot", 1000, { value: 3 });
    apply(w, "a", "a", "deathFloor", 1000, { data: { floorHp: 1, healShare: 0.3 } });
    expect(effectsOf(w, a)).toBe(EFFECT_STUNNED | EFFECT_DOT | EFFECT_LAST_STAND);
    a.rt.cast = pendingCast(w, 250);
    expect(effectsOf(w, a) & EFFECT_CASTING).toBe(EFFECT_CASTING);
    a.rt.cast = pendingCast(w, 0);
    expect(effectsOf(w, a) & EFFECT_CASTING).toBe(0);
    a.rt.cast = null;
    apply(w, "a", "a", "hidden", 1000);
    expect(effectsOf(w, a) & EFFECT_HIDDEN).toBe(EFFECT_HIDDEN);
    apply(w, "a", "c", "zoned", 1000, { data: { fieldId: "f", dealtMult: 0.8, takenFromSourceMult: 1.2 } });
    expect(effectsOf(w, a) & EFFECT_ZONED).toBe(EFFECT_ZONED);
    w.state.serverTime += 1000;
    expect(effectsOf(w, a)).toBe(0);
  });

  it("refreshEffects writes the synced field only when the bits changed", () => {
    let writes = 0;
    let bits = 0;
    const s = {
      get effects() { return bits; },
      set effects(v: number) { writes++; bits = v; },
    };
    const w = arena();
    const c = { kind: "player", id: "z", s, rt: { statuses: [] as StatusInstance[], cast: null } } as unknown as Combatant;
    refreshEffects(w, c);
    expect(writes).toBe(0);
    c.rt.statuses!.push({ kind: "stun", source: src("b"), startedAt: now(w), until: now(w) + 100, value: 0 });
    refreshEffects(w, c);
    refreshEffects(w, c);
    expect(writes).toBe(1);
    expect(bits).toBe(EFFECT_STUNNED);
    w.state.serverTime += 200;
    refreshEffects(w, c);
    expect([writes, bits]).toEqual([2, 0]);
  });

  it("mobs carry the same bits", () => {
    const w = arena();
    const mob = C(w, placeMob(w, { region: "plague", elite: false, at: { x: 700, y: 320 } }));
    addStatus(w, mob, { kind: "slowMove", source: src("a"), ms: 1000, value: 0.3 });
    expect(mob.s.effects).toBe(EFFECT_SLOWED);
    expect(isSlowed(w, mob)).toBe(true);
    expect(statusMoveMultiplier(w, mob)).toBeCloseTo(0.7, 12);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("fields", () => {
  const rawWorld = (): World => createWorld({
    config: { minPlayers: 2, lobbySeconds: 1, fillSeconds: 1, patienceSeconds: 1, patienceMinSeconds: 1, suddenDeathSeconds: 1 },
    random: mulberry32(1), map: openMap(),
  });
  const base = (w: World) => ({
    kind: "zone" as const, ability: "trial" as const, owner: src("a"), subject: "b", x: 100, y: 200, x2: 0, y2: 0, r: 300, vx: 0, vy: 0,
    startedAt: now(w), endsAt: now(w) + 5000,
  });

  it("the runtime is created on first use; before it, there is nothing", () => {
    const w = rawWorld();
    expect(w.abilities).toBeNull();
    expect(fieldsOf(w).size).toBe(0);
    expect(removeField(w, "fld1")).toBeNull();
    expect(removeFieldsWhere(w, () => true)).toEqual([]);
    const rt = abilitiesRt(w);
    expect(rt).toBe(w.abilities);
    expect(abilitiesRt(w)).toBe(rt);
    expect(rt.fields.size).toBe(0);
  });

  it("addField mirrors an entry into the synced state once, with the wire codes, and gives it a unique id", () => {
    const w = rawWorld();
    w.state.serverTime = 1234;
    const f1 = addField(w, { ...base(w), startedAt: 1234, endsAt: 6234 });
    const f2 = addField(w, { ...base(w), kind: "trail", ability: "blaze", subject: null, x2: 50, y2: 60, r: 20, owner: src("c") });
    expect(f1.id).not.toBe(f2.id);
    expect(fieldsOf(w).get(f1.id)).toBe(f1);
    const s1 = w.state.fields.get(f1.id)!;
    expect(s1).toMatchObject({ kind: FIELD_KINDS.indexOf("zone"), ability: ABILITY_IDS.indexOf("trial"), x: 100, y: 200, r: 300, owner: "a", subject: "b", startedAt: 1234, endsAt: 6234 });
    const s2 = w.state.fields.get(f2.id)!;
    expect(s2).toMatchObject({ kind: FIELD_KINDS.indexOf("trail"), ability: ABILITY_IDS.indexOf("blaze"), x2: 50, y2: 60, r: 20, owner: "c", subject: "" });
    expect(w.state.fields.size).toBe(2);
  });

  it("removeField and removeFieldsWhere delete from both tables and return what they removed", () => {
    const w = rawWorld();
    const f1 = addField(w, base(w));
    const f2 = addField(w, { ...base(w), kind: "cloud", ability: "swarm", subject: null, owner: src("c") });
    const f3 = addField(w, { ...base(w), kind: "cloud", ability: "swarm", subject: null, owner: src("c") });
    expect(removeField(w, f1.id)).toBe(f1);
    expect(w.state.fields.has(f1.id)).toBe(false);
    expect(removeField(w, f1.id)).toBeNull();
    expect(removeFieldsWhere(w, (f) => f.owner.id === "c")).toEqual([f2, f3]);
    expect(fieldsOf(w).size).toBe(0);
    expect(w.state.fields.size).toBe(0);
    expect(removeFieldsWhere(w, () => true)).toEqual([]);
  });

  it("onTrail: within the half-width of the segment, ends included", () => {
    const w = rawWorld();
    const f = addField(w, { ...base(w), kind: "trail", ability: "blaze", subject: null, x: 100, y: 100, x2: 200, y2: 100, r: 20 });
    expect(onTrail(f, { x: 150, y: 100 })).toBe(true);
    expect(onTrail(f, { x: 150, y: 120 })).toBe(true);
    expect(onTrail(f, { x: 150, y: 121 })).toBe(false);
    expect(onTrail(f, { x: 85, y: 100 })).toBe(true);
    expect(onTrail(f, { x: 79, y: 100 })).toBe(false);
    expect(onTrail(f, { x: 215, y: 105 })).toBe(true);
    expect(onTrail(f, { x: 230, y: 100 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("displace", () => {
  it("puts a fighter at the point, resets its rewind history, counts the displacement and wraps the counter at 256", () => {
    const w = arena();
    const a = C(w, "a");
    run(w, 3);
    expect(w.players.get("a")!.history.length).toBeGreaterThan(1);
    displace(w, a, { x: 480, y: 160 });
    expect([a.s.x, a.s.y]).toEqual([480, 160]);
    expect(w.players.get("a")!.history).toEqual([{ t: now(w), x: 480, y: 160 }]);
    expect(a.s.displaceSeq).toBe(1);
    a.s.displaceSeq = 255;
    displace(w, a, { x: 500, y: 160 });
    expect(a.s.displaceSeq).toBe(0);
  });

  it("re-plans a walk in hand from the new point to its last waypoint", () => {
    const w = arena();
    const a = C(w, "a");
    enqueueClientMessage(a.rt.inputs, "move", { x: 600, y: 320 });
    run(w, 2);
    expect(a.rt.path.length).toBeGreaterThan(0);
    const goal = a.rt.path[a.rt.path.length - 1]!;
    displace(w, a, { x: 560, y: 120 });
    expect(a.rt.path.length).toBeGreaterThan(0);
    const last = a.rt.path[a.rt.path.length - 1]!;
    expect(last.x).toBeCloseTo(goal.x, 6);
    expect(last.y).toBeCloseTo(goal.y, 6);
    run(w, 40);
    expect(Math.hypot(a.s.x - goal.x, a.s.y - goal.y)).toBeLessThan(1);
  });

  it("drops a walk whose goal cannot be reached from the new point; no walk in hand stays none", () => {
    const w = arena(["a", "b"], { map: splitMap() });
    const a = C(w, "a");
    a.rt.path = [{ x: tileCentre(30), y: tileCentre(10) }];
    displace(w, a, { x: tileCentre(5), y: tileCentre(10) });
    expect(a.rt.path).toEqual([]);
    const b = C(w, "b");
    displace(w, b, { x: tileCentre(6), y: tileCentre(10) });
    expect(b.rt.path).toEqual([]);
  });

  it("works on a mob", () => {
    const w = arena();
    const mob = C(w, placeMob(w, { region: "fire", elite: false, at: { x: 700, y: 320 } }));
    displace(w, mob, { x: 650, y: 300 });
    expect([mob.s.x, mob.s.y, mob.s.displaceSeq]).toEqual([650, 300, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The hooks in the rest of the sim.

describe("stun in the weapon, swap, pickup and aim paths (D5)", () => {
  it("a stunned fighter starts no attack, even with the trigger held, and starts one when the stun is over", () => {
    const w = arena();
    const a = C(w, "a");
    let started = 0;
    chainHook(w, "attackStarted", (_w, c) => { if (c.id === "a") started++; });
    apply(w, "a", "b", "stun", 500);
    enqueueClientMessage(a.rt.inputs, "attack", { a: 0 });
    run(w, 8);
    expect(a.rt.weapon.action).toBeNull();
    expect(a.s.readyAt).toBe(0);
    expect(started).toBe(0);
    run(w, 6);
    expect(started).toBeGreaterThan(0);
    expect(a.s.readyAt).toBeGreaterThan(0);
  });

  it("a stunned fighter cannot swap or pick up (a toast says so), and a root alone does not stop either", () => {
    const w = arena();
    const a = C(w, "a");
    P(w, "a").weapon1 = "sword";
    apply(w, "a", "b", "stun", 400);
    enqueueClientMessage(a.rt.inputs, "swap", {});
    enqueueClientMessage(a.rt.inputs, "pickup", { containerId: "none" });
    const events = tick(w);
    expect(P(w, "a").slot).toBe(0);
    expect(events.filter((e) => e.type === "toast")).toEqual([{ type: "toast", to: "a", text: "Can't do that now" }]);
    run(w, 10);
    enqueueClientMessage(a.rt.inputs, "swap", {});
    tick(w);
    expect(P(w, "a").slot).toBe(1);
    const b = C(w, "b");
    P(w, "b").weapon1 = "sword";
    apply(w, "b", "a", "root", 1000);
    enqueueClientMessage(b.rt.inputs, "swap", {});
    tick(w);
    expect(P(w, "b").slot).toBe(1);
  });

  it("a stunned fighter's facing is frozen: aim inputs are dropped", () => {
    const w = arena();
    P(w, "a").facing = 0.5;
    apply(w, "a", "b", "stun", 400);
    enqueueClientMessage(C(w, "a").rt.inputs, "aim", { a: 2 });
    tick(w);
    expect(P(w, "a").facing).toBe(0.5);
    // The low-level trigger carries an aim too (the game client never sends it): no turning with it either.
    enqueueClientMessage(C(w, "a").rt.inputs, "attack", { a: 2.5 });
    enqueueClientMessage(C(w, "a").rt.inputs, "release", { a: 2.6 });
    tick(w);
    expect(P(w, "a").facing).toBe(0.5);
    run(w, 10);
    enqueueClientMessage(C(w, "a").rt.inputs, "aim", { a: 2 });
    tick(w);
    expect(P(w, "a").facing).toBe(2);
  });

  it("a silenced or rooted fighter still aims and attacks", () => {
    const w = arena();
    apply(w, "a", "b", "silence", 5000);
    apply(w, "a", "b", "root", 5000);
    enqueueClientMessage(C(w, "a").rt.inputs, "aim", { a: 1.5 });
    enqueueClientMessage(C(w, "a").rt.inputs, "attack", { a: 1.5 });
    tick(w);
    expect(P(w, "a").facing).toBe(1.5);
    expect(C(w, "a").rt.weapon.action).not.toBeNull();
  });
});

describe("the target lock and untargetability (D1)", () => {
  const near = (): World => arena([{ id: "a", at: { x: 300, y: 320 } }, { id: "b", at: { x: 360, y: 320 } }, { id: "c", at: { x: 900, y: 600 } }]);

  it("a `target` on a hidden or untargetable fighter is refused; a revealed one is lockable again", () => {
    const w = near();
    apply(w, "b", "b", "hidden", 8000);
    enqueueClientMessage(C(w, "a").rt.inputs, "target", { id: "b" });
    tick(w);
    expect(C(w, "a").rt.weapon.lock).toBeNull();
    expect(P(w, "a").attackTarget).toBe("");
    reveal(w, C(w, "b"), now(w) + 500);
    enqueueClientMessage(C(w, "a").rt.inputs, "target", { id: "b" });
    tick(w);
    expect(C(w, "a").rt.weapon.lock).toBe("b");
    const w2 = near();
    apply(w2, "b", "c", "untargetable", 3000);
    enqueueClientMessage(C(w2, "a").rt.inputs, "target", { id: "b" });
    tick(w2);
    expect(C(w2, "a").rt.weapon.lock).toBeNull();
  });

  it("an existing lock on a fighter that turns untargetable is dropped in the next tick, and the chaser stops", () => {
    const w = near();
    enqueueClientMessage(C(w, "a").rt.inputs, "target", { id: "b" });
    tick(w);
    expect(C(w, "a").rt.weapon.lock).toBe("b");
    apply(w, "b", "b", "hidden", 8000);
    tick(w);
    expect(C(w, "a").rt.weapon.lock).toBeNull();
    expect(P(w, "a").attackTarget).toBe("");
    expect(C(w, "a").rt.path).toEqual([]);
    expect(C(w, "a").rt.weapon.held).toBe(false);
  });

  it("a stunned locker keeps its lock and its path but neither chases, aims nor attacks until the stun ends", () => {
    const w = arena([{ id: "a", at: { x: 200, y: 320 } }, { id: "b", at: { x: 520, y: 320 } }, { id: "c", at: { x: 900, y: 600 } }]);
    enqueueClientMessage(C(w, "a").rt.inputs, "target", { id: "b" });
    tick(w);
    expect(C(w, "a").rt.weapon.lock).toBe("b");
    apply(w, "a", "c", "stun", 600);
    const x0 = P(w, "a").x;
    const facing = P(w, "a").facing;
    run(w, 8);
    expect(C(w, "a").rt.weapon.lock).toBe("b");
    expect(P(w, "a").x).toBe(x0);
    expect(P(w, "a").facing).toBe(facing);
    expect(C(w, "a").rt.weapon.action).toBeNull();
    run(w, 20);
    expect(P(w, "a").x).toBeGreaterThan(x0 + 10);
  });
});

describe("a locked attack is not re-aimed at a fighter that turned untargetable (lockedFoe)", () => {
  /** `a` (an axe) locks `b`, whose swing's start aim is east; then `b` steps to the south, hidden or not; returns the angle the swing lands along. */
  const swingAngle = (hide: boolean): number => {
    const w = arena([{ id: "a", at: { x: 300, y: 320 } }, { id: "b", at: { x: 340, y: 320 } }, { id: "c", at: { x: 1100, y: 600 } }]);
    enqueueClientMessage(C(w, "a").rt.inputs, "target", { id: "b" });
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && C(w, "a").rt.weapon.action === null; i++) events.push(...tick(w));
    const action = C(w, "a").rt.weapon.action;
    expect(action, "a's attack started").not.toBeNull();
    expect(action!.target).toBe("b");
    expect(action!.a).toBeCloseTo(0, 6);
    put(w, "b", 300, 380);
    if (hide) apply(w, "b", "b", "hidden", 8000);
    for (let i = 0; i < 20 && fxOf(events, "swing").length === 0; i++) events.push(...tick(w));
    const swing = fxOf(events, "swing").find((f) => f.by === "a");
    expect(swing, "a's swing landed").toBeDefined();
    return swing!.a;
  };

  it("lands along the aim it started with once its target is hidden, and still follows a target that is not", () => {
    expect(Math.abs(swingAngle(true))).toBeLessThan(1e-6);
    expect(swingAngle(false)).toBeGreaterThan(1);
  });
});

describe("mobs and statuses (D13)", () => {
  const woken = () => {
    const w = arena(["p0", "p1"]);
    put(w, "p0", 600, 320);
    put(w, "p1", 640, 320);
    for (const id of ["p0", "p1"]) { const p = P(w, id); p.weapon0 = ""; p.hp = p.maxHp = 1e9; }
    const mob = C(w, placeMob(w, { region: "fire", elite: false, at: { x: 800, y: 320 } }));
    return { w, mob, brain: w.mobs.get(mob.id)!.brain! };
  };
  /** Hits, one ledger pass each and in this order, so the first one named wakes the mob onto its target. */
  const aggro = (w: World, mob: Combatant, ...by: Array<[string, number]>): void => {
    for (const [id, amount] of by) {
      recordHit(w, { victim: mob.id, by: src(id), packet: { raw: amount, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
      applyLedger(w);
    }
  };

  it("a stunned mob's inputs are drained and its AI does not think; it goes on afterwards", () => {
    const { w, mob, brain } = woken();
    aggro(w, mob, ["p0", 5]);
    expect(brain.mode).toBe("fight");
    run(w, 2);
    expect(mob.rt.path.length).toBeGreaterThan(0);
    addStatus(w, mob, { kind: "stun", source: src("p0"), ms: 800 });
    mob.rt.path = [];
    const at = { x: mob.s.x, y: mob.s.y };
    mob.rt.inputs.pushMove({ kind: "move", x: 100, y: 100 });
    run(w, 8);
    expect([mob.s.x, mob.s.y]).toEqual([at.x, at.y]);
    expect(mob.rt.path).toEqual([]);
    expect(mob.rt.inputs.drain().move).toBeNull();
    run(w, 30);
    expect(Math.hypot(mob.s.x - at.x, mob.s.y - at.y)).toBeGreaterThan(20);
  });

  it("a hidden player is not picked: the mob turns on someone else, keeps the hidden one's threat, and with no one else gives up", () => {
    const { w, mob, brain } = woken();
    aggro(w, mob, ["p0", 50], ["p1", 5]);
    expect(brain.target).toBe("p0");
    apply(w, "p0", "p0", "hidden", 8000);
    run(w, 2);
    expect(brain.mode).toBe("fight");
    expect(brain.target).toBe("p1");
    expect(brain.threat.has("p0")).toBe(true);
    apply(w, "p1", "p1", "untargetable", 8000);
    run(w, 2);
    // It went home (a mob that never left its camp is idle again at once).
    expect(brain.mode).not.toBe("fight");
    expect(brain.target).toBeNull();
  });
});

describe("hooks fire for the ends of a fighter's fight", () => {
  it("fighterOut for a death (down), for removePlayer and abandonPlayer (removed), a mob's death (down); not runEnded", () => {
    const w = arena(["a", "b", "c", "d"]);
    const log: string[] = [];
    chainHook(w, "fighterOut", (_w, id, cause) => { log.push(`${id}:${cause}`); });
    chainHook(w, "runEnded", () => { log.push("end"); });
    P(w, "a").hp = 1;
    recordHit(w, { victim: "a", by: src("b"), packet: { raw: 50, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    expect(log).toEqual(["a:down"]);
    const mobId = placeMob(w, { region: "fire", elite: false, at: { x: 700, y: 320 } });
    w.mobs.get(mobId)!.brain!.threat.set("b", 1);
    recordHit(w, { victim: mobId, by: src("b"), packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    expect(log).toEqual(["a:down", `${mobId}:down`]);
    removePlayer(w, "c");
    expect(log.slice(2)).toEqual(["c:down", "c:removed"]);
    abandonPlayer(w, "d");
    expect(log.slice(4)).toEqual(["d:removed"]);
    expect(log).not.toContain("end");
  });

  it("runEnded fires once when the run ends", () => {
    const w = arena(["a", "b"]);
    let ended = 0;
    chainHook(w, "runEnded", () => { ended++; });
    P(w, "a").hp = 1;
    recordHit(w, { victim: "a", by: src("b"), packet: { raw: 50, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false });
    applyLedger(w);
    tick(w);
    expect(w.state.phase).toBe("ended");
    expect(ended).toBe(1);
    run(w, 5);
    expect(ended).toBe(1);
  });

  it("attackStarted fires when an attack starts, staggered when a stagger takes", () => {
    const w = arena();
    const started: string[] = [];
    const staggered: string[] = [];
    chainHook(w, "attackStarted", (_w, c) => { started.push(c.id); });
    chainHook(w, "staggered", (_w, c) => { staggered.push(c.id); });
    enqueueClientMessage(C(w, "a").rt.inputs, "attack", { a: 0 });
    tick(w);
    expect(started).toEqual(["a"]);
    recordHit(w, { victim: "b", by: src("a"), packet: { raw: 5, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: true });
    applyLedger(w);
    expect(staggered).toEqual(["b"]);
    // Immune for a while: the second stagger does not take, so the hook stays quiet.
    recordHit(w, { victim: "b", by: src("a"), packet: { raw: 5, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: true });
    applyLedger(w);
    expect(staggered).toEqual(["b"]);
  });
});

/** One tick in which `fn` runs in the inputs phase, where it records hits that the same tick's ledger then applies. */
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

describe("ability damage in the ledger (D10)", () => {
  const hit = (w: World, extra: Record<string, unknown>): void => {
    recordHit(w, { victim: "b", by: src("a"), packet: { raw: 10, phys: 0, magic: 0, true: 1 }, weapon: null, stagger: false, ...extra });
  };

  it("names the ability in the landed record and the hit fx; a dot ability hit is landed but has no fx of its own", () => {
    const w = arena();
    hit(w, { ability: "freeze" });
    hit(w, { ability: "blaze", dot: true });
    applyLedger(w);
    expect(w.combat.landed).toEqual([
      { victim: "b", by: "a", amount: 10, weapon: null, sig: undefined, ability: "freeze" },
      { victim: "b", by: "a", amount: 10, weapon: null, sig: undefined, ability: "blaze", dot: true },
    ]);
    expect(fxOf(w.events, "hit")).toEqual([{ kind: "hit", id: "b", by: "a", amount: 10, weapon: null, ability: "freeze" }]);
    expect(P(w, "b").hp).toBe(FACTIONS.fire.hp - 20);
  });

  it("is never a signature contact: it neither engages a pair nor sets a target (a weapon hit does)", () => {
    const w = arena(["a", "b"], { signatures: true });
    inStep(w, () => hit(w, { ability: "freeze" }));
    expect(w.factions!.fighters.get("a")?.target ?? null).toBeNull();
    expect(w.factions!.fighters.get("b")?.target ?? null).toBeNull();
    const control = arena(["a", "b"], { signatures: true });
    inStep(control, () => hit(control, { weapon: "axe" }));
    expect(control.factions!.fighters.get("a")?.target).toBe("b");
  });

  it("counts for kill credit like any hit: the caster gets the kill", () => {
    const w = arena();
    P(w, "b").hp = 5;
    hit(w, { ability: "blaze", dot: true });
    applyLedger(w);
    expect(P(w, "b").status).toBe("dead");
    expect(w.players.get("b")!.killedBy).toBe("A");
    expect(P(w, "a").kills).toBe(1);
  });
});

describe("a quiet world pays nothing for statuses", () => {
  it("the queries are neutral and allocate no table", () => {
    const w = arena();
    const a = C(w, "a");
    expect(damageFactor(w, "a", "b")).toBe(1);
    expect(floorHp(w, "b", 100, 10)).toBe(90);
    expect(healFactor(w, a)).toBe(1);
    expect(statusMoveMultiplier(w, a)).toBe(1);
    expect([isStunned(w, a), actionBlocked(w, a), isUntargetable(w, a), cannotMove(w, a)]).toEqual([false, false, false, false]);
    expect(effectsOf(w, a)).toBe(0);
    expect(statusesOf(a)).toEqual([]);
    expect(a.rt.statuses).toBeUndefined();
    expect(P(w, "a").effects).toBe(0);
  });
});

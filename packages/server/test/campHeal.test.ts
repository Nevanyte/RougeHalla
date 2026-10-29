// Camp-clear recovery: the final mob stores a potion for each eligible contributor, without healing or a ground pickup.
import { describe, expect, it } from "vitest";
import {
  CAMP_HEAL_RANGE, campHealAmount, mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type CampDef, type FactionId, type FxEvent,
  type GameMap, type Vec2,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { downPlayer } from "../src/sim/arena";
import { campContribOf, noteCampContributors, payCampHeal } from "../src/sim/campHeal";
import { combatant } from "../src/sim/combatant";
import { heal, noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { hurtMob, killMob, type MobCombatant } from "../src/sim/mobLife";
import { addStatus } from "../src/sim/status";
import { addPlayer, removePlayer, startRaid, step } from "../src/sim/step";
import { enqueueClientMessage } from "../src/sim/inputs";
import { installTraining } from "../src/sim/training";
import { chainHook, type LedgerEntry, type SimEvent, type World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

// ---------------------------------------------------------------------------------------------------------------- rig

const W_TILES = 40;
const H_TILES = 20;
const at = (t: number): number => t * TILE + TILE / 2;

/** An open arena with two camps of three: a Fire camp (camp 0) around tile (10, 5) and a Holy camp (camp 1) around (30, 5). */
function campMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const camp = (id: string, zone: FactionId, tx: number): CampDef => ({
    id, zone, x: at(tx), y: at(5), r: 96,
    spots: [{ x: at(tx - 1), y: at(4) }, { x: at(tx + 1), y: at(4) }, { x: at(tx), y: at(7) }],
    eliteSpot: -1, chest: { x: at(tx), y: at(5) }, area: 0, radius: 288,
  });
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: at(3 + 4 * i), y: at(15) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns, camps: [camp("fire-1", "fire", 10), camp("holy-1", "holy", 30)] };
}

interface RunOpts { players?: number; faction?: FactionId; signatures?: boolean; map?: GameMap }

/** A run on campMap with p0, p1, ... started on the first step; everyone stands next to camp 0's centre by default. */
function run(o: RunOpts = {}): World {
  const n = o.players ?? 3;
  const w = createGameWorld({
    config: { minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
    random: mulberry32(12),
    rewardSalt: 99,
    map: o.map ?? campMap(),
  }, { signatures: o.signatures ?? false });
  for (let i = 0; i < n; i++) addPlayer(w, `p${i}`, `name${i}`, { faction: o.faction ?? "frost" });
  step(w, TICK_MS);
  expect(w.state.phase).toBe("active");
  for (let i = 0; i < n; i++) place(w, i, { x: at(10), y: at(5) }, 40 * i, 0);
  w.events.length = 0;
  return w;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const campMobs = (w: World, camp: number): MobCombatant[] =>
  [...w.state.mobs].filter(([, m]) => m.camp === camp + 1).map(([id]) => combatant(w, id) as MobCombatant);

function place(w: World, i: number, p: Vec2, dx = 0, dy = 0): void {
  P(w, i).x = p.x + dx;
  P(w, i).y = p.y + dy;
  RT(w, i).history = [{ t: w.state.serverTime, x: P(w, i).x, y: P(w, i).y }];
}

const fxOf = <K extends FxEvent["kind"]>(events: readonly SimEvent[], kind: K): Array<Fx<K>> =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Fx<K>] : []));
/** The camp-clear toasts `to` was sent (a clear can also arm a fists killer, which toasts too). */
const toasts = (events: readonly SimEvent[], to: string): string[] =>
  events.flatMap((e) => (e.type === "toast" && e.to === to && e.text.startsWith("Camp cleared") ? [e.text] : []));

const entryBy = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});

/** `by` damages `mob` for `amount` outside a ledger pass (hurtMob's own bookkeeping); not lethal. */
function wound(w: World, mob: MobCombatant, by: string, amount = 1): void {
  hurtMob(w, mob, [amount], [entryBy(mob.id, by, amount)]);
  expect(mob.s.status).toBe("alive");
}

/** `by` kills every living mob of `camp` with one big hit each, in one ledger pass (the spoils are paid after it). */
function killCamp(w: World, camp: number, by = "p0"): SimEvent[] {
  for (const m of campMobs(w, camp)) {
    if (m.s.status !== "alive") continue;
    recordHit(w, { victim: m.id, by: { id: by, name: by }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
  }
  applyLedger(w);
  return w.events.splice(0);
}

const hpTo = (w: World, i: number, frac: number): void => { P(w, i).hp = P(w, i).maxHp * frac; };
const frac = (w: World, i: number): number => P(w, i).hp / P(w, i).maxHp;

// ---------------------------------------------------------------------------------------------------------------- who is healed

describe("camp-clear heal: who is paid", () => {
  it("stores a potion for eligible contributors, excludes observers and heals nobody immediately", () => {
    const w = run();
    hpTo(w, 0, 0.4); hpTo(w, 1, 0.95); hpTo(w, 2, 0.5);
    wound(w, campMobs(w, 0)[0]!, "p1");
    const before = [P(w, 0).hp, P(w, 1).hp, P(w, 2).hp];
    const ev = killCamp(w, 0, "p0");
    expect([P(w, 0).hp, P(w, 1).hp, P(w, 2).hp]).toEqual(before);
    expect(RT(w, 0).campsCleared).toBe(1); expect(RT(w, 1).campsCleared).toBe(1);
    expect(RT(w, 2).campsCleared).toBeUndefined();
    expect([P(w, 0).potionLarge, P(w, 1).potionLarge, P(w, 2).potionLarge]).toEqual([1, 1, 0]);
    expect([...w.state.containers.values()].filter(c => c.items[0]?.def === "potionLarge")).toHaveLength(0);
    expect(fxOf(ev, "campHeal")).toEqual([]); expect(fxOf(ev, "heal")).toEqual([]);
    expect(fxOf(ev, "campCleared")).toEqual([{ kind: "campCleared", camp: 0 }]);
  });

  it("counts a lethal hit: a player whose only damage was the killing blow on one mob is paid", () => {
    const w = run();
    hpTo(w, 1, 0.3);
    const mobs = campMobs(w, 0);
    wound(w, mobs[0]!, "p0");
    wound(w, mobs[1]!, "p0");
    const last = mobs[2]!;
    recordHit(w, { victim: last.id, by: { id: "p1", name: "p1" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    for (const m of mobs.slice(0, 2)) killMob(w, m, [], []);
    expect(frac(w, 1)).toBe(0.3);
    expect(RT(w, 1).campsCleared).toBe(1);
  });

  it("counts the damage dealt since the camp was engaged, not only in the clearing tick", () => {
    const w = run();
    hpTo(w, 1, 0.5);
    const [a] = campMobs(w, 0);
    wound(w, a!, "p1", 3);
    step(w, TICK_MS);
    step(w, TICK_MS);
    expect(campContribOf(w, 0)).toEqual(new Set(["p1"]));
    killCamp(w, 0, "p0");
    expect(frac(w, 1)).toBe(0.5);
    expect(RT(w, 1).campsCleared).toBe(1);
  });

  it("does not count damage that did nothing (fully absorbed, amount 0) or a hit on another camp", () => {
    const w = run();
    hpTo(w, 1, 0.5);
    hpTo(w, 2, 0.5);
    const [a] = campMobs(w, 0);
    hurtMob(w, a!, [0], [entryBy(a!.id, "p1", 5)]);
    wound(w, campMobs(w, 1)[0]!, "p2"); // the Holy camp, a different clear
    expect(campContribOf(w, 0).size).toBe(0);
    expect(campContribOf(w, 1)).toEqual(new Set(["p2"]));
    killCamp(w, 0, "p0");
    expect(frac(w, 1)).toBe(0.5);
    expect(frac(w, 2)).toBe(0.5);
  });

  it("pays only a player who is standing at the clear: one who went down, or left, gets nothing and does not break it", () => {
    const w = run({ players: 4 });
    for (const i of [0, 1, 2, 3]) hpTo(w, i, 0.5);
    for (const [i, m] of campMobs(w, 0).entries()) wound(w, m, `p${i}`);
    wound(w, campMobs(w, 0)[0]!, "p3");
    downPlayer(w, P(w, 1), RT(w, 1), "died");
    removePlayer(w, "p3");
    const hpDead = P(w, 1).hp;
    killCamp(w, 0, "p0");
    expect(frac(w, 0)).toBe(0.5);
    expect(RT(w, 0).campsCleared).toBe(1);
    expect(frac(w, 2)).toBe(0.5);
    expect(RT(w, 2).campsCleared).toBe(1);
    expect(P(w, 1).hp).toBe(hpDead);
    expect([P(w, 0).potionLarge, P(w, 1).potionLarge, P(w, 2).potionLarge]).toEqual([1, 0, 1]);
    expect(w.players.has("p3")).toBe(false);
  });

  it("pays inside CAMP_HEAL_RANGE of the camp's centre and not beyond it (no territory on this map)", () => {
    const w = run();
    hpTo(w, 0, 0.5);
    hpTo(w, 1, 0.5);
    hpTo(w, 2, 0.5);
    const c = w.map.camps[0]!;
    place(w, 0, c, CAMP_HEAL_RANGE - 4, 0); // just inside
    place(w, 1, c, CAMP_HEAL_RANGE + 4, 0); // just outside
    place(w, 2, c, 0, 8 * TILE); // inside
    for (const [i, m] of campMobs(w, 0).entries()) wound(w, m, `p${i}`); // all three fought the camp
    killCamp(w, 0, "p0");
    expect(frac(w, 0)).toBe(0.5);
    expect(RT(w, 0).campsCleared).toBe(1);
    expect(frac(w, 1)).toBe(0.5);
    expect(frac(w, 2)).toBe(0.5);
    expect(RT(w, 2).campsCleared).toBe(1);
    expect([P(w, 0).potionLarge, P(w, 1).potionLarge, P(w, 2).potionLarge]).toEqual([1, 0, 1]);
  });

  it("pays a player inside the camp's territory even past 12 tiles of its centre", () => {
    const map = campMap();
    const tx = 26;
    const ty = 5;
    map.territoryGrid[ty * map.w + tx] = 1; // camp 0's territory reaches tile (26, 5): 16 tiles from its centre
    const w = run({ map });
    hpTo(w, 0, 0.5);
    hpTo(w, 1, 0.5);
    place(w, 0, { x: at(tx), y: at(ty) });
    place(w, 1, { x: at(tx), y: at(ty + 3) }); // outside the territory and past 12 tiles
    expect(Math.hypot(P(w, 0).x - w.map.camps[0]!.x, P(w, 0).y - w.map.camps[0]!.y)).toBeGreaterThan(CAMP_HEAL_RANGE);
    for (const m of campMobs(w, 0)) { wound(w, m, "p0"); wound(w, m, "p1"); }
    killCamp(w, 0, "p0");
    expect(frac(w, 0)).toBe(0.5);
    expect(RT(w, 0).campsCleared).toBe(1);
    expect(frac(w, 1)).toBe(0.5);
  });

  it("heals nobody when nobody damaged the camp, and pays a player's own camps_cleared count only for those it was paid in", () => {
    const w = run();
    hpTo(w, 0, 0.4);
    for (const m of campMobs(w, 0)) killMob(w, m, [], []); // no killer, no contributors
    expect(frac(w, 0)).toBe(0.4);
    expect(RT(w, 0).campsCleared).toBeUndefined();

    const v = run();
    hpTo(v, 0, 0.4);
    wound(v, campMobs(v, 0)[0]!, "p0");
    wound(v, campMobs(v, 0)[1]!, "p1"); // p1 at full hp: eligible, healed 0
    killCamp(v, 0, "p0");
    expect(RT(v, 0).campsCleared).toBe(1);
    expect(RT(v, 1).campsCleared).toBe(1);
    expect(RT(v, 2).campsCleared).toBeUndefined();
    // p1 was already full: counted, but no fx and no toast
    expect(fxOf(v.events, "campHeal")).toEqual([]);
  });

  it("counts each camp once per player, and a second camp adds a second", () => {
    const w = run({ players: 2 });
    for (const m of campMobs(w, 0)) wound(w, m, "p0");
    killCamp(w, 0, "p0");
    place(w, 0, w.map.camps[1]!);
    for (const m of campMobs(w, 1)) wound(w, m, "p0");
    killCamp(w, 1, "p0");
    expect(RT(w, 0).campsCleared).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------- what the heal is

describe("camp-clear stored recovery", () => {
  it("does not touch lifesteal, combat clocks or landed damage", () => {
    const w = run({ signatures: true, faction: "holy" });
    hpTo(w, 0, 0.4); wound(w, campMobs(w, 0)[0]!, "p0");
    noteContact(w, "p0", "p1");
    const landed = w.combat.landed.length, combatAt = w.factions!.fighters.get("p0")!.combatAt;
    payCampHeal(w, 0);
    expect(w.combat.landed.length).toBe(landed);
    expect(w.factions!.fighters.get("p0")!.combatAt).toBe(combatAt);
    expect(frac(w, 0)).toBe(0.4);
    expect(fxOf(w.events, "heal")).toEqual([]); expect(fxOf(w.events, "campHeal")).toEqual([]);
  });
  it("stores a potion even for a full-health contributor", () => {
    const w = run(); wound(w, campMobs(w, 0)[0]!, "p0"); killCamp(w, 0, "p0");
    expect(P(w, 0).hp).toBe(P(w, 0).maxHp);
    expect(P(w, 0).potionLarge).toBe(1);
    expect([...w.state.containers.values()].filter(c => c.items[0]?.def === "potionLarge")).toHaveLength(0);
  });

  it("awards nothing for a partial camp, then stores one potion on the final member only", () => {
    const w = run(), mobs = campMobs(w, 0);
    hpTo(w, 0, 0.4);
    for (const mob of mobs.slice(0, -1)) {
      recordHit(w, { victim: mob.id, by: { id: "p0", name: "alice" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
      applyLedger(w);
      expect(P(w, 0).potionLarge).toBe(0);
    }
    killCamp(w, 0);
    expect(P(w, 0).potionLarge).toBe(1);
    expect(frac(w, 0)).toBe(0.4);
    payCampHeal(w, 0); // the consumed contributor record cannot award the same clear twice
    expect(P(w, 0).potionLarge).toBe(1);
  });

  it("keeps the bag capped and reports a full bag while preserving the clear credit", () => {
    const w = run();
    P(w, 0).potionLarge = 5;
    hpTo(w, 0, 0.4);
    const events = killCamp(w, 0);
    expect(P(w, 0).potionLarge).toBe(5);
    expect(frac(w, 0)).toBe(0.4);
    expect(RT(w, 0).campsCleared).toBe(1);
    expect(toasts(events, "p0")).toEqual(["Camp cleared · camp potion bag full (5)"]);
    expect([...w.state.containers.values()].some(c => c.items[0]?.def === "potionLarge")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------- the contributor set

describe("campContribOf and the hook chain", () => {
  it("an earlier link of the campCleared chain reads the contributors; they are gone once the heal's link has run", () => {
    const w = run();
    hpTo(w, 0, 0.5);
    const prev = w.hooks.campCleared!;
    let seen: ReadonlySet<string> | null = null;
    w.hooks.campCleared = (world, camp) => { seen = campContribOf(world, camp); prev(world, camp); };
    let after: ReadonlySet<string> | null = null;
    chainHook(w, "campCleared", (world, camp) => { after = campContribOf(world, camp); });
    const [a, b] = campMobs(w, 0);
    wound(w, a!, "p1");
    wound(w, b!, "p2");
    expect(campContribOf(w, 0)).toEqual(new Set(["p1", "p2"]));
    killCamp(w, 0, "p0");
    expect(seen).toEqual(new Set(["p0", "p1", "p2"]));
    expect(after).toEqual(new Set());
    expect(w.campContrib!.has(0)).toBe(false);
  });

  it("campContribOf is a snapshot: changing it changes nothing, and an unhurt camp is empty", () => {
    const w = run();
    expect(campContribOf(w, 0).size).toBe(0);
    expect(campContribOf(w, 99).size).toBe(0);
    wound(w, campMobs(w, 0)[0]!, "p1");
    (campContribOf(w, 0) as Set<string>).add("p2");
    expect(campContribOf(w, 0)).toEqual(new Set(["p1"]));
  });

  it("noteCampContributors ignores mobs' and strangers' entries, zero amounts and a camp-less mob", () => {
    const w = run();
    noteCampContributors(w, 1, [entryBy("m", "m7", 5), entryBy("m", "ghost", 5), entryBy("m", "p0", 5), entryBy("m", "p1", 5)], [5, 5, 0, 5]);
    expect(campContribOf(w, 0)).toEqual(new Set(["p1"]));
    noteCampContributors(w, 0, [entryBy("m", "p0", 5)], [5]);
    expect(w.campContrib!.size).toBe(1);
  });

  it("a camp cleared twice (a stray second call) pays once", () => {
    const w = run();
    hpTo(w, 0, 0.4);
    wound(w, campMobs(w, 0)[0]!, "p0");
    killCamp(w, 0, "p0");
    const hp = P(w, 0).hp;
    payCampHeal(w, 0);
    expect(P(w, 0).hp).toBe(hp);
    expect(RT(w, 0).campsCleared).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------- training

describe("camp-clear heal: training rooms", () => {
  function training(): World {
    const w = createGameWorld({
      seed: 1234, config: { minPlayers: 8, lobbySeconds: 120, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 2, dummies: true, training: true },
      random: mulberry32(1235),
    });
    installTraining(w);
    addPlayer(w, "p0", "alice", { faction: "fire" });
    startRaid(w);
    return w;
  }
  const practice = (w: World): MobState[] => [...w.state.mobs.values()].filter((m) => m.kind === "mob" || m.kind === "elite");
  /** What a client's `train` message does: accepted at the door of a training room, applied by the next tick. */
  const enqueue = (w: World, msg: unknown): void => {
    expect(enqueueClientMessage(w.players.get("p0")!.inputs, "train", msg, { training: true })).toBe(true);
  };

  it("a practice camp stores one potion instead of immediate healing", () => {
    const w = training();
    enqueue(w, { cmd: "camp", id: "emberImp" });
    for (let i = 0; i < 3; i++) step(w, TICK_MS);
    expect(practice(w)).toHaveLength(3);
    expect(w.state.camps.length).toBe(0);
    const p = w.state.players.get("p0")!;
    p.hp = p.maxHp * 0.4;
    const ids = practice(w).map((m) => [...w.state.mobs].find(([, x]) => x === m)![0]);
    const events: SimEvent[] = [];
    for (const id of ids) {
      recordHit(w, { victim: id, by: { id: "p0", name: "alice" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
      applyLedger(w);
      events.push(...w.events.splice(0));
    }
    expect(p.hp / p.maxHp).toBe(0.4);
    expect(fxOf(events, "campHeal")).toEqual([]);
    expect(p.potionLarge).toBe(1);
    expect([...w.state.containers.values()].filter(c => c.items[0]?.def === "potionLarge")).toHaveLength(0);
    expect(fxOf(events, "campCleared")).toEqual([]); // no map camp to name
  });

  it("the heal waits for the camp's last mob", () => {
    const w = training();
    enqueue(w, { cmd: "camp", id: "emberImp" });
    for (let i = 0; i < 3; i++) step(w, TICK_MS);
    const p = w.state.players.get("p0")!;
    p.hp = p.maxHp * 0.4;
    const ids = [...w.state.mobs].filter(([, m]) => m.kind === "mob").map(([id]) => id);
    recordHit(w, { victim: ids[0]!, by: { id: "p0", name: "alice" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    w.events.length = 0;
    expect(p.hp / p.maxHp).toBe(0.4);
  });

});

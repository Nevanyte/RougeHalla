// The camp runtime and the contested shared chest (roguelike R5; sim/camps.ts, sim/chests.ts, mobAI.ts camp-wide aggro):
// a camp is engaged, then cleared for good; its chest drops on the camp's chest tile with three cards from the private reward
// stream (a base card, a conditional or a second base card, an augment); everyone near it takes one pick, first come first served in the tick's secret order; it is gone at exactly
// CHEST_SECONDS, at the teleport and when the run ends.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  cardDef, cardPower, CHEST_RANGE, CHEST_REFUSAL, CHEST_REFUSALS, CHEST_SECONDS, GV_MOB_CAP, GV_SKIP, mapFromTiles, mulberry32, needsRefusal,
  rollChestOptions, SKIP_HEAL_SHARE, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type CampDef, type FactionId, type FxEvent, type GameMap, type Vec2,
} from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";
import { downPlayer, teleportToColiseum } from "../src/sim/arena";
import { CAMP_CLEARED, CAMP_ENGAGED, CAMP_IDLE } from "../src/sim/camps";
import { clearChests, dropRewardChest, grantCard, rewardChests } from "../src/sim/chests";
import { combatant } from "../src/sim/combatant";
import { noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, MAX_CHOOSE_PICK, parseChoose } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { birthsRemembered } from "../src/sim/loot";
import { hurtMob, killMob, placeMob, type MobCombatant } from "../src/sim/mobLife";
import { modRowsOf } from "../src/sim/mods";
import { addStatus } from "../src/sim/status";
import { actionOrder, addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, SimEvent, World } from "../src/sim/world";
import { withNotLive } from "./support/notLive";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

// ---------------------------------------------------------------------------------------------------------------- rig

const W_TILES = 40;
const H_TILES = 20;
const at = (t: number): number => t * TILE + TILE / 2;

/**
 * An open arena with two camps of three: a Fire camp (camp 0) around tile (10, 5) and a Holy camp (camp 1) around (30, 5),
 * each chest on its centre tile. One wall tile at (12, 5) stands between camp 0's chest and a point 90 u east of it.
 */
function campMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  tiles[5 * W_TILES + 12] = TILE_WALL;
  const camp = (id: string, zone: FactionId, tx: number): CampDef => ({
    id, zone, x: at(tx), y: at(5), r: 96,
    spots: [{ x: at(tx - 1), y: at(4) }, { x: at(tx + 1), y: at(4) }, { x: at(tx), y: at(7) }],
    eliteSpot: -1, chest: { x: at(tx), y: at(5) }, area: 0, radius: 288,
  });
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: at(3 + 4 * i), y: at(15) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns, camps: [camp("fire-1", "fire", 10), camp("holy-1", "holy", 30)] };
}

interface RunOpts { players?: number; salt?: number; signatures?: boolean; random?: () => number; map?: GameMap }

/** A run on campMap with p0, p1, ... (Frost, so nothing of theirs is a card's special case), started on the first step. */
function run(o: RunOpts = {}): World {
  const n = o.players ?? 3;
  const map = o.map ?? campMap();
  if (!o.map) map.camps = map.camps.map((c) => ({ ...c, eliteSpot: 0 }));
  const w = createGameWorld({
    config: {
      minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
      mobs: true, pvpRules: false,
    },
    random: o.random ?? mulberry32(12),
    rewardSalt: o.salt ?? 99,
    map,
  }, { signatures: o.signatures ?? false });
  for (let i = 0; i < n; i++) addPlayer(w, `p${i}`, `name${i}`, { faction: "frost" });
  step(w, TICK_MS);
  expect(w.state.phase).toBe("active");
  return w;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const campMobs = (w: World, camp: number): MobCombatant[] =>
  [...w.state.mobs].filter(([, m]) => m.camp === camp + 1).map(([id]) => combatant(w, id) as MobCombatant);

function fxOf<K extends FxEvent["kind"]>(events: readonly SimEvent[], kind: K): Array<Fx<K>> {
  return events.filter((e): e is Extract<SimEvent, { type: "fx" }> => e.type === "fx").map((e) => e.fx)
    .filter((fx): fx is Fx<K> => fx.kind === kind);
}
const toasts = (events: readonly SimEvent[], to: string): string[] =>
  events.flatMap((e) => (e.type === "toast" && e.to === to ? [e.text] : []));

/** Kills every living mob of `camp` with one big ledger hit each from `by`, in one pass outside a step (spoils at once). */
function clearCamp(w: World, camp: number, by = "p0"): void {
  for (const m of campMobs(w, camp)) {
    if (m.s.status !== "alive") continue;
    recordHit(w, { victim: m.id, by: { id: by, name: by }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
  }
  applyLedger(w);
}

/** Steps once and returns the step's events (plus any emitted since the last step). */
function tick(w: World): SimEvent[] {
  return step(w, TICK_MS);
}

/** Puts a player at `dx, dy` from a point (server position; history follows). */
function place(w: World, i: number, p: Vec2, dx = 0, dy = 0): void {
  P(w, i).x = p.x + dx;
  P(w, i).y = p.y + dy;
  RT(w, i).history = [{ t: w.state.serverTime, x: P(w, i).x, y: P(w, i).y }];
}

const choose = (w: World, i: number, chest: string, pick: number): boolean =>
  enqueueClientMessage(RT(w, i).inputs, "choose", { chest, pick });

const onlyChest = (w: World): ContainerState => {
  const all = rewardChests(w);
  expect(all).toHaveLength(1);
  return all[0]!;
};

// ------------------------------------------------------------------------------------------------------------- camps

describe("camp state: idle, engaged, cleared for good", () => {
  it("goes idle -> engaged on the first damage to any member, and never back", () => {
    const w = run();
    expect([...w.state.camps].map((c) => c.state)).toEqual([CAMP_IDLE, CAMP_IDLE]);
    const [m] = campMobs(w, 0);
    hurtMob(w, m!, [5], [{ victim: m!.id, by: { id: "p0", name: "p0" }, packet: { raw: 5, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false }]);
    expect(w.state.camps[0]!.state).toBe(CAMP_ENGAGED);
    expect(w.state.camps[1]!.state).toBe(CAMP_IDLE);
    // Its target is far beyond the leash: the camp gives up, walks home and rests whole. The camp stays engaged.
    place(w, 0, { x: at(36), y: at(16) });
    for (let i = 0; i < 300; i++) tick(w);
    expect(campMobs(w, 0).every((x) => x.rt.brain!.mode === "idle")).toBe(true);
    expect(w.state.camps[0]!.state).toBe(CAMP_ENGAGED);
    expect(w.state.camps[0]!.alive).toBe(3);
  });

  it("clears on the last death, with the campCleared fx after the death fx, and drops the chest on the camp's chest tile", () => {
    const w = run();
    clearCamp(w, 0);
    expect(w.state.camps[0]!.alive).toBe(0);
    expect(w.state.camps[0]!.state).toBe(CAMP_CLEARED);
    const kinds = w.events.filter((e) => e.type === "fx").map((e) => (e as { fx: FxEvent }).fx.kind);
    expect(kinds.lastIndexOf("death")).toBeLessThan(kinds.indexOf("campCleared"));
    expect(fxOf(w.events, "campCleared")).toEqual([{ kind: "campCleared", camp: 0 }]);
    const box = onlyChest(w);
    expect(box.kind).toBe("reward");
    expect({ x: box.x, y: box.y }).toEqual(w.map.camps[0]!.chest);
    expect(box.camp).toBe(1);
    expect(box.expiresAt).toBe(w.state.serverTime + CHEST_SECONDS * 1000);
    expect(box.items.length).toBe(0);
    expect([...box.takenBy]).toEqual(box.options.map(() => ""));
    expect([...box.pickers]).toEqual([]);
    // Three distinct interactive augments.
    expect(box.options.length).toBe(3);
    expect(new Set(box.options).size).toBe(3);
    expect(box.options.every((id) => cardDef(id)!.kind === "augment")).toBe(true);
    expect(box.options.every((id) => cardDef(id)!.ready === "a")).toBe(true);
  });

  it("clears without a credited killer and grants no chest or pickable reward", () => {
    const w = run();
    for (const m of campMobs(w, 1)) killMob(w, m, [], []);
    expect(w.state.camps[1]!.state).toBe(CAMP_CLEARED);
    expect(rewardChests(w)).toHaveLength(0);
    expect(fxOf(w.events, "campCleared")).toEqual([{ kind: "campCleared", camp: 1 }]);
    for (const m of campMobs(w, 1)) killMob(w, m, [], []);
    expect(rewardChests(w)).toHaveLength(0);
  });

  it("falls back to the camp's centre when the chest tile is a wall", () => {
    const map = campMap();
    map.camps[0] = { ...map.camps[0]!, chest: { x: at(12), y: at(5) } };
    map.camps[0] = { ...map.camps[0]!, eliteSpot: 0 };
    const w = createGameWorld({
      config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
      random: mulberry32(12), rewardSalt: 1, map,
    }, { signatures: false });
    addPlayer(w, "p0", "a", { faction: "frost" });
    step(w, TICK_MS);
    clearCamp(w, 0);
    expect({ x: onlyChest(w).x, y: onlyChest(w).y }).toEqual({ x: map.camps[0]!.x, y: map.camps[0]!.y });
  });

  it("a clear survives the teleport, which puts only the living mobs of other camps back", () => {
    const w = run();
    clearCamp(w, 0);
    const [m] = campMobs(w, 1);
    m!.s.x += 100;
    m!.s.hp = 1;
    teleportToColiseum(w);
    expect(w.state.camps[0]!.state).toBe(CAMP_CLEARED);
    expect(w.state.camps[0]!.alive).toBe(0);
    expect(campMobs(w, 0).every((x) => x.s.status === "dead")).toBe(true);
    expect(m!.s.hp).toBe(m!.s.maxHp);
    for (let i = 0; i < 60; i++) tick(w);
    // Corpses leave the state; nothing comes back.
    expect(campMobs(w, 0)).toEqual([]);
    expect(w.state.camps[0]!.state).toBe(CAMP_CLEARED);
  });
});

describe("elite chests", () => {
  it("drops exactly once on the elite death while its camp's escorts are still alive", () => {
    const map = campMap();
    map.camps[0] = { ...map.camps[0]!, eliteSpot: 0 };
    const w = run({ map });
    const roster = campMobs(w, 0);
    const elite = roster.find((m) => m.s.kind === "elite")!;
    expect(elite).toBeDefined();
    const hit = { victim: elite.id, by: { id: "p0", name: "p0" }, packet: { raw: elite.s.hp, phys: 1, magic: 0, true: 0 }, weapon: "sword" as const, scale: 1, stagger: false };
    hurtMob(w, elite, [elite.s.hp], [hit]);
    expect(roster.filter((m) => m !== elite && m.s.status === "alive")).toHaveLength(2);
    expect(rewardChests(w)).toHaveLength(1);
    hurtMob(w, elite, [elite.s.hp], [hit]);
    expect(rewardChests(w)).toHaveLength(1);
  });

  it("keeps the eligible build snapshot when the elite is the camp's last death", () => {
    const map = campMap();
    map.camps[0] = { ...map.camps[0]!, eliteSpot: 0 };
    const w = run({ map });
    const centre = map.camps[0]!;
    place(w, 0, centre);
    expect(grantCard(w, combatant(w, "p0") as never, "slowBurn")).toBe(1);
    const roster = campMobs(w, 0);
    const hitMob = (mob: MobCombatant): void => {
      hurtMob(w, mob, [mob.s.hp], [{ victim: mob.id, by: { id: "p0", name: "p0" }, packet: { raw: mob.s.hp, phys: 1, magic: 0, true: 0 }, weapon: "sword" as const, scale: 1, stagger: false }]);
    };
    const elite = roster.find((m) => m.s.kind === "elite")!;
    roster.filter((m) => m !== elite).forEach(hitMob);
    expect(rewardChests(w)).toHaveLength(0);
    hitMob(elite);
    expect(rewardChests(w)).toHaveLength(1);
    expect(onlyChest(w).options).not.toContain("slowBurn");
  });

  it.each([false, true])("ignores a contributor killed in the same ledger pass (contributor first: %s)", (contributorFirst) => {
    const w = run();
    const elite = campMobs(w, 0).find((mob) => mob.s.kind === "elite")!;
    for (const mob of campMobs(w, 0)) if (mob.id !== elite.id) killMob(w, mob, [], []);
    place(w, 1, w.map.camps[0]!);
    expect(grantCard(w, combatant(w, "p1") as never, "slowBurn")).toBe(1);
    hurtMob(w, elite, [1], [{ victim: elite.id, by: { id: "p1", name: "b" }, packet: { raw: 1, phys: 0, magic: 0, true: 1 }, weapon: null, scale: 1, stagger: false }]);
    w.rewardRandom = () => 0;
    const eliteHit: LedgerEntry = { victim: elite.id, by: { id: "p0", name: "a" }, packet: { raw: 1e6, phys: 0, magic: 0, true: 1 }, weapon: null, scale: 1, stagger: false };
    const contributorHit: LedgerEntry = { victim: "p1", by: { id: "p2", name: "c" }, packet: { raw: 1e6, phys: 0, magic: 0, true: 1 }, weapon: null, scale: 1, stagger: false };
    for (const hit of contributorFirst ? [contributorHit, eliteHit] : [eliteHit, contributorHit]) recordHit(w, hit);
    applyLedger(w);
    expect(P(w, 1).status).toBe("dead");
    expect(elite.s.status).toBe("dead");
    expect(RT(w, 0).resolved).toBe(false);
    expect(P(w, 0).mobKills).toBe(1);
    expect(onlyChest(w).options).toContain("slowBurn");
  });

  it("places an uncamped elite's reward at the elite's death position", () => {
    const w = run({ map: campMap() });
    const at = { x: P(w, 0).x + 40, y: P(w, 0).y };
    const id = placeMob(w, { region: "fire", elite: true, at });
    const mob = combatant(w, id) as MobCombatant;
    hurtMob(w, mob, [mob.s.hp], [{ victim: id, by: { id: "p0", name: "p0" }, packet: { raw: mob.s.hp, phys: 1, magic: 0, true: 0 }, weapon: "sword" as const, scale: 1, stagger: false }]);
    const box = onlyChest(w);
    expect({ x: box.x, y: box.y }).toEqual(at);
  });

  it("does not drop a chest on an ordinary camp clear", () => {
    const map = campMap();
    map.camps[0] = { ...map.camps[0]!, eliteSpot: -1 };
    const w = run({ map });
    clearCamp(w, 0);
    expect(rewardChests(w)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------- camp-wide aggro (D24)

describe("camp-wide aggro (D24)", () => {
  const hit = (w: World, m: MobCombatant, by: string, amount: number): void => {
    const e: LedgerEntry = { victim: m.id, by: { id: by, name: by }, packet: { raw: amount, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false };
    hurtMob(w, m, [amount], [e]);
  };

  it("one member hurt wakes every idle member of its camp onto the same target, and no other camp", () => {
    const w = run();
    const [a, b, c] = campMobs(w, 0);
    hit(w, a!, "p1", 10);
    for (const m of [a!, b!, c!]) {
      expect(m.rt.brain!.mode, m.id).toBe("fight");
      expect(m.rt.brain!.target, m.id).toBe("p1");
    }
    // The mates hold the target with no threat of their own.
    expect(b!.rt.brain!.threat.get("p1")).toBe(0);
    expect(a!.rt.brain!.threat.get("p1")).toBe(10);
    for (const m of campMobs(w, 1)) expect(m.rt.brain!.mode).toBe("idle");
  });

  it("a member walking home is not woken; an idle one is, even when the hit mob was already fighting", () => {
    const w = run();
    const [a, b, c] = campMobs(w, 0);
    b!.rt.brain!.mode = "return";
    hit(w, a!, "p0", 10);
    expect(b!.rt.brain!.mode).toBe("return");
    expect(c!.rt.brain!.mode).toBe("fight");
    // c rests again while a keeps fighting: the next hit on a wakes c once more.
    c!.rt.brain!.mode = "idle";
    c!.rt.brain!.target = null;
    hit(w, a!, "p2", 3);
    expect(c!.rt.brain!.mode).toBe("fight");
    expect(c!.rt.brain!.target).toBe(a!.rt.brain!.target);
  });

  /** One ledger pass killing `m` outright, from `by`. */
  const slay = (w: World, m: MobCombatant, by: string): void => {
    recordHit(w, { victim: m.id, by: { id: by, name: by }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
  };

  it("a LETHAL hit wakes the idle mates onto the killer too, with no threat of their own, and no other camp", () => {
    const w = run();
    const [a, b, c] = campMobs(w, 0);
    slay(w, a!, "p1");
    expect(a!.s.status).toBe("dead");
    for (const m of [b!, c!]) {
      expect(m.rt.brain!.mode, m.id).toBe("fight");
      expect(m.rt.brain!.target, m.id).toBe("p1");
      expect(m.rt.brain!.threat.get("p1"), m.id).toBe(0);
    }
    expect(a!.rt.brain!.mode).toBe("idle"); // the dead one is reset, not woken
    for (const m of campMobs(w, 1)) expect(m.rt.brain!.mode).toBe("idle");
    // Credit is the dying mob's own: the wake gave the mates nothing to be killed over.
    expect(fxOf(w.events, "death")[0]!.by).toBe("p1");
    expect(RT(w, 1).mobKills).toBe(1);
    slay(w, b!, "p2");
    expect(fxOf(w.events, "death").find((d) => d.id === b!.id)!.by).toBe("p2");
  });

  it("a lethal hit does not wake a mate walking home, nor one already dead, nor a hidden killer's camp", () => {
    const w = run();
    const [a, b, c] = campMobs(w, 0);
    b!.rt.brain!.mode = "return";
    slay(w, a!, "p0");
    expect(b!.rt.brain!.mode).toBe("return");
    expect(c!.rt.brain!.mode).toBe("fight");

    // A hidden killer is never handed to the mates (pickTarget would not choose it either).
    const h = run();
    const [x, y, z] = campMobs(h, 0);
    addStatus(h, combatant(h, "p1")!, { kind: "hidden", source: { id: "x", name: "x" }, ms: 5000 });
    slay(h, x!, "p1");
    expect(x!.s.status).toBe("dead");
    for (const m of [y!, z!]) expect(m.rt.brain!.mode, m.id).toBe("idle");
  });

  it("a killer who is already down hands nothing on, and a mob nobody in the run killed wakes no one", () => {
    const w = run();
    const [a, b] = campMobs(w, 0);
    downPlayer(w, P(w, 1), RT(w, 1), "died");
    slay(w, a!, "p1");
    expect(a!.s.status).toBe("dead");
    expect(b!.rt.brain!.mode).toBe("idle");
    const v = run();
    const [d, e] = campMobs(v, 0);
    killMob(v, d!, [], []);
    expect(e!.rt.brain!.mode).toBe("idle");
  });

  describe("which player the whole camp chases never follows the order the pass took its victims in", () => {
    const brains = (w: World): string => campMobs(w, 0).map((m) => `${m.rt.brain!.mode}:${m.rt.brain!.target}`).join(" | ");
    /** One pass with these hits, in this order of recording, under a tick whose secret order puts `first` ahead of the others. */
    const pass = (hits: Array<{ by: string; mob: number; raw?: number }>, first: string): { w: World; mobs: MobCombatant[] } => {
      const w = run();
      const rest = ["p0", "p1", "p2"].filter((id) => id !== first);
      w.combat.rank = new Map([first, ...rest].map((id, i) => [id, i]));
      const mobs = campMobs(w, 0);
      for (const h of hits) {
        recordHit(w, { victim: mobs[h.mob]!.id, by: { id: h.by, name: h.by }, packet: { raw: h.raw ?? 1, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
      }
      applyLedger(w);
      return { w, mobs };
    };

    it("two members hit by two players in one pass: [a, b] and [b, a] give the same brains, and the secret rank picks the untouched mate's target", () => {
      for (const first of ["p0", "p1"]) {
        const ab = pass([{ by: "p0", mob: 0 }, { by: "p1", mob: 1 }], first);
        const ba = pass([{ by: "p1", mob: 1 }, { by: "p0", mob: 0 }], first);
        expect(brains(ab.w), first).toBe(brains(ba.w));
        // Each hit mob is on its own attacker; the one nobody touched takes whoever the tick's order puts first.
        expect(ab.mobs.map((m) => m.rt.brain!.target), first).toEqual(["p0", "p1", first]);
        expect(ab.mobs[2]!.rt.brain!.threat.get(first)).toBe(0);
      }
    });

    it("a lethal hit hands its killer on in the same way: kill and hit in either order give the same brains", () => {
      for (const first of ["p0", "p1"]) {
        const kill = { by: "p0", mob: 0, raw: 1e6 };
        const poke = { by: "p1", mob: 1 };
        const one = pass([kill, poke], first);
        const two = pass([poke, kill], first);
        expect(one.mobs[0]!.s.status).toBe("dead");
        expect(brains(one.w), first).toBe(brains(two.w));
        expect(one.mobs.slice(1).map((m) => m.rt.brain!.target), first).toEqual(["p1", first]);
      }
    });

    it("a killer who is down by the end of the pass hands nothing on; one still standing does", () => {
      const standing = pass([{ by: "p0", mob: 0, raw: 1e6 }], "p0");
      expect(standing.mobs.slice(1).map((m) => m.rt.brain!.target)).toEqual(["p0", "p0"]);
      const w = run();
      const mobs = campMobs(w, 0);
      recordHit(w, { victim: mobs[0]!.id, by: { id: "p0", name: "p0" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
      // The killer is out by the time the pass is over (a hit of someone else's in the same pass): no wake onto a downed player.
      recordHit(w, { victim: "p0", by: { id: "p2", name: "p2" }, packet: { raw: 1e9, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
      applyLedger(w);
      expect(P(w, 0).status).not.toBe("alive");
      expect(mobs[0]!.s.status).toBe("dead");
      for (const m of mobs.slice(1)) expect(m.rt.brain!.mode, m.id).toBe("idle");
    });

    it("outside a pass nothing is deferred: a wake is immediate, as before", () => {
      const w = run();
      const [a, b] = campMobs(w, 0);
      hit(w, a!, "p1", 10);
      expect(b!.rt.brain!.target).toBe("p1");
      expect(w.combat.campWakes).toEqual([]);
    });
  });

  it("kill credit is unchanged: the pull earns nothing, the damage dealer gets the kill", () => {
    const w = run();
    const [a, b] = campMobs(w, 0);
    hit(w, a!, "p0", 1);
    expect(b!.rt.brain!.target).toBe("p0");
    recordHit(w, { victim: b!.id, by: { id: "p1", name: "p1" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(fxOf(w.events, "death").find((d) => d.id === b!.id)!.by).toBe("p1");
    expect(RT(w, 1).mobKills).toBe(1);
    expect(RT(w, 0).mobKills).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- the chest

describe("the chest's options come from the private reward stream", () => {
  it("never draw from world.random, and follow the reward salt", () => {
    let draws = 0;
    const base = mulberry32(12);
    const w = run({ random: () => { draws++; return base(); } });
    const before = draws;
    clearCamp(w, 1);
    expect(draws).toBe(before);
    const opts = [...onlyChest(w).options];
    // Same salt and history, same options; the roll is the shared rule's.
    const again = run({ salt: 99 });
    clearCamp(again, 1);
    expect([...onlyChest(again).options]).toEqual(opts);
    let differs = false;
    for (let salt = 1; salt < 20 && !differs; salt++) {
      const other = run({ salt });
      clearCamp(other, 1);
      differs = JSON.stringify([...onlyChest(other).options]) !== JSON.stringify(opts);
    }
    expect(differs).toBe(true);
    expect(cardDef(opts[0]!)!.kind).toBe("augment");
    expect(opts).toHaveLength(rollChestOptions(mulberry32(1)).length);
  });
});

describe("choose: picking at the chest", () => {
  function chestRun(players = 3): { w: World; box: ContainerState } {
    const w = run({ players });
    clearCamp(w, 1);
    tick(w); // the chest is published
    return { w, box: onlyChest(w) };
  }

  it("takes an option: the build gets the card, the mods fold it, takenBy and pickers say so, and a chestTaken goes out", () => {
    const { w, box } = chestRun();
    place(w, 0, box, 40);
    const id = box.options[1]!;
    choose(w, 0, box.id, 1);
    const ev = tick(w);
    expect(P(w, 0).build.get(id)).toBe(1);
    expect(box.takenBy[1]).toBe("p0");
    expect([...box.pickers]).toEqual(["p0"]);
    expect(fxOf(ev, "chestTaken")).toEqual([{ kind: "chestTaken", chest: box.id, by: "p0", option: 1 }]);
    expect(modRowsOf(P(w, 0)).length).toBeGreaterThan(0);
  });

  it("the same-tick race: the earlier player in actionOrder gets the option, the other a toast and a second chance", () => {
    for (let trial = 0; trial < 6; trial++) {
      const { w, box } = chestRun();
      place(w, 0, box, 30);
      place(w, 1, box, -30);
      // Run up to a tick whose order differs between trials.
      for (let i = 0; i < trial; i++) tick(w);
      const order = actionOrder(w, w.state.tick + 1).filter((id) => id === "p0" || id === "p1");
      choose(w, 0, box.id, 0);
      choose(w, 1, box.id, 0);
      const ev = tick(w);
      const [winner, loser] = order as [string, string];
      expect(box.takenBy[0], `trial ${trial}`).toBe(winner);
      expect([...box.pickers]).toEqual([winner]);
      expect(toasts(ev, loser)).toEqual(["Already taken"]);
      expect(w.state.players.get(loser)!.build.size).toBe(0);
      // The loser's pick was not used up.
      enqueueClientMessage(w.players.get(loser)!.inputs, "choose", { chest: box.id, pick: 2 });
      tick(w);
      expect(box.takenBy[2]).toBe(loser);
      expect([...box.pickers]).toEqual([winner, loser]);
    }
  });

  it("one pick per player, and a skip is the pick", () => {
    const { w, box } = chestRun();
    place(w, 0, box, 10);
    place(w, 1, box, -10);
    choose(w, 0, box.id, 0);
    choose(w, 0, box.id, 1);
    choose(w, 1, box.id, -1);
    const ev = tick(w);
    expect(toasts(ev, "p0")).toEqual(["You already picked"]);
    expect([...box.takenBy]).toEqual(["p0", "", ""]);
    expect([...box.pickers].sort()).toEqual(["p0", "p1"]);
    expect(fxOf(ev, "chestTaken").find((f) => f.by === "p1")!.option).toBe(-1);
    choose(w, 1, box.id, 1);
    expect(toasts(tick(w), "p1")).toEqual(["You already picked"]);
    expect(box.takenBy[1]).toBe("");
  });

  it("reads the SERVER position: within CHEST_RANGE and in line of sight, on the collision map", () => {
    const w = run();
    clearCamp(w, 0);
    tick(w);
    const box = onlyChest(w);
    place(w, 0, box, 0, CHEST_RANGE + 1);
    choose(w, 0, box.id, 0);
    expect(toasts(tick(w), "p0")).toEqual(["Too far away"]);
    place(w, 0, box, 0, CHEST_RANGE - 1);
    choose(w, 0, box.id, 0);
    expect(toasts(tick(w), "p0")).toEqual([]);
    expect(box.takenBy[0]).toBe("p0");
    // 90 u east, behind the wall tile at (12, 5).
    place(w, 1, box, 90, 0);
    choose(w, 1, box.id, 1);
    expect(toasts(tick(w), "p1")).toEqual(["Can't reach that"]);
    expect(box.takenBy[1]).toBe("");
  });

  it("expires at exactly CHEST_SECONDS: a pick in the tick before is taken, one at expiresAt is refused and the chest goes", () => {
    const { w, box } = chestRun();
    const id = box.id;
    place(w, 0, box, 20);
    place(w, 1, box, -20);
    while (w.state.serverTime + 2 * TICK_MS < box.expiresAt) tick(w);
    choose(w, 0, id, 0);
    tick(w);
    expect(w.state.serverTime).toBe(box.expiresAt - TICK_MS);
    expect(box.takenBy[0]).toBe("p0");
    choose(w, 1, id, 1);
    const ev = tick(w);
    expect(w.state.serverTime).toBe(box.expiresAt);
    expect(toasts(ev, "p1")).toEqual(["Chest gone"]);
    expect(w.state.containers.has(id)).toBe(false);
    choose(w, 1, id, 1);
    expect(toasts(tick(w), "p1")).toEqual(["Chest gone"]);
  });

  it("the dead and the MIA cannot pick; nor can anyone in the lobby", () => {
    const { w, box } = chestRun(4);
    place(w, 2, box, 10);
    place(w, 3, box, -10);
    downPlayer(w, P(w, 2), RT(w, 2), "died");
    downPlayer(w, P(w, 3), RT(w, 3), "mia");
    choose(w, 2, box.id, 0);
    choose(w, 3, box.id, 1);
    const ev = tick(w);
    expect([...box.pickers]).toEqual([]);
    expect(toasts(ev, "p2").concat(toasts(ev, "p3"))).toEqual([]);

    const lobby = createGameWorld({
      config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
      random: mulberry32(1), map: campMap(),
    }, { signatures: false });
    addPlayer(lobby, "p0", "a");
    const early = dropRewardChest(lobby, lobby.state.players.get("p0")!, ["haste1"]);
    enqueueClientMessage(lobby.players.get("p0")!.inputs, "choose", { chest: early.id, pick: 0 });
    step(lobby, TICK_MS);
    expect(lobby.state.phase).toBe("lobby");
    expect([...early.pickers]).toEqual([]);
  });

  it("the bornAt guard: a chest made between ticks cannot be picked in the tick that first publishes it", () => {
    const w = run();
    place(w, 0, P(w, 0));
    const box = dropRewardChest(w, P(w, 0), ["slowBurn", "hemorrhage"]);
    choose(w, 0, box.id, 0);
    expect(toasts(tick(w), "p0")).toEqual(["Chest gone"]);
    choose(w, 0, box.id, 0);
    tick(w);
    expect(box.takenBy[0]).toBe("p0");
  });

  it("the bornAt guard: a chest born in a tick's own ledger pass is not pickable in the next tick either (an id guessed blind wins nothing)", () => {
    const w = run();
    const mobs = campMobs(w, 1);
    const killer = (m: MobCombatant): void => {
      recordHit(w, { victim: m.id, by: { id: "p1", name: "p1" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    };
    for (const m of mobs.slice(1)) killer(m);
    applyLedger(w); // all but one die between ticks: the camp is not cleared yet
    expect(rewardChests(w)).toHaveLength(0);
    let fired = false;
    w.beforeDamage.push(() => { if (!fired) { fired = true; killer(mobs[0]!); } }); // the camp's last mob dies INSIDE a step
    tick(w);
    const box = onlyChest(w);
    place(w, 0, box);
    choose(w, 0, box.id, 0); // the client has not been told about the chest yet: it guessed the id
    expect(toasts(tick(w), "p0")).toEqual(["Chest gone"]);
    expect([...box.pickers]).toEqual([]);
    expect([...box.takenBy]).toEqual(["", "", ""]);
    choose(w, 0, box.id, 0);
    expect(toasts(tick(w), "p0")).toEqual([]);
    expect(box.takenBy[0]).toBe("p0");
  });

  it("an interactive augment can be picked once, and cannot be picked again by the same player", () => {
    const w = run();
    const drop = (): ContainerState => {
      const b = dropRewardChest(w, P(w, 0), ["slowBurn", "hemorrhage"]);
      tick(w);
      return b;
    };
    const one = drop();
    choose(w, 0, one.id, 0);
    expect(toasts(tick(w), "p0")).toEqual([]);
    expect(P(w, 0).build.get("slowBurn")).toBe(1);
    const two = drop();
    choose(w, 0, two.id, 0);
    expect(toasts(tick(w), "p0")).toEqual(["Already yours"]);
    expect(two.takenBy[0]).toBe("");
  });

  it("rejects raw stat and conditional cards injected into reward containers", () => {
    const w = run();
    const box = dropRewardChest(w, P(w, 0), ["haste1", "bloodthirst"]);
    tick(w);
    choose(w, 0, box.id, 0);
    expect(toasts(tick(w), "p0")).toEqual([]);
    expect(box.takenBy[0]).toBe("");
    expect([...box.pickers]).toEqual([]);
    expect(P(w, 0).build.has("haste1")).toBe(false);
    choose(w, 0, box.id, 1);
    expect(toasts(tick(w), "p0")).toEqual([]);
    expect(box.takenBy[1]).toBe("");
    expect(P(w, 0).build.has("bloodthirst")).toBe(false);
  });

  it("an index the chest does not have is ignored without using the pick; `replace` is accepted and ignored", () => {
    const { w, box } = chestRun();
    place(w, 0, box);
    choose(w, 0, box.id, 7);
    expect(toasts(tick(w), "p0")).toEqual([]);
    expect([...box.pickers]).toEqual([]);
    expect(enqueueClientMessage(RT(w, 0).inputs, "choose", { chest: box.id, pick: 0, replace: 1 })).toBe(true);
    tick(w);
    expect(box.takenBy[0]).toBe("p0");
  });

  it("the weapon pickup refuses a reward chest", () => {
    const { w, box } = chestRun();
    place(w, 0, box);
    enqueueClientMessage(RT(w, 0).inputs, "pickup", { containerId: box.id });
    expect(toasts(tick(w), "p0")).toEqual(["Nothing to take"]);
    expect(w.state.containers.has(box.id)).toBe(true);
  });

  it("is removed at the coliseum teleport and when the run ends", () => {
    const { w, box } = chestRun();
    teleportToColiseum(w);
    expect(w.state.containers.has(box.id)).toBe(false);
    const end = run({ players: 2 });
    clearCamp(end, 0);
    tick(end);
    expect(rewardChests(end)).toHaveLength(1);
    downPlayer(end, P(end, 1), RT(end, 1), "died");
    tick(end);
    expect(end.state.phase).toBe("ended");
    expect(rewardChests(end)).toEqual([]);
  });
});

describe("every refusal toast of a pick is one the client knows (shared CHEST_REFUSALS)", () => {
  it("covers all seven fixed reasons a handleChoose refusal has (and a conditional's Needs <Base> is recognised too)", () => {
    const w = run();
    clearCamp(w, 0); // the Fire camp: its chest has the wall tile 90 u east of it
    tick(w);
    const box = onlyChest(w);
    const said = new Set<string>();
    const note = (who: string): void => { for (const t of toasts(tick(w), who)) said.add(t); };
    place(w, 0, box, 200); choose(w, 0, box.id, 0); note("p0"); // too far
    place(w, 0, box, 90); choose(w, 0, box.id, 0); note("p0"); // east, behind the wall tile at (12, 5)
    place(w, 0, box, 40); choose(w, 0, "nope", 0); note("p0"); // gone
    choose(w, 0, box.id, 0); note("p0"); // p0 takes option 0 ...
    choose(w, 0, box.id, 1); note("p0"); // ... and cannot pick twice
    place(w, 1, box, -20); choose(w, 1, box.id, 0); note("p1"); // taken
    place(w, 2, box, 30);
    P(w, 2).build.set(box.options[2]!, 1);
    choose(w, 2, box.id, 2); note("p2"); // already yours (the augment: unique)
    addStatus(w, combatant(w, "p2")!, { kind: "stun", source: { id: "x", name: "x" }, ms: 1000 });
    choose(w, 2, box.id, 1); note("p2"); // busy
    expect([...said].sort()).toEqual([...CHEST_REFUSALS].sort());
    for (const t of said) expect(Object.values(CHEST_REFUSAL)).toContain(t);
  });
});

describe("a chest's birth is forgotten with the chest", () => {
  const drop = (w: World, n: number): void => {
    for (let i = 0; i < n; i++) dropRewardChest(w, { x: at(10), y: at(5) }, ["armor1"], 0);
  };

  it("an expired chest nobody picked from leaves no entry behind, over many cycles", () => {
    const w = run();
    const base = birthsRemembered(w);
    for (let cycle = 0; cycle < 4; cycle++) {
      drop(w, 6); // between ticks: remembered until the next one publishes them
      expect(birthsRemembered(w)).toBe(base + 6);
      for (let i = 0; i < CHEST_SECONDS * (1000 / TICK_MS) + 2; i++) tick(w);
      expect(rewardChests(w)).toEqual([]);
      expect(birthsRemembered(w), `cycle ${cycle}`).toBe(base);
    }
  });

  it("a chest taken away by the teleport or the console's clear is forgotten too", () => {
    const w = run();
    const base = birthsRemembered(w);
    drop(w, 3);
    clearChests(w);
    expect(rewardChests(w)).toEqual([]);
    expect(birthsRemembered(w)).toBe(base);
    drop(w, 3);
    teleportToColiseum(w);
    expect(rewardChests(w)).toEqual([]);
    expect(birthsRemembered(w)).toBe(base);
  });
});

describe("the skip (D12)", () => {
  function skipRig(signatures = false): { w: World; box: ContainerState } {
    const w = run({ signatures });
    const box = dropRewardChest(w, P(w, 0), ["haste1"]);
    place(w, 0, box);
    tick(w);
    return { w, box };
  }

  it("heals SKIP_HEAL_SHARE of max hp out of combat, and pays no GV", () => {
    const { w, box } = skipRig(true);
    P(w, 0).hp = P(w, 0).maxHp * 0.5;
    choose(w, 0, box.id, -1);
    tick(w);
    expect(P(w, 0).hp).toBeCloseTo(P(w, 0).maxHp * (0.5 + SKIP_HEAL_SHARE), 6);
    expect(RT(w, 0).gv.mobs).toBe(0);
  });

  it("in combat (the 3 s lockout) or at full hp it heals nothing and pays GV_SKIP, as mob GV", () => {
    const { w, box } = skipRig(true);
    P(w, 0).hp = P(w, 0).maxHp * 0.5;
    noteContact(w, "p0", "p1");
    w.factions!.fighters.get("p0")!.combatAt = w.state.serverTime;
    choose(w, 0, box.id, -1);
    const ev = tick(w);
    expect(P(w, 0).hp).toBe(P(w, 0).maxHp * 0.5);
    expect(RT(w, 0).gv.mobs).toBe(GV_SKIP);
    expect(P(w, 0).gv).toBe(GV_SKIP);
    expect(ev.filter((e) => e.type === "gv")).toEqual([{ type: "gv", id: "p0", amount: GV_SKIP, reason: "skip" }]);

    const full = skipRig();
    expect(P(full.w, 0).hp).toBe(P(full.w, 0).maxHp);
    choose(full.w, 0, full.box.id, -1);
    tick(full.w);
    expect(RT(full.w, 0).gv.mobs).toBe(GV_SKIP);
  });

  it("counts against GV_MOB_CAP", () => {
    const { w, box } = skipRig();
    RT(w, 0).gv.mobs = GV_MOB_CAP - 1;
    choose(w, 0, box.id, -1);
    tick(w);
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    const capped = skipRig();
    RT(capped.w, 0).gv.mobs = GV_MOB_CAP;
    choose(capped.w, 0, capped.box.id, -1);
    const ev = tick(capped.w);
    expect(RT(capped.w, 0).gv.mobs).toBe(GV_MOB_CAP);
    expect(ev.filter((e) => e.type === "gv")).toEqual([]);
    expect([...capped.box.pickers]).toEqual(["p0"]);
  });
});

describe("the loop on a generated zone map (server-side, until the bots pick)", () => {
  it("clear a camp with hits, walk to the chest, pick: the card is in the build and the mods", () => {
    const w = createGameWorld({
      seed: 1234,
      config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
      random: mulberry32(1235), rewardSalt: 4321,
    });
    addPlayer(w, "p0", "alice", { faction: "fire" });
    addPlayer(w, "p1", "bob", { faction: "holy" });
    step(w, TICK_MS);
    for (let camp = 0; camp < w.map.camps.length; camp++) {
      clearCamp(w, camp);
      expect(w.state.camps[camp]!.state).toBe(CAMP_CLEARED);
    }
    tick(w);
    const chests = rewardChests(w);
    expect(chests).toHaveLength(w.map.camps.filter((camp) => camp.eliteSpot >= 0).length);
    for (const box of chests) {
      const camp = w.map.camps[box.camp - 1]!;
      expect({ x: box.x, y: box.y }).toEqual(camp.chest);
      expect(new Set(box.options).size).toBe(box.options.length);
    }
    const box = chests[0]!;
    place(w, 0, box, 0, 0);
    choose(w, 0, box.id, 0);
    tick(w);
    expect(P(w, 0).build.get(box.options[0]!)).toBe(1);
    expect(box.takenBy[0]).toBe("p0");
  });
});

describe("on the wire", () => {
  it("a live client sees the chest, its picks and the build patched; a late joiner sees the chest as it stands", () => {
    const w = run();
    const encoder = new Encoder(w.state);
    const live = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    live.decode(encoder.encodeAll());
    const patch = (): void => {
      live.decode(encoder.encode());
      encoder.discardChanges();
    };
    clearCamp(w, 1);
    tick(w);
    patch();
    const box = onlyChest(w);
    const seen = live.state.containers.get(box.id)!;
    expect(seen.kind).toBe("reward");
    expect([...seen.options]).toEqual([...box.options]);
    expect(seen.expiresAt).toBe(box.expiresAt);
    expect(seen.camp).toBe(2);
    expect(live.state.camps[1]!.state).toBe(CAMP_CLEARED);
    place(w, 0, box, 10);
    choose(w, 0, box.id, 0);
    tick(w);
    patch();
    expect([...seen.takenBy]).toEqual([...box.takenBy]);
    expect([...seen.pickers]).toEqual(["p0"]);
    expect(live.state.players.get("p0")!.build.get(box.options[0]!)).toBe(1);
    const late = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    late.decode(encoder.encodeAll());
    const again = late.state.containers.get(box.id)!;
    expect({ options: [...again.options], takenBy: [...again.takenBy], pickers: [...again.pickers], expiresAt: again.expiresAt })
      .toEqual({ options: [...box.options], takenBy: [...box.takenBy], pickers: [...box.pickers], expiresAt: box.expiresAt });
    // Expired: gone from the client too.
    while (w.state.serverTime < box.expiresAt) tick(w);
    patch();
    expect(live.state.containers.has(box.id)).toBe(false);
  });
});

describe("the choose message", () => {
  it("parses a chest id, a pick from -1 to MAX_CHOOSE_PICK and an optional replace of 0 or 1; anything else is refused whole", () => {
    expect(parseChoose({ chest: "c1", pick: 0 })).toEqual({ kind: "choose", chest: "c1", pick: 0 });
    expect(parseChoose({ chest: "c1", pick: -1, replace: 1 })).toEqual({ kind: "choose", chest: "c1", pick: -1, replace: 1 });
    expect(parseChoose({ chest: "c1", pick: MAX_CHOOSE_PICK })).not.toBeNull();
    for (const bad of [
      null, 3, {}, { chest: "c1" }, { pick: 0 }, { chest: "", pick: 0 }, { chest: "x".repeat(65), pick: 0 }, { chest: 5, pick: 0 },
      { chest: "c1", pick: -2 }, { chest: "c1", pick: MAX_CHOOSE_PICK + 1 }, { chest: "c1", pick: 0.5 }, { chest: "c1", pick: "0" },
      { chest: "c1", pick: Number.NaN }, { chest: "c1", pick: 0, replace: 2 }, { chest: "c1", pick: 0, replace: true },
    ]) {
      expect(parseChoose(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("grantCard", () => {
  const me = (w: World) => combatant(w, "p0") as Extract<NonNullable<ReturnType<typeof combatant>>, { kind: "player" }>;

  it("adds one copy and returns the new count: a base card stacks, the mirrors and max hp follow in the same call", () => {
    const w = run();
    expect(grantCard(w, me(w), "haste2")).toBe(1);
    expect(grantCard(w, me(w), "haste2")).toBe(2);
    expect(P(w, 0).build.get("haste2")).toBe(2);
    expect(P(w, 0).asMult).toBe(1320);
    const hp = P(w, 0).hp;
    const max = P(w, 0).maxHp;
    expect(grantCard(w, me(w), "vitality3")).toBe(1);
    expect(P(w, 0).maxHp).toBeCloseTo(max * 1.25, 6);
    expect(P(w, 0).hp).toBeCloseTo(hp + (P(w, 0).maxHp - max), 6);
  });

  it("refuses an unknown id, a unique card already held, and a conditional without a card of its base (and changes nothing)", () => {
    const w = run();
    expect(grantCard(w, me(w), "whetstone")).toBeNull();
    expect(grantCard(w, me(w), "")).toBeNull();
    expect(grantCard(w, me(w), "hearty")).toBeNull(); // needs Vitality
    expect(P(w, 0).build.size).toBe(0);
    expect(grantCard(w, me(w), "vitality1")).toBe(1);
    expect(grantCard(w, me(w), "hearty")).toBe(1);
    expect(grantCard(w, me(w), "hearty")).toBeNull(); // unique
    expect(grantCard(w, me(w), "glassCannon")).toBe(1);
    expect(grantCard(w, me(w), "glassCannon")).toBeNull();
    expect([...P(w, 0).build.entries()].sort()).toEqual([["glassCannon", 1], ["hearty", 1], ["vitality1", 1]]);
  });

  it("a card that waits for its hook can be held (a test's, the console's) but folds nothing", () => {
    withNotLive(["overkill"], () => {
      const w = run();
      expect(grantCard(w, me(w), "overkill")).toBe(1);
      expect(P(w, 0).build.get("overkill")).toBe(1);
      expect(modRowsOf(P(w, 0))).toEqual([]);
    });
  });
});

describe("what a chest offers depends on who fought the camp", () => {
  /** Holy camp 1 cleared by p0, who stands at `where` (a far spawn tile, or the camp itself) holding `cards`. */
  function chestFor(salt: number, where: "near" | "far", cards: string[], camp = 1): ContainerState {
    const w = run({ salt, players: 2 });
    for (const id of cards) expect(grantCard(w, combatant(w, "p0") as never, id)).not.toBeNull();
    if (where === "near") place(w, 0, w.map.camps[camp]!);
    // Contributors are recorded as hits land: a hit from p0 on a member first, then the kills.
    clearCamp(w, camp);
    return onlyChest(w);
  }

  it("offers only interactive augments, independent of contributor base cards", () => {
    for (let salt = 1; salt <= 60; salt++) {
      const box = chestFor(salt, "near", ["leech1"]);
      for (const id of box.options) {
        const def = cardDef(id)!;
        expect(def.kind, `salt ${salt}`).toBe("augment");
        expect(def.ready, `salt ${salt}`).toBe("a");
      }
      for (const [where, cards] of [["far", ["leech1"]], ["near", []], ["far", []]] as const) {
        expect([...chestFor(salt, where, [...cards]).options].every((id) => cardDef(id)!.kind === "augment"), `salt ${salt} ${where} ${cards}`).toBe(true);
      }
    }
  });

  it("an elite camp's chest rolls the higher tiers (10/60/30 against 70/25/5)", () => {
    const elite = (): GameMap => {
      const m = campMap();
      m.camps[1] = { ...m.camps[1]!, eliteSpot: 0 };
      return m;
    };
    let normalTier = 0, eliteTier = 0, n = 0;
    for (let salt = 1; salt <= 80; salt++) {
      normalTier += cardDef(rollChestOptions(mulberry32(salt), { elite: false })[0]!)!.tier;
      eliteTier += cardDef(rollChestOptions(mulberry32(salt), { elite: true })[0]!)!.tier;
      n++;
    }
    expect(eliteTier / n).toBeGreaterThan(normalTier / n + 0.25);
    expect(eliteTier / n).toBeGreaterThan(1.8);
    expect(normalTier / n).toBeLessThan(1.6);
  });
});

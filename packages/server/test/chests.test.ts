// The camp runtime and the contested shared chest (roguelike R5; sim/camps.ts, sim/chests.ts, mobAI.ts camp-wide aggro):
// a camp is engaged, then cleared for good; its chest drops on the camp's chest tile with options from the private reward
// stream; everyone near it takes one pick, first come first served in the tick's secret order; it is gone at exactly
// CHEST_SECONDS, at the teleport and when the run ends.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  CHEST_RANGE, CHEST_SECONDS, GV_MOB_CAP, GV_SKIP, mapFromTiles, mulberry32, nextRank, rollChestOptions, SKIP_HEAL_SHARE,
  TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type CampDef, type FactionId, type FxEvent, type GameMap, type Vec2,
} from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";
import { downPlayer, teleportToColiseum } from "../src/sim/arena";
import { CAMP_CLEARED, CAMP_ENGAGED, CAMP_IDLE } from "../src/sim/camps";
import { dropRewardChest, rewardChests } from "../src/sim/chests";
import { combatant } from "../src/sim/combatant";
import { noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, MAX_CHOOSE_PICK, parseChoose } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { hurtMob, killMob, type MobCombatant } from "../src/sim/mobLife";
import { modRowsOf } from "../src/sim/mods";
import { actionOrder, addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, SimEvent, World } from "../src/sim/world";

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

interface RunOpts { players?: number; salt?: number; signatures?: boolean; random?: () => number }

/** A run on campMap with p0, p1, ... (Frost, so nothing of theirs is a passive's special case), started on the first step. */
function run(o: RunOpts = {}): World {
  const n = o.players ?? 3;
  const w = createGameWorld({
    seed: 11,
    config: {
      minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
      mobs: true,
    },
    random: o.random ?? mulberry32(12),
    rewardSalt: o.salt ?? 99,
    map: campMap(),
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
    // Fire has no live passive yet: neutrals only.
    expect(box.options.length).toBe(3);
  });

  it("clears even when no player killed the last mob (no killer), and never twice", () => {
    const w = run();
    for (const m of campMobs(w, 1)) killMob(w, m, [], []);
    expect(w.state.camps[1]!.state).toBe(CAMP_CLEARED);
    expect(rewardChests(w)).toHaveLength(1);
    expect(fxOf(w.events, "campCleared")).toEqual([{ kind: "campCleared", camp: 1 }]);
    // Holy has Last Rites: it is the first card.
    expect(onlyChest(w).options[0]).toBe("lastRites");
    for (const m of campMobs(w, 1)) killMob(w, m, [], []);
    expect(rewardChests(w)).toHaveLength(1);
  });

  it("falls back to the camp's centre when the chest tile is a wall", () => {
    const map = campMap();
    map.camps[0] = { ...map.camps[0]!, chest: { x: at(12), y: at(5) } };
    const w = createGameWorld({
      seed: 11, config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
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
    expect(opts[0]).toBe("lastRites");
    expect(opts).toHaveLength(rollChestOptions(mulberry32(1), { zone: "holy" }).length);
  });
});

describe("choose: picking at the chest", () => {
  function chestRun(players = 3): { w: World; box: ContainerState } {
    const w = run({ players });
    clearCamp(w, 1);
    tick(w); // the chest is published
    return { w, box: onlyChest(w) };
  }

  it("takes an option: the build gets rank 1, the mods fold it, takenBy and pickers say so, and a chestTaken goes out", () => {
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
      seed: 11, config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
      random: mulberry32(1), map: campMap(),
    }, { signatures: false });
    addPlayer(lobby, "p0", "a");
    const early = dropRewardChest(lobby, lobby.state.players.get("p0")!, ["whetstone"]);
    enqueueClientMessage(lobby.players.get("p0")!.inputs, "choose", { chest: early.id, pick: 0 });
    step(lobby, TICK_MS);
    expect(lobby.state.phase).toBe("lobby");
    expect([...early.pickers]).toEqual([]);
  });

  it("the bornAt guard: a chest made between ticks cannot be picked in the tick that first publishes it", () => {
    const w = run();
    place(w, 0, P(w, 0));
    const box = dropRewardChest(w, P(w, 0), ["whetstone", "swiftBoots"]);
    choose(w, 0, box.id, 0);
    expect(toasts(tick(w), "p0")).toEqual(["Chest gone"]);
    choose(w, 0, box.id, 0);
    tick(w);
    expect(box.takenBy[0]).toBe("p0");
  });

  it("picking a skill you hold gives rank 2; one at rank 2 is refused and the pick is not used", () => {
    const w = run();
    const drop = (): ContainerState => {
      const b = dropRewardChest(w, P(w, 0), ["whetstone", "swiftBoots"]);
      tick(w);
      return b;
    };
    const one = drop();
    choose(w, 0, one.id, 0);
    tick(w);
    expect(P(w, 0).build.get("whetstone")).toBe(1);
    const two = drop();
    choose(w, 0, two.id, 0);
    tick(w);
    expect(P(w, 0).build.get("whetstone")).toBe(2);
    expect(nextRank(P(w, 0).build, "whetstone")).toBeNull();
    const three = drop();
    choose(w, 0, three.id, 0);
    expect(toasts(tick(w), "p0")).toEqual(["Already at rank 2"]);
    expect(three.takenBy[0]).toBe("");
    choose(w, 0, three.id, 1);
    tick(w);
    expect(three.takenBy[1]).toBe("p0");
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

describe("the skip (D12)", () => {
  function skipRig(signatures = false): { w: World; box: ContainerState } {
    const w = run({ signatures });
    const box = dropRewardChest(w, P(w, 0), ["whetstone"]);
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

describe("the loop on a generated wedge map (server-side, until the bots pick)", () => {
  it("clear a camp with hits, walk to the chest, pick: the passive is in the build and the mods", () => {
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
    expect(chests).toHaveLength(w.map.camps.length);
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

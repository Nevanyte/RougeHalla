// Where the Wishes (the status runtime and the cast pipeline) meet the R5 camp runtime and its shared chests, checked since the
// two lines merged: the coliseum teleport and the end of the run clear both (the `teleported` and `runEnded` hooks chain, neither
// clobbers the other); a stun or a pending cast blocks a chest pick as it blocks a pickup; camp-wide aggro never hands a woken
// camp-mate a hidden target, and a stunned mate does nothing; a zone on a practice mob the training console's `clear` removes ends
// with it. Hand-built camp arena as in chests.test.ts; Wishes ready at once (wishLockSeconds 0).
import { describe, expect, it } from "vitest";
import {
  circleClear, FIELD_KINDS, hasLineOfSight, mapFromTiles, mulberry32, PLAYER_RADIUS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type CampDef, type FactionId, type FxEvent, type GameMap, type Vec2,
} from "@raid/shared";
import type { ContainerState, PlayerState } from "@raid/shared/schema";
import { downPlayer, teleportToColiseum } from "../src/sim/arena";
import { dropRewardChest, rewardChests } from "../src/sim/chests";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { hurtMob, type MobCombatant } from "../src/sim/mobLife";
import { addStatus, isCasting } from "../src/sim/status";
import { addPlayer, startRaid, step } from "../src/sim/step";
import { installTraining } from "../src/sim/training";
import type { LedgerEntry, SimEvent, World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const W_TILES = 40;
const H_TILES = 20;
const at = (t: number): number => t * TILE + TILE / 2;

/** Two camps of three on open floor: camp 0 (Fire) around tile (10, 5), camp 1 (Holy) around (30, 5), each chest on its centre. */
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

/** An active run on campMap with p0, p1, ... of these factions, Wishes ready at once. */
function run(factions: FactionId[]): World {
  const w = createGameWorld({
    config: {
      minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600, mobs: true, wishLockSeconds: 0,
    },
    random: mulberry32(12),
    rewardSalt: 99,
    map: campMap(),
  }, { signatures: false });
  factions.forEach((faction, i) => addPlayer(w, `p${i}`, `name${i}`, { faction }));
  step(w, TICK_MS);
  expect(w.state.phase).toBe("active");
  return w;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const campMobs = (w: World, camp: number): MobCombatant[] =>
  [...w.state.mobs].filter(([, m]) => m.camp === camp + 1).map(([id]) => combatant(w, id) as MobCombatant);
const tick = (w: World): SimEvent[] => step(w, TICK_MS);
function ticks(w: World, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...tick(w));
  return out;
}
function fxOf<K extends FxEvent["kind"]>(events: readonly SimEvent[], kind: K): Array<Fx<K>> {
  return events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Fx<K>] : []));
}
const toasts = (events: readonly SimEvent[], to: string): string[] =>
  events.flatMap((e) => (e.type === "toast" && e.to === to ? [e.text] : []));

function place(w: World, i: number, p: Vec2, dx = 0, dy = 0): void {
  P(w, i).x = p.x + dx;
  P(w, i).y = p.y + dy;
  RT(w, i).path = [];
  RT(w, i).history = [{ t: w.state.serverTime, x: P(w, i).x, y: P(w, i).y }];
}

/** A visible interactive chest fixture for the lifecycle and pick-action tests below. */
function clearCamp(w: World, camp: number): ContainerState {
  const def = w.map.camps[camp]!;
  const box = dropRewardChest(w, def.chest, ["hemorrhage", "overkill", "secondWind"], camp);
  tick(w); // publish the box and clear its one-tick birth hold
  return box;
}

const send = (w: World, i: number, type: string, msg: unknown): void => {
  expect(enqueueClientMessage(RT(w, i).inputs, type, msg), type).toBe(true);
};
/** p`i` casts its Wish at p`target` (a unit Wish) or at itself. */
function castWish(w: World, i: number, target?: number): void {
  const t = target === undefined ? P(w, i) : P(w, target);
  send(w, i, "cast", { slot: "wish", x: t.x, y: t.y, ...(target === undefined ? {} : { id: `p${target}` }) });
}
const afflict = (w: World, who: string, kind: "stun" | "hidden", ms: number): void => {
  addStatus(w, combatant(w, who)!, { kind, source: { id: "x", name: "x" }, ms });
};

describe("the teleport and the end of the run clear the Wishes and the chests together", () => {
  it("the teleport cancels a pending cast WITH its refund and removes the chest", () => {
    const w = run(["frost", "sentenced", "fire"]);
    const box = clearCamp(w, 0);
    place(w, 0, { x: at(20), y: at(12) });
    place(w, 1, { x: at(23), y: at(12) });
    const readyBefore = P(w, 0).wishReadyAt;
    castWish(w, 0, 1); // Freeze: 250 ms of cast, still pending at the teleport
    tick(w);
    expect(RT(w, 0).cast).toBeTruthy();
    expect(P(w, 0).wishReadyAt).toBeGreaterThan(readyBefore);
    teleportToColiseum(w);
    expect(w.state.gatesLocked).toBe(true);
    expect(w.state.containers.has(box.id)).toBe(false);
    expect(rewardChests(w)).toEqual([]);
    expect(fxOf(w.events, "castEnd")).toEqual([{ kind: "castEnd", by: "p0", ability: "freeze", reason: "cancelled" }]);
    expect(RT(w, 0).cast ?? null).toBeNull();
    expect(P(w, 0).wishReadyAt).toBe(readyBefore);
  });

  it("the end of the run cancels a pending cast (nothing refunded) and removes the chest", () => {
    const w = run(["plague", "holy"]);
    const box = clearCamp(w, 1);
    castWish(w, 0); // Swarm: 250 ms of cast on itself
    tick(w);
    expect(RT(w, 0).cast).toBeTruthy();
    const spent = P(w, 0).wishReadyAt;
    expect(spent).toBeGreaterThan(w.state.serverTime);
    downPlayer(w, P(w, 1), RT(w, 1), "died");
    const ev = tick(w);
    expect(w.state.phase).toBe("ended");
    expect(w.state.containers.has(box.id)).toBe(false);
    expect(fxOf(ev, "castEnd")).toEqual([{ kind: "castEnd", by: "p0", ability: "swarm", reason: "cancelled" }]);
    expect(RT(w, 0).cast ?? null).toBeNull();
    expect(P(w, 0).wishReadyAt).toBe(spent);
    expect(w.state.fields.size).toBe(0);
  });
});

describe("a chest pick is an action: a stun or a pending cast blocks it, as it blocks a pickup", () => {
  it("a stunned player is refused with a toast and keeps the pick; once the stun ends the pick goes through", () => {
    const w = run(["frost", "holy"]);
    const box = clearCamp(w, 0);
    place(w, 0, box, 30);
    afflict(w, "p0", "stun", 200);
    send(w, 0, "choose", { chest: box.id, pick: 0 });
    expect(toasts(tick(w), "p0")).toEqual(["Can't do that now"]);
    expect([...box.pickers]).toEqual([]);
    expect(box.takenBy[0]).toBe("");
    ticks(w, 4); // the stun is over
    send(w, 0, "choose", { chest: box.id, pick: 0 });
    const ev = tick(w);
    expect(fxOf(ev, "chestTaken")).toEqual([{ kind: "chestTaken", chest: box.id, by: "p0", option: 0 }]);
    expect(box.takenBy[0]).toBe("p0");
  });

  it("a player whose cast is pending is refused in the same way (a cast queued before the pick roots first)", () => {
    const w = run(["plague", "holy"]);
    const box = clearCamp(w, 0);
    place(w, 0, box, 30);
    castWish(w, 0); // Swarm, 250 ms
    send(w, 0, "choose", { chest: box.id, pick: 1 });
    expect(toasts(tick(w), "p0")).toEqual(["Can't do that now"]);
    expect(isCasting(combatant(w, "p0")!)).toBe(true);
    expect([...box.pickers]).toEqual([]);
  });

  it("a Swarm-hidden player may pick, and its chestTaken names it (public by design; a Known TODO)", () => {
    const w = run(["plague", "holy"]);
    const box = clearCamp(w, 0);
    place(w, 0, box, 30);
    afflict(w, "p0", "hidden", 3000);
    send(w, 0, "choose", { chest: box.id, pick: 2 });
    const ev = tick(w);
    expect(fxOf(ev, "chestTaken")).toEqual([{ kind: "chestTaken", chest: box.id, by: "p0", option: 2 }]);
  });
});

describe("camp-wide aggro meets the statuses", () => {
  const hit = (w: World, m: MobCombatant, by: string, amount: number): void => {
    const e: LedgerEntry = { victim: m.id, by: { id: by, name: by }, packet: { raw: amount, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false };
    hurtMob(w, m, [amount], [e]);
  };

  it("a hit on a mob still fighting a player who went hidden wakes no mate onto that player; a later hit wakes them onto someone in view", () => {
    const w = run(["frost", "plague", "holy"]);
    const [a, b, c] = campMobs(w, 0);
    hit(w, a!, "p1", 10);
    expect(b!.rt.brain!.target).toBe("p1");
    for (const m of [b!, c!]) { m.rt.brain!.mode = "idle"; m.rt.brain!.target = null; }
    afflict(w, "p1", "hidden", 5000);
    hit(w, a!, "p0", 5);
    expect(a!.rt.brain!.target).toBe("p1"); // stale until its next think
    for (const m of [b!, c!]) expect(m.rt.brain!.mode, m.id).toBe("idle");
    tick(w);
    expect(a!.rt.brain!.target).toBe("p0");
    hit(w, a!, "p0", 1);
    for (const m of [b!, c!]) {
      expect(m.rt.brain!.mode, m.id).toBe("fight");
      expect(m.rt.brain!.target, m.id).toBe("p0");
    }
  });

  it("a mate woken while stunned does nothing until the stun ends; an unstunned mate fights", () => {
    const w = run(["frost", "holy"]);
    const [a, b, c] = campMobs(w, 0);
    place(w, 0, { x: a!.s.x, y: a!.s.y + 60 });
    afflict(w, b!.id, "stun", 1000);
    const bAt = { x: b!.s.x, y: b!.s.y };
    const cAt = { x: c!.s.x, y: c!.s.y };
    hit(w, a!, "p0", 1);
    expect(b!.rt.brain!.mode).toBe("fight");
    const ev = ticks(w, 15); // 750 ms, inside the stun
    expect({ x: b!.s.x, y: b!.s.y }).toEqual(bAt);
    expect(b!.rt.weapon.action).toBeNull();
    expect(fxOf(ev, "windup").filter((f) => f.by === b!.id)).toEqual([]);
    const cActed = c!.s.x !== cAt.x || c!.s.y !== cAt.y || fxOf(ev, "windup").some((f) => f.by === c!.id);
    expect(cActed).toBe(true);
  });
});

describe("the training console's clear and the Wishes' areas", () => {
  it("a Trial zone on a practice mob ends with the mob (a zone whose subject is gone ends silently)", () => {
    const world = createGameWorld({
      seed: 1234,
      config: {
        minPlayers: 8, lobbySeconds: 120, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 2,
        dummies: true, training: true,
      },
      random: mulberry32(1235),
    });
    installTraining(world);
    addPlayer(world, "p0", "alice", { faction: "sentenced" });
    startRaid(world);
    const me = world.state.players.get("p0")!;
    const inputs = world.players.get("p0")!.inputs;
    expect(enqueueClientMessage(inputs, "train", { cmd: "camp", id: "emberImp" }, { training: true })).toBe(true);
    tick(world);
    const [id, m] = [...world.state.mobs].find(([, mob]) => mob.kind === "mob")!;
    // 60 u from the mob with a clear line to it: the generated map decides on which side (the first of eight that has one).
    const spot = Array.from({ length: 8 }, (_, k) => ({ x: m.x - 60 * Math.cos((k * Math.PI) / 4), y: m.y - 60 * Math.sin((k * Math.PI) / 4) }))
      .find((q) => circleClear(world.map, q, PLAYER_RADIUS) && hasLineOfSight(world.map, q, m))!;
    me.x = spot.x;
    me.y = spot.y;
    world.players.get("p0")!.history = [{ t: world.state.serverTime, x: me.x, y: me.y }];
    expect(enqueueClientMessage(inputs, "cast", { slot: "wish", x: m.x, y: m.y, id })).toBe(true);
    ticks(world, 10); // Trial lands after 350 ms: a zone on the mob
    const trial = FIELD_KINDS.indexOf("zone");
    expect([...world.state.fields.values()].some((f) => f.kind === trial && f.subject === id)).toBe(true);
    expect(enqueueClientMessage(inputs, "train", { cmd: "clear" }, { training: true })).toBe(true);
    tick(world);
    expect(world.state.mobs.has(id)).toBe(false);
    expect([...world.state.fields.values()].filter((f) => f.subject === id)).toEqual([]);
  });
});

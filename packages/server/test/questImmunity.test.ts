import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { validUnitTarget } from "../src/sim/abilities";
import { combatant, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { aggro } from "../src/sim/mobAI";
import { hurtMob, placeMob, type MobCombatant } from "../src/sim/mobLife";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addStatus, statusesOf } from "../src/sim/status";
import { addPlayer, step } from "../src/sim/step";
import { handleTarget } from "../src/sim/targeting";
import { questDefById } from "@raid/shared";
import type { LedgerEntry, SimConfig, World } from "../src/sim/world";

const BIG_HP = 1e9;

function arenaMap(): GameMap {
  const side = 30;
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  return {
    ...mapFromTiles(side, side, tiles),
    spawns: Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 })),
  };
}

interface Fighter { faction: FactionId; weapon: WeaponId; at: Vec2 }

function makeRun(fighters: Fighter[] = [
  { faction: "fire", weapon: "sword", at: { x: 300, y: 320 } },
  { faction: "frost", weapon: "shield", at: { x: 600, y: 500 } },
], signatures = false): World {
  const config: SimConfig = {
    minPlayers: fighters.length,
    lobbySeconds: 15,
    fillSeconds: 0,
    patienceSeconds: 3600,
    patienceMinSeconds: 3600,
    suddenDeathSeconds: 3600,
    mobs: false,
    quests: true,
    wishLockSeconds: 0,
  };
  const world = createGameWorld({
    config,
    random: mulberry32(8),
    rewardSalt: 71,
    map: arenaMap(),
  }, { signatures });
  fighters.forEach((fighter, i) => {
    const p = addPlayer(world, `p${i}`, `player${i}`, { faction: fighter.faction });
    p.weapon0 = fighter.weapon;
    p.slot = 0;
  });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  fighters.forEach((fighter, i) => {
    const p = world.state.players.get(`p${i}`)!;
    p.maxHp = BIG_HP;
    p.hp = BIG_HP;
    place(world, `p${i}`, fighter.at);
  });
  return world;
}

function place(world: World, id: string, at: Vec2): void {
  const c = combatant(world, id)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
}

function give(world: World, at: Vec2): QuestRuntime {
  const qt = offerQuest(world, questDefById("cull-fire")!, true, { at });
  if (world.state.mobs.has(qt.npcId)) place(world, qt.npcId, at);
  return qt;
}

function giver(world: World, qt: QuestRuntime): Extract<Combatant, { kind: "mob" }> {
  const c = combatant(world, qt.npcId);
  if (c?.kind !== "mob") throw new Error("quest giver must be a mob in this combat rig");
  expect(c.s.kind).toBe("quest");
  return c;
}

function send(world: World, player: number, type: string, msg: unknown): void {
  expect(enqueueClientMessage(world.players.get(`p${player}`)!.inputs, type, msg)).toBe(true);
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world, TICK_MS);
}

const hit = (victim: string, raw = 10): LedgerEntry => ({
  victim,
  by: { id: "p0", name: "player0" },
  packet: { raw, phys: 1, magic: 0, true: 0 },
  weapon: "sword",
  scale: 1,
  stagger: false,
});

describe("quest giver immunity", () => {
  it("refuses a target lock without disturbing the attacker's current state", () => {
    const world = makeRun();
    const qt = give(world, { x: 400, y: 320 });
    const player = combatant(world, "p0")!;
    const before = JSON.stringify(world.players.get("p0")!.weapon);

    handleTarget(world, player, { kind: "target", id: qt.npcId });
    expect(JSON.stringify(world.players.get("p0")!.weapon)).toBe(before);
    send(world, 0, "target", { id: qt.npcId });
    step(world, TICK_MS);
    expect(world.players.get("p0")!.weapon.lock).toBeNull();
    expect(world.state.players.get("p0")!.attackTarget).toBe("");
  });

  it("lets a melee swing reach the player behind a giver without marking the giver", () => {
    const world = makeRun([
      { faction: "sentenced", weapon: "sword", at: { x: 300, y: 320 } },
      { faction: "frost", weapon: "shield", at: { x: 360, y: 320 } },
    ], true);
    const qt = give(world, { x: 330, y: 320 });
    const npc = giver(world, qt);
    const victim = world.state.players.get("p1")!;
    const hp = victim.hp;

    send(world, 0, "attack", { a: 0 });
    run(world, 12);

    expect(victim.hp).toBeLessThan(hp);
    expect(npc.s.hp).toBe(npc.s.maxHp);
    expect(npc.s.brand).toBe(0);
    expect(npc.s.sig).toBe(0);
  });

  it("lets a wand ball pass through a giver and damage the player behind it", () => {
    const world = makeRun([
      { faction: "fire", weapon: "wand", at: { x: 300, y: 320 } },
      { faction: "frost", weapon: "shield", at: { x: 500, y: 320 } },
    ]);
    const qt = give(world, { x: 400, y: 320 });
    const npc = giver(world, qt);
    const victim = world.state.players.get("p1")!;
    const hp = victim.hp;

    send(world, 0, "attack", { a: 0 });
    run(world, 30);

    expect(victim.hp).toBeLessThan(hp);
    expect(npc.s.hp).toBe(npc.s.maxHp);
  });

  it("rejects a unit-targeted Wish and spends no cooldown", () => {
    const world = makeRun([
      { faction: "frost", weapon: "bow", at: { x: 300, y: 320 } },
      { faction: "fire", weapon: "sword", at: { x: 600, y: 500 } },
    ]);
    const qt = give(world, { x: 400, y: 320 });
    const npc = giver(world, qt);
    const caster = combatant(world, "p0")!;
    const readyAt = world.state.players.get("p0")!.wishReadyAt;
    expect(validUnitTarget(world, caster, npc, 500, true)).toBe(false);

    send(world, 0, "cast", { slot: "wish", id: qt.npcId, x: npc.s.x, y: npc.s.y });
    step(world, TICK_MS);
    expect(world.players.get("p0")!.cast ?? null).toBeNull();
    expect(world.state.players.get("p0")!.wishReadyAt).toBe(readyAt);
    expect(statusesOf(npc)).toEqual([]);
  });

  it.each(["stun", "root", "dot"] as const)("refuses the %s status outright", (kind) => {
    const world = makeRun();
    const qt = give(world, { x: 400, y: 320 });
    const npc = giver(world, qt);

    const applied = addStatus(world, npc, { kind, source: { id: "p0", name: "player0" }, ms: 5000, value: 30 });
    expect(applied).toBeNull();
    expect(statusesOf(npc)).toEqual([]);
    run(world, 3);
    expect(npc.s.hp).toBe(npc.s.maxHp);
  });

  it("cannot be picked as a mob AI target", () => {
    const world = makeRun();
    const qt = give(world, { x: 400, y: 320 });
    const mob = combatant(world, placeMob(world, { region: "fire", elite: false, at: { x: 500, y: 500 } })) as MobCombatant;

    aggro(world, mob, qt.npcId, 10);
    expect(mob.rt.brain!.mode).toBe("idle");
    expect(mob.rt.brain!.target).toBeNull();
    aggro(world, mob, "p0", 10);
    expect(mob.rt.brain!.mode).toBe("fight");
    expect(mob.rt.brain!.target).toBe("p0");
  });

  it("does not engage or wake a camp when damage is aimed at it", () => {
    const world = makeRun();
    const qt = give(world, { x: 400, y: 320 });
    const npc = giver(world, qt) as MobCombatant;
    const first = combatant(world, placeMob(world, { region: "fire", elite: false, camp: 0, at: { x: 500, y: 500 } })) as MobCombatant;
    const mate = combatant(world, placeMob(world, { region: "fire", elite: false, camp: 0, at: { x: 550, y: 500 } })) as MobCombatant;
    npc.s.camp = first.s.camp;

    hurtMob(world, npc, [10], [hit(npc.id)]);
    expect(mate.rt.brain!.mode).toBe("idle");
    expect(mate.rt.brain!.target).toBeNull();

    hurtMob(world, first, [10], [hit(first.id)]);
    expect(mate.rt.brain!.mode).toBe("fight");
    expect(mate.rt.brain!.target).toBe("p0");
  });
});

import { describe, expect, it } from "vitest";
import {
  BONUS_DEFENSE_CAP, FROST_ELITE_GUARD_BONUS, FROST_ELITE_GUARD_LINGER_MS, holyCampLifestealOf, lifestealFraction,
  mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type CampDef, type FactionId, type GameMap,
} from "@raid/shared";
import { downPlayer } from "../src/sim/arena";
import { CAMP_CLEARED, campMobDied } from "../src/sim/camps";
import { combatant, defenseOf, factionOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { recomputeMods, setExtraRows } from "../src/sim/mods";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { installTraining } from "../src/sim/training";
import type { World } from "../src/sim/world";
import { enqueueClientMessage } from "../src/sim/inputs";

const at = (tile: number): number => tile * TILE + TILE / 2;

function openMap(camps: CampDef[] = []): GameMap {
  const width = 40;
  const height = 28;
  const tiles = new Uint8Array(width * height).fill(TILE_FLOOR);
  for (let x = 0; x < width; x++) {
    tiles[x] = TILE_WALL;
    tiles[(height - 1) * width + x] = TILE_WALL;
  }
  for (let y = 0; y < height; y++) {
    tiles[y * width] = TILE_WALL;
    tiles[y * width + width - 1] = TILE_WALL;
  }
  const map = mapFromTiles(width, height, tiles);
  map.spawns = [{ x: at(4), y: at(22) }, { x: at(34), y: at(22) }];
  map.camps = camps;
  return map;
}

function campDef(zone: FactionId, elite = false): CampDef {
  return {
    id: `${zone}-camp`, zone, x: at(12), y: at(10), r: 96,
    spots: [{ x: at(12), y: at(10) }], eliteSpot: elite ? 0 : -1,
    chest: { x: at(13), y: at(10) }, area: 0, radius: 288,
  };
}

function makeWorld(opts: { factions?: FactionId[]; camps?: CampDef[]; mobs?: boolean; training?: boolean } = {}): World {
  const factions = opts.factions ?? ["frost", "sentenced"];
  const world = createGameWorld({
    config: {
      minPlayers: factions.length, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 3600,
      patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false,
      mobs: opts.mobs ?? false, training: opts.training ?? false,
    },
    random: mulberry32(17), map: openMap(opts.camps),
  });
  if (opts.training) installTraining(world);
  factions.forEach((faction, i) => addPlayer(world, `p${i}`, `Player ${i}`, { faction }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (const [id, player] of world.state.players) {
    player.x = at(10);
    player.y = at(10);
    player.weapon0 = "sword";
    world.players.get(id)!.history = [{ t: world.state.serverTime, x: player.x, y: player.y }];
  }
  return world;
}

function hit(world: World, victim: string, by: string, raw = 100): void {
  recordHit(world, {
    victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false,
  });
  applyLedger(world);
}

describe("Holy Demon Blood", () => {
  it("mirrors only a legitimate camp clear and adds its uncapped share to actual ledger lifesteal", () => {
    const camp = campDef("fire");
    const world = makeWorld({ factions: ["holy", "frost"], camps: [camp], mobs: true });
    const holy = world.state.players.get("p0")!;
    const bystander = world.state.players.get("p1")!;
    holy.x = camp.x;
    holy.y = camp.y;
    bystander.x = at(35);
    bystander.y = at(24);
    world.players.get("p0")!.history = [{ t: world.state.serverTime, x: holy.x, y: holy.y }];
    world.players.get("p1")!.history = [{ t: world.state.serverTime, x: bystander.x, y: bystander.y }];

    const campMobId = [...world.state.mobs].find(([, mob]) => mob.camp === 1)![0];
    const campMob = world.state.mobs.get(campMobId)!;
    recordHit(world, {
      victim: campMobId, by: { id: "p0", name: holy.name },
      packet: { raw: campMob.hp * 10, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false,
    });
    applyLedger(world);

    expect(world.players.get("p0")!.campsCleared).toBe(1);
    expect(holy.campClears).toBe(1);
    expect(bystander.campClears).toBe(0);
    expect(holyCampLifestealOf(holy.campClears)).toBe(0.0025);

    // A cleared roster cannot pay twice even if its death callback is repeated.
    expect(world.hooks.campCleared).toBeDefined();
    expect(world.state.camps[0]!.alive).toBe(0);
    expect(world.state.camps[0]!.state).toBe(CAMP_CLEARED);
    expect(campMobDied(world, 1, "p0")).toBe(false);
    expect(world.players.get("p0")!.campsCleared).toBe(1);

    const dummyId = addMob(world, { kind: "dummy", name: "Practice target", at: { x: holy.x + 24, y: holy.y }, hp: 100_000 });
    holy.hp = holy.maxHp * 0.4;
    const hpBefore = holy.hp;
    expect(enqueueClientMessage(world.players.get("p0")!.inputs, "attack", { a: 0 })).toBe(true);
    expect(enqueueClientMessage(world.players.get("p0")!.inputs, "release", { a: 0 })).toBe(true);

    let dealt = 0;
    for (let i = 0; i < 20; i++) {
      step(world, TICK_MS);
      dealt = world.combat.landed
        .filter((entry) => entry.by === "p0" && entry.victim === dummyId)
        .reduce((sum, entry) => sum + entry.amount, 0);
      if (dealt > 0) break;
    }
    expect(dealt).toBeGreaterThan(0);
    const ownShare = lifestealFraction(factionOf(combatant(world, "p0")!.s)!, 0.4);
    expect(holy.hp - hpBefore).toBeCloseTo(dealt * (ownShare + 0.0025), 5);
  });

  it("mirrors eligible training practice camps through the same per-run clear count", () => {
    const world = makeWorld({ factions: ["holy"], training: true });
    expect(enqueueClientMessage(world.players.get("p0")!.inputs, "train", { cmd: "camp", id: "emberImp" }, { training: true })).toBe(true);
    step(world, TICK_MS);
    const practiceIds = [...world.state.mobs]
      .filter(([, mob]) => mob.camp > 0 && (mob.kind === "mob" || mob.kind === "elite"))
      .map(([id]) => id);
    expect(practiceIds).toHaveLength(3);
    for (const id of practiceIds) {
      const mob = world.state.mobs.get(id)!;
      recordHit(world, {
        victim: id, by: { id: "p0", name: "Player 0" },
        packet: { raw: mob.hp * 10, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false,
      });
      applyLedger(world);
    }
    expect(world.players.get("p0")!.campsCleared).toBe(1);
    expect(world.state.players.get("p0")!.campClears).toBe(0);
    step(world, TICK_MS);
    expect(world.state.players.get("p0")!.campClears).toBe(1);
  });
});

describe("Frost Frozen Justice", () => {
  it("refuses a remote lock and mirrors both defenses for a nearby wand lock", () => {
    const world = makeWorld();
    const frost = world.state.players.get("p0")!;
    const p = world.players.get("p0")!;
    frost.weapon0 = "wand";
    const eliteId = addMob(world, { kind: "elite", name: "Training elite", faction: "fire", at: { x: frost.x + 700, y: frost.y }, hp: 10_000, weapon: "sword" });
    p.weapon.lock = eliteId;
    step(world, TICK_MS);
    expect(frost.frostEliteGuard).toBe(false); // A remote lock cannot grant a PvP defense bonus.

    const elite = world.state.mobs.get(eliteId)!;
    elite.x = frost.x + 20;
    p.weapon.lock = eliteId;
    step(world, TICK_MS);
    expect(frost.frostEliteGuard).toBe(true);
    const base = factionOf(combatant(world, "p0")!.s)!;
    const defense = defenseOf(frost);
    expect(defense.armor).toBeCloseTo(base.armor + FROST_ELITE_GUARD_BONUS, 4);
    expect(defense.shield).toBeCloseTo(base.shield + FROST_ELITE_GUARD_BONUS, 4);
  });

  it("keeps the standard defense cap while showing the active elite guard", () => {
    const world = makeWorld();
    const frost = world.state.players.get("p0")!;
    frost.weapon0 = "wand";
    const fighter = combatant(world, "p0")!;
    setExtraRows(world, fighter, [
      { k: "flat", stat: "armor", v: 200 },
      { k: "flat", stat: "shield", v: 200 },
    ]);
    recomputeMods(world, fighter);
    const eliteId = addMob(world, { kind: "elite", name: "Training elite", faction: "fire", at: { x: frost.x + 20, y: frost.y }, hp: 10_000 });
    world.players.get("p0")!.weapon.lock = eliteId;
    step(world, TICK_MS);
    expect(frost.frostEliteGuard).toBe(true);
    const base = factionOf(fighter.s)!;
    expect(defenseOf(frost).armor).toBeCloseTo(base.armor + BONUS_DEFENSE_CAP, 4);
    expect(defenseOf(frost).shield).toBeCloseTo(base.shield + BONUS_DEFENSE_CAP, 4);
  });

  it("triggers on actual elite contact, excludes normal, quest and dummy mobs, lingers two seconds, and clears on death", () => {
    const world = makeWorld();
    const frost = world.state.players.get("p0")!;
    const normal = addMob(world, { kind: "mob", name: "Normal", faction: "fire", at: { x: frost.x + 80, y: frost.y }, hp: 10_000 });
    const quest = addMob(world, { kind: "quest", name: "Quest keeper", faction: "fire", at: { x: frost.x + 90, y: frost.y }, hp: 10_000 });
    const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: { x: frost.x + 100, y: frost.y }, hp: 10_000 });
    for (const id of [normal, quest, dummy]) {
      hit(world, "p0", id);
      step(world, TICK_MS);
      expect(frost.frostEliteGuard).toBe(false);
    }

    const elite = addMob(world, { kind: "elite", name: "Training elite", faction: "fire", at: { x: frost.x + 100, y: frost.y }, hp: 10_000 });
    const contactAt = world.state.serverTime;
    hit(world, "p0", elite);
    step(world, TICK_MS);
    expect(frost.frostEliteGuard).toBe(true);

    step(world, FROST_ELITE_GUARD_LINGER_MS - TICK_MS);
    expect(frost.frostEliteGuard).toBe(false);
    expect(defenseOf(frost).armor).toBeCloseTo(factionOf(combatant(world, "p0")!.s)!.armor, 4);

    hit(world, "p0", elite);
    step(world, TICK_MS);
    expect(frost.frostEliteGuard).toBe(true);
    downPlayer(world, frost, world.players.get("p0")!, "died");
    expect(frost.frostEliteGuard).toBe(false);
    expect(world.state.serverTime).toBeGreaterThan(contactAt);
  });
});

// A mob type's ROLE in the real sim (shared mobs.ts MOB_ROLE_DEFS; sim/combatant.ts factionOf, sim/mobLife.ts mobRoleMove): the
// speed it walks at, the damage it deals, and the distance a caster holds (the role changes stats and weapon, never the AI's inputs).
// The numbers are read from the catalog, not repeated here, so a retune of the role table does not break them.
import { describe, expect, it } from "vitest";
import {
  mapFromTiles, MOB_ROLE_DEFS, MOB_ROLES, MOB_TYPES, mulberry32, POLICIES, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type FactionId, type FxEvent, type GameMap, type MobRole, type MobTypeDef, type MobTypeId, type Vec2,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { aggro } from "../src/sim/mobAI";
import { placeMob, type MobCombatant } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

const SIDE = 32;
const tile = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const CONFIG: SimConfig = {
  minPlayers: 1, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9, suddenDeathSeconds: 1e9,
};

function openMap(): GameMap {
  const tiles = new Uint8Array(SIDE * SIDE).fill(TILE_FLOOR);
  for (let i = 0; i < SIDE; i++) {
    tiles[i] = tiles[(SIDE - 1) * SIDE + i] = TILE_WALL;
    tiles[i * SIDE] = tiles[i * SIDE + SIDE - 1] = TILE_WALL;
  }
  const map = mapFromTiles(SIDE, SIDE, tiles);
  map.spawns = [tile(3, 3), tile(5, 3)];
  return map;
}

/** A run on an open 32 x 32 floor with one player (`faction`, an empty hand) standing at `at`, hp no scenario can exhaust. */
function arena(faction: FactionId, at: Vec2): { world: World; player: ReturnType<typeof playerOf> } {
  const world = createGameWorld({ config: CONFIG, random: mulberry32(1), map: openMap() });
  addPlayer(world, "p", "P", { faction });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  const player = playerOf(world);
  player.s.maxHp = player.s.hp = 1e6;
  player.s.x = at.x;
  player.s.y = at.y;
  player.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
  return { world, player };
}

function playerOf(world: World) {
  return { s: world.state.players.get("p")!, rt: world.players.get("p")! };
}

function place(world: World, t: MobTypeDef, at: Vec2, facing = 0): MobCombatant {
  return combatant(world, placeMob(world, { region: t.zone, elite: t.elite, type: t.id, at, facing })) as MobCombatant;
}

const typeOf = (id: MobTypeId): MobTypeDef => MOB_TYPES.find((t) => t.id === id)!;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("a mob walks at its role's speed", () => {
  it.each(MOB_ROLES)("%s: PLAYER_SPEED times the role's moveMult along a path, a typeless mob at PLAYER_SPEED", (role: MobRole) => {
    const t = MOB_TYPES.find((x) => x.role === role && !x.elite)!;
    const { world } = arena("holy", tile(28, 28));
    const from = tile(4, 16);
    const typed = place(world, t, from);
    const plain = combatant(world, placeMob(world, { region: t.zone, elite: false, at: tile(4, 20) })) as MobCombatant;
    typed.rt.path = [tile(27, 16)];
    plain.rt.path = [tile(27, 20)];
    const startedAt = { typed: { x: typed.s.x, y: typed.s.y }, plain: { x: plain.s.x, y: plain.s.y } };
    for (let i = 0; i < 20; i++) step(world, TICK_MS); // one second
    expect(dist(startedAt.plain, plain.s)).toBeCloseTo(PLAYER_SPEED, 3);
    expect(dist(startedAt.typed, typed.s)).toBeCloseTo(PLAYER_SPEED * MOB_ROLE_DEFS[role].moveMult, 3);
  });

  it("makes the skirmisher and the swarm faster than a player and the brute slower", () => {
    expect(MOB_ROLE_DEFS.skirmisher.moveMult).toBeGreaterThan(1);
    expect(MOB_ROLE_DEFS.swarm.moveMult).toBeGreaterThan(1);
    expect(MOB_ROLE_DEFS.brute.moveMult).toBeLessThan(1);
    expect(MOB_ROLE_DEFS.grunt.moveMult).toBe(1);
  });
});

describe("a mob hits for its role's share of the faction's damage", () => {
  /** Damage of the first `hit` fx the mob lands on the player standing 90 u away, who does not fight back. */
  function firstHit(id: MobTypeId): number {
    const t = typeOf(id);
    const { world } = arena("holy", tile(16, 16));
    const mob = place(world, t, { x: tile(16, 16).x - 90, y: tile(16, 16).y }, 0);
    aggro(world, mob, "p", 1);
    for (let i = 0; i < 200; i++) {
      const hit = step(world, TICK_MS).flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.by === mob.id && e.fx.id === "p" ? [e.fx as Extract<FxEvent, { kind: "hit" }>] : []))[0];
      if (hit) return hit.amount;
    }
    throw new Error(`${id} never hit`);
  }

  it("scales the same weapon's hit by dmgMult: Plague's three bow types hit in the ratio of their roles", () => {
    const rat = firstHit("plagueRat");
    const monk = firstHit("rotMonk");
    const fly = firstHit("bloatfly");
    expect(rat / monk).toBeCloseTo(typeOf("plagueRat").dmgMult / typeOf("rotMonk").dmgMult, 2);
    expect(fly / monk).toBeCloseTo(typeOf("bloatfly").dmgMult / typeOf("rotMonk").dmgMult, 2);
    expect(rat).toBeLessThan(monk);
    expect(monk).toBeLessThan(fly);
  });
});

describe("a caster stays out of reach, a brute closes in (the weapon's policy, not a role rule)", () => {
  /** Distance to the player, in tiles, after a few seconds of a fight with a motionless player. */
  function standOff(id: MobTypeId): number {
    const t = typeOf(id);
    const { world, player } = arena("holy", tile(16, 16));
    const mob = place(world, t, { x: tile(16, 16).x - 5 * TILE, y: tile(16, 16).y }, 0);
    aggro(world, mob, "p", 1);
    for (let i = 0; i < 100; i++) step(world, TICK_MS);
    expect(mob.s.status).toBe("alive");
    return dist(mob.s, player.s) / TILE;
  }

  it("holds a caster at its weapon's range and a melee mob of the same zone at arm's length", () => {
    const caster = standOff("flameCaller"); // wand
    const brute = standOff("magmaBrute"); // axe
    expect(caster).toBeGreaterThan(brute + 1);
    expect(brute).toBeLessThan(POLICIES.axe.attackRange / TILE);
  });
});

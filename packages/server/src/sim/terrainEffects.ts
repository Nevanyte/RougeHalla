// Terrain hazards: the ONLY module that knows how a surface acts on a fighter (ROGUELIKE zone terrain, part B). What each
// surface does lives in shared/terrain.ts (TERRAINS, surfaceAt): the tile under a fighter's centre, its faction's home
// rule applied. Here it is wired into the tick through the sim's existing seams, and no phase is added or moved:
//   ember  burn   a ledger entry in beforeDamage (arena damage: true, share of max hp, no hit fx, not combat), as sudden
//                 death's burn is; kill credit goes through the usual recentRival rule, the recap reads "Lava"
//   bog    slow   a world.moveModifiers entry (multiplies with the chill and the buffs; step.ts floors the product)
//   ice    slide  not here: sim/movement.ts walkFighter asks slipAccelOf and runs shared/walk.ts
//   light  heal   heal(..., quiet) from a system after the damage pass (the 3 s out-of-combat lockout applies, players
//                 only), reported as one summed `heal` fx per player per LIGHT_FX_MS. The lockout is kept here as well, from
//                 the tick's landed hits, because heal() reads the faction layer's combat clock and a world built without
//                 signatures (the weapon harness's default) has none: light would otherwise heal through a fight.
// Every pass returns on its first line when the map holds no such hazard (or `SimConfig.hazards` is false), so a map
// without terrain costs one cached object read per pass. The `apply*` functions are what callers use; their bodies are the
// only thing a later move onto the status runtime changes (part B 6).
import {
  HEAL_LOCKOUT_SECONDS, hazardsOf, surfaceAt, surfaceEffect, TERRAIN_NONE, TICK_MS, type MapHazards, type SurfaceEffect,
} from "@raid/shared";
import { combatant, isEvading, standing, standingCombatants, type Combatant } from "./combatant";
import { heal } from "./factions";
import { recordHit } from "./ledger";
import { chainHook, emit, type DamageSource, type World } from "./world";

const TERRAIN_PREFIX = "terrain:";

/** Who a terrain entry in the ledger is credited to: a string source, never a player (arena.ts credits a kill through recentRival). */
export const TERRAIN_SOURCE = {
  ember: { id: "terrain:ember", name: "Lava" },
  bog: { id: "terrain:bog", name: "Bog" },
} as const satisfies Record<string, DamageSource>;

/** Light reports what it healed once per this many ms, as one `heal` fx per player (FIRST PICK), when the sum is at least LIGHT_FX_MIN. */
export const LIGHT_FX_MS = 1000;
const LIGHT_FX_MIN = 0.5;

export interface TerrainRuntime {
  /** hp light restored to each player since `lightSince`, waiting for the next report. */
  lightAcc: Map<string, number>;
  /** Server ms the current report window began. */
  lightSince: number;
  /** Server ms each fighter last dealt or took damage (this tick's landed hits, stamped by lightPass): light's own lockout clock. */
  combatAt: Map<string, number>;
}

type PlayerCombatant = Extract<Combatant, { kind: "player" }>;

const NO_HAZARDS: MapHazards = { burn: false, slow: false, slip: false, heal: false };
const NEUTRAL: SurfaceEffect = surfaceEffect(TERRAIN_NONE, "");

/** The effects the world's map can have for this run: none when the switch is off. Reads `world.map` every call (tests swap it). */
function hazardsFor(world: World): MapHazards {
  return world.config.hazards === false ? NO_HAZARDS : hazardsOf(world.map);
}

function effectAt(world: World, c: Combatant, x: number, y: number): SurfaceEffect {
  // A training dummy is a target, not a fighter on the ground; "all" (measurement) takes the home rule away from everyone.
  if (c.kind === "mob" && c.s.kind === "dummy") return NEUTRAL;
  return surfaceAt(world.map, x, y, world.config.hazards === "all" ? "" : c.s.faction);
}

/** The surface under a fighter's centre, its faction's home rule applied; the neutral effect for a training dummy. */
export function surfaceOf(world: World, c: Combatant): SurfaceEffect {
  return effectAt(world, c, c.s.x, c.s.y);
}

/** Slide traction under the fighter's centre (0: full grip, off ice or exempt). movement.ts walkFighter reads this. */
export function slipAccelOf(world: World, c: Combatant): number {
  return hazardsFor(world).slip ? effectAt(world, c, c.s.x, c.s.y).accel : 0;
}

/** Slide traction under a point, for this fighter: the slide asks it as the body crosses ground. */
export function slipAccelAt(world: World, c: Combatant, x: number, y: number): number {
  return hazardsFor(world).slip ? effectAt(world, c, x, y).accel : 0;
}

/** Fighter-seconds a hazard acted on (world.hazards.stats). */
export function countHazardSeconds(world: World, kind: "ember" | "bog" | "ice" | "light", dtMs: number): void {
  world.hazards.stats.seconds[kind] += dtMs / 1000;
}

/** v1: the walk multiplier under the fighter (1 off bog and for Plague). v2 would apply a slow status and return 1. `dtMs` is the step (step.ts passes it). */
export function applyBog(world: World, c: Combatant, dtMs: number = TICK_MS): number {
  if (!hazardsFor(world).slow) return 1;
  const e = surfaceOf(world, c);
  if (e.speedMult !== 1) countHazardSeconds(world, "bog", dtMs);
  return e.speedMult;
}

/** v1: records this tick's burn on the ledger. v2 would add or refresh a dot status. */
export function applyBurn(world: World, c: Combatant, dtMs: number): void {
  const e = surfaceOf(world, c);
  if (!(e.burnShare > 0)) return;
  const raw = e.burnShare * c.s.maxHp * (dtMs / 1000);
  // `weapon` is never read for an arena entry (arena.ts suddenDeath does the same).
  recordHit(world, {
    victim: c.id, by: TERRAIN_SOURCE.ember, packet: { raw, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false, arena: true,
  });
  countHazardSeconds(world, "ember", dtMs);
}

/** WorldHooks.arenaHurt: the hp the ledger actually took off a fighter for a terrain entry (world.hazards.stats.damage). */
function terrainHurt(world: World, victim: string, by: DamageSource, hp: number): void {
  if (!by.id.startsWith(TERRAIN_PREFIX)) return;
  const kind = by.id.slice(TERRAIN_PREFIX.length);
  const dmg = world.hazards.stats.damage;
  const row = dmg.get(victim);
  if (row) row[kind] = (row[kind] ?? 0) + hp;
  else dmg.set(victim, { [kind]: hp });
}

/** Heals a player standing in light (quiet: the report is summed, see lightPass). Returns the hp gained. */
export function applyLight(world: World, c: PlayerCombatant, dtMs: number): number {
  const e = surfaceOf(world, c);
  if (!(e.healShare > 0)) return 0;
  countHazardSeconds(world, "light", dtMs);
  const last = world.terrain?.combatAt.get(c.id);
  if (last !== undefined && world.state.serverTime - last < HEAL_LOCKOUT_SECONDS * 1000) return 0;
  const gained = heal(world, c, e.healShare * c.s.maxHp * (dtMs / 1000), { quiet: true });
  if (gained > 0) {
    const m = world.hazards.stats.heal;
    m.set(c.id, (m.get(c.id) ?? 0) + gained);
  }
  return gained;
}

/**
 * beforeDamage, after the signatures (which read the ledger for the tick's contacts), as sudden death's burn is: players and
 * regional mobs that are not at home. Not a training dummy, and not a mob walking home (evading: hurtMob refuses the hit anyway,
 * but skipping it here keeps its seconds out of the stats).
 */
function burnPass(world: World, dtMs: number): void {
  // The coliseum has no terrain (validateTerrain T8), so a locked arena burns nothing: a pass that holds sudden death's entry
  // never holds a terrain one, and a death in it credits nobody (arena.ts applyHits).
  if (!hazardsFor(world).burn || world.state.gatesLocked) return;
  for (const c of standingCombatants(world)) {
    if (c.kind === "mob" && (c.s.kind === "dummy" || isEvading(c))) continue;
    applyBurn(world, c, dtMs);
  }
}

/** systems, after afterDamage has stamped this tick's combat clock: players only (a mob regenerates on its own). */
function lightPass(world: World, dtMs: number): void {
  if (!hazardsFor(world).heal) return;
  const rt = world.terrain;
  if (!rt) return;
  const now = world.state.serverTime;
  for (const h of world.combat.landed) {
    rt.combatAt.set(h.victim, now);
    rt.combatAt.set(h.by, now);
  }
  for (const c of standingCombatants(world)) {
    if (c.kind !== "player") continue;
    const gained = applyLight(world, c, dtMs);
    if (gained > 0) rt.lightAcc.set(c.id, (rt.lightAcc.get(c.id) ?? 0) + gained);
  }
  if (now - rt.lightSince < LIGHT_FX_MS) return;
  for (const [id, sum] of rt.lightAcc) {
    if (!(sum >= LIGHT_FX_MIN)) continue;
    const c = combatant(world, id);
    if (c && standing(c)) emit(world, { type: "fx", fx: { kind: "heal", id, amount: sum } });
  }
  rt.lightAcc.clear();
  rt.lightSince = now;
}

/** Nobody carries a slide through a teleport, a start or a revive. */
function clearSlips(world: World): void {
  for (const rt of world.players.values()) rt.slip = null;
  for (const rt of world.mobs.values()) rt.slip = null;
}

function onRaidStarted(world: World): void {
  clearSlips(world);
  const rt = world.terrain;
  if (!rt) return;
  rt.lightAcc.clear();
  rt.combatAt.clear();
  rt.lightSince = world.state.serverTime;
}

export function install(world: World): void {
  world.terrain = { lightAcc: new Map(), lightSince: 0, combatAt: new Map() };
  world.moveModifiers.push(applyBog);
  world.beforeDamage.push(burnPass);
  world.systems.push(lightPass);
  chainHook(world, "arenaHurt", terrainHurt);
  chainHook(world, "teleported", clearSlips);
  chainHook(world, "raidStarted", onRaidStarted);
}

// Zone gameplay module: a circle that collapses onto one extract (shared/zone.ts holds the maths).
// The plan is made once, when the raid starts, from the server-private RNG; every step the sim writes
// the circle for the current time into state.zone and burns whoever is outside it. Dying to the zone
// is nobody's kill: the death fx has no killer and the result says "the zone" (see RaidResult.killedBy).
// step.ts only runs systems during an active raid; the phase check here keeps a direct call safe too.
// A map without extracts (hand-built test arenas) has nothing to collapse onto: it gets no zone at all.
import { isOutside, planZone, zoneAt, zoneDps, type ZonePlan, type ZoneSnapshot } from "@raid/shared";
import { resolvePlayer } from "./step";
import { emit, type World } from "./world";

export const ZONE_KILLER = "the zone";

const plans = new WeakMap<World, ZonePlan>();

/** This world's zone plan: undefined until the raid has started. */
export function zonePlanOf(world: World): ZonePlan | undefined {
  return plans.get(world);
}

function planFor(world: World): ZonePlan | undefined {
  let plan = plans.get(world);
  if (!plan && world.map.extracts.length > 0) {
    plan = planZone(world.map, world.config.raidSeconds * 1000, world.random);
    plans.set(world, plan);
  }
  return plan;
}

/** Writes the zone for the current server time into state (unchanged fields cost no patch). */
function publishZone(world: World): ZoneSnapshot | null {
  const plan = planFor(world);
  if (!plan) return null;
  const s = world.state;
  const z = zoneAt(plan, s.serverTime - s.raidStartedAt);
  const out = s.zone;
  out.x = z.x;
  out.y = z.y;
  out.r = z.r;
  out.nextX = z.nextX;
  out.nextY = z.nextY;
  out.nextR = z.nextR;
  out.stage = z.stage;
  out.shrinking = z.shrinking;
  out.changeAt = s.raidStartedAt + z.changeAtElapsed;
  return z;
}

export function zoneSystem(world: World, dtMs: number): void {
  if (world.state.phase !== "active") return;
  const zone = publishZone(world);
  if (!zone) return;
  const damage = zoneDps(zone.stage) * (dtMs / 1000);
  if (damage <= 0) return;

  for (const [id, p] of world.state.players) {
    if (p.status !== "alive" || !isOutside(zone, p.x, p.y)) continue;
    const rt = world.players.get(id);
    if (!rt) continue;
    p.hp = Math.max(0, p.hp - damage);
    if (p.hp > 0) continue;

    rt.killedBy = ZONE_KILLER;
    emit(world, { type: "fx", fx: { kind: "death", id, x: p.x, y: p.y, by: null } });
    resolvePlayer(world, p, rt, "died");
  }
}

export function install(world: World): void {
  world.systems.push(zoneSystem);
  // Publish the opening circle in the same tick the raid starts, so an active raid never shows stage 0.
  const previous = world.hooks.raidStarted;
  world.hooks.raidStarted = (w) => {
    previous?.(w);
    publishZone(w);
  };
}

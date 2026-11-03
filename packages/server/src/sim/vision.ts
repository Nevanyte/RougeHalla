import { bushConceals, isInVision, TICK_MS, VISION_UPDATE_MS, VisionMemory, type Vec2 } from "@raid/shared";
import { chainHook, collisionMap, type World } from "./world";

// Deliberately absent from RaidState: no player's discovery history is broadcast to another player.
interface PrivateVision { map: World["map"]; players: Map<string, VisionMemory>; phases: Map<string, number>; nextPhase: number }
const WINDOW_TICKS = Math.max(1, Math.round(VISION_UPDATE_MS / TICK_MS));
const memories = new WeakMap<World, PrivateVision>();

export function getVisionMemory(world: World, id: string): VisionMemory | null {
  const runtime = memories.get(world);
  if (!runtime) return null;
  if (runtime.map !== world.map) {
    runtime.map = world.map;
    runtime.players.clear();
    runtime.phases.clear();
  }
  const all = runtime.players;
  const player = world.state.players.get(id);
  if (!player || player.status !== "alive") return all.get(id) ?? null;
  let memory = all.get(id);
  if (!memory || memory.width !== world.map.w || memory.height !== world.map.h) {
    memory = new VisionMemory(world.map.w, world.map.h);
    all.set(id, memory);
  }
  memory.update(collisionMap(world), player, world.state.serverTime);
  return memory;
}

/** Each player refreshes on its own tick of the VISION_UPDATE_MS window (the memory's own throttle keeps the cadence), so one tick never carries every player's rays. */
export function refreshVision(world: World): void {
  if (world.state.phase !== "active") return;
  const runtime = memories.get(world);
  if (!runtime) return;
  const tick = Math.round(world.state.serverTime / TICK_MS);
  for (const id of world.players.keys()) {
    let phase = runtime.phases.get(id);
    if (phase === undefined) { phase = runtime.nextPhase++ % WINDOW_TICKS; runtime.phases.set(id, phase); }
    if ((tick + phase) % WINDOW_TICKS === 0 || !runtime.players.has(id)) getVisionMemory(world, id);
  }
}

/** Raid start and teleports need every trail fresh at once. */
function refreshAllVision(world: World): void {
  if (world.state.phase !== "active") return;
  for (const id of world.players.keys()) getVisionMemory(world, id);
}

/** Server targeting and private sync read the same trail and owned ward sources as the client. */
export function canPlayerSee(world: World, id: string, point: Vec2): boolean {
  // Bare simulation worlds that did not install this gameplay module retain their existing test/harness behavior.
  if (!memories.has(world) || world.config.training) return true;
  const p = world.state.players.get(id);
  if (!p || p.status !== "alive") return false;
  const now = world.state.serverTime, map = collisionMap(world);
  if (getVisionMemory(world, id)?.canSee(point, now) || isInVision(map, p, point)) return true;
  for (let i = 0; i < world.state.camps.length; i++) {
    const camp = world.state.camps[i]!;
    if (camp.wardOwner === id && now < camp.wardExpiresAt) {
      const site = world.map.camps[i];
      if (site && isInVision(map, site, point)) return true;
    }
  }
  return false;
}

/** Actor-specific exception: a Sentenced hunter may see only the living player it selected, not nearby terrain or actors. */
export function canPlayerSeeActor(world: World, viewerId: string, actorId: string, point: Vec2): boolean {
  const viewer = world.state.players.get(viewerId);
  const target = world.state.players.get(actorId);
  if (world.state.phase === "active" && !world.config.training
    && viewer?.status === "alive" && viewer.faction === "sentenced"
    && viewer.huntTarget === actorId && target?.status === "alive") return true;
  if (!canPlayerSee(world, viewerId, point)) return false;
  // Bush occupants (players only: mobs are never concealed) are hidden from viewers outside the bush. Mobs and training ignore it.
  if (memories.has(world) && !world.config.training && viewer && target && target.status === "alive") {
    if (bushConceals(world.map, viewer, point, target.extra.bushRevealUntil, world.state.serverTime)) return false;
  }
  return true;
}

export function install(world: World): void {
  memories.set(world, { map: world.map, players: new Map(), phases: new Map(), nextPhase: 0 });
  world.systems.push(refreshVision);
  chainHook(world, "raidStarted", refreshAllVision);
  chainHook(world, "teleported", refreshAllVision);
  chainHook(world, "fighterOut", (w, id, cause) => {
    if (cause !== "removed") return;
    const m = memories.get(w);
    m?.players.delete(id);
    m?.phases.delete(id);
  });
}

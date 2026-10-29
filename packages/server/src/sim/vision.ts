import { isInVision, VisionMemory, type Vec2 } from "@raid/shared";
import { chainHook, collisionMap, type World } from "./world";

// Deliberately absent from RaidState: no player's discovery history is broadcast to another player.
interface PrivateVision { map: World["map"]; players: Map<string, VisionMemory> }
const memories = new WeakMap<World, PrivateVision>();

export function getVisionMemory(world: World, id: string): VisionMemory | null {
  const runtime = memories.get(world);
  if (!runtime) return null;
  if (runtime.map !== world.map) {
    runtime.map = world.map;
    runtime.players.clear();
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

export function refreshVision(world: World): void {
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

export function install(world: World): void {
  memories.set(world, { map: world.map, players: new Map() });
  world.systems.push(refreshVision);
  chainHook(world, "raidStarted", refreshVision);
  chainHook(world, "teleported", refreshVision);
  chainHook(world, "fighterOut", (w, id, cause) => {
    if (cause === "removed") memories.get(w)?.players.delete(id);
  });
}

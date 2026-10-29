import type { VisionSnapshotMessage } from "@raid/shared";
import { getVisionMemory } from "../sim/vision";
import type { World } from "../sim/world";

/** Build only the requesting player's trail; this is never part of the broadcast state. */
export function visionSnapshot(world: World, id: string): VisionSnapshotMessage | null {
  const memory = getVisionMemory(world, id);
  if (!memory) return null;
  const at = world.state.serverTime;
  const cells: VisionSnapshotMessage["cells"] = [];
  memory.expiresAt.forEach((expiry, index) => {
    if (expiry > at) cells.push([index, expiry]);
  });
  return { seed: world.map.seed, w: world.map.w, h: world.map.h, at, cells };
}

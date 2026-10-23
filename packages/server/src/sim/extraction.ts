// Extraction gameplay module: stand inside an extract zone for `config.extractSeconds` to leave the
// raid with everything you carry. Moving (step.ts) and attacking (combat.ts) cancel it from their
// own side (all through cancelExtraction in world.ts); this module cancels it when the player is
// somehow outside the zone and completes it.
// step.ts only runs actions for alive players in an active raid, so the handler doesn't re-check that.
import type { ExtractZoneDef } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { resolvePlayer } from "./step";
import { cancelExtraction, emit, type ActionHandler, type PlayerRuntime, type World } from "./world";

/** Absorbs float noise in `extractSeconds * 1000` so a whole number of ticks completes on time. */
const EPSILON_MS = 1e-6;

function toast(world: World, rt: PlayerRuntime, text: string): void {
  emit(world, { type: "toast", to: rt.id, text });
}

const distanceTo = (p: PlayerState, z: ExtractZoneDef): number => Math.hypot(p.x - z.x, p.y - z.y);

/** The zone whose circle contains the player (the nearest centre if circles overlap), or null. */
function zoneAt(world: World, p: PlayerState): ExtractZoneDef | null {
  let best: ExtractZoneDef | null = null;
  let bestDist = Infinity;
  for (const z of world.map.extracts) {
    const d = distanceTo(p, z);
    if (d <= z.r && d < bestDist) { best = z; bestDist = d; }
  }
  return best;
}

export const handleExtract: ActionHandler = (world, p, rt, cmd) => {
  if (cmd.kind !== "extract") return;
  if (rt.extracting) return;
  const zone = zoneAt(world, p);
  if (!zone) { toast(world, rt, "Not in an extraction zone"); return; }
  rt.extracting = { zoneId: zone.id, startedAt: world.state.serverTime };
  p.extractProgress = 0;
  // The contract says "stay put": a walk queued before pressing extract must not carry the player out of the zone.
  rt.path = [];
};

export function extractionSystem(world: World): void {
  const now = world.state.serverTime;
  const durationMs = world.config.extractSeconds * 1000;
  for (const [id, p] of world.state.players) {
    if (p.status !== "alive") continue;
    const rt = world.players.get(id);
    const ex = rt?.extracting;
    if (!rt || !ex) continue;

    // handleExtract only ever stores ids from this map, so an unknown id is foreign state (a test
    // fixture, say): there is nothing to measure against, so leave it alone instead of guessing.
    const zone = world.map.extracts.find((z) => z.id === ex.zoneId);
    if (!zone) continue;
    if (distanceTo(p, zone) > zone.r) {
      cancelExtraction(world, p, rt);
      continue;
    }

    const elapsed = now - ex.startedAt;
    const done = durationMs <= 0 || elapsed + EPSILON_MS >= durationMs;
    p.extractProgress = done ? 1 : Math.min(1, Math.max(0, elapsed / durationMs));
    if (done) {
      emit(world, { type: "fx", fx: { kind: "extracted", id } });
      resolvePlayer(world, p, rt, "extracted");
    }
  }
}

export function install(world: World): void {
  world.actions.extract = handleExtract;
  world.systems.push(extractionSystem);
}

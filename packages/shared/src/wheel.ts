// The counter wheel: geometry of the two pentagrams (the faction cycle and the weapon loop) for the hub to draw. Pure data
// derived from BEATS / WEAPON_BEATS, so a retuned counter graph redraws itself.
//
// Each set is a pentagon in which every node beats the next two clockwise: the sides (i → i+1) and the diagonals
// (i → i+2) together make the star. The ring order is found, not written down, so it cannot drift from the edge lists.
import { BEATS, FACTION_IDS, type FactionId } from "./factions";
import { WEAPON_BEATS, WEAPON_IDS, type WeaponId } from "./weapons";

/** A node on the unit circle, y down (screen orientation); node 0 is at the top, the rest follow clockwise. */
export interface WheelNode<Id extends string> { id: Id; x: number; y: number }
/** `winner` beats `loser`. `kind`: "side" for the next node clockwise, "diagonal" for the one after it. */
export interface WheelEdge<Id extends string> { winner: Id; loser: Id; kind: "side" | "diagonal" }
export interface Wheel<Id extends string> { nodes: WheelNode<Id>[]; edges: WheelEdge<Id>[] }

/** Positions on a circle of `radius` (default the unit circle), node 0 at the top, clockwise on screen. */
export function ringPositions(count: number, radius = 1): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

/**
 * The first ring order, starting at `ids[0]`, in which every id beats the next two. Throws when the graph is not a
 * five-cycle of that kind (a retune that broke the designed loop should fail loudly, not draw a wrong wheel).
 */
export function ringOrder<Id extends string>(ids: readonly Id[], beats: ReadonlyArray<readonly [Id, Id]>): Id[] {
  const wins = new Set(beats.map(([w, l]) => `${w}>${l}`));
  const [first, ...others] = ids;
  for (const rest of permutations(others)) {
    const ring = [first as Id, ...rest];
    const n = ring.length;
    if (ring.every((id, i) => wins.has(`${id}>${ring[(i + 1) % n]}`) && wins.has(`${id}>${ring[(i + 2) % n]}`))) return ring;
  }
  throw new Error(`no ring order in which each of ${ids.join(", ")} beats the next two`);
}

function buildWheel<Id extends string>(ids: readonly Id[], beats: ReadonlyArray<readonly [Id, Id]>): Wheel<Id> {
  const ring = ringOrder(ids, beats);
  const at = ringPositions(ring.length);
  const nodes = ring.map((id, i) => ({ id, x: at[i]!.x, y: at[i]!.y }));
  const edges: WheelEdge<Id>[] = [];
  ring.forEach((id, i) => {
    edges.push({ winner: id, loser: ring[(i + 1) % ring.length]!, kind: "side" });
    edges.push({ winner: id, loser: ring[(i + 2) % ring.length]!, kind: "diagonal" });
  });
  return { nodes, edges };
}

export const FACTION_WHEEL: Wheel<FactionId> = buildWheel(FACTION_IDS, BEATS);
export const WEAPON_WHEEL: Wheel<WeaponId> = buildWheel(WEAPON_IDS, WEAPON_BEATS);

/** What `id` beats and what beats it, read off a wheel (two of each in a five-cycle). */
export function wheelMatchups<Id extends string>(wheel: Wheel<Id>, id: Id): { beats: Id[]; losesTo: Id[] } {
  return {
    beats: wheel.edges.filter((e) => e.winner === id).map((e) => e.loser),
    losesTo: wheel.edges.filter((e) => e.loser === id).map((e) => e.winner),
  };
}

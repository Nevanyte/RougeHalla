// The decor props of a styled map (map.props, cosmetic; the sim never reads them): which of them are painted into the baked art
// (flat decals into a floor chunk, wall details into a wall strip's face) and which also animate (an emitter: embers rise from a
// vent, spores from a bubble, sparkles from frost). Static props cost nothing per frame; only emitters are drawn live, by
// TerrainFx, and only the few in the camera rect. Pure.
import { ZONE_PROP_KINDS, worldToTile, type GameMap, type MapProp } from "@raid/shared";
import { EMITTER_PROPS, FLAT_PROPS, WALL_PROPS } from "./zoneStyle";

/** The particle kind each emitting prop sends. */
export type PropEmission = "ember" | "spore" | "frost";
export const PROP_EMISSION: Readonly<Record<string, PropEmission>> = { ember_vent: "ember", bubble: "spore", frost_sparkle: "frost" };

export interface PropPlan {
  /** Painted into a floor chunk. */
  flat: Array<{ prop: MapProp; key: string }>;
  /** Painted into the strip of the tile they stand on, by tile index. */
  wall: Map<number, MapProp[]>;
  /** The props that also emit particles. */
  emitters: Array<{ prop: MapProp; key: string; kind: PropEmission }>;
  /** Props of a kind the art does not know (a newer generator): skipped. */
  unknown: number;
}

/** Sorts a map's props. A prop is flat, or on a wall face, or unknown; an emitter is a flat prop that also emits. */
export function planProps(map: GameMap): PropPlan {
  const plan: PropPlan = { flat: [], wall: new Map(), emitters: [], unknown: 0 };
  for (const prop of map.props) {
    const key = ZONE_PROP_KINDS[prop.kind]?.key;
    if (key === undefined) { plan.unknown++; continue; }
    if (FLAT_PROPS.has(key)) {
      plan.flat.push({ prop, key });
      if (EMITTER_PROPS.has(key)) plan.emitters.push({ prop, key, kind: PROP_EMISSION[key]! });
    } else if (WALL_PROPS.has(key)) {
      const i = worldToTile(prop.y) * map.w + worldToTile(prop.x);
      const list = plan.wall.get(i);
      if (list) list.push(prop);
      else plan.wall.set(i, [prop]);
    } else {
      plan.unknown++;
    }
  }
  return plan;
}

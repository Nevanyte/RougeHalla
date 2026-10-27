// The decor kinds the zone stylers place (part D 7.4). The table itself lives in the leaf module ../propKinds (terrain.ts exports it
// as PROP_KINDS, the default prop table of validateTerrain's T9); `ZONE_PROP_KINDS` is the same array under the stylers' name, so
// `validateTerrain(map, { styled: true })` needs no `propKinds` option for a styled map. `GameMap.props[].kind` indexes it:
// APPEND ONLY, never reorder.
import { PROP_KINDS } from "../propKinds";
import type { PropKindSpec } from "../propKinds";

export const ZONE_PROP_KINDS: readonly PropKindSpec[] = PROP_KINDS;

/** Kind id by key: `PROP.ember_vent`. */
export const PROP: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  ZONE_PROP_KINDS.forEach((k, i) => { out[k.key] = i; });
  return out;
})();

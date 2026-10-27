// The zone stylers as the generator's hook (styler.ts): the adapter between the generator's StyleState and styleZones'
// ZoneStyleState. The two differ in small ways and nowhere else:
//  - `territoryGrid` is always there on a generated map (the stylers take it as `territory`, null on a synthetic fixture);
//  - `decor` is a field of the generator's state and an option of styleZones (false: no decor stream, no props);
//  - the generator's hook returns nothing, styleZones returns one StyleResult per zone: the adapter keeps their telemetry in
//    STYLER_STATS (benches and tests read it; nothing in a map depends on it);
//  - `camps[].r` is in TILES on both sides (CAMP_R), so it passes as it is.
// The generator's `protect` is the stylers' `hard`; it adds no `noBlock` or `noProp` of its own (its protect list already
// holds the ring road + 1, the camp halos and the ruins + 1, and it filters props against the final spawn, crate and
// ground spots itself).
import type { StyleState, ZoneStyleHook } from "../styler";
import { styleZones } from "./styleZones";

/** Totals over every call of the hook in this process (telemetry; a bench resets them). */
export const STYLER_STATS = {
  calls: 0,
  /** Tiles the stylers' connectivity safety net gave back; the guards keep it at 0, a test asserts that. */
  repaired: 0,
  /** Tiles refused by a guard (normal) and walls + LOW tiles written, over all zones. */
  refused: 0,
  blocked: 0,
  ms: 0,
};

export function resetStylerStats(): void {
  STYLER_STATS.calls = 0;
  STYLER_STATS.repaired = 0;
  STYLER_STATS.refused = 0;
  STYLER_STATS.blocked = 0;
  STYLER_STATS.ms = 0;
}

/** The zone stylers (scorch, gallows, warren, rime, sanctum) at the generator's hook. */
export const zoneStylerHook: ZoneStyleHook = (st: StyleState): void => {
  const results = styleZones(
    {
      w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
      zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps, keepLow: st.keepLow,
    },
    { decor: st.decor },
  );
  STYLER_STATS.calls++;
  for (const r of results) {
    STYLER_STATS.repaired += r.repaired;
    STYLER_STATS.refused += r.refused;
    STYLER_STATS.blocked += r.blocked;
    STYLER_STATS.ms += r.ms;
  }
};

// The zone stylers as the generator's hooks (styler.ts): the adapters between the generator's StyleState / LandmarkState and
// styleZones' ZoneStyleState / styleLandmarks. They differ in small ways and nowhere else:
//  - `territoryGrid` is always there on a generated map (the stylers take it as `territory`, null on a synthetic fixture);
//  - `decor` is a field of the generator's state and an option of styleZones (false: no decor stream, no props);
//  - the generator's hooks return nothing, styleZones returns one StyleResult per zone: the adapter keeps their telemetry in
//    STYLER_STATS (benches and tests read it; nothing in a map depends on it);
//  - `camps[].r` is in TILES on both sides (CAMP_R), so it passes as it is.
// The generator's `protect` is the stylers' `hard`; it adds no `noBlock` or `noProp` of its own (its protect list already
// holds the ring road + 1, the camp halos and the landmark boxes + 1, and it filters props against the final spawn, crate and
// ground spots itself).
import type { RegionFaction } from "../map";
import type { LandmarkState, StyleState, ZoneStyleHook } from "../styler";
import { styleLandmarks, styleZones } from "./styleZones";

const perFaction = (): Record<RegionFaction, number> => ({ fire: 0, sentenced: 0, plague: 0, frost: 0, holy: 0 });

/** Totals over every call of the hooks in this process (telemetry; a bench resets them). */
export const STYLER_STATS = {
  calls: 0,
  /** Tiles the stylers' connectivity safety net gave back; the guards keep it at 0, a test asserts that. */
  repaired: 0,
  /** Tiles refused by a guard (normal) and walls + LOW tiles written, over all zones. */
  refused: 0,
  blocked: 0,
  ms: 0,
  /** Style-pass milliseconds and zone passes per faction (shape + surface + props). */
  msByFaction: perFaction(),
  zonesByFaction: perFaction(),
  /** Features the style pass recorded. */
  features: 0,
  /** The landmark stage: calls, milliseconds, landmarks placed, and per faction. */
  landmarkCalls: 0,
  landmarkMs: 0,
  landmarks: 0,
  landmarksByFaction: perFaction(),
};

export function resetStylerStats(): void {
  STYLER_STATS.calls = 0;
  STYLER_STATS.repaired = 0;
  STYLER_STATS.refused = 0;
  STYLER_STATS.blocked = 0;
  STYLER_STATS.ms = 0;
  STYLER_STATS.msByFaction = perFaction();
  STYLER_STATS.zonesByFaction = perFaction();
  STYLER_STATS.features = 0;
  STYLER_STATS.landmarkCalls = 0;
  STYLER_STATS.landmarkMs = 0;
  STYLER_STATS.landmarks = 0;
  STYLER_STATS.landmarksByFaction = perFaction();
}

/** The zone stylers (scorch, gallows, warren, rime, sanctum) at the generator's style hook. */
export const zoneStylerHook: ZoneStyleHook = (st: StyleState): void => {
  const results = styleZones(
    {
      w: st.w, h: st.h, seed: st.seed, attempt: st.attempt, tiles: st.tiles, terrain: st.terrain, props: st.props, zone: st.zone,
      zoneFaction: st.zoneFaction, protect: st.protect, territory: st.territoryGrid, camps: st.camps,
      spawns: st.spawns, centreWalk: st.centreWalk, features: st.features, featureOwner: st.featureOwner,
    },
    { decor: st.decor },
  );
  STYLER_STATS.calls++;
  for (const r of results) {
    STYLER_STATS.repaired += r.repaired;
    STYLER_STATS.refused += r.refused;
    STYLER_STATS.blocked += r.blocked;
    STYLER_STATS.ms += r.ms;
    STYLER_STATS.msByFaction[r.faction] += r.ms;
    STYLER_STATS.zonesByFaction[r.faction]++;
    STYLER_STATS.features += r.features;
  }
};

/** The landmark stage at the generator's landmark hook: every zone's styler.landmark, whatever the style hook is. */
export function landmarkHook(st: LandmarkState): void {
  const results = styleLandmarks(st);
  STYLER_STATS.landmarkCalls++;
  for (const r of results) {
    STYLER_STATS.landmarkMs += r.ms;
    STYLER_STATS.landmarks += r.landmarks;
    STYLER_STATS.landmarksByFaction[r.faction] += r.landmarks;
  }
}

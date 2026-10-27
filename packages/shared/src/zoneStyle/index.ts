// The zone stylers: `styleZones(state)` is the entry the zone generator calls once per attempt (styleZones.ts), through
// `zoneStylerHook` (hook.ts), the adapter at the generator's hook position (styler.ts).
export * from "./types";
export { STYLER_STATS, landmarkHook, resetStylerStats, zoneStylerHook } from "./hook";
export { ZONE_STYLERS, styleLandmarks, styleZones, filterProps } from "./styleZones";
export type { LandmarkResult } from "./styleZones";
export { ZONE_PROP_KINDS, PROP as ZONE_PROP } from "./propKinds";
export { LANDMARKS_PER_ZONE, REF_ZONE_TILES, areaScale, lenScale, sizeScale } from "./scale";
export { scorch, FORGE, SCORCH_LANDMARKS } from "./scorch";
export {
  gallows, makeGallows, gallowsGateOpen, gallowsRowPhase, gallowsMaxGateDistance, GUARD_HOUSE, GALLOWS_DIALS,
  GATE_PERIOD, GATE_W, GATE_PHASES, ROW_GAP_MIN, ROW_GAP_MAX, ROW_GAP_TARGET, ROW_GAP_PENALTY, ROW_OPEN_RUN_MIN, ROW_VALUE_BIAS,
  ROW_MIN_RUN, ROW_WIGGLE, ROW_BLOCKED_COST, ROW_DEVIATION_COST, ROW_JOG_COST, SQUARE_WINDOW, GALLOWS_OFFSETS_S, GALLOWS_OFFSETS_T,
  SQUARES, ROW_MIN_PIECE, HOUSE_MIN_SEP,
} from "./gallows";
export { warren, BURROW, WARREN_LANDMARKS } from "./warren";
export { rime, WATCHTOWER, RIME_TEMPLATES, facetShelfCells } from "./rime";
export { sanctum, SHRINE, SANCTUM_TEMPLATES, HALL_PITCH } from "./sanctum";
export type { ScorchPlan, ScorchCrater } from "./scorch";
export type { GallowsPlan, GallowsDials, GallowsRow } from "./gallows";
export type { WarrenPlan, WarrenBarrow } from "./warren";
export type { RimePlan, ShelfPlan, LakePlan } from "./rime";
export type { SanctumPlan } from "./sanctum";

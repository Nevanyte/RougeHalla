// A zone of the 96x96 map was about 1710 tiles (the R1 spike's size); the old recipes' lengths and sizes were written for that zone:
// they scale by sizeScale (1 for a zone of 1710 tiles or more, less for the smaller zones of a test fixture). The zone shapes
// (zone-shapes contract, section 4) scale counts with the area and zone-spanning lengths with its square root: areaScale and
// lenScale (2.07 and 1.44 for a zone of a 136x136 map, about 3534 tiles; 2.89 and 1.70 at 160x160, about 4936).
export const REF_ZONE_TILES = 1710;

/** sqrt(painted / REF_ZONE_TILES), clamped to [0.4, 1]. */
export function sizeScale(painted: number): number {
  const s = Math.sqrt(painted / REF_ZONE_TILES);
  return s > 1 ? 1 : s < 0.4 ? 0.4 : s;
}

/** painted / REF_ZONE_TILES, unclamped (contract 4: counts that were per zone scale with the area). */
export function areaScale(painted: number): number {
  return painted / REF_ZONE_TILES;
}

/** sqrt(areaScale), unclamped (contract 4: zone-spanning lengths scale with the square root of the area). */
export function lenScale(painted: number): number {
  return Math.sqrt(painted / REF_ZONE_TILES);
}

/** Landmarks a zone places at most (contract 5.1: round(areaScale), 2 at 136x136; 1 for a 1710-tile zone). Held at 2 on the 160x160 map, where round(areaScale) would be 3. */
export const LANDMARKS_PER_ZONE = 2;

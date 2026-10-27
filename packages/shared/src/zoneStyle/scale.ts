// A zone of the 96x96 map is about 1710 tiles (the R1 spike's size); the recipes' lengths and sizes are part D's, written for
// that zone: they scale by this factor (1 for a zone of 1710 tiles or more, less for the smaller zones of a test fixture).
export const REF_ZONE_TILES = 1710;

/** sqrt(painted / REF_ZONE_TILES), clamped to [0.4, 1]. */
export function sizeScale(painted: number): number {
  const s = Math.sqrt(painted / REF_ZONE_TILES);
  return s > 1 ? 1 : s < 0.4 ? 0.4 : s;
}

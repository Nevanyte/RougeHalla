// A zone of the R1 spike is 1710 tiles; a wedge zone of today's 64x64 map is about 700. The recipes' lengths and sizes are
// part D's, written for the big zone: they scale by this factor (1 for a zone of 1710 tiles or more).
export const REF_ZONE_TILES = 1710;

/** sqrt(painted / REF_ZONE_TILES), clamped to [0.4, 1]. */
export function sizeScale(painted: number): number {
  const s = Math.sqrt(painted / REF_ZONE_TILES);
  return s > 1 ? 1 : s < 0.4 ? 0.4 : s;
}

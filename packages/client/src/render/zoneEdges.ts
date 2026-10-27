// Where two zones meet, as data: the strips MapView paints along every shared tile edge (ROGUELIKE_PLAN 7, "Zone borders", now
// that the ridges are gone). Pure, so a test can run it on a hand-built map without Phaser: it reads `regionGrid` and the walls
// and nothing else.
//
// Each side of a border gets a strip of its own, in its own zone's colour and dash style, so a border reads as two parallel
// marks (one per zone) and a colour-blind player can still tell the zones apart by the dashes (hue is never the only cue).
// A strip lies on a tile that can be seen across (floor or low ground): a wall on that side stands over it anyway.
import { REGION_FACTIONS, isWallTile, type GameMap, type RegionFaction } from "@raid/shared";

/** Thickness, in projected pixels, of one zone's strip (a border is two of them, side by side). */
export const EDGE_PX = 3;

/**
 * How each zone's border strip is dashed: mark and gap lengths in projected pixels along the line, mark first. One rhythm per zone,
 * as the minimap's patterns give one hatching per zone: long dashes, even dashes, dots, dash and dot, fine ticks.
 */
export const ZONE_DASH: Readonly<Record<RegionFaction, readonly number[]>> = {
  fire: [14, 6],
  sentenced: [6, 6],
  plague: [3, 8],
  frost: [12, 4, 3, 4],
  holy: [3, 3],
};

/** One straight stretch of a border, on one side of it, in tile-edge units. */
export interface EdgeStrip {
  /** "v": a vertical line in the world (constant x); "h": a horizontal one (constant y). */
  axis: "h" | "v";
  /** The tile-edge index the strip runs along: the world line is at `line * TILE`. */
  line: number;
  /** The tiles along the line it covers: from (inclusive) to (exclusive). */
  from: number;
  to: number;
  /** -1 = the left (vertical) or upper (horizontal) side of the line, +1 = the right or lower side. */
  side: -1 | 1;
  /** The region code of the tile it lies on: 1..5, a faction zone. */
  code: number;
}

/** A faction zone's code (1..5); the border ring (0) and the coliseum (6) have no border strips. */
const isZoneCode = (code: number): boolean => code >= 1 && code <= REGION_FACTIONS.length;

/**
 * Every strip of every border between two different faction zones, merged into maximal straight runs (so a long border is a few
 * strips, not one per tile). Vertical lines come first, then horizontal ones, each in scan order: the same map gives the same list.
 */
export function zoneEdgeStrips(map: GameMap): EdgeStrip[] {
  const { w, h, regionGrid: codes } = map;
  const out: EdgeStrip[] = [];
  const code = (x: number, y: number): number => codes[y * w + x]!;

  // `tiles(line, along)` gives the tile before the line and the tile after it, as x, y, x, y. Along one line, a run is open per
  // side while the tiles keep wanting a strip of the same zone, and is closed (flushed) where they stop.
  const scan = (
    axis: "h" | "v", lines: number, length: number, tiles: (line: number, along: number) => [number, number, number, number],
  ): void => {
    for (let line = 1; line < lines; line++) {
      const open: Array<{ from: number; code: number } | null> = [null, null];
      for (let along = 0; along <= length; along++) {
        const want = [0, 0];
        if (along < length) {
          const [ax, ay, bx, by] = tiles(line, along);
          const a = code(ax, ay);
          const b = code(bx, by);
          if (a !== b && isZoneCode(a) && isZoneCode(b)) {
            if (!isWallTile(map, ax, ay)) want[0] = a;
            if (!isWallTile(map, bx, by)) want[1] = b;
          }
        }
        for (const s of [0, 1] as const) {
          const run = open[s];
          if (run && run.code !== want[s]) {
            out.push({ axis, line, from: run.from, to: along, side: s === 0 ? -1 : 1, code: run.code });
            open[s] = null;
          }
          if (want[s] !== 0 && !open[s]) open[s] = { from: along, code: want[s]! };
        }
      }
    }
  };

  scan("v", w, h, (line, along) => [line - 1, along, line, along]);
  scan("h", h, w, (line, along) => [along, line - 1, along, line]);
  return out;
}

/**
 * The painted parts of a dashed line from `start` to `end` along one axis, as [from, to] pairs. `pattern` alternates mark and gap
 * lengths (mark first) and its phase is the absolute coordinate, so two strips on the same line, or on the lines either side of
 * a border, share one rhythm however they were merged. A solid line is a pattern with no gap.
 */
export function dashSpans(start: number, end: number, pattern: readonly number[]): Array<[number, number]> {
  let period = 0;
  for (const v of pattern) period += v;
  const out: Array<[number, number]> = [];
  if (!(end > start) || !(period > 0) || pattern.length === 0) return out;
  for (let base = Math.floor(start / period) * period; base < end; base += period) {
    let at = base;
    for (let i = 0; i < pattern.length; i++) {
      const next = at + pattern[i]!;
      if (i % 2 === 0) {
        const a = Math.max(at, start);
        const b = Math.min(next, end);
        if (b > a) out.push([a, b]);
      }
      at = next;
    }
  }
  return out;
}

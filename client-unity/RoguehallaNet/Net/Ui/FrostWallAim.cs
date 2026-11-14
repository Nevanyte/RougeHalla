// P-UNITY-FROST-WALL-1: the Frost Wall aim preview's geometry, an engine-free mirror of rh-sim's wall placement
// (crates/rh-sim/src/barriers.rs wall_segment_for, wall_cells; legacy 78dd8bd4 shared/src/barriers.ts). Display only:
// the cast sends a point and the server decides the wall.
using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>A wall's line (rh-sim <c>WallSegment</c>): its centre (the clamped aim point) and its two ends.</summary>
    public readonly struct FrostWallSegment
    {
        public readonly double Cx, Cy, X1, Y1, X2, Y2;
        public FrostWallSegment(double cx, double cy, double x1, double y1, double x2, double y2)
        { Cx = cx; Cy = cy; X1 = x1; Y1 = y1; X2 = x2; Y2 = y2; }
    }

    public static class FrostWallAim
    {
        /// <summary>The collision classes of <see cref="MapBlob.Tiles"/> (rh-sim TILE_FLOOR, TILE_WALL, TILE_LOW).</summary>
        public const byte Floor = 0, Wall = 1, Low = 2;
        /// <summary>rh-sim TILE.</summary>
        public const double Tile = 32.0;

        /// <summary>rh-sim <c>wall_segment_for</c>: centred on the cursor clamped to <paramref name="range"/> (no closer than
        /// <paramref name="minRange"/>), across the line from the caster, <paramref name="length"/> long; a cursor within 1 u of
        /// the caster (or a NaN distance) aims along <paramref name="facing"/>.</summary>
        public static FrostWallSegment SegmentFor(double fromX, double fromY, double cursorX, double cursorY,
            double range, double minRange, double length, double facing)
        {
            double dx = cursorX - fromX, dy = cursorY - fromY;
            double d = Math.Sqrt(dx * dx + dy * dy);
            if (double.IsNaN(d) || d < 1.0) { dx = Math.Cos(facing); dy = Math.Sin(facing); d = 1.0; }
            double ux = dx / d, uy = dy / d;
            double at = Math.Min(Math.Max(d, minRange), range);
            double cx = fromX + ux * at, cy = fromY + uy * at;
            double half = length / 2.0;
            return new FrostWallSegment(cx, cy, cx - uy * half, cy + ux * half, cx + uy * half, cy - ux * half);
        }

        /// <summary>rh-sim <c>wall_cells</c>: the FLOOR tiles of the row-major class map <paramref name="tiles"/>
        /// (<paramref name="w"/> x <paramref name="h"/>) under <paramref name="seg"/>, ascending, written to
        /// <paramref name="cells"/> (cleared first).</summary>
        public static void Cells(byte[] tiles, int w, int h, in FrostWallSegment seg, double cellReach, double endSlack, List<uint> cells)
        {
            cells.Clear();
            double reach = cellReach;
            double ex = seg.X2 - seg.X1, ey = seg.Y2 - seg.Y1;
            double len = Math.Sqrt(ex * ex + ey * ey);
            double ux = 0, uy = 0;
            if (len > 0) { ux = ex / len; uy = ey / len; }
            long minX = Math.Max((long)Math.Floor((Math.Min(seg.X1, seg.X2) - reach) / Tile), 0);
            long maxX = Math.Min((long)Math.Floor((Math.Max(seg.X1, seg.X2) + reach) / Tile), w - 1);
            long minY = Math.Max((long)Math.Floor((Math.Min(seg.Y1, seg.Y2) - reach) / Tile), 0);
            long maxY = Math.Min((long)Math.Floor((Math.Max(seg.Y1, seg.Y2) + reach) / Tile), h - 1);
            for (long ty = minY; ty <= maxY; ty++)
                for (long tx = minX; tx <= maxX; tx++)
                {
                    long i = ty * w + tx;
                    if (tiles[i] != Floor) continue;
                    double px = tx * Tile + Tile / 2.0, py = ty * Tile + Tile / 2.0;
                    double along = (px - seg.X1) * ux + (py - seg.Y1) * uy;
                    if (along < -endSlack || along > len + endSlack) continue;
                    if (DistToSegment(px, py, seg.X1, seg.Y1, seg.X2, seg.Y2) <= reach) cells.Add((uint)i);
                }
        }

        static double DistToSegment(double px, double py, double ax, double ay, double bx, double by)
        {
            double abx = bx - ax, aby = by - ay, len2 = abx * abx + aby * aby;
            double t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            double ex = px - (ax + abx * t), ey = py - (ay + aby * t);
            return Math.Sqrt(ex * ex + ey * ey);
        }

        /// <summary>The map the preview reads (the server's body map): the Welcome map's classes, every gate tile WALL when
        /// <paramref name="gatesLocked"/>, every delivered wall tile LOW. Written into <paramref name="into"/> when its length is
        /// W x H (else a new array); returns the array written.</summary>
        public static byte[] PlanMap(MapBlob map, bool gatesLocked, IReadOnlyList<AreaView> fields, byte[] into)
        {
            int w = map.W, h = map.H;
            var plan = into != null && into.Length == w * h ? into : new byte[w * h];
            Array.Copy(map.Tiles, plan, Math.Min(map.Tiles.Length, plan.Length));
            if (gatesLocked && map.Coliseum != null && map.Coliseum.Gates != null)
                foreach (var g in map.Coliseum.Gates) foreach (var t in g.Tiles) Set(plan, w, h, t, Wall);
            if (fields != null)
                for (int i = 0; i < fields.Count; i++)
                {
                    var f = fields[i];
                    if (f.Kind != AreaKind.Wall || f.Tiles == null) continue;
                    foreach (var t in f.Tiles) Set(plan, w, h, t, Low);
                }
            return plan;
        }

        static void Set(byte[] plan, int w, int h, MapTile t, byte cls)
        {
            if (t.X < w && t.Y < h) plan[t.Y * w + t.X] = cls;
        }
    }
}

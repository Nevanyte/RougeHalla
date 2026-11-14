// P-UNITY-FROST-WALL-1: the Frost Wall aim preview's geometry, an engine-free mirror of rh-sim's wall placement
// (crates/rh-sim/src/barriers.rs wall_segment_for, wall_cells; legacy 78dd8bd4 shared/src/barriers.ts). Display only:
// the cast sends a point and the server decides the wall. STUB: the implementer replaces every body.
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
        /// the caster (or a NaN distance) aims along <paramref name="facing"/>. STUB.</summary>
        public static FrostWallSegment SegmentFor(double fromX, double fromY, double cursorX, double cursorY,
            double range, double minRange, double length, double facing)
        {
            return default;
        }

        /// <summary>rh-sim <c>wall_cells</c>: the FLOOR tiles of the row-major class map <paramref name="tiles"/>
        /// (<paramref name="w"/> x <paramref name="h"/>) under <paramref name="seg"/>, ascending, written to
        /// <paramref name="cells"/> (cleared first). STUB.</summary>
        public static void Cells(byte[] tiles, int w, int h, in FrostWallSegment seg, double cellReach, double endSlack, List<uint> cells)
        {
            cells.Clear();
        }

        /// <summary>The map the preview reads (the server's body map): the Welcome map's classes, every gate tile WALL when
        /// <paramref name="gatesLocked"/>, every delivered wall tile LOW. Written into <paramref name="into"/> when its length is
        /// W x H (else a new array); returns the array written. STUB.</summary>
        public static byte[] PlanMap(MapBlob map, bool gatesLocked, IReadOnlyList<AreaView> fields, byte[] into)
        {
            return into ?? new byte[0];
        }
    }
}

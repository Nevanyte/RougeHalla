using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-1 oracle: the aim preview's geometry mirrors rh-sim (crates/rh-sim/src/barriers.rs wall_segment_for,
    /// wall_cells). The segment and axis cases are the ones crates/rh-sim/src/barriers_tests.rs asserts in Rust; the map
    /// edge, LOW, rock and plan-map cases are worked from the Rust rule (brief F1-F3). The Rust-produced vector file is
    /// blocked on a coordinator decision (brief, "Vectors: blocked").
    /// </summary>
    public class FrostWallAimTests
    {
        const double T = 32;
        static double Tc(int t) { return t * T + T / 2; }
        // The Frost Wall numbers (abilities/mod.rs:272-278, barriers.rs:20-22).
        const double Range = 450, MinRange = 64, Length = 224, Reach = 24, Slack = 8;

        static byte[] Room(int w, int h)
        {
            var tiles = new byte[w * h];
            for (int x = 0; x < w; x++) { tiles[x] = FrostWallAim.Wall; tiles[(h - 1) * w + x] = FrostWallAim.Wall; }
            for (int y = 0; y < h; y++) { tiles[y * w] = FrostWallAim.Wall; tiles[y * w + w - 1] = FrostWallAim.Wall; }
            return tiles;
        }

        static void Seg(in FrostWallSegment s, double cx, double cy, double x1, double y1, double x2, double y2)
        {
            Assert.AreEqual(cx, s.Cx, 1e-9, "cx"); Assert.AreEqual(cy, s.Cy, 1e-9, "cy");
            Assert.AreEqual(x1, s.X1, 1e-9, "x1"); Assert.AreEqual(y1, s.Y1, 1e-9, "y1");
            Assert.AreEqual(x2, s.X2, 1e-9, "x2"); Assert.AreEqual(y2, s.Y2, 1e-9, "y2");
        }

        static List<uint> Cells(byte[] tiles, int w, int h, in FrostWallSegment seg)
        {
            var cells = new List<uint> { 999 }; // cleared first
            FrostWallAim.Cells(tiles, w, h, seg, Reach, Slack, cells);
            return cells;
        }

        [Test]
        public void TheSegmentCentresOnTheAimClampedToTheRangeAndStandsSquareToIt()
        {
            // barriers_tests.rs wall_segment_centres_on_the_clamped_aim_square_to_the_caster: beyond the range.
            Seg(FrostWallAim.SegmentFor(0, 0, 1000, 0, 300, 50, 200, 0), 300, 0, 300, 100, 300, -100);
            // Inside the minimum range: pushed out to it.
            Assert.AreEqual(50, FrostWallAim.SegmentFor(0, 0, 10, 0, 300, 50, 200, 0).Cx, 1e-9);
            // The Frost numbers: a cursor 20 u away stands the wall 64 out.
            Seg(FrostWallAim.SegmentFor(100, 100, 120, 100, Range, MinRange, Length, 0), 164, 100, 164, 212, 164, -12);
            // Between the two: the cursor itself.
            Assert.AreEqual(300, FrostWallAim.SegmentFor(100, 100, 300, 100, Range, MinRange, Length, 0).Cx, 1e-9);
        }

        [Test]
        public void ADiagonalAimIsClampedAlongItsOwnLine()
        {
            // (0,0) -> (300,400): 500 u, clamped to 450 along (0.6, 0.8); ends 112 either side along (-0.8, 0.6).
            Seg(FrostWallAim.SegmentFor(0, 0, 300, 400, Range, MinRange, Length, 0), 270, 360, 180.4, 427.2, 359.6, 292.8);
        }

        [Test]
        public void ACursorOnTheCasterAimsAlongTheFacing()
        {
            var s = FrostWallAim.SegmentFor(100, 100, 100, 100, 300, 64, 100, Math.PI / 2);
            Assert.AreEqual(100, s.Cx, 1e-9); Assert.AreEqual(164, s.Cy, 1e-9);
            // Under 1 u counts as on the caster; a NaN cursor too (legacy `!(d >= 1)`).
            Assert.AreEqual(164, FrostWallAim.SegmentFor(100, 100, 100.5, 100, 300, 64, 100, Math.PI / 2).Cy, 1e-9);
            Assert.AreEqual(164, FrostWallAim.SegmentFor(100, 100, double.NaN, 100, 300, 64, 100, Math.PI / 2).Cy, 1e-9);
        }

        [Test]
        public void TheMinimumIsAppliedBeforeTheRange()
        {
            // at = min(max(d, minRange), range): a minimum above the range yields the range.
            Assert.AreEqual(300, FrostWallAim.SegmentFor(0, 0, 10, 0, 300, 500, 100, 0).Cx, 1e-9);
        }

        [Test]
        public void AnAxisAlignedWallTakesSevenFloorTilesInOneColumnAndOnlyFloor()
        {
            // barriers_tests.rs an_axis_aligned_wall_takes_seven_floor_tiles_in_one_column.
            const int w = 40, h = 20;
            var map = Room(w, h);
            var seg = FrostWallAim.SegmentFor(Tc(5), Tc(10), Tc(12), Tc(10), Range, MinRange, Length, 0);
            var expected = new List<uint>();
            for (uint y = 7; y <= 13; y++) expected.Add(y * w + 12);
            CollectionAssert.AreEqual(expected, Cells(map, w, h, seg));
            // Into the border wall: floor tiles only, ascending.
            var lng = FrostWallAim.SegmentFor(Tc(5), Tc(10), Tc(12), Tc(10), Range, 0, T * 30, 0);
            var cells = Cells(map, w, h, lng);
            Assert.AreEqual(h - 2, cells.Count);
            for (int i = 0; i < cells.Count; i++)
            {
                Assert.AreEqual(FrostWallAim.Floor, map[cells[i]]);
                if (i > 0) Assert.Less(cells[i - 1], cells[i], "ascending");
            }
        }

        [Test]
        public void LowAndWallTilesUnderTheLineAreSkipped()
        {
            const int w = 40, h = 20;
            var map = Room(w, h);
            map[9 * w + 12] = FrostWallAim.Low;
            map[11 * w + 12] = FrostWallAim.Wall;
            var seg = FrostWallAim.SegmentFor(Tc(5), Tc(10), Tc(12), Tc(10), Range, MinRange, Length, 0);
            CollectionAssert.AreEqual(new uint[] { 7 * w + 12, 8 * w + 12, 10 * w + 12, 12 * w + 12, 13 * w + 12 }, Cells(map, w, h, seg));
        }

        [Test]
        public void AWallAimedIntoRockTakesNoTile()
        {
            const int w = 40, h = 20;
            var map = Room(w, h);
            for (int y = 0; y < h; y++) for (int x = 10; x <= 14; x++) map[y * w + x] = FrostWallAim.Wall;
            var seg = FrostWallAim.SegmentFor(Tc(5), Tc(10), Tc(12), Tc(10), Range, MinRange, Length, 0);
            CollectionAssert.IsEmpty(Cells(map, w, h, seg));
        }

        [Test]
        public void AWallPastTheMapEdgeTakesOnlyTilesOnTheMap()
        {
            const int w = 10, h = 10;
            var open = new byte[w * h];
            // Top edge: the line runs from y 160 to y -64; column 6, rows 0..4 (row 5's centre is 16 u before the end, past the 8 u slack).
            var up = FrostWallAim.SegmentFor(Tc(2), Tc(1), Tc(6), Tc(1), Range, MinRange, Length, 0);
            CollectionAssert.AreEqual(new uint[] { 6, 16, 26, 36, 46 }, Cells(open, w, h, up));
            // Right edge: the line runs from x 160 to x 384 on row 6; columns 5..9, never wrapping into row 7.
            var right = FrostWallAim.SegmentFor(Tc(8), Tc(2), Tc(8), Tc(6), Range, MinRange, Length, 0);
            CollectionAssert.AreEqual(new uint[] { 65, 66, 67, 68, 69 }, Cells(open, w, h, right));
        }

        [Test]
        public void ADiagonalWallIsAClosedStaircase()
        {
            // barriers_tests.rs a_diagonal_wall_is_a_closed_staircase.
            const int w = 20, h = 12;
            var map = Room(w, h);
            var seg = FrostWallAim.SegmentFor(Tc(3), Tc(3), Tc(9), Tc(7), 400, 0, T * 6, 0);
            var cells = Cells(map, w, h, seg);
            Assert.GreaterOrEqual(cells.Count, 6);
            foreach (var i in cells)
            {
                long x = i % w, y = i / w;
                foreach (var d in new[] { (1L, 1L), (1L, -1L) })
                {
                    long nx = x + d.Item1, ny = y + d.Item2;
                    if (!cells.Contains((uint)(ny * w + nx))) continue;
                    Assert.IsTrue(cells.Contains((uint)(y * w + nx)) || cells.Contains((uint)(ny * w + x)), "corner gap at " + x + "," + y);
                }
            }
        }

        [Test]
        public void ThePlanMapIsTheWelcomeMapWithLockedGatesAsWallAndStandingWallsAsLow()
        {
            const int w = 6, h = 4;
            var tiles = new byte[w * h]; tiles[5] = FrostWallAim.Wall; tiles[23] = FrostWallAim.Low;
            var map = new MapBlob(w, h, tiles).WithPublic(null,
                new MapColiseum(0, 0, w, h, new[] { new MapGate(0, new[] { new MapTile(2, 0), new MapTile(3, 0) }) }), null, null, null);
            var fields = new[]
            {
                new AreaView { Kind = AreaKind.Zone, X = 16, Y = 16, Radius = 100 },
                new AreaView { Kind = AreaKind.Wall, Tiles = new[] { new MapTile(1, 2), new MapTile(4, 3) }, StartedAt = 10, EndsAt = 4010, Key = new AreaKey(10, 13) },
            };
            var open = FrostWallAim.PlanMap(map, false, fields, null);
            var expect = (byte[])tiles.Clone(); expect[2 * w + 1] = FrostWallAim.Low; expect[3 * w + 4] = FrostWallAim.Low;
            CollectionAssert.AreEqual(expect, open);
            Assert.AreEqual(0, tiles[2 * w + 1], "the Welcome map is not changed");

            var reuse = new byte[w * h];
            var locked = FrostWallAim.PlanMap(map, true, fields, reuse);
            Assert.AreSame(reuse, locked, "an array of the right size is reused");
            expect[2] = FrostWallAim.Wall; expect[3] = FrostWallAim.Wall;
            CollectionAssert.AreEqual(expect, locked);

            // No wall standing, gates open: the Welcome map as it is; a stale array is overwritten.
            var again = FrostWallAim.PlanMap(map, false, Array.Empty<AreaView>(), locked);
            CollectionAssert.AreEqual(tiles, again);
        }
    }
}

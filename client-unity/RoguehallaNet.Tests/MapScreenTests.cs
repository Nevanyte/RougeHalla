using System;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public sealed class MapProjectionTests
    {
        [Test]
        public void PixelMapsLinearlyToWorldAndBack()
        {
            Assert.IsTrue(MapProjection.PixelToWorld(135, 67.5, 270, 270, 160, 160, out var w));
            Assert.AreEqual(160 * 32 / 2.0, w.X, 1e-9);
            Assert.AreEqual(160 * 32 / 4.0, w.Y, 1e-9);
            Assert.IsTrue(MapProjection.WorldToPixel(w.X, w.Y, 270, 270, 160, 160, out var px, out var py));
            Assert.AreEqual(135, px, 1e-9);
            Assert.AreEqual(67.5, py, 1e-9);
        }

        [Test]
        public void CornersAndOutsidePointsClampToTheMap()
        {
            MapProjection.PixelToWorld(-30, -1, 270, 270, 100, 50, out var a);
            Assert.AreEqual(0, a.X); Assert.AreEqual(0, a.Y);
            MapProjection.PixelToWorld(9999, 9999, 270, 270, 100, 50, out var b);
            Assert.AreEqual(100 * 32, b.X); Assert.AreEqual(50 * 32, b.Y);
            MapProjection.PixelToWorld(270, 0, 270, 270, 100, 50, out var c);
            Assert.AreEqual(3200, c.X); Assert.AreEqual(0, c.Y);
        }

        [Test]
        public void RectangularMapsStretchEachAxisIndependently()
        {
            MapProjection.PixelToWorld(100, 25, 200, 50, 10, 4, out var p);
            Assert.AreEqual(160, p.X, 1e-9); Assert.AreEqual(64, p.Y, 1e-9);
        }

        [Test]
        public void DegenerateInputsAreRefused()
        {
            Assert.IsFalse(MapProjection.PixelToWorld(1, 1, 0, 10, 10, 10, out _));
            Assert.IsFalse(MapProjection.PixelToWorld(1, 1, 10, 10, 0, 10, out _));
            Assert.IsFalse(MapProjection.PixelToWorld(double.NaN, 1, 10, 10, 10, 10, out _));
            Assert.IsFalse(MapProjection.PixelToWorld(1, double.PositiveInfinity, 10, 10, 10, 10, out _));
            Assert.IsFalse(MapProjection.WorldToPixel(1, 1, -5, 10, 10, 10, out _, out _));
        }

        [Test]
        public void PingLivesNinetyHundredMsFadesAndGrows()
        {
            var ping = new MapPing();
            Assert.AreEqual(-1, ping.Progress(0), "inactive");
            ping.Start(10, 20, 1000);
            Assert.AreEqual(0, ping.Progress(1000), 1e-9);
            Assert.AreEqual(.5, ping.Progress(1450), 1e-9);
            Assert.AreEqual(-1, ping.Progress(1900), "expired exactly at the lifetime");
            Assert.AreEqual(0, ping.Progress(900), 1e-9, "a clock that runs backwards never makes a negative age");
            Assert.AreEqual(1, ping.Alpha(0), 1e-9); Assert.AreEqual(0, ping.Alpha(1), 1e-9);
            Assert.Less(ping.Scale(0), ping.Scale(.5)); Assert.AreEqual(1, ping.Scale(1), 1e-9);
        }
    }

    public sealed class MapZonesTests
    {
        [Test]
        public void ZoneNamesShapesAndFactionColoursFollowTheWireIds()
        {
            string[] names = { "Fire", "Sentenced", "Plague", "Frost", "Holy", "Coliseum" };
            for (int r = 1; r <= 6; r++) Assert.AreEqual(names[r - 1], MapZones.Name(r));
            for (int r = 1; r <= 5; r++) Assert.AreEqual(r - 1, MapZones.FactionIndex(r));
            Assert.AreEqual(-1, MapZones.FactionIndex(MapZones.Coliseum));
            Assert.AreEqual(-1, MapZones.FactionIndex(0));
            Assert.AreEqual("", MapZones.Name(0)); Assert.AreEqual("", MapZones.Name(7));
            Assert.AreEqual(ZoneShape.None, MapZones.Shape(0));
        }

        [Test]
        public void EveryZoneHasItsOwnShapeSoColourIsNeverTheOnlyCue()
        {
            var seen = new System.Collections.Generic.HashSet<ZoneShape>();
            for (int r = 1; r <= 6; r++) Assert.IsTrue(seen.Add(MapZones.Shape(r)), "shape of region " + r + " repeats");
            Assert.IsFalse(seen.Contains(ZoneShape.None));
        }

        [Test]
        public void TintIsSubtleAndAbsentOutsideZones()
        {
            Assert.AreEqual(0f, MapZones.TintAlpha(0, true)); Assert.AreEqual(0f, MapZones.TintAlpha(9, false));
            for (int r = 1; r <= 6; r++)
            {
                Assert.That(MapZones.TintAlpha(r, true), Is.InRange(.1f, .4f), "large map tint " + r);
                Assert.LessOrEqual(MapZones.TintAlpha(r, false), MapZones.TintAlpha(r, true), "the minimap is never stronger than the Tab map");
            }
        }

        [Test]
        public void LabelTilesLandInsideTheirOwnRegionEvenForACrescent()
        {
            // Region 1 is a C shape whose centroid is in the hole; region 2 a plain block.
            int w = 12, h = 12; var grid = new byte[w * h];
            for (int y = 2; y < 10; y++) for (int x = 2; x < 10; x++) grid[y * w + x] = 1;
            for (int y = 4; y < 8; y++) for (int x = 4; x < 10; x++) grid[y * w + x] = 0;
            for (int y = 10; y < 12; y++) for (int x = 0; x < 3; x++) grid[y * w + x] = 2;
            MapZones.LabelTiles(grid, w, h, out var found, out var tx, out var ty);
            Assert.IsTrue(found[1]); Assert.IsTrue(found[2]); Assert.IsFalse(found[3]);
            Assert.AreEqual(1, grid[(int)ty[1] * w + (int)tx[1]], "crescent label is on its own tiles");
            Assert.AreEqual(2, grid[(int)ty[2] * w + (int)tx[2]]);
        }

        [Test]
        public void LabelTilesToleratesMissingOrWrongSizedPlanes()
        {
            MapZones.LabelTiles(null, 4, 4, out var f1, out _, out _);
            Assert.IsFalse(Array.Exists(f1, v => v));
            MapZones.LabelTiles(new byte[5], 4, 4, out var f2, out _, out _);
            Assert.IsFalse(Array.Exists(f2, v => v));
        }

        [Test]
        public void SmoothCoverageHugsTilesAndKeepsAOneTileWallOneTileWide()
        {
            // A one tile wide vertical wall in a 5x5 grid.
            Func<int, int, float> tile = (x, y) => x == 2 ? 1f : 0f;
            Assert.AreEqual(1f, MapSmoothing.Coverage(tile, 5, 5, 2.5, 2.5), 1e-6);
            Assert.AreEqual(0f, MapSmoothing.Coverage(tile, 5, 5, .5, 2.5), 1e-6);
            Assert.AreEqual(.5f, MapSmoothing.Coverage(tile, 5, 5, 2.0, 2.5), 1e-6, "the contour sits on the tile edge");
            Assert.AreEqual(.5f, MapSmoothing.Coverage(tile, 5, 5, 3.0, 2.5), 1e-6);
            Assert.AreEqual(1f, MapSmoothing.Inside(1f, .1f)); Assert.AreEqual(0f, MapSmoothing.Inside(0f, .1f));
            Assert.AreEqual(.5f, MapSmoothing.Inside(.5f, .1f), 1e-6);
            Assert.AreEqual(1f, MapSmoothing.Stroke(.5f, .1f, .05f), 1e-6); Assert.AreEqual(0f, MapSmoothing.Stroke(1f, .1f, .05f));
        }
    }

    public sealed class MapScreenLayoutTests
    {
        // (uiW, uiH) of the legacy stage at the four capture sizes: 1280x800, 1920x1080 (scale 1.35), 2560x1440 (1.5), plus a narrow window.
        static readonly float[][] Stages = { new[] { 1280f, 800f }, new[] { 1422f, 800f }, new[] { 1707f, 960f }, new[] { 800f, 700f }, new[] { 420f, 700f }, new[] { 2400f, 800f } };

        [Test]
        public void TabLayoutFitsTheStageWithoutOverlapAtEverySize()
        {
            foreach (var s in Stages)
            {
                var l = MapScreenLayout.Compute(s[0], s[1], MapScreenMode.Tab);
                string id = s[0] + "x" + s[1];
                foreach (var r in new[] { l.Title, l.Frame, l.Legend, l.Left, l.Right })
                    Assert.IsTrue(r.Within(s[0], s[1]), id + " rect inside the stage");
                Assert.IsFalse(l.Frame.Overlaps(l.Title), id); Assert.IsFalse(l.Frame.Overlaps(l.Legend), id);
                Assert.IsFalse(l.Left.Overlaps(l.Right), id);
                if (!l.Stacked)
                {
                    Assert.IsFalse(l.Left.Overlaps(l.Frame), id); Assert.IsFalse(l.Right.Overlaps(l.Frame), id);
                    Assert.IsFalse(l.Left.Overlaps(l.Title) || l.Right.Overlaps(l.Legend), id);
                }
            }
        }

        [Test]
        public void MapIsAnExactSquareInsideItsFrameWithNoLetterbox()
        {
            foreach (var s in Stages)
            foreach (var mode in new[] { MapScreenMode.Tab, MapScreenMode.Planning })
            {
                var l = MapScreenLayout.Compute(s[0], s[1], mode);
                Assert.AreEqual(l.Map.W, l.Map.H, .01f);
                Assert.AreEqual(l.Frame.W, l.Map.W + MapScreenLayout.FramePad * 2f, .01f, "the frame hugs the square: no empty bars beside it");
                Assert.AreEqual(l.Frame.H, l.Map.H + MapScreenLayout.FramePad * 2f, .01f);
            }
        }

        [Test]
        public void WideTabBodyIsCentredAndMapGrowsWithTheStage()
        {
            var a = MapScreenLayout.Compute(1280, 800, MapScreenMode.Tab);
            Assert.IsFalse(a.Stacked);
            float margin = a.Body.X, other = 1280 - a.Body.Right;
            Assert.AreEqual(margin, other, 1.01f, "centred horizontally");
            Assert.GreaterOrEqual(a.Body.Y, MapScreenLayout.ChromeClear, "clears the top-right chrome buttons and the phase pill");
            Assert.LessOrEqual(a.Body.Bottom, 800 - MapScreenLayout.Pad + .01f);
            var b = MapScreenLayout.Compute(1707, 960, MapScreenMode.Tab);
            Assert.Greater(b.Map.W, a.Map.W);
            Assert.LessOrEqual(b.Map.W, MapScreenLayout.MapMax);
            Assert.GreaterOrEqual(a.Map.W, MapScreenLayout.MapMin);
        }

        [Test]
        public void TabColumnsKeepLegacyWidthAndScaleWithMapTextSize()
        {
            var a = MapScreenLayout.Compute(1706, 960, MapScreenMode.Tab, 1f);
            Assert.AreEqual(250f, a.Left.W); Assert.AreEqual(250f, a.Right.W);
            var big = MapScreenLayout.Compute(1706, 960, MapScreenMode.Tab, 1.5f);
            Assert.AreEqual(290f, big.Left.W, "clamped to the legacy 190..290 range");
        }

        [Test]
        public void PlanningHasOneLegacyWidthDecisionColumnBesideTheMap()
        {
            var l = MapScreenLayout.Compute(1422, 800, MapScreenMode.Planning);
            Assert.IsFalse(l.Stacked);
            Assert.AreEqual(340f, l.Right.W);
            Assert.AreEqual(0f, l.Left.W);
            Assert.GreaterOrEqual(l.Title.Y, MapScreenLayout.ChromeClear, "clears the top-right chrome buttons");
            Assert.IsFalse(l.Right.Overlaps(l.Frame));
            Assert.IsTrue(l.Body.Within(1422, 800));
            Assert.GreaterOrEqual(l.Map.W, 260f);
        }

        [Test]
        public void NarrowWindowsStackTheColumnsUnderTheMap()
        {
            foreach (var mode in new[] { MapScreenMode.Tab, MapScreenMode.Planning })
            {
                var l = MapScreenLayout.Compute(420, 700, mode);
                Assert.IsTrue(l.Stacked, mode.ToString());
                Assert.GreaterOrEqual(l.Right.Y, l.Legend.Bottom, "columns sit below the map strip");
                Assert.LessOrEqual(l.Frame.W, 420f - 2f * MapScreenLayout.Pad + .01f);
            }
        }

        [Test]
        public void DegenerateStagesNeverProduceNaN()
        {
            foreach (var l in new[] { MapScreenLayout.Compute(float.NaN, 0, MapScreenMode.Tab), MapScreenLayout.Compute(1, 1, MapScreenMode.Planning) })
            {
                Assert.IsFalse(float.IsNaN(l.Map.W) || float.IsNaN(l.Map.X) || float.IsNaN(l.Right.Y));
                Assert.Greater(l.Map.W, 0f);
            }
        }
    }
}

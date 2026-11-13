using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-UNITY-WORLD-MARKS-2 oracle (engine-free): the camp patience outline, pinned to legacy CampPatience.ts. Legacy marks a tile inside
    /// when it belongs to the camp (:28-37), then for each inside tile emits the side facing a non-inside neighbour, the map's edge counting as
    /// non-inside (:43-52). It outlines one camp at a time, so an edge shared by two camps is in both outlines (pinned below). Edges are compared as
    /// sorted sets; the order legacy emits them in is not behaviour.</summary>
    public sealed class PatienceOutlineTests
    {
        static string[] Edges(byte[] plane, int w, int h, int camp)
        {
            var into = new List<PatienceEdge>();
            PatienceOutline.Edges(plane, w, h, camp, into);
            return into.Select(e => $"{e.X0},{e.Y0}-{e.X1},{e.Y1}").OrderBy(s => s, StringComparer.Ordinal).ToArray();
        }

        static string[] Set(params string[] edges) => edges.OrderBy(s => s, StringComparer.Ordinal).ToArray();

        [Test]
        public void OneCampTwoTilesWideIsOutlinedByItsSixOuterEdges()
        {
            // 4 x 3, camp 1 on tiles (1,1) and (2,1): the edge between them is inside and is not drawn.
            var plane = new byte[12];
            plane[1 * 4 + 1] = 1; plane[1 * 4 + 2] = 1;
            CollectionAssert.AreEqual(Set("1,1-1,2", "3,1-3,2", "1,1-2,1", "2,1-3,1", "1,2-2,2", "2,2-3,2"), Edges(plane, 4, 3, 1));
        }

        [Test]
        public void TwoTouchingCampsShareTheirCommonEdgeInBothOutlines()
        {
            // 2 x 1: camp 1 at (0,0), camp 2 at (1,0). Legacy builds each camp's `inside` alone (CampPatience.ts:25-37), so the other camp's tile is
            // "not inside" for it: the shared edge x = 1 is in both outlines.
            var plane = new byte[] { 1, 2 };
            CollectionAssert.AreEqual(Set("0,0-0,1", "1,0-1,1", "0,0-1,0", "0,1-1,1"), Edges(plane, 2, 1, 1), "camp 1, including the shared edge");
            CollectionAssert.AreEqual(Set("1,0-1,1", "2,0-2,1", "1,0-2,0", "1,1-2,1"), Edges(plane, 2, 1, 2), "camp 2, including the shared edge");
        }

        [Test]
        public void ACampWithAHoleGetsTheHolesEdgesAndTheOtherCampInsideItsOwn()
        {
            // 3 x 3 ring of camp 1 round a centre tile of camp 2.
            var plane = new byte[] { 1, 1, 1, 1, 2, 1, 1, 1, 1 };
            CollectionAssert.AreEqual(Set(
                "0,0-1,0", "1,0-2,0", "2,0-3,0", "0,3-1,3", "1,3-2,3", "2,3-3,3",
                "0,0-0,1", "0,1-0,2", "0,2-0,3", "3,0-3,1", "3,1-3,2", "3,2-3,3",
                "1,1-2,1", "1,2-2,2", "1,1-1,2", "2,1-2,2"), Edges(plane, 3, 3, 1), "outer boundary (12) and the hole's boundary (4)");
            CollectionAssert.AreEqual(Set("1,1-2,1", "1,2-2,2", "1,1-1,2", "2,1-2,2"), Edges(plane, 3, 3, 2), "the camp in the hole");
        }

        [Test]
        public void ACampOnTheMapsEdgeIsClosedAlongTheEdge()
        {
            // 2 x 2, camp 1 only at (0,0): the map edge counts as outside (CampPatience.ts:44 `has` is false out of range), so all four sides are drawn.
            var plane = new byte[] { 1, 0, 0, 0 };
            CollectionAssert.AreEqual(Set("0,0-0,1", "1,0-1,1", "0,0-1,0", "0,1-1,1"), Edges(plane, 2, 2, 1));
        }

        [Test]
        public void ACampThatFillsTheWholeMapIsOutlinedByTheMapBorder()
        {
            var plane = new byte[] { 1, 1, 1, 1 };
            CollectionAssert.AreEqual(Set("0,0-1,0", "1,0-2,0", "0,2-1,2", "1,2-2,2", "0,0-0,1", "0,1-0,2", "2,0-2,1", "2,1-2,2"), Edges(plane, 2, 2, 1));
        }

        [Test]
        public void AnAbsentCampZerosANullPlaneAndAZeroCampRefGiveNone()
        {
            Assert.IsEmpty(Edges(new byte[9], 3, 3, 1), "a plane of zeros");
            Assert.IsEmpty(Edges(null, 3, 3, 1), "no plane (an older server, practice)");
            Assert.IsEmpty(Edges(new byte[] { 1, 1, 1, 1 }, 2, 2, 0), "campRef 0 is 'no camp'");
            Assert.IsEmpty(Edges(new byte[] { 1, 1, 1, 1 }, 2, 2, 2), "a camp with no tiles (legacy: null outline)");
        }

        [Test]
        public void APlaneTheWrongSizeGivesNoneAndDoesNotThrow()
        {
            var plane = new byte[] { 1, 1, 1, 1 };
            Assert.DoesNotThrow(() => Assert.IsEmpty(Edges(plane, 3, 3, 1), "too short for 3 x 3"));
            Assert.DoesNotThrow(() => Assert.IsEmpty(Edges(plane, 1, 1, 1), "too long for 1 x 1"));
            Assert.DoesNotThrow(() => Assert.IsEmpty(Edges(plane, 0, 4, 1), "zero width"));
            Assert.DoesNotThrow(() => Assert.IsEmpty(Edges(plane, -2, -2, 1), "negative size"));
        }

        [Test]
        public void EdgesClearsTheListItFills()
        {
            var into = new List<PatienceEdge> { new PatienceEdge(9, 9, 9, 10) };
            PatienceOutline.Edges(new byte[] { 1 }, 1, 1, 1, into);
            Assert.AreEqual(4, into.Count, "one tile, four sides, and the old row is gone");
            PatienceOutline.Edges(null, 1, 1, 1, into);
            Assert.AreEqual(0, into.Count, "cleared even when there is nothing to draw");
        }

        [Test]
        public void EdgesAreNormalisedLeftToRightAndTopToBottom()
        {
            var into = new List<PatienceEdge>();
            PatienceOutline.Edges(new byte[] { 0, 0, 0, 1 }, 2, 2, 1, into);
            Assert.AreEqual(4, into.Count);
            foreach (var e in into) Assert.IsTrue(e.X0 <= e.X1 && e.Y0 <= e.Y1, $"{e.X0},{e.Y0}-{e.X1},{e.Y1}");
        }

        [TestCase(MatchPhase.Active, false, 3u, true)]
        [TestCase(MatchPhase.Active, false, 0u, false)]   // CampPatience.ts:93: a cleared camp has no chase range until its mobs respawn
        [TestCase(MatchPhase.Active, true, 3u, false)]    // RaidScene.ts:676: !state.training
        [TestCase(MatchPhase.Lobby, false, 3u, false)]
        [TestCase(MatchPhase.Planning, false, 3u, false)]
        [TestCase(MatchPhase.Ended, false, 3u, false)]
        public void LegacyDrawsAnOutlineOnlyInAnActiveRunForACampWithLivingMobs(MatchPhase phase, bool training, uint alive, bool expected)
        {
            Assert.AreEqual(expected, PatienceOutline.Visible(phase, training, alive));
        }

        [Test]
        public void NoPhaseYetDrawsNothing()
        {
            Assert.IsFalse(PatienceOutline.Visible(null, false, 3));
        }

        [Test]
        public void TheLegacyStylesArePinnedAndTheLineIsNotTheLabelColour()
        {
            Assert.AreEqual("PATIENCE RANGE", PatienceOutline.LabelText, "static text, no seconds: no per-mob timer exists in legacy's range view");
            Assert.AreEqual(0xa9f4f5u, PatienceOutline.LabelRgb);
            Assert.AreEqual(0x8feef0u, PatienceOutline.DashRgb, "the dashes are 8feef0 (CampPatience.ts:70), not a9f4f5");
            Assert.AreEqual(0x09242au, PatienceOutline.RimRgb);
            Assert.AreEqual(3f, PatienceOutline.RimWidth); Assert.AreEqual(.72f, PatienceOutline.RimAlpha);
            Assert.AreEqual(1.5f, PatienceOutline.DashWidth); Assert.AreEqual(.82f, PatienceOutline.DashAlpha);
            Assert.AreEqual(9f, PatienceOutline.DashOn); Assert.AreEqual(7f, PatienceOutline.DashOff);
            Assert.AreEqual(25f, PatienceOutline.LabelDropPx);
            Assert.AreEqual(32, PatienceOutline.TileSize);
        }
    }
}

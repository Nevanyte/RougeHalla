using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-1 oracle: standing walls drawn from the delivered tiles only (legacy 78dd8bd4 FieldView.ts drawWall),
    /// kept per AreaKey, gone when the state drops them, cracking pale in the last second, fixed ice colours whoever cast them;
    /// the cast telegraph (WishFx.ts drawWallTelegraph); the aim preview (AbilityAim.ts: red with no tile, hidden under
    /// Freeze); no object left after Dispose; no allocation per frame once warmed. The client state is built directly, as
    /// P-FROST-WALL-2b's tests do.
    /// </summary>
    public sealed class FrostWallPresenterEditModeTests
    {
        GameObject _root;
        FrostWallPresenter _p;
        [SetUp] public void Up() { _root = new GameObject("frost wall test"); _p = new FrostWallPresenter(_root.transform); }
        [TearDown] public void Down() { _p.Dispose(); UnityEngine.Object.DestroyImmediate(_root); }

        const double Start = 1000, End = 5000;
        static MapTile[] Column(ushort x, ushort y0, int n)
        {
            var t = new MapTile[n];
            for (int i = 0; i < n; i++) t[i] = new MapTile(x, (ushort)(y0 + i));
            return t;
        }
        static AreaView Wall(MapTile[] tiles, uint? owner = 7, double start = Start, double end = End, ushort mapW = 40)
        {
            return new AreaView { Kind = AreaKind.Wall, Ability = AbilityId.Freeze, Owner = owner, StartedAt = start, EndsAt = end,
                Tiles = tiles, Key = new AreaKey(start, (uint)(tiles[0].Y * mapW + tiles[0].X)) };
        }
        static AreaView Zone() { return new AreaView { Kind = AreaKind.Zone, X = 300, Y = 300, Radius = 120, StartedAt = Start, EndsAt = End }; }
        static AreaView Trail() { return new AreaView { Kind = AreaKind.Trail, X = 10, Y = 10, X2 = 200, Y2 = 10, Radius = 20, StartedAt = Start, EndsAt = End }; }

        void Frame(IReadOnlyList<AreaView> fields, double t) { _p.PresentWalls(fields, t); _p.Tick(t, (float)t / 1000f, false); }

        int LiveRenderers()
        {
            int n = 0;
            foreach (var r in _root.GetComponentsInChildren<Renderer>(false)) if (r.enabled) n++;
            return n;
        }

        [Test]
        public void AWallOfNTilesMakesNBlocksAtThoseTiles()
        {
            var tiles = Column(12, 7, 7);
            Frame(new[] { Zone(), Wall(tiles), Trail() }, 2000);
            Assert.AreEqual(1, _p.WallCount);
            Assert.AreEqual(7, _p.BlockCount);
            for (int i = 0; i < 7; i++)
            {
                Assert.AreEqual(tiles[i].X, _p.BlockTile(i).X); Assert.AreEqual(tiles[i].Y, _p.BlockTile(i).Y);
                var go = _p.BlockObject(i);
                Assert.IsTrue(go.activeInHierarchy, "block " + i + " is drawn");
                var rs = go.GetComponentsInChildren<Renderer>(false);
                Assert.Greater(rs.Length, 0, "block " + i + " has a renderer");
                var b = rs[0].bounds; foreach (var r in rs) b.Encapsulate(r.bounds);
                Assert.AreEqual(ArenaView.WorldPoint(tiles[i].X * 32 + 16, 0).x, b.center.x, .05f, "block " + i + " stands on its tile's column");
            }
        }

        [Test]
        public void TheBlocksAreKeptAcrossSnapshotsWithTheSameKeyAndGoWhenTheStateDropsTheWall()
        {
            Frame(new[] { Wall(Column(12, 7, 3)) }, 2000);
            Assert.AreEqual(3, _p.BlockCount);
            var first = new GameObject[3];
            for (int i = 0; i < 3; i++) first[i] = _p.BlockObject(i);
            // The next key-3 frame: a new list and a new tile array, the same wall.
            Frame(new[] { Zone(), Wall(Column(12, 7, 3)) }, 2050);
            Assert.AreEqual(3, _p.BlockCount);
            for (int i = 0; i < 3; i++) Assert.AreSame(first[i], _p.BlockObject(i), "block " + i + " is kept");
            // The server stops listing it: gone, whatever its end time says.
            Frame(new[] { Zone() }, 2100);
            Assert.AreEqual(0, _p.WallCount); Assert.AreEqual(0, _p.BlockCount);
            Assert.AreEqual(0, LiveRenderers(), "no block drawn once the wall left the state");
        }

        [Test]
        public void NothingIsDrawnThatTheStateDoesNotListAsAWallWithTiles()
        {
            Frame(new[] { Zone(), Trail() }, 2000);
            Assert.AreEqual(0, _p.WallCount); Assert.AreEqual(0, _p.BlockCount);
            var noTiles = Wall(Column(3, 3, 1)); noTiles.Tiles = null;
            var empty = Wall(Column(3, 3, 1)); empty.Tiles = Array.Empty<MapTile>();
            Frame(new[] { noTiles, empty }, 2000);
            Assert.AreEqual(0, _p.BlockCount);
            Frame(null, 2000);
            Assert.AreEqual(0, _p.BlockCount);
            Assert.AreEqual(0, LiveRenderers());
        }

        [Test]
        public void TwoWallsDrawTheirOwnTilesAndAWallThatFallsTakesOnlyItsBlocks()
        {
            var a = Wall(Column(4, 2, 2)); var b = Wall(Column(9, 5, 3), null, 1500, 5500);
            Frame(new[] { a, b }, 2000);
            Assert.AreEqual(2, _p.WallCount); Assert.AreEqual(5, _p.BlockCount);
            Frame(new[] { b }, 2050);
            Assert.AreEqual(1, _p.WallCount); Assert.AreEqual(3, _p.BlockCount);
            Assert.AreEqual(9, _p.BlockTile(0).X);
        }

        // P-UNITY-FROST-WALL-READ-1 amended this test and the next (coordinator-approved in the packet): what they keep is that the ice is solid
        // until its last second, never gets MORE solid in it, fades out over the final FadeMs, and the whole wall changes together. What moved: the
        // exact legacy numbers 0.85 - 0.3 * crack (the crack's visible change is now pinned by FrostWallReadEditModeTests on a pale ground, where
        // alpha loss alone cannot be seen) and the exact legacy colours (now pinned there as an ice-blue hue family with the contrast floors).
        [Test]
        public void TheIceCracksPaleOnlyInItsLastSecond()
        {
            var fields = new[] { Wall(Column(12, 7, 2)) };
            Frame(fields, End - 2000);
            Assert.AreEqual(2, _p.BlockCount);
            float early = _p.BlockTopAlpha(0);
            Frame(fields, End - FrostWallPresenter.CrackMs); float edge = _p.BlockTopAlpha(0);
            Frame(fields, End - 500); float half = _p.BlockTopAlpha(0);
            Frame(fields, End - 100); float late = _p.BlockTopAlpha(0);
            Assert.AreEqual(FrostWallPresenter.TopAlpha, early, 1e-4f, "solid until the last second");
            Assert.AreEqual(early, edge, 1e-4f);
            Assert.LessOrEqual(half, early + 1e-4f, "the crack never makes the ice more solid");
            Assert.Less(late, half, "the final fade takes it away");
            Assert.LessOrEqual(late, FrostWallPresenter.TopAlpha * (100f / 300f) + 1e-3f, "faded to a third or less 100 ms before the end (legacy FIELD_FADE_MS 300)");
            Assert.AreEqual(late, _p.BlockTopAlpha(1), 1e-4f, "the whole wall cracks together");
        }

        [Test]
        public void TheIceIsTheSameForEveryCasterSeenOrNot()
        {
            Frame(new[] { Wall(Column(4, 2, 2), 7), Wall(Column(9, 5, 2), null, 1500), Wall(Column(20, 5, 2), 11, 1600) }, 2000);
            Assert.AreEqual(6, _p.BlockCount);
            for (int i = 0; i < 6; i++)
            {
                var c = _p.BlockTopColor(i);
                Assert.AreEqual(FrostWallPresenter.TopColor.r, c.r, "block " + i); Assert.AreEqual(FrostWallPresenter.TopColor.g, c.g); Assert.AreEqual(FrostWallPresenter.TopColor.b, c.b);
            }
        }

        [Test]
        public void TheTelegraphIsALineAcrossTheAimSquareToTheCasterForTheCastOnly()
        {
            _p.Telegraph(100, 100, 300, 100, 224, 1000, 250);
            _p.Tick(1100, 1.1f, false);
            Assert.IsTrue(_p.TelegraphVisible);
            Assert.AreEqual(300, _p.TelegraphEndA.x, 1e-3f); Assert.AreEqual(212, _p.TelegraphEndA.y, 1e-3f);
            Assert.AreEqual(300, _p.TelegraphEndB.x, 1e-3f); Assert.AreEqual(-12, _p.TelegraphEndB.y, 1e-3f);
            _p.Tick(1250, 1.25f, false);
            Assert.IsFalse(_p.TelegraphVisible, "gone when the cast lands");
            // A caster on the aim point draws no line (legacy: d < 1).
            _p.Telegraph(300, 100, 300.5f, 100, 224, 2000, 250);
            _p.Tick(2100, 2.1f, false);
            Assert.IsFalse(_p.TelegraphVisible);
        }

        [Test]
        public void ThePreviewDrawsTheMirrorsTilesRedWithNoneAndNothingUnderFreeze()
        {
            var seg = new FrostWallSegment(208, 48, 208, 160, 208, -64);
            var tint = new Color32(0x4f, 0xc3, 0xf7, 0xff);
            var cells = new List<uint> { 6, 16, 26 };
            _p.ShowPreview(seg, cells, 10, 80, 48, 450, tint, FrostWishKind.Wall);
            Assert.IsTrue(_p.PreviewVisible);
            Assert.AreEqual(3, _p.PreviewBlockCount);
            Assert.AreEqual(6, _p.PreviewTile(0).X); Assert.AreEqual(0, _p.PreviewTile(0).Y);
            Assert.AreEqual(6, _p.PreviewTile(2).X); Assert.AreEqual(2, _p.PreviewTile(2).Y);
            Assert.AreNotEqual(FrostWallPresenter.InvalidTint, _p.PreviewTint, "a valid preview is not the red one (it may use the caster's tint or the presenter's own readable colour: P-UNITY-FROST-WALL-READ-1)");
            Assert.Greater(LiveRenderers(), 0);

            _p.ShowPreview(seg, new List<uint>(), 10, 80, 48, 450, tint, FrostWishKind.Wall);
            Assert.IsTrue(_p.PreviewVisible, "a wall into rock still shows its line, in red");
            Assert.AreEqual(0, _p.PreviewBlockCount);
            Assert.AreEqual(FrostWallPresenter.InvalidTint, _p.PreviewTint);

            _p.ShowPreview(seg, cells, 10, 80, 48, 450, tint, FrostWishKind.Freeze);
            Assert.IsFalse(_p.PreviewVisible, "Freeze has no preview");
            _p.ShowPreview(seg, cells, 10, 80, 48, 450, tint, FrostWishKind.Wall);
            _p.HidePreview();
            Assert.IsFalse(_p.PreviewVisible);
            Assert.AreEqual(0, LiveRenderers(), "nothing drawn with no wall, no telegraph and the preview away");
        }

        [Test]
        public void GuardDisposeLeavesNoObject()
        {
            Frame(new[] { Wall(Column(12, 7, 7)) }, 2000);
            _p.Telegraph(100, 100, 300, 100, 224, 1900, 250);
            _p.ShowPreview(new FrostWallSegment(208, 48, 208, 160, 208, -64), new List<uint> { 6, 16 }, 10, 80, 48, 450, new Color32(1, 2, 3, 255), FrostWishKind.Wall);
            _p.Tick(2000, 2f, false);
            Assert.Greater(_root.transform.childCount, 0, "the presenter made its objects under the given parent");
            _p.Dispose();
            Assert.AreEqual(0, _root.transform.childCount, "no object left after Dispose");
            _p.Dispose(); // twice is harmless
        }

        [Test]
        public void GuardAWarmedFrameAllocatesNothing()
        {
            var fields = new[] { Zone(), Wall(Column(12, 7, 7)), Wall(Column(20, 3, 5), null, 1500, 5500) };
            var cells = new List<uint> { 6, 16, 26, 36 };
            var seg = new FrostWallSegment(208, 48, 208, 160, 208, -64);
            var tint = new Color32(0x4f, 0xc3, 0xf7, 0xff);
            _p.Telegraph(100, 100, 300, 100, 224, 3800, 400);
            for (int k = 0; k < 10; k++)
            {
                double t = 3800 + k * 10;
                Frame(fields, t); _p.ShowPreview(seg, cells, 10, 80, 48, 450, tint, FrostWishKind.Wall);
            }
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int k = 0; k < 200; k++)
            {
                double t = 3900 + k * 2; // through the crack and the telegraph
                Frame(fields, t); _p.ShowPreview(seg, cells, 10, 80, 48, 450, tint, FrostWishKind.Wall);
            }
            Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.LessThanOrEqualTo(0), "200 warmed frames allocate nothing");
            Assert.AreEqual(12, _p.BlockCount);
        }
    }
}

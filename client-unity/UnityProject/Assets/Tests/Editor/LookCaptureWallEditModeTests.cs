using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Editor;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-LOOK-WALL-1 oracle, EditMode half (nothing renders; the gate's EditMode run has no graphics). Building each of the five
    /// frost-wall capture scenes (LookCapture.BuildWallScene: the real ArenaView, the real FrostWallPresenter, state injected as
    /// FrostWallPresenterEditModeTests builds it, no server, no wire) leaves the right objects in the hierarchy, in the right state:
    /// ice blocks as many as wall tiles and standing where the scene says, the actors where the picture needs them, the wall fresh or
    /// 500 ms from its end, the preview open (and red when it would take no tile). Hierarchy names are the client's: "Ice block",
    /// "Frost wall preview" (FrostWallPresenter) and "stand-in actor" (the capture's own stand-in blocks).
    /// </summary>
    public sealed class LookCaptureWallEditModeTests
    {
        static readonly string[] StandingScenes = { "frost-wall", "frost-wall-vertical", "frost-wall-cracking" };
        static readonly string[] PreviewScenes = { "frost-wall-preview", "frost-wall-preview-invalid" };
        static readonly string[] AllScenes = StandingScenes.Concat(PreviewScenes).ToArray();
        static IEnumerable<string> Standing() { return StandingScenes; }
        static IEnumerable<string> Previews() { return PreviewScenes; }
        static IEnumerable<string> All() { return AllScenes; }

        LookCapture.WallScene _s;
        [TearDown] public void Down() { if (_s != null) LookCapture.DisposeWallScene(_s); _s = null; }

        LookCapture.WallScene Build(string scene)
        {
            _s = LookCapture.BuildWallScene(scene);
            Assert.That(_s, Is.Not.Null, scene);
            Assert.That(_s.Arena != null, Is.True, scene + ": an arena object was built");
            Assert.That(_s.View, Is.Not.Null, scene + ": through the real ArenaView");
            Assert.That(_s.Presenter, Is.Not.Null, scene + ": the arena's own FrostWallPresenter (reached by reflection)");
            Assert.That(_s.Map, Is.Not.Null, scene);
            return _s;
        }

        static List<GameObject> Live(GameObject root, string name)
        {
            return root.GetComponentsInChildren<Transform>(false).Where(t => t.name == name && t.gameObject.activeInHierarchy).Select(t => t.gameObject).ToList();
        }
        static bool Same(Color32 a, Color32 b) { return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a; }
        static int TileOf(float c) { return Mathf.FloorToInt(c); }

        // ---- the map: open Frost ground ------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(All))]
        public void TheSceneIsOneSixtyBySixtyFrostMapAndTheArenaWasBuiltOnIt(string scene)
        {
            var s = Build(scene);
            Assert.That(s.Map.W, Is.EqualTo(60)); Assert.That(s.Map.H, Is.EqualTo(60));
            Assert.That(s.Map.Regions.All(r => r == 4), Is.True, "Frost is zone 4 everywhere");
            Assert.That(s.Map.TerrainMode, Is.EqualTo(MapBlob.GroundTerrainAll));
            Assert.That(s.Map.Anchors.Length, Is.EqualTo(0), "ground only: no landmark");
            Assert.That(LookCapture.BuildMap(scene).W, Is.EqualTo(60), "BuildMap names the same map");
            Assert.That(LookCapture.ZoneOf(scene), Is.EqualTo((byte)4));
        }

        // ---- standing walls ------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Standing))]
        public void AStandingSceneHasOneWallOfAboutSevenTilesOnOpenGroundAndAnIceBlockPerTile(string scene)
        {
            var s = Build(scene);
            var tiles = s.WallTiles;
            Assert.That(tiles.Length, Is.InRange(6, 8), "about 7 tiles (legacy length 224 = 7 tiles)");
            Assert.That(s.Presenter.WallCount, Is.EqualTo(1));
            Assert.That(s.Presenter.BlockCount, Is.EqualTo(tiles.Length));
            Assert.That(Live(s.Arena, "Ice block").Count, Is.EqualTo(tiles.Length), "an active ice block under the presenter's root per wall tile");
            for (int i = 0; i < tiles.Length; i++)
            {
                Assert.That((int)s.Presenter.BlockTile(i).X, Is.EqualTo((int)tiles[i].X)); Assert.That((int)s.Presenter.BlockTile(i).Y, Is.EqualTo((int)tiles[i].Y));
                Assert.That(s.Presenter.BlockObject(i).activeInHierarchy, Is.True);
                Assert.That(s.Map.At(tiles[i].X, tiles[i].Y), Is.EqualTo(MapBlob.Floor), "the wall stands on floor");
            }
            foreach (var t in tiles)   // open ground: no rock within six tiles of the wall
                for (int y = Math.Max(0, t.Y - 6); y <= Math.Min(59, t.Y + 6); y++) for (int x = Math.Max(0, t.X - 6); x <= Math.Min(59, t.X + 6); x++)
                    Assert.That(s.Map.At(x, y), Is.Not.EqualTo(MapBlob.Wall), "rock at " + x + "," + y + " beside the wall");
            bool vertical = scene == "frost-wall-vertical";
            var line = vertical ? tiles.Select(t => (int)t.X) : tiles.Select(t => (int)t.Y);
            var along = (vertical ? tiles.Select(t => (int)t.Y) : tiles.Select(t => (int)t.X)).OrderBy(v => v).ToArray();
            Assert.That(line.Distinct().Count(), Is.EqualTo(1), vertical ? "one column" : "one row");
            Assert.That(along.Last() - along.First(), Is.EqualTo(tiles.Length - 1), "contiguous");
            Assert.That(s.Presenter.PreviewVisible, Is.False, "no aim preview over a standing wall");
            Assert.That(Live(s.Arena, "Frost wall preview"), Is.Empty);
        }

        [TestCaseSource(nameof(Standing))]
        public void TheIceTopIsAsSolidAsTheLegacyAlphaForAFreshWallAndPaleHalfwayThroughTheCrack(string scene)
        {
            var s = Build(scene);
            double left = s.EndsAtMs - s.RenderMs;
            if (scene == "frost-wall-cracking")
            {
                Assert.That(left, Is.EqualTo(500).Within(1), "500 ms from its end");
                Assert.That(s.Presenter.BlockTopAlpha(0), Is.LessThanOrEqualTo(FrostWallPresenter.TopAlpha + .01f), "never more solid than fresh (P-UNITY-FROST-WALL-READ-1 relaxed the exact legacy .85 - .3 * .5: the crack's visible change is pinned by FrostWallReadEditModeTests)");
            }
            else
            {
                Assert.That(left, Is.GreaterThan(1000 + 300), "fresh: more than a second (and the fade) from its end");
                Assert.That(s.Presenter.BlockTopAlpha(0), Is.EqualTo(FrostWallPresenter.TopAlpha).Within(.01f));
            }
            for (int i = 1; i < s.Presenter.BlockCount; i++) Assert.That(s.Presenter.BlockTopAlpha(i), Is.EqualTo(s.Presenter.BlockTopAlpha(0)).Within(1e-4f), "one wall, one look");
        }

        [Test]
        public void TheHorizontalWallHasTheSelfActorOneTileSouthAndAnotherOneTileNorth()
        {
            foreach (var scene in new[] { "frost-wall", "frost-wall-cracking" })
            {
                var s = Build(scene);
                int y = s.WallTiles[0].Y, x0 = s.WallTiles.Min(t => (int)t.X), x1 = s.WallTiles.Max(t => (int)t.X);
                Assert.That(s.Actors.Count, Is.EqualTo(2), scene);
                Assert.That(TileOf(s.Actors[0].y), Is.EqualTo(y + 1), scene + ": the self actor (first) one tile south (rows grow southward)");
                Assert.That(TileOf(s.Actors[1].y), Is.EqualTo(y - 1), scene + ": a second actor one tile north");
                foreach (var a in s.Actors) Assert.That(TileOf(a.x), Is.InRange(x0, x1), scene + ": both stand along the wall's span");
                Assert.That(Live(s.Arena, "stand-in actor").Count, Is.EqualTo(1), scene + ": the self actor is the real one drawn through ArenaView.Present, the second a stand-in block");
                LookCapture.DisposeWallScene(s); _s = null;
            }
        }

        [Test]
        public void TheVerticalWallHasAnActorBesideItsNorthEndAndOneBesideItsSouthEnd()
        {
            var s = Build("frost-wall-vertical");
            int x = s.WallTiles[0].X, y0 = s.WallTiles.Min(t => (int)t.Y), y1 = s.WallTiles.Max(t => (int)t.Y);
            Assert.That(s.Actors.Count, Is.EqualTo(2));
            foreach (var a in s.Actors) Assert.That(Math.Abs(TileOf(a.x) - x), Is.EqualTo(1), "beside the wall, one column off");
            Assert.That(s.Actors.Select(a => TileOf(a.y)).OrderBy(v => v).ToArray(), Is.EqualTo(new[] { y0, y1 }), "one at the north end's row, one at the south end's row");
            Assert.That(Live(s.Arena, "stand-in actor").Count, Is.EqualTo(1));
        }

        // ---- the preview scenes ------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Previews))]
        public void APreviewSceneHasNoStandingWallAndTheOpenPreviewMesh(string scene)
        {
            var s = Build(scene);
            Assert.That(s.Presenter.WallCount, Is.EqualTo(0)); Assert.That(s.Presenter.BlockCount, Is.EqualTo(0)); Assert.That(s.WallTiles, Is.Empty);
            Assert.That(Live(s.Arena, "Ice block"), Is.Empty);
            Assert.That(s.Presenter.PreviewVisible, Is.True);
            var mesh = Live(s.Arena, "Frost wall preview");
            Assert.That(mesh.Count, Is.EqualTo(1), "the preview mesh is active");
            Assert.That(mesh[0].GetComponent<MeshFilter>().sharedMesh.vertexCount, Is.GreaterThan(0));
            Assert.That(mesh[0].GetComponent<MeshRenderer>().enabled, Is.True);
            Assert.That(s.AimTile.HasValue, Is.True, "the scene says where it is aimed");
            Assert.That(s.Actors.Count, Is.GreaterThanOrEqualTo(1), "the caster (self) is drawn");
            var a = s.AimTile.Value; var self = s.Actors[0];
            double d = Math.Sqrt(Math.Pow(a.X + .5 - self.x, 2) + Math.Pow(a.Y + .5 - self.y, 2));
            Assert.That(d, Is.InRange(2.0, 14.0), "the aim is inside the reach ring (min range 64 to range 450 sim units = 2 to 14 tiles)");
        }

        [Test]
        public void TheValidPreviewTakesAboutSevenFloorTilesAndIsNotTheRedOne()
        {
            var s = Build("frost-wall-preview");
            Assert.That(s.Presenter.PreviewBlockCount, Is.InRange(5, 9), "about 7 tiles");
            var seen = new HashSet<(int, int)>();
            for (int i = 0; i < s.Presenter.PreviewBlockCount; i++)
            {
                var t = s.Presenter.PreviewTile(i);
                Assert.That(s.Map.At(t.X, t.Y), Is.EqualTo(MapBlob.Floor));
                Assert.That(seen.Add((t.X, t.Y)), Is.True, "distinct tiles");
            }
            Assert.That(s.Map.At(s.AimTile.Value.X, s.AimTile.Value.Y), Is.EqualTo(MapBlob.Floor), "aimed at open ground");
            Assert.That(Same(s.Presenter.PreviewTint, FrostWallPresenter.InvalidTint), Is.False);
        }

        [Test]
        public void TheInvalidPreviewIsAimedIntoRockTakesNoTileAndIsTintedRed()
        {
            var s = Build("frost-wall-preview-invalid");
            Assert.That(s.Presenter.PreviewBlockCount, Is.EqualTo(0), "no tile it could take");
            Assert.That(Same(s.Presenter.PreviewTint, FrostWallPresenter.InvalidTint), Is.True, "red (legacy 0xef5350)");
            Assert.That(s.Map.At(s.AimTile.Value.X, s.AimTile.Value.Y), Is.EqualTo(MapBlob.Wall), "the aim point is rock");
            Assert.That(s.Map.Tiles.Count(t => t == MapBlob.Wall), Is.GreaterThan(20), "a block of rock, not one stray tile");
        }

        // ---- clean-up ------------------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(All))]
        public void DisposingASceneLeavesNoArenaIceBlockPreviewOrStandInBehind(string scene)
        {
            var s = Build(scene);
            LookCapture.DisposeWallScene(s);
            Assert.That(s.Arena == null, Is.True, "the arena object is destroyed");
            foreach (var name in new[] { "Ice block", "Frost wall preview", "stand-in actor" })
                Assert.That(UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None).Count(t => t.name == name), Is.EqualTo(0), name);
            _s = null;
            var again = LookCapture.BuildWallScene(scene); _s = again;
            Assert.That(again.Arena != null, Is.True, "a second build in the same editor session works");
            Assert.That(Live(again.Arena, "stand-in actor").Count, Is.LessThanOrEqualTo(1), "no stand-ins left over from the first build");
        }
    }
}

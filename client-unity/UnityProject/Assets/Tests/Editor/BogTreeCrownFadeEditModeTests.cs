using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using UnityEngine;
using MapRect = Roguehalla.Net.Protocol.MapRect;   // Net.Ui has a MapRect of its own (the map screen's)

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-BOG-TREE-3 oracle (docs/backlog/packets/P-UNITY-BOG-TREE-3.md): the bog tree's crown fades only for an actor the crown hides, and
    /// the crown's ground shadow is not a roof (it neither fades nor sorts over actors).
    /// The rule for "hides" is the one BogTreeCrownEditModeTests uses: the tiles under the crown sprite's opaque pixels (alpha >= 128), by feet
    /// position; that test does not add the actor's drawn height. Actor order in this client (SpriteActorPresenter.cs, Present):
    /// 2000 + RoundToInt(server y px * .5), i.e. 2000 + 16 * tile y + 8 for an actor at a tile's centre.
    /// </summary>
    public sealed class BogTreeCrownFadeEditModeTests
    {
        const int N = 48, FootX = 9, FootY = 7, Size = 29;
        const float Sq = ArenaView.GroundSquash;

        [TearDown] public void ClearArtOverrides() { LandmarkArts.ClearOverrides(); }

        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }
        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("bog crown fade test root"); public LandmarkView View;
            public Scene(MapBlob map, params MapAnchor[] anchors) { View = LandmarkView.Build(Root.transform, map, anchors); }
            public void Dispose() { if (View != null) View.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        /// <summary>One frame: note the local player (when given) and the others, then a long Tick so the roof settles. Returns the roof alpha.</summary>
        static float Settle(Scene s, Vector3? local, params Vector3[] others)
        {
            if (local.HasValue) s.View.NoteActor(local.Value);
            foreach (var o in others) s.View.NoteOtherActor(o);
            s.View.Tick(10f);
            return s.View.Get(0).RoofAlpha;
        }

        static string[] Rows(string file)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/" + file));
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            return File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
        }

        /// <summary>The bog drawing stamped in orientation k (as BogTreeCrownEditModeTests.BogScene).</summary>
        static Scene BogScene(int k)
        {
            var rows = Rows("bog.txt"); int n = rows.Length;
            bool swap = (k & 1) != 0, fx = (k & 2) != 0, fy = (k & 4) != 0;
            var o = new string[n];
            var marks = new[] { (14, 14, 'c'), (12, 0, 'e'), (13, 0, 'e'), (0, 11, 'e'), (0, 12, 'e'), (13, 28, 'e'), (14, 28, 'e') };
            var rs = rows.Select(r => r.ToCharArray()).ToArray();
            foreach (var (x, y, m) in marks) rs[y][x] = m;
            var marked = rs.Select(r => new string(r)).ToArray();
            for (int y = 0; y < n; y++)
            {
                var r = new char[n];
                for (int x = 0; x < n; x++) { int sx = fx ? n - 1 - x : x, sy = fy ? n - 1 - y : y; r[x] = swap ? marked[sx][sy] : marked[sy][sx]; }
                o[y] = new string(r);
            }
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 3;
            var entrance = new List<MapTile>(); MapTile centre = default;
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = o[y][x]; int i = (FootY + y) * N + FootX + x; var t = new MapTile((ushort)(FootX + x), (ushort)(FootY + y));
                if (c == 'e') { entrance.Add(t); c = ':'; }
                if (c == 'c') { centre = t; c = 'T'; }
                if (c == 'T' || c == 'r') tiles[i] = MapBlob.Wall;
                else if (c == '%') terrain[i] = (byte)TerrainKind.Bog;
            }
            var anchor = new MapAnchor(3, MapBlob.AnchorKindBogTree, centre, new MapRect(FootX, FootY, Size, Size), 4, entrance.ToArray());
            var scene = new Scene(new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll), anchor);
            Assert.That(scene.View.Count, Is.EqualTo(1), "orientation " + k + ": one bog tree landmark");
            return scene;
        }

        static SpriteRenderer Named(Landmark lm, string name)
        {
            var found = lm.Root.GetComponentsInChildren<SpriteRenderer>(true).Where(r => r.name == name).ToArray();
            Assert.That(found.Length, Is.EqualTo(1), "one sprite named " + name);
            return found[0];
        }

        static IEnumerable<(int x, int y)> CoverTiles(Landmark lm)
        {
            for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++) if (lm.RoofCovers(x, y)) yield return (x, y);
        }

        /// <summary>Tiles under the crown's opaque pixels (alpha >= 128): the same rule as BogTreeCrownEditModeTests.</summary>
        static HashSet<(int x, int y)> Painted(SpriteRenderer r)
        {
            var s = r.sprite; var px = s.texture.GetPixels32(); int w = s.texture.width, h = s.texture.height; var set = new HashSet<(int x, int y)>();
            for (int j = 0; j < h; j++) for (int i = 0; i < w; i++)
            {
                if (px[j * w + i].a < 128) continue;
                var world = r.transform.TransformPoint(new Vector3((i + .5f) / s.pixelsPerUnit, (j + .5f) / s.pixelsPerUnit, 0));
                set.Add((Mathf.FloorToInt(world.x), Mathf.FloorToInt(-world.y / Sq)));
            }
            return set;
        }

        // ---- 1. the crown stays solid for an actor it does not hide (red today) -----------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void AnActorOnTheCoverTwoTilesSouthOfTheCrownsBottomEdgeLeavesTheCrownSolid(int k)
        {
            using (var scene = BogScene(k))
            {
                var lm = scene.View.Get(0); var crown = Named(lm, BogTreeLandmark.CrownName);
                float bottom = crown.bounds.min.y;
                var south = CoverTiles(lm).Where(t => TileCentre(t.x, t.y).y <= bottom - 2f * Sq).OrderBy(t => t).ToList();
                Assert.That(south.Count, Is.GreaterThan(10), "guard: the cover reaches well south of the crown (the shadow ring)");
                foreach (var t in south)
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofOpaqueAlpha),
                        "orientation " + k + ": an actor on cover tile " + t + ", two or more tiles south of the crown's bottom edge (world y " + bottom.ToString("F2") + "), does not fade the crown");
            }
        }

        // ---- 2. an actor the crown hides still fades it (guard, green today) --------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void AnActorUnderTheCrownsOpaquePixelsFadesItAndAnotherVisibleActorThereMakesItPeek(int k)
        {
            using (var scene = BogScene(k))
            {
                var painted = Painted(Named(scene.View.Get(0), BogTreeLandmark.CrownName));
                Assert.That(painted.Count, Is.GreaterThan(40), "guard: the crown covers a good many tiles");
                foreach (var t in painted.OrderBy(t => t))
                {
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), "orientation " + k + ": the local player on " + t + " fades the crown");
                    Settle(scene, null);
                    Assert.That(Settle(scene, null, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofPeekAlpha), "orientation " + k + ": another visible actor on " + t + " makes it peek");
                    Settle(scene, null);
                }
            }
        }

        // ---- 3. the ground shadow is not a roof (red today) -------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheGroundShadowSortsBelowAnActorStandingOnAnyCoverTile(int k)
        {
            using (var scene = BogScene(k))
            {
                var lm = scene.View.Get(0); var shadow = Named(lm, BogTreeLandmark.ShadowName);
                foreach (var t in CoverTiles(lm))
                {
                    int actorOrder = 2000 + Mathf.RoundToInt((t.y + .5f) * 32f * .5f);   // SpriteActorPresenter.Present: 2000 + round(y * .5)
                    Assert.That(shadow.sortingOrder, Is.LessThan(actorOrder), "orientation " + k + ": the shadow draws under an actor on cover tile " + t);
                }
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheGroundShadowsAlphaDoesNotChangeWhenTheCrownFades(int k)
        {
            using (var scene = BogScene(k))
            {
                var lm = scene.View.Get(0); var shadow = Named(lm, BogTreeLandmark.ShadowName);
                var hidden = Painted(Named(lm, BogTreeLandmark.CrownName)).OrderBy(t => t).First();
                Settle(scene, null); float before = shadow.color.a;
                Assert.That(Settle(scene, TileCentre(hidden.x, hidden.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), "guard: the crown fades for an actor on " + hidden);
                Assert.That(shadow.color.a, Is.EqualTo(before).Within(.001f), "orientation " + k + ": the shadow's alpha is unchanged while the crown is faded");
                Settle(scene, null);
                Assert.That(Settle(scene, null, TileCentre(hidden.x, hidden.y)), Is.EqualTo(LandmarkView.RoofPeekAlpha), "guard: the crown peeks");
                Assert.That(shadow.color.a, Is.EqualTo(before).Within(.001f), "and while it peeks");
            }
        }

        // ---- 4. the other landmarks are unchanged (guards, green today) -------------------------------------------------------------------------

        static readonly (int x, int y)[] ChurchCover = { (14, 14), (15, 14), (14, 15) };

        [Test]
        public void TheChurchFadesForTheLocalPlayerOnItsCoverPeeksForAnotherActorAndStaysSolidElsewhere()
        {
            const byte Kind = MapBlob.AnchorKindChurch;
            LandmarkArts.SetOverride(Kind, lm =>
            {
                lm.SetCover(ChurchCover.Select(c => new MapTile((ushort)c.x, (ushort)c.y)));
                var go = new GameObject("roof"); go.transform.SetParent(lm.Root.transform, false);
                lm.AddRoofRenderer(go.AddComponent<SpriteRenderer>());
            });
            var regions = new byte[40 * 40];
            for (int i = 0; i < regions.Length; i++) regions[i] = 2;
            var map = new MapBlob(40, 40, new byte[40 * 40], null, regions);
            var anchor = new MapAnchor(2, Kind, new MapTile(15, 15), new MapRect(10, 10, 10, 10), 4, new MapTile[0]);
            using (var scene = new Scene(map, anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1));
                Assert.That(Settle(scene, TileCentre(14, 14)), Is.EqualTo(LandmarkView.RoofFadedAlpha), "local player on the cover");
                Settle(scene, null);
                Assert.That(Settle(scene, null, TileCentre(15, 14)), Is.EqualTo(LandmarkView.RoofPeekAlpha), "another actor on the cover");
                Settle(scene, null);
                Assert.That(Settle(scene, TileCentre(17, 17)), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "a footprint tile off the cover");
            }
        }

        [Test]
        public void TheCaveFadesForAnActorOnItsInteriorAndPeeksForAnotherActor()
        {
            var rows = Rows("cave.txt");
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 4;
            var mouth = new List<(int x, int y)>(); (int x, int y) camp = (0, 0);
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x;
                if (c == '#' || c == 'R') tiles[i] = MapBlob.Wall;
                if (c == '=') terrain[i] = (byte)TerrainKind.Ice;
                if (c == 'D') mouth.Add((FootX + x, FootY + y));
                if (c == 'E') camp = (FootX + x, FootY + y);
            }
            var anchor = new MapAnchor(4, MapBlob.AnchorKindCave, new MapTile((ushort)camp.x, (ushort)camp.y), new MapRect(FootX, FootY, Size, Size), 4,
                mouth.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            using (var scene = new Scene(new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll), anchor))
            {
                var lm = scene.View.Get(0);
                Assert.That(lm.RoofCovers(camp.x, camp.y), Is.True, "guard: the camp tile is under the cave roof");
                Assert.That(Settle(scene, TileCentre(camp.x, camp.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), "local player inside the cave");
                Settle(scene, null);
                Assert.That(Settle(scene, null, TileCentre(camp.x, camp.y)), Is.EqualTo(LandmarkView.RoofPeekAlpha), "another actor inside the cave");
            }
        }
    }
}

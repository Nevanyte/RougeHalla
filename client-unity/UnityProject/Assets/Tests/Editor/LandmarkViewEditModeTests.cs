using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using MapRect = Roguehalla.Net.Protocol.MapRect;   // Net.Ui has a MapRect of its own (the map screen's)

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-LANDMARK-1 oracle, Unity half: a map whose anchors name a Cave gets one landmark built from the TILES inside the anchor's
    /// footprint (the approved drawing docs/landmarks/blueprints/cave.txt is stamped into a test map in each of the eight orientations
    /// the generator may place it in; the client never holds a copy of the drawing). Interior geometry is checked engine-free in
    /// RoguehallaNet.Tests/LandmarkInteriorTests.cs. Draw-order and fade decisions: docs/backlog/packets/P-UNITY-LANDMARK-1.md facts 2 and 3.
    /// </summary>
    public sealed class LandmarkViewEditModeTests
    {
        // ---- the cave in a test map -------------------------------------------------------------------------------------------

        const int N = 48, FootX = 9, FootY = 7, Size = 29;

        /// <summary>The checked-in drawing, one string per row (the legend lines start with ';').</summary>
        static string[] CaveRows()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/cave.txt"));
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            return File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
        }

        /// <summary>One of the eight placements: swap x and y, then flip x, then flip y.</summary>
        static string[] Orient(string[] rows, int k)
        {
            bool swap = (k & 1) != 0, fx = (k & 2) != 0, fy = (k & 4) != 0; int n = rows.Length;
            var o = new string[n];
            for (int y = 0; y < n; y++)
            {
                var r = new char[n];
                for (int x = 0; x < n; x++) { int sx = fx ? n - 1 - x : x, sy = fy ? n - 1 - y : y; r[x] = swap ? rows[sx][sy] : rows[sy][sx]; }
                o[y] = new string(r);
            }
            return o;
        }

        sealed class Site
        {
            public MapBlob Map; public MapAnchor Anchor; public int K;
            /// <summary>The mouth tiles, and the camp centre (a tile inside the chamber).</summary>
            public (int x, int y)[] Mouth; public (int x, int y) Camp;
        }

        /// <summary>A 48 x 48 map of open floor with the cave drawing, orientation k, stamped at (9, 7): '#' and 'R' wall, '=' ice terrain
        /// on floor, the mouth 'D' is plain floor. The anchor is what the generator would record: kind 4, centre = the camp tile, the
        /// 29 x 29 box, front = the side the mouth is on (DIR16: 0 east, 4 south, 8 west, 12 north), entrance = the mouth tiles.</summary>
        static Site Cave(int k)
        {
            var rows = Orient(CaveRows(), k);
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 4;
            var mouth = new List<(int, int)>(); (int, int) camp = (0, 0);
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x;
                if (c == '#' || c == 'R') tiles[i] = MapBlob.Wall;
                if (c == '=') terrain[i] = (byte)TerrainKind.Ice;
                if (c == 'D') mouth.Add((FootX + x, FootY + y));
                if (c == 'E') camp = (FootX + x, FootY + y);
            }
            double mx = mouth.Average(m => m.Item1) - (FootX + (Size - 1) / 2.0), my = mouth.Average(m => m.Item2) - (FootY + (Size - 1) / 2.0);
            byte front = Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12);
            var anchor = new MapAnchor(4, MapBlob.AnchorKindCave, new MapTile((ushort)camp.Item1, (ushort)camp.Item2),
                new MapRect(FootX, FootY, Size, Size), front, mouth.Select(m => new MapTile((ushort)m.Item1, (ushort)m.Item2)).ToArray());
            return new Site { Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll), Anchor = anchor, K = k, Mouth = mouth.ToArray(), Camp = camp };
        }

        static MapAnchor Anchor(byte zone, byte kind) { return new MapAnchor(zone, kind, new MapTile(20, 20), new MapRect(10, 10, 20, 20), 4, new MapTile[0]); }

        static MapBlob Open(int n = 40)
        {
            var regions = new byte[n * n];
            for (int i = 0; i < regions.Length; i++) regions[i] = 4;
            return new MapBlob((ushort)n, (ushort)n, new byte[n * n], null, regions);
        }

        // ---- scene helpers ----------------------------------------------------------------------------------------------------

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("landmark test root"); public LandmarkView View;
            public Scene(MapBlob map, params MapAnchor[] anchors) { View = LandmarkView.Build(Root.transform, map, anchors); }
            public void Dispose() { if (View != null) View.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        sealed class Logs : IDisposable
        {
            public readonly List<string> All = new List<string>();
            void On(string text, string stack, LogType type) { All.Add(text); }
            public Logs() { Application.logMessageReceived += On; }
            public int Count(string fragment) { return All.Count(l => l.Contains(fragment)); }
            public void Dispose() { Application.logMessageReceived -= On; }
        }

        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }

        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }

        // ---- the framework builds the cave from the tiles --------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void ACaveAnchorBuildsOneLandmarkClassifiedFromTheTilesInEveryOrientation(int k)
        {
            var site = Cave(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "orientation " + k + ": one landmark for one Cave anchor");
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(1), "one landmark object under the parent");
                var lm = scene.View.Get(0);
                Assert.That(lm.Anchor, Is.SameAs(site.Anchor));
                Assert.That(lm.Root, Is.Not.Null, "the landmark has a root object");
                Assert.That(lm.Root.transform.parent, Is.EqualTo(scene.Root.transform), "the landmark's root is that child");
                Assert.That(lm.WallCount, Is.EqualTo(214), "orientation " + k + ": 121 wall + 93 rock tiles of the footprint, counted from the collision plane");
                Assert.That(lm.IceCount, Is.EqualTo(226), "orientation " + k + ": the floor tiles whose terrain code is Ice");
                Assert.That(lm.InteriorCount, Is.EqualTo(624), "orientation " + k + ": the chamber's floor, less the 3 mouth tiles");
            }
        }

        [Test]
        public void TheRoofCoversEveryInteriorTileAndNoTileOutsideTheFootprint()
        {
            foreach (int k in new[] { 0, 5 })
            {
                var site = Cave(k);
                using (var scene = new Scene(site.Map, site.Anchor))
                {
                    Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                    var lm = scene.View.Get(0);
                    var flags = LandmarkInterior.Find(site.Map.Tiles, N, N, site.Anchor.Footprint, site.Anchor.Entrance);
                    Assert.That(LandmarkInterior.Count(flags), Is.EqualTo(624), "the engine-free rule and the presenter must agree (orientation " + k + ")");
                    int covered = 0;
                    for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                    {
                        bool inside = x >= FootX && x < FootX + Size && y >= FootY && y < FootY + Size;
                        bool interior = inside && flags[(y - FootY) * Size + (x - FootX)];
                        if (interior) Assert.That(lm.RoofCovers(x, y), Is.True, "orientation " + k + ": interior tile (" + x + ", " + y + ") is under the roof");
                        if (!inside) Assert.That(lm.RoofCovers(x, y), Is.False, "orientation " + k + ": tile (" + x + ", " + y + ") is outside the footprint");
                        if (lm.RoofCovers(x, y)) covered++;
                    }
                    Assert.That(covered, Is.GreaterThanOrEqualTo(624), "the roof covers at least the interior");
                    Assert.That(lm.RoofRenderers.Length, Is.GreaterThan(0), "the roof is drawn");
                    var all = lm.RoofRenderers[0].bounds; foreach (var r in lm.RoofRenderers) all.Encapsulate(r.bounds);
                    for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
                        if (flags[y * Size + x]) Assert.That(all.Contains(new Vector3(TileCentre(FootX + x, FootY + y).x, TileCentre(FootX + x, FootY + y).y, all.center.z)), Is.True,
                            "orientation " + k + ": the drawn roof reaches interior tile (" + (FootX + x) + ", " + (FootY + y) + ")");
                }
            }
        }

        // ---- the roof fade (decision: facts 2 and 3 in the packet) -------------------------------------------------------------

        [Test]
        public void TheRoofIsOpaqueWhileNoActorIsInsideAndFadesWhileOneIs()
        {
            var site = Cave(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var v = scene.View;
                Assert.That(LandmarkView.RoofFadedAlpha, Is.LessThan(LandmarkView.RoofOpaqueAlpha));
                v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "nobody inside: opaque");
                v.NoteActor(TileCentre(site.Camp.x, site.Camp.y)); v.Tick(.01f);
                Assert.That(lm.RoofAlpha, Is.LessThan(LandmarkView.RoofOpaqueAlpha).And.GreaterThan(LandmarkView.RoofFadedAlpha), "the fade moves at PropFade.FadeRate, not in one step");
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha - PropFade.FadeRate * .01f).Within(.002f), "the same rate as tall props");
                v.NoteActor(TileCentre(site.Camp.x, site.Camp.y)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "an actor on an interior tile: faded");
                v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "the actor left (no note this frame): the roof returns");
                foreach (var r in lm.RoofRenderers) Assert.That(r.color.a, Is.EqualTo(lm.RoofAlpha).Within(.001f), "the drawn roof carries the alpha");
            }
        }

        [Test]
        public void StandingInTheMouthOrJustOutsideTheFootprintDoesNotFadeTheRoof()
        {
            var site = Cave(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var v = scene.View;
                var m = site.Mouth[1];
                v.NoteActor(TileCentre(m.x, m.y)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "the mouth tile is the threshold, not the interior");
                v.NoteActor(TileCentre(m.x, m.y + 2)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "two tiles outside, on the lake side");
                v.NoteActor(TileCentre(site.Camp.x, site.Camp.y)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "control: the chamber fades it");
            }
        }

        [Test]
        public void AnyActorTheViewerMaySeeInsideFadesTheRoofSoItsNameAndBarsShow()
        {
            // Pinned decision (packet fact 3): the roof sorts at the footprint's south edge, over every actor and overhead name inside, so
            // the roof fades while ANY actor the client was told about stands inside, not only the local player. ArenaView notes only
            // actors in the observation (C-OBS); the roof reveals nothing the server did not deliver, and the vision fog (31000) is above it.
            var site = Cave(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var v = scene.View;
                // The local player is outside (not noted inside); a visible mob stands 3 tiles in from the camp.
                v.NoteActor(TileCentre(site.Mouth[0].x, site.Mouth[0].y + 4));
                v.NoteActor(TileCentre(site.Camp.x + 1, site.Camp.y + 3)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "a visible actor inside: the roof does not hide its name and bars");
                Assert.That(lm.RoofOrder, Is.LessThan(VisionFog.SortingOrder), "the fog above the roof still dims what the server did not deliver");
            }
        }

        // ---- draw order ---------------------------------------------------------------------------------------------------------

        [Test]
        public void TheRoofSortsAtTheFootprintsSouthEdgeAndUnderTheFog()
        {
            var site = Cave(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0);
                int edge = 2000 + (FootY + Size) * 16;     // RegionWalls row rule: 2000 + row * 16; actors 2000 + round(worldY * .5)
                Assert.That(lm.RoofOrder, Is.InRange(edge, edge + 15), "over actors inside the footprint, under those south of it");
                Assert.That(lm.RoofRenderers.All(r => r.sortingOrder == lm.RoofOrder), Is.True, "every roof piece on that order");
                Assert.That(lm.RoofOrder, Is.LessThan(VisionFog.SortingOrder));
            }
        }

        // ---- the mouth arch -------------------------------------------------------------------------------------------------------

        [TestCase(0)]
        [TestCase(2)]
        [TestCase(1)]
        [TestCase(7)]
        public void TheMouthArchStandsOnTheEntranceTilesOnTheSideTheFrontPointsTo(int k)
        {
            var site = Cave(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0);
                Assert.That(lm.ArchTiles.Select(t => (t.X, t.Y)).OrderBy(t => t), Is.EqualTo(site.Anchor.Entrance.Select(t => (t.X, t.Y)).OrderBy(t => t)), "the arch stands on the entrance tiles");
                var dir = new Vector2(Mathf.Cos(site.Anchor.Front * Mathf.PI / 8f), Mathf.Sin(site.Anchor.Front * Mathf.PI / 8f));   // DIR16, y south
                Assert.That(Vector2.Distance(lm.FrontVector, dir), Is.LessThan(.01f), "orientation " + k + ": FrontVector is the anchor's front");
                float x0 = site.Mouth.Min(m => m.x), x1 = site.Mouth.Max(m => m.x) + 1, y0 = site.Mouth.Min(m => m.y), y1 = site.Mouth.Max(m => m.y) + 1;
                float tx = lm.ArchCentre.x, ty = -lm.ArchCentre.y / ArenaView.GroundSquash;     // back to tile units
                Assert.That(tx, Is.InRange(x0 - .01f, x1 + .01f), "orientation " + k + ": the arch's centre is over the mouth's columns");
                Assert.That(ty, Is.InRange(y0 - .01f, y1 + .01f), "orientation " + k + ": and its rows");
                var c = new Vector2(FootX + Size / 2f, FootY + Size / 2f);
                Assert.That(Vector2.Dot(new Vector2(tx, ty) - c, lm.FrontVector), Is.GreaterThan(Size / 2f - 1.5f), "orientation " + k + ": on the footprint's edge the front points to");
            }
        }

        // ---- nothing extra --------------------------------------------------------------------------------------------------------

        [Test]
        public void AMapWithoutAnchorsBuildsNoLandmarkObject()
        {
            // Guard: green with the stub and must stay green.
            using (var scene = new Scene(Open()))
            {
                Assert.That(scene.View.Count, Is.EqualTo(0));
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(0), "no object under the parent");
            }
        }

        [Test]
        public void AnUnknownKindBuildsNothingAndLogsOnce()
        {
            using (var logs = new Logs())
            using (var scene = new Scene(Open(), Anchor(1, 9), Anchor(2, 9)))
            {
                Assert.That(scene.View.Count, Is.EqualTo(0));
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(0), "nothing extra under the parent");
                Assert.That(logs.Count("LandmarkView: unknown kind 9"), Is.EqualTo(1), "one log for two anchors of an unknown kind");
            }
        }

        [Test]
        public void AKnownKindWithNoArtRegisteredBuildsNothingAndLogsOnce()
        {
            // Hall (kind 5) is a later packet's. Until then it draws today's tiles and says so once.
            Assert.That(LandmarkArts.Has(MapBlob.AnchorKindHall), Is.False, "this packet registers no art for the hall");
            using (var logs = new Logs())
            using (var scene = new Scene(Open(), Anchor(1, MapBlob.AnchorKindHall)))
            {
                Assert.That(scene.View.Count, Is.EqualTo(0));
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(0), "nothing extra under the parent");
                Assert.That(logs.Count("LandmarkView: no art for kind 5"), Is.EqualTo(1));
            }
        }

        [Test]
        public void TheCaveIsTheOnlyKindWithArtAndTheRegistrationPointIsLandmarkArts()
        {
            Assert.That(LandmarkArts.Has(MapBlob.AnchorKindCave), Is.True, "Cave is registered");
            foreach (byte kind in new[] { MapBlob.AnchorKindHall })
                Assert.That(LandmarkArts.Has(kind), Is.False, "kind " + kind + " belongs to a follow-up packet");
            Assert.That(LandmarkArts.IsKnownKind(0), Is.False); Assert.That(LandmarkArts.IsKnownKind(6), Is.False);
            for (byte kind = 1; kind <= 5; kind++) Assert.That(LandmarkArts.IsKnownKind(kind), Is.True);
        }

        // ---- no garbage -----------------------------------------------------------------------------------------------------------

        [Test]
        public void AFrameWhereNothingChangedCreatesAndAllocatesNothing()
        {
            var site = Cave(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var v = scene.View; var inside = TileCentre(site.Camp.x, site.Camp.y); var outside = TileCentre(site.Mouth[1].x, site.Mouth[1].y + 5);
                for (int i = 0; i < 20; i++) { v.NoteActor(inside); v.NoteActor(outside); v.Tick(1f / 60f); }   // settled at the faded value
                int objects = scene.Root.GetComponentsInChildren<Transform>(true).Length;
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) { v.NoteActor(inside); v.NoteActor(outside); v.Tick(1f / 60f); }
                long grown = GC.GetAllocatedBytesForCurrentThread() - before;
                Assert.That(grown, Is.LessThanOrEqualTo(0), "200 unchanged frames allocated " + grown + " bytes");
                Assert.That(scene.Root.GetComponentsInChildren<Transform>(true).Length, Is.EqualTo(objects), "and created no object");
                for (int i = 0; i < 20; i++) v.Tick(1f / 60f);   // the roof returns, still without garbage
                before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) v.Tick(1f / 60f);
                Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.LessThanOrEqualTo(0), "200 idle frames at the opaque value");
            }
        }

        // ---- through the map blob (needs the P-WIRE17-MAP-3 implementation) ---------------------------------------------------

        [Test]
        public void BuildReadsTheAnchorsFromTheMapBlob()
        {
            // Red until P-WIRE17-MAP-3's implementation merges: its stub WithPublic ignores the anchors.
            var site = Cave(0);
            var map = site.Map.WithPublic(null, null, null, null, null, null, new[] { site.Anchor });
            Assert.That(map.Anchors.Length, Is.EqualTo(1), "the blob carries the anchor (P-WIRE17-MAP-3)");
            var root = new GameObject("landmark blob root");
            try
            {
                using (var view = LandmarkView.Build(root.transform, map))
                    Assert.That(view.Count, Is.EqualTo(1), "Build(parent, map) uses map.Anchors");
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        // ---- guards: a map without anchors draws exactly as today -------------------------------------------------------------------

        [Test]
        public void AMapWithoutAnchorsRendersTheSameWallGroundAndPropObjectsAsToday()
        {
            // Guard: green with the stub. The counts are the existing batching test's shape (RegionThemeEditModeTests
            // GroundIsOneRendererAndWallsAreOneMeshPerRowChunk): one ground quad, one mesh per non-empty wall row chunk, no per-tile objects.
            var map = Open(); map.Tiles[10 * 40 + 10] = MapBlob.Wall; map.Tiles[10 * 40 + 11] = MapBlob.Wall; map.Tiles[12 * 40 + 20] = MapBlob.Wall;
            var root = new GameObject("landmark guard root");
            try
            {
                var ground = RegionGround.Create(root.transform, map, 1f);
                var walls = RegionWalls.Build(root.transform, map, 1f);
                var props = RegionProps.Build(root.transform, map);
                int meshes = root.GetComponentsInChildren<MeshRenderer>().Length, sprites = root.GetComponentsInChildren<SpriteRenderer>().Length, objects = root.GetComponentsInChildren<Transform>(true).Length;
                Assert.That(ground.Root.GetComponentsInChildren<MeshRenderer>().Length, Is.EqualTo(1));
                Assert.That(walls.RowMeshCount, Is.EqualTo(2), "rows 10 and 12 each have walls in one chunk");
                Assert.That(meshes, Is.EqualTo(1 + walls.RowMeshCount));
                Assert.That(sprites, Is.EqualTo(props.Count), "one sprite per prop");
                using (var view = LandmarkView.Build(root.transform, map))
                {
                    Assert.That(view.Count, Is.EqualTo(0));
                    Assert.That(root.GetComponentsInChildren<MeshRenderer>().Length, Is.EqualTo(meshes));
                    Assert.That(root.GetComponentsInChildren<SpriteRenderer>().Length, Is.EqualTo(sprites));
                    Assert.That(root.GetComponentsInChildren<Transform>(true).Length, Is.EqualTo(objects), "building the landmark view for a map without anchors adds nothing");
                }
                ground.Dispose(); walls.Dispose(); props.Dispose();
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }
    }
}

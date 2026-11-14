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
    /// P-UNITY-LANDMARK-2 oracle, Unity half: a map whose anchors name a Volcano gets one landmark built from the TILES inside the anchor's
    /// footprint. The approved drawing docs/landmarks/blueprints/volcano.txt is stamped into a test map in each of the eight orientations the
    /// generator may place it in ('#', 'X', 'H' = Wall; '~', 'O' = Low with terrain Lava; '.' floor). Only structure is pinned: counts,
    /// covered tiles, tiers, glow positions, order, garbage; never colours or shapes. Rules and facts:
    /// docs/backlog/packets/P-UNITY-LANDMARK-2.md ("Established facts"). The engine-free guards are in RoguehallaNet.Tests/VolcanoLandmarkDrawingTests.cs.
    /// </summary>
    public sealed class VolcanoLandmarkEditModeTests
    {
        const int N = 48, FootX = 9, FootY = 7, Size = 22;

        static string[] Rows()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/volcano.txt"));
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
            /// <summary>The six outlet tiles (the anchor's entrance), grouped into the three 2-tile outlets.</summary>
            public (int x, int y)[][] Outlets;
        }

        static bool IsWall(char c) { return c == '#' || c == 'X' || c == 'H'; }
        static bool IsLava(char c) { return c == '~' || c == 'O'; }

        /// <summary>A 48 x 48 map of open floor with the volcano drawing, orientation k, stamped at (9, 7). The anchor is what the generator
        /// records (fact in the packet): kind 1, zone 1 (Fire), centre = a lava tile at the lake's middle, the 22 x 22 box, front = the side
        /// the outlets are on (DIR16: 0 east, 4 south, 8 west, 12 north), entrance = the six outlet tiles.</summary>
        static Site Volcano(int k)
        {
            var rows = Orient(Rows(), k);
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 1;
            var outlet = new List<(int x, int y)>(); var lava = new List<(int x, int y)>();
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x;
                if (IsWall(c)) tiles[i] = MapBlob.Wall;
                if (IsLava(c)) { tiles[i] = MapBlob.Low; terrain[i] = (byte)TerrainKind.Lava; lava.Add((FootX + x, FootY + y)); }
                if (c == 'O') outlet.Add((FootX + x, FootY + y));
            }
            double mx = outlet.Average(m => m.x) - (FootX + (Size - 1) / 2.0), my = outlet.Average(m => m.y) - (FootY + (Size - 1) / 2.0);
            byte front = Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12);
            double cx = lava.Average(l => l.x), cy = lava.Average(l => l.y);
            var centre = lava.OrderBy(l => (l.x - cx) * (l.x - cx) + (l.y - cy) * (l.y - cy)).First();
            // Group the outlet tiles into runs of two (4-adjacent).
            var groups = new List<List<(int x, int y)>>();
            foreach (var o in outlet.OrderBy(o => o.x).ThenBy(o => o.y))
            {
                var g = groups.FirstOrDefault(gr => gr.Any(p => Math.Abs(p.x - o.x) + Math.Abs(p.y - o.y) == 1));
                if (g == null) groups.Add(new List<(int x, int y)> { o }); else g.Add(o);
            }
            var anchor = new MapAnchor(1, MapBlob.AnchorKindVolcano, new MapTile((ushort)centre.x, (ushort)centre.y),
                new MapRect(FootX, FootY, Size, Size), front, outlet.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            return new Site { Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll), Anchor = anchor, K = k, Outlets = groups.Select(g => g.ToArray()).ToArray() };
        }

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("volcano test root"); public LandmarkView View;
            public Scene(MapBlob map, params MapAnchor[] anchors) { View = LandmarkView.Build(Root.transform, map, anchors); }
            public void Dispose() { if (View != null) View.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }
        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }
        static Vector2 ToTiles(Vector3 world) { return new Vector2(world.x, -world.y / ArenaView.GroundSquash); }

        // ---- one landmark, no roof, no interior ---------------------------------------------------------------------------------

        [Test]
        public void TheVolcanoIsRegisteredAtTheOnePlace()
        {
            Assert.That(LandmarkArts.Has(MapBlob.AnchorKindVolcano), Is.True, "LandmarkArts registers the volcano (and the cave stays registered)");
            Assert.That(LandmarkArts.Has(MapBlob.AnchorKindCave), Is.True);
        }

        [TestCaseSource(nameof(Orientations))]
        public void AVolcanoAnchorBuildsOneLandmarkWithNoRoofAndNoInteriorInEveryOrientation(int k)
        {
            var site = Volcano(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "orientation " + k + ": one landmark for one Volcano anchor");
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(1), "one landmark object under the parent");
                var lm = scene.View.Get(0);
                Assert.That(lm.Anchor, Is.SameAs(site.Anchor));
                Assert.That(lm.Root.transform.parent, Is.EqualTo(scene.Root.transform));
                Assert.That(lm.WallCount, Is.EqualTo(322), "orientation " + k + ": 136 foot + 146 slope + 40 rim wall tiles, counted from the collision plane");
                Assert.That(lm.IceCount, Is.EqualTo(0));
                Assert.That(lm.InteriorCount, Is.EqualTo(0), "orientation " + k + ": nothing is enclosed (the lake is lava, not floor)");
                Assert.That(lm.RoofRenderers.Length, Is.EqualTo(0), "no roof renderer");
                Assert.That(VolcanoLandmark.ArtOf(lm), Is.Not.Null, "the volcano art was built for this landmark");
                Assert.That(lm.Root.GetComponentsInChildren<SpriteRenderer>(true).Length, Is.GreaterThan(0), "the landmark draws something");
                foreach (var r in lm.Root.GetComponentsInChildren<SpriteRenderer>(true))
                    Assert.That(r.sortingOrder, Is.LessThan(VisionFog.SortingOrder), "the fog stays above everything the landmark draws");
            }
        }

        // ---- the cone ---------------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheConeArtCoversEveryWallTileOfTheFootprintAndNoTileOutsideIt(int k)
        {
            var site = Volcano(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var art = VolcanoLandmark.ArtOf(scene.View.Get(0));
                Assert.That(art, Is.Not.Null, "needs the art first");
                int covered = 0;
                for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                {
                    bool inside = x >= FootX && x < FootX + Size && y >= FootY && y < FootY + Size;
                    bool wall = inside && site.Map.Tiles[y * N + x] == MapBlob.Wall;
                    Assert.That(art.Tier(x, y) >= 0, Is.EqualTo(wall), "orientation " + k + ": tile (" + x + ", " + y + ") is cone art exactly when it is a wall tile of the footprint");
                    if (art.Tier(x, y) >= 0) covered++;
                }
                Assert.That(covered, Is.EqualTo(322));
                Assert.That(art.ConeRenderers.Length, Is.GreaterThan(0), "the cone is drawn");
                var all = art.ConeRenderers[0].bounds; foreach (var r in art.ConeRenderers) all.Encapsulate(r.bounds);
                for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
                    if (site.Map.Tiles[(FootY + y) * N + FootX + x] == MapBlob.Wall)
                    {
                        var c = TileCentre(FootX + x, FootY + y);
                        Assert.That(all.Contains(new Vector3(c.x, c.y, all.center.z)), Is.True, "orientation " + k + ": the drawn cone reaches wall tile (" + (FootX + x) + ", " + (FootY + y) + ")");
                    }
                // Bounded above: no further than one tile beside the footprint, a mountain's height (two tiles) above and one below.
                float sq = ArenaView.GroundSquash;
                Assert.That(all.min.x, Is.GreaterThanOrEqualTo(FootX - 1f)); Assert.That(all.max.x, Is.LessThanOrEqualTo(FootX + Size + 1f));
                Assert.That(all.min.y, Is.GreaterThanOrEqualTo(-(FootY + Size) * sq - 1f)); Assert.That(all.max.y, Is.LessThanOrEqualTo(-FootY * sq + 2f));
                int lo = 2000 + 16 * FootY, hi = 2000 + 16 * (FootY + Size) + 15;
                foreach (var r in art.ConeRenderers)
                    Assert.That(r.sortingOrder, Is.InRange(lo, hi), "the cone sorts by row like the walls: an actor north of it is hidden, one south stands in front");
                foreach (var r in art.ConeRenderers) Assert.That(r.transform.IsChildOf(scene.View.Get(0).Root.transform), Is.True, "under the landmark's root");
            }
        }

        // ---- tiers ------------------------------------------------------------------------------------------------------------------

        /// <summary>The packet's tier rule on the delivered tiles. DEPTH of a wall tile of the footprint = Euclidean distance between tile centres
        /// to the nearest tile that is neither Wall nor Low-lava (any tile outside the footprint counts as such); D = the largest depth;
        /// depth &lt;= 0.4 D foot (0), &lt;= 0.8 D slope (1), else rim (2). No depth lies on a threshold, so float rounding cannot matter.</summary>
        static int[] ExpectedTiers(MapBlob map)
        {
            var t = new int[N * N]; var depth = new double[N * N]; double dmax = 0;
            for (int i = 0; i < t.Length; i++) t[i] = -1;
            for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++)
            {
                if (map.Tiles[y * N + x] != MapBlob.Wall) continue;
                double lx = x - FootX, ly = y - FootY;
                double best = Math.Min(Math.Min(lx + 1, Size - lx), Math.Min(ly + 1, Size - ly)); best *= best;
                for (int yy = FootY; yy < FootY + Size; yy++) for (int xx = FootX; xx < FootX + Size; xx++)
                    if (map.Tiles[yy * N + xx] == MapBlob.Floor) best = Math.Min(best, (x - xx) * (x - xx) + (y - yy) * (y - yy));
                depth[y * N + x] = Math.Sqrt(best); dmax = Math.Max(dmax, depth[y * N + x]);
            }
            for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++)
                if (map.Tiles[y * N + x] == MapBlob.Wall) { double d = depth[y * N + x]; t[y * N + x] = d <= .4 * dmax ? 0 : d <= .8 * dmax ? 1 : 2; }
            return t;
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheConeHasThreeTiersFromTheTilesAndEveryRimTileIsNearerTheLakeThanEveryFootTile(int k)
        {
            var site = Volcano(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var art = VolcanoLandmark.ArtOf(scene.View.Get(0));
                Assert.That(art, Is.Not.Null, "needs the art first");
                var want = ExpectedTiers(site.Map); var counts = new int[3];
                for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                {
                    Assert.That(art.Tier(x, y), Is.EqualTo(want[y * N + x]), "orientation " + k + ": tier of (" + x + ", " + y + ") follows the packet's depth rule");
                    if (want[y * N + x] >= 0) counts[want[y * N + x]]++;
                }
                Assert.That(counts, Is.EqualTo(new[] { 136, 146, 40 }), "foot, slope, rim");
                // The lake core: lava tiles (Low) whose eight neighbours are all Low lava.
                var core = new List<(int x, int y)>();
                bool Lava(int x, int y) { return site.Map.Tiles[y * N + x] == MapBlob.Low && site.Map.Terrain[y * N + x] == (byte)TerrainKind.Lava; }
                for (int y = FootY + 1; y < FootY + Size - 1; y++) for (int x = FootX + 1; x < FootX + Size - 1; x++)
                {
                    bool all = true; for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) all &= Lava(x + dx, y + dy);
                    if (all) core.Add((x, y));
                }
                Assert.That(core.Count, Is.EqualTo(58), "the lake core");
                double rimFar = 0, footNear = double.MaxValue;
                for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                {
                    int tier = art.Tier(x, y); if (tier != VolcanoArt.Rim && tier != VolcanoArt.Foot) continue;
                    double d = core.Min(c => Math.Sqrt((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y)));
                    if (tier == VolcanoArt.Rim) rimFar = Math.Max(rimFar, d); else footNear = Math.Min(footNear, d);
                }
                Assert.That(rimFar, Is.LessThan(footNear), "orientation " + k + ": every rim tile is nearer the lake than every foot tile");
            }
        }

        // ---- glows ------------------------------------------------------------------------------------------------------------------

        [Test]
        public void TheFourFrontDirectionsAreAllCoveredByTheEightOrientations()
        {
            // Guard on the test map itself (green today): the outlet test below runs on every front the generator can produce.
            Assert.That(Enumerable.Range(0, 8).Select(k => (int)Volcano(k).Anchor.Front).Distinct().OrderBy(f => f), Is.EqualTo(new[] { 0, 4, 8, 12 }));
            Assert.That(Enumerable.Range(0, 8).All(k => Volcano(k).Outlets.Length == 3 && Volcano(k).Outlets.All(g => g.Length == 2)), Is.True, "three 2-tile outlets");
        }

        [TestCaseSource(nameof(Orientations))]
        public void AGlowStandsOnEachOutletOnTheSideTheFrontPointsTo(int k)
        {
            var site = Volcano(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var art = VolcanoLandmark.ArtOf(lm);
                Assert.That(art, Is.Not.Null, "needs the art first");
                Assert.That(art.GlowRenderers.Length, Is.GreaterThanOrEqualTo(3), "a glow for each of the three outlets");
                var front = lm.FrontVector; var side = new Vector2(-front.y, front.x);
                var used = new HashSet<int>();
                foreach (var outlet in site.Outlets)
                {
                    var centre = new Vector2(outlet.Average(t => t.x + .5f), outlet.Average(t => t.y + .5f));
                    int found = -1;
                    for (int i = 0; i < art.GlowRenderers.Length && found < 0; i++)
                    {
                        var g = ToTiles(art.GlowRenderers[i].bounds.center) - centre;
                        float along = Vector2.Dot(g, front), across = Vector2.Dot(g, side);
                        if (along >= -.01f && along <= 1.5f && Mathf.Abs(across) <= 1.5f) found = i;
                    }
                    Assert.That(found, Is.GreaterThanOrEqualTo(0), "orientation " + k + " (front " + site.Anchor.Front + "): a glow on the outlet at " + centre + ", between its tiles and 1.5 tiles beyond them on the front side");
                    Assert.That(used.Add(found), Is.True, "each outlet has a glow of its own");
                }
                foreach (var r in art.GlowRenderers)
                {
                    Assert.That(r.transform.IsChildOf(lm.Root.transform), Is.True, "under the landmark's root");
                    Assert.That(r.sortingOrder, Is.LessThan(VisionFog.SortingOrder), "under the fog");
                }
            }
        }

        [Test]
        public void AGlowStandsOverTheLake()
        {
            var site = Volcano(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var art = VolcanoLandmark.ArtOf(scene.View.Get(0));
                Assert.That(art, Is.Not.Null, "needs the art first");
                // The crater: drawing rows 6..15 and columns 5..16 are lava in orientation 0 (the lake proper, apart from the channels).
                bool over = art.GlowRenderers.Any(r =>
                {
                    var c = ToTiles(r.bounds.center);
                    return c.x >= FootX + 5 && c.x <= FootX + 17 && c.y >= FootY + 6 && c.y <= FootY + 16;
                });
                Assert.That(over, Is.True, "a glow whose centre is inside the crater lake");
            }
        }

        // ---- no garbage -------------------------------------------------------------------------------------------------------------

        [Test]
        public void AFrameWhereNothingChangedCreatesAndAllocatesNothing()
        {
            var site = Volcano(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                Assert.That(VolcanoLandmark.ArtOf(scene.View.Get(0)), Is.Not.Null, "needs the art first");
                var v = scene.View; var near = TileCentre(FootX + 11, FootY + 10); var south = TileCentre(FootX + 11, FootY + Size + 3);
                for (int i = 0; i < 20; i++) { v.NoteActor(near); v.NoteActor(south); v.Tick(1f / 60f); }
                int objects = scene.Root.GetComponentsInChildren<Transform>(true).Length;
                var art = VolcanoLandmark.ArtOf(v.Get(0));
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) { v.NoteActor(near); v.NoteActor(south); v.Tick(1f / 60f); }
                long grown = GC.GetAllocatedBytesForCurrentThread() - before;
                Assert.That(grown, Is.LessThanOrEqualTo(0), "200 unchanged frames allocated " + grown + " bytes");
                Assert.That(scene.Root.GetComponentsInChildren<Transform>(true).Length, Is.EqualTo(objects), "and created no object");
                Assert.That(VolcanoLandmark.ArtOf(v.Get(0)), Is.SameAs(art), "the art is built once");
            }
        }

        [Test]
        public void EverythingTheArtCreatesIsDisposedWithTheLandmark()
        {
            var site = Volcano(0);
            int textures = Resources.FindObjectsOfTypeAll<Texture2D>().Length, sprites = Resources.FindObjectsOfTypeAll<Sprite>().Length;
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                Assert.That(Resources.FindObjectsOfTypeAll<Texture2D>().Length + Resources.FindObjectsOfTypeAll<Sprite>().Length, Is.GreaterThan(textures + sprites), "the art made textures or sprites");
            }
            Assert.That(Resources.FindObjectsOfTypeAll<Texture2D>().Length, Is.EqualTo(textures), "every texture the art made is destroyed with the landmark (Landmark.Own)");
            Assert.That(Resources.FindObjectsOfTypeAll<Sprite>().Length, Is.EqualTo(sprites), "and every sprite");
        }
    }
}

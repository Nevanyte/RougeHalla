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
    /// P-UNITY-LANDMARK-5 oracle, Unity half: a map whose anchors name a Hall gets one landmark whose art is derived from the TILES inside the
    /// anchor's footprint (the approved drawing docs/landmarks/blueprints/hall.txt is stamped into a test map in each of the eight orientations).
    /// Only structure is pinned: one column per pier group, the shrine's roof, cover and fade, the door and light objects, the threshold at the
    /// entrance, no roof over the colonnade. Never colours or shapes. The contract between these tests and the art is the object names
    /// "Hall column", "Hall door", "Hall light" and "Hall threshold" (descendants of Landmark.Root, each with a renderer), Landmark.RoofRenderers,
    /// Landmark.SetCover and Landmark.Terrain (docs/backlog/packets/P-UNITY-LANDMARK-5.md, Established facts).
    /// </summary>
    public sealed class HallLandmarkEditModeTests
    {
        const string ColumnName = "Hall column", DoorName = "Hall door", LightName = "Hall light", ThresholdName = "Hall threshold";
        const int N = 56, FootX = 9, FootY = 7, Size = 37;

        static string[] HallRows()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/hall.txt"));
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

        /// <summary>Private marks, all plain floor in the map, put on the drawing before it is oriented: M the entrance (front row 36, the nave's
        /// columns 15-21), i the shrine's interior floor that is not light (rows 2-5 columns 15-21, row 6 columns 16-20), B two tiles between piers
        /// ((4, 1) and (10, 14)), V a nave tile ((18, 24)).</summary>
        static string[] Marked()
        {
            var rows = HallRows().Select(r => r.ToCharArray()).ToArray();
            for (int x = 15; x <= 21; x++) rows[36][x] = 'M';
            for (int y = 2; y <= 5; y++) for (int x = 15; x <= 21; x++) if (rows[y][x] == '.') rows[y][x] = 'i';
            for (int x = 16; x <= 20; x++) if (rows[6][x] == '.') rows[6][x] = 'i';
            rows[1][4] = 'B'; rows[14][10] = 'B'; rows[24][18] = 'V';
            return rows.Select(r => new string(r)).ToArray();
        }

        sealed class Site
        {
            public MapBlob Map; public MapAnchor Anchor; public int K;
            public List<(int x, int y)> Entrance = new List<(int, int)>(), Door = new List<(int, int)>(), Interior = new List<(int, int)>(), Light = new List<(int, int)>(),
                Camps = new List<(int, int)>(), Between = new List<(int, int)>(), Nave = new List<(int, int)>(), ShrineWalls = new List<(int, int)>(), AllWalls = new List<(int, int)>(),
                Floor = new List<(int, int)>();
            public List<List<(int x, int y)>> Piers = new List<List<(int, int)>>();
        }

        static Site Hall(int k)
        {
            var rows = Orient(Marked(), k);
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 5;
            var s = new Site { K = k };
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x; var t = (FootX + x, FootY + y);
                if (c == '#') { tiles[i] = MapBlob.Wall; s.AllWalls.Add(t); } else s.Floor.Add(t);
                if (c == 'L') { terrain[i] = (byte)TerrainKind.Light; s.Light.Add(t); s.Interior.Add(t); }
                if (c == 'i') s.Interior.Add(t);
                if (c == 'M') s.Entrance.Add(t);
                if (c == 'D') s.Door.Add(t);
                if (c == 'E') s.Camps.Add(t);
                if (c == 'B') s.Between.Add(t);
                if (c == 'V') s.Nave.Add(t);
            }
            var left = new HashSet<(int, int)>(s.AllWalls);
            while (left.Count > 0)
            {
                var first = left.First(); left.Remove(first); var group = new List<(int, int)> { first }; var stack = new Stack<(int, int)>(); stack.Push(first);
                while (stack.Count > 0)
                {
                    var (a, b) = stack.Pop();
                    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++)
                        if (left.Remove((a + dx, b + dy))) { group.Add((a + dx, b + dy)); stack.Push((a + dx, b + dy)); }
                }
                if (group.Count == 9) s.Piers.Add(group); else s.ShrineWalls.AddRange(group);
            }
            double mx = s.Entrance.Average(m => m.x) - (FootX + (Size - 1) / 2.0), my = s.Entrance.Average(m => m.y) - (FootY + (Size - 1) / 2.0);
            byte front = Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12);
            s.Anchor = new MapAnchor(1, MapBlob.AnchorKindHall, new MapTile((ushort)(FootX + 18), (ushort)(FootY + 18)),
                new MapRect(FootX, FootY, Size, Size), front, s.Entrance.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            s.Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            return s;
        }

        // ---- scene helpers ----------------------------------------------------------------------------------------------------

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("hall test root"); public LandmarkView View;
            public Scene(MapBlob map, params MapAnchor[] anchors) { View = LandmarkView.Build(Root.transform, map, anchors); }
            public void Dispose() { if (View != null) View.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }
        static Vector3 TileCentre((int x, int y) t) { return TileCentre(t.x, t.y); }
        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }

        static Landmark Built(Scene scene, string why)
        {
            Assert.That(scene.View.Count, Is.EqualTo(1), why + ": one landmark for the Hall anchor");
            return scene.View.Get(0);
        }

        /// <summary>Whether tile t's centre lies within the bounds, give or take half a tile (art is not pixel-exact on its tiles).</summary>
        static bool Reaches(Bounds b, (int x, int y) t)
        {
            var c = TileCentre(t); b.Expand(new Vector3(1f, ArenaView.GroundSquash, 100f));   // Expand grows each side by half the amount
            return b.Contains(new Vector3(c.x, c.y, b.center.z));
        }

        static IEnumerable<Transform> Named(Landmark lm, string name)
        {
            return lm.Root.GetComponentsInChildren<Transform>(true).Where(t => t.name == name);
        }

        static bool TryBounds(IEnumerable<Transform> objects, out Bounds b)
        {
            b = default; bool any = false;
            foreach (var t in objects) foreach (var r in t.GetComponentsInChildren<Renderer>(true))
            { if (!any) { b = r.bounds; any = true; } else b.Encapsulate(r.bounds); }
            return any;
        }

        static Bounds RoofBounds(Landmark lm)
        {
            Assert.That(lm.RoofRenderers.Length, Is.GreaterThan(0), "the shrine's roof is drawn");
            var all = lm.RoofRenderers[0].bounds; foreach (var r in lm.RoofRenderers) all.Encapsulate(r.bounds);
            return all;
        }

        /// <summary>The foot of the art on the ground: bounds' south edge, in tile units (y grows south).</summary>
        static float FootTileY(Bounds b) { return -b.min.y / ArenaView.GroundSquash; }

        // ---- the framework builds the hall from the tiles ----------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void AHallAnchorBuildsOneLandmarkWhoseOnlyInteriorIsTheShrinesFloor(int k)
        {
            var site = Hall(k);
            Assert.That(LandmarkArts.Has(MapBlob.AnchorKindHall), Is.True, "Hall is registered in LandmarkArts");
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(1), "one landmark object under the parent");
                Assert.That(lm.WallCount, Is.EqualTo(315), "orientation " + k + ": 32 piers x 9 + the shrine's 27");
                Assert.That(lm.InteriorCount, Is.EqualTo(33), "orientation " + k + ": the shrine's floor only; no pier is a building");
                Assert.That(site.Interior.Count, Is.EqualTo(33), "guard on the test map");
                foreach (var t in site.Interior) Assert.That(lm.IsInterior(t.x, t.y), Is.True, "interior tile " + t);
                Assert.That(site.Light.Count, Is.EqualTo(9));
                foreach (var t in site.Light)
                {
                    Assert.That(lm.Terrain(t.x, t.y), Is.EqualTo((byte)TerrainKind.Light), "the healing light is delivered as terrain Light on floor");
                    Assert.That(lm.IsLow(t.x, t.y), Is.False); Assert.That(lm.IsWall(t.x, t.y), Is.False);
                }
                Assert.That(site.Piers.Count, Is.EqualTo(32), "guard on the test map");
                foreach (var t in site.Piers.SelectMany(p => p)) Assert.That(lm.IsInterior(t.x, t.y), Is.False);
            }
        }

        // ---- the columns ---------------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void EveryPierGroupHasExactlyOneColumnObjectStandingOnItAndTheShrineHasNone(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                var columns = Named(lm, ColumnName).ToArray();
                Assert.That(columns.Length, Is.EqualTo(32), "orientation " + k + ": one '" + ColumnName + "' per pier group");
                foreach (var c in columns)
                {
                    Assert.That(c.GetComponentsInChildren<Renderer>(true).Length, Is.GreaterThan(0), "a column is drawn");
                    TryBounds(new[] { c }, out var b);
                    Assert.That(b.size.y, Is.GreaterThan(RegionWalls.WallHeight), "a column stands taller than a wall");
                }
                foreach (var g in site.Piers)
                {
                    int x0 = g.Min(t => t.x), x1 = g.Max(t => t.x) + 1, y0 = g.Min(t => t.y), y1 = g.Max(t => t.y) + 1;
                    int here = 0;
                    foreach (var c in columns)
                    {
                        TryBounds(new[] { c }, out var b);
                        if (b.center.x >= x0 - .5f && b.center.x <= x1 + .5f && FootTileY(b) >= y0 && FootTileY(b) <= y1 + .75f) here++;
                    }
                    Assert.That(here, Is.EqualTo(1), "orientation " + k + ": the pier group at (" + x0 + ", " + y0 + ") has one column");
                }
                int sx0 = site.ShrineWalls.Min(t => t.x), sx1 = site.ShrineWalls.Max(t => t.x) + 1, sy0 = site.ShrineWalls.Min(t => t.y), sy1 = site.ShrineWalls.Max(t => t.y) + 1;
                foreach (var c in columns)
                {
                    TryBounds(new[] { c }, out var b);
                    Assert.That(b.center.x >= sx0 && b.center.x <= sx1 && FootTileY(b) >= sy0 + 1 && FootTileY(b) <= sy1 - 1, Is.False, "no column stands in the shrine");
                }
            }
        }

        // ---- the shrine's roof and cover -----------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheRoofReachesTheShrineAndItsWallsAndNothingOfTheColonnade(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                var roof = RoofBounds(lm);
                foreach (var t in site.Interior) Assert.That(Reaches(roof, t), Is.True, "orientation " + k + ": the roof reaches shrine tile " + t);
                foreach (var t in site.ShrineWalls) Assert.That(Reaches(roof, t), Is.True, "orientation " + k + ": the roof reaches the shrine's wall " + t);
                // Everything of the colonnade at least four tiles from the shrine's box (a raised roof overhangs a little): nave, aisles, camps, piers.
                int x0 = site.ShrineWalls.Min(t => t.x), x1 = site.ShrineWalls.Max(t => t.x), y0 = site.ShrineWalls.Min(t => t.y), y1 = site.ShrineWalls.Max(t => t.y);
                int far = 0;
                foreach (var t in site.Floor.Concat(site.AllWalls))
                {
                    int d = Math.Max(Math.Max(x0 - t.x, t.x - x1), Math.Max(y0 - t.y, t.y - y1));
                    if (d < 4) continue;
                    far++;
                    Assert.That(Reaches(roof, t), Is.False, "orientation " + k + ": no roof over colonnade tile " + t);
                }
                Assert.That(far, Is.GreaterThan(1000), "guard: the negative set is the colonnade");
                foreach (var c in site.Camps) Assert.That(Reaches(roof, c), Is.False, "orientation " + k + ": the camp centre " + c + " stays in view");
                foreach (var t in site.Nave.Concat(site.Between).Concat(site.Entrance)) Assert.That(Reaches(roof, t), Is.False, "orientation " + k + ": no roof over " + t);
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheArtHandsTheLandmarkExactlyTheShrinesInteriorAndWallsAsItsCover(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                var expected = new HashSet<(int, int)>(site.Interior.Concat(site.ShrineWalls));
                Assert.That(expected.Count, Is.EqualTo(33 + 27));
                int covered = 0;
                for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++)
                {
                    Assert.That(lm.RoofCovers(x, y), Is.EqualTo(expected.Contains((x, y))), "orientation " + k + ": cover at (" + x + ", " + y + ")");
                    if (lm.RoofCovers(x, y)) covered++;
                }
                Assert.That(covered, Is.EqualTo(60));
                foreach (var t in site.Door) Assert.That(lm.RoofCovers(t.x, t.y), Is.False, "the door is not under the roof");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheRoofFadesForAnActorInTheShrineAndNotOnTheNaveBetweenPiersAtTheEntranceOrInTheDoor(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k); var v = scene.View;
                v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "nobody inside: opaque");
                var notInside = new List<(string, (int x, int y))> { ("camp", site.Camps[0]), ("camp", site.Camps[1]), ("nave", site.Nave[0]), ("between piers", site.Between[0]),
                    ("between piers", site.Between[1]), ("entrance", site.Entrance[0]), ("entrance middle", site.Entrance[3]), ("door", site.Door[0]), ("door middle", site.Door[1]), ("door end", site.Door[2]) };
                foreach (var (what, t) in notInside)
                {
                    v.NoteActor(TileCentre(t)); v.Tick(10f);
                    Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "orientation " + k + ": an actor at the " + what + " " + t + " does not fade the roof");
                }
                foreach (var t in new[] { site.Interior[0], site.Light[4], site.Interior[site.Interior.Count - 1] })
                {
                    v.NoteActor(TileCentre(t)); v.Tick(10f);
                    Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "orientation " + k + ": an actor on shrine tile " + t + " fades it");
                    v.Tick(10f);
                    Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "and it returns when the actor leaves");
                }
                v.NoteActor(TileCentre(site.Light[4])); v.Tick(10f);
                foreach (var r in lm.RoofRenderers) Assert.That(r.color.a, Is.EqualTo(LandmarkView.RoofFadedAlpha).Within(.001f), "every roof piece carries the alpha");
            }
        }

        // ---- the door and the light ------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheDoorObjectStandsOnTheShrinesThreeDoorTiles(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                Assert.That(site.Door.Count, Is.EqualTo(3));
                Assert.That(TryBounds(Named(lm, DoorName), out var door), Is.True, "orientation " + k + ": door art (objects named '" + DoorName + "' with renderers)");
                foreach (var t in site.Door) Assert.That(Reaches(door, t), Is.True, "orientation " + k + ": the door art spans door tile " + t);
                foreach (var t in site.Entrance) Assert.That(Reaches(door, t), Is.False, "the door art is not the entrance's: " + t);
                float dx = site.Door.Average(t => t.x + .5f), dy = site.Door.Average(t => t.y + .5f);
                Assert.That(Vector2.Distance(new Vector2(door.center.x, FootTileY(door) - .5f), new Vector2(dx, dy)), Is.LessThan(3f), "orientation " + k + ": the art is centred on the door");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheLightObjectLiesOverTheShrinesThreeByThreeLightTiles(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                Assert.That(TryBounds(Named(lm, LightName), out var light), Is.True, "orientation " + k + ": light art (objects named '" + LightName + "' with renderers)");
                foreach (var t in site.Light) Assert.That(Reaches(light, t), Is.True, "orientation " + k + ": the glow spans light tile " + t);
                float lx = site.Light.Average(t => t.x + .5f), ly = site.Light.Average(t => t.y + .5f);
                Assert.That(Vector2.Distance(new Vector2(light.center.x, -light.center.y / ArenaView.GroundSquash), new Vector2(lx, ly)), Is.LessThan(2f), "centred on the light");
                foreach (var t in site.Entrance) Assert.That(Reaches(light, t), Is.False, "the glow is the shrine's, not the entrance's");
            }
        }

        // ---- the entrance ----------------------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheThresholdSpansTheSevenEntranceTilesOnTheSideTheFrontPointsTo(int k)
        {
            var site = Hall(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                Assert.That(site.Entrance.Count, Is.EqualTo(7));
                Assert.That(lm.ArchTiles.Select(t => ((int)t.X, (int)t.Y)).OrderBy(t => t), Is.EqualTo(site.Entrance.OrderBy(t => t)), "the framework's arch is the entrance");
                Assert.That(TryBounds(Named(lm, ThresholdName), out var th), Is.True, "orientation " + k + ": threshold art (objects named '" + ThresholdName + "' with renderers)");
                var ends = site.Entrance.OrderBy(t => t.x + t.y).ToArray();
                Assert.That(Reaches(th, ends[0]) && Reaches(th, ends[ends.Length - 1]), Is.True, "orientation " + k + ": the threshold spans from one end of the entrance to the other");
                var c = new Vector2(FootX + Size / 2f, FootY + Size / 2f);
                Assert.That(Vector2.Dot(new Vector2(th.center.x, FootTileY(th) - .5f) - c, lm.FrontVector), Is.GreaterThan(Size / 2f - 2.5f), "orientation " + k + ": on the edge the front points to");
                foreach (var t in site.Door) Assert.That(Reaches(th, t), Is.False, "the threshold is not the shrine's door: " + t);
            }
        }

        // ---- nothing extra ----------------------------------------------------------------------------------------------------------------

        [Test]
        public void AFrameWhereNothingChangedCreatesAndAllocatesNothing()
        {
            var site = Hall(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Built(scene, "orientation 0");
                var v = scene.View; var inside = TileCentre(site.Light[4]); var outside = TileCentre(site.Camps[0]);
                for (int i = 0; i < 20; i++) { v.NoteActor(inside); v.NoteActor(outside); v.Tick(1f / 60f); }
                int objects = scene.Root.GetComponentsInChildren<Transform>(true).Length;
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) { v.NoteActor(inside); v.NoteActor(outside); v.Tick(1f / 60f); }
                Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.LessThanOrEqualTo(0), "200 unchanged frames allocate nothing");
                Assert.That(scene.Root.GetComponentsInChildren<Transform>(true).Length, Is.EqualTo(objects), "and create no object");
                Assert.That(objects, Is.GreaterThan(32), "the landmark has art objects");
                for (int i = 0; i < 20; i++) v.Tick(1f / 60f);
                before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) v.Tick(1f / 60f);
                Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.LessThanOrEqualTo(0), "200 idle frames at the opaque value");
            }
        }

        [Test]
        public void DisposingTheViewRemovesEverythingTheHallDrew()
        {
            var site = Hall(0);
            var scene = new Scene(site.Map, site.Anchor);
            try
            {
                var lm = Built(scene, "orientation 0");
                Assert.That(lm.Root.GetComponentsInChildren<Renderer>(true).Length, Is.GreaterThan(0), "it drew something");
                scene.View.Dispose();
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(0), "no hall object is left under the parent");
            }
            finally { scene.Dispose(); }
        }
    }
}

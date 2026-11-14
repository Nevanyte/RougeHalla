using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using UnityEngine.TestTools;
using MapRect = Roguehalla.Net.Protocol.MapRect;   // Net.Ui has a MapRect of its own (the map screen's)

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-LANDMARK-SEAMS-1 oracle: three seams of the landmark framework. (1) a builder that throws costs only that landmark; (2) Landmark
    /// reads the collision class and terrain code of its tiles (IsLow, Terrain) and the volcano's lava is "low with terrain Lava", not a flood
    /// fill; (3) an art hands the landmark its cover set (SetCover) which RoofCovers and the fade read. Names and facts:
    /// docs/backlog/packets/P-UNITY-LANDMARK-SEAMS-1.md ("Established facts"). Edits no existing test; the stamping helpers are copies.
    /// </summary>
    public sealed class LandmarkSeamsEditModeTests
    {
        const int N = 48, FootX = 9, FootY = 7, Size = 22, ChurchSize = 29;

        [TearDown] public void ClearArtOverrides() { LandmarkArts.ClearOverrides(); }

        static string[] Blueprint(string name)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/" + name));
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

        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }
        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("seams test root"); public LandmarkView View;
            public Scene(MapBlob map, params MapAnchor[] anchors) { View = LandmarkView.Build(Root.transform, map, anchors); }
            public void Dispose() { if (View != null) View.Dispose(); UnityEngine.Object.DestroyImmediate(Root); }
        }

        // ---- the volcano in a test map -----------------------------------------------------------------------------------------

        /// <summary>The volcano drawing with private marks (all stamped as below): T = a wall tile of the Rim tier (depth over 0.8 of the
        /// largest, the art's tier rule) and K = a neighbour of it turned into lava walled in on all four sides;
        /// F = a wall tile beside a channel turned into floor.</summary>
        static string[] VolcanoMarked(bool cutOff, bool floorBesideChannel)
        {
            var rows = Blueprint("volcano.txt").Select(r => r.ToCharArray()).ToArray();
            int n = rows.Length;
            if (cutOff)
            {
                bool Wall(int x, int y) { return x >= 0 && y >= 0 && x < n && y < n && (rows[y][x] == '#' || rows[y][x] == 'X' || rows[y][x] == 'H'); }
                bool Lava(int x, int y) { return x >= 0 && y >= 0 && x < n && y < n && (rows[y][x] == '~' || rows[y][x] == 'O'); }
                var depth = new float[n * n]; float best = -1;
                for (int y = 0; y < n; y++) for (int x = 0; x < n; x++)
                {
                    if (!Wall(x, y)) continue;
                    float d2 = Mathf.Min(Mathf.Min(x + 1, n - x), Mathf.Min(y + 1, n - y)); d2 *= d2;
                    for (int oy = 0; oy < n; oy++) for (int ox = 0; ox < n; ox++)
                        if (!Wall(ox, oy) && !Lava(ox, oy)) d2 = Mathf.Min(d2, (ox - x) * (ox - x) + (oy - y) * (oy - y));
                    depth[y * n + x] = Mathf.Sqrt(d2); best = Mathf.Max(best, depth[y * n + x]);
                }
                int bx = -1, by = -1, kx = 0, ky = 0;
                for (int y = 0; y < n && bx < 0; y++) for (int x = 0; x < n && bx < 0; x++)
                {
                    if (!Wall(x, y) || depth[y * n + x] <= .8f * best) continue;           // T is a Rim tile of the drawing
                    foreach (var d in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
                    {
                        int qx = x + d.Item1, qy = y + d.Item2;
                        if (Wall(qx, qy) && Wall(qx + 1, qy) && Wall(qx - 1, qy) && Wall(qx, qy + 1) && Wall(qx, qy - 1)) { bx = x; by = y; kx = qx; ky = qy; break; }
                    }
                }
                Assert.That(bx, Is.GreaterThanOrEqualTo(0), "guard: the drawing has a Rim tile with a neighbour walled in on all four sides");
                rows[by][bx] = 'T'; rows[ky][kx] = 'K';
            }
            if (floorBesideChannel)
            {
                Assert.That(rows[19][3], Is.EqualTo('~'), "guard: row 19 column 3 is a channel tile (the left side channel, as row 25 column 7 was in the 30 x 30 drawing)");
                Assert.That(rows[19][2], Is.EqualTo('#'), "guard: the tile west of it is wall");
                rows[19][2] = 'F';
            }
            return rows.Select(r => new string(r)).ToArray();
        }

        sealed class VolcanoSite
        {
            public MapBlob Map; public MapAnchor Anchor;
            public List<(int x, int y)> Lava = new List<(int, int)>();
            public (int x, int y) K, T, F;
        }

        static VolcanoSite Volcano(int k, bool cutOff = false, bool floorBesideChannel = false)
        {
            var rows = Orient(VolcanoMarked(cutOff, floorBesideChannel), k);
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 1;
            var s = new VolcanoSite(); var outlet = new List<(int x, int y)>(); var lake = new List<(int x, int y)>();
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x; var t = (FootX + x, FootY + y);
                if (c == '#' || c == 'X' || c == 'H' || c == 'T') tiles[i] = MapBlob.Wall;
                if (c == '~' || c == 'O' || c == 'K') { tiles[i] = MapBlob.Low; terrain[i] = (byte)TerrainKind.Lava; s.Lava.Add(t); }
                if (c == '~') lake.Add(t);
                if (c == 'O') outlet.Add(t);
                if (c == 'K') s.K = t;
                if (c == 'T') s.T = t;
                if (c == 'F') s.F = t;
            }
            double mx = outlet.Average(m => m.x) - (FootX + (Size - 1) / 2.0), my = outlet.Average(m => m.y) - (FootY + (Size - 1) / 2.0);
            byte front = Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12);
            double cx = lake.Average(l => l.x), cy = lake.Average(l => l.y);
            var centre = lake.OrderBy(l => (l.x - cx) * (l.x - cx) + (l.y - cy) * (l.y - cy)).First();
            s.Anchor = new MapAnchor(1, MapBlob.AnchorKindVolcano, new MapTile((ushort)centre.x, (ushort)centre.y), new MapRect(FootX, FootY, Size, Size), front,
                outlet.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            s.Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            return s;
        }

        // ---- 2. the framework reads the collision class and the terrain code -----------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheLandmarkReportsExactlyTheLavaTilesAsLowWithTerrainLavaInEveryOrientation(int k)
        {
            var site = Volcano(k);
            Assert.That(site.Lava.Count, Is.EqualTo(136), "guard: the approved drawing has 136 lava tiles");
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var lava = new HashSet<(int, int)>(site.Lava); int low = 0;
                for (int y = FootY - 2; y < FootY + Size + 2; y++) for (int x = FootX - 2; x < FootX + Size + 2; x++)
                {
                    bool expect = lava.Contains((x, y));
                    Assert.That(lm.IsLow(x, y), Is.EqualTo(expect), "orientation " + k + ": IsLow at (" + x + ", " + y + ")");
                    Assert.That(lm.Terrain(x, y), Is.EqualTo(expect ? (byte)TerrainKind.Lava : (byte)0), "orientation " + k + ": Terrain at (" + x + ", " + y + ")");
                    if (lm.IsLow(x, y)) { low++; Assert.That(lm.IsWall(x, y), Is.False, "a low tile is not a wall tile"); }
                }
                Assert.That(low, Is.EqualTo(136), "orientation " + k + ": exactly the 136 lava tiles are low");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheVolcanoArtTreatsExactlyTheLowLavaTilesAsLavaInEveryOrientation(int k)
        {
            var site = Volcano(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var art = VolcanoLandmark.ArtOf(scene.View.Get(0)); Assert.That(art, Is.Not.Null);
                var lava = new HashSet<(int, int)>(site.Lava); int n = 0;
                for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++)
                {
                    Assert.That(art.IsLava(x, y), Is.EqualTo(lava.Contains((x, y))), "orientation " + k + ": art lava at (" + x + ", " + y + ")");
                    if (art.IsLava(x, y)) n++;
                }
                Assert.That(n, Is.EqualTo(136));
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void ALavaTileCutOffFromTheLakeByWallsIsLowWithTerrainLavaForTheFramework(int k)
        {
            var site = Volcano(k, cutOff: true);
            Assert.That(site.Lava.Count, Is.EqualTo(137), "guard: the variant has one more lava tile");
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0);
                Assert.That(lm.IsLow(site.K.x, site.K.y), Is.True, "orientation " + k + ": the cut-off tile is low");
                Assert.That(lm.Terrain(site.K.x, site.K.y), Is.EqualTo((byte)TerrainKind.Lava));
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void ALavaTileCutOffFromTheLakeByWallsIsStillLavaForTheArt(int k)
        {
            var site = Volcano(k, cutOff: true);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var art = VolcanoLandmark.ArtOf(scene.View.Get(0)); Assert.That(art, Is.Not.Null);
                Assert.That(art.IsLava(site.K.x, site.K.y), Is.True, "orientation " + k + ": the art treats the cut-off tile as lava (a flood fill from the lake misses it)");
                Assert.That(art.Tier(site.K.x, site.K.y), Is.EqualTo(-1), "a lava tile has no tier");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheWallBesideACutOffLavaTileKeepsItsHeightTier(int k)
        {
            var site = Volcano(k, cutOff: true);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var art = VolcanoLandmark.ArtOf(scene.View.Get(0)); Assert.That(art, Is.Not.Null);
                Assert.That(art.Tier(site.T.x, site.T.y), Is.EqualTo(VolcanoArt.Rim),
                    "orientation " + k + ": a Rim wall tile of the drawing stays Rim when a neighbour is lava walled in (it is not open floor, depth 1 would make it Foot)");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void AFloorTileBesideAChannelIsNotLava(int k)
        {
            var site = Volcano(k, floorBesideChannel: true);
            Assert.That(site.Lava.Count, Is.EqualTo(136));
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var art = VolcanoLandmark.ArtOf(lm); Assert.That(art, Is.Not.Null);
                var f = site.F;
                Assert.That(lm.IsWall(f.x, f.y) || lm.IsLow(f.x, f.y), Is.False, "guard: the tile is floor");
                Assert.That(art.IsLava(f.x, f.y), Is.False, "orientation " + k + ": floor beside a channel is not lava (the flood fill takes it)");
                int n = 0; for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++) if (art.IsLava(x, y)) n++;
                Assert.That(n, Is.EqualTo(136), "orientation " + k + ": the lava is still exactly the 136 low lava tiles");
            }
        }

        // ---- 1. a faulty art -------------------------------------------------------------------------------------------------------

        static MapBlob Open(int n = 40)
        {
            var regions = new byte[n * n];
            for (int i = 0; i < regions.Length; i++) regions[i] = 4;
            return new MapBlob((ushort)n, (ushort)n, new byte[n * n], null, regions);
        }

        static MapAnchor AnchorAt(byte zone, byte kind, int x, int y, int size)
        {
            return new MapAnchor(zone, kind, new MapTile((ushort)(x + size / 2), (ushort)(y + size / 2)), new MapRect((ushort)x, (ushort)y, (ushort)size, (ushort)size), 4, new MapTile[0]);
        }

        [TestCase(true)]
        [TestCase(false)]
        public void ABuilderThatThrowsDrawsNothingLogsOneWarningAndSpoilsNothingElse(bool faultyFirst)
        {
            const byte Faulty = MapBlob.AnchorKindChurch, Good = MapBlob.AnchorKindHall;
            Texture2D owned = null; GameObject stray = null;
            LandmarkArts.SetOverride(Faulty, lm =>
            {
                owned = new Texture2D(2, 2); lm.Own(owned);
                stray = new GameObject("faulty art's piece"); stray.transform.SetParent(lm.Root.transform, false);
                throw new InvalidOperationException("boom from the art");
            });
            LandmarkArts.SetOverride(Good, lm =>
            {
                var go = new GameObject("good art's piece"); go.transform.SetParent(lm.Root.transform, false);
                lm.AddRoofRenderer(go.AddComponent<SpriteRenderer>());
            });
            var bad = AnchorAt(2, Faulty, 2, 2, 6); var good = AnchorAt(5, Good, 12, 12, 20);
            LogAssert.Expect(LogType.Warning, new Regex("LandmarkView: art for kind 2 failed.*boom from the art", RegexOptions.Singleline));
            var root = new GameObject("seams fault root"); LandmarkView view = null; Exception escaped = null;
            try { view = LandmarkView.Build(root.transform, Open(), faultyFirst ? new[] { bad, good } : new[] { good, bad }); }
            catch (Exception e) { escaped = e; }
            try
            {
                Assert.That(escaped, Is.Null, "Build must catch the art's exception; it escaped: " + escaped);
                Assert.That(view.Count, Is.EqualTo(1), "only the healthy landmark is built");
                Assert.That(view.Get(0).Anchor, Is.SameAs(good));
                Assert.That(root.transform.childCount, Is.EqualTo(1), "nothing of the failed landmark is left under the map root");
                Assert.That(root.GetComponentsInChildren<Transform>(true).Any(t => t.name.StartsWith("Landmark kind 2")), Is.False);
                Assert.That(stray == null, Is.True, "the failed art's piece is destroyed");
                Assert.That(owned == null, Is.True, "what the failed art registered with Own is destroyed");
                Assert.That(view.Get(0).Root.transform.parent, Is.EqualTo(root.transform));
                Assert.That(view.Get(0).RoofRenderers.Length, Is.EqualTo(1), "the second landmark's art ran normally");
                Assert.DoesNotThrow(() => { view.NoteActor(TileCentre(20, 20)); view.NoteActor(TileCentre(4, 4)); view.Tick(.1f); }, "the view stays usable");
            }
            finally { if (view != null) view.Dispose(); UnityEngine.Object.DestroyImmediate(root); }
        }

        // ---- 3. an art sets its own cover ----------------------------------------------------------------------------------------

        [Test]
        public void ACoverSetHandedOverIsExactlyWhatRoofCoversAndTheFadeReads()
        {
            const byte Kind = MapBlob.AnchorKindBogTree;
            var cover = new List<(int x, int y)> { (14, 14), (15, 14), (14, 15), (18, 17), (11, 18) };
            LandmarkArts.SetOverride(Kind, lm =>
            {
                lm.SetCover(cover.Select(c => new MapTile((ushort)c.x, (ushort)c.y)));
                var go = new GameObject("canopy"); go.transform.SetParent(lm.Root.transform, false);
                lm.AddRoofRenderer(go.AddComponent<SpriteRenderer>());
            });
            var anchor = AnchorAt(3, Kind, 10, 10, 10);
            using (var scene = new Scene(Open(), anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0); var v = scene.View;
                Assert.That(lm.InteriorCount, Is.EqualTo(0), "guard: open ground has no interior");
                int n = 0;
                for (int y = 8; y < 22; y++) for (int x = 8; x < 22; x++)
                {
                    bool expect = cover.Contains((x, y));
                    Assert.That(lm.RoofCovers(x, y), Is.EqualTo(expect), "RoofCovers at (" + x + ", " + y + ") is exactly the handed-over set");
                    if (lm.RoofCovers(x, y)) n++;
                }
                Assert.That(n, Is.EqualTo(cover.Count));
                Assert.That(lm.IsInterior(14, 14), Is.False, "the cover is not an interior");
                v.Tick(10f); Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha));
                v.NoteActor(TileCentre(19, 19)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "an actor on a non-cover tile of the footprint does not fade the roof");
                v.NoteActor(TileCentre(18, 17)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "an actor on a cover tile (not interior) fades the roof");
                v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "and it returns when the actor leaves");
            }
        }

        // ---- the church passes its building as the cover -----------------------------------------------------------------------------

        static string[] ChurchMarked()
        {
            var rows = Blueprint("church.txt").Select(r => r.ToCharArray()).ToArray();
            for (int x = 12; x <= 16; x++) rows[28][x] = 'M';
            for (int y = 4; y <= 15; y++) for (int x = 4; x <= 24; x++) if (rows[y][x] == '.') rows[y][x] = 'i';
            return rows.Select(r => new string(r)).ToArray();
        }

        sealed class ChurchSite
        {
            public MapBlob Map; public MapAnchor Anchor;
            public HashSet<(int, int)> Cover = new HashSet<(int, int)>(), Headstones = new HashSet<(int, int)>();
        }

        static ChurchSite Church(int k)
        {
            var rows = Orient(ChurchMarked(), k);
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 2;
            var s = new ChurchSite(); var gate = new List<(int x, int y)>(); (int x, int y) camp = (0, 0);
            for (int y = 0; y < ChurchSize; y++) for (int x = 0; x < ChurchSize; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x; var t = (FootX + x, FootY + y);
                if (c == '#' || c == 'P') { tiles[i] = MapBlob.Wall; s.Cover.Add(t); }
                if (c == 'G') { tiles[i] = MapBlob.Wall; s.Headstones.Add(t); }
                if (c == '+') { tiles[i] = MapBlob.Low; terrain[i] = (byte)TerrainKind.Fence; }
                if (c == 'M') gate.Add(t);
                if (c == 'i' || c == 'E') s.Cover.Add(t);
                if (c == 'E') camp = t;
            }
            double mx = gate.Average(m => m.x) - (FootX + (ChurchSize - 1) / 2.0), my = gate.Average(m => m.y) - (FootY + (ChurchSize - 1) / 2.0);
            byte front = Math.Abs(mx) > Math.Abs(my) ? (byte)(mx > 0 ? 0 : 8) : (byte)(my > 0 ? 4 : 12);
            s.Anchor = new MapAnchor(2, MapBlob.AnchorKindChurch, new MapTile((ushort)camp.x, (ushort)camp.y), new MapRect(FootX, FootY, ChurchSize, ChurchSize), front,
                gate.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            s.Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            return s;
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheChurchsRoofCoversItsBuildingsInteriorWallsAndPillarsAndNoHeadstone(int k)
        {
            var site = Church(k);
            Assert.That(site.Headstones.Count, Is.EqualTo(24), "guard: 24 headstone tiles");
            Assert.That(site.Cover.Count, Is.EqualTo(204 + 115), "guard: 204 interior tiles + 115 building wall and pillar tiles");
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
                var lm = scene.View.Get(0);
                foreach (var t in site.Headstones) Assert.That(lm.RoofCovers(t.Item1, t.Item2), Is.False, "orientation " + k + ": headstone " + t + " is not under the roof");
                int n = 0;
                for (int y = FootY; y < FootY + ChurchSize; y++) for (int x = FootX; x < FootX + ChurchSize; x++)
                {
                    Assert.That(lm.RoofCovers(x, y), Is.EqualTo(site.Cover.Contains((x, y))), "orientation " + k + ": RoofCovers at (" + x + ", " + y + ")");
                    if (lm.RoofCovers(x, y)) n++;
                }
                Assert.That(n, Is.EqualTo(319));
            }
        }

        // ---- guard: the cave is unchanged ------------------------------------------------------------------------------------------------

        [Test]
        public void TheCavesCoverIsStillItsInteriorAndItsWallsAndTheFadeStillReadsTheInterior()
        {
            var rows = Blueprint("cave.txt"); const int Cs = 29;
            var tiles = new byte[N * N]; var regions = new byte[N * N]; var mouth = new List<(int x, int y)>(); (int x, int y) camp = (0, 0);
            for (int i = 0; i < regions.Length; i++) regions[i] = 4;
            for (int y = 0; y < Cs; y++) for (int x = 0; x < Cs; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x;
                if (c == '#' || c == 'R') tiles[i] = MapBlob.Wall;
                if (c == 'D') mouth.Add((FootX + x, FootY + y));
                if (c == 'E') camp = (FootX + x, FootY + y);
            }
            var anchor = new MapAnchor(4, MapBlob.AnchorKindCave, new MapTile((ushort)camp.x, (ushort)camp.y), new MapRect(FootX, FootY, Cs, Cs), 4,
                mouth.Select(m => new MapTile((ushort)m.x, (ushort)m.y)).ToArray());
            var map = new MapBlob(N, N, tiles, new byte[N * N], regions, MapBlob.GroundTerrainAll);
            using (var scene = new Scene(map, anchor))
            {
                Assert.That(scene.View.Count, Is.EqualTo(1));
                var lm = scene.View.Get(0); var v = scene.View;
                var flags = LandmarkInterior.Find(map.Tiles, N, N, anchor.Footprint, anchor.Entrance);
                for (int y = 0; y < Cs; y++) for (int x = 0; x < Cs; x++)
                {
                    bool expect = flags[y * Cs + x] || lm.IsWall(FootX + x, FootY + y);
                    Assert.That(lm.RoofCovers(FootX + x, FootY + y), Is.EqualTo(expect), "cave cover at (" + (FootX + x) + ", " + (FootY + y) + ")");
                }
                v.NoteActor(TileCentre(camp.x, camp.y)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "an actor in the chamber fades the cave's roof");
                v.NoteActor(TileCentre(mouth[1].x, mouth[1].y)); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "the mouth does not");
            }
        }
    }
}

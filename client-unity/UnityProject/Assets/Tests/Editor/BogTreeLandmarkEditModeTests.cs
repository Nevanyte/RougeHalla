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
    /// P-UNITY-LANDMARK-4 oracle, Unity half: a map whose anchors name a BogTree gets one landmark whose art is derived from the TILES inside
    /// the anchor's footprint (the approved drawing docs/landmarks/blueprints/bog.txt is stamped into a test map in each of the eight
    /// orientations: T and r wall; % floor with terrain Bog; : and . plain floor). Only structure is pinned. THE COVER RULE (also guarded
    /// engine-free in BogTreeLandmarkDrawingTests): the trunk is the largest 8-connected group of wall tiles (its roots belong to it); the
    /// cover is the trunk group's own tiles plus every non-bog floor tile of the footprint whose centre is within EUCLIDEAN distance 3
    /// (dx*dx + dy*dy &lt;= 9) of a trunk-group tile's centre: 275 tiles in every orientation. The art hands it over with Landmark.SetCover. The
    /// canopy is the roof (AddRoofRenderer). Art objects, descendants of Landmark.Root, are named "Bog tree trunk" (one) and "Bog tree stump"
    /// (one per free root stump). See docs/backlog/packets/P-UNITY-LANDMARK-4.md, "Established facts".
    /// </summary>
    public sealed class BogTreeLandmarkEditModeTests
    {
        const string TrunkName = "Bog tree trunk", StumpName = "Bog tree stump";
        const int N = 48, FootX = 9, FootY = 7, Size = 29, CoverRadiusSquared = 9;

        static string[] BogRows()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/landmarks/blueprints/bog.txt"));
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

        /// <summary>The generator's anchor (agreed with the map generator session): centre = the trunk's centre, drawing tile (14, 14); entrance =
        /// the six causeway tiles on the box's edge (12,0) (13,0) (0,11) (0,12) (13,28) (14,28). Marked before orienting: 'c' the centre (a trunk
        /// wall tile), 'e' an entrance tile (a causeway floor tile).</summary>
        static string[] Marked()
        {
            var rows = BogRows().Select(r => r.ToCharArray()).ToArray();
            Assert.That(rows[14][14], Is.EqualTo('T'), "guard: the trunk's centre is a trunk tile"); rows[14][14] = 'c';
            foreach (var (x, y) in new[] { (12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28) })
            { Assert.That(rows[y][x], Is.EqualTo(':'), "guard: entrance (" + x + ", " + y + ") is a causeway tile"); rows[y][x] = 'e'; }
            return rows.Select(r => new string(r)).ToArray();
        }

        sealed class Site
        {
            public MapBlob Map; public MapAnchor Anchor; public int K;
            public List<(int x, int y)> Entrance; public (int x, int y) Centre;
            public HashSet<(int x, int y)> Walls = new HashSet<(int, int)>(), Bog = new HashSet<(int, int)>(), Cover = new HashSet<(int, int)>();
            public List<(int x, int y)> Trunk = new List<(int, int)>(), Floor = new List<(int, int)>();
            public List<List<(int x, int y)>> Stumps = new List<List<(int, int)>>();
            /// <summary>Floor tiles of the footprint that are not in the cover, split by what they are.</summary>
            public List<(int x, int y)> DryCover = new List<(int, int)>(), CausewayCover = new List<(int, int)>(), CausewayBeyond = new List<(int, int)>(),
                DryOutside = new List<(int, int)>();
        }

        static Site Bog(int k)
        {
            var rows = Orient(Marked(), k); var entrance = new List<(int x, int y)>(); (int x, int y) centre = (0, 0);
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 3;
            var s = new Site { K = k }; var causeway = new HashSet<(int, int)>();
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (FootY + y) * N + FootX + x; var t = (FootX + x, FootY + y);
                if (c == 'e') { entrance.Add(t); c = ':'; }
                if (c == 'c') { centre = t; c = 'T'; }
                if (c == 'T' || c == 'r') { tiles[i] = MapBlob.Wall; s.Walls.Add(t); }
                else
                {
                    s.Floor.Add(t);
                    if (c == '%') { terrain[i] = (byte)TerrainKind.Bog; s.Bog.Add(t); }
                    if (c == ':') causeway.Add(t);
                }
            }
            var left = new HashSet<(int, int)>(s.Walls); var groups = new List<List<(int x, int y)>>();
            while (left.Count > 0)
            {
                var first = left.OrderBy(t => t).First(); left.Remove(first); var g = new List<(int x, int y)> { first }; var st = new Stack<(int, int)>(); st.Push(first);
                while (st.Count > 0) { var (a, b) = st.Pop(); for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) if (left.Remove((a + dx, b + dy))) { g.Add((a + dx, b + dy)); st.Push((a + dx, b + dy)); } }
                groups.Add(g);
            }
            groups = groups.OrderByDescending(g => g.Count).ToList();
            s.Trunk = groups[0]; s.Stumps = groups.Skip(1).ToList();
            foreach (var t in s.Trunk) s.Cover.Add(t);
            foreach (var t in s.Floor)
                if (!s.Bog.Contains(t) && s.Trunk.Any(w => (w.x - t.x) * (w.x - t.x) + (w.y - t.y) * (w.y - t.y) <= CoverRadiusSquared)) s.Cover.Add(t);
            foreach (var t in s.Floor)
            {
                if (s.Bog.Contains(t)) continue;
                bool inCover = s.Cover.Contains(t), isCauseway = causeway.Contains(t);
                (inCover ? (isCauseway ? s.CausewayCover : s.DryCover) : (isCauseway ? s.CausewayBeyond : s.DryOutside)).Add(t);
            }
            s.Anchor = new MapAnchor(3, MapBlob.AnchorKindBogTree, new MapTile((ushort)centre.x, (ushort)centre.y), new MapRect(FootX, FootY, Size, Size), 4,
                entrance.Select(e => new MapTile((ushort)e.x, (ushort)e.y)).ToArray());
            s.Entrance = entrance; s.Centre = centre;
            s.Map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            return s;
        }

        // ---- scene helpers ----------------------------------------------------------------------------------------------------

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("bog test root"); public LandmarkView View;
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
        static Vector3 TileCentre((int x, int y) t) { return TileCentre(t.x, t.y); }
        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }

        static Landmark Built(Scene scene, string why)
        {
            Assert.That(scene.View.Count, Is.EqualTo(1), why + ": one landmark for the BogTree anchor");
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
            Assert.That(lm.RoofRenderers.Length, Is.GreaterThan(0), "the canopy is drawn (a roof renderer)");
            var all = lm.RoofRenderers[0].bounds; foreach (var r in lm.RoofRenderers) all.Encapsulate(r.bounds);
            foreach (var r in lm.GroundRenderers) all.Encapsulate(r.bounds);   // P-UNITY-BOG-TREE-3 (coordinator-approved): the ground shadow is no roof piece
            return all;
        }

        /// <summary>Alpha of what the sprite renderer paints at a world point (0 when the point is outside its sprite). Needs a readable texture
        /// (the landmark arts paint procedural Texture2Ds). Flipped sprites are not handled.</summary>
        static float AlphaAt(SpriteRenderer r, Vector3 world)
        {
            var s = r.sprite; if (s == null || !r.enabled) return 0f;
            var local = r.transform.InverseTransformPoint(world); var rect = s.textureRect;
            float px = local.x * s.pixelsPerUnit + s.pivot.x, py = local.y * s.pixelsPerUnit + s.pivot.y;
            if (px < 0 || py < 0 || px >= rect.width || py >= rect.height) return 0f;
            return s.texture.GetPixel((int)(rect.x + px), (int)(rect.y + py)).a * r.color.a;
        }

        // ---- the framework builds the bog tree from the tiles --------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void ABogTreeAnchorBuildsOneLandmarkClassifiedFromTheTilesInEveryOrientation(int k)
        {
            var site = Bog(k);
            Assert.That(LandmarkArts.Has(MapBlob.AnchorKindBogTree), Is.True, "BogTree is registered in LandmarkArts");
            Assert.That(LandmarkArts.TryGet(MapBlob.AnchorKindBogTree, out var builder), Is.True);
            Assert.That(builder, Is.EqualTo((LandmarkArtBuilder)BogTreeLandmark.Build), "the registered art is BogTreeLandmark.Build");
            using (var logs = new Logs())
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(1), "one landmark object under the parent");
                Assert.That(lm.Root.transform.parent, Is.EqualTo(scene.Root.transform));
                Assert.That(lm.WallCount, Is.EqualTo(155), "orientation " + k + ": 93 trunk + 62 root tiles");
                Assert.That(lm.IceCount, Is.EqualTo(0));
                Assert.That(lm.InteriorCount, Is.EqualTo(0), "orientation " + k + ": the tree encloses no floor");
                Assert.That(logs.Count("LandmarkView: no art"), Is.EqualTo(0));
                Assert.That(site.Trunk.Count, Is.EqualTo(137), "guard on the test map"); Assert.That(site.Stumps.Count, Is.EqualTo(3));
                Assert.That(site.Cover.Count, Is.EqualTo(275), "guard on the test map: the cover rule");
                Assert.That(site.Bog.Count, Is.EqualTo(213));
                Assert.That(site.Entrance.Count, Is.EqualTo(6));
                Assert.That(lm.ArchTiles.Select(t => ((int)t.X, (int)t.Y)).OrderBy(t => t), Is.EqualTo(site.Entrance.OrderBy(t => t)), "the framework's ArchTiles are the six entrance tiles");
                Assert.That(site.Entrance.All(e => e.x == FootX || e.x == FootX + Size - 1 || e.y == FootY || e.y == FootY + Size - 1), Is.True, "the entrance is on the box's edge");
                Assert.That(site.Trunk.Contains(site.Centre), Is.True, "the anchor's centre is a trunk tile");
                // The bog is floor with terrain Bog, as the framework reads it.
                foreach (var t in site.Bog)
                {
                    Assert.That(lm.IsWall(t.x, t.y) || lm.IsLow(t.x, t.y), Is.False, "bog is floor");
                    Assert.That(lm.Terrain(t.x, t.y), Is.EqualTo((byte)TerrainKind.Bog));
                }
            }
        }

        // ---- the cover and the canopy -------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void TheCanopysCoverIsExactlyTheTrunkGroupAndTheDryGroundWithinThreeTilesOfIt(int k)
        {
            var site = Bog(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k); int n = 0;
                for (int y = FootY - 3; y < FootY + Size + 3; y++) for (int x = FootX - 3; x < FootX + Size + 3; x++)
                {
                    Assert.That(lm.RoofCovers(x, y), Is.EqualTo(site.Cover.Contains((x, y))), "orientation " + k + ": RoofCovers at (" + x + ", " + y + ")");
                    if (lm.RoofCovers(x, y)) n++;
                }
                Assert.That(n, Is.EqualTo(275), "orientation " + k);
                foreach (var t in site.Bog) Assert.That(lm.RoofCovers(t.x, t.y), Is.False, "no bog tile is covered: " + t);
                foreach (var t in site.CausewayBeyond) Assert.That(lm.RoofCovers(t.x, t.y), Is.False, "a causeway tile beyond the ring is not covered: " + t);
                foreach (var g in site.Stumps) foreach (var t in g) Assert.That(lm.RoofCovers(t.x, t.y), Is.False, "a free stump is not under the canopy: " + t);
                Assert.That(site.DryCover.Count, Is.EqualTo(120)); Assert.That(site.CausewayCover.Count, Is.EqualTo(18)); Assert.That(site.CausewayBeyond.Count, Is.EqualTo(44));
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheCanopyIsDrawnOverEveryCoverTileAndNoTileOutsideTheFootprintAndSortsUnderTheFog(int k)
        {
            var site = Bog(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k); var roof = RoofBounds(lm);
                foreach (var t in site.Cover) Assert.That(Reaches(roof, t), Is.True, "orientation " + k + ": the drawn canopy reaches cover tile " + t);
                for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                {
                    if (x >= FootX && x < FootX + Size && y >= FootY && y < FootY + Size) continue;
                    var c = TileCentre(x, y);
                    Assert.That(roof.Contains(new Vector3(c.x, c.y, roof.center.z)), Is.False, "orientation " + k + ": the canopy must not reach (" + x + ", " + y + "), outside the footprint");
                }
                int edge = 2000 + (FootY + Size) * 16;
                Assert.That(lm.RoofOrder, Is.InRange(edge, edge + 15));
                Assert.That(lm.RoofRenderers.All(r => r.sortingOrder == lm.RoofOrder), Is.True, "every canopy piece on the roof order");
                Assert.That(lm.RoofOrder, Is.LessThan(VisionFog.SortingOrder), "under the fog");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheCanopyFadesForAnActorOnTheDryGroundRoundTheTrunkAndNotOnACausewayBeyondItOrInTheBog(int k)
        {
            var site = Bog(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k); var v = scene.View;
                v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "nobody under it: opaque");
                Assert.That(site.DryOutside.Count, Is.GreaterThan(0), "guard: the drawing has dry ground beyond the ring");
                var notUnder = new List<(string, (int x, int y))> { ("bog", site.Bog.First()), ("bog (last)", site.Bog.Last()), ("causeway beyond the ring", site.CausewayBeyond[0]),
                    ("causeway beyond the ring (last)", site.CausewayBeyond[site.CausewayBeyond.Count - 1]), ("dry ground beyond the ring", site.DryOutside[0]) };
                foreach (var (what, t) in notUnder)
                {
                    v.NoteActor(TileCentre(t)); v.Tick(10f);
                    Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "orientation " + k + ": an actor at the " + what + " " + t + " does not fade the canopy");
                }
                var under = new List<(string, (int x, int y))> { ("dry ground", site.DryCover[0]), ("dry ground (last)", site.DryCover[site.DryCover.Count - 1]),
                    ("causeway inside the ring", site.CausewayCover[0]), ("causeway inside the ring (last)", site.CausewayCover[site.CausewayCover.Count - 1]) };
                foreach (var (what, t) in under)
                {
                    v.NoteActor(TileCentre(t)); v.Tick(10f);
                    Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofFadedAlpha), "orientation " + k + ": an actor on " + what + " " + t + " fades it");
                    v.Tick(10f);
                    Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofOpaqueAlpha), "and it returns when the actor leaves");
                }
                v.NoteActor(TileCentre(site.DryCover[0])); v.Tick(10f);
                foreach (var r in lm.RoofRenderers) Assert.That(r.color.a, Is.EqualTo(LandmarkView.RoofFadedAlpha).Within(.001f), "every canopy piece carries the alpha");
                // Owner ruling 2026-11-13: a visible actor under the canopy makes it peek while the local player stands in the bog.
                v.Tick(10f);
                v.NoteActor(TileCentre(site.Bog.First())); v.NoteOtherActor(TileCentre(site.DryCover[0])); v.Tick(10f);
                Assert.That(lm.RoofAlpha, Is.EqualTo(LandmarkView.RoofPeekAlpha));
            }
        }

        // ---- the trunk and the stumps ----------------------------------------------------------------------------------------------------

        [TestCaseSource(nameof(Orientations))]
        public void OneTrunkObjectSpansEveryTileOfTheTrunkGroupAndNotTheFreeStumps(int k)
        {
            var site = Bog(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                var trunk = Named(lm, TrunkName).ToArray();
                Assert.That(trunk.Length, Is.EqualTo(1), "orientation " + k + ": one '" + TrunkName + "'");
                Assert.That(TryBounds(trunk, out var b), Is.True, "the trunk is drawn (a renderer under the object)");
                foreach (var t in site.Trunk) Assert.That(Reaches(b, t), Is.True, "orientation " + k + ": the trunk art spans trunk-group tile " + t);
                foreach (var g in site.Stumps) foreach (var t in g) Assert.That(Reaches(b, t), Is.False, "orientation " + k + ": the trunk art is not a free stump's: " + t);
                Assert.That(lm.RoofRenderers.Any(r => r.transform.IsChildOf(trunk[0])), Is.False, "the bark is not part of the canopy that fades");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void EveryFreeRootStumpHasExactlyOneStumpObject(int k)
        {
            var site = Bog(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                var stumps = Named(lm, StumpName).ToArray();
                Assert.That(site.Stumps.Count, Is.EqualTo(3), "guard on the test map: three free stumps of six tiles");
                Assert.That(stumps.Length, Is.EqualTo(3), "orientation " + k + ": one '" + StumpName + "' per free stump");
                foreach (var s in stumps) Assert.That(s.GetComponentsInChildren<Renderer>(true).Length, Is.GreaterThan(0), "a stump is drawn");
                foreach (var g in site.Stumps)
                {
                    Assert.That(g.Count, Is.EqualTo(6));
                    int x0 = g.Min(t => t.x), x1 = g.Max(t => t.x) + 1, y0 = g.Min(t => t.y), y1 = g.Max(t => t.y) + 1; var here = new List<Transform>();
                    foreach (var s in stumps)
                    {
                        TryBounds(new[] { s }, out var b); float bx = b.center.x, by = -b.center.y / ArenaView.GroundSquash;
                        if (bx >= x0 - .5f && bx <= x1 + .5f && by >= y0 - .5f && by <= y1 + .5f) here.Add(s);
                    }
                    Assert.That(here.Count, Is.EqualTo(1), "orientation " + k + ": the stump at (" + x0 + ", " + y0 + ") has one stump object");
                    TryBounds(here, out var sb);
                    foreach (var t in g) Assert.That(Reaches(sb, t), Is.True, "orientation " + k + ": the stump art spans its tile " + t);
                }
            }
        }

        // ---- the marsh stays readable -----------------------------------------------------------------------------------------------------

        [Test]
        public void TheAlphaSamplerTheMarshTestUsesReadsTheSpritePixelUnderAWorldPoint()
        {
            // Guard on this file's helper: a 4 x 4 sprite, pivot in the middle, 4 pixels per unit, one opaque pixel at (1, 2).
            var tex = new Texture2D(4, 4, TextureFormat.RGBA32, false); var clear = new Color32[16]; clear[2 * 4 + 1] = new Color32(255, 255, 255, 255);
            tex.SetPixels32(clear); tex.Apply();
            var sprite = Sprite.Create(tex, new Rect(0, 0, 4, 4), new Vector2(.5f, .5f), 4f);
            var go = new GameObject("sampler guard"); var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = sprite;
            try
            {
                go.transform.position = new Vector3(10, 20, 0);
                Assert.That(AlphaAt(sr, new Vector3(9.875f, 20.125f, 0)), Is.EqualTo(1f), "the opaque pixel's centre");
                Assert.That(AlphaAt(sr, new Vector3(10.125f, 20.125f, 0)), Is.EqualTo(0f), "its neighbour");
                Assert.That(AlphaAt(sr, new Vector3(30f, 20.125f, 0)), Is.EqualTo(0f), "outside the sprite");
                go.transform.localScale = new Vector3(2, 2, 1);
                Assert.That(AlphaAt(sr, new Vector3(9.75f, 20.25f, 0)), Is.EqualTo(1f), "scaled by two");
            }
            finally { UnityEngine.Object.DestroyImmediate(go); UnityEngine.Object.DestroyImmediate(sprite); UnityEngine.Object.DestroyImmediate(tex); }
        }

        [TestCaseSource(nameof(Orientations))]
        public void NothingButTheCanopyPaintsOpaquelyOnTheMarshOrTheGroundFarFromTheTreesWood(int k)
        {
            // "Far" = no wall tile of the footprint within 2 tiles (Chebyshev), so the height of bark cannot reach it. The canopy is excluded:
            // it may overhang; the bog and the causeways themselves stay the ground art (nothing that could pass for dry ground over the bog).
            var site = Bog(k);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                var lm = Built(scene, "orientation " + k);
                var art = lm.Root.GetComponentsInChildren<SpriteRenderer>(true).Where(r => !lm.RoofRenderers.Contains(r)).ToArray();
                Assert.That(art.Length, Is.GreaterThan(0), "the bark and the stumps are drawn by sprite renderers");
                var far = site.Floor.Where(t => !site.Cover.Contains(t) && !site.Walls.Any(w => Math.Max(Math.Abs(w.x - t.x), Math.Abs(w.y - t.y)) <= 2)).ToList();
                Assert.That(far.Count(t => site.Bog.Contains(t)), Is.GreaterThan(40), "guard: plenty of open bog tiles are sampled");
                foreach (var t in far) foreach (var r in art)
                    Assert.That(AlphaAt(r, TileCentre(t)), Is.LessThan(.5f), "orientation " + k + ": '" + r.name + "' paints opaquely on open ground " + t + (site.Bog.Contains(t) ? " (bog)" : ""));
            }
        }

        // ---- nothing extra ----------------------------------------------------------------------------------------------------------------

        [Test]
        public void AFrameWhereNothingChangedCreatesAndAllocatesNothing()
        {
            var site = Bog(0);
            using (var scene = new Scene(site.Map, site.Anchor))
            {
                Built(scene, "orientation 0");
                var v = scene.View; var inside = TileCentre(site.DryCover[0]); var outside = TileCentre(site.Bog.First());
                for (int i = 0; i < 20; i++) { v.NoteActor(inside); v.NoteActor(outside); v.Tick(1f / 60f); }
                int objects = scene.Root.GetComponentsInChildren<Transform>(true).Length;
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) { v.NoteActor(inside); v.NoteActor(outside); v.Tick(1f / 60f); }
                Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.LessThanOrEqualTo(0), "200 unchanged frames allocate nothing");
                Assert.That(scene.Root.GetComponentsInChildren<Transform>(true).Length, Is.EqualTo(objects), "and create no object");
                Assert.That(objects, Is.GreaterThan(4), "the landmark has art objects");
                for (int i = 0; i < 20; i++) v.Tick(1f / 60f);
                before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 200; i++) v.Tick(1f / 60f);
                Assert.That(GC.GetAllocatedBytesForCurrentThread() - before, Is.LessThanOrEqualTo(0), "200 idle frames at the opaque value");
            }
        }

        [Test]
        public void DisposingTheViewRemovesEverythingTheBogTreeDrew()
        {
            var site = Bog(0);
            var scene = new Scene(site.Map, site.Anchor);
            try
            {
                var lm = Built(scene, "orientation 0");
                Assert.That(lm.Root.GetComponentsInChildren<Renderer>(true).Length, Is.GreaterThan(0), "it drew something");
                scene.View.Dispose();
                Assert.That(scene.Root.transform.childCount, Is.EqualTo(0), "no bog tree object is left under the parent");
            }
            finally { scene.Dispose(); }
        }
    }
}

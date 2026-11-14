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
    /// P-UNITY-BOG-TREE-2 oracle (docs/backlog/packets/P-UNITY-BOG-TREE-2.md). Two parts.
    /// (1) A landmark's fade set may be wider than its cover: Landmark.SetFadeTiles. Tested on a church-kind override (cover and fade set
    ///     handed over by hand) and guarded on the cave (no fade set: the fade is the cover, as today).
    /// (2) The bog tree is a lifted crown on a visible trunk, measured on the bounds and pixels of what BogTreeLandmark paints. These are
    ///     floors that stop a regression to "a mid-dark green mass on the ground"; the renders (docs/unity/LOOK_CHECK.md) decide the look.
    ///     The crown is the sprite named BogTreeLandmark.CrownName (also a roof renderer); the trunk is every renderer under the object
    ///     named "Bog tree trunk" (BogTreeLandmark.TrunkName).
    /// </summary>
    public sealed class BogTreeCrownEditModeTests
    {
        const int N = 48, FootX = 9, FootY = 7, Size = 29;
        const float Sq = ArenaView.GroundSquash;

        /// <summary>The crown's bottom edge must sit this far (world units) above the trunk bounds' vertical midpoint: a quarter of today's bole
        /// above the roots (BoleH 1.75 - RootH .72 = 1.03), so a lift you can see and not rounding.</summary>
        const float LiftMargin = .25f;
        /// <summary>The share of the trunk's height (top minus bottom of its bounds) that must show below the crown's bottom edge.</summary>
        const float VisibleShare = .40f;
        /// <summary>The share of the crown's opaque bounding box that must be transparent AND enclosed (opaque pixels left, right, above and below).</summary>
        const float GapShare = .05f;
        /// <summary>...and the share of that box the crown still paints opaquely, so it is a crown with gaps and not a few specks.</summary>
        const float MinOpaqueShare = .25f;
        /// <summary>Green hue band in degrees (HSV hue of the trunk's mean colour): the trunk must lie outside it.</summary>
        const float GreenFrom = 70f, GreenTo = 170f;
        /// <summary>The Plague grass as the Web client shows it (LOOK_CHECK.md "Known differences": 104, 132, 77), and the least ratio of the
        /// crown's lit colour luminance to it.</summary>
        static readonly Color32 WebGrass = new Color32(104, 132, 77, 255);
        const float CrownOverGrass = 2.5f;

        [TearDown] public void ClearArtOverrides() { LandmarkArts.ClearOverrides(); }

        static Vector3 TileCentre(int x, int y) { return ArenaView.WorldPoint((x + .5f) * 32f, (y + .5f) * 32f); }

        sealed class Scene : IDisposable
        {
            public readonly GameObject Root = new GameObject("bog crown test root"); public LandmarkView View;
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

        // ---- (1) the fade set -------------------------------------------------------------------------------------------------------------

        // A church-kind override with a hand-made cover; the footprint is tiles 10..19 in both axes.
        static readonly (int x, int y)[] Cover = { (14, 14), (15, 14), (14, 15), (18, 17), (11, 18) };
        static readonly (int x, int y)[] FadeOnly = { (12, 11), (16, 12), (13, 16) };    // in the footprint, not in the cover
        static readonly (int x, int y)[] Neither = { (19, 19), (10, 10), (17, 11) };

        static Scene ChurchScene(bool withFadeSet)
        {
            const byte Kind = MapBlob.AnchorKindChurch;
            LandmarkArts.SetOverride(Kind, lm =>
            {
                lm.SetCover(Cover.Select(c => new MapTile((ushort)c.x, (ushort)c.y)));
                if (withFadeSet)
                    lm.SetFadeTiles(Cover.Concat(FadeOnly).Select(c => new MapTile((ushort)c.x, (ushort)c.y)));
                var go = new GameObject("roof"); go.transform.SetParent(lm.Root.transform, false);
                lm.AddRoofRenderer(go.AddComponent<SpriteRenderer>());
            });
            var regions = new byte[40 * 40];
            for (int i = 0; i < regions.Length; i++) regions[i] = 2;
            var map = new MapBlob(40, 40, new byte[40 * 40], null, regions);
            var anchor = new MapAnchor(2, Kind, new MapTile(15, 15), new MapRect(10, 10, 10, 10), 4, new MapTile[0]);
            var scene = new Scene(map, anchor);
            Assert.That(scene.View.Count, Is.EqualTo(1), "needs the landmark first");
            return scene;
        }

        [Test]
        public void AFadeSetWiderThanTheCoverFadesTheRoofForAnActorOnItsOutsideTilesAndRoofCoversStaysTheCover()
        {
            using (var scene = ChurchScene(true))
            {
                var lm = scene.View.Get(0);
                foreach (var t in FadeOnly)
                {
                    Assert.That(lm.RoofCovers(t.x, t.y), Is.False, t + ": RoofCovers is the cover, not the fade set");
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), t + ": the local player on a fade-only tile fades the roof");
                    Assert.That(Settle(scene, null), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), t + ": and it returns when they leave");
                    Assert.That(Settle(scene, null, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofPeekAlpha), t + ": another visible actor on it makes the roof peek");
                    Settle(scene, null);
                }
                foreach (var t in Cover)
                {
                    Assert.That(lm.RoofCovers(t.x, t.y), Is.True, t + ": still covered");
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), t + ": a cover tile in the fade set still fades");
                    Settle(scene, null);
                }
                foreach (var t in Neither)
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), t + ": in neither set: opaque");
            }
        }

        [Test]
        public void WithoutAFadeSetTheFadeIsTheCoverOnTheChurchOverride()
        {
            using (var scene = ChurchScene(false))
            {
                foreach (var t in Cover)
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), t + ": a cover tile fades");
                foreach (var t in FadeOnly.Concat(Neither))
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofOpaqueAlpha), t + ": outside the cover: opaque");
            }
        }

        /// <summary>Guard (green today). The cave never hands over a cover or a fade set. Its fade is the interior, which is what RoofCovers reports on
        /// every tile an actor can stand on. (On the cave's WALL tiles RoofCovers is true and the fade is not: the brief's "Fades equals the cover"
        /// held only for floor tiles; no actor stands on a wall, so the guard reads the floor.)</summary>
        [Test]
        public void WithoutAFadeSetTheCaveFadesExactlyWhereRoofCoversOnEveryFloorTile()
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
                Assert.That(scene.View.Count, Is.EqualTo(1), "the cave landmark");
                var lm = scene.View.Get(0); int covered = 0;
                for (int y = FootY; y < FootY + Size; y++) for (int x = FootX; x < FootX + Size; x++)
                {
                    if (tiles[y * N + x] == MapBlob.Wall) continue;
                    bool covers = lm.RoofCovers(x, y); if (covers) covered++;
                    float a = Settle(scene, TileCentre(x, y)); Settle(scene, null);
                    Assert.That(a, Is.EqualTo(covers ? LandmarkView.RoofFadedAlpha : LandmarkView.RoofOpaqueAlpha), "cave tile (" + x + ", " + y + "): fades iff RoofCovers");
                }
                Assert.That(covered, Is.GreaterThan(20), "guard: the cave has covered floor to test");
            }
        }

        // ---- (2) the bog tree drawing -----------------------------------------------------------------------------------------------------

        /// <summary>The bog drawing (docs/landmarks/blueprints/bog.txt) stamped in orientation k (swap x and y, then flip x, then flip y), as the
        /// existing BogTreeLandmarkEditModeTests do: T and r wall, % floor with terrain Bog, : and . plain floor; the anchor centre is the trunk's
        /// centre tile (14, 14), the entrance the six causeway tiles on the box's edge.</summary>
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

        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }

        static Bounds Union(IEnumerable<Renderer> rs)
        {
            Bounds b = default; bool any = false;
            foreach (var r in rs) { if (!any) { b = r.bounds; any = true; } else b.Encapsulate(r.bounds); }
            Assert.That(any, Is.True, "something was drawn");
            return b;
        }

        static IEnumerable<SpriteRenderer> TrunkRenderers(Landmark lm)
        {
            var parents = lm.Root.GetComponentsInChildren<Transform>(true).Where(t => t.name == BogTreeLandmark.TrunkName).ToArray();
            Assert.That(parents.Length, Is.EqualTo(1), "one trunk object");
            return parents[0].GetComponentsInChildren<SpriteRenderer>(true);
        }

        /// <summary>The crown: the one SpriteRenderer under the landmark's root whose object is named BogTreeLandmark.CrownName; it must also be a roof renderer.</summary>
        static SpriteRenderer Crown(Landmark lm)
        {
            var found = lm.Root.GetComponentsInChildren<SpriteRenderer>(true).Where(r => r.name == BogTreeLandmark.CrownName).ToArray();
            Assert.That(found.Length, Is.EqualTo(1), "one crown sprite named " + BogTreeLandmark.CrownName);
            Assert.That(lm.RoofRenderers, Does.Contain(found[0]), "the crown is a roof renderer (it fades with the roof)");
            return found[0];
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheCrownIsLiftedAboveTheTrunksMidpointAndTheTrunkShowsBelowIt(int k)
        {
            using (var scene = BogScene(k))
            {
                var lm = scene.View.Get(0);
                var trunk = Union(TrunkRenderers(lm)); var crown = Crown(lm).bounds;
                float h = trunk.size.y, mid = trunk.center.y;
                float visible = (crown.min.y - trunk.min.y) / h;
                TestContext.WriteLine("orientation " + k + ": trunk y " + trunk.min.y.ToString("F2") + " .. " + trunk.max.y.ToString("F2") + " (h " + h.ToString("F2") + "), crown bottom "
                    + crown.min.y.ToString("F2") + ", visible share " + visible.ToString("F2"));
                Assert.That(crown.min.y, Is.GreaterThanOrEqualTo(mid + LiftMargin),
                    "the crown's bottom edge (world y " + crown.min.y.ToString("F2") + ") is above the trunk bounds' vertical midpoint (" + mid.ToString("F2") + ") by at least " + LiftMargin);
                Assert.That(visible, Is.GreaterThanOrEqualTo(VisibleShare),
                    "(crown bottom - trunk bottom) / trunk height: the trunk shows below the crown for at least " + VisibleShare + " of its height");
            }
        }

        [TestCaseSource(nameof(Orientations))]
        public void EveryTileTheCrownPaintsOverFadesTheRoofForAnActorStandingThere(int k)
        {
            using (var scene = BogScene(k))
            {
                var lm = scene.View.Get(0); var r = Crown(lm); var s = r.sprite;
                var px = s.texture.GetPixels32(); int w = s.texture.width, h = s.texture.height;
                var tilesPainted = new HashSet<(int x, int y)>(); int outside = 0;
                for (int j = 0; j < h; j++) for (int i = 0; i < w; i++)
                {
                    if (px[j * w + i].a < 128) continue;
                    var world = r.transform.TransformPoint(new Vector3((i + .5f) / s.pixelsPerUnit, (j + .5f) / s.pixelsPerUnit, 0));
                    int tx = Mathf.FloorToInt(world.x), ty = Mathf.FloorToInt(-world.y / Sq);
                    if (tx < FootX || ty < FootY || tx >= FootX + Size || ty >= FootY + Size) { outside++; continue; }
                    tilesPainted.Add((tx, ty));
                }
                Assert.That(outside, Is.EqualTo(0), "the crown paints nothing outside the anchor's footprint (a fade set cannot reach beyond it)");
                Assert.That(tilesPainted.Count, Is.GreaterThan(40), "guard: the crown covers a good many tiles");
                // Pixels, not the sprite rectangle: the rectangle's transparent corners hide nobody, and the existing structure test keeps the bog
                // and the dry ground beyond the cover from fading the canopy.
                foreach (var t in tilesPainted.OrderBy(t => t))
                {
                    Assert.That(Settle(scene, TileCentre(t.x, t.y)), Is.EqualTo(LandmarkView.RoofFadedAlpha), "orientation " + k + ": an actor on tile " + t + ", under the crown's pixels, fades it");
                    Settle(scene, null);
                }
            }
        }

        [TestCase(0)]
        [TestCase(5)]
        public void TheCrownTextureHasTransparentGapsInsideItsOutline(int k)
        {
            using (var scene = BogScene(k))
            {
                var tex = Crown(scene.View.Get(0)).sprite.texture; var px = tex.GetPixels32(); int w = tex.width, h = tex.height;
                var opaque = new bool[w * h]; int x0 = w, x1 = -1, y0 = h, y1 = -1;
                for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) if (px[j * w + i].a >= 128)
                { opaque[j * w + i] = true; x0 = Mathf.Min(x0, i); x1 = Mathf.Max(x1, i); y0 = Mathf.Min(y0, j); y1 = Mathf.Max(y1, j); }
                Assert.That(x1, Is.GreaterThan(x0), "the crown paints something");
                var rowL = new int[h]; var rowR = new int[h]; var colB = new int[w]; var colT = new int[w];
                for (int j = 0; j < h; j++) { rowL[j] = w; rowR[j] = -1; }
                for (int i = 0; i < w; i++) { colB[i] = h; colT[i] = -1; }
                for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) if (opaque[j * w + i])
                { rowL[j] = Mathf.Min(rowL[j], i); rowR[j] = Mathf.Max(rowR[j], i); colB[i] = Mathf.Min(colB[i], j); colT[i] = Mathf.Max(colT[i], j); }
                int box = (x1 - x0 + 1) * (y1 - y0 + 1), gaps = 0, solid = 0;
                for (int j = y0; j <= y1; j++) for (int i = x0; i <= x1; i++)
                {
                    if (opaque[j * w + i]) solid++;
                    else if (i > rowL[j] && i < rowR[j] && j > colB[i] && j < colT[i]) gaps++;     // transparent with opaque pixels on all four sides
                }
                TestContext.WriteLine("orientation " + k + ": crown box " + box + " px, opaque " + (solid / (float)box).ToString("F3") + ", enclosed gaps " + (gaps / (float)box).ToString("F3"));
                Assert.That(gaps / (float)box, Is.GreaterThanOrEqualTo(GapShare), "enclosed transparent pixels, as a share of the crown's opaque bounding box");
                Assert.That(solid / (float)box, Is.GreaterThanOrEqualTo(MinOpaqueShare), "and the crown is still mostly there");
            }
        }

        // ---- colour floors on the painted textures ------------------------------------------------------------------------------------------

        /// <summary>sRGB byte to linear light, then Rec. 709 relative luminance of a colour whose channels are given in 0..1 sRGB.</summary>
        static float Lin(float c) { return c <= .04045f ? c / 12.92f : Mathf.Pow((c + .055f) / 1.055f, 2.4f); }
        static float Luminance(float r, float g, float b) { return .2126f * Lin(r) + .7152f * Lin(g) + .0722f * Lin(b); }
        static float Luminance(Color32 c) { return Luminance(c.r / 255f, c.g / 255f, c.b / 255f); }

        /// <summary>These measure the ALBEDO the art paints (texture pixels before RegionSpriteLit's sun, ambient and fog), NOT the lit colour on screen,
        /// and the grass reference is a screen colour from the Web client (lit). They are comparable only roughly. A floor on albedo is still
        /// worth having because the light on a sprite does not turn a dark albedo into a bright screen colour: if the painted crown is dark
        /// before lighting, no light makes it the sunlit mass the brief wants. The tests do not say the screen is right; the look check does.</summary>
        [TestCase(0)]
        [TestCase(5)]
        public void TheTrunksMeanColourIsNotGreen(int k)
        {
            using (var scene = BogScene(k))
            {
                double r = 0, g = 0, b = 0; long n = 0;
                foreach (var sr in TrunkRenderers(scene.View.Get(0)))
                    foreach (var p in sr.sprite.texture.GetPixels32()) if (p.a >= 128) { r += p.r; g += p.g; b += p.b; n++; }
                Assert.That(n, Is.GreaterThan(1000), "the trunk paints a good many opaque pixels");
                Color.RGBToHSV(new Color((float)(r / n) / 255f, (float)(g / n) / 255f, (float)(b / n) / 255f), out float hue, out _, out _);
                hue *= 360f;
                TestContext.WriteLine("orientation " + k + ": trunk mean sRGB " + (r / n).ToString("F0") + ", " + (g / n).ToString("F0") + ", " + (b / n).ToString("F0") + ", hue " + hue.ToString("F0"));
                Assert.That(hue < GreenFrom || hue > GreenTo, Is.True, "the trunk's mean opaque colour has hue " + hue.ToString("F0") + ", inside the green band " + GreenFrom + ".." + GreenTo);
            }
        }

        [TestCase(0)]
        [TestCase(5)]
        public void TheCrownsLitColourIsAtLeastTwoAndAHalfTimesAsBrightAsThePlagueGrass(int k)
        {
            using (var scene = BogScene(k))
            {
                var all = Crown(scene.View.Get(0)).sprite.texture.GetPixels32().Where(p => p.a >= 128).OrderByDescending(p => Luminance(p)).ToArray();
                Assert.That(all.Length, Is.GreaterThan(1000), "the crown paints a good many opaque pixels");
                var top = all.Take(all.Length / 4).ToArray();          // the brightest quartile by luminance
                float r = (float)top.Average(p => p.r) / 255f, g = (float)top.Average(p => p.g) / 255f, bl = (float)top.Average(p => p.b) / 255f;
                float lum = Luminance(r, g, bl), grass = Luminance(WebGrass);
                TestContext.WriteLine("orientation " + k + ": crown lit colour " + (r * 255).ToString("F0") + ", " + (g * 255).ToString("F0") + ", " + (bl * 255).ToString("F0")
                    + " luminance " + lum.ToString("F3") + " vs grass " + grass.ToString("F3") + " ratio " + (lum / grass).ToString("F2"));
                Assert.That(lum, Is.GreaterThanOrEqualTo(CrownOverGrass * grass), "mean of the brightest quartile of the crown's opaque pixels, against the Web grass");
            }
        }
    }
}

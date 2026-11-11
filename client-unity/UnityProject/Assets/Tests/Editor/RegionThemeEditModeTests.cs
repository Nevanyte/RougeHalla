using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Region themes, palette constants, public region lookup and the deterministic prop scatter. No GPU needed.</summary>
    public sealed class RegionThemeEditModeTests
    {
        static readonly string[] RegionKeys = { "coliseum", "fire", "sentenced", "plague", "frost", "holy", "coliseum" };

        static string PalettePath { get { return Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/art/palette.json")); } }

        // ---- palette ----------------------------------------------------------------------------------------------------------

        static Color32 OklchToSrgb(float[] v)
        {
            double L = v[0], C = v[1], h = v[2] * System.Math.PI / 180.0, a = C * System.Math.Cos(h), b = C * System.Math.Sin(h);
            double l = System.Math.Pow(L + .3963377774 * a + .2158037573 * b, 3), m = System.Math.Pow(L - .1055613458 * a - .0638541728 * b, 3), s = System.Math.Pow(L - .0894841775 * a - 1.2914855480 * b, 3);
            double[] lin = { 4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s };
            var o = new byte[3];
            for (int i = 0; i < 3; i++)
            {
                double x = System.Math.Min(1, System.Math.Max(0, lin[i]));
                double g = x <= .0031308 ? 12.92 * x : 1.055 * System.Math.Pow(x, 1 / 2.4) - .055;
                o[i] = (byte)System.Math.Round(g * 255);
            }
            return new Color32(o[0], o[1], o[2], 255);
        }

        [Test]
        public void GeneratedSrgbMatchesGeneratedOklch()
        {
            for (int r = 0; r < RegionThemes.RegionCount; r++)
                for (int s = 0; s < RegionPaletteGenerated.SlotCount; s++)
                {
                    var want = OklchToSrgb(RegionPaletteGenerated.Oklch[r][s]); var have = RegionPaletteGenerated.Srgb[r][s];
                    Assert.That(have.r, Is.EqualTo(want.r).Within(1), "region " + r + " slot " + s + " red");
                    Assert.That(have.g, Is.EqualTo(want.g).Within(1), "region " + r + " slot " + s + " green");
                    Assert.That(have.b, Is.EqualTo(want.b).Within(1), "region " + r + " slot " + s + " blue");
                }
        }

        [Test]
        public void GeneratedPaletteMatchesPaletteJson()
        {
            Assume.That(File.Exists(PalettePath), "palette.json not found next to the project: " + PalettePath);
            string text = File.ReadAllText(PalettePath);
            int regionsAt = text.IndexOf("\"regions\"", System.StringComparison.Ordinal);
            Assert.That(regionsAt, Is.GreaterThan(0));
            var triple = new Regex(@"\[\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*\]");
            for (int r = 1; r <= 6; r++)
            {
                int start = text.IndexOf("\"" + RegionKeys[r] + "\": {", regionsAt, System.StringComparison.Ordinal);
                Assert.That(start, Is.GreaterThan(0), RegionKeys[r]);
                int end = r == 6 ? text.IndexOf("\"ui\"", start, System.StringComparison.Ordinal) : text.IndexOf("\"" + RegionKeys[r + 1] + "\": {", start, System.StringComparison.Ordinal);
                string block = text.Substring(start, end - start);
                // In file order: base, secondary, accent (swatches) then key, ambient, shadow, fog (light). Skip hex "legacy" strings: they are not triples.
                var found = new List<float[]>();
                foreach (Match m in triple.Matches(block)) found.Add(new[] { float.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture), float.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture), float.Parse(m.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture) });
                Assert.That(found.Count, Is.EqualTo(RegionPaletteGenerated.SlotCount), RegionKeys[r] + " should hold 7 OKLCH triples");
                for (int s = 0; s < found.Count; s++)
                    for (int k = 0; k < 3; k++)
                        Assert.That(RegionPaletteGenerated.Oklch[r][s][k], Is.EqualTo(found[s][k]).Within(1e-4f), "region " + RegionKeys[r] + " slot " + s + " component " + k + " differs from docs/art/palette.json; run node tools/art/gen-region-palette.cjs");
            }
        }

        [Test]
        public void ThemeTableHasAnEntryPerRegionWithPaletteColours()
        {
            for (int id = 0; id < RegionThemes.RegionCount; id++)
            {
                var th = RegionThemes.Get(id);
                Assert.That((int)th.Id, Is.EqualTo(id));
                Assert.That(th.BaseSrgb, Is.EqualTo(RegionPaletteGenerated.Srgb[id][RegionPaletteGenerated.Base]));
                Assert.That(th.AccentSrgb, Is.EqualTo(RegionPaletteGenerated.Srgb[id][RegionPaletteGenerated.Accent]));
            }
            Assert.That(RegionThemes.Get(RegionId.Frost).Wall, Is.EqualTo(WallStyle.Glacier));
            Assert.That(RegionThemes.Get(RegionId.Fire).Wall, Is.EqualTo(WallStyle.Basalt));
            Assert.That(RegionThemes.Get(99).Id, Is.EqualTo(RegionId.None), "unknown ids fall back to the neutral theme");
        }

        [Test]
        public void EveryPropRuleNamesAPaintedSprite()
        {
            for (int id = 1; id <= 5; id++)
                foreach (var rule in RegionThemes.Get(id).Props)
                {
                    Assert.That(RegionPropArt.TryGet(rule.Art, out var sprite), Is.True, "missing prop art " + rule.Art);
                    Assert.That(sprite.Sprite, Is.Not.Null);
                    Assert.That(sprite.Height, Is.GreaterThan(.2f));
                }
        }

        // ---- region lookup ------------------------------------------------------------------------------------------------------

        static MapBlob TestMap(out byte[] regions)
        {
            const int w = 40, h = 40; var tiles = new byte[w * h]; regions = new byte[w * h]; var terrain = new byte[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                bool border = x == 0 || y == 0 || x == w - 1 || y == h - 1;
                tiles[y * w + x] = border ? MapBlob.Wall : MapBlob.Floor;
                regions[y * w + x] = (byte)(border ? 0 : x < 20 ? (y < 20 ? 1 : 3) : (y < 20 ? 5 : 4));
            }
            for (int x = 25; x < 30; x++) { terrain[30 * w + x] = (byte)TerrainKind.Ice; }
            return new MapBlob(w, h, tiles, terrain, regions, MapBlob.GroundTerrainAll);
        }

        [Test]
        public void RegionAtReadsThePublicPlaneAndAnswersNoneWhenAbsent()
        {
            var map = TestMap(out _); var rm = new RegionMap(); rm.Load(map);
            Assert.That(rm.RegionAtTile(5, 5), Is.EqualTo(RegionId.Fire));
            Assert.That(rm.RegionAtTile(5, 30), Is.EqualTo(RegionId.Plague));
            Assert.That(rm.RegionAtTile(30, 30), Is.EqualTo(RegionId.Frost));
            Assert.That(rm.RegionAtTile(30, 5), Is.EqualTo(RegionId.Holy));
            Assert.That(rm.RegionAtTile(0, 0), Is.EqualTo(RegionId.None));
            Assert.That(rm.RegionAtTile(-1, 3), Is.EqualTo(RegionId.None));
            Assert.That(rm.TerrainAtTile(26, 30), Is.EqualTo(TerrainKind.Ice));
            Assert.That(rm.RegionAtServer(30 * 32 + 5, 30 * 32 + 5), Is.EqualTo(RegionId.Frost));
            // Unity world space: x = tile, y = -tile * squash.
            Assert.That(rm.RegionAt(new Vector3(30.5f, -30.5f * ArenaView.GroundSquash, 0)), Is.EqualTo(RegionId.Frost));

            var plain = new RegionMap(); plain.Load(new MapBlob(40, 40, map.Tiles));
            Assert.That(plain.HasRegions, Is.False);
            Assert.That(plain.RegionAtTile(5, 5), Is.EqualTo(RegionId.None));
            plain.UpdateLocal(100, 100, 1f);
            Assert.That(plain.LocalRegion, Is.EqualTo(RegionId.None));
        }

        [Test]
        public void LocalRegionEventFiresOnceAfterTheDebounceAndIgnoresBorderTiles()
        {
            var map = TestMap(out _); var rm = new RegionMap(); rm.Load(map);
            var events = new List<string>(); rm.LocalRegionChanged += (a, b) => events.Add(a + ">" + b);
            rm.UpdateLocal(5 * 32 + 8, 5 * 32 + 8, 0f);                       // first fix commits at once
            Assert.That(events, Is.EqualTo(new[] { "None>Fire" }));
            rm.UpdateLocal(0 * 32 + 8, 5 * 32 + 8, .1f);                      // border tile (region 0) is ignored
            Assert.That(rm.LocalRegion, Is.EqualTo(RegionId.Fire));
            rm.UpdateLocal(30 * 32, 5 * 32, 1f);                              // Holy, not yet confirmed
            Assert.That(rm.LocalRegion, Is.EqualTo(RegionId.Fire));
            rm.UpdateLocal(5 * 32, 5 * 32, 1.1f);                             // back to Fire before the debounce ends: no event
            rm.UpdateLocal(30 * 32, 5 * 32, 1.2f);
            rm.UpdateLocal(30 * 32, 5 * 32, 1.2f + RegionMap.ConfirmSeconds + .01f);
            Assert.That(events, Is.EqualTo(new[] { "None>Fire", "Fire>Holy" }));
            rm.SnapLocal(30 * 32, 30 * 32);
            Assert.That(events[events.Count - 1], Is.EqualTo("Holy>Frost"));
        }

        // ---- prop scatter ---------------------------------------------------------------------------------------------------------

        [Test]
        public void PropScatterIsDeterministicAndRespectsTilesRegionsAndClearance()
        {
            var map = TestMap(out var regions);
            var a = RegionProps.Scatter(map); var b = RegionProps.Scatter(map);
            Assert.That(a.Count, Is.GreaterThan(5), "a 40x40 map with four regions should receive props");
            Assert.That(b.Count, Is.EqualTo(a.Count));
            for (int i = 0; i < a.Count; i++) { Assert.That(b[i].Art, Is.EqualTo(a[i].Art)); Assert.That(b[i].X, Is.EqualTo(a[i].X)); Assert.That(b[i].Y, Is.EqualTo(a[i].Y)); }
            var terrain = map.Terrain;
            foreach (var p in a)
            {
                int i = p.Ty * map.W + p.Tx;
                Assert.That(map.Tiles[i], Is.EqualTo(MapBlob.Floor), "props never stand on walls: " + p.Art);
                Assert.That(terrain[i], Is.EqualTo((byte)0), "props never stand on terrain surfaces");
                Assert.That(regions[i], Is.InRange((byte)1, (byte)5));
                Assert.That(p.Art.StartsWith(RegionPrefix(regions[i])), "prop " + p.Art + " in region " + regions[i]);
            }
        }

        static string RegionPrefix(int region)
        {
            switch (region) { case 1: return "fire."; case 2: return "sent."; case 3: return "plague."; case 4: return "frost."; default: return "holy."; }
        }

        [Test]
        public void PropScatterOnTheCanonicalSeedMapIsStableAndSkipsTheColiseum()
        {
            string dir = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../crates/rh-sim/src/mapdata/fixtures/seed1.map.json"));
            Assume.That(File.Exists(dir), "seed1 fixture not found");
            var map = LoadSeed1(dir);
            var first = RegionProps.Scatter(map); var second = RegionProps.Scatter(map);
            Assert.That(second.Count, Is.EqualTo(first.Count));
            int frost = 0;
            foreach (var p in first)
            {
                Assert.That(map.Regions[p.Ty * map.W + p.Tx], Is.Not.EqualTo((byte)6).Or.Matches<byte>(b => p.Art.StartsWith("col.")), "only the coliseum prop pass stands in the coliseum");
                if (p.Art.StartsWith("frost.")) frost++;
            }
            Assert.That(frost, Is.GreaterThan(100), "Frost is the finished region");
            Assert.That(first.Count, Is.LessThan(map.W * map.H / 8), "decor stays sparse");
        }

        static MapBlob LoadSeed1(string path)
        {
            string json = File.ReadAllText(path);
            byte[] Read(string name)
            {
                int at = json.IndexOf("\"" + name + "\":[", System.StringComparison.Ordinal); Assert.That(at, Is.GreaterThan(0), name);
                int open = json.IndexOf('[', at), close = json.IndexOf(']', open);
                var parts = json.Substring(open + 1, close - open - 1).Split(',');
                var bytes = new byte[parts.Length]; for (int i = 0; i < bytes.Length; i++) bytes[i] = byte.Parse(parts[i].Trim());
                return bytes;
            }
            return new MapBlob(160, 160, Read("tiles"), Read("terrain"), Read("regionGrid"));
        }

        // ---- Sentenced readability (packet P-UNITY-SENTENCED-READ-1) -----------------------------------------------------------
        // The same three pairs as Tools/contrast-lib.test.cjs, measured on the generated wall atlas (not on palette expressions): wall top,
        // rim and fence bars against the zone's floor colour (RegionThemes Sentenced BaseSrgb, the ground shader's base; the baked flagstone
        // detail and the zone lighting are NOT applied here, they need a screenshot). Each is WCAG relative luminance, at least 3:1.
        // Not run by scripts/gate.sh (no Unity in the gate): run through the Unity EditMode batch runner with the Editor closed.

        const float ReadableRatio = 3f;

        static double Lin(double v) { return v <= .04045 ? v / 12.92 : System.Math.Pow((v + .055) / 1.055, 2.4); }
        static double Luminance(double r, double g, double b) { return .2126 * Lin(r) + .7152 * Lin(g) + .0722 * Lin(b); }
        static double Luminance(Color c) { return Luminance(c.r, c.g, c.b); }
        static double Ratio(double a, double b) { double hi = System.Math.Max(a, b), lo = System.Math.Min(a, b); return (hi + .05) / (lo + .05); }

        static Color SentencedFloor { get { return RegionThemes.Get(RegionId.Sentenced).BaseSrgb; } }

        /// <summary>The atlas pixels of one cell: x0, y0 of its lower-left texel, in atlas texels (cells are stored with their canvas row order).</summary>
        static Color32[] CellPixels(RegionWallAtlas.Cell cell, int w, int h)
        {
            var atlas = RegionWallAtlas.Atlas; int x0 = Mathf.RoundToInt(cell.Min.x * atlas.width), y0 = Mathf.RoundToInt(cell.Min.y * atlas.height);
            var all = atlas.GetPixels32(); var o = new Color32[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) o[y * w + x] = all[(y0 + y) * atlas.width + x0 + x];
            return o;
        }

        /// <summary>
        /// The contract the implementer adds to RegionWallAtlas: <c>public static Color FenceTileGround(Color floorSrgb)</c>, the ground colour (sRGB)
        /// under a fence tile for an open floor colour (legacy: the fence's iron at alpha .3 over the ground, zoneStyle.ts drawFenceTile). Looked up by
        /// reflection so this file compiles before it exists; the same function must colour the fence tile's ground in the picture.
        /// </summary>
        static Color FenceTileGround(Color floorSrgb)
        {
            var m = typeof(RegionWallAtlas).GetMethod("FenceTileGround", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static, null, new[] { typeof(Color) }, null);
            Assert.That(m, Is.Not.Null, "RegionWallAtlas.FenceTileGround(Color) does not exist yet: add it (public static Color FenceTileGround(Color floorSrgb)) and draw the fence tile ground with it");
            Assert.That(m.ReturnType, Is.EqualTo(typeof(Color)));
            return (Color)m.Invoke(null, new object[] { floorSrgb });
        }

        static double Median(List<double> v) { v.Sort(); return v.Count == 0 ? 0 : v[v.Count / 2]; }

        static Color MeanOpaque(Color32[] px)
        {
            double r = 0, g = 0, b = 0; int n = 0;
            foreach (var c in px) if (c.a >= 250) { r += c.r / 255.0; g += c.g / 255.0; b += c.b / 255.0; n++; }
            Assert.That(n, Is.GreaterThan(0), "cell has no opaque pixels");
            return new Color((float)(r / n), (float)(g / n), (float)(b / n), 1f);
        }

        [Test]
        public void SentencedWallTopTextureReadsAgainstTheFloor()
        {
            var set = RegionWallAtlas.SetFor(WallStyle.Timber); var floor = Luminance(SentencedFloor);
            for (int v = 0; v < RegionWallAtlas.TopVariants; v++)
            {
                var top = MeanOpaque(CellPixels(set.Top[v], RegionWallAtlas.TileW, RegionWallAtlas.TopH)); double r = Ratio(Luminance(top), floor);
                Assert.That(r, Is.GreaterThanOrEqualTo(ReadableRatio), "Sentenced wall top variant " + v + " (mean " + (Color32)top + ") against the floor " + SentencedFloor + " measured " + r.ToString("F3") + ":1");
            }
        }

        [Test]
        public void SentencedWallRimTextureReadsAgainstTheFloor()
        {
            var set = RegionWallAtlas.SetFor(WallStyle.Timber); var floor = Luminance(SentencedFloor);
            var top = MeanOpaque(CellPixels(set.Top[0], RegionWallAtlas.TileW, RegionWallAtlas.TopH));
            var rim = CellPixels(set.Rim, RegionWallAtlas.TileW, RegionWallAtlas.RimH);
            // Rows 0-1 are the dark outline; row 2 is the brightest light row. The rim is drawn over the wall top, so composite it there.
            var c = rim[2 * RegionWallAtlas.TileW + RegionWallAtlas.TileW / 2]; float a = c.a / 255f;
            double r = Ratio(Luminance(c.r / 255.0 * a + top.r * (1 - a), c.g / 255.0 * a + top.g * (1 - a), c.b / 255.0 * a + top.b * (1 - a)), floor);
            Assert.That(r, Is.GreaterThanOrEqualTo(ReadableRatio), "Sentenced rim, brightest light row (" + c + " over the wall top) against the floor measured " + r.ToString("F3") + ":1");
        }

        [Test]
        public void SentencedFenceBarsReadAgainstTheFenceTileGround()
        {
            var set = RegionWallAtlas.SetFor(WallStyle.Timber); var ground = Luminance(FenceTileGround(SentencedFloor));
            for (int v = 0; v < RegionWallAtlas.LowVariants; v++)
            {
                var px = CellPixels(set.Low[v], RegionWallAtlas.TileW, RegionWallAtlas.LowH);
                // The bars stand every 8 px from x = 4 (RegionWallAtlas.PaintLow, Timber railings); the median opaque pixel of a bar column is the bar body
                // (the two rails and the finial are a few rows of it).
                var lums = new List<double>();
                for (int k = 0; k < 16; k++) for (int y = 0; y < RegionWallAtlas.LowH; y++)
                { var c = px[y * RegionWallAtlas.TileW + 4 + k * 8]; if (c.a >= 250) lums.Add(Luminance(c.r / 255.0, c.g / 255.0, c.b / 255.0)); }
                Assert.That(lums.Count, Is.GreaterThan(64), "variant " + v + " has bar pixels");
                double r = Ratio(Median(lums), ground);
                Assert.That(r, Is.GreaterThanOrEqualTo(ReadableRatio), "Sentenced fence bar variant " + v + " against the fence tile ground measured " + r.ToString("F3") + ":1");
            }
        }

        [Test]
        public void ASentencedFenceTileHasADarkerGroundThanOpenFloor()
        {
            // Legacy shades the blocked tile (zoneStyle.ts drawFenceTile: the fence's iron colour at alpha .3 over the ground), so the line reads as blocking.
            var floor = SentencedFloor; var fenced = FenceTileGround(floor);
            Assert.That(Luminance(fenced), Is.LessThan(Luminance(floor)), "the fence tile ground " + (Color32)fenced + " must be darker than open floor " + floor);
        }

        // ---- batching (no GPU) -----------------------------------------------------------------------------------------------------

        [Test]
        public void GroundIsOneRendererAndWallsAreOneMeshPerRowChunk()
        {
            var map = TestMap(out _); var root = new GameObject("test root");
            try
            {
                var ground = RegionGround.Create(root.transform, map, 1f);
                var walls = RegionWalls.Build(root.transform, map, 1f);
                Assert.That(ground.Root.GetComponentsInChildren<MeshRenderer>().Length, Is.EqualTo(1), "the whole ground is a single quad");
                int rows = walls.RowMeshCount;
                Assert.That(rows, Is.LessThanOrEqualTo(map.H * 2));
                Assert.That(root.GetComponentsInChildren<MeshRenderer>().Length, Is.EqualTo(1 + rows), "no per-tile GameObjects");
                ground.Dispose(); walls.Dispose();
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}

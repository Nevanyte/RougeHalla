using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-GROUND-BANDS-1 oracle (docs/backlog/packets/P-UNITY-GROUND-BANDS-1.md). Decoration bands (every ground-variant code the server's rules lay) get a soft edge; the Sentenced
    /// scatter stays crisp. Rendering is impossible under the gate (-nographics: SystemInfo.graphicsDeviceType is Null), so this pins what the CPU builds, through
    /// RegionGround.BakeVariantInputs: the crisp Tile plane, and GroundVariantInputs.SoftGainAt / GainAt (the soft part's gain at a point and the product the shader applies, tile
    /// coordinates). How the soft part is stored is the implementation's choice. The ragged noise is the shader's and is checked on renders (Tools/band-outline-check.sh, not in the gate).
    /// Several tests below are guards, green on the stub by design (they stop the implementation moving what must not move); the red ones say so.
    /// </summary>
    public sealed class GroundBandsEditModeTests
    {
        const int N = 40;

        // ---- map builders -------------------------------------------------------------------------------------------------

        static MapBlob Zone(byte region, byte[] plane = null, byte[] terrain = null)
        {
            var regions = Enumerable.Repeat(region, N * N).ToArray();
            var map = new MapBlob((ushort)N, (ushort)N, new byte[N * N], terrain, regions, MapBlob.GroundTerrainAll);
            return plane == null ? map : map.WithPublic(null, null, null, null, plane);
        }

        static void Fill(byte[] plane, int x0, int y0, int x1, int y1, byte v)
        {   // [x0, x1) x [y0, y1)
            for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) plane[y * N + x] = v;
        }

        static GroundVariantInputs Inputs(MapBlob map) { return RegionGround.BakeVariantInputs(map); }

        /// <summary>The band's own gain at full strength, as today's look decides it (GroundTint.Apply of the TryGet texel on grey 1).</summary>
        static Vector3 Full(int region, byte variant)
        {
            Assert.That(GroundVariantLook.TryGet(region, variant, out var t), Is.True, "a look for region " + region + " variant " + variant);
            var g = GroundTint.Apply(1f, 1f, 1f, t); return new Vector3(g[0], g[1], g[2]);
        }

        /// <summary>The channel on which the band differs most from neutral, and that difference.</summary>
        static int Chan(Vector3 full, out float dev)
        {
            int k = 0; dev = 0;
            for (int c = 0; c < 3; c++) if (Math.Abs(full[c] - 1f) > Math.Abs(dev)) { dev = full[c] - 1f; k = c; }
            return k;
        }

        /// <summary>Fraction of the band's full effect at a point: 0 = ground untouched, 1 = deep inside the band (on the band's strongest channel).</summary>
        static float Frac(GroundVariantInputs inp, float x, float y, int ch, float dev) { return (inp.GainAt(x, y)[ch] - 1f) / dev; }

        // ---- 1. the table ---------------------------------------------------------------------------------------------------

        static string Repo()
        {
            var d = new DirectoryInfo(Application.dataPath);
            while (d != null && !File.Exists(Path.Combine(d.FullName, "crates", "rh-mapdress", "rules", "zones.json"))) d = d.Parent;
            Assert.That(d, Is.Not.Null, "crates/rh-mapdress/rules/zones.json above " + Application.dataPath);
            return d.FullName;
        }

        /// <summary>Every groundVariant the server's rules can lay: signature rings, landmark rings and terrain rings are all bands (the scatter is not in the rules).</summary>
        static SortedSet<byte> RuleCodes()
        {
            string json = File.ReadAllText(Path.Combine(Repo(), "crates", "rh-mapdress", "rules", "zones.json"));
            var set = new SortedSet<byte>();
            foreach (Match m in Regex.Matches(json, "\"groundVariant\"\\s*:\\s*(\\d+)")) set.Add(byte.Parse(m.Groups[1].Value));
            return set;
        }

        [Test]
        public void EveryBandCodeTheRulesCanLayHasALookAndIsSoft_RedToday()
        {
            var codes = RuleCodes();
            Assert.That(codes, Is.SupersetOf(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 }), "zones.json lays the ring, landmark and marsh codes 1..8 (the test reads the file)");
            foreach (byte code in codes)
            {
                int rows = 0;
                for (int region = 1; region <= 5; region++)
                {
                    if (!GroundVariantLook.TryGet(region, code, out _)) continue;
                    rows++;
                    Assert.That(GroundVariantLook.EdgeOf(region, code), Is.EqualTo(GroundVariantEdge.Soft), "region " + region + " variant " + code + " is a band (zones.json): Soft");
                }
                Assert.That(rows, Is.GreaterThan(0), "variant " + code + " is laid by zones.json but GroundVariantLook has no row for it in any region");
            }
        }

        [Test]
        public void CodesWithoutALookAreTile_Guard()
        {
            for (int region = 0; region <= 6; region++)
            {
                Assert.That(GroundVariantLook.EdgeOf(region, 0), Is.EqualTo(GroundVariantEdge.Tile), "variant 0 (no variant) in region " + region);
                for (int v = 9; v <= 255; v++) Assert.That(GroundVariantLook.EdgeOf(region, (byte)v), Is.EqualTo(GroundVariantEdge.Tile), "unknown variant " + v);
            }
            for (int v = 1; v <= 8; v++) Assert.That(GroundVariantLook.EdgeOf(0, (byte)v), Is.EqualTo(GroundVariantEdge.Tile), "an unknown region has no look: Tile");
        }

        // ---- 2. the soft edge ------------------------------------------------------------------------------------------------

        // Block of the variant at tiles [15, 25) x [15, 25) in a 40 x 40 map of one region. Regions other than Sentenced: no scatter, so the profile is the band alone.
        static readonly (int region, byte code)[] Bands = { (1, 1), (1, 5), (3, 7), (3, 8), (4, 2), (5, 2) };
        const int B0 = 15, B1 = 25;

        static GroundVariantInputs Block(int region, byte code)
        {
            var plane = new byte[N * N]; Fill(plane, B0, B0, B1, B1, code);
            return Inputs(Zone((byte)region, plane));
        }

        /// <summary>The point at inward distance d (tiles; negative = outside) from side 0 left, 1 right, 2 top (small y), 3 bottom, at the middle of the side. d = 0 is nudged 0.001 inside.</summary>
        static Vector2 OnSide(int side, float d)
        {
            if (d == 0f) d = .001f;
            float mid = (B0 + B1) / 2f;
            switch (side)
            {
                case 0: return new Vector2(B0 + d, mid);
                case 1: return new Vector2(B1 - d, mid);
                case 2: return new Vector2(mid, B0 + d);
                default: return new Vector2(mid, B1 - d);
            }
        }

        [TestCaseSource(nameof(Bands))]
        public void ASoftBandFadesAcrossItsBoundaryTilesAndIsFullOneTileInAndZeroOneTileOut_RedToday((int region, byte code) band)
        {
            var inp = Block(band.region, band.code); var full = Full(band.region, band.code);
            int ch = Chan(full, out float dev); Assert.That(Math.Abs(dev), Is.GreaterThan(.04f), "a band whose look is visible (channel " + ch + " " + full[ch] + ")");
            Assert.That(inp.SoftActive, Is.True, "a map with a Soft band needs the soft path");
            string id = "region " + band.region + " variant " + band.code;
            for (int side = 0; side < 4; side++)
            {
                Func<float, float> s = d => { var p = OnSide(side, d); return Frac(inp, p.x, p.y, ch, dev); };
                string at = id + " side " + side + ": ";
                Assert.That(s(-1f), Is.LessThanOrEqualTo(.1f), at + "one tile outside the band the ground is untouched");
                Assert.That(s(1f), Is.GreaterThanOrEqualTo(.9f), at + "one tile inside the band the gain is full");
                Assert.That(s(1f), Is.LessThanOrEqualTo(1.1f), at + "no overshoot inside");
                Assert.That(s(0f), Is.InRange(.25f, .75f), at + "on the boundary the fade is about half way (it is centred on the tile edge, not inside or outside it)");
                Assert.That(s(-.05f), Is.GreaterThanOrEqualTo(s(-.95f) + .1f), at + "the gain varies within the boundary tile outside the band (today it is constant across the tile)");
                Assert.That(s(.95f), Is.GreaterThanOrEqualTo(s(.05f) + .1f), at + "the gain varies within the boundary tile inside the band");
                float prev = s(-1f);
                for (int i = -9; i <= 10; i++)
                {
                    float cur = s(i / 10f);
                    Assert.That(cur, Is.GreaterThanOrEqualTo(prev - .03f), at + "the fade only rises going in (d = " + i / 10f + ")");
                    prev = cur;
                }
            }
        }

        [TestCaseSource(nameof(Bands))]
        public void ASoftBandsCornersAreRounded_RedToday((int region, byte code) band)
        {
            var inp = Block(band.region, band.code); var full = Full(band.region, band.code); int ch = Chan(full, out float dev);
            float edgeMid = Frac(inp, B0 + .001f, 20f, ch, dev);
            foreach (var (cx, cy) in new[] { (B0 + .001f, B0 + .001f), (B1 - .001f, B0 + .001f), (B0 + .001f, B1 - .001f), (B1 - .001f, B1 - .001f) })
            {
                float c = Frac(inp, cx, cy, ch, dev);
                Assert.That(c, Is.LessThanOrEqualTo(.4f), "region " + band.region + " variant " + band.code + " at the corner (" + cx + "," + cy + ") the fade is a quarter, not a half");
                Assert.That(c, Is.LessThanOrEqualTo(edgeMid - .1f), "the corner is weaker than the middle of a side (" + c + " against " + edgeMid + ")");
            }
        }

        [Test]
        public void AOneTileBandIsNotErasedByItsSoftEdge_RedToday()
        {
            // The marsh's water ring is 1 tile wide (reach 1). A vertical strip of tile column 20, rows 10..29.
            var plane = new byte[N * N]; Fill(plane, 20, 10, 21, 30, 7);
            var inp = Inputs(Zone(3, plane)); var full = Full(3, 7); int ch = Chan(full, out float dev);
            Assert.That(inp.SoftActive, Is.True);
            Assert.That(Frac(inp, 20.5f, 20f, ch, dev), Is.InRange(.5f, 1.05f), "the strip's middle keeps at least half its strength: a soft edge wider than the band erases it");
            Assert.That(Frac(inp, 19f, 20f, ch, dev), Is.LessThanOrEqualTo(.1f), "one tile left of the strip is untouched");
            Assert.That(Frac(inp, 22f, 20f, ch, dev), Is.LessThanOrEqualTo(.1f), "one tile right of the strip is untouched");
        }

        [Test]
        public void NeighbouringBandsBlendTheirGainsNotTheirCodes_RedToday()
        {
            // Fire: variant 1 (gain about .84 on every channel) beside variant 5 (R about .91): both darken R, so a fade through neutral ground would overshoot.
            var plane = new byte[N * N]; Fill(plane, 10, 10, 20, 30, 1); Fill(plane, 20, 10, 30, 30, 5);
            var inp = Inputs(Zone(1, plane)); var a = Full(1, 1); var b = Full(1, 5);
            Assert.That(inp.SoftActive, Is.True);
            for (int c = 0; c < 3; c++)
            {
                Assert.That(inp.GainAt(19f, 20f)[c], Is.EqualTo(a[c]).Within(.02f), "channel " + c + " one tile inside band 1");
                Assert.That(inp.GainAt(21f, 20f)[c], Is.EqualTo(b[c]).Within(.02f), "channel " + c + " one tile inside band 5");
                float lo = Math.Min(a[c], b[c]) - .02f, hi = Math.Max(a[c], b[c]) + .02f, prev = inp.GainAt(19f, 20f)[c];
                for (int i = 0; i <= 20; i++)
                {
                    float g = inp.GainAt(19f + i / 10f, 20f)[c];
                    Assert.That(g, Is.InRange(lo, hi), "channel " + c + " at x = " + (19f + i / 10f) + " stays between the two bands' gains (a fade through the bare ground, or a blended code, leaves that range)");
                    Assert.That((g - prev) * Math.Sign(b[c] - a[c]), Is.GreaterThanOrEqualTo(-.01f), "channel " + c + " moves from band 1 to band 5 monotonically");
                    prev = g;
                }
            }
            for (int c = 0; c < 3; c++)
            {
                if (Math.Abs(b[c] - a[c]) < .05f) continue;
                float f = (inp.GainAt(20f, 20f)[c] - a[c]) / (b[c] - a[c]);
                Assert.That(f, Is.InRange(.25f, .75f), "channel " + c + " on the shared boundary the two bands are about half and half");
            }
        }

        [TestCase(1, 5, 1, TestName = "lava")]      // region 1, TerrainKind.Lava = 1, band variant 1
        [TestCase(3, 7, 5, TestName = "bog")]       // region 3, TerrainKind.Bog = 5, variant 7
        [TestCase(4, 2, 6, TestName = "ice")]       // region 4, TerrainKind.Ice = 6, variant 2
        public void ASoftBandKeepsItsStrengthRightUpToTheTerrainItSurrounds_RedToday(int region, int code, int kind)
        {
            // Terrain block [20, 26) x [20, 26); the server lays variants on Floor tiles only, so the terrain's own tiles carry variant 0 and the band sits round it (Chebyshev 1..3).
            // The terrain's soft edge (RegionGround.shader, smoothstep on a blurred coverage) draws over the band; the band must not fade where it meets the terrain, or a gap shows.
            var terrain = new byte[N * N]; var plane = new byte[N * N];
            for (int y = 20; y < 26; y++) for (int x = 20; x < 26; x++) terrain[y * N + x] = (byte)kind;
            for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
            {
                int d = Math.Max(Math.Max(20 - x, x - 25), Math.Max(20 - y, y - 25));
                if (d >= 1 && d <= 3) plane[y * N + x] = (byte)code;
            }
            var inp = Inputs(Zone((byte)region, plane, terrain)); var full = Full(region, (byte)code); int ch = Chan(full, out float dev);
            Assert.That(inp.SoftActive, Is.True);
            foreach (var (x, y) in new[] { (19.999f, 23f), (26.001f, 23f) })
                Assert.That(Frac(inp, x, y, ch, dev), Is.GreaterThanOrEqualTo(.9f), "region " + region + " variant " + code + " at (" + x + "," + y + "), the band tile touching the terrain: still full");
            foreach (var (x, y) in new[] { (20.3f, 23f), (25.7f, 23f), (23f, 20.3f), (23f, 25.7f) })
                Assert.That(Frac(inp, x, y, ch, dev), Is.GreaterThanOrEqualTo(.9f), "region " + region + " variant " + code + " 0.3 tile into the terrain tile (" + x + "," + y + ") the band is still full under the terrain's own edge");
            Assert.That(Frac(inp, 16f, 23f, ch, dev), Is.LessThanOrEqualTo(.1f), "the band's far edge (3 tiles out) is the soft one: untouched one tile beyond");
        }

        // ---- 3. nothing else moves (guards, green on the stub) ------------------------------------------------------------------

        [Test]
        public void ADeepBandTileHasTodaysGainInEveryZoneAndCode_Guard()
        {
            // Two or more tiles inside a 12 x 12 block of the variant, the gain is what GroundTint.Bake decides today (band, and in Sentenced the scatter family as well).
            for (int region = 1; region <= 5; region++)
                for (byte v = 1; v <= 8; v++)
                {
                    var plane = new byte[N * N]; Fill(plane, 14, 14, 26, 26, v);
                    var inp = Inputs(Zone((byte)region, plane));
                    for (int y = 16; y < 24; y++) for (int x = 16; x < 24; x++)
                    {
                        Assert.That(GroundTint.Bake(region, v, x, y, out var t), Is.True);
                        var want = GroundTint.Apply(1f, 1f, 1f, t); var got = inp.GainAt(x + .5f, y + .5f);
                        for (int c = 0; c < 3; c++)
                            Assert.That(got[c], Is.EqualTo(want[c]).Within(.03f), "region " + region + " variant " + v + " tile (" + x + "," + y + ") channel " + c + ": a tile deep in a band keeps today's gain (not squared by the soft plane on top of the tile plane)");
                    }
                }
        }

        [Test]
        public void TheSentencedScatterStaysCrispWithAndWithoutABand_Guard()
        {
            foreach (bool banded in new[] { false, true })
            {
                var plane = banded ? new byte[N * N] : null; if (banded) Fill(plane, 8, 8, 32, 32, 3);
                var inp = Inputs(Zone(2, plane));
                int pairs = 0;
                for (int y = 10; y < 30; y++) for (int x = 10; x < 29; x++)
                {
                    if (SentencedTiles.Family(x, y) == SentencedTiles.Family(x + 1, y)) continue;
                    pairs++;
                    var a = inp.GainAt(x + .5f, y + .5f); var a2 = inp.GainAt(x + .98f, y + .5f); var b = inp.GainAt(x + 1.5f, y + .5f); var b2 = inp.GainAt(x + 1.02f, y + .5f);
                    for (int c = 0; c < 3; c++)
                    {
                        Assert.That(a2[c], Is.EqualTo(a[c]).Within(.01f), (banded ? "banded" : "plain") + " Sentenced tile (" + x + "," + y + ") channel " + c + ": a scatter tile is constant across the tile");
                        Assert.That(b2[c], Is.EqualTo(b[c]).Within(.01f), (banded ? "banded" : "plain") + " Sentenced tile (" + (x + 1) + "," + y + ") channel " + c + ": and its border is a hard step");
                    }
                }
                Assert.That(pairs, Is.GreaterThan(100), "the 20 x 19 floor has many neighbouring tiles of different families");
            }
        }

        [Test]
        public void TileOnlyMapsBakeTodaysPlaneAndNeedNoSoftPath_Guard()
        {
            // A map with no variants (any zone, with or without the Sentenced scatter), and a map with an all-zero plane.
            var cases = new List<MapBlob>();
            for (byte region = 1; region <= 5; region++) cases.Add(Zone(region));
            cases.Add(Zone(3, new byte[N * N]));   // an all-zero plane (the codec refuses a code above 8, so an unknown code cannot reach a map)
            foreach (var map in cases)
            {
                var inp = Inputs(map); var today = RegionGround.BakeVariants(map);
                Assert.That(inp.SoftActive, Is.False, "no band: the soft path stays off");
                Assert.That(inp.Tile.Length, Is.EqualTo(today.Length));
                for (int i = 0; i < today.Length; i++)
                    Assert.That(inp.Tile[i].r == today[i].r && inp.Tile[i].g == today[i].g && inp.Tile[i].b == today[i].b && inp.Tile[i].a == today[i].a, Is.True, "tile " + i + " of region " + map.Regions[0] + " is today's texel");
                Assert.That(inp.SoftGainAt(20.3f, 21.7f), Is.EqualTo(Vector3.one), "no soft band: neutral everywhere");
            }
        }

        [Test]
        public void AMapWithBandsStillBuildsAGroundAndTurnsTheVariantPathOn_Guard()
        {
            var plane = new byte[N * N]; Fill(plane, 15, 15, 25, 25, 8);
            var root = new GameObject("bands ground root");
            try
            {
                var ground = RegionGround.Create(root.transform, Zone(3, plane), 1f);
                Assert.That(ground.Material.GetFloat("_VariantOn"), Is.EqualTo(1f));
                ground.Dispose();
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }
    }
}

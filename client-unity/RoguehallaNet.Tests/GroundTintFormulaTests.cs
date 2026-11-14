using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Net.Ui;
using static Roguehalla.Net.Tests.GroundTintScreen;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-GROUND-TINT-1 (docs/backlog/packets/P-UNITY-GROUND-TINT-1.md): a ground tint modulates the ground's own shaded colour instead of replacing it.
    /// The shader applies the baked per-tile variant texel as  col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a)  (a per-channel gain), sampled at the tile's own
    /// coordinate; <see cref="GroundTint.Apply"/> mirrors it, <see cref="GroundTint.Bake"/> decides the texel. Today's shader replaces the colour
    /// (col = lerp(col, vt.rgb, vt.a)) at a warped coordinate, which on rendered pixels (packet "Established facts") gives band steps of 13 to 50 CIE76 units
    /// and keeps 10 to 80 percent of the tile's texture contrast; this file pins the screen numbers the brief asks for, through the mirror, on screen colours
    /// measured from the Web client and the capture tool (never on albedo). What the gate cannot do (render) is the coordinator's job with
    /// client-unity/UnityProject/Tools/ground-tint-measure.py on capture PNGs: edge position, texture contrast and step on real pixels.
    /// </summary>
    public sealed class GroundTintFormulaTests
    {
        // Variant codes the server's rules produce: 1 and 2 the fallback rings, 3 to 6 the landmark bands, 7 water, 8 mud.
        static readonly string[] Zones = { "fire", "sentenced", "plague", "frost", "holy" };

        // The measured "before" of the capture tool (ground-tint-measure.py on the *-var-codes.png frames of today's flat fill), per zone and code 1..8.
        static readonly double[][] BeforeDeltaE =
        {
            new[] { 13.18, 29.68, 36.40, 27.34, 37.23, 39.93, 45.48, 30.55 }, new[] { 15.74, 36.56, 35.82, 34.26, 40.12, 40.82, 44.13, 35.99 },
            new[] { 6.03, 20.40, 20.57, 25.04, 26.16, 24.73, 35.75, 19.99 }, new[] { 5.89, 3.18, 12.71, 8.33, 4.81, 10.29, 13.01, 18.23 },
            new[] { 9.69, 23.04, 10.64, 27.91, 31.48, 15.60, 50.40, 12.87 },
        };
        static readonly double[][] BeforeContrast =
        {
            new[] { .570, .332, .255, .300, .241, .258, .215, .196 }, new[] { .398, .262, .208, .220, .179, .163, .093, .107 },
            new[] { .622, .528, .801, .548, .657, .562, .368, .728 }, new[] { .813, .714, .635, .675, .593, .626, .483, .522 },
            new[] { .672, .459, .367, .502, .360, .369, .338, .379 },
        };

        /// <summary>The tint the tile at (tileX, tileY) of this zone bakes for this variant, or null when the tile draws the untouched ground.</summary>
        static GroundVariantTint? Texel(int region, byte variant, int x = 0, int y = 0)
        {
            return GroundTint.Bake(region, variant, x, y, out var t) ? t : (GroundVariantTint?)null;
        }

        /// <summary>A tile coordinate whose Sentenced family is f (the first by scan).</summary>
        internal static (int X, int Y) TileOfFamily(int f)
        {
            for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) if (SentencedTiles.Family(x, y) == f) return (x, y);
            throw new InvalidOperationException("no tile of family " + f + " in the first 64 x 64");
        }

        // ---- the formula --------------------------------------------------------------------------------------------------------------

        [Test]
        public void ATintIsAPerChannelGainTheSameWhateverTheGroundDrew()
        {
            // Modulating, not replacing: Apply(c) / c is one number per channel for every ground colour c (today's flat lerp gives a different ratio for every c).
            var grounds = new[] { new[] { .06f, .05f, .08f }, new[] { .30f, .50f, .20f }, new[] { .90f, .80f, .70f }, new[] { .15f, .40f, .65f } };
            foreach (int region in new[] { 1, 2, 3, 4, 5 })
                for (byte v = 1; v <= 8; v++)
                {
                    var t = Texel(region, v, 3, 5); Assert.That(t, Is.Not.Null, "region " + region + " variant " + v + " has a look");
                    double[] first = null;
                    foreach (var c in grounds)
                    {
                        var o = GroundTint.Apply(c[0], c[1], c[2], t.Value);
                        var ratio = new double[] { o[0] / c[0], o[1] / c[1], o[2] / c[2] };
                        if (first == null) { first = ratio; continue; }
                        for (int k = 0; k < 3; k++)
                            Assert.That(ratio[k], Is.EqualTo(first[k]).Within(1e-3), "region " + region + " variant " + v + " channel " + k + ": the tint's factor is " + first[k].ToString("F3") + " on ground (" + string.Join(", ", grounds[0]) + ") but " + ratio[k].ToString("F3")
                                + " on ground (" + string.Join(", ", c) + "): a flat fill (today's lerp toward the tint colour), not a gain; the shader line must be col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a)");
                    }
                }
        }

        [Test]
        public void TheNeutralByteAndZeroStrengthChangeNothingAndTheExtremesAreTheDocumentedGains()
        {
            var ground = new[] { .20f, .35f, .60f };
            foreach (var t in new[] { new GroundVariantTint(128, 128, 128, 1f), new GroundVariantTint(128, 128, 128, .4f), new GroundVariantTint(250, 10, 90, 0f), new GroundVariantTint(0, 0, 0, 0f) })
            {
                var o = GroundTint.Apply(ground[0], ground[1], ground[2], t);
                for (int k = 0; k < 3; k++) Assert.That(o[k], Is.EqualTo(ground[k]).Within(1e-4), "tint (" + t.R + "," + t.G + "," + t.B + ") strength " + t.Strength + " must leave channel " + k + " alone (gain 1): byte 128 is neutral at any strength and strength 0 is no tint");
            }
            var g1 = Gain(new GroundVariantTint(255, 64, 192, 1f));
            Assert.That(g1[0], Is.EqualTo(255 / 128.0).Within(.01), "strength 1, byte 255 doubles the channel (gain 255/128), got " + g1[0].ToString("F3"));
            Assert.That(g1[1], Is.EqualTo(.5).Within(.01), "strength 1, byte 64 halves it, got " + g1[1].ToString("F3"));
            Assert.That(g1[2], Is.EqualTo(1.5).Within(.01), "strength 1, byte 192 gives 1.5, got " + g1[2].ToString("F3"));
            var half = Gain(new GroundVariantTint(255, 64, 192, .5f));
            Assert.That(half[0], Is.EqualTo(1 + .5 * (255 / 128.0 - 1)).Within(.01), "strength .5 goes half way from 1 to the tint's gain, got " + half[0].ToString("F3"));
        }

        [Test]
        public void EveryLookIsABoundedStepNotABlackOrBlownTint()
        {
            // Bounds on the formula's parameters: each channel gain within [0.40, 1.99] (nothing goes black, nothing more than doubles); a hue band (3 to 6) keeps the
            // ground's overall brightness within [0.75, 1.30] of what it was (Rec.709 luminance weights): it moves hue, the rings (1, 2) and mud and water may move lightness.
            foreach (int region in new[] { 1, 2, 3, 4, 5 })
                for (byte v = 1; v <= 8; v++)
                {
                    var g = Gain(Texel(region, v, 3, 5).Value);
                    for (int k = 0; k < 3; k++) Assert.That(g[k], Is.InRange(.40, 1.99), "region " + region + " variant " + v + " channel " + k + " " + Gn(g));
                    if (v >= 3 && v <= 6) Assert.That(Luminance(g), Is.InRange(.75, 1.30), "region " + region + " variant " + v + " is a hue band: brightness factor " + Luminance(g).ToString("F2") + " (" + Gn(g) + ")");
                }
        }

        // ---- on screen colours ---------------------------------------------------------------------------------------------------------

        [Test]
        public void ADecorationBandIsAQuietStepOnScreenInEveryZone()
        {
            // The brief: mean colour difference between a band and its untinted neighbour 4 to 10 CIE76 units "on screen"; on the Web client's ground colours 4 to 10, on
            // the capture tool's (darker Fire and Plague) 2 to 10, and the chroma raised by at most 8 on both. Codes 1 to 6 in every zone.
            for (int z = 0; z < Zones.Length; z++)
                for (byte v = 1; v <= 6; v++)
                {
                    var t = Texel(z + 1, v, 3, 5).Value;
                    foreach (var (set, lo, scr) in new[] { ("Web", 4.0, Web[z].Rgb), ("capture", 2.0, CaptureTool[z].Rgb) })
                    {
                        var after = Through(scr, t);
                        double de = DeltaE(scr, after), dc = Chroma(after) - Chroma(scr);
                        string what = Zones[z] + " variant " + v + " on the " + set + " ground " + Rgb(scr) + " -> " + Rgb(after) + " (" + Gn(Gain(t)) + ")";
                        Assert.That(de, Is.InRange(lo, 10.0), what + ": step " + de.ToString("F1") + " CIE76 must be " + lo + " to 10 (today's flat fill measured " + BeforeDeltaE[z][v - 1].ToString("F1") + " on the capture renders)");
                        Assert.That(dc, Is.LessThanOrEqualTo(8.0), what + ": chroma raised by " + dc.ToString("F1") + " (at most 8)");
                    }
                }
        }

        [Test]
        public void WaterAndMudInPlagueStillReadAsWaterAndMud()
        {
            // Today (renders): water moves the grass to a blue-green teal, mud to a brown, by 36 and 20 CIE76 units on the capture ground. They may step more than a band: 8 to 25
            // on the Web ground, 5 to 25 on the (darker) capture ground, and they keep their direction: water turns the ground bluer (B/R at least 1.5 times what it was, and
            // R/G lower), mud browner (R/G at least 1.25 times and B/R at most 0.85 times).
            foreach (var (set, lo, scr) in new[] { ("Web", 8.0, Web[2].Rgb), ("capture", 5.0, CaptureTool[2].Rgb) })
            {
                var water = Through(scr, Texel(3, 7, 3, 5).Value); var mud = Through(scr, Texel(3, 8, 3, 5).Value);
                double dw = DeltaE(scr, water), dm = DeltaE(scr, mud);
                Assert.That(dw, Is.InRange(lo, 25.0), "plague water on the " + set + " ground " + Rgb(scr) + " -> " + Rgb(water) + ": step " + dw.ToString("F1") + " (today 35.8 on the capture renders)");
                Assert.That(dm, Is.InRange(lo, 25.0), "plague mud on the " + set + " ground " + Rgb(scr) + " -> " + Rgb(mud) + ": step " + dm.ToString("F1") + " (today 20.0 on the capture renders)");
                Assert.That(water[2] / water[0], Is.GreaterThanOrEqualTo(1.5 * scr[2] / scr[0]), "water on " + set + " ground: B/R " + (water[2] / water[0]).ToString("F2") + " against the ground's " + (scr[2] / scr[0]).ToString("F2") + " (needs 1.5 times)");
                Assert.That(water[0] / water[1], Is.LessThan(scr[0] / scr[1]), "water on " + set + " ground: R/G " + (water[0] / water[1]).ToString("F2") + " against the ground's " + (scr[0] / scr[1]).ToString("F2") + " (must fall)");
                Assert.That(mud[0] / mud[1], Is.GreaterThanOrEqualTo(1.25 * scr[0] / scr[1]), "mud on " + set + " ground: R/G " + (mud[0] / mud[1]).ToString("F2") + " against the ground's " + (scr[0] / scr[1]).ToString("F2") + " (needs 1.25 times)");
                Assert.That(mud[2] / mud[0], Is.LessThanOrEqualTo(.85 * scr[2] / scr[0]), "mud on " + set + " ground: B/R " + (mud[2] / mud[0]).ToString("F2") + " against the ground's " + (scr[2] / scr[0]).ToString("F2") + " (needs 0.85 times or less)");
            }
        }

        [Test]
        public void TheGroundsTextureSurvivesEveryTint()
        {
            // The texture range inside a tile (slab bevel against face, grout against stone, grass blades) as the lightness gap between its dark and light pixels. Through the
            // tint that gap must stay at least 75 percent of the untinted gap. (The brief asks 80 percent of the standard deviation on rendered tiles, which the coordinator's script
            // measures; this two-pixel proxy is steeper near black, where L* is linear in light, so a darkening tint on the darkest Sentenced pixels loses more of it: 75.)
            for (int z = 0; z < Zones.Length; z++)
            {
                var (_, lo, hi) = TextureRange[z]; double gap = LStar(hi) - LStar(lo);
                for (byte v = 1; v <= 8; v++)
                {
                    if (v >= 7 && z != 2) continue;   // water and mud exist in Plague
                    var t = Texel(z + 1, v, 3, 5).Value;
                    double gap2 = LStar(Through(hi, t)) - LStar(Through(lo, t));
                    Assert.That(gap2 / gap, Is.GreaterThanOrEqualTo(.75), Zones[z] + " variant " + v + ": the lightness gap between the tile's dark " + Rgb(lo) + " and light " + Rgb(hi) + " pixels goes from " + gap.ToString("F1") + " to " + gap2.ToString("F1")
                        + " L* (" + (100 * gap2 / gap).ToString("F0") + " percent; today's flat fill keeps " + (100 * BeforeContrast[z][v - 1]).ToString("F0") + " percent of the std of L* on the capture renders)");
                }
            }
        }

        // ---- one texel per tile: a server variant and a scatter family together ------------------------------------------------------------

        [Test]
        public void ComposeIsTheProductOfTheTwoGainsAndKeepsNoChangeAsNoChange()
        {
            var none = new GroundVariantTint(128, 128, 128, 0f);
            var a = new GroundVariantTint(220, 90, 60, .35f); var b = new GroundVariantTint(150, 110, 200, .8f); var c = new GroundVariantTint(255, 40, 40, 1f);
            foreach (var (x, y) in new[] { (a, b), (b, a), (a, c), (c, b), (a, none), (none, a), (none, none) })
            {
                var gx = Gain(x); var gy = Gain(y); var gc = Gain(GroundTint.Compose(x, y));
                for (int k = 0; k < 3; k++)
                {
                    double want = Math.Min(255 / 128.0, Math.Max(0, gx[k] * gy[k]));
                    Assert.That(gc[k], Is.EqualTo(want).Within(.02 * Math.Max(.5, want)), "channel " + k + ": Compose of gains " + gx[k].ToString("F3") + " and " + gy[k].ToString("F3") + " gives " + gc[k].ToString("F3") + ", the product is " + want.ToString("F3") + " (clamped to 255/128)");
                }
            }
        }

        [Test]
        public void BakeOutsideSentencedIsTheServersVariantAndNothingElse()
        {
            foreach (int region in new[] { 1, 3, 4, 5 })
                foreach (var (x, y) in new[] { (0, 0), (7, 3), (33, 90) })
                {
                    Assert.That(Texel(region, 0, x, y), Is.Null, "region " + region + " variant 0 at (" + x + "," + y + ") is the base ground");
                    for (byte v = 1; v <= 8; v++)
                    {
                        Assert.That(GroundVariantLook.TryGet(region, v, out var want), Is.True);
                        var got = Texel(region, v, x, y).Value;
                        Assert.That((got.R, got.G, got.B, Math.Round(got.Strength * 255)), Is.EqualTo((want.R, want.G, want.B, Math.Round(want.Strength * 255))), "region " + region + " variant " + v + " at (" + x + "," + y + ") bakes the server's look unchanged");
                    }
                    foreach (byte unknown in new byte[] { 9, 12, 255 }) Assert.That(Texel(region, unknown, x, y), Is.Null, "region " + region + " unknown variant " + unknown + " draws the base ground");
                }
            foreach (int region in new[] { 0, 6, 7 }) Assert.That(Texel(region, 3, 4, 4), Is.Null, "region " + region + " has no variant look");
        }

        [Test]
        public void ASentencedTileBakesItsFamilyAndAServerVariantComposesWithIt()
        {
            int scatterTiles = 0, bandTiles = 0;
            for (int f = 0; f < SentencedTiles.FamilyCount; f++)
            {
                var (x, y) = TileOfFamily(f);
                var fam = SentencedTiles.Tint(f); var famGain = Gain(fam);
                var plain = Texel(2, 0, x, y);
                if (f == SentencedTiles.Base) { Assert.That(plain, Is.Null, "a base-family Sentenced tile with no variant draws the untouched ground"); }
                else
                {
                    Assert.That(plain, Is.Not.Null, "a Sentenced tile of family " + f + " (" + x + "," + y + ") with no server variant bakes its family (today: nothing)");
                    var g = Gain(plain.Value);
                    for (int k = 0; k < 3; k++) Assert.That(g[k], Is.EqualTo(famGain[k]).Within(.02), "family " + f + " channel " + k + " " + Gn(g) + " against Tint(" + f + ") " + Gn(famGain));
                    scatterTiles++;
                }
                for (byte v = 1; v <= 8; v++)
                {
                    GroundVariantLook.TryGet(2, v, out var band);
                    var both = Texel(2, v, x, y).Value; var gb = Gain(both); var gBand = Gain(band);
                    for (int k = 0; k < 3; k++)
                    {
                        double want = Math.Min(255 / 128.0, gBand[k] * famGain[k]);
                        Assert.That(gb[k], Is.EqualTo(want).Within(.02 * Math.Max(.5, want)), "Sentenced variant " + v + " on a family " + f + " tile, channel " + k + ": gain " + gb[k].ToString("F3") + ", the band's " + gBand[k].ToString("F3") + " times the family's " + famGain[k].ToString("F3") + " is " + want.ToString("F3")
                            + " (today the server's variant replaces the family)");
                    }
                    bandTiles++;
                }
            }
            Assert.That(scatterTiles, Is.GreaterThanOrEqualTo(3), "at least the grey, the brown and the purple family bake a tint");
            Assert.That(bandTiles, Is.EqualTo(SentencedTiles.FamilyCount * 8));
            // an unknown server variant is ignored but the family still shows
            var (ux, uy) = TileOfFamily(SentencedTiles.Brown);
            Assert.That(Texel(2, 12, ux, uy), Is.Not.Null, "an unknown variant on a brown Sentenced tile draws the family");
        }

        [Test]
        public void TheBakeIsAPureFunctionOfRegionVariantAndTileCoordinates()
        {
            var first = new Dictionary<(int, int, byte), (bool, byte, byte, byte, float)>();
            for (int y = 0; y < 40; y++) for (int x = 0; x < 40; x++)
                foreach (byte v in new byte[] { 0, 3, 8, 12 })
                { bool has = GroundTint.Bake(2, v, x, y, out var t); first[(x, y, v)] = (has, t.R, t.G, t.B, t.Strength); }
            for (int y = 39; y >= 0; y--) for (int x = 39; x >= 0; x--)   // the other way round: no state carries from one call to the next
                foreach (byte v in new byte[] { 12, 8, 3, 0 })
                {
                    bool has = GroundTint.Bake(2, v, x, y, out var t);
                    Assert.That((has, t.R, t.G, t.B, t.Strength), Is.EqualTo(first[(x, y, v)]), "tile (" + x + "," + y + ") variant " + v + " baked differently when asked in the other order");
                }
        }

        // ---- the shader itself (a rendering test cannot run under the gate's -nographics: Graphics.Blit and ReadPixels return garbage there) ----------------

        static string VariantBlock()
        {
            string path = Path.Combine(Util.RepoRoot(), "client-unity", "UnityProject", "Assets", "Resources", "Regions", "RegionGround.shader");
            string src = File.ReadAllText(path);
            int at = src.IndexOf("_VariantOn > 0.5", StringComparison.Ordinal);
            Assert.That(at, Is.GreaterThan(0), "the ground shader's variant path (if _VariantOn > 0.5) is gone");
            int open = src.IndexOf('{', at), depth = 0, i = open;
            for (; i < src.Length; i++) { if (src[i] == '{') depth++; else if (src[i] == '}' && --depth == 0) break; }
            return Regex.Replace(src.Substring(open, i - open + 1), @"//[^\n]*", "");
        }

        static string Squash(string s) { return Regex.Replace(s, @"\s+", " ").Replace("( ", "(").Replace(" )", ")"); }

        [Test]
        public void TheShadersVariantPathIsTheMultiplyAndNotTheFlatLerp()
        {
            string block = Squash(VariantBlock());
            Assert.That(block, Does.Not.Contain("lerp(col, vt.rgb"), "the variant path still replaces the colour with lerp(col, vt.rgb, vt.a): " + block);
            bool canonical = block.Contains("col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);") || block.Contains("col *= lerp(float3(1.0, 1.0, 1.0), vt.rgb * (255.0 / 128.0), vt.a);")
                || block.Contains("col *= lerp(float3(1, 1, 1), vt.rgb * (255.0 / 128.0), vt.a);");
            Assert.That(canonical, Is.True, "the variant path must contain  col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);  (the formula GroundTint.Apply mirrors); it reads: " + block);
        }

        [Test]
        public void TheShadersVariantTileIsSampledAtTheTilesOwnCoordinateSoEdgesFollowTileBoundaries()
        {
            string block = Squash(VariantBlock());
            Assert.That(block, Does.Not.Contain("warp"), "the variant sample coordinate still takes the region-border warp (today: floor(t + warp * 0.35)), so a band's edge wobbles by up to 0.4 tile across the slabs (renders: 0.05 to 0.40 tile peak to peak): " + block);
            Assert.That(block, Does.Contain("floor(t)"), "the variant texel is the one of the tile the pixel is in: (floor(t) + 0.5) / _Map.xy; it reads: " + block);
            Assert.That(block, Does.Contain("SAMPLE_TEXTURE2D_LOD(_VariantTex, sampler_TempleTex"), "the variant plane keeps its sampler (the shader is at the 16 sampler limit of the Web target): " + block);
        }
    }
}

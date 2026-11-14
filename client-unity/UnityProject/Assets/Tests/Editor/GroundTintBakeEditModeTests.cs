using System;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-GROUND-TINT-1 oracle, Unity half (docs/backlog/packets/P-UNITY-GROUND-TINT-1.md): what RegionGround.BakeVariants writes into the variant plane. The
    /// numbers of the look live in RoguehallaNet.Tests (GroundTintFormulaTests, SentencedFamiliesTests) through the engine-free GroundTint.Bake; this half pins that
    /// the plane carries exactly what Bake decides, that a Sentenced map shows its scatter even without a server plane (the owner's request) and combined with a server band
    /// (the round 10 finding: the band used to replace it), and that no other zone is touched. Rendering cannot be tested here: under the gate's -batchmode -nographics
    /// SystemInfo.graphicsDeviceType is Null and Graphics.Blit then ReadPixels returns one constant garbage colour (probed for the packet), so edges, contrast and the
    /// step on real pixels are measured by client-unity/UnityProject/Tools/ground-tint-measure.py on capture PNGs, by the coordinator.
    /// Existing guards that must stay green unamended: DressedMapEditModeTests (a variant tile bakes GroundVariantLook.TryGet's rgb and round(strength * 255) in Plague and
    /// Frost), DressedMap2EditModeTests (water and mud on Plague), RegionShaderWebCompileEditModeTests (at most 16 samplers).
    /// </summary>
    public sealed class GroundTintBakeEditModeTests
    {
        static MapBlob Zone(byte region, int n = 40) { var regions = Enumerable.Repeat(region, n * n).ToArray(); return new MapBlob((ushort)n, (ushort)n, new byte[n * n], null, regions); }

        static Color32 Texel(GroundVariantTint t) { return new Color32(t.R, t.G, t.B, (byte)Mathf.RoundToInt(Mathf.Clamp01(t.Strength) * 255f)); }

        static void AssertTexel(Color32 got, Color32 want, string what)
        {
            Assert.That((int)got.r, Is.EqualTo((int)want.r), what + " r"); Assert.That((int)got.g, Is.EqualTo((int)want.g), what + " g");
            Assert.That((int)got.b, Is.EqualTo((int)want.b), what + " b"); Assert.That((int)got.a, Is.EqualTo((int)want.a), what + " strength");
        }

        [Test]
        public void ASentencedMapWithoutAServerPlaneBakesTheScatterAndTurnsTheVariantPathOn()
        {
            var map = Zone(2); var baked = RegionGround.BakeVariants(map);
            Assert.That(baked.Length, Is.EqualTo(40 * 40));
            int tinted = 0; var seen = new System.Collections.Generic.HashSet<int>();
            for (int i = 0; i < baked.Length; i++)
            {
                int x = i % 40, y = i / 40, f = SentencedTiles.Family(x, y); seen.Add(f);
                bool has = GroundTint.Bake(2, 0, x, y, out var t);
                Assert.That(has, Is.EqualTo(f != SentencedTiles.Base), "tile (" + x + "," + y + ") of family " + f + ": a base tile draws the ground, any other bakes its family");
                if (has) { AssertTexel(baked[i], Texel(t), "tile (" + x + "," + y + ") family " + f); tinted++; }
                else Assert.That(baked[i].a, Is.EqualTo((byte)0), "base-family tile (" + x + "," + y + ")");
            }
            Assert.That(seen.Count, Is.EqualTo(SentencedTiles.FamilyCount), "every family appears on a 40 x 40 floor");
            Assert.That(tinted, Is.InRange(40 * 40 * .30, 40 * 40 * .50), "between 30 and 50 percent of the floor carries a family (today 0 of " + 40 * 40 + ": a Sentenced map with no plane bakes nothing)");
            var root = new GameObject("tint ground root");
            try
            {
                var ground = RegionGround.Create(root.transform, map, 1f);
                Assert.That(ground.Material.GetFloat("_VariantOn"), Is.EqualTo(1f), "the variant path is on for a Sentenced map without a server plane (the scatter needs it)");
                ground.Dispose();
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        [Test]
        public void ABandedSentencedTileBakesTheBandComposedWithItsFamily()
        {
            var map = Zone(2); var plane = new byte[40 * 40];
            for (int i = 0; i < plane.Length; i++) plane[i] = (byte)(i % 9);     // variants 0..8 across the floor, no pattern the family could line up with
            map = map.WithPublic(null, null, null, null, plane);
            var baked = RegionGround.BakeVariants(map);
            int both = 0;
            for (int i = 0; i < baked.Length; i++)
            {
                int x = i % 40, y = i / 40; byte v = plane[i]; int f = SentencedTiles.Family(x, y);
                bool has = GroundTint.Bake(2, v, x, y, out var t);
                if (!has) { Assert.That(baked[i].a, Is.EqualTo((byte)0), "tile (" + x + "," + y + ") variant " + v + " family " + f + " draws the ground"); continue; }
                AssertTexel(baked[i], Texel(t), "tile (" + x + "," + y + ") variant " + v + " family " + f);
                if (v != 0 && f != SentencedTiles.Base)
                {
                    both++;
                    // per channel gain of the baked texel = the band's gain times the family's, through the mirror (what the shader does to a mid grey)
                    GroundVariantLook.TryGet(2, v, out var band); var fam = SentencedTiles.Tint(f);
                    var gBand = GroundTint.Apply(.5f, .5f, .5f, band); var gFam = GroundTint.Apply(.5f, .5f, .5f, fam); var gBoth = GroundTint.Apply(.5f, .5f, .5f, t);
                    for (int k = 0; k < 3; k++)
                    {
                        double want = Math.Min(255 / 128.0, (gBand[k] / .5) * (gFam[k] / .5)), got = gBoth[k] / .5;
                        Assert.That(got, Is.EqualTo(want).Within(.02 * Math.Max(.5, want)), "tile (" + x + "," + y + ") variant " + v + " family " + f + " channel " + k + ": baked gain " + got.ToString("F3") + " against band x family " + want.ToString("F3") + " (today the band's look replaces the family's)");
                    }
                }
            }
            Assert.That(both, Is.GreaterThan(100), "the floor has tiles with both a band and a family (" + both + ")");
        }

        [Test]
        public void OtherZonesBakeOnlyTheServersVariantAndNeverAScatter()
        {
            foreach (byte region in new byte[] { 1, 3, 4, 5 })
            {
                var none = RegionGround.BakeVariants(Zone(region));
                Assert.That(none.All(c => c.a == 0), Is.True, "region " + region + " without a variant plane bakes nothing (the scatter is Sentenced only)");
                var plane = new byte[40 * 40];
                for (int i = 0; i < plane.Length; i++) plane[i] = (byte)(i % 9);
                var baked = RegionGround.BakeVariants(Zone(region).WithPublic(null, null, null, null, plane));
                for (int i = 0; i < baked.Length; i++)
                {
                    if (plane[i] == 0) { Assert.That(baked[i].a, Is.EqualTo((byte)0), "region " + region + " tile " + i + " variant 0 is the base ground"); continue; }
                    GroundVariantLook.TryGet(region, plane[i], out var want);
                    AssertTexel(baked[i], Texel(want), "region " + region + " variant " + plane[i] + " tile " + i + " bakes the server's look unchanged");
                }
            }
        }

        [Test]
        public void ATilesTexelDoesNotDependOnTheMapItIsIn()
        {
            // The family is a function of the tile's coordinates, not of the map's size or origin: the same tile bakes the same texel in a 40 and a 64 wide map, and baking twice agrees.
            var small = RegionGround.BakeVariants(Zone(2, 40)); var large = RegionGround.BakeVariants(Zone(2, 64)); var again = RegionGround.BakeVariants(Zone(2, 40));
            for (int y = 0; y < 40; y++)
                for (int x = 0; x < 40; x++)
                {
                    AssertTexel(large[y * 64 + x], small[y * 40 + x], "tile (" + x + "," + y + ") in a 64 wide map against a 40 wide map");
                    AssertTexel(again[y * 40 + x], small[y * 40 + x], "tile (" + x + "," + y + ") baked twice");
                }
        }
    }
}

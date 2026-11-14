using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-SENTENCED-TILES-1, the pixel side. RoguehallaNet.Tests/SentencedTilesTests.cs pins the tile choice and the family colours;
    /// this file pins that the ground the client draws FOLLOWS them: RegionGround.BakeVariants (the plane the ground shader already samples as
    /// _VariantTex, one texel per tile) carries SentencedTiles.Tint(SentencedTiles.Family(x, y)) on every Sentenced tile, so the choice
    /// lives in engine-free C# and the shader gets no new texture, sampler or hash (P-UNITY-GROUND-SAMPLERS-1 is removing samplers from it).
    /// It also pins the wall-top readability against the mix, and guards what must not move. Run through Tools/editmode.sh.
    /// </summary>
    public sealed class SentencedTilesEditModeTests
    {
        const int Sentenced = 2;

        static MapBlob Map(int w, int h, byte region)
        {
            var tiles = new byte[w * h]; for (int i = 0; i < tiles.Length; i++) tiles[i] = MapBlob.Floor;
            var regions = new byte[w * h]; for (int i = 0; i < regions.Length; i++) regions[i] = region;
            return new MapBlob((ushort)w, (ushort)h, tiles, new byte[w * h], regions);
        }

        static Color32 Texel(GroundVariantTint t) { return new Color32(t.R, t.G, t.B, (byte)Mathf.RoundToInt(t.Strength * 255f)); }

        static void AssertTexel(Color32 got, int x, int y, string what)
        {
            int f = SentencedTiles.Family(x, y); var t = SentencedTiles.Tint(f);
            string at = what + ": tile (" + x + "," + y + ") family " + f + " got " + got;
            if (f == SentencedTiles.Base || t.Strength == 0f) { Assert.That(got.a, Is.EqualTo((byte)0), at + ", the base family bakes no tint (strength 0)"); return; }
            var want = Texel(t);
            Assert.That((int)got.r, Is.EqualTo((int)want.r).Within(1), at + " want " + want); Assert.That((int)got.g, Is.EqualTo((int)want.g).Within(1), at + " want " + want);
            Assert.That((int)got.b, Is.EqualTo((int)want.b).Within(1), at + " want " + want); Assert.That((int)got.a, Is.EqualTo((int)want.a).Within(1), at + " want " + want);
        }

        // ---- the pixels follow the engine-free choice -------------------------------------------------------------------------

        [Test]
        public void EverySentencedTileBakesItsFamilysTintWithoutAServerVariantPlane()
        {
            var px = RegionGround.BakeVariants(Map(96, 80, Sentenced));
            Assert.That(px.Length, Is.EqualTo(96 * 80), "one texel per tile");
            int tinted = px.Count(c => c.a != 0);
            Assert.That(tinted, Is.GreaterThan(96 * 80 / 5), "tinted texels " + tinted + " of " + 96 * 80 + " (today 0: the plane is empty without a server variant); the non-base families are about 38% of the tiles");
            for (int y = 0; y < 80; y++) for (int x = 0; x < 96; x++) AssertTexel(px[y * 96 + x], x, y, "96 x 80 Sentenced map");
        }

        [Test]
        public void ATilesBakedFamilyDoesNotDependOnTheMapSize()
        {
            var small = RegionGround.BakeVariants(Map(40, 40, Sentenced)); var big = RegionGround.BakeVariants(Map(160, 120, Sentenced));
            Assert.That(small.Count(c => c.a != 0), Is.GreaterThan(0), "the small map has tinted tiles (today none)");
            for (int y = 0; y < 40; y++) for (int x = 0; x < 40; x++) Assert.That(small[y * 40 + x], Is.EqualTo(big[y * 160 + x]), "tile (" + x + "," + y + ") differs between a 40 x 40 and a 160 x 120 map");
        }

        [Test]
        public void OnlySentencedTilesGetAFamilyTintAndTheOtherRegionsBakeNothing()
        {
            foreach (byte region in new byte[] { 0, 1, 3, 4, 5, 6 })
                Assert.That(RegionGround.BakeVariants(Map(40, 40, region)).All(c => c.a == 0), Is.True, "region " + region + " without a server variant plane draws today's ground (no tint)");
            // A mixed map: left half Sentenced, right half Plague.
            int w = 64, h = 32; var map = Map(w, h, Sentenced); var regions = (byte[])map.Regions.Clone();
            for (int y = 0; y < h; y++) for (int x = w / 2; x < w; x++) regions[y * w + x] = 3;
            var mixed = new MapBlob((ushort)w, (ushort)h, map.Tiles, new byte[w * h], regions); var px = RegionGround.BakeVariants(mixed);
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                if (x < w / 2) AssertTexel(px[y * w + x], x, y, "Sentenced half"); else Assert.That(px[y * w + x].a, Is.EqualTo((byte)0), "Plague tile (" + x + "," + y + ") must stay untinted");
        }

        [Test]
        public void GuardAServerGroundVariantOnASentencedTileKeepsItsLook()
        {
            // The server's rings and landmark bands (GroundVariantLook) are not replaced by the family tint. (Which wins where both exist is the
            // implementer's choice only for the tile; this pins the existing behaviour: a tile with a variant bakes exactly that variant's look.)
            int w = 48, h = 48; var plane = new byte[w * h]; var cells = new[] { (3, 3, (byte)1), (4, 3, (byte)2), (5, 3, (byte)3), (6, 3, (byte)4), (7, 3, (byte)5), (8, 3, (byte)6) };
            foreach (var c in cells) plane[c.Item2 * w + c.Item1] = c.Item3;
            var px = RegionGround.BakeVariants(Map(w, h, Sentenced).WithPublic(null, null, null, null, plane));
            foreach (var c in cells)
            {
                Assert.That(GroundVariantLook.TryGet(Sentenced, c.Item3, out var look), Is.True);
                Assert.That(px[c.Item2 * w + c.Item1], Is.EqualTo(Texel(look)), "Sentenced tile (" + c.Item1 + "," + c.Item2 + ") with server variant " + c.Item3);
            }
        }

        [Test]
        public void TheGroundShaderIsSwitchedOnForASentencedMapWithoutServerVariantsAndStaysOffElsewhere()
        {
            var root = new GameObject("sentenced tiles ground root");
            try
            {
                var sent = RegionGround.Create(root.transform, Map(40, 40, Sentenced), 1f);
                Assert.That(sent.Material.GetFloat("_VariantOn"), Is.EqualTo(1f), "_VariantOn for a Sentenced map with no server variants (today 0, so the shader would never read the family tints)");
                var tex = sent.Material.GetTexture("_VariantTex"); Assert.That((tex.width, tex.height), Is.EqualTo((40, 40)), "the same one-texel-per-tile plane, no extra texture");
                sent.Dispose();
                var plague = RegionGround.Create(root.transform, Map(40, 40, 3), 1f);
                Assert.That(plague.Material.GetFloat("_VariantOn"), Is.EqualTo(0f), "a map with no Sentenced tile and no server variant costs no extra sample");
                plague.Dispose();
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        // ---- colours the client really uses ------------------------------------------------------------------------------------

        [Test]
        public void ThePinnedBaseStoneIsTheSentencedPaletteBase()
        {
            var b = RegionThemes.Get(RegionId.Sentenced).BaseSrgb;
            Assert.That((b.r, b.g, b.b), Is.EqualTo(((byte)31, (byte)30, (byte)37)), "SentencedTilesTests.cs measures every family against (31, 30, 37); if the palette base moves, move that constant with it");
        }

        // ---- walls stay readable on every tile tint ----------------------------------------------------------------------------

        // Same measurement as RegionThemeEditModeTests.SentencedWallTopTextureReadsAgainstTheFloor (WCAG ratio on the generated wall atlas), but against the
        // mix instead of the bare base. Floor luminance of the mix = share-weighted mean of the families' linear luminance (albedo model in SentencedTilesTests).
        static double Lin(double v) { return v <= .04045 ? v / 12.92 : Math.Pow((v + .055) / 1.055, 2.4); }
        static double Luminance(double r, double g, double b) { return .2126 * Lin(r) + .7152 * Lin(g) + .0722 * Lin(b); }
        static double Ratio(double a, double b) { double hi = Math.Max(a, b), lo = Math.Min(a, b); return (hi + .05) / (lo + .05); }

        static double AlbedoLuminance(int family)
        {
            var t = SentencedTiles.Tint(family); double s = t.Strength; var b = RegionThemes.Get(RegionId.Sentenced).BaseSrgb;
            return Luminance((b.r * (1 - s) + t.R * s) / 255.0, (b.g * (1 - s) + t.G * s) / 255.0, (b.b * (1 - s) + t.B * s) / 255.0);
        }

        static double MeanFloorLuminance()
        {
            var n = new double[SentencedTiles.FamilyCount]; const int N = 256;
            for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) n[SentencedTiles.Family(x, y)]++;
            double sum = 0; for (int f = 0; f < n.Length; f++) sum += n[f] / (N * N) * AlbedoLuminance(f);
            return sum;
        }

        static double LightestFloorLuminance() { return Enumerable.Range(0, SentencedTiles.FamilyCount).Max(AlbedoLuminance); }

        static double[] WallTopLuminances()
        {
            var set = RegionWallAtlas.SetFor(WallStyle.Timber); var atlas = RegionWallAtlas.Atlas; var all = atlas.GetPixels32(); var o = new double[set.Top.Length];
            for (int v = 0; v < set.Top.Length; v++)
            {
                int x0 = Mathf.RoundToInt(set.Top[v].Min.x * atlas.width), y0 = Mathf.RoundToInt(set.Top[v].Min.y * atlas.height);
                double r = 0, g = 0, b = 0; int n = 0;
                for (int y = 0; y < RegionWallAtlas.TopH; y++) for (int x = 0; x < RegionWallAtlas.TileW; x++)
                { var c = all[(y0 + y) * atlas.width + x0 + x]; if (c.a >= 250) { r += c.r / 255.0; g += c.g / 255.0; b += c.b / 255.0; n++; } }
                Assert.That(n, Is.GreaterThan(0), "wall top variant " + v + " has no opaque pixels");
                o[v] = Luminance(r / n, g / n, b / n);
            }
            return o;
        }

        // Today the wall top variants read against the bare base at 3.19:1 to 5.62:1 (WCAG, measured on the Timber atlas: top luminances .153 to .307 against .0135), and the
        // existing test asks 3:1 of the bare base. The mix may eat a little of that margin: at least 2.9:1 over the mean floor and 2.4:1 over the lightest tint (at 2.4 the lightest tint is at most luminance .034, L* 21).
        const double MeanRatio = 2.9, LightestRatio = 2.4;

        [Test]
        public void TheWallTopStillReadsAgainstTheMeanFloorAndClearlyAgainstTheLightestTint()
        {
            double mean = MeanFloorLuminance(), lightest = LightestFloorLuminance(); var tops = WallTopLuminances();
            var b = RegionThemes.Get(RegionId.Sentenced).BaseSrgb; double bare = Luminance(b.r / 255.0, b.g / 255.0, b.b / 255.0);
            for (int v = 0; v < tops.Length; v++)
            {
                Assert.That(Ratio(tops[v], mean), Is.GreaterThanOrEqualTo(MeanRatio), "Sentenced wall top variant " + v + " luminance " + tops[v].ToString("F4") + " against the mean floor " + mean.ToString("F4") + " (bare base " + bare.ToString("F4") + ", today's ratio " + Ratio(tops[v], bare).ToString("F2") + ":1)");
                Assert.That(Ratio(tops[v], lightest), Is.GreaterThanOrEqualTo(LightestRatio), "Sentenced wall top variant " + v + " against the lightest floor tint " + lightest.ToString("F4") + " measured " + Ratio(tops[v], lightest).ToString("F2") + ":1 (bare base " + Ratio(tops[v], bare).ToString("F2") + ":1)");
            }
            Assert.That(lightest, Is.GreaterThan(bare * 1.4), "the lightest tint luminance " + lightest.ToString("F4") + " must be clearly lighter than the bare base " + bare.ToString("F4") + " (today equal: no lighter tint exists)");
        }

        // ---- guards ----------------------------------------------------------------------------------------------------------

        [Test]
        public void GuardTheOtherZonesGroundParametersAreUnchanged()
        {
            void P(int id, Vector4 a, Vector4 b)
            {
                var th = RegionThemes.Get(id);
                Assert.That(th.GroundParams, Is.EqualTo(a), "region " + id + " GroundParams"); Assert.That(th.GroundParams2, Is.EqualTo(b), "region " + id + " GroundParams2");
            }
            P(0, new Vector4(.55f, .40f, 0, 0), new Vector4(.12f, 0, .35f, 0)); P(6, new Vector4(.55f, .40f, 0, 0), new Vector4(.12f, 0, .35f, 0));
            P(1, new Vector4(.70f, .30f, .22f, 0), new Vector4(.40f, .22f, 0, 0));
            P(3, new Vector4(.80f, .50f, .30f, RegionPocket.PlagueThreshold), new Vector4(.32f, .45f, 0, 0));
            P(4, new Vector4(.30f, .24f, 0f, 0), new Vector4(.16f, 0f, 1.9f, .75f));
            P(5, new Vector4(.40f, 0f, .35f, RegionPocket.HolyThreshold), new Vector4(.20f, .25f, .8f, .25f));
        }

        [Test]
        public void GuardNamesStillFollowOneSurfaceKindForAllSentencedFloor()
        {
            // Names pick their dark or light form from the SurfaceKind under them (P-UNITY-NAME-LEGIBLE-1), not from a tile's colour: every Sentenced tile
            // stays Flagstone whatever its family, so a name standing still cannot flip between tiles.
            Assert.That(SurfaceMap.DefaultFor(RegionId.Sentenced), Is.EqualTo(SurfaceKind.Flagstone));
        }
    }
}

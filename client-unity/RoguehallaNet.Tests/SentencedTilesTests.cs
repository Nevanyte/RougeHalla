using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-SENTENCED-TILES-1: the Sentenced zone's floor tiles take one of several stone tints, chosen per tile by a pure function of the
    /// tile coordinates (<see cref="SentencedTiles"/>). Owner direction 2026-11-13: "some more tile random variance could help, with dark
    /// lighting it could still work, perhaps some brown tiles, lighter greys some purples all randomly dispersed (should still be relatively dark)".
    /// Legacy (packages/client/src/render/zoneArt/zoneStyle.ts:28-32, palette.ts:32-35) has only two greys: floor 0x3a3b42 and floorAlt 0x44454d on tiles where
    /// bits(hash, 0, 2) === 0 (one in four); no brown or purple. This is by owner direction, a presentation DEVIATIONS row.
    ///
    /// Albedo model used by every colour rule: the ground shader blends a baked tint over the ground it drew, in raw sRGB bytes
    /// (RegionGround.shader "col = lerp(col, vt.rgb, vt.a)"), and that ground is the zone base (31, 30, 37) times the slab detail (about 1), so a
    /// family's albedo is lerp(base, tint rgb, strength) per channel in sRGB bytes. Lightness is CIE L* of that colour (perceptual, so "within 10 percent"
    /// means what the eye sees; in linear luminance 10 percent is invisible on a floor this dark). The zone's dim light is a neutral
    /// 0.4 multiplier on linear albedo; a lamp is the Sentenced Key colour (231, 196, 153) as a linear multiplier.
    /// </summary>
    public sealed class SentencedTilesTests
    {
        static readonly double[] Base = { 31, 30, 37 };
        const int Block = 256;

        // ---- colour maths ------------------------------------------------------------------------------------------------------

        static double Lin(double v) { v /= 255.0; return v <= .04045 ? v / 12.92 : Math.Pow((v + .055) / 1.055, 2.4); }
        static double F(double t) { return t > 216.0 / 24389 ? Math.Pow(t, 1.0 / 3) : (24389.0 / 27 * t + 16) / 116; }

        static double[] Lab(double[] c, double[] k)
        {
            double r = Lin(c[0]) * k[0], g = Lin(c[1]) * k[1], b = Lin(c[2]) * k[2];
            double x = .4124564 * r + .3575761 * g + .1804375 * b, y = .2126729 * r + .7151522 * g + .0721750 * b, z = .0193339 * r + .1191920 * g + .9503041 * b;
            double fx = F(x / .95047), fy = F(y), fz = F(z / 1.08883);
            return new[] { 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz) };
        }

        static readonly double[] Neutral = { 1, 1, 1 };
        static readonly double[] Dim = { .4, .4, .4 };
        static readonly double[] Lamp = { Lin(231), Lin(196), Lin(153) };

        static double LStar(double[] c) { return Lab(c, Neutral)[0]; }

        static double DeltaE(double[] a, double[] b, double[] light)
        {
            double[] x = Lab(a, light), y = Lab(b, light);
            return Math.Sqrt((x[0] - y[0]) * (x[0] - y[0]) + (x[1] - y[1]) * (x[1] - y[1]) + (x[2] - y[2]) * (x[2] - y[2]));
        }

        static double[] Albedo(int family)
        {
            var t = SentencedTiles.Tint(family); double s = t.Strength;
            return new[] { Base[0] * (1 - s) + t.R * s, Base[1] * (1 - s) + t.G * s, Base[2] * (1 - s) + t.B * s };
        }

        static string Rgb(double[] c) { return "(" + c[0].ToString("F1") + ", " + c[1].ToString("F1") + ", " + c[2].ToString("F1") + ")"; }

        // ---- the sampled floor -------------------------------------------------------------------------------------------------

        static int[,] Grid(int x0, int y0)
        {
            var g = new int[Block, Block];
            for (int y = 0; y < Block; y++) for (int x = 0; x < Block; x++) g[x, y] = SentencedTiles.Family(x0 + x, y0 + y);
            return g;
        }

        static readonly (int X, int Y)[] Origins = { (0, 0), (3000, -2000) };

        static double[] Shares(int[,] g)
        {
            var s = new double[SentencedTiles.FamilyCount];
            foreach (int f in g) { Assert.That(f, Is.InRange(0, SentencedTiles.FamilyCount - 1), "family index out of range"); s[f]++; }
            for (int i = 0; i < s.Length; i++) s[i] /= Block * Block;
            return s;
        }

        static string Pct(double[] s) { return string.Join(" / ", s.Select(v => (v * 100).ToString("F1") + "%")); }

        // ---- families and proportions ------------------------------------------------------------------------------------------

        [Test]
        public void ThereAreAtLeastFourFamiliesAndTheBaseFamilyIsTheZonesOwnStoneUntinted()
        {
            Assert.That(SentencedTiles.FamilyCount, Is.InRange(4, 8), "base stone, lighter grey, brown, purple, and at most four more shades");
            Assert.That(SentencedTiles.Tint(SentencedTiles.Base).Strength, Is.EqualTo(0f), "the base family bakes no tint: the shader's own slab stone is untouched");
            for (int f = 1; f < SentencedTiles.FamilyCount; f++)
            {
                var t = SentencedTiles.Tint(f);
                Assert.That(t.Strength, Is.InRange(.2f, .7f),
                    "family " + f + " strength " + t.Strength + " (today 0 for every family): strong enough to colour the slab, weak enough (at most .7) that the baked bevels and joints, which the blend attenuates by (1 - strength), still read");
            }
        }

        [Test]
        public void TheBaseStoneIsAboutHalfToTwoThirdsOfTheTilesAndEveryOtherFamilyAboutOneInTenToAQuarter()
        {
            foreach (var o in Origins)
            {
                var s = Shares(Grid(o.X, o.Y));
                string msg = "shares of families 0.." + (s.Length - 1) + " over a 256 x 256 block at (" + o.X + "," + o.Y + ") are " + Pct(s) + " (today 100% / 0% / 0% / 0%)";
                Assert.That(s[0], Is.InRange(.50, .67), "base stone must stay 50-67%: " + msg);
                for (int f = 1; f < s.Length; f++) Assert.That(s[f], Is.InRange(.08, .25), "family " + f + " must be 8-25%: " + msg);
            }
        }

        // ---- a pure function of the coordinates --------------------------------------------------------------------------------

        [Test]
        public void TheFamilyIsAPureFunctionOfTheTileCoordinatesIndependentOfCallOrderAndOfAnyMap()
        {
            var a = Grid(0, 0);
            var reversed = new int[Block, Block];
            for (int y = Block - 1; y >= 0; y--) for (int x = Block - 1; x >= 0; x--) reversed[x, y] = SentencedTiles.Family(x, y);
            var shuffled = new int[Block, Block]; var rng = new Random(12345);
            var order = Enumerable.Range(0, Block * Block).OrderBy(_ => rng.Next()).ToArray();
            foreach (int i in order) shuffled[i % Block, i / Block] = SentencedTiles.Family(i % Block, i / Block);
            int diffRev = 0, diffShuf = 0;
            for (int y = 0; y < Block; y++) for (int x = 0; x < Block; x++) { if (a[x, y] != reversed[x, y]) diffRev++; if (a[x, y] != shuffled[x, y]) diffShuf++; }
            Assert.That(diffRev, Is.EqualTo(0), "tiles whose family changed when the same coordinates were asked in reverse order");
            Assert.That(diffShuf, Is.EqualTo(0), "tiles whose family changed when asked in random order");
            // Negative and large coordinates are fine and also stable.
            var negatives = new HashSet<int>();
            for (int y = -50; y < 0; y++) for (int x = -50; x < 0; x++)
            { int f = SentencedTiles.Family(x, y); Assert.That(f, Is.EqualTo(SentencedTiles.Family(x, y))); Assert.That(f, Is.InRange(0, SentencedTiles.FamilyCount - 1)); negatives.Add(f); }
            Assert.That(negatives.Count, Is.GreaterThanOrEqualTo(4), "negative coordinates (" + negatives.Count + " families seen in 50 x 50) vary too");
            Assert.That(SentencedTiles.Family(int.MaxValue, int.MaxValue), Is.InRange(0, SentencedTiles.FamilyCount - 1));
            Assert.That(SentencedTiles.Family(int.MinValue, int.MinValue), Is.InRange(0, SentencedTiles.FamilyCount - 1));
        }

        // ---- dispersal ---------------------------------------------------------------------------------------------------------

        [Test]
        public void NeighbouringTilesAreNoMoreAlikeThanChance()
        {
            foreach (var o in Origins)
            {
                var g = Grid(o.X, o.Y); var s = Shares(g); double chance = s.Sum(v => v * v);
                foreach (var (dx, dy) in new[] { (1, 0), (0, 1), (1, 1), (1, -1) })
                {
                    int n = 0, same = 0; var both = new double[s.Length];
                    for (int y = 0; y < Block; y++) for (int x = 0; x < Block; x++)
                    {
                        int x2 = x + dx, y2 = y + dy; if (x2 < 0 || x2 >= Block || y2 < 0 || y2 >= Block) continue;
                        n++; if (g[x, y] == g[x2, y2]) { same++; both[g[x, y]]++; }
                    }
                    double pSame = same / (double)n;
                    if (dx + dy == 1)   // the horizontal and vertical neighbours, the ones the owner sees as stripes
                        Assert.That(Math.Abs(pSame - chance), Is.LessThanOrEqualTo(.01), "lag (" + dx + "," + dy + "): neighbours share a family " + (pSame * 100).ToString("F1") + "% of the time, chance is " + (chance * 100).ToString("F1") + "% (today every neighbour does: 100%)");
                    for (int f = 0; f < s.Length; f++)
                    {
                        // phi coefficient of "is family f" between a tile and its neighbour: (P(both) - p^2) / (p (1 - p)).
                        double p = s[f], pBoth = both[f] / n, phi = p > 0 && p < 1 ? (pBoth - p * p) / (p * (1 - p)) : double.NaN;
                        Assert.That(phi, Is.Not.NaN, "family " + f + " never occurs or fills the floor (shares " + Pct(s) + "), so its correlation is undefined");
                        Assert.That(Math.Abs(phi), Is.LessThanOrEqualTo(.03), "family " + f + " lag (" + dx + "," + dy + ") correlation " + phi.ToString("F3"));
                    }
                }
            }
        }

        [Test]
        public void NoPeriodUpToSixteenTilesRepeatsInEitherAxis()
        {
            foreach (var o in Origins)
            {
                var g = Grid(o.X, o.Y); double chance = Shares(g).Sum(v => v * v);
                Assert.That(chance, Is.LessThanOrEqualTo(.50), "chance that two random tiles share a family is " + (chance * 100).ToString("F1") + "% (today 100%: one family); a floor of several families is at most 50%");
                for (int p = 1; p <= 16; p++)
                {
                    int sx = 0, nx = 0, sy = 0, ny = 0;
                    for (int y = 0; y < Block; y++) for (int x = 0; x < Block - p; x++) { nx++; if (g[x, y] == g[x + p, y]) sx++; }
                    for (int y = 0; y < Block - p; y++) for (int x = 0; x < Block; x++) { ny++; if (g[x, y] == g[x, y + p]) sy++; }
                    Assert.That(sx / (double)nx, Is.LessThanOrEqualTo(chance + .03), "period " + p + " along x: tiles equal their twin " + (sx * 100.0 / nx).ToString("F1") + "% (chance " + (chance * 100).ToString("F1") + "%; today 100%)");
                    Assert.That(sy / (double)ny, Is.LessThanOrEqualTo(chance + .03), "period " + p + " along y: tiles equal their twin " + (sy * 100.0 / ny).ToString("F1") + "% (chance " + (chance * 100).ToString("F1") + "%; today 100%)");
                }
            }
        }

        [Test]
        public void NoFamilyFormsARunLongerThanChanceAllowsAndTheFloorIsNotASingleFamily()
        {
            foreach (var o in Origins)
            {
                var g = Grid(o.X, o.Y); int longest = 0;
                for (int a = 0; a < Block; a++)
                {
                    int rowRun = 1, colRun = 1;
                    for (int b = 1; b < Block; b++)
                    {
                        rowRun = g[b, a] == g[b - 1, a] ? rowRun + 1 : 1; colRun = g[a, b] == g[a, b - 1] ? colRun + 1 : 1;
                        longest = Math.Max(longest, Math.Max(rowRun, colRun));
                    }
                }
                Assert.That(longest, Is.LessThanOrEqualTo(40), "longest straight run of one family in a 256 x 256 block at (" + o.X + "," + o.Y + ") is " + longest + " tiles (chance at 67% base is about 25, so 40 is a generous bound; today the whole floor is one family, run 256)");
                Assert.That(Shares(g).Count(v => v > 0), Is.EqualTo(SentencedTiles.FamilyCount), "every family occurs (today only the base does)");
            }
        }

        // ---- the colours: dark, varied, readable -------------------------------------------------------------------------------

        [Test]
        public void TheFamiliesAreAGreyABrownAndAPurpleAllStillDark()
        {
            double lb = LStar(Base); var grey = Albedo(SentencedTiles.LighterGrey); var brown = Albedo(SentencedTiles.Brown); var purple = Albedo(SentencedTiles.Purple);
            string msg = " (base " + Rgb(Base) + " L* " + lb.ToString("F1") + "; today all four families are the base)";
            Assert.That(LStar(grey), Is.GreaterThanOrEqualTo(lb + 4), "lighter grey albedo " + Rgb(grey) + " L* " + LStar(grey).ToString("F1") + " must be at least 4 L* lighter than the base" + msg);
            Assert.That(grey.Max() - grey.Min(), Is.LessThanOrEqualTo(14), "grey albedo " + Rgb(grey) + " stays a grey (channel spread at most 14; the base's own is 7)");
            Assert.That(brown[0] > brown[1] && brown[1] > brown[2] && brown[0] - brown[2] >= 14, Is.True, "brown albedo " + Rgb(brown) + " needs R > G > B with R - B >= 14" + msg);
            Assert.That(purple[2] >= purple[0] && purple[2] - purple[1] >= 12 && purple[0] - purple[1] >= 4, Is.True, "purple albedo " + Rgb(purple) + " needs B >= R and B - G >= 12 and R - G >= 4 (the base's B - G is only 7)" + msg);
            for (int f = 0; f < SentencedTiles.FamilyCount; f++)
            {
                double l = LStar(Albedo(f));
                Assert.That(l, Is.InRange(8.0, 30.0), "family " + f + " albedo " + Rgb(Albedo(f)) + " L* " + l.ToString("F1") + ": relatively dark, no black pits and nothing lighter than legacy's own lighter floor tile 0x44454d (L* 29.5, ceiling 30)");
            }
        }

        [Test]
        public void TheMeanLightnessOfTheMixIsWithinTenPercentOfTodaysBase()
        {
            double lb = LStar(Base);
            foreach (var o in Origins)
            {
                var s = Shares(Grid(o.X, o.Y)); double mean = 0; for (int f = 0; f < s.Length; f++) mean += s[f] * LStar(Albedo(f));
                Assert.That(mean / lb, Is.InRange(.90, 1.10), "mean albedo L* of the mix " + mean.ToString("F2") + " against today's base " + lb.ToString("F2") + " = " + (mean / lb).ToString("F3") + " at origin (" + o.X + "," + o.Y + "); shares " + Pct(s));
                Assert.That(mean, Is.GreaterThan(lb), "the mix is lighter than the bare base (" + mean.ToString("F2") + " vs " + lb.ToString("F2") + "): today it is exactly the base, so no variance exists");
            }
        }

        [Test]
        public void EveryFamilyStaysDistinguishableInDimLightAndUnderALamp()
        {
            for (int f = 0; f < SentencedTiles.FamilyCount; f++)
                for (int g = f + 1; g < SentencedTiles.FamilyCount; g++)
                {
                    double[] a = Albedo(f), b = Albedo(g);
                    string who = "families " + f + " " + Rgb(a) + " and " + g + " " + Rgb(b);
                    bool vsBase = f == 0;
                    Assert.That(DeltaE(a, b, Neutral), Is.GreaterThanOrEqualTo(5.5), who + " in neutral light (CIE76 delta E; today 0)");
                    Assert.That(DeltaE(a, b, Dim), Is.GreaterThanOrEqualTo(vsBase ? 3.5 : 5.0), who + " in the zone's dim light (linear x 0.4; today 0)");
                    Assert.That(DeltaE(a, b, Lamp), Is.GreaterThanOrEqualTo(vsBase ? 4.5 : 5.5), who + " under a warm lamp (Key 231,196,153; today 0)");
                }
        }
    }
}

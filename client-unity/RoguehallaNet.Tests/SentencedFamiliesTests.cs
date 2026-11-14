using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;
using static Roguehalla.Net.Tests.GroundTintScreen;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-GROUND-TINT-1, the Sentenced floor's scattered tiles. Owner direction 2026-11-13: "some more tile random variance could help, with dark lighting it could
    /// still work, perhaps some brown tiles, lighter greys some purples all randomly dispersed (should still be relatively dark)". Legacy
    /// (packages/client/src/render/zoneArt/zoneStyle.ts:28-32, palette.ts:32-35) has two greys, floor 0x3a3b42 and floorAlt 0x44454d on one tile in four; no brown or purple:
    /// a presentation deviation by owner direction.
    /// The dispersal tests (shares, purity, neighbour correlation, no period, longest run) are those of the reverted P-UNITY-SENTENCED-TILES-1, which were sound; they
    /// run on <see cref="SentencedTiles.Family"/> and pass on the stub. The colour tests are new: that attempt measured an albedo model and its tiles came out vivid and
    /// flat on screen. Here every colour rule is on SCREEN colours (see <see cref="GroundTintScreen"/>): a family is a gain on the ground's shaded colour, so it is
    /// evaluated on the Web client's dark slab (39, 34, 39), the capture tool's (30, 26, 31), a lit yard slab (120, 116, 123) and a slab beside a lamp (192, 185, 192).
    /// </summary>
    public sealed class SentencedFamiliesTests
    {
        const int Block = 256;
        static readonly (int X, int Y)[] Origins = { (0, 0), (3000, -2000) };

        static int[,] Grid(int x0, int y0)
        {
            var g = new int[Block, Block];
            for (int y = 0; y < Block; y++) for (int x = 0; x < Block; x++) g[x, y] = SentencedTiles.Family(x0 + x, y0 + y);
            return g;
        }

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
        public void ThereAreFourToEightFamiliesAndTheBaseFamilyIsTheZonesOwnStoneUntinted()
        {
            Assert.That(SentencedTiles.FamilyCount, Is.InRange(4, 8), "base stone, lighter grey, brown, purple, and at most four more");
            var g = Gain(SentencedTiles.Tint(SentencedTiles.Base));
            for (int k = 0; k < 3; k++) Assert.That(g[k], Is.EqualTo(1.0).Within(1e-3), "the base family changes nothing: " + Gn(g));
            for (int f = 1; f < SentencedTiles.FamilyCount; f++)
            {
                var gf = Gain(SentencedTiles.Tint(f));
                Assert.That(gf.Any(v => Math.Abs(v - 1) > .05), Is.True, "family " + f + " " + Gn(gf) + " must change the ground (today every family is 'no change')");
                for (int k = 0; k < 3; k++) Assert.That(gf[k], Is.InRange(.40, 1.99), "family " + f + " channel " + k + " " + Gn(gf));
            }
        }

        [Test]
        public void TheBaseStoneIsAboutHalfToTwoThirdsOfTheTilesAndEveryOtherFamilyAboutOneInTenToAQuarter()
        {
            foreach (var o in Origins)
            {
                var s = Shares(Grid(o.X, o.Y));
                string msg = "shares of families 0.." + (s.Length - 1) + " over a 256 x 256 block at (" + o.X + "," + o.Y + ") are " + Pct(s);
                Assert.That(s[0], Is.InRange(.50, .67), "base stone must stay 50-67%: " + msg);
                for (int f = 1; f < s.Length; f++) Assert.That(s[f], Is.InRange(.08, .25), "family " + f + " must be 8-25%: " + msg);
            }
        }

        // ---- a pure function of the coordinates, dispersed ---------------------------------------------------------------------

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
            var negatives = new HashSet<int>();
            for (int y = -50; y < 0; y++) for (int x = -50; x < 0; x++)
            { int f = SentencedTiles.Family(x, y); Assert.That(f, Is.EqualTo(SentencedTiles.Family(x, y))); Assert.That(f, Is.InRange(0, SentencedTiles.FamilyCount - 1)); negatives.Add(f); }
            Assert.That(negatives.Count, Is.GreaterThanOrEqualTo(4), "negative coordinates (" + negatives.Count + " families seen in 50 x 50) vary too");
            Assert.That(SentencedTiles.Family(int.MaxValue, int.MaxValue), Is.InRange(0, SentencedTiles.FamilyCount - 1));
            Assert.That(SentencedTiles.Family(int.MinValue, int.MinValue), Is.InRange(0, SentencedTiles.FamilyCount - 1));
        }

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
                        Assert.That(Math.Abs(pSame - chance), Is.LessThanOrEqualTo(.01), "lag (" + dx + "," + dy + "): neighbours share a family " + (pSame * 100).ToString("F1") + "% of the time, chance is " + (chance * 100).ToString("F1") + "%");
                    for (int f = 0; f < s.Length; f++)
                    {
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
                Assert.That(chance, Is.LessThanOrEqualTo(.50), "chance that two random tiles share a family is " + (chance * 100).ToString("F1") + "%; a floor of several families is at most 50%");
                for (int p = 1; p <= 16; p++)
                {
                    int sx = 0, nx = 0, sy = 0, ny = 0;
                    for (int y = 0; y < Block; y++) for (int x = 0; x < Block - p; x++) { nx++; if (g[x, y] == g[x + p, y]) sx++; }
                    for (int y = 0; y < Block - p; y++) for (int x = 0; x < Block; x++) { ny++; if (g[x, y] == g[x, y + p]) sy++; }
                    Assert.That(sx / (double)nx, Is.LessThanOrEqualTo(chance + .03), "period " + p + " along x: tiles equal their twin " + (sx * 100.0 / nx).ToString("F1") + "% (chance " + (chance * 100).ToString("F1") + "%)");
                    Assert.That(sy / (double)ny, Is.LessThanOrEqualTo(chance + .03), "period " + p + " along y: tiles equal their twin " + (sy * 100.0 / ny).ToString("F1") + "% (chance " + (chance * 100).ToString("F1") + "%)");
                }
            }
        }

        [Test]
        public void NoFamilyFormsARunLongerThanChanceAllowsAndEveryFamilyOccurs()
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
                Assert.That(longest, Is.LessThanOrEqualTo(40), "longest straight run of one family in a 256 x 256 block at (" + o.X + "," + o.Y + ") is " + longest + " tiles (chance at 67% base is about 25, so 40 is a generous bound)");
                Assert.That(Shares(g).Count(v => v > 0), Is.EqualTo(SentencedTiles.FamilyCount), "every family occurs");
            }
        }

        // ---- the colours on screen: dark, varied, readable ---------------------------------------------------------------------------

        static readonly double[] WebDark = Web[1].Rgb, CaptureDark = CaptureTool[1].Rgb;

        [Test]
        public void TheLighterGreyIsAGreyAboutTwoToThirtyPercentLighterAndStillDark()
        {
            var t = SentencedTiles.Tint(SentencedTiles.LighterGrey);
            foreach (var (name, s) in new[] { ("Web dark slab", WebDark), ("capture dark slab", CaptureDark) })
            {
                var o = Through(s, t); double ratio = LStar(o) / LStar(s), de = DeltaE(s, o);
                string what = "lighter grey on the " + name + " " + Rgb(s) + " -> " + Rgb(o) + " (" + Gn(Gain(t)) + ")";
                Assert.That(ratio, Is.InRange(1.10, 1.30), what + ": L* x" + ratio.ToString("F2") + " (needs 1.10 to 1.30: lighter, but no more than about 25 percent lighter; today 1.00, no family bakes a tint)");
                Assert.That(de, Is.GreaterThanOrEqualTo(2.5), what + ": differs from the slab by " + de.ToString("F1") + " CIE76 (needs 2.5: a visible step)");
                Assert.That(Chroma(o), Is.LessThanOrEqualTo(Chroma(s) + 2.0), what + ": a grey stays grey: chroma " + Chroma(o).ToString("F1") + " against the slab's " + Chroma(s).ToString("F1"));
            }
        }

        [Test]
        public void TheBrownAndThePurpleAreBrownAndPurpleOnScreenAndNotLighterThanTheSlab()
        {
            foreach (var (fam, name, lo, hi) in new[] { (SentencedTiles.Brown, "brown", 20.0, 80.0), (SentencedTiles.Purple, "purple", 270.0, 340.0) })
            {
                var t = SentencedTiles.Tint(fam);
                foreach (var (set, s) in new[] { ("Web dark slab", WebDark), ("capture dark slab", CaptureDark), ("lit yard slab", SentencedLit) })
                {
                    var o = Through(s, t); double ratio = LStar(o) / LStar(s), de = DeltaE(s, o), hue = HueDegrees(o);
                    string what = name + " on the " + set + " " + Rgb(s) + " -> " + Rgb(o) + " (" + Gn(Gain(t)) + ")";
                    Assert.That(hue, Is.InRange(lo, hi), what + ": CIELAB hue " + hue.ToString("F0") + " degrees must be " + lo + " to " + hi + " (the slab itself is " + HueDegrees(s).ToString("F0") + "; today no change)");
                    Assert.That(de, Is.GreaterThanOrEqualTo(5.0), what + ": differs from the slab by " + de.ToString("F1") + " CIE76 (needs 5)");
                    Assert.That(ratio, Is.InRange(.85, 1.25), what + ": L* x" + ratio.ToString("F2") + " (still relatively dark: within 0.85 to 1.25 of the slab)");
                }
                Assert.That(Chroma(Through(WebDark, t)), Is.GreaterThanOrEqualTo(5.0), name + " on the Web dark slab must read as a colour: chroma " + Chroma(Through(WebDark, t)).ToString("F1") + " (needs 5)");
            }
        }

        [Test]
        public void TheFamiliesStayApartFromEachOtherInDimLightAndUnderALamp()
        {
            // Away from lamps (the dark slab) a visible step between every pair (2.5); under a lamp, where the same gains act on brighter ground, 5.
            foreach (var (name, s, min) in new[] { ("Web dark slab", WebDark, 2.5), ("capture dark slab", CaptureDark, 2.5), ("lit yard slab", SentencedLit, 5.0), ("slab beside a lamp", SentencedLampCore, 5.0) })
            {
                var screens = Enumerable.Range(0, SentencedTiles.FamilyCount).Select(f => Through(s, SentencedTiles.Tint(f))).ToArray();
                for (int a = 0; a < screens.Length; a++)
                    for (int b = a + 1; b < screens.Length; b++)
                        Assert.That(DeltaE(screens[a], screens[b]), Is.GreaterThanOrEqualTo(min), "families " + a + " " + Rgb(screens[a]) + " and " + b + " " + Rgb(screens[b]) + " on the " + name + " " + Rgb(s) + " differ by " + DeltaE(screens[a], screens[b]).ToString("F1") + " CIE76 (needs " + min + "; today 0, no family bakes a tint)");
            }
        }

        [Test]
        public void TheMixOfFamiliesIsNoMoreThanTenPercentLighterThanTheBareSlab()
        {
            foreach (var (name, s) in new[] { ("Web dark slab", WebDark), ("capture dark slab", CaptureDark) })
                foreach (var o in Origins)
                {
                    var sh = Shares(Grid(o.X, o.Y)); double mean = 0;
                    for (int f = 0; f < sh.Length; f++) mean += sh[f] * LStar(Through(s, SentencedTiles.Tint(f)));
                    Assert.That(mean / LStar(s), Is.InRange(1.0, 1.10), "mean L* of the scattered floor " + mean.ToString("F2") + " against the bare slab's " + LStar(s).ToString("F2") + " on the " + name + " (shares " + Pct(sh) + "): relatively dark, and not exactly the bare slab (today it is exactly the bare slab)");
                }
        }

        [Test]
        public void ABandedSentencedTileStillShowsItsFamilyAndTheBandStaysQuiet()
        {
            // The round 10 finding: on a landmark-mode map the server's band covers every open Sentenced tile and, being a replacement, hid the scatter. Both modulate now: on a
            // tile of family f under band v, the band is still a quiet step on that family's colour (3 to 14 CIE76), and the family is still a step on the banded colour.
            foreach (var (name, s) in new[] { ("Web dark slab", WebDark), ("lit yard slab", SentencedLit) })
                for (int f = 1; f < SentencedTiles.FamilyCount; f++)
                {
                    var (x, y) = GroundTintFormulaTests.TileOfFamily(f);
                    var famOnly = Through(s, SentencedTiles.Tint(f));
                    for (byte v = 1; v <= 6; v++)
                    {
                        Assert.That(GroundTint.Bake(2, v, x, y, out var both), Is.True);
                        GroundVariantLook.TryGet(2, v, out var band);
                        var bandOnly = Through(s, band); var bandAndFamily = Through(s, both);
                        double bandStep = DeltaE(famOnly, bandAndFamily), familyStep = DeltaE(bandOnly, bandAndFamily), min = f == SentencedTiles.LighterGrey ? 2.0 : 4.0;
                        string what = "Sentenced variant " + v + " on a family " + f + " tile, " + name + ": family alone " + Rgb(famOnly) + ", band alone " + Rgb(bandOnly) + ", both " + Rgb(bandAndFamily);
                        Assert.That(bandStep, Is.InRange(3.0, 14.0), what + ": the band's step on the family's colour is " + bandStep.ToString("F1") + " CIE76 (3 to 14)");
                        Assert.That(familyStep, Is.GreaterThanOrEqualTo(min), what + ": the family's step on the banded colour is " + familyStep.ToString("F1") + " CIE76 (needs " + min + "; today the band replaces the family: 0)");
                    }
                }
        }
    }
}

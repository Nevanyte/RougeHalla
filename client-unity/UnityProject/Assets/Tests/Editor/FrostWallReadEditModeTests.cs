using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-READ-1 oracle, colour-model half (docs/backlog/packets/P-UNITY-FROST-WALL-READ-1.md): a standing Frost Wall and its aim
    /// preview are readable on every zone's ground, Frost's pale ground above all. The pixel half is Tools/wall-read-check.py on the look-capture PNGs;
    /// this half is what the gate-less EditMode run can compute, and it is the weaker of the two (P-UNITY-SENTENCED-TILES-1 passed a colour model and
    /// looked wrong): when the two disagree the render check governs.
    ///
    /// THE MODEL. The wall and preview meshes use the unlit sprite material, so they are NOT lit by the zone: each quad shows its vertex colour
    /// alpha-blended over the ground in gamma (sRGB) space, then the camera's grade. Measured on the look-capture render frost-wall (at
    /// x 1140, y 466..580): top quad modelled (215, 239, 251) against rendered (216, 234, 244): luminance 4 percent high; face quad modelled
    /// (96, 197, 244) against rendered (147, 215, 243): luminance 20 percent LOW, so the face/top ratio is modelled 1.64 and rendered 1.29. The grade
    /// lifts darker colours toward the ground; it is not modelled. Hence two margins below: surfaces and marks are asked for 1.1 times their floor,
    /// the face against the top for 1.3 times (the measured 1.64 / 1.29 = 1.27), and the wall's edge 1.4 times (a 1.5 sim px rim is 2 to 3 px wide:
    /// modelled 1.62 against rendered 1.14 on Frost p50; a thicker outline renders closer to the model, so the margin only asks for more). Preview marks: modelled
    /// at the pulse's lowest, Frost p50: cell outline 1.30 (rendered 1.24), ring 1.06 (1.13), line 1.13 (1.37): within 20 percent, the render a little higher (best-row bias).
    ///
    /// THE GROUND ("as lit"). A zone's lit ground is NOT its palette Base times a light: the shader adds detail, a secondary and accent colour,
    /// dappled light and cloud shadow, then the grade. Palette Base against a render (ground-only captures of the five zone scenes, central 900 x 500
    /// px) is off in luminance by x0.56 Fire, x1.9 Sentenced, x0.67 Plague, x0.80 Frost, x1.9 Holy. So the ground here is MEASURED: the table below
    /// is the median RGB and the 10th, 50th and 90th percentile luminance of those renders; re-measure with
    ///   client-unity/UnityProject/Tools/look-capture.sh fire-scene sentenced-scene plague-scene frost-scene holy-scene --ground-only --out DIR
    /// (pixels [500..1400) x [300..800) of each PNG). A wall or mark must read on the ground's 10th, 50th and 90th percentile luminance (the dark
    /// shadows and the brightest snow, sand and light), so "the ground" is a spread, not a number; the spread is also this table's error against any
    /// one pixel. Each zone's ground is the colour of the median pixel scaled in linear light to that luminance.
    ///
    /// Contrast is WCAG: (Lhi + .05) / (Llo + .05) of relative luminance, as Tools/contrast-lib.cjs and RegionThemeEditModeTests. A part drawn in two
    /// tones (a light and a dark outline) passes when any of its layers does: that is how one mark reads on Frost snow AND on Fire's dark ground.
    /// Not run by scripts/gate.sh (no Unity in the gate): run through Tools/editmode.sh.
    /// </summary>
    public sealed class FrostWallReadEditModeTests
    {
        // ---- floors (the packet's section 8) ----
        const double TopFloor = 1.6, EdgeFloor = 3.0, FaceOverTopFloor = 1.4;
        const double PreviewCellFloor = 2.5, PreviewMarkFloor = 2.0, InvalidMarkFloor = 3.0, CrackChangeFloor = 1.25, CrackHueDegrees = 25;
        const double MarginSurface = 1.1, MarginFace = 1.3, MarginEdge = 1.4;

        struct Ground
        {
            public readonly string Zone; public readonly double R, G, B, L10, L50, L90;
            public Ground(string zone, double r, double g, double b, double l10, double l50, double l90) { Zone = zone; R = r; G = g; B = b; L10 = l10; L50 = l50; L90 = l90; }
            public Color At(double lum)
            {
                var med = new[] { Lin(R / 255), Lin(G / 255), Lin(B / 255) }; double lm = Luminance(R / 255, G / 255, B / 255), k = lum / lm;
                return new Color((float)Unlin(Math.Min(1, med[0] * k)), (float)Unlin(Math.Min(1, med[1] * k)), (float)Unlin(Math.Min(1, med[2] * k)), 1f);
            }
            public IEnumerable<(string, Color)> Spread() { yield return (Zone + " p10", At(L10)); yield return (Zone + " p50", At(L50)); yield return (Zone + " p90", At(L90)); }
        }

        static readonly Ground[] Grounds =
        {
            new Ground("Fire", 64, 19, 11, .0086, .0158, .0296),
            new Ground("Sentenced", 50, 42, 50, .0080, .0259, .1064),
            new Ground("Plague", 37, 59, 35, .0189, .0365, .1277),
            new Ground("Frost", 157, 202, 230, .3572, .5495, .6440),
            new Ground("Holy", 213, 159, 83, .2275, .3963, .6072),
        };
        static IEnumerable<(string, Color)> AllGrounds() { foreach (var g in Grounds) foreach (var x in g.Spread()) yield return x; }

        // ---- colour maths ----
        static double Lin(double v) { return v <= .04045 ? v / 12.92 : Math.Pow((v + .055) / 1.055, 2.4); }
        static double Unlin(double v) { return v <= .0031308 ? v * 12.92 : 1.055 * Math.Pow(v, 1 / 2.4) - .055; }
        static double Luminance(double r, double g, double b) { return .2126 * Lin(r) + .7152 * Lin(g) + .0722 * Lin(b); }
        static double Luminance(Color c) { return Luminance(c.r, c.g, c.b); }
        static double Ratio(double a, double b) { double hi = Math.Max(a, b), lo = Math.Min(a, b); return (hi + .05) / (lo + .05); }
        /// <summary>The quad's colour drawn over the ground: alpha blend in sRGB space.</summary>
        static Color Over(Color32 src, Color ground)
        {
            float a = src.a / 255f;
            return new Color(src.r / 255f * a + ground.r * (1 - a), src.g / 255f * a + ground.g * (1 - a), src.b / 255f * a + ground.b * (1 - a), 1f);
        }
        static double Best(Color32[] layers, Color ground)
        {
            double best = 1; foreach (var l in layers) best = Math.Max(best, Ratio(Luminance(Over(l, ground)), Luminance(ground)));
            return best;
        }
        static void Hsv(Color32 c, out double hueDeg, out double sat, out double val) { float h, s, v; Color.RGBToHSV(new Color(c.r / 255f, c.g / 255f, c.b / 255f), out h, out s, out v); hueDeg = h * 360; sat = s; val = v; }
        static string Hex(Color32 c) { return string.Format("{0:x2}{1:x2}{2:x2}@{3:0.00}", c.r, c.g, c.b, c.a / 255f); }
        static string Hex(Color32[] l) { return string.Join("+", l.Select(Hex)); }

        // ---- harness ----
        GameObject _root; FrostWallPresenter _p;
        [SetUp] public void Up() { _root = new GameObject("frost wall read test"); _p = new FrostWallPresenter(_root.transform); }
        [TearDown] public void Down() { _p.Dispose(); UnityEngine.Object.DestroyImmediate(_root); }

        const double Start = 1000, End = 5000;
        static MapTile[] Row(int n) { var t = new MapTile[n]; for (int i = 0; i < n; i++) t[i] = new MapTile((ushort)(12 + i), 7); return t; }
        static AreaView Wall(uint? owner) { var t = Row(2); return new AreaView { Kind = AreaKind.Wall, Ability = AbilityId.Freeze, Owner = owner, StartedAt = Start, EndsAt = End, Tiles = t, Key = new AreaKey(Start, (uint)(t[0].Y * 40 + t[0].X)) }; }
        void Frame(AreaView[] f, double t) { _p.PresentWalls(f, t); _p.Tick(t, (float)t / 1000f, false); }
        static readonly FrostWallSegment Seg = new FrostWallSegment(208, 48, 208, 160, 208, -64);
        static Color32 FrostTint { get { return ShowcasePalette.Faction(WishFxModel.FactionIndex(AbilityId.Freeze)); } }

        /// <summary>A preview shown the way ArenaView shows it (the caster's faction tint), then ticked over a whole pulse (the worst moment counts).</summary>
        void PulseSamples(bool valid, Action<string> each)
        {
            _p.ShowPreview(Seg, valid ? new List<uint> { 6, 16, 26 } : new List<uint>(), 10, 80, 48, 450, FrostTint, FrostWishKind.Wall);
            for (int k = 0; k < 40; k++) { _p.Tick(0, k * .05f, false); each("pulse " + (k * .05f).ToString("0.00") + " s"); }
        }

        static void NoFailures(List<string> fails, string what)
        {
            Assert.That(fails, Is.Empty, what + ", " + fails.Count + " miss(es) (ground names are the zone and the percentile of its rendered luminance; ratios include the model margin; the render check wall-read-check.py is the final word):\n" + string.Join("\n", fails.Take(40)));
        }

        // ---- 1. the wall's top, edge and face, fresh ----
        [Test]
        public void TheWallTopOrItsEdgeReadsOnEveryZonesGroundAndTheFaceStandsOffTheTop()
        {
            Frame(new[] { Wall(7) }, 2000);
            Assert.AreEqual(2, _p.BlockCount);
            var top = _p.BlockLayers(0, FrostWallPresenter.BlockPart.Top); var face = _p.BlockLayers(0, FrostWallPresenter.BlockPart.Face); var edge = _p.BlockLayers(0, FrostWallPresenter.BlockPart.Edge);
            Assert.That(top.Length, Is.GreaterThan(0)); Assert.That(face.Length, Is.GreaterThan(0)); Assert.That(edge.Length, Is.GreaterThan(0), "an edge or outline layer");
            var fails = new List<string>();
            foreach (var (name, g) in AllGrounds())
            {
                double rt = Best(top, g), re = Best(edge, g);
                if (!(rt >= TopFloor * MarginSurface || re >= EdgeFloor * MarginEdge))
                    fails.Add(name + ": top " + rt.ToString("0.00") + " < " + (TopFloor * MarginSurface).ToString("0.00") + " and edge " + re.ToString("0.00") + " < " + (EdgeFloor * MarginEdge).ToString("0.00") + "  (top " + Hex(top) + ", edge " + Hex(edge) + ")");
                double ft = Ratio(Luminance(Over(face[0], g)), Luminance(Over(top[0], g)));
                if (ft < FaceOverTopFloor * MarginFace) fails.Add(name + ": face over top " + ft.ToString("0.00") + " < " + (FaceOverTopFloor * MarginFace).ToString("0.00") + "  (face " + Hex(face) + ", top " + Hex(top) + ")");
            }
            NoFailures(fails, "the fresh wall");
            for (int i = 1; i < 2; i++) foreach (var part in new[] { FrostWallPresenter.BlockPart.Top, FrostWallPresenter.BlockPart.Face, FrostWallPresenter.BlockPart.Edge })
                CollectionAssert.AreEqual(_p.BlockLayers(0, part), _p.BlockLayers(i, part), "one wall, one look: " + part);
        }

        // ---- 2. the same ice for every caster, in the ice-blue family ----
        [Test]
        public void TheIceStaysInTheIceBlueHueFamilyForEveryCasterAndTopIsLighterThanFaceThanEdge()
        {
            Frame(new[] { Wall(7) }, 2000);
            var fresh = new[] { FrostWallPresenter.BlockPart.Top, FrostWallPresenter.BlockPart.Face, FrostWallPresenter.BlockPart.Edge }.Select(p => _p.BlockLayers(0, p)).ToArray();
            foreach (var part in fresh) foreach (var c in part)
            {
                double h, s, v; Hsv(c, out h, out s, out v);
                Assert.That(s < .08 || (h >= 185 && h <= 225), Is.True, "layer " + Hex(c) + " has hue " + h.ToString("0") + " sat " + s.ToString("0.00") + ": ice stays blue (185..225 degrees), or is a neutral (sat < .08)");
            }
            double lt = Luminance(fresh[0][0].r / 255.0, fresh[0][0].g / 255.0, fresh[0][0].b / 255.0), lf = Luminance(fresh[1][0].r / 255.0, fresh[1][0].g / 255.0, fresh[1][0].b / 255.0);
            double le = fresh[2].Min(c => Luminance(c.r / 255.0, c.g / 255.0, c.b / 255.0));
            Assert.That(lt, Is.GreaterThan(lf), "the dial range of frost-wall-ice: top lighter than face"); Assert.That(lf, Is.GreaterThan(le), "face lighter than the darkest edge layer");
            _p.Dispose(); _p = new FrostWallPresenter(_root.transform);
            Frame(new[] { Wall(null), Wall(11), Wall(7) }.Select((w, i) => { var t = Row(2); for (int k = 0; k < 2; k++) t[k] = new MapTile((ushort)(12 + k), (ushort)(7 + i * 3)); w.Tiles = t; w.Key = new AreaKey(Start + i, (uint)(t[0].Y * 40 + t[0].X)); return w; }).ToArray(), 2000);
            Assert.AreEqual(6, _p.BlockCount);
            for (int b = 0; b < 6; b++) foreach (var part in new[] { FrostWallPresenter.BlockPart.Top, FrostWallPresenter.BlockPart.Face, FrostWallPresenter.BlockPart.Edge })
                CollectionAssert.AreEqual(_p.BlockLayers(0, part), _p.BlockLayers(b, part), "block " + b + " " + part + ": no faction tint, whoever cast it (owner null, 7, 11)");
        }

        // ---- 3. the crack ----
        [Test]
        public void TheCrackChangesWhatAPlayerSeesOnEveryZonesGroundAndNotBeforeTheLastSecond()
        {
            var fields = new[] { Wall(7) };
            Color32[][] At(double left) { Frame(fields, End - left); return new[] { FrostWallPresenter.BlockPart.Top, FrostWallPresenter.BlockPart.Face, FrostWallPresenter.BlockPart.Edge }.SelectMany(p => new[] { _p.BlockLayers(0, p) }).ToArray(); }
            var fresh = At(2000); var early = At(FrostWallPresenter.CrackMs); var cracked = At(500);
            for (int i = 0; i < fresh.Length; i++) CollectionAssert.AreEqual(fresh[i], early[i], "nothing changes before the last second (layer group " + i + ")");
            Assert.AreEqual(fresh.Sum(a => a.Length), cracked.Sum(a => a.Length), "the same layers exist cracked and fresh (an overlay exists in both, transparent when fresh)");
            var fails = new List<string>();
            foreach (var g in Grounds)
            {
                var ground = g.At(g.L50); double bestLum = 1, bestHue = 0; string what = "";
                for (int i = 0; i < fresh.Length; i++) for (int k = 0; k < fresh[i].Length; k++)
                {
                    var a = Over(fresh[i][k], ground); var b = Over(cracked[i][k], ground);
                    double r = Ratio(Luminance(a), Luminance(b));
                    if (r > bestLum) { bestLum = r; what = "group " + i + " layer " + k; }
                    float ha, sa, va, hb, sb, vb; Color.RGBToHSV(a, out ha, out sa, out va); Color.RGBToHSV(b, out hb, out sb, out vb);
                    if (sa >= .15f && sb >= .15f) { double d = Math.Abs(ha - hb) * 360; d = Math.Min(d, 360 - d); bestHue = Math.Max(bestHue, d); }
                }
                if (!(bestLum >= CrackChangeFloor || bestHue >= CrackHueDegrees))
                    fails.Add(g.Zone + " p50: the wall 500 ms from its end differs from the fresh one by luminance x" + bestLum.ToString("0.00") + " (< " + CrackChangeFloor + ") and hue " + bestHue.ToString("0") + " degrees (< " + CrackHueDegrees + "); pure alpha loss over pale ground does not count");
            }
            NoFailures(fails, "the crack");
            Frame(fields, End - 500);
            foreach (var part in new[] { FrostWallPresenter.BlockPart.Top, FrostWallPresenter.BlockPart.Face, FrostWallPresenter.BlockPart.Edge }) { var l = _p.BlockLayers(0, part); Assert.That(l, Is.Not.Empty); }
        }

        [Test]
        public void TheTwoBlocksOfOneWallCrackTogether()
        {
            var fields = new[] { Wall(7) };
            foreach (double left in new double[] { 900, 700, 500, 300, 100 })
            {
                Frame(fields, End - left);
                foreach (var part in new[] { FrostWallPresenter.BlockPart.Top, FrostWallPresenter.BlockPart.Face, FrostWallPresenter.BlockPart.Edge })
                    CollectionAssert.AreEqual(_p.BlockLayers(0, part), _p.BlockLayers(1, part), part + " " + left + " ms from the end");
            }
        }

        // ---- 4. the valid preview ----
        [Test]
        public void TheValidPreviewsCellsRingLineAndDotReadOnEveryZonesGroundAtEveryMomentOfThePulse()
        {
            var fails = new List<string>();
            var worst = new Dictionary<string, (double, string)>();
            PulseSamples(true, when =>
            {
                foreach (var (name, g) in AllGrounds())
                {
                    double cell = Math.Max(Best(_p.PreviewLayers(FrostWallPresenter.PreviewPart.Outline), g), Best(_p.PreviewLayers(FrostWallPresenter.PreviewPart.Fill), g));
                    Note(worst, name + " cell outline or fill", cell, PreviewCellFloor * MarginSurface, when, fails);
                    foreach (var part in new[] { FrostWallPresenter.PreviewPart.Ring, FrostWallPresenter.PreviewPart.Line, FrostWallPresenter.PreviewPart.Dot })
                        Note(worst, name + " " + part.ToString().ToLowerInvariant(), Best(_p.PreviewLayers(part), g), PreviewMarkFloor * MarginSurface, when, fails);
                }
            });
            NoFailures(fails, "the valid preview");
            Assert.AreEqual(3, _p.PreviewBlockCount);
        }

        // ---- 5. the invalid preview ----
        [Test]
        public void TheInvalidPreviewIsRedAndReadsOnEveryZonesGroundAtEveryMomentOfThePulse()
        {
            var fails = new List<string>();
            var worst = new Dictionary<string, (double, string)>();
            PulseSamples(false, when =>
            {
                foreach (var (name, g) in AllGrounds())
                {
                    foreach (var part in new[] { FrostWallPresenter.PreviewPart.Line, FrostWallPresenter.PreviewPart.Dot })
                        Note(worst, name + " " + part.ToString().ToLowerInvariant(), Best(_p.PreviewLayers(part), g), InvalidMarkFloor * MarginSurface, when, fails);
                    Note(worst, name + " ring", Best(_p.PreviewLayers(FrostWallPresenter.PreviewPart.Ring), g), PreviewMarkFloor * MarginSurface, when, fails);
                }
            });
            NoFailures(fails, "the invalid preview");
            Assert.AreEqual(0, _p.PreviewBlockCount);
            foreach (var part in new[] { FrostWallPresenter.PreviewPart.Line, FrostWallPresenter.PreviewPart.Dot, FrostWallPresenter.PreviewPart.Ring })
            {
                var layers = _p.PreviewLayers(part);
                bool red = false;
                foreach (var c in layers)
                {
                    double h, s, v; Hsv(c, out h, out s, out v);
                    bool isRed = (h >= 340 || h <= 20) && s >= .5, neutral = s < .25;
                    if (c.a >= 128 && isRed) red = true;
                    if (c.a >= 128) Assert.That(isRed || neutral, Is.True, "invalid " + part + " layer " + Hex(c) + " is mostly opaque and neither red nor a neutral halo");
                }
                if (part != FrostWallPresenter.PreviewPart.Ring) Assert.That(red, Is.True, "invalid " + part + " has a mostly opaque red layer (hue 340..20, sat >= .5) in " + Hex(layers));
            }
            double hh, ss, vv; Hsv(FrostWallPresenter.InvalidTint, out hh, out ss, out vv);
            Assert.That(hh >= 340 || hh <= 20, Is.True, "InvalidTint stays red");
        }

        static void Note(Dictionary<string, (double, string)> worst, string key, double got, double floor, string when, List<string> fails)
        {
            (double, string) w;
            if (!worst.TryGetValue(key, out w) || got < w.Item1) { worst[key] = (got, when); }
            if (got < floor) { string f = key + ": " + got.ToString("0.00") + " < " + floor.ToString("0.00") + " at " + when; if (!fails.Any(x => x.StartsWith(key + ":"))) fails.Add(f); }
        }

        // ---- 6. every looks number is a named, indexed dial ----
        [Test]
        public void EveryPublicLooksConstantOfThePresenterHasAFrostWallRowInDialsMd()
        {
            string dials = File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/unity/DIALS.md")));
            var rows = dials.Split('\n').Where(l => l.StartsWith("| `frost-wall-")).ToArray();
            Assert.AreEqual(6, rows.Length, "the six frost-wall rows stay six (Tools/look-wall-docs.test.cjs); new constants go into the row they belong to");
            var names = typeof(FrostWallPresenter).GetFields(BindingFlags.Public | BindingFlags.Static)
                .Where(f => f.IsLiteral || (f.IsInitOnly && (f.FieldType == typeof(Color32) || f.FieldType == typeof(Color) || f.FieldType == typeof(float) || f.FieldType == typeof(double))))
                .Select(f => f.Name).ToArray();
            Assert.That(names.Length, Is.GreaterThanOrEqualTo(20), "the presenter's public looks constants (found " + string.Join(", ", names) + ")");
            var missing = names.Where(n => !rows.Any(r => r.Contains("`" + n + "`"))).ToArray();
            Assert.That(missing, Is.Empty, "named in no frost-wall row of docs/unity/DIALS.md (add them to the row, with the range they may move in): " + string.Join(", ", missing));
        }

        [Test]
        public void TheDialsThisPacketDoesNotTouchStayInTheirRows()
        {
            Assert.That(FrostWallPresenter.Lift, Is.InRange(12f, 28f)); Assert.That(FrostWallPresenter.CrackMs, Is.InRange(600.0, 1500.0));
            Assert.That(FrostWallPresenter.FadeMs, Is.InRange(200.0, 500.0)); Assert.That(FrostWallPresenter.PulseSpeed, Is.InRange(.004f, .012f));
            Assert.That(FrostWallPresenter.TelegraphAlpha, Is.InRange(.1f, .3f)); Assert.That(FrostWallPresenter.TelegraphGather, Is.InRange(.2f, .5f)); Assert.That(FrostWallPresenter.TelegraphCoreAlpha, Is.InRange(.4f, .9f));
            Assert.That(FrostWallPresenter.TopAlpha, Is.InRange(.5f, 1f)); Assert.That(FrostWallPresenter.FaceAlpha, Is.InRange(.5f, 1f)); Assert.That(FrostWallPresenter.EdgeAlpha, Is.InRange(.5f, 1f));
        }
    }
}

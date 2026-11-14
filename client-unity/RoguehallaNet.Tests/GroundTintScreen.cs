using System;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-GROUND-TINT-1 oracle helper: colour maths on SCREEN colours (sRGB bytes of rendered pixels), the representative screen colours the
    /// gated tests use, and the bridge from the engine-free shader mirror (<see cref="GroundTint.Apply"/>) to what a pixel does on screen.
    ///
    /// Why screen colours: the first attempt at the Sentenced floor (P-UNITY-SENTENCED-TILES-1) modelled tiles as albedo against the palette base and passed
    /// every test, but the shader's tint is applied to a shaded, textured ground and then multiplied by a strong zone light. Measured on renders of the real
    /// ArenaView (packet "Established facts") the multiplicative formula acts on the framebuffer's LINEAR colour as a per-channel gain: screen' =
    /// encode(decode(screen) * gain), clipped at 1. (Checked on renders: predicted and measured step differ by less than 1 CIE76 unit.) The gain is what
    /// <see cref="GroundTint.Apply"/> returns for a unit of ground colour; any formula that is not a pure per-channel multiply fails the test that pins that.
    /// </summary>
    internal static class GroundTintScreen
    {
        // ---- representative screen colours -----------------------------------------------------------------------------------------------

        /// <summary>Untinted ground as the running Web client shows it (round 9 and 10 screenshots, mean of a plain patch): fire shots10/73 (1300-1500, 200-300);
        /// sentenced shots10/120 (570-610, 110-140), a dark slab away from lamps; plague shots9/97 grass (700-900, 200-300); frost shots10/10 lake ice (400-600, 500-600);
        /// holy shots9/01 sand (300-600, 520-700).</summary>
        public static readonly (string Zone, int Region, double[] Rgb)[] Web =
        {
            ("fire", 1, new double[] { 181, 116, 63 }), ("sentenced", 2, new double[] { 39, 34, 39 }), ("plague", 3, new double[] { 102, 129, 76 }),
            ("frost", 4, new double[] { 154, 200, 221 }), ("holy", 5, new double[] { 243, 209, 136 }),
        };

        /// <summary>Untinted ground as the capture tool renders it (ground only, fixed shader time; mean over the central tiles of the four hue patches of the
        /// *-var-base.png frames). Fire and Plague are darker here than in the Web client (cause not found), so these are for relative judgements.</summary>
        public static readonly (string Zone, int Region, double[] Rgb)[] CaptureTool =
        {
            ("fire", 1, new double[] { 65, 20, 12 }), ("sentenced", 2, new double[] { 30, 26, 31 }), ("plague", 3, new double[] { 32, 68, 27 }),
            ("frost", 4, new double[] { 162, 203, 228 }), ("holy", 5, new double[] { 225, 175, 95 }),
        };

        /// <summary>The 15th percentile and 85th percentile pixels (mean colour of the darkest and lightest 15 percent) of the untinted capture frames' tiles: the ground's
        /// own texture range inside a tile (slab bevel against slab face, grout against stone), per zone.</summary>
        public static readonly (string Zone, double[] Lo, double[] Hi)[] TextureRange =
        {
            ("fire", new double[] { 39, 11, 5 }, new double[] { 95, 32, 22 }), ("sentenced", new double[] { 17, 14, 20 }, new double[] { 59, 50, 53 }),
            ("plague", new double[] { 23, 55, 20 }, new double[] { 49, 94, 39 }), ("frost", new double[] { 146, 193, 223 }, new double[] { 182, 217, 237 }),
            ("holy", new double[] { 157, 132, 56 }, new double[] { 247, 209, 126 }),
        };

        /// <summary>Sentenced floor under light, Web client: a plain slab in the lit church yard (shots10/120 (1080-1180, 620-700)) and a slab beside a lamp (1380-1440, 230-280).</summary>
        public static readonly double[] SentencedLit = { 120, 116, 123 }, SentencedLampCore = { 192, 185, 192 };

        // ---- colour maths ------------------------------------------------------------------------------------------------------------

        public static double Dec(double v) { v /= 255.0; return v <= .04045 ? v / 12.92 : Math.Pow((v + .055) / 1.055, 2.4); }
        public static double Enc(double v) { v = Math.Min(1, Math.Max(0, v)); return 255.0 * (v <= .0031308 ? v * 12.92 : 1.055 * Math.Pow(v, 1 / 2.4) - .055); }

        static double F(double t) { return t > 216.0 / 24389 ? Math.Pow(t, 1.0 / 3) : (24389.0 / 27 * t + 16) / 116; }

        /// <summary>CIELAB (D65) of an sRGB byte colour.</summary>
        public static double[] Lab(double[] c)
        {
            double r = Dec(c[0]), g = Dec(c[1]), b = Dec(c[2]);
            double x = .4124564 * r + .3575761 * g + .1804375 * b, y = .2126729 * r + .7151522 * g + .0721750 * b, z = .0193339 * r + .1191920 * g + .9503041 * b;
            double fx = F(x / .95047), fy = F(y), fz = F(z / 1.08883);
            return new[] { 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz) };
        }

        public static double LStar(double[] c) { return Lab(c)[0]; }
        public static double Chroma(double[] c) { var l = Lab(c); return Math.Sqrt(l[1] * l[1] + l[2] * l[2]); }
        public static double HueDegrees(double[] c) { var l = Lab(c); double h = Math.Atan2(l[2], l[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h; }

        /// <summary>CIE76 colour difference between two sRGB byte colours.</summary>
        public static double DeltaE(double[] a, double[] b)
        {
            double[] x = Lab(a), y = Lab(b);
            return Math.Sqrt((x[0] - y[0]) * (x[0] - y[0]) + (x[1] - y[1]) * (x[1] - y[1]) + (x[2] - y[2]) * (x[2] - y[2]));
        }

        // ---- the bridge from the shader mirror to the screen --------------------------------------------------------------------------

        /// <summary>The per-channel gain the mirror gives a tint: what it does to a mid grey, divided by that grey.</summary>
        public static double[] Gain(GroundVariantTint t)
        {
            var o = GroundTint.Apply(.5f, .5f, .5f, t);
            return new[] { o[0] / .5, o[1] / .5, o[2] / .5 };
        }

        /// <summary>The screen colour of a ground pixel after the tint: the mirror applied to the pixel's linear colour (the framebuffer holds linear light, the ground colour is
        /// multiplied by the light before it gets there, so for a gain the order does not matter), encoded back to sRGB bytes and clipped at 1.</summary>
        public static double[] Through(double[] screen, GroundVariantTint t)
        {
            var o = GroundTint.Apply((float)Dec(screen[0]), (float)Dec(screen[1]), (float)Dec(screen[2]), t);
            return new[] { Enc(o[0]), Enc(o[1]), Enc(o[2]) };
        }

        public static double Luminance(double[] gain) { return .2126 * gain[0] + .7152 * gain[1] + .0722 * gain[2]; }

        public static string Rgb(double[] c) { return "(" + c[0].ToString("F0") + ", " + c[1].ToString("F0") + ", " + c[2].ToString("F0") + ")"; }
        public static string Gn(double[] g) { return "gain (" + g[0].ToString("F2") + ", " + g[1].ToString("F2") + ", " + g[2].ToString("F2") + ")"; }
    }
}

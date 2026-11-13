using System.Collections.Generic;
using Roguehalla.Client;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>What a player sees under a name: the colour of the ground in sRGB, as an average and as its darkest and brightest decile.</summary>
    public readonly struct FloorSample
    {
        public readonly string Name; public readonly SurfaceKind Kind; public readonly Color Avg, Dark, Bright;
        public FloorSample(string name, SurfaceKind kind, Color avg, Color dark, Color bright) { Name = name; Kind = kind; Avg = avg; Dark = dark; Bright = bright; }
        public override string ToString() { return Name; }
    }

    /// <summary>
    /// P-UNITY-NAME-LEGIBLE-1 measurement support: samples the ground the client really draws instead of a theme constant.
    /// The three earlier name packets measured <c>RegionThemes.Get(zone).BaseSrgb</c>, a single flat colour; the floor is a baked texture
    /// (highlights, grout, patches) tinted by the palette in <c>Resources/Regions/RegionGround.shader</c>. The region floors are evaluated texel by
    /// texel with that shader's own formula (<c>ShadeRegion</c>, <c>ShadePlague</c>, the temple slab mix) over the real baked detail layers
    /// (<see cref="RegionGroundTextures.DetailLayer"/>), at a neutral macro variation. NOT modelled: local lights (they brighten pools of
    /// ground), fog, Plague water and greenery pockets, Holy garden pockets, lava glow.
    /// The terrain surfaces (ice, healing light) are the bracket between the terrain table's Deep and Light colours that the shader blends
    /// (<c>RegionThemes.TerrainLookOf</c>): dark = Deep, average = their midpoint, bright = Light. Every region floor is then scaled by <see cref="DrawnLight"/>.
    /// </summary>
    public static class NameLegibleFloors
    {
        /// <summary>The nine floors the oracle covers: the five zones' plain ground, the Coliseum limestone, ice, healing light and the Holy temple paving.</summary>
        public static readonly SurfaceKind[] Kinds =
        {
            SurfaceKind.Basalt, SurfaceKind.Flagstone, SurfaceKind.Mud, SurfaceKind.Snow, SurfaceKind.Sand,
            SurfaceKind.Limestone, SurfaceKind.Ice, SurfaceKind.HolyLight, SurfaceKind.TempleFloor,
        };

        /// <summary>The measurement as published in RoguehallaNet.Tests/NameLegibleTests.cs (sRGB 0xRRGGBB: average, darkest decile, brightest decile).</summary>
        public static readonly (SurfaceKind Kind, uint Avg, uint Dark, uint Bright)[] Published =
        {
            (SurfaceKind.Basalt, 0x46251C, 0x2B140D, 0x64372C),
            (SurfaceKind.Flagstone, 0x272223, 0x0E0D12, 0x433937),
            (SurfaceKind.Mud, 0x394C23, 0x303423, 0x43681D),
            (SurfaceKind.Snow, 0xA1BED0, 0x8CB1C6, 0xB8CBD7),
            (SurfaceKind.Sand, 0xCC9F55, 0xAB7A29, 0xEEC378),
            (SurfaceKind.Limestone, 0x9C9183, 0x645C54, 0xB9AD9B),
            (SurfaceKind.Ice, 0xA6CAE3, 0x3296C9, 0xDFF0FA),
            (SurfaceKind.HolyLight, 0xAC8B4B, 0x765417, 0xD2AE65),
            (SurfaceKind.TempleFloor, 0xBEAA86, 0xB8A47E, 0xC2B08F),
        };

        static readonly Dictionary<SurfaceKind, FloorSample> Cache = new Dictionary<SurfaceKind, FloorSample>();

        public static FloorSample Of(SurfaceKind kind)
        {
            if (Cache.TryGetValue(kind, out var sample)) return sample;
            var linear = new List<Color>();
            switch (kind)
            {
                case SurfaceKind.Basalt: Region(1, 0, linear); break;
                case SurfaceKind.Flagstone: Region(2, 1, linear); break;
                case SurfaceKind.Mud: Plague(linear); break;
                case SurfaceKind.Snow: Region(4, 3, linear); break;
                case SurfaceKind.Sand: Region(5, 4, linear); break;
                case SurfaceKind.Limestone: Region(6, 5, linear); break;
                case SurfaceKind.TempleFloor: Temple(linear); break;
                case SurfaceKind.Ice: Terrain(TerrainKind.Ice, linear); break;
                case SurfaceKind.HolyLight: Terrain(TerrainKind.Light, linear); break;
                default: throw new System.ArgumentException("no floor model for " + kind);
            }
            float light = DrawnLight(kind);
            if (light != 1f) for (int i = 0; i < linear.Count; i++) { var c = linear[i]; linear[i] = new Color(c.r * light, c.g * light, c.b * light, 1f); }
            if (kind == SurfaceKind.Ice || kind == SurfaceKind.HolyLight)
                sample = new FloorSample(kind.ToString(), kind, Gamma(linear[1]), Gamma(linear[0]), Gamma(linear[2]));
            else sample = Summarise(kind, linear);
            Cache[kind] = sample;
            return sample;
        }

        /// <summary>
        /// How much brighter (or darker) the ground is drawn than its unlit albedo: the sun's colour and strength per region (RhSunMul) and the
        /// exposure. Measured on the clean floor patches of the round-6 screenshots against this model's luminance: Fire basalt .62 to .73, Frost snow
        /// .59 to .77, Holy sand 1.28, Holy temple paving .81 to 1.16, glossy ice .85 to .88 (the terrain bracket is already lit by its glow). The two
        /// dark-zone ratios and the snow ratio average .68, used where no screenshot shows the ground (Sentenced flagstone, Plague mud, Coliseum limestone).
        /// Lit pools (lanterns, point lights) are brighter than any of these and are NOT modelled.
        /// </summary>
        public static float DrawnLight(SurfaceKind kind)
        {
            switch (kind)
            {
                case SurfaceKind.Sand: return 1.28f;
                case SurfaceKind.TempleFloor: return .95f;
                case SurfaceKind.Ice: case SurfaceKind.HolyLight: return 1f;
                default: return .68f;
            }
        }

        // ---- the shader's formulas (RegionGround.shader ShadeRegion, ShadePlague, the temple floor) ----

        static float Sat(float v) { return Mathf.Clamp01(v); }
        static float Smooth(float a, float b, float x) { float t = Sat((x - a) / (b - a)); return t * t * (3f - 2f * t); }
        static Vector3 V(Color c) { return new Vector3(c.r, c.g, c.b); }
        static Color C(Vector3 v) { return new Color(v.x, v.y, v.z, 1f); }

        static void Region(int id, int layer, List<Color> into)
        {
            var th = RegionThemes.Get(id); var par = th.GroundParams; var par2 = th.GroundParams2;
            Vector3 baseC = V(th.Base), sec = V(th.Secondary), acc = V(th.Accent), key = V(th.Key);
            foreach (var t in RegionGroundTextures.DetailLayer(layer))
            {
                float r = t.r / 255f, g = t.g / 255f, b = t.b / 255f;
                Vector3 c = baseC * (1f + (r - .5f) * par.x * 2f);                                     // macro variation 0: unchanged
                c = Vector3.Lerp(c, key, Sat((r - .42f) * par2.z));
                float patch = Sat(g * par.y + (-.05f) * par2.x * .6f);
                c = Vector3.Lerp(c, Vector3.Lerp(sec, acc, .2f) * (1f + .9f * r), patch);
                c = Vector3.Lerp(c, acc, Sat(b * par.z));
                c += b * par2.w * .5f * new Vector3(.9f, .97f, 1f);
                into.Add(C(c));
            }
        }

        static void Plague(List<Color> into)
        {
            var th = RegionThemes.Get(3); Vector3 baseC = V(th.Base), sec = V(th.Secondary), acc = V(th.Accent);
            Vector3 mudC = Vector3.Lerp(baseC, V(RegionThemes.Get(2).Secondary), .72f);
            foreach (var t in RegionGroundTextures.DetailLayer(2))
            {
                float r = t.r / 255f, g = t.g / 255f, b = t.b / 255f, a = t.a / 255f;
                Vector3 mud = mudC * (.95f + .9f * r);
                mud = Vector3.Lerp(mud, mudC * .42f, Smooth(.55f, .8f, b) * .55f + Smooth(.35f, 0f, a) * .25f);
                Vector3 grass = Vector3.Lerp(sec * 1.05f, Vector3.Lerp(sec, acc, .2f) * 1.7f, Sat(g * .85f));
                into.Add(C(mud)); into.Add(C(grass));          // the ground is mud and grass patches: both are floor
            }
        }

        static void Temple(List<Color> into)
        {
            Vector3 stone = V(TempleStyle.Stone.linear), light = Vector3.Lerp(stone, Vector3.one, .16f), dark = stone * .74f;
            for (int i = 0; i < 16; i++)
            {
                Vector3 slab = Vector3.Lerp(light, stone, .25f + .6f * (i / 15f));
                into.Add(C(slab));
                if (i % 4 == 0) into.Add(C(Vector3.Lerp(slab, dark, .2f)));   // a joint every few slabs
            }
        }

        static void Terrain(TerrainKind kind, List<Color> into)
        {
            var look = RegionThemes.TerrainLookOf((int)kind);
            into.Add(look.Deep); into.Add(Color.Lerp(look.Deep, look.Light, .5f)); into.Add(look.Light);
        }

        static double Lum(Color linear) { return .2126 * linear.r + .7152 * linear.g + .0722 * linear.b; }
        static Color Gamma(Color linear) { var c = linear.gamma; c.a = 1f; return new Color(Mathf.Clamp01(c.r), Mathf.Clamp01(c.g), Mathf.Clamp01(c.b), 1f); }

        static FloorSample Summarise(SurfaceKind kind, List<Color> linear)
        {
            linear.Sort((x, y) => Lum(x).CompareTo(Lum(y)));
            int n = linear.Count, decile = System.Math.Max(1, n / 10);
            Color Mean(int from, int count) { Vector3 s = Vector3.zero; for (int i = from; i < from + count; i++) s += V(linear[i]); return C(s / count); }
            return new FloorSample(kind.ToString(), kind, Gamma(Mean(0, n)), Gamma(Mean(0, decile)), Gamma(Mean(n - decile, decile)));
        }

        // ---- contrast, WCAG 2 ----

        public static double Lin(double v) { return v <= .04045 ? v / 12.92 : System.Math.Pow((v + .055) / 1.055, 2.4); }
        public static double Luminance(Color c) { return .2126 * Lin(c.r) + .7152 * Lin(c.g) + .0722 * Lin(c.b); }
        public static double Ratio(Color a, Color b) { double x = Luminance(a), y = Luminance(b); return (System.Math.Max(x, y) + .05) / (System.Math.Min(x, y) + .05); }
    }
}

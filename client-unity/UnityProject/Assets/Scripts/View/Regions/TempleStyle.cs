// One stone, one gilt, one glass palette for the whole temple: the floor shader, the pier skins in the wall atlas and the temple props read
// the same values, so the building looks cut from a single material. Colours come from the generated Holy palette (no imported art).
using UnityEngine;

namespace Roguehalla.Client
{
    public static class TempleStyle
    {
        static Color P(int slot) { return (Color)RegionPaletteGenerated.Srgb[5][slot]; }
        static Color Mix(Color a, Color b, float t) { return Color.Lerp(a, b, t); }
        static Color Shade(Color c, float k) { return new Color(Mathf.Clamp01(c.r * k), Mathf.Clamp01(c.g * k), Mathf.Clamp01(c.b * k), 1f); }
        static Color Desat(Color c, float k) { float l = c.r * .3f + c.g * .59f + c.b * .11f; return Mix(c, new Color(l, l, l, 1f), k); }

        /// <summary>Warm ivory limestone, cooled and calmed compared with the saturated sand outside (an interior, in shade).</summary>
        public static Color Stone { get { return Desat(Mix(P(RegionPaletteGenerated.Base), P(RegionPaletteGenerated.Key), .42f), .40f); } }
        public static Color StoneLight { get { return Mix(Stone, Color.white, .16f); } }
        public static Color StoneDark { get { return Shade(Mix(Stone, P(RegionPaletteGenerated.Shadow), .12f), .74f); } }
        /// <summary>Inlaid gold (the Holy accent pulled toward the key light).</summary>
        public static Color Gilt { get { return Mix(P(RegionPaletteGenerated.Accent), P(RegionPaletteGenerated.Key), .5f); } }
        public static Color GiltDark { get { return Shade(P(RegionPaletteGenerated.Accent), .8f); } }
        /// <summary>Glazed tile green and the cool blue of the glass; only ever small fields, never large areas.</summary>
        public static Color Tile { get { return P(RegionPaletteGenerated.Secondary); } }
        public static Color Glass { get { return Mix(P(RegionPaletteGenerated.Secondary), new Color(.25f, .55f, .8f, 1f), .5f); } }
        public static Color Shadow { get { return P(RegionPaletteGenerated.Shadow); } }
    }
}

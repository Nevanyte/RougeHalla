namespace Roguehalla.Net.Ui
{
    /// <summary>The four kinds of world name (P-UNITY-NAME-LEGIBLE-1).</summary>
    public enum NameKind : byte { Mob, Elite, Fighter, Local }

    /// <summary>A name's face (the glyph fill) and outline as 0xRRGGBB sRGB.</summary>
    public struct NameColours { public uint Face, Outline; }

    /// <summary>
    /// The colours a world name is drawn with so it reads on the ground under it (P-UNITY-NAME-LEGIBLE-1). Pure; presentation only.
    /// Three earlier packets fixed a name's alpha, anchor and pack but never its colours: a pale grey face over snow is about 1.1:1.
    /// Stub: today's colours (light face, dark outline) whatever the ground, and no ground is ever pale; the implementer replaces the bodies.
    /// </summary>
    public static class NamePalette
    {
        /// <summary>WCAG relative luminance (0 black .. 1 white) of an sRGB colour 0xRRGGBB. Implemented (a helper, not the rule under test).</summary>
        public static double Luminance(uint rgb)
        {
            return .2126 * Lin(((rgb >> 16) & 255) / 255.0) + .7152 * Lin(((rgb >> 8) & 255) / 255.0) + .0722 * Lin((rgb & 255) / 255.0);
        }

        /// <summary>WCAG contrast ratio (1 .. 21) of two sRGB colours 0xRRGGBB. Implemented (a helper, not the rule under test).</summary>
        public static double Contrast(uint a, uint b)
        {
            double x = Luminance(a), y = Luminance(b);
            return (System.Math.Max(x, y) + .05) / (System.Math.Min(x, y) + .05);
        }

        static double Lin(double v) { return v <= .04045 ? v / 12.92 : System.Math.Pow((v + .055) / 1.055, 2.4); }

        /// <summary>
        /// Whether the ground counts as pale (the name takes a dark face and a light outline) for a floor of relative luminance
        /// <paramref name="floorLuminance"/> (0..1, the average of what the player sees under the name). <paramref name="wasPale"/> is the answer
        /// last frame: the switch has hysteresis, so a pack walking along a zone border does not flicker. Rising luminance switches to pale at
        /// one value and falling luminance back to dark at a lower one, at least .02 apart. Stub: never pale.
        /// </summary>
        public static bool IsPale(double floorLuminance, bool wasPale) { return false; }

        /// <summary>
        /// The face and outline of a name of <paramref name="kind"/> over pale or dark ground. Dark ground: the light faces used today (mob grey-blue,
        /// elite gold, fighter cream, local fighter green). Pale ground: a dark face of the same hue family with a light outline (elite: a dark
        /// gold-brown; local fighter: a dark green). Face against outline is at least 3:1 either way. Stub: today's colours, ignoring
        /// <paramref name="pale"/>.
        /// </summary>
        public static NameColours Colours(NameKind kind, bool pale)
        {
            switch (kind)
            {
                case NameKind.Elite: return new NameColours { Face = 0xF4D576, Outline = 0x0D111B };
                case NameKind.Fighter: return new NameColours { Face = 0xF2EEE3, Outline = 0x0D111B };
                case NameKind.Local: return new NameColours { Face = 0x89DA9B, Outline = 0x0D111B };
                default: return new NameColours { Face = 0xB2BFCE, Outline = 0x0D111B };
            }
        }
    }
}

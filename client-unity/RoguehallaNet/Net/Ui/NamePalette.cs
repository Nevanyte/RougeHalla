namespace Roguehalla.Net.Ui
{
    /// <summary>The four kinds of world name (P-UNITY-NAME-LEGIBLE-1).</summary>
    public enum NameKind : byte { Mob, Elite, Fighter, Local }

    /// <summary>A name's face (the glyph fill) and outline as 0xRRGGBB sRGB.</summary>
    public struct NameColours { public uint Face, Outline; }

    /// <summary>
    /// The colours a world name is drawn with so it reads on the ground under it (P-UNITY-NAME-LEGIBLE-1). Pure; presentation only.
    /// Three earlier packets fixed a name's alpha, anchor and pack but never its colours: a pale grey face over snow is about 1.1:1.
    /// 
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
        /// one value and falling luminance back to dark at a lower one, at least .02 apart.
        /// </summary>
        public static bool IsPale(double floorLuminance, bool wasPale) { return floorLuminance >= (wasPale ? SwitchToDark : SwitchToPale); }

        /// <summary>Rising luminance switches to pale at this value; falling luminance switches back to dark at <see cref="SwitchToDark"/> (a .04 band).</summary>
        public const double SwitchToPale = .22, SwitchToDark = .18;

        const uint DarkOutline = 0x0D111B, PaleOutline = 0xF5F2EA;
        /// <summary>
        /// The face and outline of a name of <paramref name="kind"/> over pale or dark ground. Dark ground: the light faces used today (mob grey-blue,
        /// elite gold, fighter cream, local fighter green). Pale ground: a dark face of the same hue family with a light outline (elite: a dark
        /// gold-brown; local fighter: a dark green). Face against outline is at least 3:1 either way.
        /// </summary>
        public static NameColours Colours(NameKind kind, bool pale)
        {
            uint outline = pale ? PaleOutline : DarkOutline;
            switch (kind)
            {
                case NameKind.Elite: return new NameColours { Face = pale ? 0x2A1A02u : 0xF4D576u, Outline = outline };
                case NameKind.Fighter: return new NameColours { Face = pale ? 0x0A0A0Au : 0xF2EEE3u, Outline = outline };
                case NameKind.Local: return new NameColours { Face = pale ? 0x03280Fu : 0xA8EFB8u, Outline = outline };
                default: return new NameColours { Face = pale ? 0x0A1018u : 0xE3EAF1u, Outline = outline };
            }
        }
    }
}

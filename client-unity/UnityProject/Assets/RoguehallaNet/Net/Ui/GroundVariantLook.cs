namespace Roguehalla.Net.Ui
{
    /// <summary>How a ground-variant cell is tinted over the zone's base ground: colour (sRGB bytes) and strength 0..1 of the blend toward it.</summary>
    public readonly struct GroundVariantTint
    {
        public readonly byte R, G, B;
        public readonly float Strength;
        public GroundVariantTint(byte r, byte g, byte b, float strength) { R = r; G = g; B = b; Strength = strength; }
    }

    /// <summary>Variant (MapBlob.GroundVariants cell; 1..8 in the shipped rules) to ground look, per region (wire region id 1 fire, 2 sentenced, 3 plague, 4 frost, 5 holy).
    /// 1 and 2 are the zone's fallback rings (a darker and a lighter shade of the zone's own colour), 3-6 the landmark bands (a fixed hue
    /// mixed with the zone colour, so the same number reads differently per zone), 7 water and 8 mud. All are tints over the base ground.</summary>
    public static class GroundVariantLook
    {
        // Zone colour (sRGB) per region id 1..5.
        static readonly byte[][] Zone =
        {
            new byte[] { 150, 70, 40 }, new byte[] { 110, 105, 120 }, new byte[] { 70, 110, 60 }, new byte[] { 150, 185, 215 }, new byte[] { 205, 180, 110 },
        };
        // Band hues for variants 3..6, then water (7) and mud (8).
        static readonly byte[][] Hue =
        {
            new byte[] { 205, 75, 45 }, new byte[] { 125, 85, 165 }, new byte[] { 85, 170, 160 }, new byte[] { 215, 170, 70 },
            new byte[] { 45, 105, 175 }, new byte[] { 115, 80, 50 },
        };
        static readonly float[] BandStrength = { .45f, .40f, .42f, .38f, .62f, .62f };

        static byte Mix(int a, int b, float t) { return (byte)(a + (b - a) * t + .5f); }

        /// <summary>False for variant 0 (the base ground) and for a variant the table does not know.</summary>
        public static bool TryGet(int region, byte variant, out GroundVariantTint tint)
        {
            tint = default(GroundVariantTint);
            if (variant < 1 || variant > 8 || region < 1 || region > 5) return false;
            var z = Zone[region - 1];
            if (variant == 1) { tint = new GroundVariantTint(Mix(z[0], 0, .55f), Mix(z[1], 0, .55f), Mix(z[2], 0, .55f), .30f); return true; }
            if (variant == 2) { tint = new GroundVariantTint(Mix(z[0], 255, .40f), Mix(z[1], 255, .40f), Mix(z[2], 255, .40f), .28f); return true; }
            var h = Hue[variant - 3];
            if (variant >= 7) tint = new GroundVariantTint(h[0], h[1], h[2], BandStrength[variant - 3]);
            else tint = new GroundVariantTint(Mix(h[0], z[0], .25f), Mix(h[1], z[1], .25f), Mix(h[2], z[2], .25f), BandStrength[variant - 3]);
            return true;
        }
    }
}

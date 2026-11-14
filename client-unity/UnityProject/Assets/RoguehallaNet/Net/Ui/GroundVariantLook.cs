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
    /// 1 and 2 are the zone's fallback rings (darker and lighter), 3-6 the landmark bands (warmer, purple-cooler, teal-cooler, golden), 7 water and 8 mud.
    /// All modulate the base ground (GroundVariantTint is a per-channel gain, byte 128 neutral), so the ground's texture and light stay.</summary>
    public static class GroundVariantLook
    {
        // The look is a gain, not a colour (see GroundTint): texel byte 128 is neutral, and a texel is (gain * 128) per channel at full strength.
        // Rel is each band's relative gain at strength 1 (1 darker, 2 lighter, 3..6 hue bands); Strength[region - 1][variant - 1] scales it per zone,
        // because the zone light and the ground's own brightness make the same gain read very differently (Sentenced about 3x Frost). Chosen on rendered pixels.
        static readonly float[][] Rel =
        {
            new[] { .55f, .55f, .55f }, new[] { 1.6f, 1.6f, 1.6f }, new[] { 1.9f, .69f, .42f }, new[] { 1.15f, .45f, 1.8f }, new[] { .5f, 1.3f, 1.25f }, new[] { 1.42f, 1.12f, .46f },
        };
        static readonly float[][] Strength =
        {
            new[] { .35f, .29f, .11f, .25f, .18f, .23f }, new[] { .86f, .86f, .33f, .21f, .54f, .40f }, new[] { .60f, .50f, .30f, .20f, .40f, .45f },
            new[] { .30f, .25f, .15f, .06f, .24f, .13f }, new[] { .27f, .23f, .09f, .09f, .13f, .16f },
        };
        static byte ToByte(float gain) { return (byte)(int)(gain * 128f + .5f); }

        public static bool TryGet(int region, byte variant, out GroundVariantTint tint)
        {
            tint = default(GroundVariantTint);
            if (variant < 1 || variant > 8 || region < 1 || region > 5) return false;
            if (variant == 7) { tint = new GroundVariantTint(ToByte(.6f), ToByte(1.0f), ToByte(1.8f), 1f); return true; }
            if (variant == 8) { tint = new GroundVariantTint(ToByte(1.45f), ToByte(.85f), ToByte(.55f), 1f); return true; }
            if (region == 2 && variant == 1) { tint = new GroundVariantTint(ToByte(.85f), ToByte(.6f), ToByte(.75f), 1f); return true; }
            var rel = Rel[variant - 1]; float a = Strength[region - 1][variant - 1];
            tint = new GroundVariantTint(ToByte(1 + a * (rel[0] - 1)), ToByte(1 + a * (rel[1] - 1)), ToByte(1 + a * (rel[2] - 1)), 1f);
            return true;
        }
    }
}

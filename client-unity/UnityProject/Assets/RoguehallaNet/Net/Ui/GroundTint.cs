using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-GROUND-TINT-1. The engine-free mirror of the ground shader's variant path (Resources/Regions/RegionGround.shader) and the one place that
    /// decides which texel a tile bakes into the variant plane. A tint must modulate the ground, never replace it:
    ///   col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);        // vt = the baked texel, rgb and a as 0..1; byte 128 is the neutral value
    /// per channel, gain = 1 + a * (R / 128 - 1), so a tile's gain is the same whatever the ground drew there and the ground's texture, bevels, cracks and
    /// lighting survive. The sample coordinate is the tile's own (floor(t)), not the warped one the region borders use, so an edge follows tile boundaries.
    /// </summary>
    public static class GroundTint
    {
        /// <summary>The byte value of a texel channel that leaves the ground unchanged (gain 1) at any strength.</summary>
        public const int NeutralByte = 128;

        static float StrengthByte(GroundVariantTint t) { return (float)Math.Round(Math.Min(1f, Math.Max(0f, t.Strength)) * 255.0) / 255f; }
        static float GainOf(byte c, float a) { return 1f + a * (c / 128f - 1f); }

        public static float[] Apply(float r, float g, float b, GroundVariantTint tint)
        {
            float a = StrengthByte(tint);
            return new[] { r * GainOf(tint.R, a), g * GainOf(tint.G, a), b * GainOf(tint.B, a) };
        }

        static byte Byte(float gain) { return (byte)Math.Min(255, Math.Max(0, (int)Math.Round(gain * 128f))); }

        public static GroundVariantTint Compose(GroundVariantTint first, GroundVariantTint second)
        {
            float a1 = StrengthByte(first), a2 = StrengthByte(second);
            return new GroundVariantTint(Byte(GainOf(first.R, a1) * GainOf(second.R, a2)), Byte(GainOf(first.G, a1) * GainOf(second.G, a2)), Byte(GainOf(first.B, a1) * GainOf(second.B, a2)), 1f);
        }

        public static bool Bake(int region, byte variant, int tileX, int tileY, out GroundVariantTint tint)
        {
            bool band = GroundVariantLook.TryGet(region, variant, out tint);
            if (region != 2) return band;
            int f = SentencedTiles.Family(tileX, tileY);
            if (f == SentencedTiles.Base) return band;
            tint = band ? Compose(tint, SentencedTiles.Tint(f)) : SentencedTiles.Tint(f);
            return true;
        }
    }
}

using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-GROUND-TINT-1. The engine-free mirror of the ground shader's variant path (Resources/Regions/RegionGround.shader) and the one place that
    /// decides which texel a tile bakes into the variant plane. A tint must modulate the ground, never replace it:
    ///   col *= lerp(1.0, vt.rgb * (255.0 / 128.0), vt.a);        // vt = the baked texel, rgb and a as 0..1; byte 128 is the neutral value
    /// per channel, gain = 1 + a * (R / 128 - 1), so a tile's gain is the same whatever the ground drew there and the ground's texture, bevels, cracks and
    /// lighting survive. The sample coordinate is the tile's own (floor(t)), not the warped one the region borders use, so an edge follows tile boundaries.
    /// STUB: <see cref="Apply"/> is today's flat replacement (col = lerp(col, tint, a)), <see cref="Compose"/> ignores its second argument and
    /// <see cref="Bake"/> knows only the server's variant (no Sentenced scatter). The implementer replaces all three.
    /// </summary>
    public static class GroundTint
    {
        /// <summary>The byte value of a texel channel that leaves the ground unchanged (gain 1) at any strength.</summary>
        public const int NeutralByte = 128;

        /// <summary>The shader's variant formula on a pre-lighting ground colour (r, g, b as the shader holds them, 0..1) and a baked tint. Returns the new colour, three floats.</summary>
        public static float[] Apply(float r, float g, float b, GroundVariantTint tint)
        {
            float a = (float)Math.Round(Math.Min(1f, Math.Max(0f, tint.Strength)) * 255.0) / 255f;   // the plane stores strength in a byte
            return new[] { r + (tint.R / 255f - r) * a, g + (tint.G / 255f - g) * a, b + (tint.B / 255f - b) * a };
        }

        /// <summary>One tint whose <see cref="Apply"/> equals applying <paramref name="first"/> and then <paramref name="second"/> (the product of their gains, per channel,
        /// clamped to what a texel can hold: 0 to 255/128). Used where a tile carries both a server variant and a scatter family: one texel per tile.</summary>
        public static GroundVariantTint Compose(GroundVariantTint first, GroundVariantTint second) { return first; }

        /// <summary>The texel a tile bakes into the variant plane: the server's variant look for this region (<see cref="GroundVariantLook.TryGet"/>), combined (via
        /// <see cref="Compose"/>, band first, family second) with the Sentenced scatter family of the tile when the region is Sentenced (2) and the family is not the base.
        /// False when the tile draws the untouched ground. <paramref name="tileX"/>, <paramref name="tileY"/> are map tile coordinates.</summary>
        public static bool Bake(int region, byte variant, int tileX, int tileY, out GroundVariantTint tint)
        {
            return GroundVariantLook.TryGet(region, variant, out tint);
        }
    }
}

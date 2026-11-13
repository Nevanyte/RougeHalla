namespace Roguehalla.Net.Ui
{
    /// <summary>How a ground-variant cell is tinted over the zone's base ground: colour (sRGB bytes) and strength 0..1 of the blend toward it.</summary>
    public readonly struct GroundVariantTint
    {
        public readonly byte R, G, B;
        public readonly float Strength;
        public GroundVariantTint(byte r, byte g, byte b, float strength) { R = r; G = g; B = b; Strength = strength; }
    }

    /// <summary>Variant (MapBlob.GroundVariants cell; 1..8 in the shipped rules) to ground look, per region (wire region id 1 fire, 2 sentenced, 3 plague, 4 frost, 5 holy). P-UNITY-DRESS-1 fills it.</summary>
    public static class GroundVariantLook
    {
        /// <summary>False for variant 0 (the base ground) and for a variant the table does not know.</summary>
        public static bool TryGet(int region, byte variant, out GroundVariantTint tint) { tint = default(GroundVariantTint); return false; }
    }
}

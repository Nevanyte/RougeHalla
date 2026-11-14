namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Which stone tint each tile of the Sentenced zone's floor takes (P-UNITY-SENTENCED-TILES-1). A pure function of the tile's map
    /// coordinates, so every client and every visit draws the same floor. The CPU bakes it into the ground variant plane the ground shader already
    /// samples (RegionGround.BakeVariants); the shader gets no new texture, sampler or hash.
    /// </summary>
    public static class SentencedTiles
    {
        /// <summary>The family indices the packet names: 0 the zone's own dark stone (baked as no tint), then a lighter grey, a brown and a purple. More families may follow.</summary>
        public const int Base = 0, LighterGrey = 1, Brown = 2, Purple = 3;

        // STUB: every family is today's base ground (31, 30, 37) with no blend, and every tile is the base family. The implementer replaces the data and the choice.
        static readonly GroundVariantTint[] Tints =
        {
            new GroundVariantTint(31, 30, 37, 0f), new GroundVariantTint(31, 30, 37, 0f), new GroundVariantTint(31, 30, 37, 0f), new GroundVariantTint(31, 30, 37, 0f),
        };

        /// <summary>How many families there are (at least 4).</summary>
        public static int FamilyCount { get { return Tints.Length; } }

        /// <summary>The family (0..FamilyCount - 1) of the tile at these map coordinates. Pure: no state, no map size, any int coordinates (negative included).</summary>
        public static int Family(int tileX, int tileY) { return Base; }

        /// <summary>The look a family bakes into the ground variant texel (sRGB bytes and the 0..1 strength of the blend over the ground the shader drew, as GroundVariantLook does). Family 0 has strength 0: the shader's own stone, untouched.</summary>
        public static GroundVariantTint Tint(int family) { return Tints[family]; }
    }
}

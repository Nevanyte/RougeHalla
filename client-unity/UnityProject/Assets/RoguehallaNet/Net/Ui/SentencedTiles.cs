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

        // Family tints, blended at strength .6 over the shader's stone (base 31, 30, 37). Resulting albedos: lighter grey about (48, 50, 57), brown (44, 27, 15), purple (38, 21, 54).
        static readonly GroundVariantTint[] Tints =
        {
            new GroundVariantTint(31, 30, 37, 0f),
            new GroundVariantTint(59, 63, 70, .6f),     // lighter, cool slate grey
            new GroundVariantTint(53, 25, 0, .6f),     // warm umber brown
            new GroundVariantTint(43, 15, 65, .6f),     // muted plum
        };

        /// <summary>How many families there are (at least 4).</summary>
        public static int FamilyCount { get { return Tints.Length; } }

        /// <summary>The family (0..FamilyCount - 1) of the tile at these map coordinates. Pure: no state, no map size, any int coordinates (negative included).</summary>
        public static int Family(int tileX, int tileY)
        {
            unchecked
            {
                uint h = (uint)tileX * 0x9E3779B1u;
                h ^= h >> 15; h += (uint)tileY * 0x85EBCA77u;
                h ^= h >> 13; h *= 0xC2B2AE3Du;
                h ^= h >> 16; h *= 0x27D4EB2Fu;
                h ^= h >> 15; h *= 0x165667B1u;
                h ^= h >> 13; h *= 0x85EBCA6Bu;
                h ^= h >> 16;
                uint v = h >> 8;
                if (v < 10405000u) return Base;
                if (v < 12536000u) return LighterGrey;
                if (v < 14656000u) return Brown;
                return Purple;
            }
        }

        /// <summary>The look a family bakes into the ground variant texel (sRGB bytes and the 0..1 strength of the blend over the ground the shader drew, as GroundVariantLook does). Family 0 has strength 0: the shader's own stone, untouched.</summary>
        public static GroundVariantTint Tint(int family) { return Tints[family]; }
    }
}

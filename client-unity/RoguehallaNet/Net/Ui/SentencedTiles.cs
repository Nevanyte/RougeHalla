namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Which stone family each tile of the Sentenced zone's floor takes (P-UNITY-GROUND-TINT-1; owner direction 2026-11-13: "some more tile random variance could help,
    /// with dark lighting it could still work, perhaps some brown tiles, lighter greys some purples all randomly dispersed (should still be relatively dark)").
    /// A pure function of the tile's map coordinates, so every client and every visit draws the same floor. <see cref="Family"/> is the hash of the first, reverted
    /// attempt (its dispersal tests were sound); <see cref="Tint"/> is the family's gain as a baked texel (see <see cref="GroundTint"/>), and is what the implementer sets.
    /// Looks (gain per channel, strength 1): lighter grey x1.35, brown (1.45, 1.0, 0.65), purple (1.05, 0.8, 1.5); chosen on screen colours so the floor stays dark.
    /// </summary>
    public static class SentencedTiles
    {
        /// <summary>The family indices the packet names: 0 the zone's own stone (baked as no tint), then a lighter grey, a brown and a purple. More families may follow (at most 8 in all).</summary>
        public const int Base = 0, LighterGrey = 1, Brown = 2, Purple = 3;

        static readonly GroundVariantTint None = new GroundVariantTint(128, 128, 128, 0f);

        /// <summary>How many families there are (4 to 8).</summary>
        public static int FamilyCount { get { return 4; } }

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

        /// <summary>The family's look as a baked texel: gain per channel 1 + Strength * (R / 128 - 1), see <see cref="GroundTint"/>. The base family has gain 1 (strength 0).</summary>
        public static GroundVariantTint Tint(int family) { return family == 1 ? new GroundVariantTint(173, 173, 173, 1f) : family == 2 ? new GroundVariantTint(186, 128, 83, 1f) : family == 3 ? new GroundVariantTint(134, 102, 192, 1f) : None; }
    }
}

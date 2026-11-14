using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Draws one kind's art onto a classified landmark (roof, walls, arch, glow). Registered per anchor kind code.</summary>
    public delegate void LandmarkArtBuilder(Landmark landmark);

    /// <summary>
    /// P-UNITY-LANDMARK-1: the registration point for a kind's art. Follow-up packets add one case to <see cref="TryGet"/>:
    /// P-UNITY-LANDMARK-2 Volcano and -3 Church are registered; -4 BogTree and -5 Hall are still to come.
    /// </summary>
    public static class LandmarkArts
    {
        /// <summary>True for the five codes the wire carries (MapBlob.AnchorKind*).</summary>
        public static bool IsKnownKind(byte kind) { return kind >= MapBlob.AnchorKindVolcano && kind <= MapBlob.AnchorKindHall; }

        public static bool TryGet(byte kind, out LandmarkArtBuilder builder)
        {
            switch (kind)
            {
                case MapBlob.AnchorKindCave: builder = CaveLandmark.Build; return true;
                case MapBlob.AnchorKindVolcano: builder = VolcanoLandmark.Build; return true;
                case MapBlob.AnchorKindChurch: builder = ChurchLandmark.Build; return true;
                default: builder = null; return false;
            }
        }

        public static bool Has(byte kind) { return TryGet(kind, out _); }
    }
}

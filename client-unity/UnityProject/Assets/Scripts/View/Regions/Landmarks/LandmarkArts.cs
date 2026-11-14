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

        static readonly System.Collections.Generic.Dictionary<byte, LandmarkArtBuilder> Overrides = new System.Collections.Generic.Dictionary<byte, LandmarkArtBuilder>();

        /// <summary>For tests only (SEAMS-1): registers <paramref name="builder"/> for <paramref name="kind"/>, taking precedence over the production switch
        /// (also for a kind that has no art). Undo with <see cref="ClearOverrides"/>.</summary>
        public static void SetOverride(byte kind, LandmarkArtBuilder builder) { Overrides[kind] = builder; }
        /// <summary>For tests only: removes every override.</summary>
        public static void ClearOverrides() { Overrides.Clear(); }

        public static bool TryGet(byte kind, out LandmarkArtBuilder builder)
        {
            if (Overrides.TryGetValue(kind, out builder)) return true;
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

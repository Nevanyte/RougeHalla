using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Draws one kind's art onto a classified landmark (roof, walls, arch, glow). Registered per anchor kind code.</summary>
    public delegate void LandmarkArtBuilder(Landmark landmark);

    /// <summary>
    /// P-UNITY-LANDMARK-1: the registration point for a kind's art. Follow-up packets add one case to <see cref="TryGet"/>:
    /// All five kinds are registered: Cave, Volcano (-2), Church (-3), BogTree (-4) and Hall (-5).
    /// </summary>
    public static class LandmarkArts
    {
        /// <summary>True for the five codes the wire carries (MapBlob.AnchorKind*).</summary>
        public static bool IsKnownKind(byte kind) { return kind >= MapBlob.AnchorKindVolcano && kind <= MapBlob.AnchorKindHall; }

        static readonly System.Collections.Generic.Dictionary<byte, LandmarkArtBuilder> Overrides = new System.Collections.Generic.Dictionary<byte, LandmarkArtBuilder>();

        /// <summary>For tests only (SEAMS-1): registers <paramref name="builder"/> for <paramref name="kind"/>, taking precedence over the production switch
        /// (also for a kind that has no art). A null builder makes the kind one with no art, which is how a test still reaches the
        /// "known kind, no art" path now that all five kinds are registered. Undo with <see cref="ClearOverrides"/>.</summary>
        public static void SetOverride(byte kind, LandmarkArtBuilder builder) { Overrides[kind] = builder; }
        /// <summary>For tests only: removes every override.</summary>
        public static void ClearOverrides() { Overrides.Clear(); }

        public static bool TryGet(byte kind, out LandmarkArtBuilder builder)
        {
            if (Overrides.TryGetValue(kind, out builder)) return builder != null;
            switch (kind)
            {
                case MapBlob.AnchorKindCave: builder = CaveLandmark.Build; return true;
                case MapBlob.AnchorKindVolcano: builder = VolcanoLandmark.Build; return true;
                case MapBlob.AnchorKindChurch: builder = ChurchLandmark.Build; return true;
                case MapBlob.AnchorKindBogTree: builder = BogTreeLandmark.Build; return true;
                case MapBlob.AnchorKindHall: builder = HallLandmark.Build; return true;
                default: builder = null; return false;
            }
        }

        public static bool Has(byte kind) { return TryGet(kind, out _); }
    }
}

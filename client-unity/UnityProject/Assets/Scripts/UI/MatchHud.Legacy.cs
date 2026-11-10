using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>The legacy-anchored in-match HUD (docs/rework/LEGACY_LAYOUT.md). Everything here lives in HUD units on the stages.</summary>
    public sealed partial class MatchHud
    {
        HudViewport _viewport;

        void ApplyLegacyViewport(HudViewport viewport)
        {
            _viewport = viewport;
        }
    }
}

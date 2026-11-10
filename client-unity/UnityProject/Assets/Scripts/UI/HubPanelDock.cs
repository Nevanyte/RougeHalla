using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The one place the hub's account panels (Shop, Wardrobe, Titles, Achievements, Leaderboard, Profile and Records, the Champions and Weapons
    /// guide) sit: right of the launch panel and under the wordmark, in HUD units (legacy stage), so they share a layout instead of each covering
    /// the whole hub room. The launch panel is 330 units wide docked at 12; the wordmark and tagline end near 118 units from the top.
    /// </summary>
    public static class HubPanelDock
    {
        public const float Left = 354f, Top = 122f, Margin = 12f, MaxWidth = 1000f;

        /// <summary>Normalised anchors of the dock inside a stage of <paramref name="uiWidth"/> by <paramref name="uiHeight"/> HUD units.</summary>
        public static void Anchors(float uiWidth, float uiHeight, out Vector2 min, out Vector2 max)
        {
            uiWidth = Mathf.Max(uiWidth, 320f); uiHeight = Mathf.Max(uiHeight, 320f);
            float left = uiWidth < 640f ? Margin : Left;                      // a narrow window gives the panel the whole width
            float right = Mathf.Min(uiWidth - Margin, left + MaxWidth);
            float top = uiHeight < 480f ? Margin : Top;
            min = new Vector2(left / uiWidth, Margin / uiHeight);
            max = new Vector2(right / uiWidth, 1f - top / uiHeight);
        }

        public static void Apply(RectTransform panel, HudViewport viewport)
        {
            if (panel == null) return;
            Anchors(viewport.UiWidth, viewport.UiHeight, out var min, out var max);
            panel.anchorMin = min; panel.anchorMax = max; panel.offsetMin = panel.offsetMax = Vector2.zero;
        }
    }
}

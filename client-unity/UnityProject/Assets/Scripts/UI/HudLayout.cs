using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>The legacy overlay's viewport solution for one window size (see docs/rework/LEGACY_LAYOUT.md section 0.1).</summary>
    public readonly struct HudViewport
    {
        /// <summary>Screen pixels per HUD unit (legacy "overlay scale"): clamp(min(stageW/1280, stageH/800), 0.8, 1.5).</summary>
        public readonly float Scale;
        /// <summary>The stage in screen pixels: the window, never wider than 21:9 (a centred strip when wider).</summary>
        public readonly float StageWidth, StageHeight;
        /// <summary>The stage in HUD units (1 unit = 1 legacy CSS px): StageWidth / Scale by StageHeight / Scale.</summary>
        public readonly float UiWidth, UiHeight;
        /// <summary>Legacy data-ui-short (uiH below 760) and data-ui-narrow (uiW below 600).</summary>
        public readonly bool Short, Narrow;

        public HudViewport(float scale, float stageW, float stageH)
        {
            Scale = scale; StageWidth = stageW; StageHeight = stageH;
            UiWidth = stageW / scale; UiHeight = stageH / scale;
            Short = UiHeight < HudLayout.ShortBelow; Narrow = UiWidth < HudLayout.NarrowBelow;
        }
    }

    /// <summary>Pure layout maths mirrored from the legacy client (view/viewport.ts, ui/minimapMath.ts). No Unity objects.</summary>
    public static class HudLayout
    {
        public const float BaseWidth = 1280f, BaseHeight = 800f;
        public const float ScaleMin = .8f, ScaleMax = 1.5f;
        public const float MaxAspect = 21f / 9f;
        public const float ShortBelow = 760f, NarrowBelow = 600f;

        public const float MinimapMin = 195f, MinimapMax = 312f, MinimapHeightShare = .338f;
        public const float MinimapGutter = 12f, MinimapNarrowFloor = 110f;
        /// <summary>Half the weapon bar (142) plus the 10 unit gap that keeps the minimap clear of it.</summary>
        public const float MinimapBarClearance = 142f + 10f;

        static float Whole(float v) { return float.IsNaN(v) || float.IsInfinity(v) ? 1f : Mathf.Max(1f, Mathf.Floor(v)); }

        /// <summary>Solves the legacy stage and scale for a window of the given size in screen pixels.</summary>
        public static HudViewport Viewport(float windowWidth, float windowHeight)
        {
            float w = Whole(windowWidth), h = Whole(windowHeight);
            float stageW = w / h <= MaxAspect ? w : Mathf.Floor(h * MaxAspect);
            float scale = Mathf.Clamp(Mathf.Min(stageW / BaseWidth, h / BaseHeight), ScaleMin, ScaleMax);
            return new HudViewport(scale, stageW, h);
        }

        /// <summary>The scale factor Unity's CanvasScaler (ScaleWithScreenSize, width/height blend) applies to a window.</summary>
        public static float CanvasScalerFactor(float windowWidth, float windowHeight, float referenceWidth = 1920f, float referenceHeight = 1080f, float match = .5f)
        {
            float w = Whole(windowWidth), h = Whole(windowHeight);
            float logWidth = Mathf.Log(w / referenceWidth, 2f), logHeight = Mathf.Log(h / referenceHeight, 2f);
            return Mathf.Pow(2f, Mathf.Lerp(logWidth, logHeight, match));
        }

        /// <summary>The minimap side in HUD units: about a third of the height (195..312), clear of the centred weapon bar, times the user scale.</summary>
        public static float MinimapSize(float uiWidth, float uiHeight, float userScale = 1f)
        {
            float wanted = Mathf.Clamp(Mathf.Round(uiHeight * MinimapHeightShare), MinimapMin, MinimapMax);
            float room = Mathf.Floor(uiWidth / 2f - MinimapGutter - MinimapBarClearance);
            float baseSize = Mathf.Min(wanted, Mathf.Max(MinimapNarrowFloor, room));
            return Mathf.Round(Mathf.Min(baseSize * userScale, uiWidth * .42f, uiHeight * .6f));
        }

        /// <summary>Plate width: min(292, 0.74 * uiW) (legacy 240; widened so the GAINED cells keep their text labels at a readable size). The border-box includes 8 px padding each side.</summary>
        public static float PlateWidth(float uiWidth) { return Mathf.Min(292f, .74f * uiWidth); }

        /// <summary>Legacy champion combat HUD width: min(250, 0.42 * uiW), narrow 0.62 * uiW.</summary>
        public static float ChampionWidth(float uiWidth, bool narrow) { return Mathf.Min(250f, (narrow ? .62f : .42f) * uiWidth); }

        /// <summary>Legacy settings card width: min(320, uiW - 24).</summary>
        public static float SettingsWidth(float uiWidth) { return Mathf.Min(320f, uiWidth - 24f); }

        /// <summary>Legacy help card width: min(560, uiW - 24).</summary>
        public static float HelpWidth(float uiWidth) { return Mathf.Min(560f, uiWidth - 24f); }

        /// <summary>Legacy chest panel width: min(248, 0.42 * uiW), narrow min(220, 0.5 * uiW).</summary>
        public static float ChestWidth(float uiWidth, bool narrow) { return narrow ? Mathf.Min(220f, .5f * uiWidth) : Mathf.Min(248f, .42f * uiWidth); }
    }
}

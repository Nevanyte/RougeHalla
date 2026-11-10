using System;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Device-local display preferences. These settings never enter match or server state.</summary>
    public sealed class UiDisplayPreferences
    {
        const string MapModeKey = "rh.ui.map.toggle";
        const string RouteVisibleKey = "rh.ui.route.visible";
        const string ShowFpsKey = "rh.ui.showFps";
        const string ShowPingKey = "rh.ui.showPing";
        const string MinimapScaleKey = "rh.ui.minimapScale.v2";
        /// <summary>The legacy minimap size steps (settings.ts): 75, 100, 125, 150 and 200 percent.</summary>
        public static readonly float[] MinimapScales = { .75f, 1f, 1.25f, 1.5f, 2f };

        public event Action Changed;
        public bool MapToggle { get; private set; }
        public bool ShowRoute { get; private set; }
        public bool ShowFps { get; private set; }
        public bool ShowPing { get; private set; }
        public float MinimapScale { get; private set; }

        public UiDisplayPreferences()
        {
            MapToggle = PlayerPrefs.GetInt(MapModeKey, 0) != 0;
            ShowRoute = PlayerPrefs.GetInt(RouteVisibleKey, 1) != 0;
            ShowFps = PlayerPrefs.GetInt(ShowFpsKey, 0) != 0;
            ShowPing = PlayerPrefs.GetInt(ShowPingKey, 0) != 0;
            MinimapScale = Snap(PlayerPrefs.GetFloat(MinimapScaleKey, 1f));
        }

        public void SetMapToggle(bool value) { if (MapToggle == value) return; MapToggle = value; SaveInt(MapModeKey, value); RaiseChanged(); }
        public void SetShowRoute(bool value) { if (ShowRoute == value) return; ShowRoute = value; SaveInt(RouteVisibleKey, value); RaiseChanged(); }
        public void SetShowFps(bool value) { if (ShowFps == value) return; ShowFps = value; SaveInt(ShowFpsKey, value); RaiseChanged(); }
        public void SetShowPing(bool value) { if (ShowPing == value) return; ShowPing = value; SaveInt(ShowPingKey, value); RaiseChanged(); }

        public void SetMinimapScale(float value)
        {
            float next = Snap(value);
            if (Mathf.Approximately(next, MinimapScale)) return;
            MinimapScale = next; PlayerPrefs.SetFloat(MinimapScaleKey, next); PlayerPrefs.Save(); RaiseChanged();
        }

        public void CycleMinimapScale()
        {
            SetMinimapScale(MinimapScales[(ScaleIndex(MinimapScale) + 1) % MinimapScales.Length]);
        }

        public void ResetDefaults()
        {
            MapToggle = false; ShowRoute = true; ShowFps = false; ShowPing = false; MinimapScale = 1f;
            PlayerPrefs.SetInt(MapModeKey, 0); PlayerPrefs.SetInt(RouteVisibleKey, 1);
            PlayerPrefs.SetInt(ShowFpsKey, 0); PlayerPrefs.SetInt(ShowPingKey, 0); PlayerPrefs.SetFloat(MinimapScaleKey, 1f);
            PlayerPrefs.Save(); RaiseChanged();
        }

        static int ScaleIndex(float scale)
        {
            int best = 0;
            for (int i = 1; i < MinimapScales.Length; i++) if (Mathf.Abs(MinimapScales[i] - scale) < Mathf.Abs(MinimapScales[best] - scale)) best = i;
            return best;
        }
        static float Snap(float scale) { return MinimapScales[ScaleIndex(scale)]; }
        static void SaveInt(string key, bool value) { PlayerPrefs.SetInt(key, value ? 1 : 0); PlayerPrefs.Save(); }
        void RaiseChanged() { if (Changed != null) Changed(); }
    }
}

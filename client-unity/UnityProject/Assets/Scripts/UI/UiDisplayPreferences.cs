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
        const string MinimapScaleKey = "rh.ui.minimapScale";

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
            int scaleIndex = Mathf.Clamp(PlayerPrefs.GetInt(MinimapScaleKey, 1), 0, 2);
            MinimapScale = ScaleAt(scaleIndex);
        }

        public void SetMapToggle(bool value) { if (MapToggle == value) return; MapToggle = value; SaveInt(MapModeKey, value); RaiseChanged(); }
        public void SetShowRoute(bool value) { if (ShowRoute == value) return; ShowRoute = value; SaveInt(RouteVisibleKey, value); RaiseChanged(); }
        public void SetShowFps(bool value) { if (ShowFps == value) return; ShowFps = value; SaveInt(ShowFpsKey, value); RaiseChanged(); }
        public void SetShowPing(bool value) { if (ShowPing == value) return; ShowPing = value; SaveInt(ShowPingKey, value); RaiseChanged(); }

        public void CycleMinimapScale()
        {
            int index = ScaleIndex(MinimapScale);
            MinimapScale = ScaleAt((index + 1) % 3);
            PlayerPrefs.SetInt(MinimapScaleKey, (index + 1) % 3);
            PlayerPrefs.Save(); RaiseChanged();
        }

        public void ResetDefaults()
        {
            MapToggle = false; ShowRoute = true; ShowFps = false; ShowPing = false; MinimapScale = 1f;
            PlayerPrefs.SetInt(MapModeKey, 0); PlayerPrefs.SetInt(RouteVisibleKey, 1);
            PlayerPrefs.SetInt(ShowFpsKey, 0); PlayerPrefs.SetInt(ShowPingKey, 0); PlayerPrefs.SetInt(MinimapScaleKey, 1);
            PlayerPrefs.Save(); RaiseChanged();
        }

        static float ScaleAt(int index) { return index == 0 ? .85f : index == 2 ? 1.25f : 1f; }
        static int ScaleIndex(float scale) { return scale < .925f ? 0 : scale > 1.1f ? 2 : 1; }
        static void SaveInt(string key, bool value) { PlayerPrefs.SetInt(key, value ? 1 : 0); PlayerPrefs.Save(); }
        void RaiseChanged() { if (Changed != null) Changed(); }
    }
}

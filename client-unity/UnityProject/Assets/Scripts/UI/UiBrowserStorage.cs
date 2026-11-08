using System;
using System.Collections.Generic;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    /// <summary>Per-tab personal planning notes. Contains no ownership/session credentials.</summary>
    public static class UiBrowserStorage
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern string RhUi_GetRoute(string key);
        [DllImport("__Internal")] static extern void RhUi_SetRoute(string key, string value);
        [DllImport("__Internal")] static extern void RhUi_SetTabCapture(int capture);
        [DllImport("__Internal")] static extern string RhUi_ConsumeSignInKey();
#else
        static readonly Dictionary<string, string> Routes = new Dictionary<string, string>();
#endif
        public static string Get(string key)
        {
            try {
#if UNITY_WEBGL && !UNITY_EDITOR
                return RhUi_GetRoute(key);
#else
                return Routes.TryGetValue(key, out var value) ? value : "";
#endif
            } catch { return ""; }
        }
        public static void Set(string key, string value)
        {
            try {
#if UNITY_WEBGL && !UNITY_EDITOR
                RhUi_SetRoute(key, value);
#else
                Routes[key] = value;
#endif
            } catch { /* Optional browser storage may be unavailable. */ }
        }
        public static void CaptureTab(bool capture, bool includeShift = false)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            RhUi_SetTabCapture(capture ? includeShift ? 2 : 1 : 0);
#endif
        }
        public static string ConsumeSignInKey()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return RhUi_ConsumeSignInKey();
#else
            return "";
#endif
        }
    }
}

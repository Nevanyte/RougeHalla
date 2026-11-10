using UnityEngine;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    /// <summary>
    /// The window as the page sees it. The Web player renders at <c>Screen.width</c> device pixels for a canvas that is
    /// CSS-width wide (the page template caps the backbuffer ratio), so the HUD, which is specified in legacy CSS px, needs both.
    /// Outside a browser one CSS px is one screen pixel.
    /// </summary>
    public static class UiDisplayMetrics
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern float RhUi_CanvasCssWidth();
        [DllImport("__Internal")] static extern float RhUi_CanvasCssHeight();
#endif
        /// <summary>The canvas size in CSS px and the device pixels per CSS px, measured from the screen size.</summary>
        public static void Read(out float cssWidth, out float cssHeight, out float pixelRatio)
        {
            float w = Screen.width, h = Screen.height;
            cssWidth = w; cssHeight = h; pixelRatio = 1f;
#if UNITY_WEBGL && !UNITY_EDITOR
            try
            {
                float cw = RhUi_CanvasCssWidth(), ch = RhUi_CanvasCssHeight();
                if (cw >= 1f && ch >= 1f && !float.IsNaN(cw) && !float.IsNaN(ch)) { cssWidth = cw; cssHeight = ch; pixelRatio = Mathf.Max(.25f, w / cw); }
            }
            catch { /* Plugin unavailable: treat the screen as CSS px. */ }
#endif
        }
    }
}

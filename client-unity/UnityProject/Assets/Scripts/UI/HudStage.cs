using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The legacy-sized HUD space. Its RectTransform is exactly <see cref="HudViewport.UiWidth"/> by UiHeight units, centred on the
    /// screen and scaled so that one unit is one legacy CSS px on screen: elements placed inside it use the
    /// numbers in docs/rework/LEGACY_LAYOUT.md literally. The rest of the canvas (menus, hub, modals) keeps its own scaler.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HudStage : MonoBehaviour
    {
        Canvas _canvas;
        int _w = -1, _h = -1;
        float _factor = -1f;

        public HudViewport Viewport { get; private set; }
        /// <summary>Raised after the stage is re-laid-out for a new window size or canvas scale.</summary>
        public event System.Action<HudViewport> ViewportChanged;

        /// <summary>Lays the stage out for a window of the given size and a parent canvas scale factor.</summary>
        public void Apply(float windowWidth, float windowHeight, float canvasScaleFactor)
        {
            var rect = (RectTransform)transform;
            Viewport = HudLayout.Viewport(windowWidth, windowHeight);
            float factor = Mathf.Max(.0001f, canvasScaleFactor);
            rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(.5f, .5f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = new Vector2(Viewport.UiWidth, Viewport.UiHeight);
            float k = Viewport.Scale / factor;
            rect.localScale = new Vector3(k, k, 1f);
            ViewportChanged?.Invoke(Viewport);
        }

        void OnEnable() { _canvas = GetComponentInParent<Canvas>(); Refresh(true); }

        void LateUpdate() { Refresh(false); }

        void Refresh(bool force)
        {
            if (_canvas == null) _canvas = GetComponentInParent<Canvas>();
            float factor = _canvas != null ? _canvas.scaleFactor : HudLayout.CanvasScalerFactor(Screen.width, Screen.height);
            if (!force && Screen.width == _w && Screen.height == _h && Mathf.Approximately(factor, _factor)) return;
            _w = Screen.width; _h = Screen.height; _factor = factor;
            Apply(_w, _h, factor);
        }
    }
}

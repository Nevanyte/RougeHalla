using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// The legacy-sized HUD space. Its RectTransform is exactly <see cref="HudViewport.UiWidth"/> by UiHeight units, centred on the
    /// screen, and scaled so that one unit is <c>legacy scale x 1 CSS px</c> on screen (that many device pixels at any
    /// devicePixelRatio): elements placed inside it use the numbers in docs/rework/LEGACY_LAYOUT.md literally, and the stage
    /// covers the window edge to edge (or a centred 21:9 strip on a wider one). The rest of the canvas (menus, hub, modals)
    /// keeps its own CanvasScaler; this stage divides that scale out again so the two never compound.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HudStage : MonoBehaviour
    {
        Canvas _canvas;
        CanvasScaler _scaler;
        int _w = -1, _h = -1;
        float _factor = -1f, _cssW = -1f, _cssH = -1f, _ratio = -1f;

        public HudViewport Viewport { get; private set; }
        /// <summary>Screen (device) pixels per HUD unit as last applied: legacy scale times the pixel ratio.</summary>
        public float PixelsPerUnit { get; private set; }
        /// <summary>Raised after the stage is re-laid-out for a new window size or canvas scale.</summary>
        public event System.Action<HudViewport> ViewportChanged;

        /// <summary>Lays the stage out for a window of the given CSS size, device pixels per CSS px, and parent canvas scale factor.</summary>
        public void Apply(float cssWidth, float cssHeight, float pixelRatio, float canvasScaleFactor)
        {
            var rect = (RectTransform)transform;
            Viewport = HudLayout.Viewport(cssWidth, cssHeight);
            float ratio = Mathf.Max(.0001f, pixelRatio), factor = Mathf.Max(.0001f, canvasScaleFactor);
            PixelsPerUnit = Viewport.Scale * ratio;
            rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(.5f, .5f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = new Vector2(Viewport.UiWidth, Viewport.UiHeight);
            float k = PixelsPerUnit / factor;
            rect.localScale = new Vector3(k, k, 1f);
            ViewportChanged?.Invoke(Viewport);
        }

        /// <summary>Same with one device pixel per CSS px (editor, standalone, tests).</summary>
        public void Apply(float windowWidth, float windowHeight, float canvasScaleFactor)
        {
            Apply(windowWidth, windowHeight, 1f, canvasScaleFactor);
        }

        void OnEnable() { Relayout(); }

        void LateUpdate() { Refresh(false); }

        /// <summary>Re-solves the stage now from the live window and canvas (call after parenting).</summary>
        public void Relayout() { Refresh(true); }

        /// <summary>
        /// The scale the parent canvas applies. A ScaleWithScreenSize scaler's factor is computed here from the same formula rather than
        /// read back from Canvas.scaleFactor, which still holds its default of 1 until the scaler's first Update and so
        /// made the first layout wrong (and cached as current).
        /// </summary>
        float CanvasFactor()
        {
            if (_canvas == null) _canvas = GetComponentInParent<Canvas>();
            if (_canvas == null) return HudLayout.CanvasScalerFactor(Screen.width, Screen.height);
            var root = _canvas.rootCanvas;
            if (_scaler == null || _scaler.GetComponent<Canvas>() != root) _scaler = root.GetComponent<CanvasScaler>();
            if (_scaler != null && _scaler.uiScaleMode == CanvasScaler.ScaleMode.ScaleWithScreenSize)
                return HudLayout.CanvasScalerFactor(Screen.width, Screen.height, _scaler.referenceResolution.x, _scaler.referenceResolution.y, _scaler.matchWidthOrHeight);
            return root.scaleFactor;
        }

        void Refresh(bool force)
        {
            float cssW, cssH, ratio;
            UiDisplayMetrics.Read(out cssW, out cssH, out ratio);
            float factor = CanvasFactor();
            if (!force && Screen.width == _w && Screen.height == _h && Mathf.Approximately(cssW, _cssW) && Mathf.Approximately(cssH, _cssH)
                && Mathf.Approximately(ratio, _ratio) && Mathf.Approximately(factor, _factor)) return;
            // Every input of the last layout is recorded here, from the same reads the layout used.
            _w = Screen.width; _h = Screen.height; _cssW = cssW; _cssH = cssH; _ratio = ratio; _factor = factor;
            Apply(cssW, cssH, ratio, factor);
        }
    }
}

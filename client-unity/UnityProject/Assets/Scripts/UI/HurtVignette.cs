// The local hurt vignette (legacy screenFeedback.ts): a red vignette over the canvas, behind the HUD, when the local player takes a real hit
// (damage over time never flashes). Strength = Indicators.HurtFlash(amount, maxHp), decaying linearly over 350 ms; overlapping hits keep the
// stronger. The gradient is clear in the middle and deepens toward the edge (legacy radial-gradient stops 42% / 78% / 100%), in the theme's
// danger colour. Under reduced motion the flash is half as strong. Presentation only: it shows a delivered Hit fx and decides nothing.
using UnityEngine;
using UnityEngine.UI;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class HurtVignette
    {
        readonly GameObject _go;
        readonly RawImage _image;
        WorldIndicatorRules.Pulse _pulse;
        Texture2D _texture;
        public float Strength { get; private set; }

        public HurtVignette()
        {
            _go = new GameObject("Hurt vignette", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler));
            var canvas = _go.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = -10;
            var imgGo = new GameObject("Vignette", typeof(RectTransform), typeof(RawImage)); imgGo.transform.SetParent(_go.transform, false);
            var rt = (RectTransform)imgGo.transform; rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.offsetMin = rt.offsetMax = Vector2.zero;
            _image = imgGo.GetComponent<RawImage>(); _image.raycastTarget = false; _image.texture = Build(); _image.color = new Color(1, 1, 1, 0); _image.enabled = false;
            if (Application.isPlaying) Object.DontDestroyOnLoad(_go);
        }

        /// <summary>A real hit on the local player (not damage over time).</summary>
        public void Hit(float amount, float maxHp, float now)
        {
            float s = Indicators.HurtFlash(amount, maxHp);
            if (s > 0f) _pulse.Hit(s, now * 1000f);
        }

        public void Tick(float now, bool reduced)
        {
            Strength = _pulse.Value(now * 1000f) * (reduced ? .5f : 1f);
            bool on = Strength > .004f;
            _image.enabled = on;
            if (on) _image.color = new Color(1, 1, 1, Strength);
        }

        public void Clear() { _pulse = default; Strength = 0f; _image.enabled = false; }

        public void Dispose()
        {
            if (_go != null) { if (Application.isPlaying) Object.Destroy(_go); else Object.DestroyImmediate(_go); }
            if (_texture != null) { if (Application.isPlaying) Object.Destroy(_texture); else Object.DestroyImmediate(_texture); }
        }

        Texture Build()
        {
            const int n = 128;
            _texture = new Texture2D(n, n, TextureFormat.RGBA32, false) { name = "Hurt vignette", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var danger = UiTheme.Current.Danger; var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float u = ((x + .5f) / n - .5f) * 2f, v = ((y + .5f) / n - .5f) * 2f;
                float r = Mathf.Sqrt(u * u + v * v) / 1.4142f;           // 1 at the corner (farthest-corner ellipse)
                float a = r < .42f ? 0f : r < .78f ? Mathf.Lerp(0f, .55f, (r - .42f) / .36f) : Mathf.Lerp(.55f, .9f, Mathf.Clamp01((r - .78f) / .22f));
                px[y * n + x] = new Color32(danger.r, danger.g, danger.b, (byte)Mathf.RoundToInt(a * 255f));
            }
            _texture.SetPixels32(px); _texture.Apply(false, false);
            return _texture;
        }
    }
}

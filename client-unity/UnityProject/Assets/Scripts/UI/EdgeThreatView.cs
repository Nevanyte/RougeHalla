using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>Where a threat glow sits on the HUD rectangle and how close the enemy is (0 = near/red, 1 = far/green).</summary>
    public readonly struct EdgeThreat
    {
        public readonly float X, Y, Distance, Far;
        public EdgeThreat(float x, float y, float distance, float far) { X = x; Y = y; Distance = distance; Far = far; }

        /// <summary>0 at <paramref name="near"/> or closer, 1 at the vision radius or farther (legacy hue 0..120).</summary>
        public float Remoteness(float near) { return Mathf.Clamp01((Distance - near) / Mathf.Max(1f, Far - near)); }

        /// <summary>
        /// Mirrors ui/edgeThreat.ts. <paramref name="dx"/>/<paramref name="dy"/> are the screen-space bearing (right, up) already
        /// squashed by the projection; <paramref name="groundDistance"/> is the unsquashed ground distance used for colour.
        /// Positions are in HUD units with the origin at the stage's bottom-left corner.
        /// </summary>
        public static EdgeThreat Compute(float dx, float dy, float groundDistance, float width, float height, float far)
        {
            if (Mathf.Approximately(dx, 0f) && Mathf.Approximately(dy, 0f)) return new EdgeThreat(width / 2f, 0f, 0f, far);
            float kx = Mathf.Approximately(dx, 0f) ? float.PositiveInfinity : width / 2f / Mathf.Abs(dx);
            float ky = Mathf.Approximately(dy, 0f) ? float.PositiveInfinity : height / 2f / Mathf.Abs(dy);
            float k = Mathf.Min(kx, ky);
            return new EdgeThreat(width / 2f + dx * k, height / 2f + dy * k, groundDistance, far);
        }
    }

    /// <summary>
    /// Broad, diffuse glows hugging the screen edge toward visible enemies (legacy ui/vision.css, z 1, never takes input).
    /// The view and its maths are complete; <see cref="MatchHud"/> does not feed it yet, because the vision radius and the
    /// ground-to-screen squash it needs are not delivered to the client (see MatchHud.UpdateEdgeThreatsStub).
    /// </summary>
    public sealed class EdgeThreatView
    {
        public const float GlowSize = 180f, Margin = 28f, NearDistance = 150f;
        static Sprite _glow;
        readonly RectTransform _root;
        readonly List<Image> _pool = new List<Image>();

        public RectTransform Root { get { return _root; } }

        public EdgeThreatView(Transform parent)
        {
            var go = new GameObject("EdgeThreats", typeof(RectTransform));
            go.transform.SetParent(parent, false);
            _root = (RectTransform)go.transform;
            _root.anchorMin = Vector2.zero; _root.anchorMax = Vector2.one; _root.offsetMin = _root.offsetMax = Vector2.zero;
            go.AddComponent<RectMask2D>();
        }

        public int ActiveCount { get { int n = 0; foreach (var g in _pool) if (g.gameObject.activeSelf) n++; return n; } }

        public void Show(IList<EdgeThreat> threats)
        {
            var theme = UiTheme.Current;
            int n = 0;
            if (threats != null)
                for (; n < threats.Count; n++)
                {
                    while (_pool.Count <= n) _pool.Add(NewGlow(_pool.Count));
                    var glow = _pool[n]; var t = threats[n];
                    glow.gameObject.SetActive(true);
                    var rect = glow.rectTransform;
                    rect.anchorMin = rect.anchorMax = Vector2.zero; rect.anchoredPosition = new Vector2(t.X + Margin / 2f, t.Y + Margin / 2f);
                    float r = t.Remoteness(NearDistance);
                    Color c = r < .5f ? Color.Lerp(theme.Danger, theme.Warning, r * 2f) : Color.Lerp(theme.Warning, theme.Success, (r - .5f) * 2f);
                    c.a = .55f; glow.color = c;
                }
            for (; n < _pool.Count; n++) _pool[n].gameObject.SetActive(false);
        }

        Image NewGlow(int index)
        {
            var go = new GameObject("Glow" + index, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(_root, false);
            var image = go.GetComponent<Image>();
            image.sprite = GlowSprite(); image.raycastTarget = false;
            ((RectTransform)go.transform).sizeDelta = new Vector2(GlowSize, GlowSize);
            return image;
        }

        /// <summary>Legacy vision.css: radial-gradient(closest-side, colour 0%, transparent 100%): a LINEAR falloff from the centre (the lab found the squared one far too small).</summary>
        public static float GlowAlpha(float d) { return Mathf.Clamp01(1f - d); }

        static Sprite GlowSprite()
        {
            if (_glow != null) return _glow;
            const int size = 64;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear, hideFlags = HideFlags.HideAndDontSave };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float d = Mathf.Sqrt((x + .5f - size / 2f) * (x + .5f - size / 2f) + (y + .5f - size / 2f) * (y + .5f - size / 2f)) / (size / 2f);
                    float a = GlowAlpha(d);
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(a * 255f));
                }
            texture.SetPixels32(pixels); texture.Apply(false, true);
            _glow = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(.5f, .5f), 1f);
            _glow.hideFlags = HideFlags.HideAndDontSave;
            return _glow;
        }
    }
}

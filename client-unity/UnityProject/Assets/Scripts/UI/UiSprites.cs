using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Generated white, 9-sliced panel and frame sprites for the theme's corner radius and border width. They carry no colour of
    /// their own (the Image tint supplies it), so a theme change never needs new art. A theme can supply its own sprites instead.
    /// </summary>
    public static class UiSprites
    {
        static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();

        /// <summary>A filled rounded rectangle at the theme corner radius (or the theme's own panel sprite).</summary>
        public static Sprite Panel(UiTheme theme) { return Panel(theme, theme.CornerRadius); }

        public static Sprite Panel(UiTheme theme, float radius)
        {
            if (theme.PanelSprite != null) return theme.PanelSprite;
            return Build("panel", radius, 0f);
        }

        /// <summary>A rounded one-border-wide ring, tinted with the border colour and laid over a panel.</summary>
        public static Sprite Frame(UiTheme theme, float radius)
        {
            if (theme.FrameSprite != null) return theme.FrameSprite;
            return Build("frame", radius, Mathf.Max(1f, theme.BorderWidth));
        }

        static Sprite Build(string kind, float radius, float ring)
        {
            radius = Mathf.Max(1f, Mathf.Round(radius));
            string key = kind + radius + "/" + ring;
            Sprite cached;
            if (Cache.TryGetValue(key, out cached) && cached != null) return cached;
            int size = Mathf.CeilToInt(radius * 2f) + 2;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                name = "UiTheme " + key, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave
            };
            var pixels = new Color32[size * size];
            float half = size / 2f;
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                // Signed distance to a rounded square inscribed in the texture.
                float px = Mathf.Abs(x + .5f - half) - (half - radius), py = Mathf.Abs(y + .5f - half) - (half - radius);
                float outside = Mathf.Sqrt(Mathf.Max(px, 0) * Mathf.Max(px, 0) + Mathf.Max(py, 0) * Mathf.Max(py, 0));
                float d = outside + Mathf.Min(Mathf.Max(px, py), 0) - radius;
                float coverage = Mathf.Clamp01(.5f - d);
                if (ring > 0f) coverage *= Mathf.Clamp01(d + ring + .5f);
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(coverage * 255f));
            }
            texture.SetPixels32(pixels); texture.Apply(false, true);
            float border = Mathf.Ceil(radius) + 1f;
            var sprite = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(.5f, .5f), 1f, 0, SpriteMeshType.FullRect,
                new Vector4(border, border, border, border));
            sprite.name = "UiTheme " + key; sprite.hideFlags = HideFlags.HideAndDontSave;
            Cache[key] = sprite;
            return sprite;
        }
    }
}

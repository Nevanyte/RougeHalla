using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Generated white, 9-sliced panel, frame and highlight sprites for the theme's corner radius and border width. They carry no
    /// colour of their own (the Image tint supplies it), so a theme change never needs new art. A theme can supply its own sprites instead.
    ///
    /// Sharpness: each HUD unit is <see cref="TexelsPerUnit"/> texels wide and the texture is mip-mapped, so edges stay crisp at any
    /// legacy scale and devicePixelRatio. The sprite's pixelsPerUnit is <c>100 x TexelsPerUnit</c>: a UI Image divides a sliced sprite's
    /// border by (sprite pixels per unit / canvas reference pixels per unit, default 100), so this makes one HUD unit exactly
    /// <c>TexelsPerUnit</c> texels. (The earlier sprites had pixelsPerUnit 1, which made that divisor 0.01: borders came out 100x too
    /// large, the 9-slice collapsed into one stretched 3x3 and every panel rendered as a soft blob.)
    /// </summary>
    public static class UiSprites
    {
        public const int TexelsPerUnit = 4;
        const float CanvasReferencePixelsPerUnit = 100f;

        static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();
        static Sprite _flat;

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

        /// <summary>A one-unit inner highlight line hugging the top edge and corners, fading out down the sides; tint it white at low alpha.</summary>
        public static Sprite Gloss(UiTheme theme, float radius) { return Build("gloss", radius, 1f); }

        /// <summary>A plain white sprite for flat fills (meters, rules, radial sweeps) that must not carry rounded corners.</summary>
        public static Sprite Flat()
        {
            if (_flat != null) return _flat;
            var texture = new Texture2D(4, 4, TextureFormat.RGBA32, false) { name = "UiTheme flat", filterMode = FilterMode.Point, hideFlags = HideFlags.HideAndDontSave };
            var pixels = new Color32[16];
            for (int i = 0; i < pixels.Length; i++) pixels[i] = new Color32(255, 255, 255, 255);
            texture.SetPixels32(pixels); texture.Apply(false, true);
            _flat = Sprite.Create(texture, new Rect(0, 0, 4, 4), new Vector2(.5f, .5f), CanvasReferencePixelsPerUnit, 0, SpriteMeshType.FullRect);
            _flat.name = "UiTheme flat"; _flat.hideFlags = HideFlags.HideAndDontSave;
            return _flat;
        }

        /// <summary>The 9-slice border of a generated sprite, in HUD units (what the Image will draw).</summary>
        public static float BorderUnits(Sprite sprite) { return sprite.border.x / TexelsPerUnit; }

        static Sprite Build(string kind, float radius, float ring)
        {
            radius = Mathf.Max(1f, Mathf.Round(radius));
            string key = kind + radius + "/" + ring;
            Sprite cached;
            if (Cache.TryGetValue(key, out cached) && cached != null) return cached;
            int s = TexelsPerUnit;
            float radiusT = radius * s;
            int border = Mathf.CeilToInt(radiusT);
            int size = border * 2 + s * 2;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, true)
            {
                name = "UiTheme " + key, filterMode = FilterMode.Trilinear, wrapMode = TextureWrapMode.Clamp, anisoLevel = 0, hideFlags = HideFlags.HideAndDontSave
            };
            var pixels = new Color32[size * size];
            float half = size / 2f, ringT = ring * s, inset = s;
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                // Signed distance to a rounded square inscribed in the texture (negative inside), in texels.
                float px = Mathf.Abs(x + .5f - half) - (half - radiusT), py = Mathf.Abs(y + .5f - half) - (half - radiusT);
                float outside = Mathf.Sqrt(Mathf.Max(px, 0) * Mathf.Max(px, 0) + Mathf.Max(py, 0) * Mathf.Max(py, 0));
                float d = outside + Mathf.Min(Mathf.Max(px, py), 0) - radiusT;
                float coverage = Mathf.Clamp01(.5f - d);
                if (kind == "frame") coverage *= Mathf.Clamp01(d + ringT + .5f);
                else if (kind == "gloss")
                {
                    // A line one unit inside the edge, strongest at the top and gone by the vertical middle (the stretched slice).
                    float band = Mathf.Clamp01(-d - inset + .5f) * Mathf.Clamp01(inset + ringT + d + .5f);
                    float topness = Mathf.Clamp01(((y + .5f) / size - .5f) * 2f);
                    coverage = band * topness * topness;
                }
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(coverage * 255f));
            }
            texture.SetPixels32(pixels); texture.Apply(true, true);
            var sprite = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(.5f, .5f), CanvasReferencePixelsPerUnit * s, 0, SpriteMeshType.FullRect,
                new Vector4(border, border, border, border));
            sprite.name = "UiTheme " + key; sprite.hideFlags = HideFlags.HideAndDontSave;
            Cache[key] = sprite;
            return sprite;
        }
    }
}

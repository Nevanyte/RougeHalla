// Crisp generated ground marks with a guaranteed edge: a coloured band flanked by a thin dark hairline and, outside it, a thin light
// hairline, so the extent of a translucent mark reads on every zone's ground (the dark carries pale ground, the light carries dark
// ground) without the mark getting brighter. One texture per colour, generated once and cached; used for the lock, hover, hunt, root
// and zoned rings and the reward-chest range. Also the generated Plague corpse puddle. No imported art.
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    public static class GroundMarkArt
    {
        const int Size = 128;
        const float Centre = .80f, Band = .028f, Dark = .016f, Light = .012f, Aa = .012f;
        static readonly Dictionary<int, Sprite> Rings = new Dictionary<int, Sprite>();
        static Sprite _puddle;

        /// <summary>A ring of the given colour (RGB; alpha comes from the renderer) spanning the whole 1 x 1 sprite. <paramref name="fill"/> adds a soft interior wash.</summary>
        public static Sprite Ring(Color32 core, bool fill = false, float band = Band)
        {
            int key = (core.r << 16 | core.g << 8 | core.b) ^ (fill ? 0x1000000 : 0) ^ ((int)(band * 1000f) << 25);
            if (Rings.TryGetValue(key, out var s) && s != null) return s;
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, false) { name = "Ground mark ring", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[Size * Size];
            var theme = UiTheme.Current;
            Color dark = (Color)theme.OutlineDark, light = (Color)theme.OutlineLight, c = (Color)core;
            for (int y = 0; y < Size; y++)
            for (int x = 0; x < Size; x++)
            {
                float nx = ((x + .5f) / Size - .5f) * 2f, ny = ((y + .5f) / Size - .5f) * 2f;
                float r = Mathf.Sqrt(nx * nx + ny * ny), d = Mathf.Abs(r - Centre);
                float core01 = Cov(band - d), dark01 = Cov(band + Dark - d), light01 = Cov(band + Dark + Light - d);
                // back to front: light hairline, dark hairline, band, interior wash
                var o = new Color(0, 0, 0, 0);
                o = Over(o, light, light01 * .7f);
                o = Over(o, dark, dark01 * .9f);
                o = Over(o, c, core01);
                if (fill && r < Centre - band - Dark) o = Over(o, c, .22f * Mathf.Clamp01((Centre - band - Dark - r) / Aa + .5f));
                px[y * Size + x] = o;
            }
            tex.SetPixels32(px); tex.Apply(false, false);
            s = Sprite.Create(tex, new Rect(0, 0, Size, Size), new Vector2(.5f, .5f), Size); s.name = "Ground mark ring";
            Rings[key] = s; return s;
        }

        static float Cov(float d) { return Mathf.Clamp01(d / Aa + .5f); }
        // straight-alpha "over"
        static Color Over(Color under, Color over, float a)
        {
            float oa = a + under.a * (1f - a);
            if (oa <= 1e-5f) return new Color(0, 0, 0, 0);
            var rgb = (new Vector3(over.r, over.g, over.b) * a + new Vector3(under.r, under.g, under.b) * under.a * (1f - a)) / oa;
            return new Color(rgb.x, rgb.y, rgb.z, oa);
        }

        /// <summary>Legacy PlagueCorpseView.paint: a shallow diseased puddle with exposed pale bones, ringed by a dark rim and a light hairline.</summary>
        public static Sprite Puddle()
        {
            if (_puddle != null) return _puddle;
            const int w = 128, h = 64;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false) { name = "Plague corpse puddle", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[w * h];
            var theme = UiTheme.Current;
            Color rim = new Color32(0x15, 0x38, 0x1c, 255), mid = new Color32(0x2e, 0x8c, 0x3d, 255), top = new Color32(0x62, 0xbc, 0x4a, 255), bone = new Color32(0xda, 0xf2, 0xb5, 255);
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                float u = ((x + .5f) / w - .5f) * 2f, v = ((y + .5f) / h - .5f) * 2f;     // -1..1, v up
                float e = Mathf.Sqrt(u * u + v * v);
                var o = new Color(0, 0, 0, 0);
                o = Over(o, (Color)theme.OutlineLight, Cov((.97f - e) * 20f) * .55f);
                o = Over(o, (Color)theme.OutlineDark, Cov((.93f - e) * 20f) * .95f);
                o = Over(o, rim, Cov((.88f - e) * 20f));
                o = Over(o, mid, Cov((.76f - e * 1.08f) * 20f));
                float e2 = Mathf.Sqrt((u + .05f) * (u + .05f) / .55f + (v - .06f) * (v - .06f) / .5f);
                o = Over(o, top, Cov((.62f - e2 * .8f) * 20f) * .9f);
                // two crossed bones and two knuckles (legacy lineBetween pairs + circles)
                float b1 = SegDist(u, v, -.26f, .06f, .26f, -.12f), b2 = SegDist(u, v, -.22f, -.12f, .22f, .1f);
                o = Over(o, bone, Cov((.07f - Mathf.Min(b1, b2)) * 20f) * .95f);
                o = Over(o, bone, Cov((.09f - Mathf.Min(Mathf.Sqrt((u + .27f) * (u + .27f) + (v - .12f) * (v - .12f) * 4f), Mathf.Sqrt((u - .27f) * (u - .27f) + (v + .12f) * (v + .12f) * 4f))) * 20f));
                px[y * w + x] = o;
            }
            tex.SetPixels32(px); tex.Apply(false, false);
            _puddle = Sprite.Create(tex, new Rect(0, 0, w, h), new Vector2(.5f, .5f), 128f); _puddle.name = "Plague corpse puddle";
            return _puddle;
        }

        static float SegDist(float px, float py, float ax, float ay, float bx, float by)
        {
            float dx = bx - ax, dy = by - ay, t = Mathf.Clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
            float qx = ax + dx * t - px, qy = ay + dy * t - py; return Mathf.Sqrt(qx * qx + qy * qy);
        }
    }
}

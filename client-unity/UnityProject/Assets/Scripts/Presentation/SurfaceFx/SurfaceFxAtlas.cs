using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Procedural 4x4 atlas for the surface effects (original art, generated in code): R = depth/height for the emboss lighting, A = shape mask.
    /// Cell v axis is "forward" for feet and trails. No third-party pixels.
    /// </summary>
    public static class SurfaceFxAtlas
    {
        public const int Cell = 64, Grid = 4, Size = Cell * Grid;
        public const int Foot = 0, RingThin = 1, RingThick = 2, Splash = 3, Streak = 4, Smudge = 5, Glow = 6, Bubble = 7, Trough = 8, Scuff = 9, GrassTrail = 10;

        static Texture2D _tex;
        public static Texture2D Texture { get { return _tex != null ? _tex : (_tex = Build()); } }

        /// <summary>Atlas rectangle of a cell (u min, v min, u max, v max), inset half a texel so bilinear filtering never bleeds.</summary>
        public static Vector4 Rect(int cell)
        {
            float cx = cell % Grid, cy = cell / Grid, e = 0.5f / Size, s = 1f / Grid;
            return new Vector4(cx * s + e, cy * s + e, (cx + 1) * s - e, (cy + 1) * s - e);
        }

        static float Smooth(float a, float b, float x) { float t = Mathf.Clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
        static float Hash(int x, int y) { unchecked { uint h = (uint)(x * 374761393 + y * 668265263); h = (h ^ (h >> 13)) * 1274126177u; return ((h ^ (h >> 16)) & 0xFFFF) / 65535f; } }
        static float Noise(float x, float y)
        {
            int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y); float fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
            return Mathf.Lerp(Mathf.Lerp(Hash(xi, yi), Hash(xi + 1, yi), fx), Mathf.Lerp(Hash(xi, yi + 1), Hash(xi + 1, yi + 1), fx), fy);
        }
        static float Ell(float u, float v, float cu, float cv, float ru, float rv) { float a = (u - cu) / ru, b = (v - cv) / rv; return Mathf.Sqrt(a * a + b * b); }

        /// <summary>Height and mask of one cell at (u, v) in 0..1. Pure.</summary>
        public static void Sample(int cell, float u, float v, out float h, out float a)
        {
            h = 0; a = 0;
            float r = Mathf.Sqrt((u - .5f) * (u - .5f) + (v - .5f) * (v - .5f)) * 2f;
            switch (cell)
            {
                case Foot:
                {
                    float sole = 1f - Ell(u, v, .5f, .37f, .33f, .31f), toe = 1f - Ell(u, v, .5f + .03f * (v - .7f), .76f, .27f, .17f);
                    float heel = 1f - Ell(u, v, .5f, .1f, .2f, .1f);
                    float f = Mathf.Max(sole, Mathf.Max(toe, heel * .9f));
                    h = Smooth(0f, .5f, f); a = Smooth(0f, .16f, f); break;
                }
                case RingThin: a = Mathf.Exp(-Mathf.Pow((r - .8f) / .075f, 2)) * Smooth(1.05f, .9f, r); h = a; break;
                case RingThick: a = Mathf.Max(Mathf.Exp(-Mathf.Pow((r - .66f) / .17f, 2)), .4f * Smooth(.9f, .1f, r)) * Smooth(1.02f, .88f, r); h = a; break;
                case Splash:
                {
                    float m = 0; float[] px = { .3f, .62f, .5f, .74f, .26f }, py = { .6f, .66f, .3f, .36f, .3f }, pr = { .08f, .065f, .09f, .055f, .05f };
                    for (int i = 0; i < 5; i++) m = Mathf.Max(m, 1f - Smooth(pr[i] * .6f, pr[i], Mathf.Sqrt((u - px[i]) * (u - px[i]) + (v - py[i]) * (v - py[i]))));
                    a = m; h = m; break;
                }
                case Streak:
                {
                    float w = .035f + .13f * v; a = Mathf.Exp(-Mathf.Pow((u - .5f) / w, 2)) * Smooth(0f, .08f, v) * (1f - Smooth(.5f, 1f, v)) * .9f; h = a; break;
                }
                case Smudge: a = Smooth(1f, .25f, r) * (.65f + .35f * Noise(u * 7f, v * 7f)); h = a * .6f; break;
                case Glow: { float g = Mathf.Clamp01(1f - r); a = g * g; h = 0; break; }
                case Bubble:
                {
                    float ring = Mathf.Exp(-Mathf.Pow((r - .78f) / .09f, 2)), spec = 1f - Smooth(.04f, .13f, Mathf.Sqrt((u - .36f) * (u - .36f) + (v - .66f) * (v - .66f)));
                    a = Mathf.Clamp01(ring * .8f + spec) * Smooth(1.02f, .92f, r) + .12f * Smooth(.8f, .2f, r); h = a; break;
                }
                case Trough: { float e = Ell(u, v, .5f, .5f, .24f, .48f); a = Smooth(1f, .15f, e); h = a; break; }
                case Scuff:
                {
                    float m = 0;
                    for (int i = 0; i < 4; i++) { float cu = .3f + .13f * i, cv = .35f + .1f * ((i * 5) % 3); m = Mathf.Max(m, 1f - Ell(u, v, cu, cv, .035f, .2f)); }
                    float spk = Hash((int)(u * 40), (int)(v * 40)) > .86f ? .8f : 0f; float d = 1f - Smooth(.35f, .5f, r);
                    a = Mathf.Clamp01(m * .9f + spk * d); h = a * .5f; break;
                }
                case GrassTrail:
                {
                    float e = Ell(u, v, .5f, .5f, .3f, .48f); a = Smooth(1f, .1f, e) * (.55f + .45f * Mathf.Abs(Mathf.Sin(u * 38f + Noise(u * 5f, v * 5f) * 3f))); h = a * .4f; break;
                }
            }
            if (u < .02f || u > .98f || v < .02f || v > .98f) { a = 0; h = 0; }
        }

        static Texture2D Build()
        {
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, false, true) { name = "SurfaceFx atlas", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[Size * Size];
            for (int cell = 0; cell < Grid * Grid; cell++)
            {
                int ox = (cell % Grid) * Cell, oy = (cell / Grid) * Cell;
                for (int y = 0; y < Cell; y++)
                    for (int x = 0; x < Cell; x++)
                    {
                        Sample(cell, (x + .5f) / Cell, (y + .5f) / Cell, out float h, out float a);
                        byte hb = (byte)Mathf.RoundToInt(Mathf.Clamp01(h) * 255f);
                        px[(oy + y) * Size + ox + x] = new Color32(hb, hb, hb, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f));
                    }
            }
            tex.SetPixels32(px); tex.Apply(false, true);
            return tex;
        }
    }
}

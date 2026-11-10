using System;
using UnityEngine;

namespace Roguehalla.Client
{
    public enum LaunchIcon { Shop, Wardrobe, Titles, Achievements, Leaderboard, Counters, Arena, Training, Profile, Guide, Resume, Key, Play, Check }

    /// <summary>
    /// The launch screen's pictograms: one mip-mapped atlas of white, analytically anti-aliased shapes evaluated per texel from signed
    /// distance functions (the same construction as <see cref="MapGlyphs"/>), tinted by the Image colour so they carry no colour of their
    /// own and stay crisp at any legacy scale and devicePixelRatio. Shapes live in a [-1, 1] square (x right, y up).
    /// </summary>
    public static class LaunchIcons
    {
        public const int Cell = 64, Grid = 4, AtlasSize = Cell * Grid;
        static Texture2D _atlas;
        static readonly Sprite[] Sprites = new Sprite[Enum.GetValues(typeof(LaunchIcon)).Length];

        public static Sprite Sprite(LaunchIcon icon)
        {
            Ensure();
            int i = (int)icon;
            if (Sprites[i] != null) return Sprites[i];
            int cx = i % Grid, cy = i / Grid;
            var sprite = UnityEngine.Sprite.Create(_atlas, new Rect(cx * Cell, cy * Cell, Cell, Cell), new Vector2(.5f, .5f), Cell, 0, SpriteMeshType.FullRect);
            sprite.name = "Launch icon " + icon; sprite.hideFlags = HideFlags.HideAndDontSave;
            Sprites[i] = sprite;
            return sprite;
        }

        static void Ensure()
        {
            if (_atlas != null) return;
            var texture = new Texture2D(AtlasSize, AtlasSize, TextureFormat.RGBA32, true, false)
            {
                name = "Launch icon atlas (generated)", filterMode = FilterMode.Trilinear, wrapMode = TextureWrapMode.Clamp, anisoLevel = 0, hideFlags = HideFlags.HideAndDontSave
            };
            var pixels = new Color32[AtlasSize * AtlasSize];
            float texel = 2f / Cell; // one texel in the [-1, 1] icon space
            foreach (LaunchIcon icon in Enum.GetValues(typeof(LaunchIcon)))
            {
                int i = (int)icon, ox = (i % Grid) * Cell, oy = (i / Grid) * Cell;
                for (int y = 0; y < Cell; y++)
                    for (int x = 0; x < Cell; x++)
                    {
                        float ux = ((x + .5f) / Cell) * 2f - 1f, uy = ((y + .5f) / Cell) * 2f - 1f;
                        float coverage = Mathf.Clamp01(.5f - Distance(icon, ux, uy) / texel);
                        pixels[(oy + y) * AtlasSize + ox + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(coverage * 255f));
                    }
            }
            texture.SetPixels32(pixels); texture.Apply(true, false);
            _atlas = texture;
        }

        // ---- signed-distance primitives (negative inside)
        static float Circle(float x, float y, float cx, float cy, float r) { return Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - r; }
        static float Ring(float x, float y, float cx, float cy, float r, float half) { return Mathf.Abs(Circle(x, y, cx, cy, r)) - half; }
        static float Box(float x, float y, float cx, float cy, float hx, float hy)
        {
            float dx = Mathf.Abs(x - cx) - hx, dy = Mathf.Abs(y - cy) - hy;
            return Mathf.Sqrt(Mathf.Max(dx, 0f) * Mathf.Max(dx, 0f) + Mathf.Max(dy, 0f) * Mathf.Max(dy, 0f)) + Mathf.Min(Mathf.Max(dx, dy), 0f);
        }
        static float Seg(float x, float y, float ax, float ay, float bx, float by, float r)
        {
            float px = x - ax, py = y - ay, ex = bx - ax, ey = by - ay;
            float t = Mathf.Clamp01((px * ex + py * ey) / (ex * ex + ey * ey));
            float dx = px - ex * t, dy = py - ey * t;
            return Mathf.Sqrt(dx * dx + dy * dy) - r;
        }
        static float Poly(float x, float y, params float[] v)
        {
            int n = v.Length / 2;
            float d = (x - v[0]) * (x - v[0]) + (y - v[1]) * (y - v[1]), s = 1f;
            for (int i = 0, j = n - 1; i < n; j = i, i++)
            {
                float ix = v[i * 2], iy = v[i * 2 + 1], jx = v[j * 2], jy = v[j * 2 + 1];
                float ex = jx - ix, ey = jy - iy, wx = x - ix, wy = y - iy;
                float t = Mathf.Clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
                float bx = wx - ex * t, by = wy - ey * t;
                d = Mathf.Min(d, bx * bx + by * by);
                bool c1 = y >= iy, c2 = y < jy, c3 = ex * wy > ey * wx;
                if (c1 && c2 && c3 || !c1 && !c2 && !c3) s = -s;
            }
            return s * Mathf.Sqrt(d);
        }
        static float Sub(float a, float b) { return Mathf.Max(a, -b); }

        static float Distance(LaunchIcon icon, float x, float y)
        {
            switch (icon)
            {
                case LaunchIcon.Shop:
                    // A coin purse: round body, gathered neck, and an engraved coin ring.
                    return Sub(Mathf.Min(Circle(x, y, 0, -.14f, .56f), Box(x, y, 0, .5f, .26f, .16f)), Ring(x, y, 0, -.14f, .3f, .05f));
                case LaunchIcon.Wardrobe:
                    return Sub(Poly(x, y, -.26f, .62f, -.66f, .4f, -.8f, -.04f, -.52f, -.14f, -.42f, .04f, -.42f, -.72f, .42f, -.72f, .42f, .04f, .52f, -.14f, .8f, -.04f, .66f, .4f, .26f, .62f),
                        Circle(x, y, 0, .66f, .24f));
                case LaunchIcon.Titles:
                    // A hanging pennant with a diamond cut-out.
                    return Sub(Poly(x, y, -.48f, .74f, .48f, .74f, .48f, -.74f, 0, -.32f, -.48f, -.74f), Poly(x, y, 0, .42f, .18f, .2f, 0, -.02f, -.18f, .2f));
                case LaunchIcon.Achievements:
                    return Mathf.Min(Mathf.Min(Poly(x, y, -.5f, .68f, .5f, .68f, .42f, .04f, .14f, -.2f, -.14f, -.2f, -.42f, .04f),
                        Box(x, y, 0, -.4f, .1f, .2f)), Mathf.Min(Box(x, y, 0, -.68f, .36f, .1f),
                        Mathf.Min(Ring(x, y, -.58f, .36f, .2f, .06f), Ring(x, y, .58f, .36f, .2f, .06f))));
                case LaunchIcon.Leaderboard:
                    return Mathf.Min(Box(x, y, 0, .06f, .21f, .56f), Mathf.Min(Box(x, y, -.46f, -.14f, .21f, .36f), Box(x, y, .46f, -.24f, .21f, .26f)));
                case LaunchIcon.Counters:
                {
                    // Five nodes on a ring: the weapon counter wheel.
                    float d = Ring(x, y, 0, 0, .6f, .055f);
                    for (int k = 0; k < 5; k++)
                    {
                        float a = (90f + k * 72f) * Mathf.Deg2Rad;
                        d = Mathf.Min(d, Circle(x, y, Mathf.Cos(a) * .6f, Mathf.Sin(a) * .6f, .2f));
                    }
                    return d;
                }
                case LaunchIcon.Arena:
                    return Poly(x, y, -.78f, -.62f, .78f, -.62f, .78f, .58f, .42f, .58f, .42f, .32f, .06f, .32f, .06f, .06f, -.3f, .06f, -.3f, -.2f, -.78f, -.2f);
                case LaunchIcon.Training:
                    return Mathf.Min(Mathf.Min(Ring(x, y, 0, 0, .64f, .09f), Ring(x, y, 0, 0, .34f, .08f)), Circle(x, y, 0, 0, .1f));
                case LaunchIcon.Profile:
                    return Mathf.Min(Circle(x, y, 0, .34f, .28f), Mathf.Max(Circle(x, y, 0, -.66f, .7f), Box(x, y, 0, -.35f, 1f, .35f)));
                case LaunchIcon.Guide:
                    return Sub(Box(x, y, 0, 0, .62f, .5f), Seg(x, y, 0, -.5f, 0, .5f, .035f));
                case LaunchIcon.Resume:
                    return Mathf.Min(Ring(x, y, 0, 0, .62f, .09f), Poly(x, y, -.18f, .3f, .32f, 0, -.18f, -.3f));
                case LaunchIcon.Key:
                    return Mathf.Min(Mathf.Min(Ring(x, y, -.38f, 0, .3f, .09f), Seg(x, y, -.08f, 0, .72f, 0, .09f)),
                        Mathf.Min(Seg(x, y, .46f, 0, .46f, -.3f, .08f), Seg(x, y, .68f, 0, .68f, -.24f, .08f)));
                case LaunchIcon.Play:
                    return Poly(x, y, -.42f, .62f, .62f, 0, -.42f, -.62f);
                case LaunchIcon.Check:
                    return Mathf.Min(Seg(x, y, -.5f, -.02f, -.14f, -.4f, .12f), Seg(x, y, -.14f, -.4f, .56f, .46f, .12f));
                default: return Circle(x, y, 0, 0, .6f);
            }
        }
    }
}

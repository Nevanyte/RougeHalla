using System;
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Original procedural textures for the Wish effects. White-and-alpha only: colour comes from the palette at draw time.
    /// Generated once on first use (about 0.9 MB of RGBA in all), shared by sprites and particle materials, nothing derived
    /// from any third-party artwork. Each sprite's pixels-per-unit equals its size, so a scale of 1 is one world unit.
    /// </summary>
    public static class WishFxArt
    {
        public const string Soft = "wish.soft", Disc = "wish.disc", Band = "wish.band", Hairline = "wish.hairline", Dashed = "wish.dashed",
            Shard = "wish.shard", Fly = "wish.fly", Cross = "wish.cross", Rays = "wish.rays", Column = "wish.column", Chain = "wish.chain",
            Beam = "wish.beam", Flame = "wish.flame", Gavel = "wish.gavel", Scales = "wish.scales", Star = "wish.star", Solid = "wish.solid";

        static readonly Dictionary<string, Sprite> Sprites = new Dictionary<string, Sprite>();
        static readonly Dictionary<string, Material> Materials = new Dictionary<string, Material>();
        static readonly List<UnityEngine.Object> Owned = new List<UnityEngine.Object>();

        public static Sprite Get(string key)
        {
            if (Sprites.TryGetValue(key, out var cached) && cached != null) return cached;
            int n = key == Band || key == Hairline || key == Dashed ? 256 : key == Fly || key == Star ? 64 : 128;
            var texture = new Texture2D(n, n, TextureFormat.RGBA32, false)
            { name = "Original / " + key, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
            var pixels = new Color32[n * n];
            for (int y = 0; y < n; y++) for (int x = 0; x < n; x++)
            {
                float u = (x + .5f) / n * 2f - 1f, v = (y + .5f) / n * 2f - 1f;
                float a = Alpha(key, u, v, Mathf.Sqrt(u * u + v * v));
                pixels[y * n + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f));
            }
            texture.SetPixels32(pixels); texture.Apply(false, true);
            var sprite = Sprite.Create(texture, new Rect(0, 0, n, n), new Vector2(.5f, .5f), n, 0, SpriteMeshType.FullRect);
            sprite.name = key; sprite.hideFlags = HideFlags.HideAndDontSave;
            Sprites[key] = sprite; Owned.Add(texture); Owned.Add(sprite);
            return sprite;
        }

        /// <summary>Alpha-blended unlit material for particles using the texture <paramref name="key"/> (cached per key).</summary>
        public static Material ParticleMaterial(string key)
        {
            if (Materials.TryGetValue(key, out var cached) && cached != null) return cached;
            ShowcaseSprites.Initialize();
            var m = new Material(ShowcaseSprites.Unlit) { name = "Roguehalla / wish particle / " + key, hideFlags = HideFlags.HideAndDontSave };
            m.mainTexture = Get(key).texture;
            Materials[key] = m; Owned.Add(m);
            return m;
        }

        public static void Release()
        {
            foreach (var o in Owned) if (o != null) { if (Application.isPlaying) UnityEngine.Object.Destroy(o); else UnityEngine.Object.DestroyImmediate(o); }
            Owned.Clear(); Sprites.Clear(); Materials.Clear();
        }

        static float Smooth(float a, float b, float x)
        {
            float t = Mathf.Clamp01((x - a) / (b - a)); return t * t * (3f - 2f * t);
        }
        static float Seg(float x, float y, float ax, float ay, float bx, float by)
        {
            float px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
            float t = Mathf.Clamp01((px * dx + py * dy) / (dx * dx + dy * dy));
            float qx = px - dx * t, qy = py - dy * t; return Mathf.Sqrt(qx * qx + qy * qy);
        }
        static float Edge(float d, float width) { return Mathf.Clamp01(d / width); }

        static float Alpha(string key, float u, float v, float r)
        {
            float ang = Mathf.Atan2(v, u);
            switch (key)
            {
                case Soft: return Mathf.Pow(Mathf.Max(0f, 1f - r), 2f);
                case Disc: return Smooth(1f, .74f, r);
                case Solid: return 1f;
                case Band: return Smooth(.66f, .94f, r) * Smooth(1f, .965f, r);
                case Hairline: return Mathf.Clamp01((.03f - Mathf.Abs(r - .955f)) * 60f);
                case Dashed:
                {
                    float stroke = Mathf.Clamp01((.036f - Mathf.Abs(r - .955f)) * 60f);
                    float cell = Mathf.Repeat(ang / (2f * Mathf.PI) * 36f, 1f);
                    return stroke * Smooth(.0f, .08f, cell) * Smooth(.66f, .58f, cell);
                }
                case Shard:
                {
                    float t = (v + 1f) * .5f;
                    float half = .36f * Mathf.Min(t / .3f, (1f - t) / .7f);
                    return Mathf.Clamp01((half - Mathf.Abs(u)) * 16f) * (.55f + .45f * (1f - Mathf.Abs(u) / Mathf.Max(.001f, half)));
                }
                case Fly:
                {
                    float body = Smooth(1f, .75f, Mathf.Sqrt(Mathf.Pow(u / .2f, 2) + Mathf.Pow(v / .5f, 2)));
                    float wl = Smooth(1f, .7f, Mathf.Sqrt(Mathf.Pow((u + .55f) / .45f, 2) + Mathf.Pow((v - .15f) / .26f, 2)));
                    float wr = Smooth(1f, .7f, Mathf.Sqrt(Mathf.Pow((u - .55f) / .45f, 2) + Mathf.Pow((v - .15f) / .26f, 2)));
                    return Mathf.Max(body, Mathf.Max(wl, wr) * .55f);
                }
                case Cross:
                {
                    float sx = Mathf.Clamp01(1f - Mathf.Abs(u) * 9f) * Mathf.Pow(Mathf.Clamp01(1f - Mathf.Abs(v)), 2f);
                    float sy = Mathf.Clamp01(1f - Mathf.Abs(v) * 9f) * Mathf.Pow(Mathf.Clamp01(1f - Mathf.Abs(u)), 2f);
                    return Mathf.Min(1f, Mathf.Max(sx, sy) + Mathf.Pow(Mathf.Max(0f, 1f - r * 2.2f), 2f));
                }
                case Rays:
                {
                    float m = Mathf.Pow(Mathf.Abs(Mathf.Cos(ang * 6f)), 7f);
                    return (m * .85f + .12f) * Mathf.Pow(Mathf.Max(0f, 1f - r), 1.3f) * Smooth(.05f, .22f, r);
                }
                case Column:
                {
                    float t = (v + 1f) * .5f;
                    return Mathf.Pow(Mathf.Max(0f, 1f - Mathf.Abs(u)), 1.7f) * Mathf.Pow(1f - t, 1.15f) * Smooth(0f, .07f, t);
                }
                case Chain:
                {
                    float e = Mathf.Sqrt(Mathf.Pow(u / .5f, 2) + v * v);
                    return Mathf.Clamp01((.2f - Mathf.Abs(e - .78f)) * 10f);
                }
                case Beam: return Mathf.Pow(Mathf.Max(0f, 1f - Mathf.Abs(v)), 2f) * Smooth(1f, .72f, Mathf.Abs(u));
                case Flame:
                {
                    float t = (v + 1f) * .5f;
                    float w = .56f * Mathf.Pow(Mathf.Max(0f, 1f - t), .8f) * (.78f + .22f * Mathf.Cos(t * 9f)) * Smooth(0f, .08f, t * 3f + .0f);
                    return Mathf.Clamp01((w - Mathf.Abs(u)) * 12f) * (1f - t * t * t) * (.7f + .3f * (1f - Mathf.Abs(u) / Mathf.Max(.01f, w)));
                }
                case Gavel:
                {
                    float head = Mathf.Min(Mathf.Abs(u) - .56f, Mathf.Abs(v - .45f) - .22f);
                    float handle = Mathf.Min(Mathf.Abs(u) - .09f, Mathf.Abs(v + .28f) - .58f);
                    float band = Mathf.Min(Mathf.Abs(u) - .13f, Mathf.Abs(v - .45f) - .26f);
                    float d = Mathf.Min(head, Mathf.Min(handle, band));
                    return Mathf.Clamp01(-d * 24f);
                }
                case Scales:
                {
                    float pillar = Seg(u, v, 0f, -.82f, 0f, .66f) - .055f;
                    float beam = Seg(u, v, -.82f, .62f, .82f, .62f) - .045f;
                    float panL = Mathf.Abs(Mathf.Sqrt(Mathf.Pow(u + .6f, 2) + Mathf.Pow(v - .22f, 2)) - .3f) - .045f;
                    float panR = Mathf.Abs(Mathf.Sqrt(Mathf.Pow(u - .6f, 2) + Mathf.Pow(v - .22f, 2)) - .3f) - .045f;
                    if (v > .22f) { panL = panR = 1f; }
                    float strings = Mathf.Min(Mathf.Min(Seg(u, v, -.82f, .62f, -.9f, .22f), Seg(u, v, -.82f, .62f, -.3f, .22f)),
                        Mathf.Min(Seg(u, v, .82f, .62f, .3f, .22f), Seg(u, v, .82f, .62f, .9f, .22f))) - .022f;
                    float foot = Seg(u, v, -.4f, -.82f, .4f, -.82f) - .06f;
                    return Mathf.Clamp01(-Mathf.Min(Mathf.Min(pillar, beam), Mathf.Min(Mathf.Min(panL, panR), Mathf.Min(strings, foot))) * 24f);
                }
                case Star:
                {
                    float thr = .34f + .62f * Mathf.Pow(Mathf.Abs(Mathf.Cos(ang * 2.5f)), 2.2f);
                    return Mathf.Clamp01((thr - r) * 8f);
                }
                default: return Smooth(1f, .9f, r);
            }
        }
    }
}

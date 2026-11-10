// Tiny CPU painter for the procedural region art (props, wall skins). Shapes are signed distance functions, shaded with a
// soft toon dome (lit from the upper left), edged with a dark outline and anti-aliased by distance. Everything is
// deterministic. Pixel space: x right, y UP (row 0 is the bottom of the sprite, which is the ground contact side).
// Colours are sRGB; the atlas texture is created sRGB so the GPU converts.
using System;
using UnityEngine;

namespace Roguehalla.Client
{
    public delegate float Sdf(float x, float y);
    public delegate Color Shader2(float x, float y, float depth);

    public sealed class RegionCanvas
    {
        public readonly int W, H;
        public readonly Color[] Px;
        public static readonly Vector3 LightDir = new Vector3(-.55f, .62f, .56f).normalized;

        public RegionCanvas(int w, int h) { W = w; H = h; Px = new Color[w * h]; }

        // ---- shape primitives (negative inside) -----------------------------------------------------------------------
        public static Sdf Circle(float cx, float cy, float r) { return (x, y) => Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - r; }
        public static Sdf Ellipse(float cx, float cy, float rx, float ry)
        {
            float m = Mathf.Min(rx, ry);
            return (x, y) => { float dx = (x - cx) / rx, dy = (y - cy) / ry; return (Mathf.Sqrt(dx * dx + dy * dy) - 1f) * m; };
        }
        public static Sdf Box(float cx, float cy, float hw, float hh, float round = 0)
        {
            return (x, y) => { float qx = Mathf.Abs(x - cx) - hw + round, qy = Mathf.Abs(y - cy) - hh + round;
                return Mathf.Sqrt(Mathf.Max(qx, 0) * Mathf.Max(qx, 0) + Mathf.Max(qy, 0) * Mathf.Max(qy, 0)) + Mathf.Min(Mathf.Max(qx, qy), 0) - round; };
        }
        /// <summary>Tapered capsule from a (radius ra) to b (radius rb).</summary>
        public static Sdf Capsule(Vector2 a, Vector2 b, float ra, float rb)
        {
            Vector2 ab = b - a; float l2 = Mathf.Max(ab.sqrMagnitude, 1e-5f);
            return (x, y) => { var p = new Vector2(x, y) - a; float t = Mathf.Clamp01(Vector2.Dot(p, ab) / l2);
                return (p - ab * t).magnitude - Mathf.Lerp(ra, rb, t); };
        }
        public static Sdf Poly(params Vector2[] v)
        {
            return (x, y) =>
            {
                float d = float.MaxValue; bool inside = false;
                for (int i = 0, j = v.Length - 1; i < v.Length; j = i++)
                {
                    Vector2 a = v[j], b = v[i], e = b - a, p = new Vector2(x, y) - a;
                    float t = Mathf.Clamp01(Vector2.Dot(p, e) / Mathf.Max(e.sqrMagnitude, 1e-6f));
                    d = Mathf.Min(d, (p - e * t).magnitude);
                    if ((a.y > y) != (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
                }
                return inside ? -d : d;
            };
        }
        /// <summary>Blobby rock-like polygon: a rounded half-ellipse with deterministic jitter, base on y = baseY.</summary>
        public static Vector2[] RockOutline(float cx, float baseY, float rx, float ry, int seed, int n = 9, float jitter = .18f, float flat = .0f)
        {
            var pts = new Vector2[n + 1];
            for (int i = 0; i <= n; i++)
            {
                float a = Mathf.PI * i / n;
                float j = 1f + (RegionNoise.Hash01(i, 3, seed) - .5f) * 2f * jitter * (i == 0 || i == n ? .3f : 1f);
                float y = Mathf.Sin(a) * ry * j; if (flat > 0) y = Mathf.Min(y, ry * (1f - flat));
                pts[i] = new Vector2(cx + Mathf.Cos(a) * rx * j, baseY + y);
            }
            return pts;
        }
        public static Sdf Union(params Sdf[] s) { return (x, y) => { float d = float.MaxValue; for (int i = 0; i < s.Length; i++) d = Mathf.Min(d, s[i](x, y)); return d; }; }
        public static Sdf SmoothUnion(Sdf a, Sdf b, float k)
        {
            return (x, y) => { float d1 = a(x, y), d2 = b(x, y); float h = Mathf.Clamp01(.5f + .5f * (d2 - d1) / k); return Mathf.Lerp(d2, d1, h) - k * h * (1f - h); };
        }
        public static Sdf Intersect(Sdf a, Sdf b) { return (x, y) => Mathf.Max(a(x, y), b(x, y)); }
        public static Sdf Subtract(Sdf a, Sdf b) { return (x, y) => Mathf.Max(a(x, y), -b(x, y)); }
        public static Sdf Offset(Sdf s, float dx, float dy) { return (x, y) => s(x - dx, y - dy); }
        public static Sdf Grow(Sdf s, float by) { return (x, y) => s(x, y) - by; }

        // ---- shading ----------------------------------------------------------------------------------------------------
        public static Color Mix(Color a, Color b, float t) { return Color.Lerp(a, b, Mathf.Clamp01(t)); }
        public static Color Shade(Color c, float k) { return new Color(Mathf.Clamp01(c.r * k), Mathf.Clamp01(c.g * k), Mathf.Clamp01(c.b * k), c.a); }
        public static Color Alpha(Color c, float a) { c.a = a; return c; }

        /// <summary>Toon dome: 3-colour ramp driven by a soft lambert term. <paramref name="radius"/> is how deep (px) the dome rounds in.</summary>
        public static Shader2 Dome(Sdf sdf, Color shadow, Color mid, Color light, float radius, float grain = 0f, int seed = 1, float aoBelow = 0f, float rim = 0f)
        {
            return (x, y, depth) =>
            {
                float hC = DomeHeight(-sdf(x, y), radius);
                float hx = DomeHeight(-sdf(x + 1f, y), radius) - DomeHeight(-sdf(x - 1f, y), radius);
                float hy = DomeHeight(-sdf(x, y + 1f), radius) - DomeHeight(-sdf(x, y - 1f), radius);
                var n = new Vector3(-hx * radius * .5f, -hy * radius * .5f, 1f).normalized;
                float l = Mathf.Clamp01(Vector3.Dot(n, LightDir) * .5f + .5f + (hC - .5f) * .2f);
                Color c = l < .5f ? Color.Lerp(shadow, mid, SmoothBand(l, .22f, .46f)) : Color.Lerp(mid, light, SmoothBand(l, .58f, .86f));
                if (grain > 0f) { float g = RegionNoise.Periodic(x * .31f, y * .31f, 1024, seed) - .5f; c = Shade(c, 1f + g * grain); }
                if (aoBelow > 0f) c = Shade(c, 1f - aoBelow * Mathf.Clamp01(1f - y / 26f));
                if (rim > 0f) c = Mix(c, light, rim * Mathf.Clamp01(1f - depth / 2.2f) * .6f);
                return c;
            };
        }
        static float DomeHeight(float depth, float radius) { float t = Mathf.Clamp01(depth / radius); return Mathf.Sqrt(1f - (1f - t) * (1f - t)); }
        static float SmoothBand(float v, float a, float b) { float t = Mathf.Clamp01((v - a) / (b - a)); return t * t * (3f - 2f * t); }

        /// <summary>Flat colour with a vertical gradient from <paramref name="top"/> at yTop to <paramref name="bottom"/> at yBottom.</summary>
        public static Shader2 Vertical(Color top, Color bottom, float yTop, float yBottom)
        {
            return (x, y, d) => Color.Lerp(bottom, top, Mathf.Clamp01((y - yBottom) / Mathf.Max(yTop - yBottom, 1e-3f)));
        }
        public static Shader2 Flat(Color c) { return (x, y, d) => c; }
        /// <summary>Left-to-right split for faceted forms: lit left face and shaded right face of a vertical edge at <paramref name="edgeX"/>.</summary>
        public static Shader2 Split(float edgeX, Color left, Color right, float feather = 1.2f)
        {
            return (x, y, d) => Color.Lerp(left, right, Mathf.Clamp01((x - edgeX) / feather * .5f + .5f));
        }

        // ---- compositing ------------------------------------------------------------------------------------------------
        /// <summary>Paints <paramref name="shader"/> where <paramref name="sdf"/> is inside, anti-aliased, over what is there. Optional dark outline.</summary>
        public void Fill(Sdf sdf, Shader2 shader, Color? outline = null, float outlineWidth = 1.4f, float opacity = 1f)
        {
            float pad = outline.HasValue ? outlineWidth + 1.5f : 1.5f;
            const int B = 4;   // skip whole 4x4 blocks that are provably outside (the distance fields are 1-Lipschitz)
            for (int by = 0; by < H; by += B) for (int bx = 0; bx < W; bx += B)
            {
                if (sdf(bx + B * .5f, by + B * .5f) > pad + B * .75f) continue;
                int ye = Mathf.Min(H, by + B), xe = Mathf.Min(W, bx + B);
                for (int y = by; y < ye; y++) for (int x = bx; x < xe; x++)
                {
                    float px = x + .5f, py = y + .5f, s = sdf(px, py);
                    if (s > pad) continue;
                    int i = y * W + x;
                    if (outline.HasValue)
                    {
                        float oc = Mathf.Clamp01(.5f - (s - outlineWidth)) * opacity;
                        if (oc > 0) Px[i] = Over(Px[i], Alpha(outline.Value, outline.Value.a * oc));
                    }
                    float cov = Mathf.Clamp01(.5f - s) * opacity;
                    if (cov <= 0) continue;
                    Color c = shader(px, py, Mathf.Max(0, -s)); c.a *= cov;
                    Px[i] = Over(Px[i], c);
                }
            }
        }

        public void SoftShadow(float cx, float cy, float rx, float ry, float alpha, Color tint)
        {
            for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
            {
                float dx = (x + .5f - cx) / rx, dy = (y + .5f - cy) / ry, r = Mathf.Sqrt(dx * dx + dy * dy);
                if (r >= 1f) continue;
                float a = (1f - r) * (1f - r) * alpha * (r < .6f ? 1f : 1f);
                Px[y * W + x] = Over(Px[y * W + x], Alpha(tint, a));
            }
        }

        /// <summary>Soft additive-looking glow blended over (used for emissive accents).</summary>
        public void Glow(float cx, float cy, float r, Color c, float alpha)
        {
            for (int y = Mathf.Max(0, (int)(cy - r)); y < Mathf.Min(H, (int)(cy + r) + 1); y++)
                for (int x = Mathf.Max(0, (int)(cx - r)); x < Mathf.Min(W, (int)(cx + r) + 1); x++)
                {
                    float d = Mathf.Sqrt((x + .5f - cx) * (x + .5f - cx) + (y + .5f - cy) * (y + .5f - cy)) / r;
                    if (d >= 1f) continue;
                    float a = (1f - d) * (1f - d) * alpha;
                    Px[y * W + x] = Over(Px[y * W + x], Alpha(c, a));
                }
        }

        public static Color Over(Color dst, Color src)
        {
            float a = src.a + dst.a * (1f - src.a);
            if (a <= 1e-5f) return new Color(0, 0, 0, 0);
            return new Color((src.r * src.a + dst.r * dst.a * (1f - src.a)) / a, (src.g * src.a + dst.g * dst.a * (1f - src.a)) / a,
                (src.b * src.a + dst.b * dst.a * (1f - src.a)) / a, a);
        }

        /// <summary>Copies the canvas into <paramref name="dst"/> at (ox,oy), with <paramref name="padding"/> px of edge-extended gutter to stop bilinear bleeding.</summary>
        public void CopyTo(Color32[] dst, int dstW, int ox, int oy, int padding = 2)
        {
            for (int y = -padding; y < H + padding; y++) for (int x = -padding; x < W + padding; x++)
            {
                int sx = Mathf.Clamp(x, 0, W - 1), sy = Mathf.Clamp(y, 0, H - 1);
                Color c = Px[sy * W + sx];
                // Gutter pixels keep the colour but not the alpha, so the sprite edge never haloes.
                if (x < 0 || y < 0 || x >= W || y >= H) c.a = 0f;
                dst[(oy + y) * dstW + ox + x] = new Color32((byte)(c.r * 255f + .5f), (byte)(c.g * 255f + .5f), (byte)(c.b * 255f + .5f), (byte)(c.a * 255f + .5f));
            }
        }
    }
}

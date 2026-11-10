// Crisp generated glyphs for the world indicators (status marks, crown, quest and trader marks). White glyph over a dark outline, so a tint
// colours the glyph and the outline keeps it readable on any ground; textures are generated once, cached for the app lifetime, and carry no
// imported art. Coordinates are a 24 x 24 grid with y down (the same grid the legacy combat icons use).
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    public static class IndicatorArt
    {
        const int Size = 64;
        const float Grid = 24f, Outline = 1.7f;
        enum K : byte { Poly, Line, Ring, Disc }
        struct S { public K Kind; public float[] P; public float W; }
        static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();

        static S Poly(params float[] p) { return new S { Kind = K.Poly, P = p }; }
        static S Line(float w, params float[] p) { return new S { Kind = K.Line, P = p, W = w }; }
        static S Ring(float cx, float cy, float r, float w) { return new S { Kind = K.Ring, P = new[] { cx, cy, r }, W = w }; }
        static S Disc(float cx, float cy, float r) { return new S { Kind = K.Disc, P = new[] { cx, cy, r } }; }

        static S[] Shapes(string key)
        {
            switch (key)
            {
                case "crown": return new[] { Poly(2, 19, 2, 7, 7.5f, 12, 12, 3.5f, 16.5f, 12, 22, 7, 22, 19) };
                case "stun": return new[] { Line(2.6f, 12, 2.5f, 12, 21.5f), Line(2.6f, 2.5f, 12, 21.5f, 12), Line(2f, 5.5f, 5.5f, 18.5f, 18.5f), Line(2f, 18.5f, 5.5f, 5.5f, 18.5f) };
                case "silence": return new[] { Ring(12, 12, 8.6f, 2.4f), Line(2.4f, 7.6f, 7.6f, 16.4f, 16.4f), Line(2.4f, 16.4f, 7.6f, 7.6f, 16.4f) };
                case "clock": return new[] { Ring(12, 12, 8.6f, 2.4f), Line(2.4f, 12, 12, 12, 6.5f), Line(2.4f, 12, 12, 16, 14) };
                case "antiheal": return new[] { Poly(9, 3, 15, 3, 15, 9, 21, 9, 21, 15, 15, 15, 15, 21, 9, 21, 9, 15, 3, 15, 3, 9, 9, 9) };
                case "flame": return new[] { Poly(12, 1.5f, 17, 8, 19.5f, 14, 17.5f, 20, 12, 22.5f, 6.5f, 20, 4.5f, 14, 7.5f, 9.5f, 9.5f, 12, 10, 6) };
                case "dashring": return new[] { Ring(12, 12, 8.8f, 2.2f) };
                case "faststand": return new[] { Ring(12, 12, 8.2f, 3.4f) };
                case "haste": return new[] { Line(2.6f, 2, 6.5f, 14, 6.5f), Line(2.6f, 6, 12, 21, 12), Line(2.6f, 2, 17.5f, 14, 17.5f) };
                case "slow": return new[] { Poly(12, 21, 3.5f, 11, 9, 11, 9, 3, 15, 3, 15, 11, 20.5f, 11) };
                case "cast": return new[] { Poly(12, 1, 15, 9, 23, 12, 15, 15, 12, 23, 9, 15, 1, 12, 9, 9) };
                case "chain": return new[] { Ring(8, 12, 5.2f, 2.4f), Ring(16, 12, 5.2f, 2.4f) };
                case "shackle": return new[] { Ring(12, 10, 7.2f, 2.6f), Poly(5, 18.5f, 19, 18.5f, 19, 22.5f, 5, 22.5f) };
                case "bang": return new[] { Poly(9.6f, 2, 14.4f, 2, 13.6f, 15, 10.4f, 15), Disc(12, 19.6f, 2.5f) };
                case "query": return new[] { Line(3.2f, 7.8f, 8.6f, 8.6f, 4.8f, 12, 3.8f, 15.4f, 4.8f, 16.2f, 8.6f, 12, 12.8f, 12, 15.6f), Disc(12, 19.8f, 2.4f) };
                case "diamond": return new[] { Poly(12, 2, 21.5f, 12, 12, 22, 2.5f, 12) };
                case "coin": return new[] { Disc(12, 12, 8.5f) };
                case "xmark": return new[] { Line(3.4f, 3.5f, 3.5f, 20.5f, 20.5f), Line(3.4f, 20.5f, 3.5f, 3.5f, 20.5f) };
                case "crate": return new[] { Poly(3.5f, 7, 20.5f, 7, 20.5f, 20, 3.5f, 20), Line(2.4f, 8, 7, 8, 2.5f), Line(2.4f, 8, 2.5f, 16, 2.5f), Line(2.4f, 16, 2.5f, 16, 7) };
                case "snow": return new[] { Line(2.6f, 12, 2.5f, 12, 21.5f), Line(2.6f, 3.6f, 7.2f, 20.4f, 16.8f), Line(2.6f, 3.6f, 16.8f, 20.4f, 7.2f), Ring(12, 12, 4f, 2f) };
                case "swarm": return new[] { Disc(12, 6.5f, 4f), Disc(6, 17, 4f), Disc(18, 17, 4f) };
                case "star": return new[] { Poly(12.0f, 2.6f, 14.53f, 9.32f, 21.7f, 9.65f, 16.09f, 14.13f, 18.0f, 21.05f, 12.0f, 17.1f, 6.0f, 21.05f, 7.91f, 14.13f, 2.3f, 9.65f, 9.47f, 9.32f) };
                case "droplet": return new[] { Poly(12, 2, 17.5f, 11, 18.5f, 15, 16, 19.5f, 12, 21, 8, 19.5f, 5.5f, 15, 6.5f, 11) };
                case "skull": return new[] { Ring(12, 10, 7.4f, 2.4f), Disc(9, 10.4f, 1.9f), Disc(15, 10.4f, 1.9f), Line(2.2f, 9, 17.2f, 9, 21.5f), Line(2.2f, 12, 17.6f, 12, 21.8f), Line(2.2f, 15, 17.2f, 15, 21.5f) };
                case "pip": return new[] { Disc(12, 12, 6f) };
                default: return new[] { Disc(12, 12, 6f) };
            }
        }

        public static Sprite Get(string key)
        {
            if (Cache.TryGetValue(key, out var s) && s != null) return s;
            var shapes = Shapes(key);
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, false) { name = "Indicator / " + key, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[Size * Size];
            float k = Grid / Size;
            for (int y = 0; y < Size; y++)
            for (int x = 0; x < Size; x++)
            {
                float gx = (x + .5f) * k, gy = (Size - y - .5f) * k; // texture y is up, grid y is down
                float d = float.MaxValue;
                for (int i = 0; i < shapes.Length; i++) d = Mathf.Min(d, Distance(shapes[i], gx, gy));
                float inner = Mathf.Clamp01(.5f - d / k), outer = Mathf.Clamp01(.5f - (d - Outline) / k);
                if (outer <= 0f) continue;
                byte c = (byte)Mathf.RoundToInt(255f * inner);
                px[y * Size + x] = new Color32(c, c, c, (byte)Mathf.RoundToInt(255f * outer));
            }
            tex.SetPixels32(px); tex.Apply(false, false);
            s = Sprite.Create(tex, new Rect(0, 0, Size, Size), new Vector2(.5f, .5f), Size);
            s.name = "Indicator / " + key; Cache[key] = s;
            return s;
        }

        static float Distance(S s, float x, float y)
        {
            switch (s.Kind)
            {
                case K.Disc: return Mathf.Sqrt((x - s.P[0]) * (x - s.P[0]) + (y - s.P[1]) * (y - s.P[1])) - s.P[2];
                case K.Ring: return Mathf.Abs(Mathf.Sqrt((x - s.P[0]) * (x - s.P[0]) + (y - s.P[1]) * (y - s.P[1])) - s.P[2]) - s.W * .5f;
                case K.Line: return Path(s.P, x, y, false) - s.W * .5f;
                default:
                    float edge = Path(s.P, x, y, true);
                    return Inside(s.P, x, y) ? -edge : edge;
            }
        }

        static float Path(float[] p, float x, float y, bool closed)
        {
            float best = float.MaxValue; int n = p.Length / 2;
            for (int i = 0; i < (closed ? n : n - 1); i++)
            {
                int j = (i + 1) % n;
                float ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
                float dx = bx - ax, dy = by - ay, t = Mathf.Clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy + 1e-6f));
                float qx = ax + dx * t - x, qy = ay + dy * t - y;
                best = Mathf.Min(best, Mathf.Sqrt(qx * qx + qy * qy));
            }
            return best;
        }

        static bool Inside(float[] p, float x, float y)
        {
            bool inside = false; int n = p.Length / 2;
            for (int i = 0, j = n - 1; i < n; j = i++)
            {
                float xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
                if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
            return inside;
        }
    }
}

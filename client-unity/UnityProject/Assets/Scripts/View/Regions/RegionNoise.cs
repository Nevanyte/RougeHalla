// Deterministic, seedable noise for procedural region art (ground tiles, props, walls). Pure functions, no state, no
// UnityEngine.Random: the same inputs give the same pixels on every load and every platform.
using UnityEngine;

namespace Roguehalla.Client
{
    public static class RegionNoise
    {
        public static uint Hash(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393) + (uint)(y * 668265263) + (uint)(seed * 2246822519u);
                h = (h ^ (h >> 13)) * 1274126177u;
                return h ^ (h >> 16);
            }
        }
        public static float Hash01(int x, int y, int seed) { return (Hash(x, y, seed) & 0xFFFFFF) / 16777216f; }
        public static float Hash01(uint h) { return (h & 0xFFFFFF) / 16777216f; }

        static int Wrap(int i, int period) { int m = i % period; return m < 0 ? m + period : m; }
        static float Smooth(float t) { return t * t * (3f - 2f * t); }

        /// <summary>Value noise tiling every <paramref name="period"/> lattice cells (x and y are in lattice units).</summary>
        public static float Periodic(float x, float y, int period, int seed)
        {
            int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y);
            float fx = Smooth(x - xi), fy = Smooth(y - yi);
            int x0 = Wrap(xi, period), x1 = Wrap(xi + 1, period), y0 = Wrap(yi, period), y1 = Wrap(yi + 1, period);
            float a = Hash01(x0, y0, seed), b = Hash01(x1, y0, seed), c = Hash01(x0, y1, seed), d = Hash01(x1, y1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        /// <summary>Like <see cref="Periodic"/> with independent periods per axis (for stretched, stroke-like noise that must still tile).</summary>
        public static float PeriodicXY(float x, float y, int periodX, int periodY, int seed)
        {
            int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y);
            float fx = Smooth(x - xi), fy = Smooth(y - yi);
            int x0 = Wrap(xi, periodX), x1 = Wrap(xi + 1, periodX), y0 = Wrap(yi, periodY), y1 = Wrap(yi + 1, periodY);
            float a = Hash01(x0, y0, seed), b = Hash01(x1, y0, seed), c = Hash01(x0, y1, seed), d = Hash01(x1, y1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        /// <summary>Tileable fractal noise over u,v in [0,1): <paramref name="basePeriod"/> cells across at the first octave.</summary>
        public static float Fbm(float u, float v, int basePeriod, int octaves, int seed)
        {
            float sum = 0, amp = .5f, norm = 0; int period = basePeriod;
            for (int o = 0; o < octaves; o++)
            {
                sum += amp * Periodic(u * period, v * period, period, seed + o * 31);
                norm += amp; amp *= .5f; period *= 2;
            }
            return sum / norm;
        }

        /// <summary>Tileable Worley noise: nearest distance, edge strength (second minus first, in cell units) and a stable cell id in [0,1).</summary>
        public static void Worley(float u, float v, int cells, int seed, out float f1, out float edge, out float id)
        {
            float x = u * cells, y = v * cells; int xi = Mathf.FloorToInt(x), yi = Mathf.FloorToInt(y);
            float d1 = 9, d2 = 9; uint best = 0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
            {
                int cx = xi + i, cy = yi + j, wx = Wrap(cx, cells), wy = Wrap(cy, cells);
                uint h = Hash(wx, wy, seed);
                float px = cx + .15f + .7f * ((h & 0xFF) / 255f), py = cy + .15f + .7f * (((h >> 8) & 0xFF) / 255f);
                float dx = px - x, dy = py - y, d = Mathf.Sqrt(dx * dx + dy * dy);
                if (d < d1) { d2 = d1; d1 = d; best = h; } else if (d < d2) d2 = d;
            }
            f1 = d1; edge = d2 - d1; id = ((best >> 16) & 0xFFFF) / 65536f;
        }

        public static float SmoothStep(float a, float b, float x)
        {
            float t = Mathf.Clamp01((x - a) / (b - a)); return t * t * (3f - 2f * t);
        }
    }
}

namespace Roguehalla.Client
{
    /// <summary>Destroys through the right API in play mode and in edit-mode tests.</summary>
    static class RegionUtil
    {
        public static void Kill(UnityEngine.Object o)
        {
            if (o == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(o); else UnityEngine.Object.DestroyImmediate(o);
        }
    }
}

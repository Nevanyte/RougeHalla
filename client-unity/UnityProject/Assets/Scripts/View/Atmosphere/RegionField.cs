using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// CPU copy of the blurred region weights the ground shader samples, so lighting, grading and haze follow the player's
    /// position continuously (not a timed switch). Built once per map (a few ms); sampling is allocation free.
    /// Presentation only: reads the public region plane.
    /// </summary>
    public sealed class RegionField
    {
        public const int Regions = 6;       // wire ids 1..6
        public const int BlurRadius = 3;    // tiles, matches the ground bake closely
        float[] _w; int _width, _height;
        public bool Ready { get { return _w != null; } }

        public void Build(byte[] regions, int width, int height)
        {
            _w = null; if (regions == null || regions.Length != width * height) return;
            _width = width; _height = height;
            int n = width * height;
            var valid = new float[n]; var chan = new float[n]; var tmp = new float[n];
            for (int i = 0; i < n; i++) valid[i] = regions[i] != 0 ? 1f : 0f;
            Blur(valid, tmp, width, height, BlurRadius);
            var w = new float[n * Regions];
            for (int k = 0; k < Regions; k++)
            {
                for (int i = 0; i < n; i++) chan[i] = regions[i] == k + 1 ? 1f : 0f;
                Blur(chan, tmp, width, height, BlurRadius);
                for (int i = 0; i < n; i++) w[i * Regions + k] = chan[i] / Mathf.Max(valid[i], 1e-4f);
            }
            for (int i = 0; i < n; i++)     // normalise (border tiles with no region fall back to coliseum)
            {
                float s = 0; for (int k = 0; k < Regions; k++) s += w[i * Regions + k];
                if (s < 1e-3f) { w[i * Regions + 5] = 1f; continue; }
                for (int k = 0; k < Regions; k++) w[i * Regions + k] /= s;
            }
            _w = w;
        }

        static void Blur(float[] a, float[] tmp, int w, int h, int r)
        {
            float inv = 1f / (2 * r + 1);
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            { float s = 0; for (int d = -r; d <= r; d++) s += a[y * w + Mathf.Clamp(x + d, 0, w - 1)]; tmp[y * w + x] = s * inv; }
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            { float s = 0; for (int d = -r; d <= r; d++) s += tmp[Mathf.Clamp(y + d, 0, h - 1) * w + x]; a[y * w + x] = s * inv; }
        }

        /// <summary>Weights of regions 1..6 at a tile-space position (x right, y down, 1 unit per tile), bilinear. Sums to 1.</summary>
        public void Sample(float tx, float ty, float[] outW)
        {
            if (_w == null) { for (int k = 0; k < Regions; k++) outW[k] = k == 5 ? 1f : 0f; return; }
            float fx = Mathf.Clamp(tx - .5f, 0, _width - 1.001f), fy = Mathf.Clamp(ty - .5f, 0, _height - 1.001f);
            int x0 = (int)fx, y0 = (int)fy; float ax = fx - x0, ay = fy - y0;
            int i00 = (y0 * _width + x0) * Regions, i10 = i00 + Regions, i01 = i00 + _width * Regions, i11 = i01 + Regions;
            for (int k = 0; k < Regions; k++)
                outW[k] = Mathf.Lerp(Mathf.Lerp(_w[i00 + k], _w[i10 + k], ax), Mathf.Lerp(_w[i01 + k], _w[i11 + k], ax), ay);
        }

        /// <summary>Row-weighted blend of every atmosphere value for weights from <see cref="Sample"/>.</summary>
        public static AtmosphereParams Blend(float[] w)
        {
            var acc = RegionAtmosphereTable.Get(1).Params; float sum = w[0];
            for (int k = 1; k < Regions; k++)
            {
                if (w[k] <= 1e-4f) continue;
                float t = w[k] / (sum + w[k]); sum += w[k];
                acc = AtmosphereParams.Lerp(acc, RegionAtmosphereTable.Get(k + 1).Params, t);
            }
            return acc;
        }

        /// <summary>Region with the largest weight (1..6).</summary>
        public static int Dominant(float[] w)
        {
            int best = 0; for (int k = 1; k < Regions; k++) if (w[k] > w[best]) best = k; return best + 1;
        }
    }
}

using System;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Soft per-zone weight planes of a map's region plane, the same recipe the world ground shader bakes (2 texels per tile, box blur of
    /// radius 3 texels repeated 3 times, about 1.5 tiles, divided by the blurred "inside the map" plane so the weights sum to 1 over every
    /// tile that has a region). The maps sample these instead of the four nearest tiles, so a zone border is a soft gradient the same width as
    /// in the world, not a one-tile staircase. Pure; no engine types.
    /// </summary>
    public static class ZoneWeights
    {
        public const int TexelsPerTile = 2, Radius = 3, Passes = 3;

        /// <summary>Planes indexed by wire region id 1..6 (index 0 unused); each is (w * 2) x (h * 2) floats, row-major from the map's top row.</summary>
        public static float[][] Bake(byte[] regions, int w, int h)
        {
            int ow = w * TexelsPerTile, oh = h * TexelsPerTile;
            var planes = new float[MapZones.Count + 1][];
            var valid = new float[ow * oh]; var tmp = new float[ow * oh];
            for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++) valid[y * ow + x] = regions[(y / TexelsPerTile) * w + x / TexelsPerTile] != 0 ? 1f : 0f;
            Blur(valid, tmp, ow, oh);
            for (int k = 1; k <= MapZones.Count; k++)
            {
                var chan = new float[ow * oh];
                for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++) chan[y * ow + x] = regions[(y / TexelsPerTile) * w + x / TexelsPerTile] == k ? 1f : 0f;
                Blur(chan, tmp, ow, oh);
                for (int i = 0; i < chan.Length; i++) { float v = chan[i] / Math.Max(valid[i], 1e-4f); chan[i] = v < 0f ? 0f : v > 1f ? 1f : v; }
                planes[k] = chan;
            }
            return planes;
        }

        /// <summary>Bilinear sample of a plane at a position in tiles (tile centres at +0.5).</summary>
        public static float Sample(float[] plane, int w, int h, double tx, double ty)
        {
            int ow = w * TexelsPerTile, oh = h * TexelsPerTile;
            double fx = tx * TexelsPerTile - .5, fy = ty * TexelsPerTile - .5;
            int x0 = (int)Math.Floor(fx), y0 = (int)Math.Floor(fy);
            float ax = (float)(fx - x0), ay = (float)(fy - y0);
            int x1 = Math.Min(Math.Max(x0 + 1, 0), ow - 1), y1 = Math.Min(Math.Max(y0 + 1, 0), oh - 1);
            x0 = Math.Min(Math.Max(x0, 0), ow - 1); y0 = Math.Min(Math.Max(y0, 0), oh - 1);
            float top = plane[y0 * ow + x0] * (1f - ax) + plane[y0 * ow + x1] * ax, bottom = plane[y1 * ow + x0] * (1f - ax) + plane[y1 * ow + x1] * ax;
            return top * (1f - ay) + bottom * ay;
        }

        static void Blur(float[] data, float[] tmp, int w, int h)
        {
            for (int p = 0; p < Passes; p++)
            {
                for (int y = 0; y < h; y++) Box(data, tmp, y * w, 1, w);
                for (int x = 0; x < w; x++) Box(tmp, data, x, w, h);
            }
        }

        static void Box(float[] src, float[] dst, int start, int stride, int n)
        {
            float inv = 1f / (2 * Radius + 1), sum = 0;
            for (int i = -Radius; i <= Radius; i++) sum += src[start + Math.Min(Math.Max(i, 0), n - 1) * stride];
            for (int i = 0; i < n; i++)
            {
                dst[start + i * stride] = sum * inv;
                sum += src[start + Math.Min(i + Radius + 1, n - 1) * stride] - src[start + Math.Max(i - Radius, 0) * stride];
            }
        }
    }
}

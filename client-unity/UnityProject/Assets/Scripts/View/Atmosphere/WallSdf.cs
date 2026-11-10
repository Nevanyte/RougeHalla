using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Signed distance to the wall grid (tiles, negative inside a wall), baked once at map load at 4 texels per tile into an R8 texture
    /// (encoded 0.5 + d / 8). The region shaders sphere-trace it for soft shadows from local lights; nothing is built per frame.
    /// </summary>
    public sealed class WallSdf : System.IDisposable
    {
        public const int TexelsPerTile = 4;
        public const float Range = 4f;
        public Texture2D Texture { get; private set; }
        public int Width { get; private set; }
        public int Height { get; private set; }

        public WallSdf(byte[] tiles, int w, int h)
        {
            Width = w * TexelsPerTile; Height = h * TexelsPerTile;
            var px = Bake(tiles, w, h);
            Texture = new Texture2D(Width, Height, TextureFormat.R8, false, true) { name = "Wall SDF", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            Texture.SetPixelData(px, 0); Texture.Apply(false, false);
        }

        /// <summary>Pure bake (testable): one byte per texel, 128 on the wall edge, brighter outside.</summary>
        public static byte[] Bake(byte[] tiles, int w, int h)
        {
            int tw = w * TexelsPerTile, th = h * TexelsPerTile;
            var solid = new bool[tw * th];
            for (int y = 0; y < th; y++) for (int x = 0; x < tw; x++) solid[y * tw + x] = tiles != null && tiles[(y / TexelsPerTile) * w + x / TexelsPerTile] == Roguehalla.Net.Protocol.MapBlob.Wall;
            var outside = Chamfer(solid, tw, th, true);      // distance (texels) from a free texel to the nearest wall texel
            var inside = Chamfer(solid, tw, th, false);      // distance from a wall texel to the nearest free texel
            var d = new float[tw * th];
            for (int i = 0; i < d.Length; i++) d[i] = solid[i] ? -(inside[i] - .5f) / TexelsPerTile : (outside[i] - .5f) / TexelsPerTile;
            var blurred = new float[d.Length];
            for (int y = 0; y < th; y++) for (int x = 0; x < tw; x++)
            {
                float s = 0; int n = 0;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                {
                    int xx = Mathf.Clamp(x + dx, 0, tw - 1), yy = Mathf.Clamp(y + dy, 0, th - 1); s += d[yy * tw + xx]; n++;
                }
                blurred[y * tw + x] = s / n;
            }
            var px = new byte[tw * th];
            for (int i = 0; i < px.Length; i++) px[i] = (byte)Mathf.RoundToInt(Mathf.Clamp01(.5f + blurred[i] / (2f * Range)) * 255f);
            return px;
        }

        /// <summary>Decode a baked byte to a distance in tiles (what the shader does).</summary>
        public static float Decode(byte b) { return (b / 255f - .5f) * 2f * Range; }

        // Two-pass 3-4 chamfer distance transform (texel units). targetSolid: distance to the nearest solid texel, else to the nearest free one.
        static float[] Chamfer(bool[] solid, int w, int h, bool targetSolid)
        {
            const float big = 1e6f, a = 1f, b = 1.41421356f;
            var d = new float[w * h];
            for (int i = 0; i < d.Length; i++) d[i] = (solid[i] == targetSolid) ? 0f : big;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int i = y * w + x; float v = d[i];
                if (x > 0) v = Mathf.Min(v, d[i - 1] + a);
                if (y > 0) { v = Mathf.Min(v, d[i - w] + a); if (x > 0) v = Mathf.Min(v, d[i - w - 1] + b); if (x < w - 1) v = Mathf.Min(v, d[i - w + 1] + b); }
                d[i] = v;
            }
            for (int y = h - 1; y >= 0; y--) for (int x = w - 1; x >= 0; x--)
            {
                int i = y * w + x; float v = d[i];
                if (x < w - 1) v = Mathf.Min(v, d[i + 1] + a);
                if (y < h - 1) { v = Mathf.Min(v, d[i + w] + a); if (x < w - 1) v = Mathf.Min(v, d[i + w + 1] + b); if (x > 0) v = Mathf.Min(v, d[i + w - 1] + b); }
                d[i] = v;
            }
            return d;
        }

        public void Dispose() { if (Texture != null) { if (Application.isPlaying) Object.Destroy(Texture); else Object.DestroyImmediate(Texture); Texture = null; } }
    }
}

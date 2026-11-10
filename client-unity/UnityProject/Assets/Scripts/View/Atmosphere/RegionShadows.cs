using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// Bakes the cast shadows of every wall tile and tall prop into ONE low-resolution coverage texture (4 texels per tile, R8).
    /// The ground shader samples it and darkens by the local sun strength, so there is no renderer or mesh per shadow, nothing runs
    /// per frame, and overlapping shadows never double-darken. All casters share one sun direction; the shadow length of each caster
    /// follows the regional sun length at its position. Shadows are darkening only and live on the ground, so they sit under actors.
    /// </summary>
    public static class RegionShadows
    {
        public const int TexelsPerTile = 4;
        /// <summary>World-space shadow offset (x right, y up) per unit of caster height at full length: a low sun from the upper left.</summary>
        public static readonly Vector2 ShadowPerHeight = new Vector2(.85f, -.45f);
        const float WallCasterHeight = .85f, LowCasterHeight = .3f, MinPropHeight = .38f;

        /// <summary>Shadow offset in tile space (x right, y down) for a caster of this height and length factor.</summary>
        public static Vector2 TileOffset(float height, float length)
        {
            return new Vector2(ShadowPerHeight.x * height * length, -ShadowPerHeight.y * height * length / ArenaView.GroundSquash);
        }

        public static Texture2D Bake(MapBlob map, RegionField field)
        {
            int w = map.W, h = map.H, tw = w * TexelsPerTile, th = h * TexelsPerTile;
            var cover = new float[tw * th];
            var weights = new float[RegionField.Regions];
            float LengthAt(float tx, float ty)
            {
                field.Sample(tx, ty, weights); float len = 0, st = 0;
                for (int k = 0; k < RegionField.Regions; k++) { var p = RegionAtmosphereTable.Get(k + 1).Params; len += p.ShadowLength * weights[k]; st += p.SunStrength * weights[k]; }
                return st < .02f ? 0f : len;   // no sun here, no shadow to cast
            }
            var tiles = map.Tiles; var terrain = map.Terrain;
            bool Solid(int x, int y) { return x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] == MapBlob.Wall; }
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                byte t = tiles[y * w + x]; if (t == MapBlob.Floor) continue;
                int kind = terrain != null ? terrain[y * w + x] : 0;
                if (kind == (int)TerrainKind.Lava || kind == (int)TerrainKind.Crevasse) continue;
                bool low = t == MapBlob.Low;
                if (!low && Solid(x + 1, y) && Solid(x, y + 1) && Solid(x + 1, y + 1)) continue;
                float len = LengthAt(x + .5f, y + .5f); if (len <= 0f) continue;
                Sweep(cover, tw, th, x, y, x + 1, y + 1, TileOffset(low ? LowCasterHeight : WallCasterHeight, len), 1f);
            }
            foreach (var pl in RegionProps.Scatter(map))
            {
                if (!RegionPropArt.TryGet(pl.Art, out var art)) continue;
                float height = art.Height * pl.Scale; if (height < MinPropHeight) continue;
                float len = LengthAt(pl.X, pl.Y); if (len <= 0f) continue;
                float hw = Mathf.Max(.07f, art.Width * pl.Scale * (art.Tall ? .16f : .30f)), hd = .09f;
                Sweep(cover, tw, th, pl.X - hw, pl.Y - hd, pl.X + hw, pl.Y + hd, TileOffset(height * .85f, len), art.Tall ? .9f : .75f);
            }
            Soften(cover, tw, th);
            var px = new byte[cover.Length];
            for (int i = 0; i < px.Length; i++) px[i] = (byte)(Mathf.Clamp01(cover[i]) * 255f + .5f);
            var tex = new Texture2D(tw, th, TextureFormat.R8, false, true) { name = "Region shadow mask", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            tex.SetPixelData(px, 0); tex.Apply(false, true);
            return tex;
        }

        /// <summary>Rasterise the footprint rect swept along <paramref name="s"/> (both components >= 0) into the coverage grid, 2x2 supersampled; darker near the caster.</summary>
        public static void Sweep(float[] cover, int tw, int th, float x0, float y0, float x1, float y1, Vector2 s, float strength)
        {
            int ix0 = Mathf.Max(0, Mathf.FloorToInt(x0 * TexelsPerTile)), iy0 = Mathf.Max(0, Mathf.FloorToInt(y0 * TexelsPerTile));
            int ix1 = Mathf.Min(tw - 1, Mathf.CeilToInt((x1 + s.x) * TexelsPerTile)), iy1 = Mathf.Min(th - 1, Mathf.CeilToInt((y1 + s.y) * TexelsPerTile));
            const float inv = 1f / TexelsPerTile;
            for (int y = iy0; y <= iy1; y++) for (int x = ix0; x <= ix1; x++)
            {
                float acc = 0;
                for (int sy = 0; sy < 2; sy++) for (int sx = 0; sx < 2; sx++)
                {
                    float px = (x + .25f + sx * .5f) * inv, py = (y + .25f + sy * .5f) * inv;
                    float lo = 0f, hi = 1f;
                    if (s.x > 1e-4f) { lo = Mathf.Max(lo, (px - x1) / s.x); hi = Mathf.Min(hi, (px - x0) / s.x); }
                    else if (px < x0 || px > x1) continue;
                    if (s.y > 1e-4f) { lo = Mathf.Max(lo, (py - y1) / s.y); hi = Mathf.Min(hi, (py - y0) / s.y); }
                    else if (py < y0 || py > y1) continue;
                    if (lo > hi) continue;
                    acc += strength * (1f - .4f * lo);
                }
                float v = acc * .25f; int i = y * tw + x; if (v > cover[i]) cover[i] = v;
            }
        }

        static void Soften(float[] a, int w, int h)
        {
            var tmp = new float[a.Length];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                tmp[y * w + x] = a[y * w + x] * .5f + (a[y * w + Mathf.Max(0, x - 1)] + a[y * w + Mathf.Min(w - 1, x + 1)]) * .25f;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                a[y * w + x] = tmp[y * w + x] * .5f + (tmp[Mathf.Max(0, y - 1) * w + x] + tmp[Mathf.Min(h - 1, y + 1) * w + x]) * .25f;
        }
    }
}

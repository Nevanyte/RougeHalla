using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// Cast shadows of every wall tile and tall prop, as ONE low-resolution coverage texture (4 texels per tile, R8) sampled by the
    /// ground shader and darkened by the local sun strength. No renderer or mesh per shadow; overlapping shadows never double-darken.
    /// The texture is filled in 32-tile chunks, lazily, only for chunks that intersect the camera rectangle plus a margin, so
    /// nothing is built for areas that were never on screen and nothing runs per frame (<see cref="UpdateVisible"/> does work only when
    /// the camera enters an unbaked chunk). All casters share one sun direction; each caster's length follows the regional sun length
    /// at its position. Shadows only darken the ground, so they always sit under actors.
    /// </summary>
    public sealed class RegionShadowMap : System.IDisposable
    {
        public const int ChunkTiles = 32, TexelsPerTile = 4;
        /// <summary>World-space shadow offset (x right, y up) per unit of caster height at full length: a low sun from the upper left.</summary>
        public static readonly Vector2 ShadowPerHeight = new Vector2(.85f, -.45f);
        const float WallCasterHeight = .85f, LowCasterHeight = .3f, MinPropHeight = .38f;

        struct Caster { public float X0, Y0, X1, Y1, Sx, Sy, Strength; }
        readonly List<Caster>[] _byChunk; readonly bool[] _baked; readonly int _cw, _ch, _w, _h, _tw, _th;
        readonly byte[] _px; Texture2D _tex; readonly float[] _scratchWeights = new float[RegionField.Regions];
        public Texture2D Mask { get { return _tex; } }
        public int ChunksX { get { return _cw; } }
        public int ChunksY { get { return _ch; } }
        /// <summary>Chunks that intersect the last camera rectangle (the working set; bounded by the camera size, never the map size).</summary>
        public int VisibleChunks { get; private set; }
        /// <summary>Chunks baked so far (each at most once).</summary>
        public int BakedChunks { get; private set; }
        public int CasterCount { get; private set; }
        /// <summary>Stub (P-UNITY-DRESS-2): the strength each prop caster was added with, in scatter order; props only, never walls.</summary>
        public List<float> PropStrengths { get { return _propStrengths; } }
        readonly List<float> _propStrengths = new List<float>();
        /// <summary>Stub (P-UNITY-DRESS-2): the half-width each prop caster was added with, parallel to <see cref="PropStrengths"/>.</summary>
        public List<float> PropHalfWidths { get { return _propHalfWidths; } }
        readonly List<float> _propHalfWidths = new List<float>();

        /// <summary>Shadow offset in tile space (x right, y down) for a caster of this height and length factor.</summary>
        public static Vector2 TileOffset(float height, float length)
        {
            return new Vector2(ShadowPerHeight.x * height * length, -ShadowPerHeight.y * height * length / ArenaView.GroundSquash);
        }

        public RegionShadowMap(MapBlob map, RegionField field)
        {
            _w = map.W; _h = map.H; _tw = _w * TexelsPerTile; _th = _h * TexelsPerTile;
            _cw = (_w + ChunkTiles - 1) / ChunkTiles; _ch = (_h + ChunkTiles - 1) / ChunkTiles;
            _byChunk = new List<Caster>[_cw * _ch]; _baked = new bool[_cw * _ch]; _px = new byte[_tw * _th];
            _tex = new Texture2D(_tw, _th, TextureFormat.R8, false, true) { name = "Region shadow mask", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            _tex.SetPixelData(_px, 0); _tex.Apply(false, false);
            Collect(map, field);
        }

        float LengthAt(RegionField field, float tx, float ty)
        {
            field.Sample(tx, ty, _scratchWeights); float len = 0, st = 0;
            for (int k = 0; k < RegionField.Regions; k++) { var p = RegionAtmosphereTable.Get(k + 1).Params; len += p.ShadowLength * _scratchWeights[k]; st += p.SunStrength * _scratchWeights[k]; }
            return st < .02f ? 0f : len;   // no sun here, no shadow to cast
        }

        void Add(float x0, float y0, float x1, float y1, Vector2 s, float strength)
        {
            int cx = Mathf.Clamp(Mathf.FloorToInt((x0 + x1) * .5f / ChunkTiles), 0, _cw - 1), cy = Mathf.Clamp(Mathf.FloorToInt((y0 + y1) * .5f / ChunkTiles), 0, _ch - 1);
            int i = cy * _cw + cx; if (_byChunk[i] == null) _byChunk[i] = new List<Caster>(64);
            _byChunk[i].Add(new Caster { X0 = x0, Y0 = y0, X1 = x1, Y1 = y1, Sx = s.x, Sy = s.y, Strength = strength }); CasterCount++;
        }

        void Collect(MapBlob map, RegionField field)
        {
            var tiles = map.Tiles; var terrain = map.Terrain; int w = _w, h = _h;
            bool Solid(int x, int y) { return x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] == MapBlob.Wall; }
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                byte t = tiles[y * w + x]; if (t == MapBlob.Floor) continue;
                int kind = terrain != null ? terrain[y * w + x] : 0;
                if (kind == (int)TerrainKind.Lava || kind == (int)TerrainKind.Crevasse) continue;
                bool low = t == MapBlob.Low;
                if (!low && Solid(x + 1, y) && Solid(x, y + 1) && Solid(x + 1, y + 1)) continue;
                float len = LengthAt(field, x + .5f, y + .5f); if (len <= 0f) continue;
                Add(x, y, x + 1, y + 1, TileOffset(low ? LowCasterHeight : WallCasterHeight, len), 1f);
            }
            foreach (var pl in RegionProps.Scatter(map))
            {
                if (!RegionPropArt.TryGet(pl.Art, out var art)) continue;
                float height = art.Height * pl.Scale; if (height < MinPropHeight) continue;
                float len = LengthAt(field, pl.X, pl.Y); if (len <= 0f) continue;
                float hw = Mathf.Max(.07f, art.Width * pl.Scale * (art.Tall ? .16f : .30f)), hd = .09f;
                float strength = art.Tall ? .9f : .75f; _propStrengths.Add(strength); _propHalfWidths.Add(hw);
                Add(pl.X - hw, pl.Y - hd, pl.X + hw, pl.Y + hd, TileOffset(height * .85f, len), strength);
            }
        }

        /// <summary>Tile-space camera rectangle (x right, y down) expanded by <paramref name="margin"/> tiles: bake the unbaked chunks it touches.</summary>
        public void UpdateVisible(float minTx, float minTy, float maxTx, float maxTy, float margin)
        {
            int c0 = Mathf.Max(0, Mathf.FloorToInt((minTx - margin) / ChunkTiles)), c1 = Mathf.Min(_cw - 1, Mathf.FloorToInt((maxTx + margin) / ChunkTiles));
            int r0 = Mathf.Max(0, Mathf.FloorToInt((minTy - margin) / ChunkTiles)), r1 = Mathf.Min(_ch - 1, Mathf.FloorToInt((maxTy + margin) / ChunkTiles));
            VisibleChunks = c1 < c0 || r1 < r0 ? 0 : (c1 - c0 + 1) * (r1 - r0 + 1);
            bool dirty = false;
            for (int cy = r0; cy <= r1; cy++) for (int cx = c0; cx <= c1; cx++)
                if (!_baked[cy * _cw + cx]) { BakeChunk(cx, cy); _baked[cy * _cw + cx] = true; BakedChunks++; dirty = true; }
            if (dirty) { _tex.SetPixelData(_px, 0); _tex.Apply(false, false); }
        }

        void BakeChunk(int cx, int cy)
        {
            const int pad = 2, win = ChunkTiles * TexelsPerTile + pad * 2;
            int ox = cx * ChunkTiles * TexelsPerTile - pad, oy = cy * ChunkTiles * TexelsPerTile - pad;
            var cover = new float[win * win];   // one-off per chunk bake (not per frame)
            for (int ny = Mathf.Max(0, cy - 1); ny <= Mathf.Min(_ch - 1, cy + 1); ny++)
                for (int nx = Mathf.Max(0, cx - 1); nx <= Mathf.Min(_cw - 1, cx + 1); nx++)
                {
                    var list = _byChunk[ny * _cw + nx]; if (list == null) continue;
                    for (int i = 0; i < list.Count; i++)
                    { var c = list[i]; Sweep(cover, win, win, ox, oy, c.X0, c.Y0, c.X1, c.Y1, new Vector2(c.Sx, c.Sy), c.Strength); }
                }
            Soften(cover, win, win);
            int gx0 = cx * ChunkTiles * TexelsPerTile, gy0 = cy * ChunkTiles * TexelsPerTile;
            int span = ChunkTiles * TexelsPerTile;
            for (int y = 0; y < span && gy0 + y < _th; y++) for (int x = 0; x < span && gx0 + x < _tw; x++)
            {
                byte v = (byte)(Mathf.Clamp01(cover[(y + pad) * win + x + pad]) * 255f + .5f);
                int gi = (gy0 + y) * _tw + gx0 + x; if (v > _px[gi]) _px[gi] = v;
            }
        }

        /// <summary>Rasterise the footprint rect swept along <paramref name="s"/> (both components >= 0) into a local window of
        /// the coverage grid whose texel (0,0) is global texel (ox, oy). 2x2 supersampled; darker near the caster.</summary>
        public static void Sweep(float[] cover, int cw, int ch, int ox, int oy, float x0, float y0, float x1, float y1, Vector2 s, float strength)
        {
            int ix0 = Mathf.Max(ox, Mathf.FloorToInt(x0 * TexelsPerTile)), iy0 = Mathf.Max(oy, Mathf.FloorToInt(y0 * TexelsPerTile));
            int ix1 = Mathf.Min(ox + cw - 1, Mathf.CeilToInt((x1 + s.x) * TexelsPerTile)), iy1 = Mathf.Min(oy + ch - 1, Mathf.CeilToInt((y1 + s.y) * TexelsPerTile));
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
                float v = acc * .25f; int i = (y - oy) * cw + (x - ox); if (v > cover[i]) cover[i] = v;
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

        public void Dispose() { if (_tex != null) { if (Application.isPlaying) Object.Destroy(_tex); else Object.DestroyImmediate(_tex); _tex = null; } }
    }
}

// Plague's own ground (presentation only): a deterministic mix of dark mud, deep grass and shallow water, laid out from tile
// coordinates by noise. Shallow water is only a look on tiles that are already walkable floor with no terrain surface, kept a
// tile away from bog (which has gameplay meaning), so it can never be mistaken for the bog hazard and never appears on wall or
// low-obstacle tiles. Walkability and every terrain effect stay the server's. The class also bakes the soft coverage planes the
// ground shader reads and acts as the surface layer for SurfaceMap (Mud, Grass, ShallowWater).
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class PlagueGround : ISurfaceLayer
    {
        public const byte None = 0, Mud = 1, Grass = 2, Water = 3;
        public readonly int W, H;
        /// <summary>Per tile: 0 not Plague floor, 1 mud, 2 grass, 3 shallow water.</summary>
        public readonly byte[] Kind;
        public int MudTiles, GrassTiles, WaterTiles;
        public int FloorTiles { get { return MudTiles + GrassTiles + WaterTiles; } }

        PlagueGround(int w, int h) { W = w; H = h; Kind = new byte[w * h]; }

        static float Field(float x, float y, int seed)
        {
            return RegionNoise.Periodic(x, y, 4096, seed) * .55f + RegionNoise.Periodic(x * 2.1f + 5f, y * 2.1f + 9f, 4096, seed + 1) * .30f
                 + RegionNoise.Periodic(x * 4.3f + 2f, y * 4.3f + 7f, 4096, seed + 2) * .15f;
        }

        /// <summary>The tile's decorative kind from position alone (before the floor and bog rules).</summary>
        public static byte Raw(int tx, int ty)
        {
            float x = tx + .5f, y = ty + .5f;
            float pool = Field(x * .075f, y * .075f, 501);
            float rn = Field(x * .045f + 31f, y * .045f + 17f, 511);
            float ridge = 1f - Mathf.Abs(2f * rn - 1f), gate = Field(x * .025f, y * .025f, 521);
            bool water = pool > .655f || (ridge > .945f && gate > .45f);
            if (water) return Water;
            return Field(x * .10f + 7f, y * .10f + 3f, 531) > .50f ? Grass : Mud;
        }

        public static PlagueGround Build(MapBlob map)
        {
            var g = new PlagueGround(map != null ? map.W : 0, map != null ? map.H : 0);
            if (map == null || map.Regions == null || map.Tiles == null) return g;
            int w = map.W, h = map.H; var tiles = map.Tiles; var regions = map.Regions; var terrain = RegionMap.EffectiveTerrain(map);
            bool dressed = RegionProps.IsDressed(map);   // the server dresses the ground: no noise water or mud of our own
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int i = y * w + x;
                if (regions[i] != (byte)RegionId.Plague || tiles[i] != MapBlob.Floor) continue;
                if (terrain != null && terrain[i] != 0) continue;
                byte k = Raw(x, y);
                if (k == Water && NearBog(terrain, w, h, x, y)) k = Mud;       // keep water visibly apart from the bog hazard
                if (dressed && k != Grass) k = Grass;
                g.Kind[i] = k;
                if (k == Mud) g.MudTiles++; else if (k == Grass) g.GrassTiles++; else g.WaterTiles++;
            }
            return g;
        }

        static bool NearBog(byte[] terrain, int w, int h, int x, int y)
        {
            if (terrain == null) return false;
            for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++)
            {
                int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                if (terrain[ny * w + nx] == (byte)TerrainKind.Bog) return true;
            }
            return false;
        }

        public byte KindAt(int tx, int ty) { return (uint)tx < (uint)W && (uint)ty < (uint)H ? Kind[ty * W + tx] : None; }

        public bool TryGet(int tx, int ty, RegionId region, out SurfaceKind kind)
        {
            byte k = KindAt(tx, ty); kind = SurfaceKind.None;
            if (k == None || region != RegionId.Plague) return false;
            kind = k == Water ? SurfaceKind.ShallowWater : k == Grass ? SurfaceKind.Grass : SurfaceKind.Mud;
            return true;
        }

        /// <summary>
        /// Coverage planes for the ground shader at <paramref name="texelsPerTile"/> texels per tile: r shallow water, g grass, b water depth
        /// (0 at the shore, 1 well inside). Soft edges come from a box blur, then every texel over a tile that is not Plague floor is
        /// cleared, so water never reaches a wall, a low obstacle, a terrain surface or another region.
        /// </summary>
        public Color32[] Bake(int texelsPerTile)
        {
            int ow = W * texelsPerTile, oh = H * texelsPerTile;
            var px = new Color32[ow * oh];
            if (FloorTiles == 0) return px;
            var water = new float[ow * oh]; var grass = new float[ow * oh]; var depth = new float[ow * oh]; var tmp = new float[ow * oh];
            for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++)
            {
                byte k = Kind[(y / texelsPerTile) * W + x / texelsPerTile];
                int i = y * ow + x; water[i] = k == Water ? 1f : 0f; grass[i] = k == Grass ? 1f : 0f;
            }
            System.Array.Copy(water, depth, water.Length);
            BlurPlane(water, tmp, ow, oh, texelsPerTile, 1); BlurPlane(grass, tmp, ow, oh, texelsPerTile, 1); BlurPlane(depth, tmp, ow, oh, texelsPerTile * 2, 2);
            for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++)
            {
                int i = y * ow + x;
                if (Kind[(y / texelsPerTile) * W + x / texelsPerTile] == None) continue;
                px[i] = new Color32((byte)(Mathf.Clamp01(water[i]) * 255f + .5f), (byte)(Mathf.Clamp01(grass[i]) * 255f + .5f), (byte)(Mathf.Clamp01(depth[i] * 1.6f) * 255f + .5f), 255);
            }
            return px;
        }

        static void BlurPlane(float[] data, float[] tmp, int w, int h, int radius, int passes)
        {
            for (int p = 0; p < passes; p++)
            {
                for (int y = 0; y < h; y++) Box(data, tmp, y * w, 1, w, radius);
                for (int x = 0; x < w; x++) Box(tmp, data, x, w, h, radius);
            }
        }
        static void Box(float[] src, float[] dst, int start, int stride, int n, int r)
        {
            float inv = 1f / (2 * r + 1), sum = 0;
            for (int i = -r; i <= r; i++) sum += src[start + Mathf.Clamp(i, 0, n - 1) * stride];
            for (int i = 0; i < n; i++)
            {
                dst[start + i * stride] = sum * inv;
                sum += src[start + Mathf.Min(i + r + 1, n - 1) * stride] - src[start + Mathf.Max(i - r, 0) * stride];
            }
        }
    }
}

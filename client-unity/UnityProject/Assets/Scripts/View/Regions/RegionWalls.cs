// Walls and low obstacles for region maps: one baked mesh per tile row and 32-tile chunk, non-empty only (all sharing one material and
// one atlas) instead of several GameObjects per tile. Row meshes keep the legacy sorting rule (order 2000 + row * 16) so
// actors still sort against walls by y. Skins come from the per-region wall style. Geometry is presentation only: the
// collision tiles still come from MapBlob and are never altered here.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class RegionWalls : System.IDisposable
    {
        public const float WallHeight = .67f;           // legacy face height in world units
        /// <summary>Row meshes are split every 32 tiles so a row of walls far off screen is culled; only non-empty chunks exist.</summary>
        public const int ChunkTiles = 32;
        const float TopHeight = .78f;                   // cap footprint (ground squash)
        public Material Material { get; private set; }
        public int RowMeshCount { get; private set; }
        public int TileCount { get; private set; }
        readonly List<Object> _owned = new List<Object>();
        readonly List<GameObject> _rows = new List<GameObject>();

        public static RegionWalls Build(Transform parent, MapBlob map, float exposure)
        {
            var w = new RegionWalls(); w.Create(parent, map, exposure); return w;
        }

        readonly List<Vector3> _v = new List<Vector3>(4096);
        readonly List<Vector2> _uv = new List<Vector2>(4096);
        readonly List<Color32> _c = new List<Color32>(4096);
        readonly List<int> _t = new List<int>(8192);

        void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 uva, Vector2 uvb, Vector2 uvc, Vector2 uvd, Color32 col)
        {
            int i = _v.Count;
            _v.Add(a); _v.Add(b); _v.Add(c); _v.Add(d); _uv.Add(uva); _uv.Add(uvb); _uv.Add(uvc); _uv.Add(uvd);
            _c.Add(col); _c.Add(col); _c.Add(col); _c.Add(col);
            _t.Add(i); _t.Add(i + 1); _t.Add(i + 2); _t.Add(i); _t.Add(i + 2); _t.Add(i + 3);
        }
        /// <summary>Axis aligned quad with the cell mapped upright (v up).</summary>
        void Rect(float x0, float y0, float x1, float y1, RegionWallAtlas.Cell cell, Color32 col)
        {
            Quad(new Vector3(x0, y0, 0), new Vector3(x1, y0, 0), new Vector3(x1, y1, 0), new Vector3(x0, y1, 0),
                new Vector2(cell.Min.x, cell.Min.y), new Vector2(cell.Max.x, cell.Min.y), new Vector2(cell.Max.x, cell.Max.y), new Vector2(cell.Min.x, cell.Max.y), col);
        }

        void Create(Transform parent, MapBlob map, float exposure)
        {
            var shader = Resources.Load<Shader>("Regions/RegionLitMesh");
            Material = new Material(shader) { name = "Roguehalla / region walls" };
            Material.SetTexture("_MainTex", RegionWallAtlas.Atlas); Material.SetFloat("_Exposure", exposure);
            _owned.Add(Material);
            var root = new GameObject("Region walls (row meshes)"); root.transform.SetParent(parent, false); _rows.Add(root);
            int w = map.W, h = map.H; var tiles = map.Tiles; var terrain = map.Terrain; var regions = map.Regions;
            var contact = RegionWallAtlas.Contact;

            bool Solid(int x, int y)
            {
                if (x < 0 || y < 0 || x >= w || y >= h) return true;
                if (tiles[y * w + x] != MapBlob.Wall) return false;
                int k = terrain != null ? terrain[y * w + x] : 0;
                return k != (int)TerrainKind.Lava && k != (int)TerrainKind.Crevasse;
            }
            int RegionOf(int x, int y)
            {
                int r = regions[y * w + x]; if (r != 0) return r;
                // Outer border tiles belong to no region: borrow the nearest region inward.
                for (int d = 1; d < 4; d++)
                {
                    int[] dx = { d, -d, 0, 0 }, dy = { 0, 0, d, -d };
                    for (int k = 0; k < 4; k++)
                    {
                        int nx = x + dx[k], ny = y + dy[k];
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h && regions[ny * w + nx] != 0) return regions[ny * w + nx];
                    }
                }
                return 6;
            }

            for (int y = 0; y < h; y++) for (int chunk = 0; chunk < w; chunk += ChunkTiles)
            {
                _v.Clear(); _uv.Clear(); _c.Clear(); _t.Clear();
                for (int x = chunk; x < Mathf.Min(w, chunk + ChunkTiles); x++)
                {
                    byte tile = tiles[y * w + x]; if (tile == MapBlob.Floor) continue;
                    int kind = terrain != null ? terrain[y * w + x] : 0;
                    if (kind == (int)TerrainKind.Lava || kind == (int)TerrainKind.Crevasse) continue;   // the ground shader draws the hazard
                    var style = kind == (int)TerrainKind.Fence ? WallStyle.Timber : RegionThemes.Get(RegionOf(x, y)).Wall;
                    var set = RegionWallAtlas.SetFor(style);
                    float hash = RegionNoise.Hash01(x, y, 5); float tint = .92f + hash * .08f;
                    var col = new Color32((byte)(255 * tint), (byte)(255 * tint), (byte)(255 * tint), 255);
                    float py = -(y + 1) * ArenaView.GroundSquash;                   // tile bottom edge in world space
                    float px0 = x, px1 = x + 1;
                    int v = (int)(RegionNoise.Hash(x, y, 9) % 97u);
                    TileCount++;
                    if (tile == MapBlob.Low)
                    {
                        // Fences and low walls: one full-width cell, joined with neighbours. Contact shadow under it.
                        Rect(px0, py - .26f, px1, py + .02f, contact, new Color32(255, 255, 255, 190));
                        Rect(px0 - .004f, py - 6f / RegionWallAtlas.TileW, px1 + .004f, py - 6f / RegionWallAtlas.TileW + RegionWallAtlas.LowH / (float)RegionWallAtlas.TileW,
                            set.Low[v % RegionWallAtlas.LowVariants], col);
                        continue;
                    }
                    bool southSolid = Solid(x, y + 1);
                    if (!southSolid)
                    {
                        Rect(px0 - .04f, py - .30f, px1 + .04f, py + .04f, contact, new Color32(255, 255, 255, 255));
                        Rect(px0 - .003f, py, px1 + .003f, py + WallHeight + .02f, set.Face[v % RegionWallAtlas.FaceVariants], col);
                    }
                    float ty0 = py + WallHeight, ty1 = ty0 + TopHeight;
                    Rect(px0 - .003f, ty0, px1 + .003f, ty1, set.Top[(v / 3) % RegionWallAtlas.TopVariants], col);
                    var rim = set.Rim; const float rimW = .085f;
                    var white = new Color32(255, 255, 255, 255);
                    if (!Solid(x, y - 1))   // north edge: strong at the outer edge
                        Quad(new Vector3(px0, ty1 - rimW, 0), new Vector3(px1, ty1 - rimW, 0), new Vector3(px1, ty1, 0), new Vector3(px0, ty1, 0),
                            new Vector2(rim.Max.x, rim.Max.y), new Vector2(rim.Min.x, rim.Max.y), new Vector2(rim.Min.x, rim.Min.y), new Vector2(rim.Max.x, rim.Min.y), white);
                    if (!Solid(x - 1, y))   // west edge
                        Quad(new Vector3(px0, ty0, 0), new Vector3(px0 + rimW, ty0, 0), new Vector3(px0 + rimW, ty1, 0), new Vector3(px0, ty1, 0),
                            new Vector2(rim.Min.x, rim.Min.y), new Vector2(rim.Min.x, rim.Max.y), new Vector2(rim.Max.x, rim.Max.y), new Vector2(rim.Max.x, rim.Min.y), white);
                    if (!Solid(x + 1, y))   // east edge
                        Quad(new Vector3(px1 - rimW, ty0, 0), new Vector3(px1, ty0, 0), new Vector3(px1, ty1, 0), new Vector3(px1 - rimW, ty1, 0),
                            new Vector2(rim.Min.x, rim.Max.y), new Vector2(rim.Min.x, rim.Min.y), new Vector2(rim.Max.x, rim.Min.y), new Vector2(rim.Max.x, rim.Max.y), white);
                }
                if (_v.Count == 0) continue;
                var mesh = new Mesh { name = "Region walls row " + y + " chunk " + chunk / ChunkTiles, indexFormat = UnityEngine.Rendering.IndexFormat.UInt16 };
                mesh.SetVertices(_v); mesh.SetUVs(0, _uv); mesh.SetColors(_c); mesh.SetTriangles(_t, 0); mesh.RecalculateBounds();
                _owned.Add(mesh);
                var go = new GameObject("Walls row " + y + " x" + chunk); go.transform.SetParent(root.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = Material; mr.sortingOrder = 2000 + y * 16;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false;
                mr.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off; mr.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
                go.isStatic = true; _rows.Add(go); RowMeshCount++;
            }
        }

        public void Dispose()
        {
            foreach (var o in _owned) if (o != null) RegionUtil.Kill(o);
            _owned.Clear();
            foreach (var g in _rows) if (g != null) RegionUtil.Kill(g);
            _rows.Clear();
        }
    }
}

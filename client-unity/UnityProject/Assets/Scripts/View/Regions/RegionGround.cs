// Region ground: ONE quad covering the whole map, drawn by Roguehalla/RegionGround in a single pass (one draw call). The
// per-tile region and terrain planes from the public map are baked once into a few small blurred weight textures; the shader
// blends the six regions with ragged borders and paints terrain surfaces. No GameObject per tile, nothing allocates per frame.
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class RegionGround : System.IDisposable
    {
        public const int RegionTexelsPerTile = 2, TerrainTexelsPerTile = 4;
        public const int GroundSortingOrder = -100;

        readonly System.Collections.Generic.List<Object> _owned = new System.Collections.Generic.List<Object>();
        public Material Material { get; private set; }
        public GameObject Root { get; private set; }

        public static RegionGround Create(Transform parent, MapBlob map, float exposure, TempleLayout temple = null, PlagueGround plague = null)
        {
            var g = new RegionGround();
            g.Build(parent, map, exposure, temple ?? TempleLayout.For(map), plague ?? PlagueGround.Build(map));
            return g;
        }

        void Build(Transform parent, MapBlob map, float exposure, TempleLayout temple, PlagueGround plague)
        {
            var shader = Resources.Load<Shader>("Regions/RegionGround");
            Material = new Material(shader) { name = "Roguehalla / region ground" };
            _owned.Add(Material);

            var ground = RegionGroundTextures.Build(out var groundNormals); _owned.Add(ground); _owned.Add(groundNormals);
            Material.SetTexture("_GroundTex", ground); Material.SetTexture("_GroundNrm", groundNormals);

            int w = map.W, h = map.H;
            var regionA = new Color32[w * RegionTexelsPerTile * h * RegionTexelsPerTile];
            var regionB = new Color32[regionA.Length];
            BakeRegions(map.Regions, w, h, regionA, regionB, temple);
            var regTexA = Tex("Region weights A", w * RegionTexelsPerTile, h * RegionTexelsPerTile, regionA);
            var regTexB = Tex("Region weights B", w * RegionTexelsPerTile, h * RegionTexelsPerTile, regionB);
            Material.SetTexture("_RegA", regTexA); Material.SetTexture("_RegB", regTexB);
            // The walls, props and the one-sun term read the same blurred weights through globals (RhSun.hlsl).
            Shader.SetGlobalTexture("_RhRegA", regTexA); Shader.SetGlobalTexture("_RhRegB", regTexB);
            // w = 1 when a temple exists: the region texture's alpha then carries the temple interior weight (RhSun.hlsl).
            Shader.SetGlobalVector("_RhMapInfo", new Vector4(w, h, ArenaView.GroundSquash, temple != null && temple.Found ? 1f : 0f));

            int tw = w * TerrainTexelsPerTile, th = h * TerrainTexelsPerTile;
            var terA = new Color32[tw * th]; var terB = new Color32[tw * th];
            BakeTerrain(RegionMap.EffectiveTerrain(map), w, h, terA, terB);
            Material.SetTexture("_TerA", Tex("Terrain A", tw, th, terA));
            Material.SetTexture("_TerB", Tex("Terrain B", tw, th, terB));

            // Plague mud, grass and shallow water (r water, g grass, b depth), 2 texels per tile.
            const int plgTexels = 2;
            Material.SetTexture("_PlgTex", Tex("Plague ground", w * plgTexels, h * plgTexels, plague.Bake(plgTexels)));
            // Temple: footprint (x0, y0, size, found); great crossing, light count and apse radius; portals and apse edge; the stone; lamp and brazier pools; pier presence per tile.
            bool hasTemple = temple != null && temple.Found;
            Material.SetVector("_Temple", hasTemple ? new Vector4(temple.X0, temple.Y0, temple.Size, 1f) : Vector4.zero);
            var lights = new Vector4[16]; int nl = 0;
            if (hasTemple)
            {
                foreach (var bz in temple.Braziers) if (nl < 16) lights[nl++] = new Vector4(bz.x, bz.y, 1f, 1f);
                foreach (var lp in temple.Lamps) if (nl < 16) lights[nl++] = new Vector4(lp.x, lp.y, 1f, 2f);
            }
            Material.SetVector("_TempleInfo", hasTemple ? new Vector4(temple.CenterX, temple.CenterY, nl, temple.ApseRadius) : Vector4.zero);
            Material.SetVector("_TempleGrid", hasTemple
                ? new Vector4(temple.Portals[0].Open ? temple.Portals[0].Axis : -999f, temple.Portals[1].Open ? temple.Portals[1].Axis : -999f, temple.Portals[2].Open ? temple.Portals[2].Axis : -999f, temple.ApseRadius > 0f ? temple.ApseY : -999f)
                : new Vector4(-999f, -999f, -999f, -999f));
            var stone = TempleStyle.Stone.linear; Material.SetVector("_TempleStone", new Vector4(stone.r, stone.g, stone.b, 1f));
            Material.SetVectorArray("_TempleBraz", lights);
            var pier = new Color32[w * h];
            if (hasTemple) for (int ty = 0; ty < h; ty++) for (int tx = 0; tx < w; tx++) if (temple.TryBlock(tx, ty, out _, out _)) pier[ty * w + tx] = new Color32(255, 0, 0, 255);
            var pierTex = new Texture2D(w, h, TextureFormat.RGBA32, false, true) { name = "Temple piers", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Point };
            pierTex.SetPixelData(pier, 0); pierTex.Apply(false, true); _owned.Add(pierTex);
            Material.SetTexture("_TempleTex", pierTex);
            // Server ground variants, one texture twice as wide as the map: texel 2x of a row is tile x's crisp texel (rgb gain, a strength; the Sentenced scatter and every Tile-edge variant),
            // texel 2x + 1 is its soft gain (the bands; the shader blends four of them by hand, so the plane needs no sampler of its own and no extra texture). Both read through the point sampler.
            var vin = BakeVariantInputs(map);
            var variantTex = new Texture2D(w * 2, h, TextureFormat.RGBA32, false, true) { name = "Ground variants", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Point };
            var variantPx = new Color32[w * 2 * h];
            for (int i = 0; i < w * h; i++) { variantPx[i * 2] = vin.Tile[i]; variantPx[i * 2 + 1] = vin.Soft[i]; }
            variantTex.SetPixelData(variantPx, 0); variantTex.Apply(false, true); _owned.Add(variantTex);
            Material.SetTexture("_VariantTex", variantTex);
            // On only when some tile carries a tint (a plane of zeros costs no extra sample); the soft path (the bands' blend and warp) only when a band exists.
            bool anyVariant = vin.SoftActive; for (int i = 0; i < vin.Tile.Length && !anyVariant; i++) if (vin.Tile[i].a != 0) anyVariant = true;
            Material.SetFloat("_VariantOn", anyVariant ? 1f : 0f);
            Material.SetFloat("_VariantSoft", vin.SoftActive ? 1f : 0f);
            Material.SetVector("_Coliseum", ColiseumBounds(map.Regions, w, h));

            Material.SetVector("_Map", new Vector4(w, h, ArenaView.GroundSquash, 0));
            Material.SetFloat("_Exposure", exposure);
            UploadPalette();

            Root = new GameObject("Region ground (1 quad)");
            Root.transform.SetParent(parent, false);
            var mesh = new Mesh { name = "Region ground quad" };
            float x1 = w, y1 = -h * ArenaView.GroundSquash;
            mesh.vertices = new[] { new Vector3(0, 0, 0), new Vector3(x1, 0, 0), new Vector3(x1, y1, 0), new Vector3(0, y1, 0) };
            mesh.uv = new[] { Vector2.zero, Vector2.right, Vector2.one, Vector2.up };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.bounds = new Bounds(new Vector3(x1 / 2, y1 / 2, 0), new Vector3(x1, -y1, 1));
            _owned.Add(mesh);
            Root.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = Root.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Material; mr.sortingOrder = GroundSortingOrder;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false;
            mr.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off; mr.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
        }

        /// <summary>One texel per tile (row-major, w * h), the ground-variant look the shader applies to the base ground: rgb the tint, a its strength (0 = base ground), as decided by <see cref="Roguehalla.Net.Ui.GroundTint.Bake"/> (the server's variant, plus the Sentenced scatter family). Variant 0 on a tile without a scatter family and an unknown variant bake 0; an unknown variant logs once per call.</summary>
        public static Color32[] BakeVariants(MapBlob map)
        {
            int w = map.W, h = map.H; var px = new Color32[w * h];
            var plane = map.GroundVariants; bool hasPlane = plane != null && plane.Length == w * h;   // a map without a plane can still carry the Sentenced scatter
            bool hasRegions = map.Regions != null && map.Regions.Length == px.Length;
            System.Collections.Generic.HashSet<byte> warned = null;
            for (int i = 0; i < px.Length; i++)
            {
                byte v = hasPlane ? plane[i] : (byte)0;
                int region = hasRegions ? map.Regions[i] : 0;
                if (Roguehalla.Net.Ui.GroundTint.Bake(region, v, i % w, i / w, out var t))
                    px[i] = new Color32(t.R, t.G, t.B, (byte)Mathf.RoundToInt(Mathf.Clamp01(t.Strength) * 255f));
                else if (v != 0 && (v > 8 || region >= 1 && region <= 5))
                {
                    if (warned == null) warned = new System.Collections.Generic.HashSet<byte>();
                    if (warned.Add(v)) Debug.LogWarning("RegionGround: unknown ground variant " + v + " draws the base ground");
                }
            }
            return px;
        }

        /// <summary>What the variant path of the ground shader reads for a map, in a form the engine-free tests can sample (P-UNITY-GROUND-BANDS-1). STUB: the soft part does not exist yet;
        /// <see cref="GroundVariantInputs.Tile"/> is today's whole plane and the soft gain is neutral everywhere.</summary>
        public static GroundVariantInputs BakeVariantInputs(MapBlob map)
        {
            int w = map.W, h = map.H; var tile = BakeVariants(map); var soft = new Color32[w * h];
            var plane = map.GroundVariants; bool hasPlane = plane != null && plane.Length == w * h;
            bool hasRegions = map.Regions != null && map.Regions.Length == tile.Length;
            var terrain = RegionMap.EffectiveTerrain(map);
            var isSoft = new bool[w * h]; bool any = false;
            var neutral = new Color32(Roguehalla.Net.Ui.GroundTint.NeutralByte, Roguehalla.Net.Ui.GroundTint.NeutralByte, Roguehalla.Net.Ui.GroundTint.NeutralByte, 255);
            for (int i = 0; i < soft.Length; i++)
            {
                soft[i] = neutral;
                int region = hasRegions ? map.Regions[i] : 0; byte v = hasPlane ? plane[i] : (byte)0;
                if (Roguehalla.Net.Ui.GroundVariantLook.EdgeOf(region, v) != Roguehalla.Net.Ui.GroundVariantEdge.Soft) continue;
                Roguehalla.Net.Ui.GroundVariantLook.TryGet(region, v, out var look);
                var g = Roguehalla.Net.Ui.GroundTint.Apply(1f, 1f, 1f, look);
                soft[i] = new Color32(GainByte(g[0]), GainByte(g[1]), GainByte(g[2]), 255); isSoft[i] = true; any = true;
                // The band's part leaves the crisp plane; the scatter family (Sentenced) stays there as today.
                tile[i] = Roguehalla.Net.Ui.GroundTint.Bake(region, 0, i % w, i / w, out var fam)
                    ? new Color32(fam.R, fam.G, fam.B, (byte)Mathf.RoundToInt(Mathf.Clamp01(fam.Strength) * 255f)) : default(Color32);
            }
            if (any && terrain != null && terrain.Length == w * h)
            {
                // A terrain tile (bog, lava, ice) carries no variant: it takes the mean gain of the band tiles round it, so the band does not fade under the terrain's own soft edge.
                var fill = new System.Collections.Generic.List<(int, Color32)>();
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                {
                    int i = y * w + x; if (isSoft[i] || terrain[i] == 0) continue;
                    int n = 0, r = 0, gg = 0, b = 0;
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                    {
                        int xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !isSoft[yy * w + xx]) continue;
                        var c = soft[yy * w + xx]; r += c.r; gg += c.g; b += c.b; n++;
                    }
                    if (n > 0) fill.Add((i, new Color32((byte)(r / n), (byte)(gg / n), (byte)(b / n), 255)));
                }
                foreach (var (i, c) in fill) soft[i] = c;
            }
            return new GroundVariantInputs { Width = w, Height = h, Tile = tile, Soft = soft, SoftActive = any };
        }

        static byte GainByte(float gain) { return (byte)Mathf.Clamp(Mathf.RoundToInt(gain * 128f), 0, 255); }

        Texture2D Tex(string name, int w, int h, Color32[] px)
        {
            var t = new Texture2D(w, h, TextureFormat.RGBA32, false, true) { name = name, wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            t.SetPixelData(px, 0); t.Apply(false, true); _owned.Add(t);
            return t;
        }

        void UploadPalette()
        {
            var b = new Vector4[8]; var s = new Vector4[8]; var a = new Vector4[8]; var keys = new Vector4[8]; var p = new Vector4[8]; var p2 = new Vector4[8];
            for (int id = 0; id < RegionThemes.RegionCount; id++)
            {
                var th = RegionThemes.Get(id);
                b[id] = th.Base; s[id] = th.Secondary; a[id] = th.Accent; keys[id] = th.Key; p[id] = th.GroundParams; p2[id] = th.GroundParams2;
            }
            Material.SetVectorArray("_PalBase", b); Material.SetVectorArray("_PalSec", s); Material.SetVectorArray("_PalAcc", a); Material.SetVectorArray("_PalKey", keys);
            Material.SetVectorArray("_PalPar", p); Material.SetVectorArray("_PalPar2", p2);
            var deep = new Vector4[8]; var light = new Vector4[8]; var glow = new Vector4[8];
            for (int k = 0; k < 8; k++) { var look = RegionThemes.TerrainLookOf(k); deep[k] = look.Deep; light[k] = look.Light; glow[k] = look.Glow; }
            Material.SetVectorArray("_TerDeep", deep); Material.SetVectorArray("_TerLight", light); Material.SetVectorArray("_TerGlow", glow);
        }

        // ---- baking -------------------------------------------------------------------------------------------------

        /// <summary>Region weights, 2 texels per tile, blurred about 1.5 tiles; tiles with region 0 (the outer border) donate nothing.</summary>
        /// <summary>Centre (x, y) and half extent (tiles) of the coliseum square, from the region plane; w = 1 when found.</summary>
        public static Vector4 ColiseumBounds(byte[] regions, int w, int h)
        {
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
            for (int i = 0; i < regions.Length; i++) if (regions[i] == (byte)RegionId.Coliseum) { int x = i % w, y = i / w; x0 = Mathf.Min(x0, x); y0 = Mathf.Min(y0, y); x1 = Mathf.Max(x1, x); y1 = Mathf.Max(y1, y); }
            if (x1 < 0) return Vector4.zero;
            return new Vector4((x0 + x1 + 1) * .5f, (y0 + y1 + 1) * .5f, Mathf.Max(x1 - x0 + 1, y1 - y0 + 1) * .5f, 1f);
        }

        static void BakeRegions(byte[] regions, int w, int h, Color32[] a, Color32[] b, TempleLayout temple)
        {
            int ow = w * RegionTexelsPerTile, oh = h * RegionTexelsPerTile;
            var valid = new float[ow * oh]; var chan = new float[ow * oh]; var tmp = new float[ow * oh];
            for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++)
                valid[y * ow + x] = regions[(y / RegionTexelsPerTile) * w + x / RegionTexelsPerTile] != 0 ? 1f : 0f;
            Blur(valid, tmp, ow, oh, 3, 3);
            for (int k = 0; k < 6; k++)
            {
                byte id = (byte)(k + 1);
                for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++)
                    chan[y * ow + x] = regions[(y / RegionTexelsPerTile) * w + x / RegionTexelsPerTile] == id ? 1f : 0f;
                Blur(chan, tmp, ow, oh, 3, 3);
                for (int i = 0; i < chan.Length; i++)
                {
                    byte v = (byte)(Mathf.Clamp01(chan[i] / Mathf.Max(valid[i], 1e-4f)) * 255f + .5f);
                    if (k < 4) { var c = a[i]; if (k == 0) c.r = v; else if (k == 1) c.g = v; else if (k == 2) c.b = v; else c.a = v; a[i] = c; }
                    else { var c = b[i]; if (k == 4) c.r = v; else c.g = v; c.a = 0; b[i] = c; }
                }
            }
            // Greenery pocket mask rides in B of the second texture; the temple interior weight rides in A.
            bool hasTemple = temple != null && temple.Found;
            for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++)
            {
                var c = b[y * ow + x]; c.b = (byte)(RegionPocket.At((x + .5f) / RegionTexelsPerTile, (y + .5f) / RegionTexelsPerTile) * 255f + .5f);
                c.a = hasTemple ? (byte)(temple.WeightAt((x + .5f) / RegionTexelsPerTile, (y + .5f) / RegionTexelsPerTile) * 255f + .5f) : (byte)0; b[y * ow + x] = c;
            }
        }

        /// <summary>Terrain coverage, 4 texels per tile, blurred about half a tile: lava, ice, bog, ember | light, crevasse.</summary>
        static void BakeTerrain(byte[] terrain, int w, int h, Color32[] a, Color32[] b)
        {
            int ow = w * TerrainTexelsPerTile, oh = h * TerrainTexelsPerTile;
            if (terrain == null) return;
            var chan = new float[ow * oh]; var tmp = new float[ow * oh];
            // kind -> (texture, channel)
            int[] kinds = { (int)TerrainKind.Lava, (int)TerrainKind.Ice, (int)TerrainKind.Bog, (int)TerrainKind.Ember, (int)TerrainKind.Light, (int)TerrainKind.Crevasse };
            for (int k = 0; k < kinds.Length; k++)
            {
                bool any = false;
                for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++)
                {
                    bool on = terrain[(y / TerrainTexelsPerTile) * w + x / TerrainTexelsPerTile] == kinds[k];
                    chan[y * ow + x] = on ? 1f : 0f; any |= on;
                }
                if (!any) continue;
                Blur(chan, tmp, ow, oh, 2, 2);
                for (int i = 0; i < chan.Length; i++)
                {
                    byte v = (byte)(Mathf.Clamp01(chan[i]) * 255f + .5f);
                    if (k < 4) { var c = a[i]; if (k == 0) c.r = v; else if (k == 1) c.g = v; else if (k == 2) c.b = v; else c.a = v; a[i] = c; }
                    else { var c = b[i]; if (k == 4) c.r = v; else c.g = v; b[i] = c; }
                }
            }
        }

        /// <summary>Separable box blur repeated <paramref name="passes"/> times (approximates a Gaussian); clamps at the edges.</summary>
        static void Blur(float[] data, float[] tmp, int w, int h, int radius, int passes)
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

        public void Dispose()
        {
            foreach (var o in _owned) if (o != null) RegionUtil.Kill(o);
            _owned.Clear();
            if (Root != null) RegionUtil.Kill(Root);
        }
    }

    /// <summary>The CPU's description of the variant inputs the ground shader samples (P-UNITY-GROUND-BANDS-1). Tile coordinates: tile (x, y) covers [x, x + 1) x [y, y + 1).
    /// <see cref="Tile"/> is the crisp plane, one texel per tile (rgb a gain with byte 128 neutral, a its strength; GroundTint's formula): the Tile-edge variants and the Sentenced scatter family.
    /// <see cref="SoftGainAt"/> is what every Soft-edge variant contributes at a point, as a per-channel gain (1 = none): its coverage fades across the band's boundary and blends the GAINS of
    /// neighbouring bands, never their codes. <see cref="GainAt"/> is the product the shader applies to the ground before its edge noise; the tests read only these two methods and
    /// <see cref="SoftActive"/>, so how the soft part is stored (a finer plane, a distance field) is the implementation's choice.</summary>
    public sealed class GroundVariantInputs
    {
        public int Width, Height;
        public Color32[] Tile;
        /// <summary>True when the map has at least one Soft-edge tile (the shader then needs the soft path); false for a map with only Tile variants, the scatter, or none.</summary>
        public bool SoftActive;
        /// <summary>The soft part: one texel per tile (rgb a gain, byte 128 neutral), texel centres at tile centres, blended bilinearly by the shader (after its ragged warp, which the CPU leaves out).</summary>
        public Color32[] Soft;

        /// <summary>The soft part's gain at a point (tile coordinates, bilinear as the shader samples it); (1, 1, 1) where no soft band reaches.</summary>
        public Vector3 SoftGainAt(float tx, float ty)
        {
            if (Soft == null) return Vector3.one;
            float u = tx - .5f, v = ty - .5f; int i = Mathf.FloorToInt(u), j = Mathf.FloorToInt(v); float fx = u - i, fy = v - j;
            Vector3 At(int x, int y) { var c = Soft[Mathf.Clamp(y, 0, Height - 1) * Width + Mathf.Clamp(x, 0, Width - 1)]; return new Vector3(c.r, c.g, c.b) / 128f; }
            return Vector3.Lerp(Vector3.Lerp(At(i, j), At(i + 1, j), fx), Vector3.Lerp(At(i, j + 1), At(i + 1, j + 1), fx), fy);
        }

        /// <summary>The Tile texel's gain at the tile containing the point, times <see cref="SoftGainAt"/>: what the shader multiplies the ground by (before its edge noise).</summary>
        public Vector3 GainAt(float tx, float ty)
        {
            int x = Mathf.Clamp(Mathf.FloorToInt(tx), 0, Width - 1), y = Mathf.Clamp(Mathf.FloorToInt(ty), 0, Height - 1);
            var c = Tile[y * Width + x]; float a = c.a / 255f;
            var t = new Vector3(1f + a * (c.r / 128f - 1f), 1f + a * (c.g / 128f - 1f), 1f + a * (c.b / 128f - 1f));
            var s = SoftGainAt(tx, ty);
            return new Vector3(t.x * s.x, t.y * s.y, t.z * s.z);
        }
    }
}

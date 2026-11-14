using System.Collections.Generic;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-4: the Plague bog tree (kind 3), painted procedurally once per map from the tiles the framework classified (no copy of the
    /// drawing, so it is right in all eight orientations). The wall tiles form groups (8-connected): the largest is the trunk with the roots that touch
    /// it, every other one is a free stump. Pieces:
    ///  - "Bog tree trunk": one bark mass, rendered from a height field (depth = distance to the nearest non-wall tile: the deep core is a bole that
    ///    rises round and lighter to the north west, the shallow arms are low roots) by marching each pixel down the oblique view; one strip per tile row
    ///    on the walls' sorting rule. The bark is opaque over every wall tile of the group to its exact square and a little higher than the wall block,
    ///    so the blocks RegionWalls still draws never show at an edge (the cave's look note); a dark wet flare hugs the root bases on the ground;
    ///  - "Bog tree stump": each free group as a low broken stump with a pale split top;
    ///  - the canopy (the roof, through Landmark.AddRoofRenderer): a crown of clumped leaves lifted above the cover, with darker gaps, an edge that
    ///    follows the cover's outline and hanging moss at the rim. The cover (handed over with Landmark.SetCover) is the trunk group's tiles plus every
    ///    dry floor tile (floor that is not Bog) whose centre is within Euclidean distance 3 of a trunk tile (dx*dx + dy*dy &lt;= 9). The crown is
    ///    lifted, so its lower edge sits above the ground it covers and never hangs over the bog.
    /// Nothing opaque is drawn on bog tiles away from the bark. Colours are sRGB from the Plague theme, as the region atlas.
    /// </summary>
    public static class BogTreeLandmark
    {
        public const string TrunkName = "Bog tree trunk", StumpName = "Bog tree stump";
        const int Ppt = 16;                                       // texture pixels per tile
        const float Sq = ArenaView.GroundSquash;
        const float RootH = .72f, BoleH = 1.75f;                   // world units; RootH clears the wall blocks (face .67)
        const float Dz = .03f;
        const int CoverRadiusSquared = 9;
        static readonly Color Ink = new Color(.05f, .05f, .04f);

        public static void Build(Landmark lm)
        {
            var g = new Grid(lm);
            if (g.Groups == 0) return;
            var cover = new bool[g.W * g.H];
            MakeCover(lm, g, cover);
            var tiles = new List<MapTile>();
            for (int y = 0; y < g.H; y++) for (int x = 0; x < g.W; x++) if (cover[y * g.W + x]) tiles.Add(new MapTile((ushort)(lm.FootX + x), (ushort)(lm.FootY + y)));
            lm.SetCover(tiles);
            for (int k = 0; k < g.Groups; k++) PaintBark(lm, g, new Field(g, k), k == 0 ? TrunkName : StumpName, k != 0);
            PaintCanopy(lm, g, cover);
        }

        // ---- the tiles of the footprint, read once --------------------------------------------------------------------------------

        sealed class Grid
        {
            public readonly int W, H; public readonly bool[] Wall; public readonly int[] Group; public int Groups;
            public readonly Landmark Lm;
            public Grid(Landmark lm)
            {
                Lm = lm; W = lm.FootW; H = lm.FootH; Wall = new bool[W * H]; Group = new int[W * H];
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) Wall[y * W + x] = lm.IsWall(lm.FootX + x, lm.FootY + y);
                var label = new int[W * H]; for (int i = 0; i < label.Length; i++) label[i] = -1;
                var sizes = new List<int>(); var stack = new Stack<int>();
                for (int s = 0; s < Wall.Length; s++)
                {
                    if (!Wall[s] || label[s] >= 0) continue;
                    int id = sizes.Count, n = 0; label[s] = id; stack.Push(s);
                    while (stack.Count > 0)
                    {
                        int t = stack.Pop(); n++; int tx = t % W, ty = t / W;
                        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                        {
                            int nx = tx + dx, ny = ty + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                            int ni = ny * W + nx; if (Wall[ni] && label[ni] < 0) { label[ni] = id; stack.Push(ni); }
                        }
                    }
                    sizes.Add(n);
                }
                Groups = sizes.Count;
                int big = 0; for (int i = 1; i < sizes.Count; i++) if (sizes[i] > sizes[big]) big = i;
                for (int i = 0; i < label.Length; i++)           // the trunk is group 0, the others keep their order
                    Group[i] = label[i] < 0 ? -1 : label[i] == big ? 0 : label[i] < big ? label[i] + 1 : label[i];
            }
        }

        static void MakeCover(Landmark lm, Grid g, bool[] cover)
        {
            for (int y = 0; y < g.H; y++) for (int x = 0; x < g.W; x++)
            {
                if (g.Group[y * g.W + x] != 0) continue;
                cover[y * g.W + x] = true;
                for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++)
                {
                    int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H || dx * dx + dy * dy > CoverRadiusSquared) continue;
                    int gx = lm.FootX + nx, gy = lm.FootY + ny;
                    if (!lm.IsWall(gx, gy) && !lm.IsLow(gx, gy) && lm.Terrain(gx, gy) != (byte)TerrainKind.Bog) cover[ny * g.W + nx] = true;
                }
            }
        }

        static float Smooth(float t) { t = Mathf.Clamp01(t); return t * t * (3f - 2f * t); }
        static float SmoothStep(float a, float b, float x) { return Smooth((x - a) / (b - a)); }
        static float RectDist(float u, float v, int tx, int ty)
        {
            float dx = Mathf.Max(Mathf.Max(tx - u, 0f), u - (tx + 1)), dy = Mathf.Max(Mathf.Max(ty - v, 0f), v - (ty + 1));
            return Mathf.Sqrt(dx * dx + dy * dy);
        }

        // ---- the height field of one wall group -----------------------------------------------------------------------------------------

        /// <summary>The bark's surface over one group: a height per tile (deep tiles high), smoothed between tile centres over the group's own tiles.</summary>
        sealed class Field
        {
            const int Pad = 1;
            public readonly Grid G; public readonly int Id; public readonly bool Stump;
            public int MinX = int.MaxValue, MinY = int.MaxValue, MaxX = -1, MaxY = -1; public float MaxH, MaxDepth, Cu, Cv;
            readonly int _gw, _gh; readonly float[] _num, _den, _dnum;
            public Field(Grid g, int id)
            {
                G = g; Id = id; Stump = id != 0; int W = g.W, H = g.H;
                var depth = new float[W * H]; var open = new List<int>();
                for (int i = 0; i < g.Group.Length; i++) if (g.Group[i] != id) open.Add(i);
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
                {
                    int i = y * W + x; if (g.Group[i] != id) continue;
                    MinX = Mathf.Min(MinX, x); MaxX = Mathf.Max(MaxX, x); MinY = Mathf.Min(MinY, y); MaxY = Mathf.Max(MaxY, y);
                    float best = Mathf.Min(Mathf.Min(x + 1, W - x), Mathf.Min(y + 1, H - y)); best *= best;
                    foreach (int o in open) { int dx = o % W - x, dy = o / W - y; best = Mathf.Min(best, dx * dx + dy * dy); }
                    depth[i] = Mathf.Sqrt(best); MaxDepth = Mathf.Max(MaxDepth, depth[i]);
                }
                float sx = 0, sy = 0, sw = 0;                    // the bole's centre: the deep tiles' centroid
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
                {
                    int i = y * W + x; if (g.Group[i] != id) continue;
                    float w = Stump ? 1f : Mathf.Max(0f, depth[i] - .7f * MaxDepth); if (w <= 0) continue;
                    sx += (x + .5f) * w; sy += (y + .5f) * w; sw += w;
                }
                Cu = sw > 0 ? sx / sw : MinX + .5f; Cv = sw > 0 ? sy / sw : MinY + .5f;
                _gw = W + 2 * Pad; _gh = H + 2 * Pad; _num = new float[_gw * _gh]; _den = new float[_gw * _gh]; _dnum = new float[_gw * _gh];
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
                {
                    int i = y * W + x; if (g.Group[i] != id) continue;
                    float h = TileHeight(x, y, depth[i]); MaxH = Mathf.Max(MaxH, h);
                    int gi = (y + Pad) * _gw + x + Pad; _num[gi] = h; _den[gi] = 1f; _dnum[gi] = depth[i];
                }
            }

            float TileHeight(int x, int y, float d)
            {
                if (Stump)                                       // a broken stump: low, the top uneven
                    return RootH + .06f + .26f * RegionNoise.Hash01(x + 31 * Id, y, 41);
                float s0 = Smooth((d - 1.2f) / Mathf.Max(.5f, MaxDepth - 2.4f));
                float nw = Mathf.Clamp(((Cu - (x + .5f)) + (Cv - (y + .5f))) / Mathf.Max(1f, MaxDepth), -1f, 1f);
                float h = RootH + .12f * Mathf.Clamp01((d - 1f) / 1.5f) + (BoleH - RootH - .12f) * Mathf.Pow(s0, .6f) + .3f * s0 * nw;
                return Mathf.Max(RootH, h);
            }

            public bool In(int x, int y) { return x >= 0 && y >= 0 && x < G.W && y < G.H && G.Group[y * G.W + x] == Id; }

            float Bilin(float[] a, float u, float v)
            {
                float gx = u - .5f + Pad, gy = v - .5f + Pad; int x0 = Mathf.FloorToInt(gx), y0 = Mathf.FloorToInt(gy);
                if (x0 < 0 || y0 < 0 || x0 + 1 >= _gw || y0 + 1 >= _gh) return 0f;
                float fx = gx - x0, fy = gy - y0;
                return Mathf.Lerp(Mathf.Lerp(a[y0 * _gw + x0], a[y0 * _gw + x0 + 1], fx), Mathf.Lerp(a[(y0 + 1) * _gw + x0], a[(y0 + 1) * _gw + x0 + 1], fx), fy);
            }

            /// <summary>Smooth surface height at footprint-local tile coordinates (u east, v south), even a little beyond the group (for slopes).</summary>
            public float HSmooth(float u, float v)
            {
                float d = Bilin(_den, u, v); return d > .02f ? Mathf.Max(RootH, Bilin(_num, u, v) / d) : RootH;
            }
            /// <summary>The height of the bark standing over the point; 0 where the group has no tile.</summary>
            public float H(float u, float v) { return In(Mathf.FloorToInt(u), Mathf.FloorToInt(v)) ? HSmooth(u, v) : 0f; }
            public float DepthAt(float u, float v) { float d = Bilin(_den, u, v); return d > .02f ? Bilin(_dnum, u, v) / d : 0f; }

            /// <summary>Distance from a point inside the group to the nearest tile that is not the group's (0 at its edge).</summary>
            public float EdgeDist(float u, float v)
            {
                int tx = Mathf.FloorToInt(u), ty = Mathf.FloorToInt(v); float best = 9f;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                    if (!In(tx + dx, ty + dy)) best = Mathf.Min(best, RectDist(u, v, tx + dx, ty + dy));
                return best;
            }
            /// <summary>Distance from a point outside the group to its nearest tile (9 when none is near).</summary>
            public float GroundDist(float u, float v)
            {
                int tx = Mathf.FloorToInt(u), ty = Mathf.FloorToInt(v); float best = 9f;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                    if (In(tx + dx, ty + dy)) best = Mathf.Min(best, RectDist(u, v, tx + dx, ty + dy));
                return best;
            }
        }

        static Texture2D NewTexture(Landmark lm, int w, int h, string name)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false, false) { name = name, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            lm.Own(tex); return tex;
        }

        static SpriteRenderer NewSprite(Landmark lm, Transform parent, Texture2D tex, string name, Vector3 position, int order)
        {
            var sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), Vector2.zero, Ppt, 0, SpriteMeshType.FullRect);
            lm.Own(sprite);
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = sprite; sr.sharedMaterial = lm.Material; sr.sortingOrder = order;
            return sr;
        }

        // ---- the bark: one height field, marched pixel by pixel ----------------------------------------------------------------------------

        static void PaintBark(Landmark lm, Grid g, Field f, string name, bool stump)
        {
            var theme = RegionThemes.Get(RegionId.Plague);
            var pal = new Palette(theme);
            int c0 = Mathf.Max(0, f.MinX - 1), c1 = Mathf.Min(g.W, f.MaxX + 2), r0 = Mathf.Max(0, f.MinY - 1), r1 = Mathf.Min(g.H - 1, f.MaxY + 1);
            float zMax = f.MaxH + .05f, sBottom = -(r1 + 1) * Sq, sTop = -r0 * Sq + zMax;
            int W = (c1 - c0) * Ppt, H = Mathf.CeilToInt((sTop - sBottom) * Ppt);
            var px = new Color32[W * H]; var rowOf = new int[W * H]; Color32 clear = Ink; clear.a = 0;
            for (int i = 0; i < px.Length; i++) { px[i] = clear; rowOf[i] = -1; }
            var cmin = new int[g.W]; var cmax = new int[g.W];     // group rows per column, widened by one tile each way
            for (int x = 0; x < g.W; x++) { cmin[x] = int.MaxValue; cmax[x] = -1; }
            for (int y = f.MinY; y <= f.MaxY; y++) for (int x = f.MinX; x <= f.MaxX; x++) if (f.In(x, y))
                for (int k = Mathf.Max(0, x - 1); k <= Mathf.Min(g.W - 1, x + 1); k++) { cmin[k] = Mathf.Min(cmin[k], y); cmax[k] = Mathf.Max(cmax[k], y); }
            for (int j = 0; j < H; j++)
            {
                float s = sBottom + (j + .5f) / Ppt, v0 = -s / Sq, v1 = (zMax - s) / Sq;
                for (int i = 0; i < W; i++)
                {
                    float u = c0 + (i + .5f) / Ppt; int tx = Mathf.FloorToInt(u);
                    if (tx < 0 || tx >= g.W || cmax[tx] < 0 || v1 < cmin[tx] - 1 || v0 > cmax[tx] + 2) continue;
                    float hz = -1f, hv = 0f;
                    for (float z = zMax; z >= 0f; z -= Dz)
                    {
                        float v = (z - s) / Sq; if (v < 0f || v >= g.H) continue;
                        float h = f.H(u, v);
                        if (h > 0f && h >= z) { hz = z; hv = v; break; }
                    }
                    int o = j * W + i;
                    if (hz >= 0f)
                    {
                        px[o] = Bark(f, pal, stump, u, hv, hz, s); rowOf[o] = Mathf.FloorToInt(hv);
                    }
                    else
                    {
                        float v = v0; float gd = f.GroundDist(u, v);   // the wet flare at a root's foot
                        if (gd >= .32f) continue;
                        float n = RegionNoise.Periodic(u * 5f, v * 5f, 61, 29);
                        float a = Mathf.Clamp01((1f - gd / .32f) * (.55f + .9f * n));
                        if (a < .25f) continue;
                        Color c = Color.Lerp(pal.Dark, pal.Moss, .35f + .4f * n); c.a = Mathf.Min(1f, a * 1.1f);
                        px[o] = c; rowOf[o] = Mathf.FloorToInt(v);
                    }
                }
            }
            var parent = new GameObject(name); parent.transform.SetParent(lm.Root.transform, false);
            var rowSet = new List<int>(); for (int r = r0; r <= r1; r++) rowSet.Add(r);
            foreach (int r in rowSet)
            {
                int ia = int.MaxValue, ib = -1, ja = int.MaxValue, jb = -1;
                for (int j = 0; j < H; j++) for (int i = 0; i < W; i++) if (InStrip(rowOf, W, H, i, j, r)) { ia = Mathf.Min(ia, i); ib = Mathf.Max(ib, i); ja = Mathf.Min(ja, j); jb = Mathf.Max(jb, j); }
                if (ib < 0) continue;
                int sw = ib - ia + 1, sh = jb - ja + 1; var sp = new Color32[sw * sh];
                for (int j = 0; j < sh; j++) for (int i = 0; i < sw; i++) sp[j * sw + i] = InStrip(rowOf, W, H, ia + i, ja + j, r) ? px[(ja + j) * W + ia + i] : clear;
                var tex = NewTexture(lm, sw, sh, name + " row " + r); tex.SetPixels32(sp); tex.Apply(false, false);   // readable: the marsh test samples the bark
                NewSprite(lm, parent.transform, tex, name + " strip", new Vector3(lm.FootX + c0 + ia / (float)Ppt, -lm.FootY * Sq + sBottom + ja / (float)Ppt, 0),
                    2000 + 16 * (lm.FootY + r) + 1);
            }
        }

        /// <summary>Whether pixel (i, j) belongs to the strip of tile row r: its own pixels, and one pixel of the strips next to it so no hairline shows.</summary>
        static bool InStrip(int[] rowOf, int W, int H, int i, int j, int r)
        {
            if (i < 0 || j < 0 || i >= W || j >= H) return false;
            if (rowOf[j * W + i] == r) return true;
            if (rowOf[j * W + i] < 0) return false;
            return (j > 0 && rowOf[(j - 1) * W + i] == r) || (j + 1 < H && rowOf[(j + 1) * W + i] == r);
        }

        sealed class Palette
        {
            public readonly Color Dark, Mid, Light, Moss, MossLit, Wood, WoodDark;
            public Palette(RegionTheme theme)
            {
                Dark = Color.Lerp(new Color(.09f, .07f, .06f), theme.WallFace, .12f);
                Mid = Color.Lerp(new Color(.27f, .21f, .15f), theme.WallFace, .12f);
                Light = Color.Lerp(new Color(.46f, .39f, .28f), theme.WallTop, .12f);
                Moss = new Color(.22f, .34f, .12f); MossLit = new Color(.42f, .52f, .20f);
                Wood = new Color(.60f, .48f, .30f); WoodDark = new Color(.35f, .26f, .16f);
            }
        }

        /// <summary>The bark at one surface point (u, v) of height z, seen at screen height s: lit from the north west, grooved along the grain,
        /// mossy, dark and wet at the foot and at the rim. Always opaque.</summary>
        static Color32 Bark(Field f, Palette pal, bool stump, float u, float v, float z, float s)
        {
            float h = f.H(u, v); bool top = h - z < .06f;
            float sb = stump ? 0f : SmoothStep(1.6f, Mathf.Max(2.4f, f.MaxDepth - .8f), f.DepthAt(u, v));   // bole-ness
            Color c;
            if (top)
            {
                const float e = .13f;
                float dHu = (f.HSmooth(u + e, v) - f.HSmooth(u - e, v)) / (2 * e), dHv = (f.HSmooth(u, v + e) - f.HSmooth(u, v - e)) / (2 * e);
                float lit = Mathf.Clamp((dHu * .55f + dHv * .85f) * 1.3f, -1f, 1f);
                float height = Mathf.Clamp01((h - RootH) / (BoleH - RootH));
                float k = .78f + .55f * lit + .22f * height;
                c = Color.Lerp(pal.Mid, pal.Light, Mathf.Clamp01(.35f + .7f * lit + .3f * height));
                // Grain: along the arm for roots (across the depth gradient), up the bole for the core.
                float gx = f.DepthAt(u + .15f, v) - f.DepthAt(u - .15f, v), gy = f.DepthAt(u, v + .15f) - f.DepthAt(u, v - .15f), m = Mathf.Sqrt(gx * gx + gy * gy);
                float vert = RegionNoise.PeriodicXY(u * 8.5f, s * 1.1f, 61, 61, 7), streak = vert;
                if (m > .05f) { float cx = gx / m, cy = gy / m; streak = RegionNoise.PeriodicXY((u * cx + v * cy) * 7.5f, (-u * cy + v * cx) * .9f, 61, 61, 11); }
                float grain = Mathf.Lerp(streak, vert, sb);
                k *= .62f + .55f * SmoothStep(.1f, .65f, grain);
                k += (RegionNoise.Periodic(u * 21f, s * 21f, 61, 5) - .5f) * .1f;
                c = new Color(c.r * k, c.g * k, c.b * k);
                if (stump)                                        // the broken top: pale wood with rings, bark kept at the rim
                {
                    float cu = u - (f.MinX + f.MaxX + 1) * .5f, cv = v - (f.MinY + f.MaxY + 1) * .5f, r = Mathf.Sqrt(cu * cu + cv * cv * 1.2f);
                    float ring = .5f + .5f * Mathf.Sin(r * 13f + RegionNoise.Periodic(u * 2f, v * 2f, 61, 3) * 3f);
                    Color wood = Color.Lerp(pal.WoodDark, pal.Wood, .45f + .45f * ring) * (.8f + .35f * lit + .15f * (RegionNoise.Periodic(u * 9f, v * 9f, 61, 8) - .5f));
                    float rim = SmoothStep(.12f, .26f, f.EdgeDist(u, v)); wood.a = 1f;
                    c = Color.Lerp(c, wood, rim * .9f);
                }
                float moss = SmoothStep(.66f, .84f, RegionNoise.Periodic(u * 1.3f, v * 1.3f, 61, 13) * .6f + RegionNoise.Periodic(u * 3.3f, v * 3.3f, 61, 17) * .4f
                    + .1f + (1f - sb) * .14f - (stump ? .12f : 0f));
                if (moss > 0f) c = Color.Lerp(c, Color.Lerp(pal.Moss, pal.MossLit, Mathf.Clamp01(.3f + lit * .5f)) * (.75f + .35f * k), moss * .8f);
                float ed = f.EdgeDist(u, v); if (ed < .07f) c = Color.Lerp(Ink, c, ed / .07f);
            }
            else                                                  // the south face: darker, wet, mossy at the foot
            {
                float zk = Mathf.Clamp01(z / Mathf.Max(.3f, h));
                float grain = RegionNoise.PeriodicXY(u * 9f, z * .9f, 61, 61, 21);
                float k = (.36f + .45f * zk) * (.65f + .5f * SmoothStep(.1f, .7f, grain));
                c = Color.Lerp(pal.Dark, pal.Mid, Mathf.Clamp01(k * 1.4f)); c = new Color(c.r * (.7f + k), c.g * (.7f + k), c.b * (.7f + k));
                float foot = Mathf.Clamp01(1f - z / .28f) * (.55f + .6f * RegionNoise.Periodic(u * 4f, z * 4f, 61, 23));
                c = Color.Lerp(c, pal.Moss * .9f, Mathf.Clamp01(foot) * .85f);
                if (z < .035f) c = Color.Lerp(c, Ink, .5f);
                float fu = u - Mathf.Floor(u); if (fu < .04f || fu > .96f) c = Color.Lerp(c, Ink, .35f);
            }
            Color32 o = c; o.a = 255; return o;
        }

        // ---- the canopy -------------------------------------------------------------------------------------------------------------------------

        static void PaintCanopy(Landmark lm, Grid g, bool[] cover)
        {
            int minX = g.W, maxX = -1, minY = g.H, maxY = -1;
            for (int y = 0; y < g.H; y++) for (int x = 0; x < g.W; x++) if (cover[y * g.W + x]) { minX = Mathf.Min(minX, x); maxX = Mathf.Max(maxX, x); minY = Mathf.Min(minY, y); maxY = Mathf.Max(maxY, y); }
            if (maxX < 0) return;
            const float Thick = .35f;
            float lift = Mathf.Clamp((minY - .4f) * Sq - Thick, .55f, .95f);
            float u0 = Mathf.Max(0f, minX - .5f), u1 = Mathf.Min(g.W, maxX + 1.5f);
            float sB = Mathf.Max(-g.H * Sq, -(maxY + 1) * Sq), sT = Mathf.Min(0f, -minY * Sq + lift + Thick + .5f);
            int W = Mathf.CeilToInt((u1 - u0) * Ppt), H = Mathf.CeilToInt((sT - sB) * Ppt);
            var px = new Color32[W * H]; Color32 clear = new Color32(30, 50, 24, 0);
            var alpha = new bool[W * H];
            Color gap = new Color(.06f, .12f, .06f), dark = new Color(.13f, .23f, .09f), mid = new Color(.26f, .40f, .13f), light = new Color(.50f, .61f, .24f), sick = new Color(.56f, .56f, .20f);
            for (int j = 0; j < H; j++)
            {
                float s = sB + (j + .5f) / Ppt;
                for (int i = 0; i < W; i++)
                {
                    float u = u0 + (i + .5f) / Ppt;
                    float su = u, sv = -s / Sq;
                    float wx = (RegionNoise.Periodic(su * 1.3f, sv * 1.3f, 61, 51) - .5f) * .9f, wy = (RegionNoise.Periodic(su * 1.3f, sv * 1.3f, 61, 52) - .5f) * .9f;
                    float qx = (su + wx) * .62f, qy = (sv + wy) * .62f, f1, edge, id;
                    RegionNoise.Worley(Mathf.Repeat(qx, 64f) / 64f, Mathf.Repeat(qy, 64f) / 64f, 64, 3, out f1, out edge, out id);
                    float wob = RegionNoise.Periodic(u * 1.7f, -s / Sq * 1.7f, 61, 77);
                    float clump = (id - .5f) * .5f + (wob - .5f) * .6f + (RegionNoise.Periodic(u * 5f, sv * 5f, 61, 78) - .5f) * .16f;
                    bool upper = Density(g, cover, u, (lift + Thick - s) / Sq) + clump > .46f, lower = upper || Density(g, cover, u, (lift - s) / Sq) + clump > .46f;
                    if (!lower) { px[j * W + i] = clear; continue; }
                    float f1b, e2, i2; RegionNoise.Worley(Mathf.Repeat(qx + .1f, 64f) / 64f, Mathf.Repeat(qy + .1f, 64f) / 64f, 64, 3, out f1b, out e2, out i2);
                    float lt = Mathf.Clamp((f1 - f1b) * 7f, -1f, 1f);
                    float f2, ed2, id2; RegionNoise.Worley(Mathf.Repeat(su * 2.3f, 64f) / 64f, Mathf.Repeat(sv * 2.3f, 64f) / 64f, 64, 9, out f2, out ed2, out id2);
                    float leaf = RegionNoise.Periodic(u * 14f, sv * 14f, 61, 19);
                    Color c = Color.Lerp(dark, mid, Smooth(1.15f - f1 * 1.5f));
                    c = Color.Lerp(c, light, Mathf.Clamp01(lt * .9f + (.6f - f1) * .45f) * .8f);
                    c = Color.Lerp(c, c * .72f, SmoothStep(.12f, .0f, ed2) * .7f);                    // sub-clump creases
                    c = Color.Lerp(c, light, SmoothStep(.62f, .82f, leaf) * .22f);                    // leaf flecks
                    c = Color.Lerp(c, sick, SmoothStep(.55f, .8f, RegionNoise.Periodic(u * .9f, -s / Sq * .9f, 61, 91)) * .5f);
                    c = Color.Lerp(gap, c, SmoothStep(.0f, .1f, edge) * .8f + .2f * SmoothStep(.0f, .2f, edge));
                    if (!upper) c = Color.Lerp(gap, c, .55f);            // the crown's underside
                    Color32 o = c; o.a = 255; px[j * W + i] = o; alpha[j * W + i] = true;
                }
            }
            for (int i = 0; i < W; i++)                                // hanging moss under the rim
            {
                float lenKey = RegionNoise.Hash01(i / 2, 5, 33); if (lenKey < .5f) continue;
                int len = 3 + Mathf.RoundToInt(lenKey * 11f), since = int.MaxValue;
                for (int j = H - 1; j >= 0; j--)
                {
                    if (alpha[j * W + i]) { since = 0; continue; }
                    if (since == int.MaxValue) continue;
                    since++; if (since > len) { since = int.MaxValue; continue; }
                    Color m = Color.Lerp(new Color(.45f, .52f, .34f), new Color(.30f, .38f, .22f), since / (float)len); m.a = .95f - .4f * since / len;
                    px[j * W + i] = m;
                }
            }
            var tex = NewTexture(lm, W, H, "Bog tree canopy"); tex.SetPixels32(px); tex.Apply(false, false);
            var sr = NewSprite(lm, lm.Root.transform, tex, "Bog tree canopy", new Vector3(lm.FootX + u0, -lm.FootY * Sq + sB, 0), 0);
            lm.AddRoofRenderer(sr);
        }

        /// <summary>The cover, smoothed between tile centres (0..1): about one half at a cover tile's edge.</summary>
        static float Density(Grid g, bool[] cover, float u, float v)
        {
            float gx = u - .5f, gy = v - .5f; int x0 = Mathf.FloorToInt(gx), y0 = Mathf.FloorToInt(gy); float fx = gx - x0, fy = gy - y0;
            return Mathf.Lerp(Mathf.Lerp(C(g, cover, x0, y0), C(g, cover, x0 + 1, y0), fx), Mathf.Lerp(C(g, cover, x0, y0 + 1), C(g, cover, x0 + 1, y0 + 1), fx), fy);
        }
        static float C(Grid g, bool[] cover, int x, int y) { return x >= 0 && y >= 0 && x < g.W && y < g.H && cover[y * g.W + x] ? 1f : 0f; }
    }
}

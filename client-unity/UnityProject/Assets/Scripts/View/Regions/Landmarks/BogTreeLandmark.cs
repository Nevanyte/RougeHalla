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
    ///  - the crown (the roof, through Landmark.AddRoofRenderer): P-UNITY-BOG-TREE-2, a bald cypress. The bole is a tall fluted grey-brown column
    ///    on a root skirt; the crown is a light green cloud lifted above it (drawn higher on screen, its lowest edge above the middle of the trunk's
    ///    drawn height), with enclosed gaps and grey-green moss hanging at its lower edges. The cover (Landmark.SetCover) is the trunk group's tiles plus
    ///    every dry floor tile (not Bog) whose centre is within Euclidean distance 3 of a trunk tile (dx*dx + dy*dy &lt;= 9). The fade set
    ///    (Landmark.SetFadeTiles) is the cover plus every tile the crown paints over. A soft dappled shadow on the cover (a second roof piece) lies under it;
    ///  - the stumps are cypress knees (rounded cones of bark with a pale tip).
    /// Nothing opaque is drawn on bog tiles away from the bark. Colours are sRGB from the Plague theme, as the region atlas.
    /// </summary>
    public static class BogTreeLandmark
    {
        public const string TrunkName = "Bog tree trunk", StumpName = "Bog tree stump";
        /// <summary>P-UNITY-BOG-TREE-2: the crown's sprite object (one SpriteRenderer, also a roof renderer). The oracle finds the crown by this name; a
        /// ground-shadow or other roof piece must use another name.</summary>
        public const string CrownName = "Bog tree canopy";
        const int Ppt = 16;                                       // texture pixels per tile
        const float Sq = ArenaView.GroundSquash;
        const float RootH = .72f, BoleH = 2.7f;                    // world units; RootH clears the wall blocks (face .67); the bole stands 2.7 tall
        const float BoleRise = .6f;                               // tiles of depth over which the flared root skirt turns into the steep column
        const float BoleTilt = .22f;                                // how much higher the bole's top is on its north west side (units)
        const float Dz = .055f;
        const int CanopyPpt = 12;                                 // the crown is soft foliage: bilinear, a little under the bark's resolution
        const int ShadowPpt = 6;                                  // the ground shadow under the crown is soft: low resolution, bilinear
        /// <summary>P-UNITY-BOG-TREE-3: the crown's ground shadow object (one SpriteRenderer); the oracle finds it by this name.</summary>
        public const string ShadowName = "Bog tree crown shadow";
        // Looks-only numbers of the crown (docs/unity/DIALS.md rows bog-tree-*).
        const float CrownLiftMargin = .35f;                       // the crown's bottom edge (moss included) above the trunk bounds' midpoint, units (test floor .25)
        const float CrownTopGap = 1.0f;                            // the crown's top edge below the footprint's top edge, units
        const float CrownMossLength = 1.1f;                       // longest hanging moss strand, units
        const float CrownShape = 2.25f;                            // superellipse exponent of the crown's outline (2 = ellipse, higher = boxier)
        const float CrownGapAmount = .58f;                        // the noise level above which the crown has a gap (lower = more sky); range .5 to .68
        const float ShadowAlpha = .36f;                           // darkest the ground shadow gets under the crown; range .2 to .5
        const float KneeRise = .75f;                              // how far a cypress knee stands above the root height, units
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
            var trunk = Vector2.zero;
            for (int k = 0; k < g.Groups; k++)
            {
                var span = PaintBark(lm, g, new Field(g, k), k == 0 ? TrunkName : StumpName, k != 0);
                if (k == 0) trunk = span;
            }
            PaintCanopy(lm, g, cover, tiles, trunk);
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
                if (Stump)                                       // a cypress knee: a rounded cone, the middle of the clump highest
                {
                    float core = Smooth((d - 1f) / Mathf.Max(1f, MaxDepth - 1f));
                    return RootH + .08f + KneeRise * (.35f + .65f * core) * (.7f + .5f * RegionNoise.Hash01(x + 31 * Id, y, 41));
                }
                // the root skirt (the flare) first, then a steep fluted column that stands BoleH tall, a little higher to the north west
                float s0 = Smooth((d - 1.2f) / BoleRise);
                float nw = Mathf.Clamp(((Cu - (x + .5f)) + (Cv - (y + .5f))) / Mathf.Max(1f, MaxDepth), -1f, 1f);
                float h = RootH + .16f * Mathf.Clamp01((d - 1f) / 1.2f) + (BoleH - RootH - .16f - BoleTilt) * Mathf.Pow(s0, .75f) + BoleTilt * s0 * (.5f + .5f * nw);
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

        static SpriteRenderer NewSprite(Landmark lm, Transform parent, Texture2D tex, string name, Vector3 position, int order, int ppt = Ppt)
        {
            var sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), Vector2.zero, ppt, 0, SpriteMeshType.FullRect);
            lm.Own(sprite);
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = sprite; sr.sharedMaterial = lm.Material; sr.sortingOrder = order;
            return sr;
        }

        // ---- the bark: one height field, marched pixel by pixel ----------------------------------------------------------------------------

        /// <summary>Paints one group's bark strips; returns the lowest and highest screen height (footprint-local, 0 = the footprint's top edge) any strip covers.</summary>
        static Vector2 PaintBark(Landmark lm, Grid g, Field f, string name, bool stump)
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
            var colH = new float[g.W];                            // the tallest bark in each column and its neighbours: where a ray may start
            for (int y = f.MinY; y <= f.MaxY; y++) for (int x = f.MinX; x <= f.MaxX; x++) if (f.In(x, y))
                for (int k = Mathf.Max(0, x - 1); k <= Mathf.Min(g.W - 1, x + 1); k++) { cmin[k] = Mathf.Min(cmin[k], y); cmax[k] = Mathf.Max(cmax[k], y); colH[k] = Mathf.Max(colH[k], f.HSmooth(x + .5f, y + .5f) + .12f); }
            for (int j = 0; j < H; j++)
            {
                float s = sBottom + (j + .5f) / Ppt, v0 = -s / Sq;
                for (int i = 0; i < W; i++)
                {
                    float u = c0 + (i + .5f) / Ppt; int tx = Mathf.FloorToInt(u);
                    if (tx < 0 || tx >= g.W || cmax[tx] < 0) continue;
                    float zStart = Mathf.Min(zMax, colH[tx]), v1 = (zStart - s) / Sq;
                    if (v1 < cmin[tx] - 1 || v0 > cmax[tx] + 2) continue;
                    float hz = -1f, hv = 0f;
                    for (float z = zStart; z >= 0f; z -= Dz)
                    {
                        float v = (z - s) / Sq; if (v < 0f || v >= g.H) continue;
                        float h = f.H(u, v);
                        if (h > 0f && h >= z)
                        {
                            float lo = z, hi = z + Dz;                // bisect the step so slopes shade smoothly (no bands from the step size)
                            for (int it = 0; it < 5; it++)
                            {
                                float mz = (lo + hi) * .5f, mv = (mz - s) / Sq, mh = mv >= 0f && mv < g.H ? f.H(u, mv) : 0f;
                                if (mh > 0f && mh >= mz) lo = mz; else hi = mz;
                            }
                            hz = lo; hv = (lo - s) / Sq; break;
                        }
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
            int rows = r1 - r0 + 1; var bia = new int[rows]; var bib = new int[rows]; var bja = new int[rows]; var bjb = new int[rows];
            for (int r = 0; r < rows; r++) { bia[r] = int.MaxValue; bib[r] = -1; bja[r] = int.MaxValue; bjb[r] = -1; }
            for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)          // one pass: each row's pixel box
            {
                int r = rowOf[j * W + i] - r0; if (r < 0 || r >= rows) continue;
                bia[r] = Mathf.Min(bia[r], i); bib[r] = Mathf.Max(bib[r], i); bja[r] = Mathf.Min(bja[r], j); bjb[r] = Mathf.Max(bjb[r], j);
            }
            float lowS = float.MaxValue, highS = float.MinValue;
            for (int rr = 0; rr < rows; rr++)
            {
                if (bib[rr] < 0) continue;
                int r = rr + r0, ia = bia[rr], ib = bib[rr], ja = Mathf.Max(0, bja[rr] - 1), jb = Mathf.Min(H - 1, bjb[rr] + 1);   // one pixel more each way for the shared hairline
                int sw = ib - ia + 1, sh = jb - ja + 1; var sp = new Color32[sw * sh];
                for (int j = 0; j < sh; j++) for (int i = 0; i < sw; i++) sp[j * sw + i] = InStrip(rowOf, W, H, ia + i, ja + j, r) ? px[(ja + j) * W + ia + i] : clear;
                var tex = NewTexture(lm, sw, sh, name + " row " + r); tex.SetPixels32(sp); tex.Apply(false, false);   // readable: the marsh test samples the bark
                NewSprite(lm, parent.transform, tex, name + " strip", new Vector3(lm.FootX + c0 + ia / (float)Ppt, -lm.FootY * Sq + sBottom + ja / (float)Ppt, 0),
                    2000 + 16 * (lm.FootY + r) + 1);
                lowS = Mathf.Min(lowS, sBottom + ja / (float)Ppt); highS = Mathf.Max(highS, sBottom + (jb + 1) / (float)Ppt);
            }
            return new Vector2(lowS, highS);
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
                Dark = Color.Lerp(new Color(.16f, .14f, .12f), theme.WallFace, .1f);
                Mid = Color.Lerp(new Color(.47f, .41f, .34f), theme.WallFace, .1f);
                Light = Color.Lerp(new Color(.66f, .60f, .50f), theme.WallTop, .1f);
                Moss = new Color(.30f, .38f, .20f); MossLit = new Color(.52f, .60f, .34f);
                Wood = new Color(.66f, .56f, .40f); WoodDark = new Color(.40f, .32f, .22f);
            }
        }

        /// <summary>The bark at one surface point (u, v) of height z, seen at screen height s: lit from the north west, grooved along the grain,
        /// mossy, dark and wet at the foot and at the rim. Always opaque.</summary>
        static Color32 Bark(Field f, Palette pal, bool stump, float u, float v, float z, float s)
        {
            float h = f.H(u, v), gu = (f.HSmooth(u + .12f, v) - f.HSmooth(u - .12f, v)) / .24f, gv = (f.HSmooth(u, v + .12f) - f.HSmooth(u, v - .12f)) / .24f;
            bool top = h - z < .06f && gu * gu + gv * gv < 1.5f * 1.5f;           // a slope steeper than about 56 degrees is drawn as a face
            float sb = stump ? 0f : SmoothStep(1.6f, Mathf.Max(2.4f, f.MaxDepth - .8f), f.DepthAt(u, v));   // bole-ness
            Color c;
            if (top)
            {
                const float e = .13f;
                float dHu = (f.HSmooth(u + e, v) - f.HSmooth(u - e, v)) / (2 * e), dHv = (f.HSmooth(u, v + e) - f.HSmooth(u, v - e)) / (2 * e);
                float lit = Mathf.Clamp((dHu * .55f + dHv * .85f) * 1.3f, -1f, 1f);
                float height = Mathf.Clamp01((h - RootH) / (BoleH - RootH));
                float k = .9f + .3f * Mathf.Max(lit, -.5f) + .22f * height;
                c = Color.Lerp(pal.Mid, pal.Light, Mathf.Clamp01(.4f + .5f * lit + .3f * height));
                // Grain: along the arm for roots (across the depth gradient), up the bole for the core.
                float gx = f.DepthAt(u + .15f, v) - f.DepthAt(u - .15f, v), gy = f.DepthAt(u, v + .15f) - f.DepthAt(u, v - .15f), m = Mathf.Sqrt(gx * gx + gy * gy);
                float vert = RegionNoise.PeriodicXY(u * 8.5f, s * 1.1f, 61, 61, 7), streak = vert;
                if (m > .05f) { float cx = gx / m, cy = gy / m; streak = RegionNoise.PeriodicXY((u * cx + v * cy) * 7.5f, (-u * cy + v * cx) * .9f, 61, 61, 11); }
                float grain = Mathf.Lerp(streak, vert, sb);
                k *= .62f + .55f * SmoothStep(.1f, .65f, grain);
                k += (RegionNoise.Periodic(u * 21f, s * 21f, 61, 5) - .5f) * .1f;
                c = new Color(c.r * k, c.g * k, c.b * k);
                if (stump)                                        // a knee's tip: weathered pale wood, bark kept lower down
                {
                    Color wood = Color.Lerp(pal.WoodDark, pal.Wood, .5f + .5f * lit) * (.85f + .3f * (RegionNoise.Periodic(u * 9f, v * 9f, 61, 8) - .5f)); wood.a = 1f;
                    c = Color.Lerp(c, wood, SmoothStep(.45f, .9f, (h - RootH) / KneeRise) * .75f);
                }
                float moss = SmoothStep(.7f, .88f, RegionNoise.Periodic(u * 1.3f, v * 1.3f, 61, 13) * .6f + RegionNoise.Periodic(u * 3.3f, v * 3.3f, 61, 17) * .4f
                    + .1f + (1f - sb) * .14f - (stump ? .12f : 0f));
                if (moss > 0f) c = Color.Lerp(c, Color.Lerp(pal.Moss, pal.MossLit, Mathf.Clamp01(.3f + lit * .5f)) * (.75f + .35f * k), moss * (stump ? .8f : .45f));
                float ed = f.EdgeDist(u, v); if (ed < .07f) c = Color.Lerp(Ink, c, ed / .07f);
            }
            else                                                  // the south face: fluted, lit on its west side, wet and mossy at the foot
            {
                float zk = Mathf.Clamp01(z / Mathf.Max(.3f, h));
                float side = stump ? 0f : Mathf.Clamp((f.Cu - u) / Mathf.Max(2f, f.MaxDepth - 1f), -1f, 1f);          // + on the west flank
                float warp = (RegionNoise.Periodic(u * 1.1f, z * .5f, 61, 27) - .5f) * .9f;
                float grain = RegionNoise.PeriodicXY(u * 4.2f + warp, z * .45f, 61, 61, 21);
                float rough = RegionNoise.PeriodicXY(u * 13f, z * 3.2f, 61, 61, 22);
                float k = (.42f + .5f * zk + .3f * side) * (.62f + .55f * SmoothStep(.15f, .75f, grain)) * (.9f + .2f * rough);
                c = Color.Lerp(pal.Dark, pal.Mid, Mathf.Clamp01(k * .9f)); c = Color.Lerp(c, pal.Light, Mathf.Clamp01((k - .95f) * 1.2f));
                float foot = Mathf.Clamp01(1f - z / .28f) * (.55f + .6f * RegionNoise.Periodic(u * 4f, z * 4f, 61, 23));
                c = Color.Lerp(c, pal.Moss * .9f, Mathf.Clamp01(foot) * .5f);
                float patch = SmoothStep(.7f, .88f, RegionNoise.Periodic(u * 2.4f, z * 1.2f, 61, 29));          // a few mossy patches up the column
                c = Color.Lerp(c, pal.Moss * (.8f + .3f * k), patch * .4f * (1f - zk * .5f));
                if (z < .035f) c = Color.Lerp(c, Ink, .5f);
                float fu = u - Mathf.Floor(u); if (fu < .04f || fu > .96f) c = Color.Lerp(c, Ink, .2f);
            }
            Color32 o = c; o.a = 255; return o;
        }

        // ---- the crown (lifted, with gaps) and the shadow it throws on the ground -----------------------------------------------------------

        /// <summary>The crown is one sprite in screen space, not on the ground: a flat topped cypress cloud above the bole, its bottom edge (moss included)
        /// above the middle of the trunk's drawn height, its top just under the footprint's top edge. It spans the cover's width. Gaps (the sky-lit ground
        /// shows through) are transparent and enclosed. It fades for every tile it paints over (Landmark.SetFadeTiles, the cover included); a soft shadow on
        /// the cover tiles (a second roof piece) keeps the roof layer reaching the whole cover.</summary>
        static void PaintCanopy(Landmark lm, Grid g, bool[] cover, List<MapTile> coverTiles, Vector2 trunk)
        {
            int minX = g.W, maxX = -1, minY = g.H, maxY = -1;
            for (int y = 0; y < g.H; y++) for (int x = 0; x < g.W; x++) if (cover[y * g.W + x]) { minX = Mathf.Min(minX, x); maxX = Mathf.Max(maxX, x); minY = Mathf.Min(minY, y); maxY = Mathf.Max(maxY, y); }
            if (maxX < 0) return;
            float u0 = minX, u1 = maxX + 1f, uc = (u0 + u1) * .5f, halfW = (u1 - u0) * .5f;
            float sT = -CrownTopGap, sB = (trunk.x + trunk.y) * .5f + CrownLiftMargin;
            float sR = Mathf.Min(sB + CrownMossLength, sT - 2.5f);          // the body's lowest edge; the moss hangs from it down to sB
            float sMid = (sR + sT) * .5f, halfH = (sT - sR) * .5f;
            int W = Mathf.CeilToInt((u1 - u0) * CanopyPpt), H = Mathf.CeilToInt((sT - sB) * CanopyPpt);
            var px = new Color32[W * H]; Color32 clear = new Color32(110, 150, 60, 0);
            var body = new bool[W * H];
            Color dark = new Color(.27f, .44f, .15f), mid = new Color(.50f, .70f, .22f), light = new Color(.72f, .90f, .36f), sun = new Color(.86f, .96f, .52f), under = new Color(.17f, .30f, .12f);
            for (int j = 0; j < H; j++)
            {
                float s = sB + (j + .5f) / CanopyPpt;
                for (int i = 0; i < W; i++)
                {
                    px[j * W + i] = clear;
                    if (s < sR) continue;
                    float u = u0 + (i + .5f) / CanopyPpt, x = (u - uc) / halfW, y = (s - sMid) / halfH;
                    float r = Mathf.Pow(Mathf.Pow(Mathf.Abs(x), CrownShape) + Mathf.Pow(Mathf.Abs(y), CrownShape), 1f / CrownShape);
                    r += (RegionNoise.Periodic(u * 2.1f, s * 4.4f, 61, 31) - .5f) * .2f + (RegionNoise.Periodic(u * 9f, s * 21f, 61, 32) - .5f) * .1f;   // lobes, then feathers
                    if (r >= 1f) continue;
                    float hn = RegionNoise.Periodic(u * .8f, s * 1.9f, 61, 41) * .62f + RegionNoise.Periodic(u * 2.4f, s * 5.4f, 61, 42) * .38f;
                    // soft edges (anti-aliased): the outline, and the gaps, which stay enclosed so the rim is whole
                    float cov = SmoothStep(1f, .93f, r) * (1f - SmoothStep(CrownGapAmount, CrownGapAmount + .035f, hn) * SmoothStep(.84f, .78f, r) * SmoothStep(.05f, .1f, r));
                    if (cov < .03f) continue;
                    float t = Mathf.Clamp01((s - sR) / (sT - sR));              // 0 at the crown's bottom, 1 at its top
                    float f1, edge, id; RegionNoise.Worley(Mathf.Repeat(u * .55f, 64f) / 64f, Mathf.Repeat(s * .75f, 64f) / 64f, 64, 3, out f1, out edge, out id);
                    float f1b, e2, i2; RegionNoise.Worley(Mathf.Repeat(u * .55f - .09f, 64f) / 64f, Mathf.Repeat(s * .75f + .09f, 64f) / 64f, 64, 3, out f1b, out e2, out i2);
                    float lt = Mathf.Clamp((f1b - f1) * 6f, -1f, 1f);           // lit on the clump's north west side
                    float frond = RegionNoise.PeriodicXY(u * 7f, s * 26f, 61, 61, 19);   // horizontal sprays, the cypress's feathers
                    Color c = Color.Lerp(dark, mid, Smooth(.5f + (id - .5f) * .7f + lt * .3f));
                    c = Color.Lerp(c, light, Mathf.Clamp01(.15f + lt * .45f + (t - .35f) * .9f + (frond - .5f) * .5f));
                    c = Color.Lerp(c, sun, SmoothStep(.62f, .86f, frond + (t - .5f) * .25f + lt * .1f) * .55f);
                    c *= .92f + .16f * SmoothStep(.1f, .6f, edge);
                    c = Color.Lerp(c, under, SmoothStep(.32f, .0f, t - .3f * (1f - Mathf.Clamp01(r * 1.2f))) * .55f);     // the underside of the cloud
                    Color32 o = c; o.a = (byte)Mathf.RoundToInt(255f * cov); px[j * W + i] = o; body[j * W + i] = cov >= .5f;
                }
            }
            for (int i = 0; i < W; i++)                                // grey-green Spanish moss hangs from every lower edge
            {
                float key = RegionNoise.Hash01(i / 2, 5, 33); if (key < .38f) continue;
                for (int j = 1; j < H; j++)
                {
                    if (!(body[j * W + i] && !body[(j - 1) * W + i])) continue;      // a pixel of the body with air below it
                    float s = sB + (j + .5f) / CanopyPpt; if (s > sMid + .2f * halfH) continue;
                    bool rim = j < (int)((sR - sB) * CanopyPpt) + 3;
                    int len = Mathf.RoundToInt(CanopyPpt * CrownMossLength * (rim ? 1f : .4f) * (.2f + .8f * key)), n = 0;
                    for (int k = j - 1; k >= 0 && n < len && !body[k * W + i]; k--, n++)
                    {
                        float f = n / (float)len;
                        Color m = Color.Lerp(new Color(.64f, .70f, .55f), new Color(.46f, .55f, .40f), f); m.a = .96f - .45f * f;
                        px[k * W + i] = m;
                    }
                }
            }
            var tex = NewTexture(lm, W, H, CrownName); tex.SetPixels32(px); tex.Apply(false, false);
            var sr = NewSprite(lm, lm.Root.transform, tex, CrownName, new Vector3(lm.FootX + u0, -lm.FootY * Sq + sB, 0), 0, CanopyPpt);
            lm.AddRoofRenderer(sr);
            var fade = new HashSet<(int x, int y)>();                  // every tile the crown paints over: an actor there is hidden by it
            for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
            {
                if (px[j * W + i].a < 100) continue;
                fade.Add((Mathf.FloorToInt(u0 + (i + .5f) / CanopyPpt), Mathf.FloorToInt(-(sB + (j + .5f) / CanopyPpt) / Sq)));
            }
            var all = new List<MapTile>(coverTiles);
            foreach (var t in fade) all.Add(new MapTile((ushort)(lm.FootX + t.x), (ushort)(lm.FootY + t.y)));
            lm.SetFadeTiles(all);
            PaintShadow(lm, g, cover, minX, maxX, minY, maxY);
        }

        /// <summary>The crown's shadow on the ground it hangs over: soft, dappled, only on cover tiles that are not the trunk's own. A second roof piece
        /// (so it fades with the crown) that spans the whole cover, which keeps the roof layer reaching every cover tile.</summary>
        static void PaintShadow(Landmark lm, Grid g, bool[] cover, int minX, int maxX, int minY, int maxY)
        {
            float u0 = minX, u1 = maxX + 1f, sB = -(maxY + 1) * Sq, sT = -minY * Sq;
            int W = Mathf.CeilToInt((u1 - u0) * ShadowPpt), H = Mathf.CeilToInt((sT - sB) * ShadowPpt);
            var px = new Color32[W * H]; Color32 clear = new Color32(10, 24, 12, 0);
            for (int j = 0; j < H; j++)
            {
                float s = sB + (j + .5f) / ShadowPpt, v = -s / Sq;
                for (int i = 0; i < W; i++)
                {
                    float u = u0 + (i + .5f) / ShadowPpt; px[j * W + i] = clear;
                    float d = Density(g, cover, u, v);
                    if (d <= .5f) continue;
                    int tx = Mathf.FloorToInt(u), ty = Mathf.FloorToInt(v);
                    if (tx >= 0 && ty >= 0 && tx < g.W && ty < g.H && g.Group[ty * g.W + tx] == 0) continue;     // never over the bark
                    float a = ShadowAlpha * SmoothStep(.5f, .95f, d) * (1f - .85f * SmoothStep(.6f, .8f, RegionNoise.Periodic(u * 2.1f, v * 2.1f, 61, 47)));   // dappled
                    Color32 o = new Color(.03f, .08f, .05f); o.a = (byte)Mathf.RoundToInt(255f * a); px[j * W + i] = o;
                }
            }
            var tex = NewTexture(lm, W, H, ShadowName); tex.SetPixels32(px); tex.Apply(false, false);
            lm.AddRoofRenderer(NewSprite(lm, lm.Root.transform, tex, ShadowName, new Vector3(lm.FootX + u0, -lm.FootY * Sq + sB, 0), 0, ShadowPpt));
        }

        /// <summary>The cover, smoothed between tile centres (0..1): about one half at a cover tile's edge.</summary>
        static float Density(Grid g, bool[] cover, float u, float v)
        {
            float gx = u - .5f, gy = v - .5f; int x0 = Mathf.FloorToInt(gx), y0 = Mathf.FloorToInt(gy); float fx = gx - x0, fy = gy - y0;
            return Mathf.Lerp(Mathf.Lerp(C(g, cover, x0, y0), C(g, cover, x0 + 1, y0), fx), Mathf.Lerp(C(g, cover, x0, y0 + 1), C(g, cover, x0 + 1, y0 + 1), fx), fy);
        }
        static bool Cov(Grid g, bool[] cover, float u, float v) { return C(g, cover, Mathf.FloorToInt(u), Mathf.FloorToInt(v)) > 0f; }
        static float C(Grid g, bool[] cover, int x, int y) { return x >= 0 && y >= 0 && x < g.W && y < g.H && cover[y * g.W + x] ? 1f : 0f; }
    }
}

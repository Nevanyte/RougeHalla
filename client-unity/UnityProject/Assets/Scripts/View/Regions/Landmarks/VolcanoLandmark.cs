using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-2: what the Fire volcano's art made, for the tests and for nobody else. Tiers follow the packet's one rule (depth =
    /// distance to the nearest tile that is neither Wall nor Low; Foot to 0.4 of the largest depth, Slope to 0.8, Rim above).
    /// </summary>
    public sealed class VolcanoArt
    {
        public const int Foot = 0, Slope = 1, Rim = 2;

        int _x, _y, _w, _h; int[] _tier = new int[0]; bool[] _lava = new bool[0];
        SpriteRenderer[] _cone = new SpriteRenderer[0], _glow = new SpriteRenderer[0];

        internal void Set(int x, int y, int w, int h, int[] tier, bool[] lava, SpriteRenderer[] cone, SpriteRenderer[] glow)
        {
            _x = x; _y = y; _w = w; _h = h; _tier = tier; _lava = lava; _cone = cone; _glow = glow;
        }

        /// <summary>The height tier of map tile (x, y) (Foot, Slope or Rim) when it is a wall tile of the footprint; -1 for every other tile
        /// (floor, lava, any tile outside the footprint). The tier rule is in docs/backlog/packets/P-UNITY-LANDMARK-2.md, "Established facts".</summary>
        public int Tier(int x, int y)
        {
            int lx = x - _x, ly = y - _y;
            return lx >= 0 && ly >= 0 && lx < _w && ly < _h ? _tier[ly * _w + lx] : -1;
        }

        /// <summary>Whether the art treats map tile (x, y) as lava (SEAMS-1: what the art found, exposed for the tests); false outside the footprint.</summary>
        public bool IsLava(int x, int y)
        {
            int lx = x - _x, ly = y - _y;
            return lx >= 0 && ly >= 0 && lx < _w && ly < _h && _lava[ly * _w + lx];
        }

        /// <summary>The renderers that draw the cone (every one under the landmark's root, on the walls' row rule).</summary>
        public SpriteRenderer[] ConeRenderers { get { return _cone; } }

        /// <summary>The renderers that glow: one on each outlet and one over the lake; all under the landmark's root, under the fog.</summary>
        public SpriteRenderer[] GlowRenderers { get { return _glow; } }
    }

    /// <summary>
    /// P-UNITY-LANDMARK-2: the Fire volcano (kind 1), painted procedurally once per map from the tiles the framework classified. The framework
    /// gives the wall tiles; the lava (Low tiles of the crater lake and the channels, which the ground shader draws) is found here as the
    /// non-wall tiles of the footprint joined to the anchor's centre and entrance, so the art needs no copy of the drawing and is right in all
    /// eight orientations. Pieces:
    ///  - the cone: one sprite per wall row on the walls' sorting rule, three tiers (foot dark basalt, slope scorched rock, rim ember lit),
    ///    a lit lip and a dark step where a tier drops to a lower one (light from the north west), ember on the tiles beside lava, and the
    ///    south faces of the cone (the crater's inner wall where the face looks onto the lake). Every wall tile is covered fully opaque,
    ///    to its exact square, so the wall blocks RegionWalls still draws never show at an edge (the cave's look note);
    ///  - the crater and the channels: a translucent crust on the lava tiles' edges (banks, and the shade the crater wall throws on the
    ///    lake), under everything that stands, never over a lava tile's middle; a glow over the lake; a glow where each channel leaves the box.
    /// No roof, no fade. Colours are sRGB from the Fire theme, as the region atlas.
    /// </summary>
    public static class VolcanoLandmark
    {
        static readonly ConditionalWeakTable<Landmark, VolcanoArt> Arts = new ConditionalWeakTable<Landmark, VolcanoArt>();

        /// <summary>The art Build made for this landmark; null for a landmark of another kind or one not built by this class.</summary>
        public static VolcanoArt ArtOf(Landmark landmark)
        {
            VolcanoArt art; return landmark != null && Arts.TryGetValue(landmark, out art) ? art : null;
        }

        const int Ppt = 16;                                    // texture pixels per tile for the cone
        const float Sq = ArenaView.GroundSquash;
        static readonly Color Outline = new Color(.06f, .03f, .03f), Ember = new Color(1f, .45f, .1f), Hot = new Color(1f, .78f, .3f);

        public static void Build(Landmark lm)
        {
            var g = new Grid(lm);
            var art = new VolcanoArt();
            var cone = new List<SpriteRenderer>(); var glow = new List<SpriteRenderer>();
            BuildCone(lm, g, cone);
            BuildCrust(lm, g);
            BuildGlows(lm, g, glow);
            art.Set(lm.FootX, lm.FootY, lm.FootW, lm.FootH, g.Tier, g.Lava, cone.ToArray(), glow.ToArray());
            Arts.Add(lm, art);
        }

        // ---- the tiles of the footprint, read once --------------------------------------------------------------------------------

        sealed class Grid
        {
            public readonly int W, H; public readonly bool[] Wall, Lava; public readonly int[] Tier; public readonly float[] Depth; public float MaxDepth;
            const int Pad = 2; readonly int _gw, _gh; readonly float[] _height, _heat;
            public Grid(Landmark lm)
            {
                W = lm.FootW; H = lm.FootH; Wall = new bool[W * H]; Lava = new bool[W * H]; Tier = new int[W * H]; Depth = new float[W * H];
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) Wall[y * W + x] = lm.IsWall(lm.FootX + x, lm.FootY + y);
                // Lava: the non-wall tiles joined (four ways) to the anchor's centre or to an entrance tile.
                var stack = new Stack<int>();
                Seed(lm.Anchor.Centre.X - lm.FootX, lm.Anchor.Centre.Y - lm.FootY, stack);
                foreach (var t in lm.Anchor.Entrance) Seed(t.X - lm.FootX, t.Y - lm.FootY, stack);
                while (stack.Count > 0)
                {
                    int i = stack.Pop(), x = i % W, y = i / W;
                    Seed(x + 1, y, stack); Seed(x - 1, y, stack); Seed(x, y + 1, stack); Seed(x, y - 1, stack);
                }
                // Depth: distance to the nearest tile that is neither wall nor lava (a floor tile in the box, or anything outside it).
                var open = new List<int>();
                for (int i = 0; i < Wall.Length; i++) if (!Wall[i] && !Lava[i]) open.Add(i);
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
                {
                    int i = y * W + x; if (!Wall[i]) continue;
                    float best = Mathf.Min(Mathf.Min(x + 1, W - x), Mathf.Min(y + 1, H - y)); best *= best;
                    foreach (int o in open) { int dx = o % W - x, dy = o / W - y; best = Mathf.Min(best, dx * dx + dy * dy); }
                    Depth[i] = Mathf.Sqrt(best); MaxDepth = Mathf.Max(MaxDepth, Depth[i]);
                }
                for (int i = 0; i < Tier.Length; i++)
                    Tier[i] = !Wall[i] ? -1 : Depth[i] <= .4f * MaxDepth ? VolcanoArt.Foot : Depth[i] <= .8f * MaxDepth ? VolcanoArt.Slope : VolcanoArt.Rim;
                // Smooth fields: the height of the mountain (the crater floor sits below the rim) and the nearness of lava.
                _gw = W + 2 * Pad; _gh = H + 2 * Pad; _height = new float[_gw * _gh]; _heat = new float[_gw * _gh];
                var lavaF = new float[_gw * _gh];
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++)
                {
                    int i = y * W + x, gi = (y + Pad) * _gw + x + Pad;
                    _height[gi] = Wall[i] ? Depth[i] / Mathf.Max(1f, MaxDepth) : Lava[i] ? .55f : 0f;
                    lavaF[gi] = Lava[i] ? 1f : 0f;
                }
                for (int y = 1; y < _gh - 1; y++) for (int x = 1; x < _gw - 1; x++)
                {
                    float s = 0; for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) s += lavaF[(y + dy) * _gw + x + dx];
                    _heat[y * _gw + x] = s / 9f;
                }
            }
            void Seed(int x, int y, Stack<int> stack)
            {
                if (x < 0 || y < 0 || x >= W || y >= H) return;
                int i = y * W + x; if (Wall[i] || Lava[i]) return;
                Lava[i] = true; stack.Push(i);
            }
            public bool IsWall(int x, int y) { return x >= 0 && y >= 0 && x < W && y < H && Wall[y * W + x]; }
            public bool IsLava(int x, int y) { return x >= 0 && y >= 0 && x < W && y < H && Lava[y * W + x]; }
            public int TierAt(int x, int y) { return x >= 0 && y >= 0 && x < W && y < H ? Tier[y * W + x] : -1; }
            float Bilin(float[] g, float u, float v)
            {
                float gx = u - .5f + Pad, gy = v - .5f + Pad; int x0 = Mathf.FloorToInt(gx), y0 = Mathf.FloorToInt(gy);
                if (x0 < 0 || y0 < 0 || x0 + 1 >= _gw || y0 + 1 >= _gh) return 0f;
                float fx = gx - x0, fy = gy - y0;
                return Mathf.Lerp(Mathf.Lerp(g[y0 * _gw + x0], g[y0 * _gw + x0 + 1], fx), Mathf.Lerp(g[(y0 + 1) * _gw + x0], g[(y0 + 1) * _gw + x0 + 1], fx), fy);
            }
            /// <summary>Height of the mountain at footprint-local tile coordinates (u east, v south), 0..1.</summary>
            public float Height(float u, float v) { return Bilin(_height, u, v); }
            /// <summary>Nearness of lava, 0..1 (about .35 at the edge of a lava tile, over a tile's reach).</summary>
            public float Heat(float u, float v) { return Bilin(_heat, u, v); }
        }

        static void Upload(Texture2D tex, Color32[] px) { tex.SetPixels32(px); tex.Apply(false, true); }

        static Texture2D NewTexture(Landmark lm, int w, int h, string name)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false, false) { name = name, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            lm.Own(tex); return tex;
        }

        static SpriteRenderer NewSprite(Landmark lm, Texture2D tex, string name, Vector2 pivot, float ppu, Vector3 position, Vector3 scale, int order)
        {
            var sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), pivot, ppu, 0, SpriteMeshType.FullRect);
            lm.Own(sprite);
            var go = new GameObject(name); go.transform.SetParent(lm.Root.transform, false);
            go.transform.localPosition = position; go.transform.localScale = scale;
            var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = sprite; sr.sharedMaterial = lm.Material; sr.sortingOrder = order;
            return sr;
        }

        // ---- the cone: one strip per wall row, sorted like the walls ----------------------------------------------------------------

        static void BuildCone(Landmark lm, Grid g, List<SpriteRenderer> cone)
        {
            const float Face = .67f, Over = .05f;
            var theme = RegionThemes.Get(RegionId.Fire);
            Color foot = Color.Lerp(theme.WallFace, Outline, .6f), slope = Color.Lerp(theme.WallTop, theme.WallFace, .35f),
                rim = Color.Lerp(theme.WallTop, theme.WallEdge, .15f);
            rim = new Color(Mathf.Min(1f, rim.r * 1.25f + .06f), rim.g * 1.1f, rim.b);
            int fw = g.W, W = fw * Ppt + Ppt, Hpx = Mathf.CeilToInt((Face + Sq + 2 * Over) * Ppt);
            var px = new Color32[W * Hpx]; Color32 clear = Outline; clear.a = 0;
            for (int y = 0; y < g.H; y++)
            {
                bool any = false; for (int x = 0; x < fw && !any; x++) any = g.IsWall(x, y);
                if (!any) continue;
                float py = -(lm.FootY + y + 1) * Sq;                              // the tile row's bottom edge in world space
                for (int j = 0; j < Hpx; j++) for (int i = 0; i < W; i++)
                {
                    float wx = -.5f + (i + .5f) / Ppt, wy = py - Over + (j + .5f) / Ppt;
                    Color32 o = clear;
                    int tx = Mathf.FloorToInt(wx);
                    if (g.IsWall(tx, y))
                    {
                        if (wy >= py + Face)                                       // the cap: the tile seen from above, lifted by the face height
                        {
                            float v = y + 1f - (wy - py - Face) / Sq;
                            float up = g.IsWall(tx, y - 1) ? .1f : 0f;                 // overlap the strip to the north so no hairline shows between rows
                            if (v >= y - up && v <= y + 1f) o = Cap(g, wx, Mathf.Clamp(v, y + .001f, y + .999f), tx, y, foot, slope, rim, theme.WallEdge);
                        }
                        else if (wy >= py && !g.IsWall(tx, y + 1))                 // the south face, only where no wall stands south
                            o = FaceColour(g, wx, tx, y, (wy - py) / Face, foot, slope);
                    }
                    px[j * W + i] = o;
                }
                var tex = NewTexture(lm, W, Hpx, "Volcano cone row " + y); Upload(tex, px);
                cone.Add(NewSprite(lm, tex, "Volcano cone row " + y, Vector2.zero, Ppt, new Vector3(lm.FootX - .5f, py - Over, 0), Vector3.one, 2000 + 16 * (lm.FootY + y) + 1));
            }
        }

        /// <summary>The cone seen from above at (u, v) inside wall tile (tx, ty): tier colour, dome shade lit from the north west, steps and lips
        /// where a tier drops, an outline on the cone's outer edge, ember beside lava and a few glowing cracks. Always opaque.</summary>
        static Color32 Cap(Grid g, float u, float v, int tx, int ty, Color foot, Color slope, Color rim, Color emberTheme)
        {
            int tier = g.TierAt(tx, ty); float fu = u - tx, fv = v - ty;
            Color baseC = tier == VolcanoArt.Foot ? foot : tier == VolcanoArt.Slope ? slope : rim;
            float h = g.Height(u, v), e = .3f;
            float lit = Mathf.Clamp((g.Height(u + e, v) - g.Height(u - e, v) + g.Height(u, v + e) - g.Height(u, v - e)) * 1.4f, -.35f, .35f);
            float n = RegionNoise.Periodic(u * 2.1f, v * 2.1f, 61, 71), n2 = RegionNoise.Periodic(u * 7f, v * 7f, 61, 79);
            float k = .85f + lit * .9f + (n - .5f) * .35f + (n2 - .5f) * .14f + (h - .5f) * .25f;
            Color c = new Color(baseC.r * k, baseC.g * k, baseC.b * k);
            // Strata: faint contour lines along the height, so the slopes read as terraced rock.
            float band = Mathf.Abs(Mathf.Repeat(h * 9f, 1f) - .5f);
            if (band > .44f) c = Color.Lerp(c, Outline, .18f);
            // The step where this tier stands above a lower one: a dark rise on the south and east, a lit lip on the north and west.
            int sT = g.TierAt(tx, ty + 1), eT = g.TierAt(tx + 1, ty), nT = g.TierAt(tx, ty - 1), wT = g.TierAt(tx - 1, ty);
            if (sT >= 0 && sT < tier && fv > .68f) c = Color.Lerp(c, Outline, Mathf.Clamp01((fv - .68f) / .32f) * .65f);
            if (eT >= 0 && eT < tier && fu > .8f) c = Color.Lerp(c, Outline, Mathf.Clamp01((fu - .8f) / .2f) * .5f);
            if (nT >= 0 && nT < tier && fv < .14f) c = Color.Lerp(c, Hot, .22f * (1f - fv / .14f));
            if (wT >= 0 && wT < tier && fu < .14f) c = Color.Lerp(c, Hot, .22f * (1f - fu / .14f));
            // The cone's outer edge: a dark outline where the neighbour is not cone, not lava (the lava's own side glows instead).
            float edge = 1f;
            if (!g.IsWall(tx, ty - 1) && !g.IsLava(tx, ty - 1)) edge = Mathf.Min(edge, fv / .09f);
            if (!g.IsWall(tx - 1, ty) && !g.IsLava(tx - 1, ty)) edge = Mathf.Min(edge, fu / .09f);
            if (!g.IsWall(tx + 1, ty) && !g.IsLava(tx + 1, ty)) edge = Mathf.Min(edge, (1f - fu) / .09f);
            if (!g.IsWall(tx, ty + 1) && !g.IsLava(tx, ty + 1)) edge = Mathf.Min(edge, (1f - fv) / .09f);
            if (edge < 1f) c = Color.Lerp(Outline, c, Mathf.Clamp01(edge));
            // Ember: the rock beside lava is scorched and lit from below; a crack here and there on the high ground.
            float heat = Mathf.Clamp01((g.Heat(u, v) - .12f) * 3.2f);
            if (heat > 0f)
            {
                float flick = .75f + .25f * RegionNoise.Periodic(u * 5f, v * 5f, 61, 83);
                c = Color.Lerp(c, Color.Lerp(Ember, Hot, heat * heat), Mathf.Clamp01(heat * heat * .85f * flick));
            }
            else if (tier >= VolcanoArt.Slope)
            {
                float crack = 1f - Mathf.Abs(2f * RegionNoise.Periodic(u * 1.6f, v * 1.6f, 61, 97) - 1f);
                if (crack > .965f) c = Color.Lerp(c, Ember, (crack - .965f) / .035f * (tier == VolcanoArt.Rim ? .9f : .55f));
            }
            Color32 o = c; o.a = 255; return o;
        }

        /// <summary>The south face at height fraction k (0 at the ground): dark basalt, or, where it looks onto lava (the crater's inner wall,
        /// or a channel's bank), a rock face lit from below by the lava.</summary>
        static Color32 FaceColour(Grid g, float u, int tx, int ty, float k, Color foot, Color slope)
        {
            float n = RegionNoise.Periodic(u * 3f, k * 3f, 61, 23);
            float fu = u - tx;
            Color c = Color.Lerp(Outline, Color.Lerp(foot, slope, .35f), Mathf.Clamp01(.3f + k * .75f + (n - .5f) * .3f));
            if (g.IsLava(tx, ty + 1))
            {
                float glow = Mathf.Clamp01(1f - k * 1.5f) * (.7f + .3f * n);
                c = Color.Lerp(c, Color.Lerp(Ember, Hot, glow * glow), glow * .8f);
            }
            if (fu < .05f || fu > .95f) c = Color.Lerp(c, Outline, .45f);
            Color32 o = c; o.a = 255; return o;
        }

        // ---- the crust on the lava's edges: banks and the shade the crater wall throws -------------------------------------------------

        static void BuildCrust(Landmark lm, Grid g)
        {
            const int P = 12;
            int W = g.W * P, H = g.H * P; var px = new Color32[W * H];
            Color32 clear = Outline; clear.a = 0;
            for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
            {
                float u = (i + .5f) / P, v = g.H - (j + .5f) / P;                // texture row 0 is the south edge
                int tx = Mathf.FloorToInt(u), ty = Mathf.Min(g.H - 1, Mathf.FloorToInt(v));
                Color32 o = clear;
                if (g.IsLava(tx, ty))
                {
                    float fu = u - tx, fv = v - ty, a = 0;
                    // Walls: the crust is thickest under a wall to the north (its face drops into the lava) and thin beside the others.
                    if (!g.IsLava(tx, ty - 1)) a = Mathf.Max(a, .62f * Mathf.Clamp01(1f - fv / .5f));
                    if (!g.IsLava(tx - 1, ty)) a = Mathf.Max(a, .4f * Mathf.Clamp01(1f - fu / .3f));
                    if (!g.IsLava(tx + 1, ty)) a = Mathf.Max(a, .3f * Mathf.Clamp01(1f - (1f - fu) / .22f));
                    if (!g.IsLava(tx, ty + 1)) a = Mathf.Max(a, .3f * Mathf.Clamp01(1f - (1f - fv) / .22f));
                    if (a > 0f)
                    {
                        float n = RegionNoise.Periodic(u * 4f, v * 4f, 61, 53);
                        Color c = Color.Lerp(new Color(.05f, .02f, .02f), new Color(.30f, .08f, .04f), n * .6f);
                        c.a = Mathf.Clamp01(a * (.85f + .3f * n)); o = c;
                    }
                }
                px[j * W + i] = o;
            }
            var tex = NewTexture(lm, W, H, "Volcano banks"); Upload(tex, px);
            float cx = lm.FootX + g.W / 2f, cy = -(lm.FootY + g.H / 2f) * Sq;
            NewSprite(lm, tex, "Volcano banks and crater shade", new Vector2(.5f, .5f), P, new Vector3(cx, cy, 0), new Vector3(1f, Sq, 1f), -80);
        }

        // ---- the glows ----------------------------------------------------------------------------------------------------------------

        static Texture2D RadialGlow(Landmark lm, string name, Color inner, Color outer, float strength)
        {
            const int S = 64; var tex = NewTexture(lm, S, S, name); var px = new Color32[S * S];
            for (int j = 0; j < S; j++) for (int i = 0; i < S; i++)
            {
                float dx = (i + .5f) / (S / 2f) - 1f, dy = (j + .5f) / (S / 2f) - 1f, r = Mathf.Clamp01(Mathf.Sqrt(dx * dx + dy * dy));
                Color c = Color.Lerp(inner, outer, r); c.a = Mathf.Pow(1f - r, 2f) * strength; px[j * S + i] = c;
            }
            Upload(tex, px); return tex;
        }

        static void BuildGlows(Landmark lm, Grid g, List<SpriteRenderer> glow)
        {
            // The lake: the lava tiles whose eight neighbours are lava; the glow is the nearness of lava over that block and a margin.
            int minX = int.MaxValue, maxX = int.MinValue, minY = int.MaxValue, maxY = int.MinValue;
            for (int y = 0; y < g.H; y++) for (int x = 0; x < g.W; x++)
            {
                bool core = g.IsLava(x, y);
                for (int dy = -1; dy <= 1 && core; dy++) for (int dx = -1; dx <= 1 && core; dx++) core = g.IsLava(x + dx, y + dy);
                if (!core) continue;
                minX = Mathf.Min(minX, x); maxX = Mathf.Max(maxX, x); minY = Mathf.Min(minY, y); maxY = Mathf.Max(maxY, y);
            }
            if (maxX >= minX)
            {
                const int P = 10, M = 3;
                float x0 = minX - M, y0 = minY - M, wt = maxX - minX + 1 + 2 * M, ht = maxY - minY + 1 + 2 * M;
                int W = Mathf.CeilToInt(wt * P), H = Mathf.CeilToInt(ht * P);
                var tex = NewTexture(lm, W, H, "Volcano lake glow"); var px = new Color32[W * H];
                for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
                {
                    float u = x0 + (i + .5f) / P, v = y0 + ht - (j + .5f) / P;
                    float heat = Mathf.Clamp01(g.Heat(u, v) * 1.6f - .1f);
                    float fade = Mathf.Clamp01(Mathf.Min(Mathf.Min(i, W - 1 - i), Mathf.Min(j, H - 1 - j)) / (M * P * .5f));
                    float flick = .8f + .2f * RegionNoise.Periodic(u * .8f, v * .8f, 61, 91);
                    Color c = Color.Lerp(Ember, Hot, heat * .6f); c.a = heat * heat * .5f * fade * flick; px[j * W + i] = c;
                }
                Upload(tex, px);
                glow.Add(NewSprite(lm, tex, "Volcano lake glow", new Vector2(.5f, .5f), P, new Vector3(lm.FootX + x0 + wt / 2f, -(lm.FootY + y0 + ht / 2f) * Sq, 0),
                    new Vector3(1f, Sq, 1f), -75));
            }
            // Each outlet: the entrance tiles in runs (four-adjacent), a glow on the run and a little beyond it, on the side the front points to.
            var runs = new List<List<MapTile>>();
            foreach (var t in lm.Anchor.Entrance)
            {
                List<MapTile> run = null;
                foreach (var r in runs) { foreach (var o in r) if (Mathf.Abs(o.X - t.X) + Mathf.Abs(o.Y - t.Y) == 1) { run = r; break; } if (run != null) break; }
                if (run == null) { run = new List<MapTile>(); runs.Add(run); }
                run.Add(t);
            }
            Vector2 f = lm.FrontVector;
            var shared = RadialGlow(lm, "Volcano outlet glow", Hot, Ember, .62f);
            int n = 0;
            foreach (var r in runs)
            {
                float cx = 0, cy = 0; foreach (var t in r) { cx += t.X + .5f; cy += t.Y + .5f; }
                cx /= r.Count; cy /= r.Count;
                float gx = cx + f.x * .6f, gy = cy + f.y * .6f;                    // tile space, south positive
                var sprite = Sprite.Create(shared, new Rect(0, 0, shared.width, shared.height), new Vector2(.5f, .5f), 32f, 0, SpriteMeshType.FullRect);
                lm.Own(sprite);
                var go = new GameObject("Volcano outlet glow " + n++); go.transform.SetParent(lm.Root.transform, false);
                go.transform.localPosition = new Vector3(gx, -gy * Sq, 0); go.transform.localScale = new Vector3(2.4f, 2.4f * Sq, 1f);
                var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = sprite; sr.sharedMaterial = lm.Material; sr.sortingOrder = -75;
                glow.Add(sr);
            }
        }
    }
}

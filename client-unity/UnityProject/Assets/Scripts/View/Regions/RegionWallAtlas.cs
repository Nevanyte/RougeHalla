// Procedural wall and low-obstacle skins, one set per wall style, painted once into a single atlas (one texture and one
// material, so every wall row batches). Colours come from the region themes (palette table). Cell layout per style:
//   Top[3]   128x100  cap of a wall block (periodic, so neighbours join seamlessly)
//   Face[3]  128x86   south face of a wall block (height 0.67 tile)
//   Low[2]   128x132  low obstacle or fence, full tile width so rows of them join, with see-through gaps where authored
//   Rim      128x12   soft highlight strip laid along open top edges
// plus one shared Contact shadow cell. Sizes are 128 px per tile (twice the prop density) to stay crisp up close.
using System.Collections.Generic;
using UnityEngine;
using static Roguehalla.Client.RegionCanvas;

namespace Roguehalla.Client
{
    public static class RegionWallAtlas
    {
        public const int TileW = 128, TopH = 100, FaceH = 86, LowH = 132, RimH = 12, ContactH = 40;
        public const int TopVariants = 3, FaceVariants = 3, LowVariants = 2;

        public readonly struct Cell
        {
            public readonly Vector2 Min, Max;
            public Cell(Vector2 min, Vector2 max) { Min = min; Max = max; }
        }
        public sealed class Set { public Cell[] Top = new Cell[9], Face = new Cell[FaceVariants], Low = new Cell[LowVariants], LowDark = new Cell[LowVariants], LowDeep = new Cell[LowVariants]; public Cell Rim; }
        /// <summary>Fence iron per region id (index 0 unused): true where the dark iron set reads better than the light one against the zone's fence tile ground (measured on the palette: Frost, Holy, Coliseum have light ground).</summary>
        static readonly int[] IronLevelRegion = { 0, 0, 0, 0, 1, 2, 1 };   // 0 light iron, 1 dark iron, 2 deeper dark iron (Holy: mid-luminance ground needs near-black bars for 3:1)
        public static int IronLevelFor(int region) { return region >= 0 && region < IronLevelRegion.Length ? IronLevelRegion[region] : 0; }
        public static Cell[] LowFor(Set set, int ironLevel) { return ironLevel == 2 ? set.LowDeep : ironLevel == 1 ? set.LowDark : set.Low; }

        static Texture2D _atlas; static Set[] _sets; static Cell _contact, _fenceGround;
        public static Texture2D Atlas { get { Ensure(); return _atlas; } }
        public static Set SetFor(WallStyle style) { Ensure(); return _sets[(int)style]; }
        public static Cell Contact { get { Ensure(); return _contact; } }
        /// <summary>A flat decal cell (the fence's iron at alpha .3) drawn over the ground of a fence tile, as legacy drawFenceTile does.</summary>
        public static Cell FenceGround { get { Ensure(); return _fenceGround; } }
        static readonly Color FenceGroundIron = new Color(.11f, .114f, .133f, .3f);   // the single source of the fence tile ground: FenceTileGround and the decal cell both derive from it
        /// <summary>Ground colour (sRGB) under a fence tile for an open floor colour: the iron tint at alpha .3, about 30% darker.</summary>
        public static Color FenceTileGround(Color floorSrgb)
        {
            var c = Color.Lerp(floorSrgb, FenceGroundIron, FenceGroundIron.a); c.a = 1f; return c;
        }

        const int AtlasW = 1024;

        static void Ensure()
        {
            if (_atlas != null) return;
            // Pack: per style a row band: 3 tops + 3 faces on two shelves, lows and rim after.
            int styles = 7;
            int bandH = TopH + 4 + FaceH + 4 + LowH + 4 + 4;   // generous
            int atlasH = 2560;
            var px = new Color32[AtlasW * atlasH];
            _sets = new Set[styles];
            int x = 2, y = 2, rowH = 0;
            Cell Place(RegionCanvas cv, ref int cx, ref int cy, ref int rh)
            {
                int w = cv.W + 4, h = cv.H + 4;
                if (cx + w > AtlasW) { cx = 2; cy += rh; rh = 0; }
                cv.CopyTo(px, AtlasW, cx + 2, cy + 2);
                var c = new Cell(new Vector2((cx + 2f) / AtlasW, (cy + 2f) / atlasH), new Vector2((cx + 2f + cv.W) / AtlasW, (cy + 2f + cv.H) / atlasH));
                cx += w; rh = Mathf.Max(rh, h);
                return c;
            }
            for (int s = 0; s < styles; s++)
            {
                var style = (WallStyle)s; var th = ThemeOf(style); var set = new Set();
                for (int v = 0; v < (style == WallStyle.Temple ? 9 : TopVariants); v++) set.Top[v] = Place(PaintTop(style, th, v), ref x, ref y, ref rowH);
                for (int v = 0; v < FaceVariants; v++) set.Face[v] = Place(PaintFace(style, th, v), ref x, ref y, ref rowH);
                if (style == WallStyle.Temple) { set.Low = _sets[(int)WallStyle.Sandstone].Low; set.LowDark = set.Low; set.LowDeep = set.Low; set.Rim = _sets[(int)WallStyle.Sandstone].Rim; }   // low walls and rims reuse the sandstone cells
                else
                {
                    for (int v = 0; v < LowVariants; v++) set.Low[v] = Place(PaintLow(style, th, v), ref x, ref y, ref rowH);
                    for (int v = 0; v < LowVariants; v++) set.LowDark[v] = style == WallStyle.Timber ? Place(PaintLow(style, th, v, 1), ref x, ref y, ref rowH) : set.Low[v];
                    for (int v = 0; v < LowVariants; v++) set.LowDeep[v] = style == WallStyle.Timber ? Place(PaintLow(style, th, v, 2), ref x, ref y, ref rowH) : set.Low[v];
                    set.Rim = Place(PaintRim(th), ref x, ref y, ref rowH);
                }
                _sets[s] = set;
            }
            _contact = Place(PaintContact(), ref x, ref y, ref rowH);
            // the decal blends over a floor to exactly FenceTileGround(floor): rgb = tint, alpha = FenceGroundIron.a (derived from the function, FenceTileGround(black) = tint * a)
            var tint = FenceTileGround(Color.black); var decal = new Color(tint.r / FenceGroundIron.a, tint.g / FenceGroundIron.a, tint.b / FenceGroundIron.a, FenceGroundIron.a);
            var fg = new RegionCanvas(4, 4); for (int i = 0; i < fg.Px.Length; i++) fg.Px[i] = decal;
            _fenceGround = Place(fg, ref x, ref y, ref rowH);
            _atlas = new Texture2D(AtlasW, atlasH, TextureFormat.RGBA32, true, false) { name = "Region walls atlas", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp, anisoLevel = 2 };
            _atlas.SetPixelData(px, 0); _atlas.Apply(true, !Application.isEditor);
        }

        static RegionTheme ThemeOf(WallStyle style)
        {
            switch (style)
            {
                case WallStyle.Basalt: return RegionThemes.Get(RegionId.Fire);
                case WallStyle.Timber: return RegionThemes.Get(RegionId.Sentenced);
                case WallStyle.Ruin: return RegionThemes.Get(RegionId.Plague);
                case WallStyle.Glacier: return RegionThemes.Get(RegionId.Frost);
                case WallStyle.Sandstone: case WallStyle.Temple: return RegionThemes.Get(RegionId.Holy);
                default: return RegionThemes.Get(RegionId.Coliseum);
            }
        }

        static float N(float u, float v, int period, int seed) { return RegionNoise.Periodic(u * period, v * period, period, seed); }

        // ---- tops -------------------------------------------------------------------------------------------------------------

        static RegionCanvas PaintTop(WallStyle style, RegionTheme th, int variant)
        {
            var cv = new RegionCanvas(TileW, TopH); int seed = 100 + variant * 17 + (int)style * 5;
            Color top = th.WallTop, face = th.WallFace, edge = th.WallEdge;
            for (int y = 0; y < TopH; y++) for (int x = 0; x < TileW; x++)
            {
                float u = (x + .5f) / TileW, v = (y + .5f) / TopH; Color c;
                float soft = N(u, v, 4, seed) * .6f + N(u, v, 8, seed + 1) * .3f + N(u, v, 16, seed + 2) * .1f;
                float grain = (RegionNoise.Hash01(x, y, seed) - .5f);
                switch (style)
                {
                    case WallStyle.Glacier:
                    {
                        // Snow cap with soft wind lumps, blue hollows and a few glints.
                        Color snow = Mix(top, Color.white, .35f), shade = Mix(RegionPaletteSrgb(4, 5), top, .6f);
                        c = Mix(snow, shade, Mathf.Clamp01((.50f - soft) * 2.0f) * .34f);
                        c = Mix(c, Color.white, Mathf.Clamp01((soft - .55f) * 2.5f) * .7f);
                        c = Shade(c, 1f + grain * .03f);
                        if (RegionNoise.Hash01(x, y, seed + 9) > .996f) c = Color.white;
                        // frozen slab seam
                        float seam = Mathf.Min(Mathf.Abs(u - .5f), Mathf.Abs(v - .5f)) * 2f;
                        c = Mix(c, Mix(face, Color.white, .5f), (1f - SmoothU(seam, 0f, .018f)) * .22f);
                        // Block shoulders: blue-shaded edges so each ice block reads as raised.
                        float shoulder = Mathf.Min(Mathf.Min(u, 1f - u), Mathf.Min(v, 1f - v));
                        c = Mix(c, Mix(face, RegionPaletteSrgb(4, 5), .25f), (1f - SmoothU(shoulder, 0f, .07f)) * .38f);
                        break;
                    }
                    case WallStyle.Basalt:
                    {
                        RegionNoise.Worley(u, v, 4, seed, out float f1, out float e, out float id);
                        float crack = 1f - SmoothU(e, 0f, .08f);
                        c = Mix(Mix(top, face, .5f), Mix(top, Color.white, .12f), id * .8f);
                        c = Shade(c, .92f + soft * .2f + grain * .05f);
                        c = Mix(c, Shade(face, .5f), crack * .75f);
                        if (id > .74f) c = Mix(c, edge, crack * .85f);
                        break;
                    }
                    case WallStyle.Timber:      // gothic masonry cap: dark slabs, hairline cracks, a worn chamfer
                    {
                        RegionNoise.Worley(u, v, 2, seed, out float f1, out float e, out float id);
                        float joint = 1f - SmoothU(e, 0f, .06f);
                        c = Mix(Mix(top, face, .35f), Mix(top, Color.white, .08f), id * .8f);
                        c = Shade(c, .88f + soft * .2f + grain * .05f);
                        c = Mix(c, Shade(face, .4f), joint * .7f);
                        float chip = SmoothU(N(u, v, 10, seed + 7), .72f, .86f);
                        c = Mix(c, Shade(top, .7f), chip * .35f);
                        break;
                    }
                    case WallStyle.Ruin:
                    {
                        Color stone = Mix(face, new Color(.62f, .64f, .58f), .35f); Color moss = Mix(top, th.AccentSrgb, .12f);
                        RegionNoise.Worley(u, v, 3, seed, out float f1, out float e, out float id);
                        float joint = 1f - SmoothU(e, 0f, .07f);
                        float mossMask = SmoothU(soft + joint * .15f, .45f, .62f);
                        c = Mix(Shade(stone, .9f + id * .2f), Shade(stone, .5f), joint * .7f);
                        c = Mix(c, Mix(moss, Shade(moss, 1.25f), soft), mossMask);
                        c = Shade(c, 1f + grain * .05f);
                        break;
                    }
                    case WallStyle.Temple:      // pier cap, 3 x 3 cells: cut ashlar masonry with a coping, arch springers (voussoir fans) at the middle of each side and the engaged columns' tops at the corners
                    {
                        Color stone = TempleStyle.Stone, light = TempleStyle.StoneLight, dark = TempleStyle.StoneDark, gilt = TempleStyle.Gilt;
                        int pc = variant % 3, pr = variant / 3; float U = (pc + u) / 3f, V = (2 - pr + v) / 3f;
                        float e = Mathf.Min(Mathf.Min(U, 1f - U), Mathf.Min(V, 1f - V));
                        float rv = V * 6f; int rrow = (int)Mathf.Floor(rv); float fy = rv - rrow;
                        float ru = U * 3f + (rrow % 2 == 0 ? 0f : .5f); int ccol = (int)Mathf.Floor(ru); float fx = ru - ccol;
                        float tone = RegionNoise.Hash01(ccol + rrow * 7, 3, 11);
                        c = Mix(stone, Shade(stone, .93f), tone) ; c = Shade(c, .98f + soft * .05f + grain * .02f);
                        float joint = 1f - SmoothU(Mathf.Min(Mathf.Min(fx, 1f - fx) * .6f, Mathf.Min(fy, 1f - fy)), 0f, .05f);
                        c = Mix(c, dark, joint * .28f);
                        c = Mix(c, light, (1f - SmoothU(e, 0f, .042f)) * .8f);                       // coping
                        c = Mix(c, dark, (1f - SmoothU(Mathf.Abs(e - .062f), 0f, .007f)) * .45f);     // shadow groove under it
                        for (int sd = 0; sd < 4; sd++)                                               // springers: a fan of voussoirs on each side
                        {
                            float la = sd < 2 ? U - .5f : V - .5f, lb = sd == 0 ? 1f - V : sd == 1 ? V : sd == 2 ? U : 1f - U;
                            float rr2 = Mathf.Sqrt(la * la + lb * lb);
                            if (rr2 < .085f || rr2 > .2f) continue;
                            float th2 = Mathf.Atan2(lb, la) * 7f / Mathf.PI, jf = Mathf.Abs(th2 - Mathf.Round(th2));
                            c = Mix(c, light, .5f);
                            c = Mix(c, dark, (1f - SmoothU(jf, 0f, .09f)) * .4f);
                            c = Mix(c, dark, (1f - SmoothU(Mathf.Abs(rr2 - .085f), 0f, .006f)) * .55f);
                            c = Mix(c, dark, (1f - SmoothU(Mathf.Abs(rr2 - .2f), 0f, .006f)) * .45f);
                        }
                        float cu = Mathf.Min(U, 1f - U), cvv = Mathf.Min(V, 1f - V);                 // engaged column tops at the corners
                        float rc = Mathf.Sqrt((cu - .1f) * (cu - .1f) + (cvv - .1f) * (cvv - .1f));
                        if (cu < .2f && cvv < .2f)
                        {
                            c = Mix(c, light, (1f - SmoothU(rc, .05f, .056f)) * .85f);
                            c = Mix(c, gilt, (1f - SmoothU(Mathf.Abs(rc - .04f), 0f, .006f)) * .55f);
                            c = Mix(c, dark, (1f - SmoothU(Mathf.Abs(rc - .056f), 0f, .005f)) * .5f);
                        }
                        break;
                    }
                    case WallStyle.Sandstone:
                    {
                        float bu = Mathf.Floor(u * 2f), bv = Mathf.Floor(v * 2f); float fx = u * 2f - bu, fy = v * 2f - bv;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx), Mathf.Min(fy, 1f - fy));
                        float tone = RegionNoise.Hash01((int)bu, (int)bv, seed);
                        c = Mix(top, Shade(top, .86f), tone) ; c = Shade(c, .96f + soft * .1f + grain * .04f);
                        c = Mix(c, Shade(face, .6f), 1f - SmoothU(e, 0f, .03f));
                        c = Mix(c, edge, (1f - SmoothU(Mathf.Min(Mathf.Min(u, 1f - u), Mathf.Min(v, 1f - v)), 0f, .045f)) * .5f);
                        break;
                    }
                    default:
                    {
                        float bu = Mathf.Floor(u * 2f), bv = Mathf.Floor(v * 2f); float fx = u * 2f - bu, fy = v * 2f - bv;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx), Mathf.Min(fy, 1f - fy));
                        float tone = RegionNoise.Hash01((int)bu, (int)bv, seed);
                        c = Shade(Mix(top, Shade(top, .9f), tone), .97f + soft * .08f + grain * .04f);
                        c = Mix(c, Shade(face, .55f), 1f - SmoothU(e, 0f, .03f));
                        break;
                    }
                }
                c.a = 1f; cv.Px[y * TileW + x] = c;
            }
            return cv;
        }

        // ---- faces ------------------------------------------------------------------------------------------------------------

        static RegionCanvas PaintFace(WallStyle style, RegionTheme th, int variant)
        {
            var cv = new RegionCanvas(TileW, FaceH); int seed = 300 + variant * 13 + (int)style * 7;
            Color face = th.WallFace, top = th.WallTop, edge = th.WallEdge;
            for (int y = 0; y < FaceH; y++) for (int x = 0; x < TileW; x++)
            {
                float u = (x + .5f) / TileW, v = (y + .5f) / FaceH;   // v: 0 at the base, 1 at the top lip
                float soft = N(u, v, 4, seed) * .6f + N(u, v, 10, seed + 1) * .4f;
                float grain = RegionNoise.Hash01(x, y, seed) - .5f;
                float vert = Mathf.Lerp(.72f, 1.08f, v);              // lit toward the top, grounded at the bottom
                Color c;
                switch (style)
                {
                    case WallStyle.Glacier:
                    {
                        // Glacier rock blocks, icy sheen, snow banked at the base, icicles under the cap.
                        float rows = 2f, rv = v * rows; float row = Mathf.Floor(rv); float fy = rv - row;
                        float colOff = row % 2 == 0 ? 0f : .33f; float ru = (u + colOff) * 3f; float col = Mathf.Floor(ru); float fx = ru - col;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx) / 3f * 3.2f, Mathf.Min(fy, 1f - fy) * .6f);
                        float tone = RegionNoise.Hash01((int)col + (int)row * 7, 2, seed);
                        c = Mix(Shade(face, .8f), Mix(face, Color.white, .30f), tone * .8f + (fx < .5f ? 0f : -.1f) * 0f);
                        c = Shade(c, vert);
                        float sheen = SmoothU(Mathf.Abs(Mathf.Sin((u * 3.1f + v * 1.7f + tone) * 3.14159f * 1.5f)), .86f, 1f);
                        c = Mix(c, Color.white, sheen * .22f);
                        c = Mix(c, Mix(th.AccentSrgb, face, .4f), Mathf.Clamp01((.5f - soft) * .6f) * .25f);
                        c = Mix(c, Shade(face, .42f), 1f - SmoothU(e, 0f, .045f));
                        // snow bank at the foot
                        float bank = SmoothU(.14f + (N(u, 0.3f, 8, seed + 4) - .5f) * .16f - v, 0f, .12f);
                        c = Mix(c, Mix(top, Color.white, .5f), bank);
                        // icicles from the lip
                        float ic = 0f; float cu = u * 9f; float ci = Mathf.Floor(cu); float cf = cu - ci;
                        float len = .10f + RegionNoise.Hash01((int)ci, 5, seed) * .32f; if (RegionNoise.Hash01((int)ci, 6, seed) < .55f) len *= .0f;
                        float half = (1f - SmoothU(1f - v, 0f, len)) * .34f;
                        if (Mathf.Abs(cf - .5f) < half && 1f - v < len) ic = 1f;
                        c = Mix(c, Mix(Mix(th.AccentSrgb, Color.white, .6f), Color.white, v * .3f), ic * .9f);
                        break;
                    }
                    case WallStyle.Basalt:
                    {
                        // Hexagonal basalt columns, lit on the left of each column, glowing seams.
                        float cols = 6f; float ru = (u + RegionNoise.Hash01((int)(v * 3f), 3, seed) * .0f) * cols; float col = Mathf.Floor(ru); float fx = ru - col;
                        float tone = RegionNoise.Hash01((int)col, 1, seed);
                        c = Mix(Mix(face, top, .15f), Mix(face, top, .6f), tone * .7f);
                        c = Mix(Shade(c, .72f), Shade(c, 1.28f), SmoothU(1f - fx, .1f, 1f));
                        c = Shade(c, vert * (.94f + soft * .12f) + grain * .05f);
                        float seam = 1f - SmoothU(Mathf.Min(fx, 1f - fx), 0f, .07f);
                        c = Mix(c, Shade(face, .4f), seam);
                        float hot = RegionNoise.Hash01((int)col, 4, seed) > .6f ? 1f : 0f;
                        c = Mix(c, Mix(edge, Color.white, .15f), seam * hot * SmoothU(N(u, v, 6, seed + 3), .35f, .7f) * .9f);
                        break;
                    }
                    case WallStyle.Timber:      // dark gothic masonry: ashlar courses, buttress pilasters, blind pointed arches
                    {
                        float rows = 3f, rv = v * rows; float row = Mathf.Floor(rv); float fy = rv - row;
                        float ru = (u + (row % 2 == 0 ? 0f : .25f)) * 2f; float col = Mathf.Floor(ru); float fx = ru - col;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx) * .55f, Mathf.Min(fy, 1f - fy));
                        float tone = RegionNoise.Hash01((int)col + (int)row * 5, 2, seed);
                        c = Shade(Mix(Shade(face, .86f), Shade(face, 1.16f), tone), vert + grain * .05f);
                        c = Mix(c, Shade(face, .42f), 1f - SmoothU(e, 0f, .05f));
                        // buttress pilasters at both edges: chamfered, lighter on the lit side
                        float ed = Mathf.Min(u, 1f - u);
                        float butt = 1f - SmoothU(ed, .085f, .105f);
                        c = Mix(c, Shade(face, u < .5f ? 1.35f : .78f), butt * .9f);
                        c = Mix(c, Shade(face, .3f), (1f - SmoothU(Mathf.Abs(ed - .095f), 0f, .012f)) * .8f);
                        // a blind pointed arch recess in some tiles
                        if (RegionNoise.Hash01(variant, 4, seed) > .35f)
                        {
                            float ax = Mathf.Abs(u - .5f); float apex = .74f - ax * 1.9f;
                            bool inside = ax < .2f && v > .1f && v < apex;
                            float rimD = Mathf.Min(.2f - ax, apex - v);
                            if (inside) c = Mix(Shade(face, .5f), Shade(c, .62f), SmoothU(rimD, 0f, .05f) * .0f + .35f);
                            float line = 1f - SmoothU(Mathf.Abs(rimD), 0f, .022f);
                            if (ax < .22f && v > .08f && v < apex + .03f) c = Mix(c, u < .5f ? Shade(face, 1.4f) : Shade(face, .28f), line * .75f);
                        }
                        // stained base and a moulding line under the cap
                        c = Mix(c, Shade(face, .55f), SmoothU(.2f - v, 0f, .2f) * .5f);
                        c = Mix(c, Shade(face, 1.3f), (1f - SmoothU(Mathf.Abs(v - .86f), 0f, .02f)) * .55f);
                        break;
                    }
                    case WallStyle.Ruin:
                    {
                        float rows = 4f, rv = v * rows; float row = Mathf.Floor(rv); float fy = rv - row;
                        float ru = (u + (row % 2 == 0 ? 0f : .25f)) * 2f; float col = Mathf.Floor(ru); float fx = ru - col;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx) * .55f, Mathf.Min(fy, 1f - fy));
                        float tone = RegionNoise.Hash01((int)col + (int)row * 5, 2, seed);
                        Color stone = Mix(face, new Color(.60f, .62f, .56f), .35f);
                        c = Shade(Mix(Shade(stone, .85f), Shade(stone, 1.12f), tone), vert + grain * .06f);
                        c = Mix(c, Shade(stone, .4f), 1f - SmoothU(e, 0f, .06f));
                        // moss creeping down from the top and up from the base; ivy strands
                        float mossTop = SmoothU(v + (soft - .5f) * .5f, .70f, .90f), mossBase = SmoothU(.22f + (soft - .5f) * .3f - v, 0f, .2f);
                        Color mossC = Mix(th.SecondarySrgbColor(), Color.white, .12f + soft * .15f);
                        c = Mix(c, mossC, Mathf.Max(mossTop, mossBase) * .9f);
                        float strand = (RegionNoise.Hash01((int)(u * 7f), 8, seed) > .55f ? 1f : 0f) * SmoothU(Mathf.Abs((u * 7f - Mathf.Floor(u * 7f)) - .5f + (N(u, v, 8, seed) - .5f) * .6f), .16f, .1f) * SmoothU(v, .25f, .9f);
                        c = Mix(c, Shade(mossC, .75f), strand * .85f);
                        break;
                    }
                    case WallStyle.Temple:      // pier face, 3 cells = one 3 tile elevation: base plinth, engaged fluted columns at the corners with bases and capitals, a blind pointed arch springing from impost blocks, a cornice
                    {
                        Color stone = TempleStyle.Stone, light = TempleStyle.StoneLight, dark = TempleStyle.StoneDark, gilt = TempleStyle.Gilt;
                        float U = (variant + u) / 3f, dx = Mathf.Abs(U - .5f);
                        c = Shade(Mix(Shade(stone, .95f), Shade(stone, 1.05f), RegionNoise.Hash01((int)(U * 9f), (int)(v * 5f), seed)), vert + grain * .03f);
                        float rowsT = 5f, rvT = v * rowsT; float fyT = rvT - Mathf.Floor(rvT);
                        float ruT = U * 9f + ((int)Mathf.Floor(rvT) % 2 == 0 ? 0f : .5f); float fxT = ruT - Mathf.Floor(ruT);
                        c = Mix(c, dark, (1f - SmoothU(Mathf.Min(Mathf.Min(fxT, 1f - fxT) * .5f, Mathf.Min(fyT, 1f - fyT)), 0f, .05f)) * .22f);
                        float springV = .50f, archTop = springV + (.27f - dx) * 1.15f;
                        bool recess = dx < .27f && v > .13f && v < archTop;
                        if (recess) c = Mix(c, Shade(dark, 1.05f), .5f + (1f - v) * .15f);
                        float rimD = Mathf.Min(.27f - dx, (archTop - v) * .7f);
                        if (dx < .29f && v > .13f && v < archTop + .04f) c = Mix(c, light, (1f - SmoothU(Mathf.Abs(rimD + .012f), 0f, .012f)) * .7f);
                        if (dx > .25f && dx < .31f && v > .45f && v < .55f) c = Mix(c, light, .6f);          // impost blocks
                        float cd = Mathf.Abs(U - (U < .5f ? .07f : .93f)), colW = .05f;
                        if (cd < colW)
                        {
                            float t2 = cd / colW, flute = .8f + .26f * Mathf.Cos(t2 * Mathf.PI * 3f) * .5f;
                            c = Shade(Mix(stone, Color.white, .12f), flute * (U < .5f ? 1.06f - t2 * .22f : .86f + t2 * .18f));
                            if (v > .80f && v < .90f) c = Mix(c, gilt, .55f);                                   // capital
                            if (v < .13f) c = Mix(c, dark, .35f);                                               // base
                        }
                        else if (cd < colW + .012f) c = Mix(c, dark, .5f);
                        if (v < .13f) { c = Mix(c, dark, .22f); if (v > .11f) c = Mix(c, light, .6f); }          // plinth with a lit moulding
                        if (v > .90f) c = Mix(c, light, .6f);                                                   // cornice
                        c = Mix(c, gilt, (1f - SmoothU(Mathf.Abs(v - .895f), 0f, .014f)) * .55f);
                        break;
                    }
                    case WallStyle.Sandstone:
                    {
                        float rows = 2f, rv = v * rows; float row = Mathf.Floor(rv); float fy = rv - row;
                        float ru = (u + (row % 2 == 0 ? 0f : .25f)) * 2f; float col = Mathf.Floor(ru); float fx = ru - col;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx) * .55f, Mathf.Min(fy, 1f - fy));
                        float tone = RegionNoise.Hash01((int)col + (int)row * 5, 2, seed);
                        c = Shade(Mix(Shade(face, .93f), Shade(face, 1.1f), tone), vert + grain * .05f);
                        c = Mix(c, Shade(face, .55f), 1f - SmoothU(e, 0f, .05f));
                        // gilded band under the cap
                        float band = SmoothU(Mathf.Abs(v - .82f), .09f, .06f);
                        c = Mix(c, Mix(edge, Color.white, v > .82f ? .25f : 0f), band * .95f);
                        break;
                    }
                    default:
                    {
                        float rows = 3f, rv = v * rows; float row = Mathf.Floor(rv); float fy = rv - row;
                        float ru = (u + (row % 2 == 0 ? 0f : .25f)) * 2f; float col = Mathf.Floor(ru); float fx = ru - col;
                        float e = Mathf.Min(Mathf.Min(fx, 1f - fx) * .55f, Mathf.Min(fy, 1f - fy));
                        float tone = RegionNoise.Hash01((int)col + (int)row * 5, 2, seed);
                        c = Shade(Mix(Shade(face, .94f), Shade(face, 1.1f), tone), vert + grain * .04f);
                        c = Mix(c, Shade(face, .5f), 1f - SmoothU(e, 0f, .05f));
                        break;
                    }
                }
                // bright lip where the face meets the cap
                c = Mix(c, Mix(top, Color.white, .25f), SmoothU(v, .93f, 1f) * .55f);
                c.a = 1f; cv.Px[y * TileW + x] = c;
            }
            return cv;
        }

        // ---- low obstacles ------------------------------------------------------------------------------------------------------

        static RegionCanvas PaintLow(WallStyle style, RegionTheme th, int variant, int ironLevel = 0)
        {
            var cv = new RegionCanvas(TileW, LowH); int seed = 500 + variant * 11 + (int)style * 3;
            Color face = th.WallFace, top = th.WallTop, edge = th.WallEdge;
            float baseY = 6f, bodyH = 36f;       // full-width block: face height ~0.28 tile, then a cap
            if (style == WallStyle.Timber)
            {
                // Graveyard fence: wrought-iron railings with spear finials between stone posts (see-through), or, on some tiles, a low
                // crumbling stone wall. Continuous across tiles (bars repeat every 8 px; the 128 px tile ends on a post).
                Color iron = Mix(new Color(.52f, .53f, .59f), th.AccentSrgb, .12f), ironL = Mix(iron, Color.white, .22f);
                if (ironLevel > 0) { iron = Mix(new Color(.09f, .09f, .12f), th.AccentSrgb, .12f); if (ironLevel > 1) iron = Shade(iron, .35f); ironL = Mix(iron, Color.black, .25f); }   // for light grounds: dark bars, rails a touch darker still
                Color stone = Mix(th.WallFace, th.WallTop, .4f), stoneL = Mix(stone, Color.white, .25f), stoneD = Shade(stone, .5f);
                if (variant % 3 == 2)
                {
                    int n = 9; var pts = new System.Collections.Generic.List<Vector2> { new Vector2(0, baseY) };
                    for (int k = 0; k <= n; k++) pts.Add(new Vector2(k * 128f / n, baseY + 26f + RegionNoise.Hash01(k + variant * 5, 3, seed) * 22f));
                    pts.Add(new Vector2(128, baseY));
                    var wall = Poly(pts.ToArray());
                    cv.Fill(wall, Toon(wall, stoneD, stone, stoneL, 10f, .12f, seed), Ink, 1.3f);
                    for (int k = 0; k < 3; k++) cv.Fill(Intersect(wall, Box(64, baseY + 10f + k * 14f, 66f, .7f)), Flat(Alpha(stoneD, .8f)));
                    for (int k = 0; k < 7; k++) cv.Fill(Intersect(wall, Box(10f + k * 18f + (k % 2) * 6f, baseY + 20f, .7f, 10f)), Flat(Alpha(stoneD, .7f)));
                    return cv;
                }
                for (int k = 0; k < 16; k++)
                {
                    float x = 4f + k * 8f; float top2 = baseY + 52f + RegionNoise.Hash01(k, 1, seed) * 3f;
                    var bar = Box(x, baseY + 28f, 1.1f, 26f); cv.Fill(bar, Flat(iron), null);
                    var spear = Poly(new Vector2(x - 2.4f, top2 - 1f), new Vector2(x, top2 + 9f), new Vector2(x + 2.4f, top2 - 1f), new Vector2(x, top2 - 3f));
                    cv.Fill(spear, Split(x, ironL, iron, 1f), Ink, .9f);
                }
                foreach (float ry in new[] { 20f, 44f }) cv.Fill(Box(64, baseY + ry, 66, 1.8f), Flat(ironL), Ink, .9f);
                foreach (float px in new[] { 4f, 124f })
                {
                    var post = Box(px, baseY + 30f, 5.5f, 31f, 1.5f); cv.Fill(post, Toon(post, stoneD, stone, stoneL, 5f, .1f, seed), Ink, 1.2f);
                    var cap = Box(px, baseY + 62f, 7.5f, 4f, 1f); cv.Fill(cap, Toon(cap, stoneD, stoneL, Mix(stoneL, Color.white, .3f), 3f), Ink, 1.1f);
                }
                return cv;
            }
            Color mossC = th.SecondarySrgbColor();
            var body = Box(64, baseY + bodyH / 2f, 66f, bodyH / 2f, 3f);
            // Cap (the visible top of the low block) sits above the face.
            var capS = Box(64, baseY + bodyH + 24f, 66f, 24f, 8f);
            Color faceC = style == WallStyle.Glacier ? Mix(face, Color.white, .12f) : face;
            cv.Fill(body, (x, y, d) => Shade(Mix(faceC, Shade(faceC, 1.15f), Mathf.Clamp01((y - baseY) / bodyH)), .85f + .2f * RegionNoise.Periodic(x * .15f, y * .15f, 1024, seed)), Ink, 1.3f);
            for (int k = 0; k < 4; k++) cv.Fill(Intersect(body, Box(16 + k * 32 + (variant * 9) % 16, baseY + bodyH / 2f, .7f, bodyH / 2f)), Flat(Alpha(Shade(face, .45f), .7f)));
            Color topC = style == WallStyle.Glacier ? Mix(top, Color.white, .35f) : top;
            Color topD = style == WallStyle.Glacier ? Mix(RegionPaletteSrgb(4, 5), top, .55f) : Shade(top, .78f);
            cv.Fill(capS, Dome(capS, topD, topC, Mix(topC, Color.white, .4f), 12f, .06f, seed, 0f, .2f), Ink, 1.3f);
            if (style == WallStyle.Ruin) cv.Fill(Intersect(capS, Box(64, baseY + bodyH + 36f, 66f, 14f)), Toon(capS, Shade(mossC, .6f), mossC, Mix(mossC, Color.white, .3f), 8f, .1f, seed + 4), null);
            if (style == WallStyle.Basalt) cv.Fill(Capsule(new Vector2(20, baseY + 22), new Vector2(102, baseY + 24), 1.2f, 1.2f), Flat(Mix(edge, Color.white, .1f)));
            if (style == WallStyle.Sandstone) cv.Fill(Box(64, baseY + bodyH + 3f, 66f, 3f), Toon(capS, Shade(edge, .7f), edge, Mix(edge, Color.white, .5f), 3f), null);
            return cv;
        }

        static RegionCanvas PaintRim(RegionTheme th)
        {
            var cv = new RegionCanvas(TileW, RimH);
            Color rim = Mix(th.WallEdge, Color.white, .35f);
            for (int y = 0; y < RimH; y++) for (int x = 0; x < TileW; x++)
            {
                float t = y / (RimH - 1f); Color c = rim; c.a = Mathf.Pow(1f - t, 1.6f) * .55f;
                if (y < 2) { c = Shade(th.WallEdge, .35f); c.a = .75f; }          // crisp dark outline on the very outer edge
                cv.Px[y * TileW + x] = c;
            }
            return cv;
        }
        static RegionCanvas PaintContact()
        {
            var cv = new RegionCanvas(TileW, ContactH);
            for (int y = 0; y < ContactH; y++) for (int x = 0; x < TileW; x++)
            {
                float t = y / (ContactH - 1f); cv.Px[y * TileW + x] = new Color(.04f, .05f, .09f, Mathf.Pow(t, 1.5f) * .42f);   // dark at the wall, fading away south
            }
            return cv;
        }

        static float SmoothU(float v, float a, float b) { float t = Mathf.Clamp01((v - a) / (b - a)); return t * t * (3f - 2f * t); }
        static Color RegionPaletteSrgb(int region, int slot) { return RegionPaletteGenerated.Srgb[region][slot]; }
        static readonly Color Ink = new Color(.05f, .06f, .10f, .85f);
        static Shader2 Toon(Sdf s, Color dark, Color mid, Color light, float r, float grain = 0f, int seed = 1) { return Dome(s, dark, mid, light, r, grain, seed); }
    }

    static class RegionThemeExt
    {
        public static Color SecondarySrgbColor(this RegionTheme th) { return th.SecondarySrgb; }
    }
}

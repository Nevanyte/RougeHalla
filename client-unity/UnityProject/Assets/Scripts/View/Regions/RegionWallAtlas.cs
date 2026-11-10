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
        public sealed class Set { public Cell[] Top = new Cell[TopVariants], Face = new Cell[FaceVariants], Low = new Cell[LowVariants]; public Cell Rim; }

        static Texture2D _atlas; static Set[] _sets; static Cell _contact;
        public static Texture2D Atlas { get { Ensure(); return _atlas; } }
        public static Set SetFor(WallStyle style) { Ensure(); return _sets[(int)style]; }
        public static Cell Contact { get { Ensure(); return _contact; } }

        const int AtlasW = 1024;

        static void Ensure()
        {
            if (_atlas != null) return;
            // Pack: per style a row band: 3 tops + 3 faces on two shelves, lows and rim after.
            int styles = 6;
            int bandH = TopH + 4 + FaceH + 4 + LowH + 4 + 4;   // generous
            int atlasH = 2048;
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
                for (int v = 0; v < TopVariants; v++) set.Top[v] = Place(PaintTop(style, th, v), ref x, ref y, ref rowH);
                for (int v = 0; v < FaceVariants; v++) set.Face[v] = Place(PaintFace(style, th, v), ref x, ref y, ref rowH);
                for (int v = 0; v < LowVariants; v++) set.Low[v] = Place(PaintLow(style, th, v), ref x, ref y, ref rowH);
                set.Rim = Place(PaintRim(th), ref x, ref y, ref rowH);
                _sets[s] = set;
            }
            _contact = Place(PaintContact(), ref x, ref y, ref rowH);
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
                case WallStyle.Sandstone: return RegionThemes.Get(RegionId.Holy);
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
                    case WallStyle.Timber:
                    {
                        float plank = Mathf.Floor(v * 5f); float pv = v * 5f - plank;
                        float tone = RegionNoise.Hash01((int)plank, 1, seed);
                        float g = N(u + tone, v, 6, seed + 3);
                        c = Mix(Mix(top, face, .4f), top, tone * .8f);
                        c = Shade(c, .88f + g * .22f + grain * .04f);
                        c = Mix(c, Shade(face, .45f), 1f - SmoothU(Mathf.Min(pv, 1f - pv), 0f, .05f));
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
                    case WallStyle.Timber:
                    {
                        float planks = 8f; float ru = u * planks; float col = Mathf.Floor(ru); float fx = ru - col;
                        float tone = RegionNoise.Hash01((int)col, 1, seed);
                        float g = N(u * 1f, v * 3f + tone * 5f, 8, seed + 2);
                        c = Mix(Shade(face, .8f), Mix(face, top, .5f), tone);
                        c = Shade(c, vert * (.86f + g * .26f) + grain * .04f);
                        c = Mix(c, Shade(face, .36f), 1f - SmoothU(Mathf.Min(fx, 1f - fx), 0f, .08f));
                        // iron nails
                        float nailY = Mathf.Abs(v - .25f) < .03f || Mathf.Abs(v - .75f) < .03f ? 1f : 0f; float nailX = Mathf.Abs(fx - .5f) < .1f ? 1f : 0f;
                        if (nailY * nailX > 0) c = Mix(c, new Color(.14f, .13f, .13f), .8f);
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

        static RegionCanvas PaintLow(WallStyle style, RegionTheme th, int variant)
        {
            var cv = new RegionCanvas(TileW, LowH); int seed = 500 + variant * 11 + (int)style * 3;
            Color face = th.WallFace, top = th.WallTop, edge = th.WallEdge;
            float baseY = 6f, bodyH = 36f;       // full-width block: face height ~0.28 tile, then a cap
            if (style == WallStyle.Timber)
            {
                // Fence: two posts and rails with picket gaps (see-through), continuous across tiles.
                Color wood = th.WallFace, woodL = Mix(wood, th.WallTop, .5f), woodD = Shade(wood, .55f);
                for (int k = 0; k < 6; k++)
                {
                    float x = 10f + k * 21.5f; float h = 52f + RegionNoise.Hash01(k, 1, seed) * 8f;
                    var pk = Poly(new Vector2(x - 6, baseY + 24), new Vector2(x - 6, baseY + h - 7), new Vector2(x, baseY + h + 3), new Vector2(x + 6, baseY + h - 7), new Vector2(x + 6, baseY + 24));
                    cv.Fill(pk, Split(x, woodL, wood, 3f), Ink, 1.1f);
                }
                foreach (float ry in new[] { 40f, 58f }) cv.Fill(Box(64, baseY + ry, 66, 3.6f), Toon(Box(64, baseY + ry, 66, 3.6f), woodD, wood, woodL, 3f, .08f, seed), Ink, 1.1f);
                foreach (float px in new[] { 6f, 122f }) { var post = Box(px, baseY + 36, 5.5f, 38f, 1.5f); cv.Fill(post, Toon(post, woodD, wood, woodL, 5f, .1f, seed), Ink, 1.2f); }
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
                float t = y / (RimH - 1f); Color c = rim; c.a = Mathf.Pow(1f - t, 1.6f) * .55f; cv.Px[y * TileW + x] = c;
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

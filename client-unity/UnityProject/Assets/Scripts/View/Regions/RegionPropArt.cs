// Procedural decorative prop sprites for the five regions, painted once at load with RegionCanvas into ONE atlas (one
// texture, one material, so they batch). Colours are taken from the generated palette table. No imported art, so no
// licence-ledger entry. Sprites pivot at their ground contact point. 64 pixels per world unit (one tile is 64 px wide).
using System;
using System.Collections.Generic;
using UnityEngine;
using static Roguehalla.Client.RegionCanvas;

namespace Roguehalla.Client
{
    public sealed class RegionPropSprite
    {
        public string Key; public Sprite Sprite; public float Width, Height;
        /// <summary>True when the sprite is tall enough to hide an actor standing just north of it (the fade rule applies).</summary>
        public bool Tall;
        /// <summary>Transparent pixels between the opaque art (alpha above <see cref="RegionPropArt.EdgeAlpha"/>) and each side of the sprite cell. 0 means the art touches the edge and is clipped.</summary>
        public int MarginLeft, MarginRight, MarginBottom, MarginTop;
        /// <summary>Size of the cropped sprite in pixels. ExceededCell: the art reaches past its nominal cell (it used to be cut off there).</summary>
        public int PixelWidth, PixelHeight; public bool ExceededCell;
        public int MinMargin { get { return Mathf.Min(Mathf.Min(MarginLeft, MarginRight), Mathf.Min(MarginBottom, MarginTop)); } }
    }

    public static partial class RegionPropArt
    {
        public const int PixelsPerUnit = 64;
        /// <summary>Alpha (0..1) above which a pixel counts as drawn when measuring a prop's margins (about 8 of 255: invisible fringe is ignored).</summary>
        public const float EdgeAlpha = .03f;
        /// <summary>Required transparent margin on every side of every prop cell, in atlas pixels.</summary>
        public const int RequiredMargin = 2;
        static Dictionary<string, RegionPropSprite> _all;
        static Texture2D _atlas;
        public static Texture2D Atlas { get { Ensure(); return _atlas; } }
        public static bool TryGet(string key, out RegionPropSprite sprite) { Ensure(); return _all.TryGetValue(key, out sprite); }
        public static IEnumerable<string> Keys { get { Ensure(); return _all.Keys; } }

        struct Def { public string Key; public int W, H, Ground; public Action<RegionCanvas, int> Paint; public bool Tall; }

        static Color P(int region, int slot) { return RegionPaletteGenerated.Srgb[region][slot]; }
        static readonly Color Ink = new Color(.05f, .06f, .10f, .85f);

        static void Ensure()
        {
            if (_all != null) return;
            var defs = new List<Def>();
            AddFrost(defs); AddFire(defs); AddSentenced(defs); AddPlague(defs); AddHoly(defs); AddTemple(defs); AddColiseum(defs);
            // Shelf-pack into an atlas, growing the height if needed.
            Build(defs, 1024, 1024);
        }

        /// <summary>Art is painted on a canvas larger than its nominal cell (so overhanging canopies, glows and shadow tails are never cut off), then cropped to the opaque bounds plus <see cref="CropMargin"/>.</summary>
        public const int PadSide = 44, PadTop = 44, PadBottom = 18, CropMargin = 3;
        /// <summary>Evidence and A/B only (before/after captures of the clipping fix): paint each prop in its nominal cell, uncropped, as the atlas did before. Never set in the game.</summary>
        public static bool DebugNoPadding;

        static bool TryPack(RegionCanvas[] cvs, int aw, int ah, out RectInt[] rects)
        {
            rects = new RectInt[cvs.Length]; int x = 2, y = 2, rowH = 0;
            for (int i = 0; i < cvs.Length; i++)
            {
                int w = cvs[i].W + 4, h = cvs[i].H + 4;
                if (x + w > aw) { x = 2; y += rowH; rowH = 0; }
                if (y + h > ah) return false;
                rects[i] = new RectInt(x + 2, y + 2, cvs[i].W, cvs[i].H); x += w; rowH = Mathf.Max(rowH, h);
            }
            return true;
        }

        /// <summary>Paints one def on its padded canvas and returns the crop. <paramref name="pivot"/> is the foot in the cropped canvas (pixels).</summary>
        static RegionCanvas PaintCropped(Def d, out Vector2 pivot, out int[] margins)
        {
            int padS = DebugNoPadding ? 0 : PadSide, padT = DebugNoPadding ? 0 : PadTop, padB = DebugNoPadding ? 0 : PadBottom;
            var full = new RegionCanvas(d.W + 2 * padS, d.H + padB + padT) { OriginX = padS, OriginY = padB, DesignW = d.W, DesignH = d.H };
            d.Paint(full, d.Ground);
            int x0 = full.W, x1 = -1, y0 = full.H, y1 = -1;
            for (int y = 0; y < full.H; y++) for (int x = 0; x < full.W; x++)
            {
                if (full.Px[y * full.W + x].a <= EdgeAlpha) continue;
                x0 = Mathf.Min(x0, x); x1 = Mathf.Max(x1, x); y0 = Mathf.Min(y0, y); y1 = Mathf.Max(y1, y);
            }
            if (x1 < 0) { x0 = 0; x1 = 0; y0 = 0; y1 = 0; }
            int ax0 = x0, ax1 = x1, ay0 = y0, ay1 = y1;
            if (DebugNoPadding) { x0 = 0; y0 = 0; x1 = full.W - 1; y1 = full.H - 1; ax0 = ax1 = ay0 = ay1 = 0; }
            else { x0 = Mathf.Max(0, x0 - CropMargin); y0 = Mathf.Max(0, y0 - CropMargin); x1 = Mathf.Min(full.W - 1, x1 + CropMargin); y1 = Mathf.Min(full.H - 1, y1 + CropMargin); }
            var cv = new RegionCanvas(x1 - x0 + 1, y1 - y0 + 1);
            for (int y = 0; y < cv.H; y++) for (int x = 0; x < cv.W; x++) cv.Px[y * cv.W + x] = full.Px[(y + y0) * full.W + x + x0];
            pivot = new Vector2(d.W * .5f + padS - x0, d.Ground + padB - y0);
            // Margins are measured against the crop, but a crop that was limited by the padded canvas (art reaching its edge) reports 0: that art is clipped.
            margins = new[] { ax0 - x0, x1 - ax1, ay0 - y0, y1 - ay1,
                // 1 when the art reached beyond the nominal cell (it would have been cut off before the padded canvas existed)
                (ax0 < padS || ax1 >= padS + d.W || ay1 >= padB + d.H || ay0 < padB - 3 ? 1 : 0) };
            return cv;
        }

        static void Build(List<Def> defs, int aw0, int ah0)
        {
            var cvs = new RegionCanvas[defs.Count]; var pivots = new Vector2[defs.Count]; var margins = new int[defs.Count][];
            for (int i = 0; i < defs.Count; i++) cvs[i] = PaintCropped(defs[i], out pivots[i], out margins[i]);
            int aw = aw0, ah = ah0; RectInt[] rects;
            while (!TryPack(cvs, aw, ah, out rects)) ah *= 2;
            var px = new Color32[aw * ah];
            _atlas = new Texture2D(aw, ah, TextureFormat.RGBA32, false, false) { name = "Region props atlas", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            _all = new Dictionary<string, RegionPropSprite>();
            for (int i = 0; i < defs.Count; i++) cvs[i].CopyTo(px, aw, rects[i].x, rects[i].y);
            _atlas.SetPixelData(px, 0); _atlas.Apply(false, !Application.isEditor);
            for (int i = 0; i < defs.Count; i++)
            {
                var d = defs[i];
                var rect = new Rect(rects[i].x, rects[i].y, cvs[i].W, cvs[i].H);
                var sprite = Sprite.Create(_atlas, rect, new Vector2(pivots[i].x / cvs[i].W, pivots[i].y / cvs[i].H), PixelsPerUnit, 0, SpriteMeshType.FullRect);
                sprite.name = d.Key;
                _all[d.Key] = new RegionPropSprite { Key = d.Key, Sprite = sprite, Width = Mathf.Max(d.W, 2f * Mathf.Max(pivots[i].x, cvs[i].W - pivots[i].x)) / PixelsPerUnit, Height = (d.H - d.Ground) / (float)PixelsPerUnit, Tall = d.Tall,
                    MarginLeft = margins[i][0], MarginRight = margins[i][1], MarginBottom = margins[i][2], MarginTop = margins[i][3], PixelWidth = cvs[i].W, PixelHeight = cvs[i].H, ExceededCell = margins[i][4] == 1 };
            }
        }

        static void Add(List<Def> l, string key, int w, int h, int ground, Action<RegionCanvas, int> paint, bool tall = false)
        { l.Add(new Def { Key = key, W = w, H = h, Ground = ground, Paint = paint, Tall = tall }); }

        // ---- shared pieces ------------------------------------------------------------------------------------------------

        static Shader2 Toon(Sdf s, Color dark, Color mid, Color light, float r = 9f, float grain = .05f, int seed = 1, float ao = .18f, float rim = 0f)
        { return Dome(s, dark, mid, light, r, grain, seed, ao, rim); }

        static void Blades(RegionCanvas c, float cx, float gy, int count, float height, float spread, float w0, Color baseC, Color tipC, int seed, float bend = .35f, Color? outline = null)
        {
            for (int i = 0; i < count; i++)
            {
                float t = count == 1 ? .5f : i / (float)(count - 1);
                float h = height * (.62f + .38f * RegionNoise.Hash01(i, 1, seed)) * (1f - Mathf.Abs(t - .5f) * .6f);
                float x0 = cx + (t - .5f) * spread, lean = ((t - .5f) * 1.6f + (RegionNoise.Hash01(i, 2, seed) - .5f) * bend) * height * .35f;
                var a = new Vector2(x0, gy); var b = new Vector2(x0 + lean, gy + h);
                var mid = new Vector2(x0 + lean * .25f, gy + h * .55f);
                var s1 = Capsule(a, mid, w0, w0 * .8f); var s2 = Capsule(mid, b, w0 * .8f, .5f);
                var sdf = Union(s1, s2);
                float tt = RegionNoise.Hash01(i, 5, seed);
                Color bc = Mix(baseC, Shade(baseC, 1.15f), tt), tc = tipC;
                c.Fill(sdf, Vertical(tc, bc, gy + h, gy), outline ?? Alpha(Shade(baseC, .35f), .75f), 1.1f);
            }
        }

        static void Lumps(RegionCanvas c, float cx, float gy, float rx, float ry, int n, Color dark, Color mid, Color light, int seed, float roundness = 1f, Color? outline = null)
        {
            // Back to front: higher lumps first so lower ones overlap them.
            var order = new List<(float x, float y, float r)>();
            for (int i = 0; i < n; i++)
            {
                float t = n == 1 ? .5f : i / (float)(n - 1);
                float x = cx + (t - .5f) * rx * 1.5f + (RegionNoise.Hash01(i, 7, seed) - .5f) * rx * .25f;
                float rr = Mathf.Min(rx, ry * 1.4f) * (.46f + .34f * RegionNoise.Hash01(i, 8, seed)) * roundness;
                float y = gy + rr * .85f + RegionNoise.Hash01(i, 9, seed) * ry * .55f;
                order.Add((x, y, rr));
            }
            order.Sort((a, b) => b.y.CompareTo(a.y));
            foreach (var o in order)
            {
                var s = Circle(o.x, o.y, o.r);
                c.Fill(s, Toon(s, dark, mid, light, o.r * .9f, .08f, seed + (int)o.x, .12f, .25f), outline ?? Alpha(Shade(dark, .35f), .8f), 1.3f);
            }
        }

        static void Rock(RegionCanvas c, float cx, float gy, float rx, float ry, int seed, Color dark, Color mid, Color light, Color? snow = null, float snowFrac = .5f, Color? crack = null, float jitter = .16f, int n = 9)
        {
            var outline = RockOutline(cx, gy, rx, ry, seed, n, jitter, .0f);
            var s = Poly(outline);
            c.Fill(s, Toon(s, dark, mid, light, Mathf.Min(rx, ry) * .8f, .10f, seed, .22f, .2f), Alpha(Shade(dark, .3f), .85f), 1.4f);
            // Facet lines.
            if (crack.HasValue)
            {
                for (int i = 0; i < 2; i++)
                {
                    float x0 = cx + (RegionNoise.Hash01(i, 11, seed) - .5f) * rx, y0 = gy + ry * (.35f + .3f * RegionNoise.Hash01(i, 12, seed));
                    c.Fill(Intersect(s, Capsule(new Vector2(x0, y0), new Vector2(x0 + rx * .35f, y0 - ry * .5f), .9f, .4f)), Flat(crack.Value));
                }
            }
            if (snow.HasValue)
            {
                float capY = gy + ry * snowFrac;
                var pts = new List<Vector2>();
                for (int i = 0; i <= 12; i++) { float x = cx - rx * 1.2f + rx * 2.4f * i / 12f; pts.Add(new Vector2(x, capY + Mathf.Sin(i * 1.7f + seed) * ry * .10f - Mathf.Abs(x - cx) / rx * ry * .12f)); }
                pts.Add(new Vector2(cx + rx * 1.3f, gy + ry * 2)); pts.Add(new Vector2(cx - rx * 1.3f, gy + ry * 2));
                var cap = Intersect(Grow(s, -.4f), Poly(pts.ToArray()));
                Color sn = snow.Value;
                c.Fill(cap, Toon(cap, Mix(sn, P(4, 5), .45f), sn, Mix(sn, Color.white, .75f), ry * .6f, .03f, seed), null);
            }
        }

        // ---- frost (the finished slice) ------------------------------------------------------------------------------------

        static void AddFrost(List<Def> l)
        {
            Color baseC = P(4, 0), sec = P(4, 1), acc = P(4, 2), shadow = P(4, 5);
            Color snow = Mix(baseC, Color.white, .35f), snowLight = Mix(baseC, Color.white, .85f), snowShade = Mix(shadow, baseC, .62f), snowDeep = Mix(shadow, baseC, .38f);
            Color spruceDark = Shade(Mix(sec, P(3, 1), .45f), .46f), spruceMid = Shade(Mix(sec, P(3, 1), .45f), .78f), spruceLight = Mix(sec, P(3, 1), .55f);
            spruceLight = Mix(spruceLight, Color.white, .08f);
            Color stone = Mix(sec, shadow, .35f);

            Action<RegionCanvas, int>[] pine = new Action<RegionCanvas, int>[2];
            for (int v = 0; v < 2; v++)
            {
                int variant = v;
                pine[v] = (c, gy) =>
                {
                    int tiers = variant == 0 ? 4 : 3; float cx = c.DesignW / 2f + (variant == 1 ? 2f : 0f);
                    float trunkH = 14f, treeH = c.DesignH - gy - 6f;
                    c.SoftShadow(cx + 6, gy + 2, c.DesignW * .42f, 9f, .42f, Alpha(snowDeep, 1f));
                    var trunk = Box(cx, gy + trunkH / 2f, 5f, trunkH / 2f + 1f, 1.5f);
                    c.Fill(trunk, Vertical(Shade(stone, .7f), Shade(stone, .38f), gy + trunkH, gy), Ink, 1.2f);
                    for (int t = 0; t < tiers; t++)
                    {
                        float f = t / (float)(tiers - 1);
                        float by = gy + trunkH * .55f + (treeH - trunkH * .5f) * (t / (float)tiers) * .9f;
                        float th = (treeH - trunkH * .4f) * (.42f - .05f * t) + 6f;
                        float bw = (c.DesignW * .46f) * (1f - f * (variant == 0 ? .62f : .5f));
                        var pts = new List<Vector2> { new Vector2(cx + Mathf.Sin(t * 2.1f) * 1.2f, by + th), new Vector2(cx + bw, by + 2f) };
                        int scallops = 5;
                        for (int k = 1; k <= scallops; k++) { float u = k / (float)(scallops + 1); pts.Add(new Vector2(cx + bw - 2f * bw * u, by - (k % 2 == 0 ? 0f : 4.2f) + 2f)); }
                        pts.Add(new Vector2(cx - bw, by + 2f));
                        var tier = Poly(pts.ToArray());
                        Color lt = Mix(spruceLight, spruceMid, f * .5f), md = spruceMid, dk = spruceDark;
                        Shader2 sh = (x, y, d) =>
                        {
                            float u = Mathf.Clamp01((x - (cx - bw)) / (2f * bw));
                            Color col = u < .5f ? Color.Lerp(lt, md, SmoothU(u, .15f, .5f)) : Color.Lerp(md, dk, SmoothU(u, .5f, .95f));
                            float ao = Mathf.Clamp01((by + 6f - y) / 12f); return Shade(col, 1f - ao * .22f);
                        };
                        c.Fill(tier, sh, Ink, 1.4f);
                        // Snow cap: scalloped, thicker on the lit side.
                        var cap = new List<Vector2> { new Vector2(cx + Mathf.Sin(t * 2.1f) * 1.2f, by + th + .5f) };
                        float capDrop = th * (.58f + .08f * (variant == 1 ? 1 : 0));
                        cap.Add(new Vector2(cx + bw * (1f - capDrop / th) + 1f, by + th - capDrop));
                        cap.Add(new Vector2(cx + bw * .30f, by + th - capDrop * .70f));
                        cap.Add(new Vector2(cx + bw * .05f, by + th - capDrop * .98f));
                        cap.Add(new Vector2(cx - bw * .30f, by + th - capDrop * .70f));
                        cap.Add(new Vector2(cx - bw * (1f - capDrop / th) - 1f, by + th - capDrop * 1.05f));
                        var capS = Intersect(Grow(tier, -.5f), Poly(cap.ToArray()));
                        c.Fill(capS, (x, y, d) => Color.Lerp(snowLight, snowShade, Mathf.Clamp01((x - cx) / bw * .5f + .3f) * .8f), null);
                    }
                    // A few icicle glints.
                    c.Glow(cx - 4f, gy + treeH * .55f, 7f, snowLight, .20f);
                };
            }
            Add(l, "frost.pine", 112, 184, 12, pine[0], true);
            Add(l, "frost.pine2", 120, 150, 12, pine[1], true);

            Add(l, "frost.rock", 112, 84, 10, (c, gy) =>
            {
                c.SoftShadow(c.DesignW / 2f + 6, gy + 2, 44f, 8f, .38f, Alpha(snowDeep, 1f));
                Rock(c, c.DesignW / 2f - 9f, gy, 28f, 24f, 3, Shade(stone, .58f), stone, Mix(sec, snowLight, .35f), snow, .50f, Shade(stone, .38f));
                Rock(c, c.DesignW / 2f + 18f, gy, 18f, 15f, 8, Shade(stone, .58f), stone, Mix(sec, snowLight, .35f), snow, .45f, Shade(stone, .38f));
            });
            Add(l, "frost.rock2", 96, 108, 10, (c, gy) =>
            {
                c.SoftShadow(c.DesignW / 2f + 6, gy + 2, 36f, 8f, .38f, Alpha(snowDeep, 1f));
                // Tall angular glacier boulder: faceted, snow on top.
                var pts = new[] { new Vector2(30, gy), new Vector2(24, gy + 28), new Vector2(34, gy + 62), new Vector2(50, gy + 78), new Vector2(66, gy + 58), new Vector2(72, gy + 24), new Vector2(66, gy) };
                var body = Poly(pts);
                c.Fill(body, Split(50, Mix(sec, snowLight, .30f), Shade(stone, .62f), 14f), Ink, 1.5f);
                var facet = Poly(new Vector2(34, gy + 62), new Vector2(50, gy + 78), new Vector2(52, gy + 30), new Vector2(40, gy + 8), new Vector2(24, gy + 28));
                c.Fill(Intersect(body, facet), Flat(Alpha(Mix(sec, Color.white, .45f), .55f)));
                c.Fill(Intersect(body, Capsule(new Vector2(54, gy + 66), new Vector2(58, gy + 22), 1f, .5f)), Flat(Alpha(Shade(stone, .35f), .7f)));
                var cap = Poly(new Vector2(30, gy + 52), new Vector2(34, gy + 62), new Vector2(50, gy + 79), new Vector2(66, gy + 58), new Vector2(70, gy + 48), new Vector2(60, gy + 52), new Vector2(54, gy + 44), new Vector2(46, gy + 55), new Vector2(38, gy + 46));
                c.Fill(Intersect(Grow(body, -.4f), cap), Toon(cap, snowShade, snow, snowLight, 8f, .03f), null);
            }, true);

            for (int v = 0; v < 2; v++)
            {
                int variant = v;
                Add(l, v == 0 ? "frost.drift" : "frost.drift2", v == 0 ? 144 : 112, v == 0 ? 56 : 48, 8, (c, gy) =>
                {
                    float cx = c.DesignW / 2f;
                    var a = Ellipse(cx - 20 + variant * 10, gy + 8, 40, 16); var b = Ellipse(cx + 22 - variant * 12, gy + 6, 34, 12); var m = Ellipse(cx + 2, gy + 11, 30, 15);
                    var s = SmoothUnion(SmoothUnion(a, b, 8f), m, 8f);
                    c.SoftShadow(cx + 6, gy, c.DesignW * .42f, 7f, .22f, Alpha(snowDeep, 1f));
                    c.Fill(s, Toon(s, snowShade, snow, snowLight, 14f, .04f, 5 + variant, .06f), Alpha(snowDeep, .55f), 1.2f);
                    for (int k = 0; k < 6; k++)
                    {
                        float x = 10 + RegionNoise.Hash01(k, 4, 9 + variant) * (c.DesignW - 20), y = gy + 4 + RegionNoise.Hash01(k, 5, 9 + variant) * 14;
                        if (s(x, y) < -3f) c.Fill(Capsule(new Vector2(x - 1.6f, y), new Vector2(x + 1.6f, y), .6f, .6f), Flat(Alpha(Color.white, .9f)));
                    }
                });
            }

            Add(l, "frost.shards", 112, 124, 10, (c, gy) =>
            {
                float cx = c.DesignW / 2f;
                c.SoftShadow(cx + 4, gy + 1, 38f, 8f, .35f, Alpha(snowDeep, 1f));
                c.Glow(cx, gy + 16, 42f, acc, .20f);
                Color iceLight = Mix(baseC, Color.white, .75f), iceMid = Mix(acc, baseC, .30f), iceDark = Mix(acc, sec, .55f);
                iceDark = Shade(iceDark, .78f);
                // snow base
                var baseMound = Ellipse(cx, gy + 5, 34, 10);
                c.Fill(baseMound, Toon(baseMound, snowShade, snow, snowLight, 8f, .03f, 2), Alpha(snowDeep, .6f), 1f);
                float[,] spec = { { -22, 0, 11, 44, -.20f }, { 22, 0, 10, 36, .22f }, { -6, 2, 14, 74, -.04f }, { 10, 0, 12, 56, .10f }, { -34, 0, 7, 24, -.34f } };
                var order = new[] { 4, 1, 0, 3, 2 };
                foreach (int k in order)
                {
                    float x0 = cx + spec[k, 0], y0 = gy + spec[k, 1] + 3, w = spec[k, 2], h = spec[k, 3], lean = spec[k, 4] * h;
                    var tip = new Vector2(x0 + lean, y0 + h);
                    var left = Poly(new Vector2(x0 - w * .5f, y0 + 2), new Vector2(x0 - w * .46f + lean * .45f, y0 + h * .72f), tip, new Vector2(x0 + lean * .1f, y0 + 1));
                    var right = Poly(new Vector2(x0 + lean * .1f, y0 + 1), tip, new Vector2(x0 + w * .46f + lean * .45f, y0 + h * .70f), new Vector2(x0 + w * .5f, y0 + 2));
                    var whole = Poly(new Vector2(x0 - w * .5f, y0 + 2), new Vector2(x0 - w * .46f + lean * .45f, y0 + h * .72f), tip, new Vector2(x0 + w * .46f + lean * .45f, y0 + h * .70f), new Vector2(x0 + w * .5f, y0 + 2));
                    c.Fill(whole, Flat(iceDark), Alpha(Shade(iceDark, .35f), .9f), 1.4f);
                    c.Fill(left, Vertical(iceLight, iceMid, y0 + h, y0), null);
                    c.Fill(right, Vertical(iceMid, iceDark, y0 + h, y0), null);
                    c.Fill(Capsule(new Vector2(x0 - w * .30f + lean * .15f, y0 + h * .18f), new Vector2(x0 - w * .30f + lean * .42f, y0 + h * .62f), .9f, .5f), Flat(Alpha(Color.white, .85f)));
                    c.Glow(tip.x, tip.y - 2, 5f, Color.white, .35f);
                }
            }, false);

            Add(l, "frost.reeds", 80, 92, 8, (c, gy) =>
            {
                float cx = c.DesignW / 2f;
                c.SoftShadow(cx + 4, gy + 1, 26f, 5f, .25f, Alpha(snowDeep, 1f));
                Color stem = Mix(baseC, sec, .55f), tip = Mix(baseC, Color.white, .8f);
                Blades(c, cx - 8, gy, 6, 56, 20, 1.5f, Shade(stem, .85f), tip, 21, .5f);
                Blades(c, cx + 8, gy, 6, 66, 24, 1.6f, stem, tip, 33, .5f);
                // frosted cattails
                for (int k = 0; k < 2; k++)
                {
                    float x = cx - 5 + k * 13, top = gy + 52 + k * 10;
                    var ear = Ellipse(x + (k == 0 ? -2 : 3), top, 2.6f, 7f);
                    c.Fill(ear, Toon(ear, Shade(stone, .5f), Mix(stone, snow, .3f), Mix(stone, snowLight, .6f), 3f), Ink, 1f);
                }
                var mound = Ellipse(cx, gy + 2, 26, 6);
                c.Fill(mound, Toon(mound, snowShade, snow, snowLight, 5f), null);
            });

            Add(l, "frost.bush", 104, 80, 8, (c, gy) =>
            {
                float cx = c.DesignW / 2f;
                c.SoftShadow(cx + 5, gy + 1, 38f, 7f, .35f, Alpha(snowDeep, 1f));
                var lumps = new[] { (cx - 24f, gy + 16f, 17f), (cx + 22f, gy + 15f, 16f), (cx - 2f, gy + 24f, 22f), (cx - 38f, gy + 8f, 9f), (cx + 38f, gy + 8f, 9f) };
                var all = new List<Sdf>();
                foreach (var m in lumps)
                {
                    var sdf = Circle(m.Item1, m.Item2, m.Item3); all.Add(sdf);
                    c.Fill(sdf, Toon(sdf, spruceDark, spruceMid, spruceLight, m.Item3 * .9f, .08f, (int)m.Item1, .1f, .2f), Alpha(Shade(spruceDark, .35f), .85f), 1.3f);
                }
                // Snow blanket over the top half with a scalloped lower edge.
                var u = Union(all.ToArray());
                var edge = new List<Vector2>();
                for (int k = 0; k <= 14; k++) { float x = cx - 48f + 96f * k / 14f; edge.Add(new Vector2(x, gy + 22f + Mathf.Sin(k * 1.9f) * 3.2f - Mathf.Abs(x - cx) * .10f)); }
                edge.Add(new Vector2(cx + 50f, gy + 90f)); edge.Add(new Vector2(cx - 50f, gy + 90f));
                var cover = Intersect(Grow(u, -.6f), Poly(edge.ToArray()));
                c.Fill(cover, Toon(cover, snowShade, snow, snowLight, 12f, .03f, 6, .0f, .15f), Alpha(snowDeep, .35f), 1f);
            });
        }

        static float SmoothU(float v, float a, float b) { float t = Mathf.Clamp01((v - a) / (b - a)); return t * t * (3f - 2f * t); }

        // ---- fire -----------------------------------------------------------------------------------------------------------

        static void AddFire(List<Def> l)
        {
            Color baseC = P(1, 0), obs = P(1, 1), lava = P(1, 2), shadow = P(1, 5);
            Color rockDark = Shade(Mix(obs, shadow, .5f), .75f), rockMid = Mix(obs, baseC, .4f), rockLight = Mix(Mix(obs, baseC, .6f), lava, .12f);
            Add(l, "fire.spire", 80, 164, 10, (c, gy) =>
            {
                float cx = 40; c.SoftShadow(cx + 6, gy + 2, 32f, 7f, .5f, Alpha(shadow, 1f));
                c.Glow(cx, gy + 8, 30f, lava, .35f);
                var body = Poly(new Vector2(18, gy), new Vector2(24, gy + 52), new Vector2(30, gy + 98), new Vector2(40, gy + 142), new Vector2(50, gy + 96), new Vector2(60, gy + 50), new Vector2(64, gy));
                c.Fill(body, Split(41, Mix(rockMid, rockLight, .55f), rockDark, 10f), Ink, 1.6f);
                c.Fill(Intersect(body, Poly(new Vector2(41, gy + 130), new Vector2(46, gy + 60), new Vector2(40, gy + 4), new Vector2(34, gy + 60))), Flat(Alpha(rockLight, .45f)));
                // glowing seam
                var seam = Capsule(new Vector2(47, gy + 12), new Vector2(43, gy + 70), 1.4f, .6f);
                c.Fill(Intersect(body, seam), Flat(Mix(lava, Color.white, .25f)));
                c.Glow(46, gy + 30, 14f, lava, .35f);
                c.Fill(Capsule(new Vector2(30, gy + 60), new Vector2(26, gy + 22), .9f, .5f), Flat(Alpha(Shade(rockDark, .5f), .8f)));
            }, true);
            Add(l, "fire.rocks", 104, 70, 8, (c, gy) =>
            {
                c.SoftShadow(56, gy + 2, 40f, 7f, .45f, Alpha(shadow, 1f)); c.Glow(52, gy + 6, 34f, lava, .22f);
                Rock(c, 40, gy, 24, 22, 4, rockDark, rockMid, rockLight, null, 0, Mix(lava, Color.white, .15f), .2f);
                Rock(c, 70, gy, 20, 17, 9, rockDark, rockMid, rockLight, null, 0, Mix(lava, Color.white, .15f), .2f);
                Rock(c, 56, gy + 1, 14, 11, 13, rockDark, rockMid, rockLight);
            });
            Add(l, "fire.stump", 96, 124, 10, (c, gy) =>
            {
                float cx = 48; c.SoftShadow(cx + 6, gy + 2, 30f, 6f, .45f, Alpha(shadow, 1f)); c.Glow(cx, gy + 5, 26f, lava, .30f);
                Color wood = Shade(Mix(obs, baseC, .5f), .55f), woodLight = Mix(wood, lava, .20f);
                var trunk = Union(Capsule(new Vector2(cx, gy), new Vector2(cx - 4, gy + 52), 10, 6), Capsule(new Vector2(cx - 4, gy + 48), new Vector2(cx - 22, gy + 84), 5, 2.5f),
                                  Capsule(new Vector2(cx - 3, gy + 50), new Vector2(cx + 20, gy + 92), 4.5f, 2f), Capsule(new Vector2(cx + 8, gy + 70), new Vector2(cx + 30, gy + 80), 2.5f, 1.2f), Capsule(new Vector2(cx - 12, gy + 66), new Vector2(cx - 30, gy + 66), 2.6f, 1f));
                c.Fill(trunk, Toon(trunk, Shade(wood, .55f), wood, woodLight, 6f, .12f, 3, .2f), Ink, 1.5f);
                c.Fill(Intersect(trunk, Capsule(new Vector2(cx - 1, gy + 4), new Vector2(cx - 5, gy + 50), 1f, .6f)), Flat(Mix(lava, Color.white, .1f)));
                c.Glow(cx - 2, gy + 24, 12f, lava, .30f);
            }, true);
            Add(l, "fire.crystal", 80, 108, 8, (c, gy) =>
            {
                float cx = 40; c.SoftShadow(cx + 4, gy + 1, 28f, 6f, .4f, Alpha(shadow, 1f)); c.Glow(cx, gy + 28, 36f, lava, .38f);
                float[,] sp = { { -14, 0, 14, 52, -.15f }, { 14, 0, 12, 44, .20f }, { 0, 2, 17, 84, 0f } };
                foreach (int k in new[] { 0, 1, 2 })
                {
                    float x0 = cx + sp[k, 0], y0 = gy + sp[k, 1], w = sp[k, 2], h = sp[k, 3], lean = sp[k, 4] * h; var tip = new Vector2(x0 + lean, y0 + h);
                    var whole = Poly(new Vector2(x0 - w * .5f, y0), new Vector2(x0 - w * .45f + lean * .4f, y0 + h * .7f), tip, new Vector2(x0 + w * .45f + lean * .4f, y0 + h * .7f), new Vector2(x0 + w * .5f, y0));
                    c.Fill(whole, Split(x0 + lean * .3f, Mix(lava, Color.white, .38f), Mix(lava, Shade(obs, .6f), .45f), 3f), Alpha(Shade(obs, .5f), .95f), 1.5f);
                    c.Fill(Intersect(whole, Capsule(new Vector2(x0 - w * .2f, y0 + 4), new Vector2(x0 - w * .12f + lean * .4f, y0 + h * .6f), .9f, .5f)), Flat(Alpha(Color.white, .7f)));
                }
            });
            Add(l, "fire.vent", 104, 52, 8, (c, gy) =>
            {
                float cx = 52; c.SoftShadow(cx + 4, gy + 1, 40f, 6f, .45f, Alpha(shadow, 1f)); c.Glow(cx, gy + 10, 40f, lava, .35f);
                var mound = Ellipse(cx, gy + 8, 36, 16);
                c.Fill(mound, Toon(mound, rockDark, rockMid, rockLight, 12f, .1f, 6), Ink, 1.4f);
                var slit = Ellipse(cx, gy + 15, 17, 4.5f);
                c.Fill(slit, (x, y, d) => Color.Lerp(Shade(lava, .8f), Mix(lava, Color.white, .55f), Mathf.Clamp01(d / 3f)), Alpha(Shade(obs, .5f), .9f), 1.2f);
                for (int k = 0; k < 5; k++) c.Glow(cx - 12 + k * 6, gy + 24 + (k % 2) * 7, 3.4f, Mix(lava, Color.white, .35f), .8f);
            });
        }

        // ---- sentenced (gothic crypt-yard, muted dusk) ----------------------------------------------------------------------------

        static void AddSentenced(List<Def> l)
        {
            Color baseC = P(2, 0), second = P(2, 1), accent = P(2, 2), key = P(2, 3), shadow = P(2, 5);
            Color stone = Mix(baseC, second, .3f), stoneL = Mix(stone, Color.white, .22f), stoneD = Shade(stone, .55f);
            Color moss = Mix(stone, P(3, 1), .45f), mossL = Mix(moss, Color.white, .15f);
            Color wood = Mix(second, shadow, .2f), woodD = Shade(wood, .55f), woodL = Mix(wood, baseC, .3f);
            Color iron = Mix(new Color(.09f, .09f, .12f), accent, .15f), ironL = Mix(iron, Color.white, .25f);
            Color grassD = Shade(Mix(second, baseC, .5f), 1.0f), grassL = Mix(second, baseC, .85f);
            Add(l, "sent.tomb", 80, 96, 8, (c, gy) =>
            {
                float cx = 40; c.SoftShadow(cx + 4, gy + 1, 22f, 5f, .38f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 5, 17, 5, 1.5f); c.Fill(plinth, Toon(plinth, stoneD, stone, stoneL, 4f, .1f, 3), Ink, 1.2f);
                var slab = Union(Box(cx, gy + 28, 13, 24, 1.5f), Circle(cx, gy + 51, 13));
                c.Fill(slab, Toon(slab, stoneD, stone, stoneL, 12f, .14f, 7), Ink, 1.4f);
                for (int k = 0; k < 3; k++) c.Fill(Intersect(slab, Box(cx, gy + 44 - k * 7f, 7f - k * 1.2f, .9f)), Flat(Alpha(stoneD, .85f)));
                c.Fill(Intersect(slab, Box(cx, gy + 14, 13, 5f)), Toon(slab, Shade(moss, .7f), moss, mossL, 6f, .2f, 5), null);
                c.Fill(Capsule(new Vector2(cx - 4, gy + 40), new Vector2(cx + 2, gy + 30), .6f, .5f), Flat(Alpha(stoneD, .7f)));
            });
            Add(l, "sent.cross", 80, 104, 8, (c, gy) =>
            {
                float cx = 40; c.SoftShadow(cx + 5, gy + 1, 22f, 5f, .38f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 5, 14, 5, 1.5f); c.Fill(plinth, Toon(plinth, stoneD, stone, stoneL, 4f, .1f, 4), Ink, 1.2f);
                var cross = Union(Box(cx, gy + 36, 4.4f, 30, .8f), Box(cx, gy + 52, 14, 4.4f, .8f));
                c.Fill(cross, Toon(cross, stoneD, stone, stoneL, 6f, .14f, 9), Ink, 1.4f);
                var ring = Subtract(Circle(cx, gy + 52, 11), Circle(cx, gy + 52, 7.2f)); c.Fill(ring, Toon(ring, stoneD, stone, stoneL, 3f, .1f, 2), Ink, 1.1f);
                c.Fill(Intersect(cross, Box(cx, gy + 14, 6, 6)), Toon(cross, Shade(moss, .7f), moss, mossL, 5f, .2f, 6), null);
            });
            Add(l, "sent.slab", 112, 56, 6, (c, gy) =>
            {
                c.SoftShadow(58, gy + 1, 40f, 6f, .32f, Alpha(shadow, 1f));
                var top = Poly(new Vector2(14, gy + 8), new Vector2(86, gy + 8), new Vector2(100, gy + 22), new Vector2(28, gy + 22));
                var front = Poly(new Vector2(14, gy + 8), new Vector2(86, gy + 8), new Vector2(86, gy + 1), new Vector2(14, gy + 1));
                c.Fill(front, Flat(stoneD), Ink, 1.1f); c.Fill(top, Toon(top, Shade(stone, .85f), stone, stoneL, 20f, .12f, 11), Ink, 1.3f);
                c.Fill(Capsule(new Vector2(57, gy + 11), new Vector2(57, gy + 20), 1.2f, 1.2f), Flat(Alpha(stoneD, .85f)));
                c.Fill(Capsule(new Vector2(52, gy + 17), new Vector2(63, gy + 17), 1.2f, 1.2f), Flat(Alpha(stoneD, .85f)));
                c.Fill(Capsule(new Vector2(34, gy + 14), new Vector2(40, gy + 17), 1.6f, .8f), Flat(Alpha(moss, .9f)));
            });
            Add(l, "sent.lantern", 72, 132, 8, (c, gy) =>
            {
                float cx = 36; c.SoftShadow(cx + 3, gy + 1, 14f, 4f, .35f, Alpha(shadow, 1f));
                Color glow = Mix(key, accent, .25f);
                c.Glow(cx, gy + 98, 34f, glow, .42f);
                var post = Box(cx, gy + 46, 2.4f, 48); c.Fill(post, Split(cx, ironL, iron, 1f), Ink, 1.1f);
                var foot = Box(cx, gy + 4, 7, 4, 1); c.Fill(foot, Toon(foot, stoneD, stone, stoneL, 3f), Ink, 1.1f);
                c.Fill(Capsule(new Vector2(cx, gy + 84), new Vector2(cx + 13, gy + 92), 1.4f, 1.4f), Flat(iron), Ink, .9f);
                float lx = cx + 13;
                var cage = Poly(new Vector2(lx - 6, gy + 86), new Vector2(lx + 6, gy + 86), new Vector2(lx + 8, gy + 104), new Vector2(lx - 8, gy + 104));
                c.Fill(cage, (x, y, d) => Mix(Mix(key, Color.white, .35f), glow, Mathf.Clamp01((Mathf.Abs(x - lx) + Mathf.Abs(y - gy - 95)) / 12f)), Ink, 1.2f);
                foreach (float bx in new[] { -4f, 0f, 4f }) c.Fill(Capsule(new Vector2(lx + bx, gy + 86), new Vector2(lx + bx * 1.3f, gy + 104), .6f, .6f), Flat(iron));
                var roof = Poly(new Vector2(lx - 10, gy + 104), new Vector2(lx + 10, gy + 104), new Vector2(lx, gy + 114)); c.Fill(roof, Flat(iron), Ink, 1f);
            });
            Add(l, "sent.urn", 64, 84, 6, (c, gy) =>
            {
                float cx = 32; c.SoftShadow(cx + 3, gy + 1, 18f, 4f, .35f, Alpha(shadow, 1f));
                var ped = Box(cx, gy + 6, 12, 6, 1.5f); c.Fill(ped, Toon(ped, stoneD, stone, stoneL, 4f, .1f, 8), Ink, 1.2f);
                var urn = Union(Ellipse(cx, gy + 28, 11, 15), Box(cx, gy + 45, 6, 3.5f), Ellipse(cx, gy + 50, 9, 3f));
                c.Fill(urn, Toon(urn, stoneD, stone, stoneL, 11f, .12f, 12), Ink, 1.3f);
                c.Fill(Intersect(urn, Box(cx, gy + 30, 14, 1.2f)), Flat(Alpha(stoneD, .8f)));
            });
            Add(l, "sent.gargoyle", 84, 104, 8, (c, gy) =>
            {
                float cx = 42; c.SoftShadow(cx + 4, gy + 1, 24f, 5f, .38f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 7, 16, 7, 1.5f); c.Fill(plinth, Toon(plinth, stoneD, stone, stoneL, 4f, .1f, 13), Ink, 1.2f);
                var body = Ellipse(cx, gy + 28, 12, 15); c.Fill(body, Toon(body, stoneD, stone, stoneL, 10f, .14f, 14), Ink, 1.4f);
                var wingL = Poly(new Vector2(cx - 8, gy + 34), new Vector2(cx - 30, gy + 58), new Vector2(cx - 22, gy + 30), new Vector2(cx - 10, gy + 22));
                var wingR = Poly(new Vector2(cx + 8, gy + 34), new Vector2(cx + 30, gy + 58), new Vector2(cx + 22, gy + 30), new Vector2(cx + 10, gy + 22));
                c.Fill(wingL, Toon(wingL, stoneD, Shade(stone, .9f), stone, 8f), Ink, 1.2f); c.Fill(wingR, Toon(wingR, stoneD, Shade(stone, .9f), stone, 8f), Ink, 1.2f);
                var head = Circle(cx, gy + 48, 8.5f); c.Fill(head, Toon(head, stoneD, stone, stoneL, 8f, .12f, 15), Ink, 1.3f);
                c.Fill(Poly(new Vector2(cx - 7, gy + 54), new Vector2(cx - 11, gy + 64), new Vector2(cx - 3, gy + 56)), Flat(stoneD), Ink, 1f);
                c.Fill(Poly(new Vector2(cx + 7, gy + 54), new Vector2(cx + 11, gy + 64), new Vector2(cx + 3, gy + 56)), Flat(stoneD), Ink, 1f);
                c.Fill(Circle(cx - 3, gy + 49, 1.4f), Flat(Alpha(accent, 1f))); c.Fill(Circle(cx + 3, gy + 49, 1.4f), Flat(Alpha(accent, 1f)));
            });
            Add(l, "sent.deadgrass", 80, 60, 6, (c, gy) =>
            {
                c.SoftShadow(40, gy + 1, 22f, 4f, .22f, Alpha(shadow, 1f));
                Blades(c, 40, gy, 11, 40, 26, 1.2f, grassD, grassL, 10, .7f);
            });
            Add(l, "sent.scarecrow", 96, 148, 8, (c, gy) =>
            {   // a lone gallows-side scarecrow: the one rural remnant (the Gallows is a landmark here)
                float cx = 48; c.SoftShadow(cx + 5, gy + 1, 24f, 5f, .35f, Alpha(shadow, 1f));
                var pole = Box(cx, gy + 54, 2.6f, 56); c.Fill(pole, Vertical(woodL, woodD, gy + 110, gy), Ink, 1.2f);
                var arms = Capsule(new Vector2(cx - 32, gy + 78), new Vector2(cx + 32, gy + 82), 2.4f, 2.4f); c.Fill(arms, Flat(woodL), Ink, 1.2f);
                var tunic = Poly(new Vector2(cx - 14, gy + 82), new Vector2(cx + 14, gy + 84), new Vector2(cx + 18, gy + 40), new Vector2(cx + 8, gy + 34), new Vector2(cx - 4, gy + 40), new Vector2(cx - 16, gy + 36));
                c.Fill(tunic, Toon(tunic, Shade(woodD, .9f), wood, woodL, 8f, .15f, 5), Ink, 1.3f);
                var head = Circle(cx, gy + 98, 11); c.Fill(head, Toon(head, Shade(grassD, .8f), grassL, Mix(grassL, Color.white, .2f), 10f, .1f, 9), Ink, 1.4f);
                var brim = Ellipse(cx, gy + 107, 18, 4.2f); c.Fill(brim, Toon(brim, woodD, wood, woodL, 4f), Ink, 1.2f);
                var crown = Box(cx, gy + 116, 9, 8, 3); c.Fill(crown, Toon(crown, woodD, wood, woodL, 6f), Ink, 1.2f);
            }, true);
            Add(l, "sent.deadtree", 112, 168, 8, (c, gy) =>
            {
                float cx = 56; c.SoftShadow(cx + 6, gy + 1, 26f, 6f, .35f, Alpha(shadow, 1f));
                Color bark = Shade(Mix(wood, shadow, .3f), .8f), barkLight = Mix(bark, baseC, .2f);
                var tree = Union(Capsule(new Vector2(cx, gy), new Vector2(cx + 2, gy + 70), 8, 5), Capsule(new Vector2(cx + 2, gy + 64), new Vector2(cx - 26, gy + 122), 4.5f, 1.6f),
                                 Capsule(new Vector2(cx + 2, gy + 68), new Vector2(cx + 28, gy + 118), 4f, 1.4f), Capsule(new Vector2(cx - 2, gy + 90), new Vector2(cx + 8, gy + 142), 3f, 1.2f),
                                 Capsule(new Vector2(cx - 14, gy + 98), new Vector2(cx - 38, gy + 106), 2.5f, 1f), Capsule(new Vector2(cx + 16, gy + 96), new Vector2(cx + 40, gy + 104), 2.3f, 1f));
                c.Fill(tree, Toon(tree, Shade(bark, .6f), bark, barkLight, 6f, .14f, 8, .25f), Ink, 1.5f);
            }, true);
        }

        // ---- plague (forgotten city, overgrown) ----------------------------------------------------------------------------------

        static void AddPlague(List<Def> l)
        {
            Color moss = P(3, 0), fern = P(3, 1), spore = P(3, 2), shadow = P(3, 5);
            Color leafDark = Shade(Mix(fern, shadow, .35f), .85f), leafMid = Mix(fern, moss, .28f), leafLight = Mix(Mix(moss, spore, .26f), Color.white, .08f);
            Color stoneM = Mix(fern, new Color(.62f, .63f, .58f), .55f), stoneD = Shade(Mix(fern, shadow, .5f), .75f), stoneL = Mix(stoneM, Color.white, .35f);
            Add(l, "plague.bush", 128, 88, 8, (c, gy) =>
            {
                float cx = 64; c.SoftShadow(cx + 6, gy + 1, 46f, 8f, .4f, Alpha(shadow, 1f));
                Lumps(c, cx, gy, 48, 34, 6, leafDark, leafMid, leafLight, 11);
                for (int k = 0; k < 6; k++) { float x = 30 + RegionNoise.Hash01(k, 2, 21) * 68, y = gy + 14 + RegionNoise.Hash01(k, 3, 21) * 30; c.Fill(Circle(x, y, 1.8f), Flat(Mix(spore, Color.white, .5f))); }
            });
            Add(l, "plague.tree", 148, 204, 10, (c, gy) =>
            {
                float cx = 74; c.SoftShadow(cx + 8, gy + 1, 40f, 8f, .42f, Alpha(shadow, 1f));
                Color bark = Shade(Mix(fern, P(3, 5), .5f), .55f);
                var trunk = Union(Capsule(new Vector2(cx, gy), new Vector2(cx + 2, gy + 62), 9, 6), Capsule(new Vector2(cx + 2, gy + 56), new Vector2(cx - 22, gy + 96), 4, 3), Capsule(new Vector2(cx + 2, gy + 58), new Vector2(cx + 24, gy + 94), 4, 3));
                c.Fill(trunk, Toon(trunk, Shade(bark, .6f), bark, Mix(bark, moss, .35f), 5f, .12f, 4), Ink, 1.5f);
                Lumps(c, cx, gy + 82, 60, 66, 7, leafDark, leafMid, leafLight, 23, .95f);
                Lumps(c, cx, gy + 108, 36, 40, 4, leafDark, leafMid, leafLight, 37, .95f);
                foreach (float vx in new[] { -34f, 28f, 8f }) c.Fill(Capsule(new Vector2(cx + vx, gy + 96), new Vector2(cx + vx + 2, gy + 62), 1.5f, 1f), Flat(Alpha(leafDark, .9f)));
            }, true);
            Add(l, "plague.fern", 96, 84, 8, (c, gy) =>
            {
                float cx = 48; c.SoftShadow(cx + 4, gy + 1, 30f, 5f, .3f, Alpha(shadow, 1f));
                for (int f = 0; f < 9; f++)
                {
                    float a = Mathf.Lerp(-80f, 80f, f / 8f) * Mathf.Deg2Rad, len = 46f - Mathf.Abs(f - 4) * 3.4f;
                    var tip = new Vector2(cx + Mathf.Sin(a) * len, gy + 4 + Mathf.Cos(a) * len * .95f);
                    var mid = new Vector2(cx + Mathf.Sin(a) * len * .5f, gy + 4 + Mathf.Cos(a) * len * .72f);
                    var frond = Union(Capsule(new Vector2(cx, gy + 2), mid, 3.2f, 3.4f), Capsule(mid, tip, 3.4f, .6f));
                    c.Fill(frond, Vertical(Mix(leafLight, spore, .08f), leafDark, gy + len, gy), Alpha(Shade(leafDark, .4f), .8f), 1.2f);
                }
            });
            Add(l, "plague.column", 80, 148, 8, (c, gy) =>
            {
                float cx = 40; c.SoftShadow(cx + 6, gy + 1, 26f, 6f, .4f, Alpha(shadow, 1f));
                var baseS = Box(cx, gy + 7, 18, 7, 2); c.Fill(baseS, Toon(baseS, stoneD, stoneM, stoneL, 7f, .1f, 2), Ink, 1.3f);
                var shaft = Poly(new Vector2(cx - 12, gy + 13), new Vector2(cx - 11, gy + 84), new Vector2(cx - 5, gy + 96), new Vector2(cx + 2, gy + 88), new Vector2(cx + 8, gy + 100), new Vector2(cx + 12, gy + 82), new Vector2(cx + 12, gy + 13));
                c.Fill(shaft, Split(cx - 2, Mix(stoneM, stoneL, .4f), stoneD, 16f), Ink, 1.5f);
                for (int k = 0; k < 4; k++) c.Fill(Intersect(shaft, Capsule(new Vector2(cx - 8 + k * 5.5f, gy + 14), new Vector2(cx - 8 + k * 5.5f, gy + 88), .6f, .6f)), Flat(Alpha(stoneD, .5f)));
                var mossTop = Poly(new Vector2(cx - 12, gy + 76), new Vector2(cx - 5, gy + 96), new Vector2(cx + 2, gy + 88), new Vector2(cx + 8, gy + 100), new Vector2(cx + 12, gy + 78), new Vector2(cx + 4, gy + 70), new Vector2(cx - 4, gy + 74));
                c.Fill(Intersect(shaft, mossTop), Toon(mossTop, leafDark, leafMid, leafLight, 6f, .1f, 5), null);
                c.Fill(Capsule(new Vector2(cx - 6, gy + 70), new Vector2(cx - 7, gy + 24), 2.2f, 1f), Toon(Circle(cx, gy, 1), leafDark, leafMid, leafLight), Alpha(leafDark, .8f), 1f);
                c.Fill(Capsule(new Vector2(cx + 7, gy + 60), new Vector2(cx + 6, gy + 18), 1.8f, 1f), Flat(leafMid), Alpha(leafDark, .8f), 1f);
                Lumps(c, cx, gy, 18, 12, 3, leafDark, leafMid, leafLight, 7);
            }, true);
            Add(l, "plague.rubble", 112, 60, 8, (c, gy) =>
            {
                c.SoftShadow(56, gy + 1, 44f, 7f, .4f, Alpha(shadow, 1f));
                Rock(c, 38, gy, 24, 18, 2, stoneD, stoneM, stoneL, null, 0, Shade(stoneD, .6f), .22f, 7);
                Rock(c, 74, gy, 22, 24, 5, stoneD, stoneM, stoneL, null, 0, Shade(stoneD, .6f), .22f, 7);
                Rock(c, 56, gy + 1, 15, 11, 8, stoneD, stoneM, stoneL);
                Lumps(c, 44, gy + 4, 28, 14, 3, leafDark, leafMid, leafLight, 15);
                Blades(c, 80, gy + 3, 5, 20, 12, 1.3f, leafMid, leafLight, 3, .4f);
            });
            Add(l, "plague.mushroom", 96, 84, 8, (c, gy) =>
            {
                c.SoftShadow(48, gy + 1, 30f, 5f, .35f, Alpha(shadow, 1f)); c.Glow(48, gy + 20, 36f, spore, .22f);
                float[,] sp = { { -20, 0, 22, 34 }, { 12, 0, 28, 46 }, { 28, 0, 16, 24 } };
                for (int k = 0; k < 3; k++)
                {
                    float x0 = 48 + sp[k, 0], r = sp[k, 2], h = sp[k, 3];
                    var stem = Box(x0, gy + h * .4f, 3.6f, h * .4f, 1.5f); c.Fill(stem, Toon(stem, Shade(moss, .6f), Mix(moss, Color.white, .35f), Mix(moss, Color.white, .7f), 3f), Ink, 1.1f);
                    var cap = Intersect(Ellipse(x0, gy + h * .74f, r * .5f, r * .36f), Box(x0, gy + h * .9f, r, h * .2f));
                    var capFull = Ellipse(x0, gy + h * .72f, r * .55f, r * .38f);
                    c.Fill(capFull, Toon(capFull, Shade(leafMid, .6f), leafMid, Mix(spore, leafLight, .35f), r * .4f, .05f, k + 3, .0f, .3f), Ink, 1.3f);
                    for (int d = 0; d < 3; d++) c.Fill(Circle(x0 - r * .2f + d * r * .22f, gy + h * (.74f + (d % 2) * .06f), 1.7f), Flat(Alpha(Color.white, .85f)));
                    c.Glow(x0, gy + h * .72f, r * .55f, spore, .20f);
                }
            });
        }

        // ---- holy (desert, oasis, garden) -------------------------------------------------------------------------------------------

        static void AddHoly(List<Def> l)
        {
            Color sand = P(5, 0), green = P(5, 1), gold = P(5, 2), shadow = P(5, 5);
            Color leafDark = Shade(green, .62f), leafMid = green, leafLight = Mix(green, Color.white, .30f);
            Color stoneD = Shade(Mix(sand, shadow, .3f), .8f), stoneM = Mix(sand, Color.white, .02f), stoneL = Mix(sand, Color.white, .45f);
            Add(l, "holy.palm", 148, 212, 10, (c, gy) =>
            {
                float cx = 74; c.SoftShadow(cx + 14, gy + 1, 38f, 7f, .35f, Alpha(shadow, 1f));
                Color bark = Mix(Shade(sand, .5f), P(5, 2), .15f), barkLight = Mix(bark, sand, .35f);
                var pts = new[] { new Vector2(cx - 2, gy), new Vector2(cx + 4, gy + 50), new Vector2(cx + 2, gy + 100), new Vector2(cx - 6, gy + 140) };
                for (int s = 0; s < 3; s++)
                {
                    var seg = Capsule(pts[s], pts[s + 1], 7.5f - s * 1.1f, 7.5f - (s + 1) * 1.1f);
                    c.Fill(seg, Toon(seg, Shade(bark, .55f), bark, barkLight, 6f, .12f, 11 + s), Ink, 1.4f);
                }
                for (int k = 0; k < 10; k++) { float t = k / 9f; float yy = gy + 8 + t * 128f; float xx = Mathf.Lerp(cx - 1, cx - 5, t) + Mathf.Sin(t * 3f) * 4f; c.Fill(Capsule(new Vector2(xx - 6, yy), new Vector2(xx + 6, yy + 1), .6f, .6f), Flat(Alpha(Shade(bark, .4f), .6f))); }
                Vector2 crown = new Vector2(cx - 6, gy + 140);
                for (int f = 0; f < 9; f++)
                {
                    float a = (-165f + f * 37.5f) * Mathf.Deg2Rad, len = 62f - (f % 2) * 10f;
                    var tip = crown + new Vector2(Mathf.Cos(a) * len, Mathf.Sin(a) * len * .55f - 14f * Mathf.Abs(Mathf.Cos(a)));
                    var mid = crown + new Vector2(Mathf.Cos(a) * len * .5f, Mathf.Sin(a) * len * .5f + 12f);
                    var frond = Union(Capsule(crown, mid, 3.2f, 3.8f), Capsule(mid, tip, 3.8f, .8f));
                    c.Fill(frond, Vertical(leafLight, leafDark, crown.y + 40, crown.y - 30), Alpha(Shade(leafDark, .4f), .85f), 1.3f);
                }
                var nut = Circle(crown.x + 3, crown.y - 4, 5); c.Fill(nut, Toon(nut, Shade(bark, .4f), Shade(bark, .7f), bark, 4f), Ink, 1.1f);
            }, true);
            Add(l, "holy.shrub", 96, 68, 8, (c, gy) =>
            {
                c.SoftShadow(52, gy + 1, 34f, 6f, .3f, Alpha(shadow, 1f));
                Lumps(c, 48, gy, 34, 24, 5, leafDark, leafMid, leafLight, 31);
                for (int k = 0; k < 6; k++) { float x = 26 + RegionNoise.Hash01(k, 2, 5) * 44, y = gy + 12 + RegionNoise.Hash01(k, 3, 5) * 20; c.Fill(Circle(x, y, 2.4f), Flat(Mix(gold, Color.white, .35f))); c.Fill(Circle(x, y, 1f), Flat(Mix(gold, Color.white, .8f))); }
            });
            Add(l, "holy.flowers", 88, 60, 6, (c, gy) =>
            {
                c.SoftShadow(44, gy + 1, 30f, 5f, .25f, Alpha(shadow, 1f));
                Blades(c, 44, gy, 12, 26, 44, 1.2f, leafDark, leafLight, 12, .5f);
                Color[] pet = { Color.white, Mix(gold, Color.white, .4f), new Color(.93f, .55f, .62f) };
                for (int k = 0; k < 9; k++)
                {
                    float x = 16 + RegionNoise.Hash01(k, 1, 6) * 56, y = gy + 16 + RegionNoise.Hash01(k, 2, 6) * 20; Color pc = pet[k % 3];
                    c.Fill(Capsule(new Vector2(x, gy + 3), new Vector2(x, y - 2), .9f, .7f), Flat(leafDark));
                    for (int p = 0; p < 5; p++) { float a = p * 1.2566f; c.Fill(Circle(x + Mathf.Cos(a) * 2.6f, y + Mathf.Sin(a) * 2.6f, 2.2f), Flat(pc), Alpha(Shade(pc, .55f), .7f), .7f); }
                    c.Fill(Circle(x, y, 1.5f), Flat(Mix(gold, Color.yellow, .3f)));
                }
            });
            Add(l, "holy.pillar", 72, 124, 8, (c, gy) =>
            {
                float cx = 36; c.SoftShadow(cx + 6, gy + 1, 26f, 6f, .35f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 6, 18, 6, 1.5f); c.Fill(plinth, Toon(plinth, stoneD, stoneM, stoneL, 6f, .08f, 2), Ink, 1.3f);
                var shaft = Poly(new Vector2(cx - 11, gy + 12), new Vector2(cx - 10, gy + 86), new Vector2(cx - 3, gy + 92), new Vector2(cx + 4, gy + 84), new Vector2(cx + 11, gy + 90), new Vector2(cx + 11, gy + 12));
                c.Fill(shaft, Split(cx - 1, stoneL, stoneD, 14f), Ink, 1.5f);
                foreach (float by in new[] { 20f, 72f }) c.Fill(Intersect(shaft, Box(cx, gy + by, 14, 3.4f)), Toon(Circle(cx, gy, 1), Shade(gold, .7f), gold, Mix(gold, Color.white, .5f), 3f));
                for (int k = 0; k < 3; k++) c.Fill(Intersect(shaft, Capsule(new Vector2(cx - 6 + k * 6, gy + 26), new Vector2(cx - 6 + k * 6, gy + 70), .5f, .5f)), Flat(Alpha(stoneD, .45f)));
                c.Glow(cx, gy + 72, 10f, gold, .18f);
            }, true);
            Add(l, "holy.rock", 96, 60, 8, (c, gy) =>
            {
                c.SoftShadow(50, gy + 1, 34f, 6f, .3f, Alpha(shadow, 1f));
                Rock(c, 38, gy, 22, 20, 6, stoneD, stoneM, stoneL, null, 0, Shade(stoneD, .7f), .2f);
                Rock(c, 66, gy, 16, 14, 12, stoneD, stoneM, stoneL);
            });
            Add(l, "holy.grass", 80, 60, 6, (c, gy) =>
            {
                c.SoftShadow(40, gy + 1, 24f, 4f, .22f, Alpha(shadow, 1f));
                Blades(c, 40, gy, 10, 40, 28, 1.5f, leafDark, Mix(leafLight, gold, .15f), 17, .6f);
            });
        }
    }
}

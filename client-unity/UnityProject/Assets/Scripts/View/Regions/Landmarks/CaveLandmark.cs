using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: the Frost cave's art (kind 4), painted procedurally like the region art and derived only from the tiles the
    /// framework classified, so it is right in all eight orientations. Pieces:
    ///  - rock mass: the cave's wall tiles drawn as one rounded, shaded body (a sprite per wall row, on the walls' sorting rule), so the
    ///    ring and the rock pillars read as rock, not tile blocks; visible from inside while the roof is faded;
    ///  - roof: one rock hill over the interior and the ring, snow-capped, at the footprint's south edge; fades while an actor is inside;
    ///  - mouth: a dark pool on the entrance tiles, an arch (front south) or jamb boulders (other fronts), and a cold glow in front.
    /// Colours are sRGB, as the region atlas.
    /// </summary>
    public static class CaveLandmark
    {
        const int Ppt = 12;                                   // texture pixels per tile for the rock layers
        static readonly Color RockDark = new Color(.20f, .23f, .32f), RockMid = new Color(.36f, .42f, .53f), RockLight = new Color(.64f, .73f, .83f),
            Snow = new Color(.88f, .94f, 1f), Outline = new Color(.07f, .09f, .15f), Cold = new Color(.45f, .82f, 1f);

        public static void Build(Landmark lm)
        {
            var walls = new RockField(lm, false); var hill = new RockField(lm, true);
            BuildRockMass(lm, walls);
            BuildRoof(lm, hill);
            if (lm.ArchTiles.Length > 0) BuildMouth(lm);
        }

        // ---- the rock field: a smooth coverage and height over the footprint, from a tile mask ---------------------------------

        sealed class RockField
        {
            const int Pad = 3;
            readonly int _w, _h, _gw, _gh; readonly float[] _raw, _blur; readonly bool[] _solid;
            public RockField(Landmark lm, bool roof)
            {
                _w = lm.FootW; _h = lm.FootH; _gw = _w + 2 * Pad; _gh = _h + 2 * Pad;
                _solid = new bool[_w * _h]; _raw = new float[_gw * _gh]; _blur = new float[_gw * _gh];
                for (int y = 0; y < _h; y++) for (int x = 0; x < _w; x++)
                {
                    bool s = roof ? lm.RoofCovers(lm.FootX + x, lm.FootY + y) : lm.IsWall(lm.FootX + x, lm.FootY + y);
                    _solid[y * _w + x] = s; if (s) _raw[(y + Pad) * _gw + x + Pad] = 1f;
                }
                var a = (float[])_raw.Clone(); var b = new float[a.Length];
                for (int pass = 0; pass < 3; pass++)
                {
                    for (int y = 1; y < _gh - 1; y++) for (int x = 1; x < _gw - 1; x++)
                    {
                        float s = 0; for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) s += a[(y + dy) * _gw + x + dx];
                        b[y * _gw + x] = s / 9f;
                    }
                    var t = a; a = b; b = t;
                }
                System.Array.Copy(a, _blur, a.Length);
            }
            float Bilin(float[] g, float u, float v)
            {
                float gx = u - .5f + Pad, gy = v - .5f + Pad; int x0 = Mathf.FloorToInt(gx), y0 = Mathf.FloorToInt(gy);
                if (x0 < 0 || y0 < 0 || x0 + 1 >= _gw || y0 + 1 >= _gh) return 0f;
                float fx = gx - x0, fy = gy - y0;
                return Mathf.Lerp(Mathf.Lerp(g[y0 * _gw + x0], g[y0 * _gw + x0 + 1], fx), Mathf.Lerp(g[(y0 + 1) * _gw + x0], g[(y0 + 1) * _gw + x0 + 1], fx), fy);
            }
            /// <summary>Coverage in 0..1 at footprint-local tile coordinates (u east, v south); above .35 is rock.</summary>
            public float Cover(float u, float v)
            {
                float c = Bilin(_raw, u, v);
                int i = Mathf.FloorToInt(u), j = Mathf.FloorToInt(v);
                if (i >= 0 && j >= 0 && i < _w && j < _h && _solid[j * _w + i])
                {
                    float fu = u - i, fv = v - j;
                    if (fu > .08f && fu < .92f && fv > .08f && fv < .92f) c = Mathf.Max(c, .6f);   // the tile's own square stays covered
                }
                return c;
            }
            public bool SolidAt(int x, int y) { return x >= 0 && y >= 0 && x < _w && y < _h && _solid[y * _w + x]; }
            /// <summary>Rock colour at (u, v): a dome shade from the blurred height, speckle, snow on the high lit parts, dark outline at the rim.</summary>
            public Color Paint(float u, float v, float cover, int seed)
            {
                float h = Bilin(_blur, u, v), e = .3f;
                float gu = Bilin(_blur, u + e, v) - Bilin(_blur, u - e, v), gv = Bilin(_blur, u, v + e) - Bilin(_blur, u, v - e);
                float lit = Mathf.Clamp((gu + gv) * 1.6f, -.5f, .5f);
                float n = RegionNoise.Periodic(u * 2.3f, v * 2.3f, 61, seed), n2 = RegionNoise.Periodic(u * 6f, v * 6f, 61, seed + 7);
                float t = Mathf.Clamp01(h * .9f + lit * .8f + (n - .5f) * .35f + (n2 - .5f) * .12f);
                Color c = t < .5f ? Color.Lerp(RockDark, RockMid, t * 2f) : Color.Lerp(RockMid, RockLight, (t - .5f) * 2f);
                float n3 = RegionNoise.Periodic(u * .7f, v * .7f, 61, seed + 13);
                float snow = (n3 - .6f) * 5f + (lit > .15f ? .3f : 0f) + (h - .8f) * .5f;
                if (snow > .35f) c = Color.Lerp(c, Snow, Mathf.Clamp01((snow - .35f) * 2.5f) * .85f);
                float rim = Mathf.Clamp01((.5f - cover) / .15f);                 // 0 inside, 1 at the edge
                return Color.Lerp(c, Outline, rim);
            }
        }

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

        // ---- rock mass: one strip per wall row, sorted like the walls ------------------------------------------------------------

        static void BuildRockMass(Landmark lm, RockField field)
        {
            const float Sq = ArenaView.GroundSquash, Face = .67f, Over = .05f;
            int fw = lm.FootW, W = fw * Ppt + Ppt, H = Mathf.CeilToInt((Face + Sq + 2 * Over) * Ppt);
            var px = new Color32[W * H];
            for (int y = 0; y < lm.FootH; y++)
            {
                bool any = false; for (int x = 0; x < fw && !any; x++) any = field.SolidAt(x, y);
                if (!any) continue;
                float py = -(lm.FootY + y + 1) * Sq;                              // the tile row's bottom edge in world space
                for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
                {
                    float wx = -.5f + (i + .5f) / Ppt, wy = py - Over + (j + .5f) / Ppt;   // wx relative to the footprint's left edge
                    Color32 o = default;
                    if (wy >= py + Face)                                           // the cap: the tile seen from above, lifted by the face height
                    {
                        float v = y + 1f - (wy - py - Face) / Sq;
                        if (v >= y - .15f && v <= y + 1.15f)
                        {
                            float c = field.Cover(wx, v);
                            if (c > .35f) o = AntiAlias(field.Paint(wx, v, c, 11), c);
                        }
                    }
                    else if (wy >= py)                                             // the south face, only where nothing solid stands south
                    {
                        int tx = Mathf.FloorToInt(wx);
                        if (field.SolidAt(tx, y) && !field.SolidAt(tx, y + 1))
                        {
                            float k = (wy - py) / Face, n = RegionNoise.Periodic(wx * 3f, k * 3f, 61, 23);
                            Color c = Color.Lerp(Outline, RockDark, Mathf.Clamp01(.35f + k * .9f + (n - .5f) * .3f));
                            if (wx - tx < .06f || tx + 1 - wx < .06f) c = Color.Lerp(c, Outline, .5f);
                            o = c;
                        }
                    }
                    px[j * W + i] = o;
                }
                var tex = NewTexture(lm, W, H, "Cave rock row " + y); tex.SetPixels32(px); tex.Apply(false, true);
                NewSprite(lm, tex, "Cave rock row " + y, Vector2.zero, Ppt, new Vector3(lm.FootX - .5f, py - Over, 0), Vector3.one, 2000 + 16 * (lm.FootY + y) + 1);
            }
        }

        static Color32 AntiAlias(Color c, float cover)
        {
            c.a = Mathf.Clamp01((cover - .35f) / .06f); return c;
        }

        // ---- roof: the hill ---------------------------------------------------------------------------------------------------------

        static void BuildRoof(Landmark lm, RockField field)
        {
            const float Sq = ArenaView.GroundSquash; const int Margin = Ppt / 2;
            int W = lm.FootW * Ppt + 2 * Margin, H = lm.FootH * Ppt + 2 * Margin;
            var px = new Color32[W * H];
            for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
            {
                float u = (i + .5f - Margin) / Ppt, v = lm.FootH + (Margin - j - .5f) / Ppt;    // texture row 0 is the south edge
                float c = field.Cover(u, v);
                if (c > .35f)
                {
                    var col = field.Paint(u, v, c, 5);
                    float du = (u - lm.FootW / 2f) / (lm.FootW / 2f), dv = (v - lm.FootH / 2f) / (lm.FootH / 2f), r = Mathf.Clamp01(Mathf.Sqrt(du * du + dv * dv));
                    float k = .78f + .38f * (1f - r) - .1f * (du + dv);          // a dome: brighter at the crown, lit from the north west
                    col.r *= k; col.g *= k; col.b *= k;
                    px[j * W + i] = AntiAlias(col, c);
                }
            }
            var tex = NewTexture(lm, W, H, "Cave roof"); tex.SetPixels32(px); tex.Apply(false, true);
            float cx = lm.FootX + lm.FootW / 2f, cy = -(lm.FootY + lm.FootH / 2f) * Sq;
            var sr = NewSprite(lm, tex, "Cave roof (rock hill)", new Vector2(.5f, .5f), Ppt, new Vector3(cx, cy, 0), new Vector3(1f, Sq, 1f), lm.RoofOrder);
            lm.AddRoofRenderer(sr);
        }

        // ---- the mouth ------------------------------------------------------------------------------------------------------------------

        static void BuildMouth(Landmark lm)
        {
            const float Sq = ArenaView.GroundSquash;
            int minX = int.MaxValue, maxX = int.MinValue, minY = int.MaxValue, maxY = int.MinValue;
            foreach (var t in lm.ArchTiles) { minX = Mathf.Min(minX, t.X); maxX = Mathf.Max(maxX, t.X); minY = Mathf.Min(minY, t.Y); maxY = Mathf.Max(maxY, t.Y); }
            Vector2 f = lm.FrontVector; bool vertical = Mathf.Abs(f.x) > Mathf.Abs(f.y);   // front east / west: the mouth runs north-south
            Vector2 dir = vertical ? new Vector2(Mathf.Sign(f.x), 0) : new Vector2(0, Mathf.Sign(f.y));   // unit, x east, y south
            float mx = (minX + maxX + 1) / 2f, my = (minY + maxY + 1) / 2f;
            float lenTiles = vertical ? maxY - minY + 1 : maxX - minX + 1;

            // The dark pool on the entrance tiles (the ground under the arch, in shadow with a cold sheen).
            float pw = vertical ? maxX - minX + 1.2f : lenTiles + .4f, ph = vertical ? lenTiles + .4f : (maxY - minY + 1) + .5f;
            var pool = NewTexture(lm, 48, 48, "Cave mouth pool"); var pp = new Color32[48 * 48];
            for (int j = 0; j < 48; j++) for (int i = 0; i < 48; i++)
            {
                float dx = (i + .5f) / 24f - 1f, dy = (j + .5f) / 24f - 1f, r = Mathf.Sqrt(dx * dx + dy * dy);
                float a = Mathf.Clamp01((1f - r) / .35f);
                var c = Color.Lerp(new Color(.02f, .04f, .09f), new Color(.10f, .24f, .34f), Mathf.Clamp01(.5f - dy * .4f) * (1f - r));
                c.a = a * .92f; pp[j * 48 + i] = c;
            }
            pool.SetPixels32(pp); pool.Apply(false, true);
            NewSprite(lm, pool, "Cave mouth pool", new Vector2(.5f, .5f), 24f, lm.ArchCentre, new Vector3(pw / 2f, ph * Sq / 2f, 1f), -85);

            // The cold glow spilling out of the mouth, in front of it.
            var glow = NewTexture(lm, 64, 64, "Cave mouth glow"); var gp = new Color32[64 * 64];
            for (int j = 0; j < 64; j++) for (int i = 0; i < 64; i++)
            {
                float dx = (i + .5f) / 32f - 1f, dy = (j + .5f) / 32f - 1f, r = Mathf.Clamp01(Mathf.Sqrt(dx * dx + dy * dy));
                var c = Cold; c.a = Mathf.Pow(1f - r, 2f) * .42f; gp[j * 64 + i] = c;
            }
            glow.SetPixels32(gp); glow.Apply(false, true);
            Vector3 gc = lm.ArchCentre + new Vector3(dir.x * 1.6f, -dir.y * 1.6f * Sq, 0);
            NewSprite(lm, glow, "Cave mouth glow", new Vector2(.5f, .5f), 32f, gc, new Vector3(vertical ? 4.2f : 5.6f, (vertical ? 5.2f : 3.6f) * Sq, 1f) / 2f, -75);

            int order = 2000 + 16 * maxY + 1;
            if (!vertical && dir.y > 0) BuildArch(lm, mx, maxY + 1, lenTiles, order);
            else BuildJambs(lm, vertical, mx, my, lenTiles, minX, minY, maxX, maxY, dir, order);
        }

        /// <summary>Front south: seen head on, a rock arch with a dark opening, a keystone and a cold glow at its foot.</summary>
        static void BuildArch(Landmark lm, float cx, int southRow, float lenTiles, int order)
        {
            const float Sq = ArenaView.GroundSquash; const int P = 16;
            float wt = lenTiles + .8f, ht = 1.9f; int W = Mathf.CeilToInt(wt * P), H = Mathf.CeilToInt(ht * P);
            float mid = wt / 2f, half = lenTiles / 2f;
            var px = new Color32[W * H];
            for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
            {
                float x = (i + .5f) / P, y = (j + .5f) / P;
                float outer = ArchSdf(x, y, mid, half + .4f, 1.05f, .8f), inner = ArchSdf(x, y, mid, half - .05f, .8f, .62f);
                if (outer > 0f) continue;
                Color c;
                if (inner < 0f)
                {
                    float g = Mathf.Clamp01(1f - y / .55f) * Mathf.Clamp01(1f - Mathf.Abs(x - mid) / (half + .2f));
                    c = Color.Lerp(new Color(.015f, .03f, .07f), new Color(.2f, .55f, .75f), g * g * .8f);
                    float edge = Mathf.Clamp01(-inner * 6f); c = Color.Lerp(Outline, c, edge);
                }
                else
                {
                    float n = RegionNoise.Periodic(x * 3f, y * 3f, 61, 31);
                    float t = Mathf.Clamp01(.25f + y / ht * .55f + (n - .5f) * .35f + (x < mid ? .08f : -.04f));
                    c = t < .5f ? Color.Lerp(RockDark, RockMid, t * 2f) : Color.Lerp(RockMid, RockLight, (t - .5f) * 2f);
                    if (y > 1.05f && -outer < .2f && n > .35f) c = Color.Lerp(c, Snow, .85f);                 // snow on the crown
                    if (Mathf.Abs(x - mid) < .22f && y > 1.1f && y < 1.6f) c = Color.Lerp(c, RockLight, .5f);   // keystone
                    c = Color.Lerp(Outline, c, Mathf.Clamp01(-outer * 9f));
                }
                c.a = Mathf.Clamp01(-outer * P + .5f); px[j * W + i] = c;
            }
            var tex = NewTexture(lm, W, H, "Cave mouth arch"); tex.SetPixels32(px); tex.Apply(false, true);
            NewSprite(lm, tex, "Cave mouth arch", new Vector2(.5f, 0f), P, new Vector3(cx, -southRow * Sq, 0), Vector3.one, order);
        }

        /// <summary>Distance (negative inside, in tiles) to an arch: a box to height <paramref name="top"/> topped by a half ellipse.</summary>
        static float ArchSdf(float x, float y, float cx, float halfW, float top, float rise)
        {
            float dx = Mathf.Abs(x - cx);
            if (y <= top) return Mathf.Max(dx - halfW, -y);
            float ex = dx / halfW, ey = (y - top) / rise, d = Mathf.Sqrt(ex * ex + ey * ey) - 1f;
            return d * Mathf.Min(halfW, rise);
        }

        /// <summary>Other fronts: the opening is seen edge on, so two snow-capped boulders mark its ends and the pool and glow do the rest.</summary>
        static void BuildJambs(Landmark lm, bool vertical, float mx, float my, float lenTiles, int minX, int minY, int maxX, int maxY, Vector2 dir, int order)
        {
            const float Sq = ArenaView.GroundSquash; const int P = 24;
            int S = 2 * P; var px = new Color32[S * S];
            for (int j = 0; j < S; j++) for (int i = 0; i < S; i++)
            {
                float x = (i + .5f) / P - 1f, y = (j + .5f) / P - 1f;
                float n = RegionNoise.Periodic(x * 3f + 5f, y * 3f + 5f, 61, 41);
                float d = Mathf.Sqrt(x * x * .85f + y * y * 1.1f) - (.78f + (n - .5f) * .22f);
                if (d > 0f) continue;
                float t = Mathf.Clamp01(.55f - x * .25f + y * .3f + (n - .5f) * .35f);
                Color c = t < .5f ? Color.Lerp(RockDark, RockMid, t * 2f) : Color.Lerp(RockMid, RockLight, (t - .5f) * 2f);
                if (y > .1f && n > .4f) c = Color.Lerp(c, Snow, .8f);
                c = Color.Lerp(Outline, c, Mathf.Clamp01(-d * 8f)); c.a = Mathf.Clamp01(-d * P + .5f); px[j * S + i] = c;
            }
            var tex = NewTexture(lm, S, S, "Cave mouth jamb"); tex.SetPixels32(px); tex.Apply(false, true);
            float half = lenTiles / 2f + .25f;
            for (int k = -1; k <= 1; k += 2)
            {
                float jx = vertical ? mx : mx + k * half, jy = vertical ? my + k * half : my;      // tile units (south positive)
                int row = Mathf.Min(maxY, Mathf.Max(minY, Mathf.FloorToInt(jy)));
                NewSprite(lm, tex, "Cave mouth jamb", new Vector2(.5f, .35f), P, new Vector3(jx, -jy * Sq, 0), new Vector3(1.1f, 1.1f, 1f), 2000 + 16 * row + 2);
            }
        }
    }
}

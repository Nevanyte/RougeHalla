using System;
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-5: the Holy hall's art (kind 5), painted procedurally once per map and derived only from the tiles the framework
    /// classified (never from a copy of the drawing), so it is right in all eight orientations. The wall groups of the footprint are found
    /// from the tiles: the one larger than a 3 x 3 block is the shrine, every other group is a pier. Pieces:
    ///  - columns ("Hall column"): one per pier group: a sandstone stylobate that repaints the group's whole wall silhouette (fully opaque, so
    ///    the blocks RegionWalls still draws never show at a soft edge) with a fluted shaft, gold bands and a capital standing on it. Sorted
    ///    on the walls' row rule (the group's south row), so an actor behind a column is hidden by it and one in front stands before it.
    ///    There is no roof or beam over the colonnade: the nave and its camps stay in plain view;
    ///  - roof: a sandstone hip roof over the shrine's box with a gold ridge; one piece through Landmark.AddRoofRenderer. Its lower edge is
    ///    the wall-cap line (the south wall's face stays visible and an actor in front is not overlapped) and it has a notch over the door
    ///    tiles and a head's height above them, so an actor in the doorway is never hidden by it (the church's final way);
    ///  - door ("Hall door"): a worn sill on the three door tiles and two gilded jamb posts at its ends;
    ///  - light ("Hall light"): a warm gold glow and a ring of light over the 3 x 3 healing-light tiles (terrain Light);
    ///  - threshold ("Hall threshold"): a paved band with a gold inlay across the entrance tiles and a low lamp post at each end.
    /// Colours are sRGB and follow the Holy zone (pale sandstone, gold accents; walls there are sandstone).
    /// </summary>
    public static class HallLandmark
    {
        const float Sq = ArenaView.GroundSquash, Wall = RegionWalls.WallHeight;
        static readonly Color Sand = new Color(.84f, .73f, .52f), SandLit = new Color(.95f, .87f, .67f), SandDark = new Color(.60f, .50f, .36f),
            Ink = new Color(.20f, .13f, .08f), Gold = new Color(.96f, .76f, .26f), GoldDark = new Color(.70f, .50f, .14f), Warm = new Color(1f, .86f, .45f),
            RoofLit = new Color(.90f, .76f, .50f), RoofDark = new Color(.66f, .50f, .32f);

        sealed class Group
        {
            public int MinX = int.MaxValue, MinY = int.MaxValue, MaxX = -1, MaxY = -1;
            public readonly List<Vector2Int> Tiles = new List<Vector2Int>();
        }

        struct Box
        {
            public float X0, Y0, X1, Y1; public bool Valid;
            public bool Contains(float x, float y) { return Valid && x >= X0 && x <= X1 && y >= Y0 && y <= Y1; }
            public float Dist(float x, float y)
            {
                if (!Valid) return 99f;
                float dx = Mathf.Max(Mathf.Max(X0 - x, x - X1), 0f), dy = Mathf.Max(Mathf.Max(Y0 - y, y - Y1), 0f);
                return Mathf.Sqrt(dx * dx + dy * dy);
            }
        }

        public static void Build(Landmark lm)
        {
            var groups = FindGroups(lm);
            if (groups.Count == 0) return;
            Group shrine = null;
            foreach (var g in groups) if (g.Tiles.Count > 9 && (shrine == null || g.Tiles.Count > shrine.Tiles.Count)) shrine = g;
            foreach (var g in groups) if (g != shrine) BuildColumn(lm, g);
            if (shrine != null) BuildShrine(lm, shrine);
            if (lm.ArchTiles.Length > 0) BuildThreshold(lm);
        }

        // ---- reading the tiles --------------------------------------------------------------------------------------------------

        static List<Group> FindGroups(Landmark lm)
        {
            var groups = new List<Group>(); var seen = new bool[lm.FootW * lm.FootH]; var stack = new Stack<Vector2Int>();
            for (int y = lm.FootY; y < lm.FootY + lm.FootH; y++) for (int x = lm.FootX; x < lm.FootX + lm.FootW; x++)
            {
                int i = (y - lm.FootY) * lm.FootW + x - lm.FootX;
                if (seen[i] || !lm.IsWall(x, y)) continue;
                var g = new Group(); seen[i] = true; stack.Push(new Vector2Int(x, y));
                while (stack.Count > 0)
                {
                    var t = stack.Pop(); g.Tiles.Add(t);
                    g.MinX = Mathf.Min(g.MinX, t.x); g.MaxX = Mathf.Max(g.MaxX, t.x); g.MinY = Mathf.Min(g.MinY, t.y); g.MaxY = Mathf.Max(g.MaxY, t.y);
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = t.x + dx, ny = t.y + dy;
                        if (nx < lm.FootX || ny < lm.FootY || nx >= lm.FootX + lm.FootW || ny >= lm.FootY + lm.FootH || !lm.IsWall(nx, ny)) continue;
                        int ni = (ny - lm.FootY) * lm.FootW + nx - lm.FootX;
                        if (seen[ni]) continue;
                        seen[ni] = true; stack.Push(new Vector2Int(nx, ny));
                    }
                }
                groups.Add(g);
            }
            return groups;
        }

        /// <summary>The closed doorway of the shrine: the non-wall tiles on its box border (never a corner), one contiguous run of at most five.</summary>
        static List<Vector2Int> DoorTiles(Landmark lm, Group b)
        {
            var door = new List<Vector2Int>();
            for (int y = b.MinY; y <= b.MaxY; y++) for (int x = b.MinX; x <= b.MaxX; x++)
            {
                bool edgeX = x == b.MinX || x == b.MaxX, edgeY = y == b.MinY || y == b.MaxY;
                if ((edgeX || edgeY) && !(edgeX && edgeY) && !lm.IsWall(x, y)) door.Add(new Vector2Int(x, y));
            }
            if (door.Count > 5) door.Clear();
            else if (door.Count > 0)
            {
                Extent(door, out int x0, out int y0, out int x1, out int y1);
                bool oneLine = (x0 == x1 || y0 == y1) && (x1 - x0 + 1) * (y1 - y0 + 1) == door.Count;
                if (!oneLine) door.Clear();
            }
            return door;
        }

        static void Extent(List<Vector2Int> tiles, out int x0, out int y0, out int x1, out int y1)
        {
            x0 = int.MaxValue; y0 = int.MaxValue; x1 = -1; y1 = -1;
            foreach (var t in tiles) { x0 = Mathf.Min(x0, t.x); x1 = Mathf.Max(x1, t.x); y0 = Mathf.Min(y0, t.y); y1 = Mathf.Max(y1, t.y); }
        }

        // ---- the canvas ---------------------------------------------------------------------------------------------------------

        /// <summary>A world-space painting surface: pixels are composited "over" in call order; one texture and sprite at the end.</summary>
        sealed class Canvas
        {
            public readonly float X0, Y0; public readonly int W, H, Ppu; readonly Color[] _px;
            public Canvas(float x0, float y0, float w, float h, int ppu)
            {
                X0 = x0; Y0 = y0; Ppu = ppu; W = Mathf.CeilToInt(w * ppu); H = Mathf.CeilToInt(h * ppu); _px = new Color[W * H];
            }
            public void Paint(Func<float, float, Color> f)
            {
                for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
                {
                    var c = f(X0 + (i + .5f) / Ppu, Y0 + (j + .5f) / Ppu);
                    if (c.a <= 0f) continue;
                    int k = j * W + i; var d = _px[k]; float oa = c.a + d.a * (1f - c.a);
                    _px[k] = new Color((c.r * c.a + d.r * d.a * (1f - c.a)) / oa, (c.g * c.a + d.g * d.a * (1f - c.a)) / oa, (c.b * c.a + d.b * d.a * (1f - c.a)) / oa, oa);
                }
            }
            public SpriteRenderer ToSprite(Landmark lm, string name, string objectName, int order)
            {
                var tex = new Texture2D(W, H, TextureFormat.RGBA32, false, false) { name = name, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                tex.SetPixels(_px); tex.Apply(false, true); lm.Own(tex);                var sprite = Sprite.Create(tex, new Rect(0, 0, W, H), Vector2.zero, Ppu, 0, SpriteMeshType.FullRect); lm.Own(sprite);
                var go = new GameObject(objectName); go.transform.SetParent(lm.Root.transform, false);
                go.transform.localPosition = new Vector3(X0, Y0, 0);
                var sr = go.AddComponent<SpriteRenderer>(); sr.sprite = sprite; sr.sharedMaterial = lm.Material; sr.sortingOrder = order;
                return sr;
            }
        }

        static Color Shade(Color c, float k) { return new Color(Mathf.Clamp01(c.r * k), Mathf.Clamp01(c.g * k), Mathf.Clamp01(c.b * k), 1f); }
        static Color WithAlpha(Color c, float a) { c.a = a; return c; }
        static float Noise(float x, float y, int seed) { return RegionNoise.Periodic(x, y, 61, seed); }

        // ---- the columns ---------------------------------------------------------------------------------------------------------

        /// <summary>One column on one pier group: the stylobate repaints the blocks' whole silhouette, the column rises from the middle of its top.</summary>
        static void BuildColumn(Landmark lm, Group g)
        {
            const int P = 20; const float Pad = .2f, ShaftH = 1.9f, CapH = .3f;
            float xa = g.MinX, xb = g.MaxX + 1, cx = (xa + xb) / 2f, hw = (xb - xa) / 2f;
            float baseY = -(g.MaxY + 1) * Sq;                                          // the blocks' south edge
            float topH = Wall + (g.MaxY - g.MinY + 1) * Sq;                            // the blocks' cap line above baseY
            float h0 = (Wall + topH) / 2f;                                              // the middle of the stylobate's top surface
            float total = h0 + .12f + ShaftH + CapH + .2f;
            var cv = new Canvas(xa - Pad, baseY - .02f, xb - xa + 2f * Pad, total + .02f, P);
            int seed = g.MinX * 7 + g.MinY;
            cv.Paint((wx, wy) =>
            {
                float lx = wx - cx, ly = wy - baseY, ax = Mathf.Abs(lx);
                if (ly < 0f) return default;
                // stylobate: a south face and a top surface covering exactly the wall blocks' silhouette
                if (ax <= hw + .01f && ly <= topH + .01f)
                {
                    bool face = ly < Wall;
                    Color c;
                    if (face)
                    {
                        float course = ly / .22f, jx = (wx + ((int)Mathf.Floor(course) & 1) * .45f) / .9f;
                        c = Shade(Color.Lerp(Sand, SandLit, .4f), .86f + .22f * (ly / Wall) + .1f * (Noise(wx * 3f, wy * 3f, 5) - .5f));
                        if (course - Mathf.Floor(course) < .08f || jx - Mathf.Floor(jx) < .04f) c = Shade(c, .72f);
                    }
                    else
                    {
                        c = Shade(Color.Lerp(SandLit, Sand, .35f), .94f + .12f * Noise(wx * 4f, wy * 4f, 9));
                        float inset = Mathf.Min(hw - ax, Mathf.Min(ly - Wall, topH - ly));
                        if (inset > .14f && inset < .19f) c = Shade(c, .84f);           // the inset step line
                        if (inset < .09f) c = Shade(c, 1.06f);
                    }
                    if (ax > hw - .035f || ly < .03f || ly > topH - .03f && !face || Mathf.Abs(ly - Wall) < .02f) c = Mathf.Abs(ly - Wall) < .02f && ax < hw - .035f && ly < topH - .03f ? Shade(c, .6f) : Ink;
                    c.a = 1f; return c;
                }
                return default;
            });
            cv.Paint((wx, wy) =>                                                        // the column, over the stylobate
            {
                float lx = wx - cx, ly = wy - baseY, ax = Mathf.Abs(lx);
                float h = ly - h0;                                                     // height above the column's foot on the top
                if (h < -.02f) return default;
                // plinth (square block with a front face), shaft, capital with a gold band
                float half;
                if (h < .12f) half = .66f;
                else if (h < .12f + ShaftH) half = Mathf.Lerp(.50f, .43f, (h - .12f) / ShaftH);
                else if (h < .12f + ShaftH + .08f) half = .54f;
                else if (h < .12f + ShaftH + CapH) half = Mathf.Lerp(.54f, .74f, (h - .12f - ShaftH - .08f) / (CapH - .08f));
                else return default;
                if (ax > half) return default;
                float s = Mathf.Clamp(lx / half, -1f, 1f);
                Color col;
                bool shaft = h >= .12f && h < .12f + ShaftH;
                if (shaft)
                {
                    col = Color.Lerp(SandLit, SandDark, Mathf.Clamp01(.35f + s * .55f));    // round: lit left, dark right
                    float fl = Mathf.Abs(Mathf.Sin(lx / half * 4.5f)); if (fl > .93f) col = Shade(col, .84f);   // flutes
                    float t = (h - .12f) / ShaftH;
                    if (t < .08f || (t > .46f && t < .5f) || t > .92f) col = Color.Lerp(col, Gold, .85f);   // gold bands at foot, middle, neck
                    if (t < .08f || t > .92f) col = Shade(col, 1f - .12f * Mathf.Abs(s));
                }
                else if (h < .12f) col = Shade(Color.Lerp(SandLit, SandDark, Mathf.Clamp01(.3f + s * .3f)), .9f);
                else
                {
                    col = Shade(Color.Lerp(SandLit, SandDark, Mathf.Clamp01(.3f + s * .4f)), 1f);
                    if (h > .12f + ShaftH + CapH - .07f) col = Color.Lerp(Gold, GoldDark, Mathf.Clamp01(.3f + s * .4f));   // gold abacus
                }
                col = Shade(col, .94f + .1f * Noise(wx * 5f, wy * 5f, seed));
                if (ax > half - .03f || h < .01f || h > .12f + ShaftH + CapH - .025f) col = Ink;
                col.a = 1f; return col;
            });
            cv.ToSprite(lm, "Hall column", "Hall column", 2000 + 16 * g.MaxY + 1);
        }

        // ---- the shrine ----------------------------------------------------------------------------------------------------------

        static void BuildShrine(Landmark lm, Group b)
        {
            var cover = new List<Roguehalla.Net.Protocol.MapTile>();                   // the roof's cover: the shrine's interior and walls (not the door tiles, no pier)
            for (int y = b.MinY; y <= b.MaxY; y++) for (int x = b.MinX; x <= b.MaxX; x++)
                if (lm.IsWall(x, y) || lm.IsInterior(x, y)) cover.Add(new Roguehalla.Net.Protocol.MapTile((ushort)x, (ushort)y));
            lm.SetCover(cover);
            var door = DoorTiles(lm, b);
            Box notch = default; bool horizontalRun = true, outwardNorthOrWest = false;
            if (door.Count > 0) notch = DoorNotch(b, door, out horizontalRun, out outwardNorthOrWest);
            BuildRoof(lm, b, notch);
            if (door.Count > 0) BuildDoor(lm, door, horizontalRun, outwardNorthOrWest);
            BuildLight(lm);
        }

        /// <summary>The hole the roof leaves over the door tiles and a head's height above them; extends outward past the roof's edge.</summary>
        static Box DoorNotch(Group b, List<Vector2Int> door, out bool horizontalRun, out bool outwardNorthOrWest)
        {
            Extent(door, out int x0, out int y0, out int x1, out int y1);
            horizontalRun = y0 == y1 && (door.Count > 1 || y0 == b.MinY || y0 == b.MaxY);
            outwardNorthOrWest = horizontalRun ? y0 == b.MinY : x0 == b.MinX;
            var n = new Box { Valid = true, X0 = x0, X1 = x1 + 1, Y0 = -(y1 + 1) * Sq, Y1 = -y0 * Sq + Wall + .5f };
            if (horizontalRun && outwardNorthOrWest) n.Y1 += .6f;
            if (!horizontalRun) { if (outwardNorthOrWest) n.X0 -= .6f; else n.X1 += .6f; }
            return n;
        }

        static void BuildRoof(Landmark lm, Group b, Box notch)
        {
            const int P = 16; const float Ov = .35f, Course = .3f;
            float xa = b.MinX - Ov, xb = b.MaxX + 1 + Ov;
            float ya = -(b.MaxY + 1) * Sq + Wall, yb = -b.MinY * Sq + Wall + .12f;      // lower edge: the wall-cap line, so the south wall's face shows below it
            float xr = (xa + xb) / 2f, yr = (ya + yb) / 2f, hx = (xb - xa) / 2f, hy = (yb - ya) / 2f;
            bool ridgeX = hx >= hy;
            var cv = new Canvas(xa - .15f, ya, xb - xa + .3f, yb - ya + .15f, P);
            cv.Paint((wx, wy) =>
            {
                if (notch.Contains(wx, wy)) return default;
                float outside = Mathf.Max(Mathf.Max(xa - wx, wx - xb), Mathf.Max(ya - wy, wy - yb));
                if (outside > 0f) return default;
                float u = (wx - xr) / hx, v = (wy - yr) / hy;
                // a hip roof: four faces meet along a ridge on the long axis; distance from the nearest eave edge sets the course
                float de = Mathf.Min(Mathf.Min(wx - xa, xb - wx), Mathf.Min(wy - ya, yb - wy));
                bool sideFace = ridgeX ? Mathf.Abs(u) * hx / hy > Mathf.Abs(v) * 1f && Mathf.Abs(u) > .75f : Mathf.Abs(v) * hy / hx > Mathf.Abs(u) && Mathf.Abs(v) > .75f;
                bool lit = sideFace ? (ridgeX ? u < 0f : v > 0f) : (ridgeX ? v > 0f : u < 0f);
                float k = de / Course; int idx = Mathf.FloorToInt(k); float fk = k - idx;
                float along = (ridgeX ? wx : wy / Sq) * 2f + (idx & 1) * .5f; int col = Mathf.FloorToInt(along); float fc = along - col;
                var c = Shade(lit ? RoofLit : RoofDark, .9f + .2f * RegionNoise.Hash01(col, idx, 71));
                if (fk > .82f) c = Shade(c, .72f); else if (fk < .1f) c = Shade(c, 1.1f);
                if (fc < .05f) c = Shade(c, .8f);
                float dr = ridgeX ? Mathf.Abs(wy - yr) : Mathf.Abs(wx - xr);              // the gold ridge cap
                if (dr < .14f) { c = Color.Lerp(Gold, GoldDark, dr / .14f * .6f); if (dr > .11f) c = Shade(c, .7f); }
                if (-outside < .05f) c = Ink;
                if (wy < ya + .28f && wx > xa + .05f && wx < xb - .05f) c = Shade(c, .6f + .4f * (wy - ya) / .28f);   // the eave's shadow on the roof's own lower rows
                if (notch.Dist(wx, wy) < .06f) c = Ink;
                c.a = 1f; return c;
            });
            lm.AddRoofRenderer(cv.ToSprite(lm, "Hall roof", "Hall roof (sandstone hip)", 0));
        }

        static void BuildDoor(Landmark lm, List<Vector2Int> door, bool horizontalRun, bool outwardNorthOrWest)
        {
            Extent(door, out int x0, out int y0, out int x1, out int y1);
            Flagstones(lm, "Hall door", x0, y0, x1, y1, -84, false);
            if (horizontalRun)
            {
                float baseY = -(y0 + .85f) * Sq;
                Post(lm, "Hall door", x0, baseY, .62f, 1.5f, false, 2000 + 16 * y0 + 1);
                Post(lm, "Hall door", x1 + 1, baseY, .62f, 1.5f, false, 2000 + 16 * y0 + 1);
            }
            else
            {
                float cx = x0 + .5f;
                Post(lm, "Hall door", cx, -y0 * Sq, .62f, 1.5f, false, 2000 + 16 * (y0 - 1) + 1);
                Post(lm, "Hall door", cx, -(y1 + 1) * Sq, .62f, 1.5f, false, 2000 + 16 * y1 + 1);
            }
        }

        /// <summary>A warm gold glow over the 3 x 3 tiles of terrain Light inside the footprint, with a ring and a bright core, under the actors.</summary>
        static void BuildLight(Landmark lm)
        {
            int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
            for (int y = lm.FootY; y < lm.FootY + lm.FootH; y++) for (int x = lm.FootX; x < lm.FootX + lm.FootW; x++)
                if (lm.Terrain(x, y) == (byte)TerrainKind.Light)
                { x0 = Mathf.Min(x0, x); x1 = Mathf.Max(x1, x); y0 = Mathf.Min(y0, y); y1 = Mathf.Max(y1, y); }
            if (x1 < 0) return;
            const int P = 16; const float M = .6f;
            float cx = (x0 + x1 + 1) / 2f, cy = -(y0 + y1 + 1) / 2f * Sq, rx = (x1 - x0 + 1) / 2f + M, ry = ((y1 - y0 + 1) / 2f) * Sq + M * Sq;
            var cv = new Canvas(cx - rx, cy - ry, 2f * rx, 2f * ry, P);
            cv.Paint((wx, wy) =>
            {
                float u = (wx - cx) / rx, v = (wy - cy) / ry, r = Mathf.Sqrt(u * u + v * v);
                if (r >= 1f) return default;
                float a = .5f * Mathf.Pow(1f - r, 1.4f);
                float ring = Mathf.Abs(r - .62f); if (ring < .035f) a = Mathf.Max(a, .8f - ring * 10f);   // a thin gold ring around the healing tiles
                float core = Mathf.Clamp01(1f - r / .5f); a += .35f * core * core;
                var c = Color.Lerp(Warm, new Color(1f, .97f, .8f), core);
                return WithAlpha(c, Mathf.Clamp01(a));
            });
            cv.ToSprite(lm, "Hall light", "Hall light", -83);
        }

        // ---- the threshold ------------------------------------------------------------------------------------------------------

        static void BuildThreshold(Landmark lm)
        {
            int minX = int.MaxValue, maxX = int.MinValue, minY = int.MaxValue, maxY = int.MinValue;
            foreach (var t in lm.ArchTiles) { minX = Mathf.Min(minX, t.X); maxX = Mathf.Max(maxX, t.X); minY = Mathf.Min(minY, t.Y); maxY = Mathf.Max(maxY, t.Y); }
            bool vertical = maxY - minY > maxX - minX;
            Flagstones(lm, "Hall threshold", minX, minY, maxX, maxY, -84, true);
            if (!vertical)
            {
                float baseY = -(minY + .85f) * Sq;
                Post(lm, "Hall threshold", minX, baseY, .6f, .8f, true, 2000 + 16 * minY + 1);
                Post(lm, "Hall threshold", maxX + 1, baseY, .6f, .8f, true, 2000 + 16 * minY + 1);
            }
            else
            {
                float cx = minX + .5f;
                Post(lm, "Hall threshold", cx, -minY * Sq, .6f, .8f, true, 2000 + 16 * (minY - 1) + 1);
                Post(lm, "Hall threshold", cx, -(maxY + 1) * Sq, .6f, .8f, true, 2000 + 16 * maxY + 1);
            }
        }

        /// <summary>A sandstone post (plinth, shaft, cap) with a gold finial or a lantern and glow; base centre at (cx, baseY).</summary>
        static void Post(Landmark lm, string objectName, float cx, float baseY, float w, float h, bool lantern, int order)
        {
            const int P = 24; const float Pad = .55f;
            var cv = new Canvas(cx - w / 2f - Pad, baseY - .2f, w + 2f * Pad, h + .2f + (lantern ? .6f : .35f), P);
            cv.Paint((wx, wy) =>
            {
                float lx = wx - cx, ly = wy - baseY, hw = w / 2f;
                if (ly < 0f)                                                            // the contact shadow on the ground
                {
                    float e = (lx / (hw * 1.5f)) * (lx / (hw * 1.5f)) + ((ly + .02f) / .15f) * ((ly + .02f) / .15f);
                    return e < 1f ? new Color(.05f, .03f, 0f, .38f * (1f - e)) : default;
                }
                float ax = Mathf.Abs(lx);
                if (ly >= h)                                                            // above the cap: a lantern with glow, or a gold ball finial
                {
                    if (lantern)
                    {
                        float gy = ly - (h + .2f), r = Mathf.Sqrt(lx * lx + gy * gy);
                        if (ly <= h + .31f && ax < .11f) return ax > .085f || ly < h + .03f || ly > h + .28f ? Ink : Color.Lerp(Warm, new Color(1f, .96f, .75f), 1f - r / .2f);
                        if (ly > h + .31f && ly < h + .4f && ax < .17f - (ly - h - .31f) * 1.8f) return Ink;
                        if (r < .55f) { float g = 1f - r / .55f; return WithAlpha(Warm, .3f * g * g); }
                        return default;
                    }
                    float br = Mathf.Sqrt(lx * lx + (ly - h - .12f) * (ly - h - .12f));
                    if (br > .12f) return default;
                    return br > .095f ? Ink : Color.Lerp(Gold, GoldDark, Mathf.Clamp01(.5f + lx * 4f));
                }
                float half = ly < .2f ? hw + .07f : ly > h - .16f ? hw + .06f : hw;
                if (ax > half) return default;
                float s = lx / Mathf.Max(half, .01f);
                var c = Color.Lerp(SandLit, SandDark, Mathf.Clamp01(.5f + s * .45f));
                float cr = ly / .3f; if (ly < h - .5f && cr - Mathf.Floor(cr) < .06f) c = Shade(c, .74f);
                if (ly > h - .16f && ly < h - .1f) c = Color.Lerp(Gold, GoldDark, Mathf.Clamp01(.5f + s * .45f));   // a gold band under the cap
                c = Shade(c, .93f + .14f * Noise(wx * 5f, wy * 5f, 21));
                if (ax > half - .045f || ly < .02f) c = Ink;
                return new Color(c.r, c.g, c.b, 1f);
            });
            cv.ToSprite(lm, "Hall post", objectName, order);
        }

        /// <summary>Worn sandstone paving over a rectangle of tiles, just above the ground; optionally with a gold inlay line down its middle.</summary>
        static void Flagstones(Landmark lm, string objectName, int tx0, int ty0, int tx1, int ty1, int order, bool inlay)
        {
            const int P = 16;
            float ex0 = tx0, ex1 = tx1 + 1, ey0 = -(ty1 + 1) * Sq, ey1 = -ty0 * Sq;
            bool wide = ex1 - ex0 >= (ey1 - ey0) / Sq;
            float mx = (ex0 + ex1) / 2f, my = (ey0 + ey1) / 2f;
            var cv = new Canvas(ex0, ey0, ex1 - ex0, ey1 - ey0, P);
            cv.Paint((wx, wy) =>
            {
                float v = -wy / Sq, rowH = .5f; int row = Mathf.FloorToInt(v / rowH); float fr = v / rowH - row;
                float u2 = wx + (row & 1) * .4f, cw = .8f; int col = Mathf.FloorToInt(u2 / cw); float fc = u2 / cw - col;
                var c = Shade(Color.Lerp(Sand, SandLit, .3f), .86f + .26f * RegionNoise.Hash01(col, row, 43));
                if (fr < .09f || fc * cw < .05f) c = Shade(c, .66f);
                if (inlay && (wide ? Mathf.Abs(wy - my) < .06f : Mathf.Abs(wx - mx) < .06f)) c = Gold;
                if (Mathf.Min(Mathf.Min(wx - ex0, ex1 - wx), Mathf.Min(wy - ey0, ey1 - wy)) < .05f) c = Shade(c, .6f);
                c.a = .96f; return c;
            });
            cv.ToSprite(lm, "Hall flagstones", objectName, order);
        }
    }
}

// Generated Holy temple (presentation only): ONE building seen from above with its roof removed. The footprint is a single hall:
// the isolated 3 x 3 wall blocks are its great piers on a 6 tile structural grid, the open floor between them is a grid of 3 tile
// aisles, an open colonnade with a stepped plinth runs round the edge (grand portals on the south, east and west axes, an apse with
// a dais at the north end), and four towers mark the corners. Nothing here is a wall: the footprint edge crosses ordinary floor.
// Detection: the map generator already places a dense hall of 3 x 3 tile pillar blocks inside Holy;
// the client finds that hall from the collision tiles and the public region plane only (features are not on the wire), then grows a
// square footprint around it that covers roughly 35 to 70 percent of the Holy region, as far as the terrain allows. Inside the
// footprint the ground, the pillars, the steps and some props get a golden-temple skin; outside stays sand. Nothing here changes
// collision or any game rule, and the result is a pure function of the map (same map, same temple, every load).
//
//   Detect(map)        footprint (Found = false when no suitable hall exists; a one-line log explains why)
//   Contains(tx, ty)   tile is inside the footprint
//   TryBlock(tx, ty)   tile belongs to a detected pillar block (column, row 0..2 inside the 3 x 3 block)
//   WeightAt(tx, ty)   0..1 smooth "inside the temple" weight (interior lighting; edge transition about 4 tiles)
//   InsideTemple(world) / SurfaceMap.InsideTemple(world)   the hook for ambience and footsteps
//   Center, Portals, Apse*, Lamps, Props   the plan the ground shader, the props and the accent lights all read
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class TempleLayout : ISurfaceLayer
    {
        public const float MinCoverage = .35f, MaxCoverage = .70f, TargetCoverage = .52f;
        public const int MinSide = 24, MaxHallWindow = 44, PillarSize = 3;
        /// <summary>Tiles of stepped perimeter inside the footprint edge (three treads).</summary>
        public const float StepDepth = 2.1f;

        public struct Decor { public string Art; public float X, Y, Scale; public bool Flip; public int Bias; }

        public bool Found { get; private set; }
        public int X0 { get; private set; }
        public int Y0 { get; private set; }
        public int Size { get; private set; }
        public RectInt Hall { get; private set; }
        public int HolyTotal { get; private set; }
        public int HolyInside { get; private set; }
        public int MapW { get; private set; }
        public float Coverage { get { return HolyTotal > 0 ? HolyInside / (float)HolyTotal : 0f; } }
        /// <summary>Structural grid pitch: piers stand 6 tiles apart (3 tile block, 3 tile aisle).</summary>
        public const float Pitch = 6f;
        /// <summary>The great crossing: the aisle intersection of the structural grid nearest the footprint centre (under where a main dome would be). The nave runs north-south through it, the cross axis east-west.</summary>
        public float CenterX { get; private set; }
        public float CenterY { get; private set; }
        public Vector2 Center { get { return new Vector2(CenterX, CenterY); } }
        /// <summary>Phase of the pier lattice: pier centres lie at (PierPhaseX + 6 i, PierPhaseY + 6 j).</summary>
        public float PierPhaseX { get { return CenterX + Pitch * .5f; } }
        public float PierPhaseY { get { return CenterY + Pitch * .5f; } }
        /// <summary>Apse: a half disc of <see cref="ApseRadius"/> centred on (CenterX, ApseY) opening south, at the north end of the nave (0 radius = none).</summary>
        public float ApseRadius { get; private set; }
        public float ApseY { get; private set; }
        public enum Side : byte { South = 0, East = 1, West = 2 }
        public struct Portal { public Side Side; public float Axis; public bool Open; }
        /// <summary>Grand portals on the south, east and west axes (<see cref="Portal.Axis"/> = x for south, y for east and west). Index = (int)Side; Open false = none on that side.</summary>
        public readonly Portal[] Portals = new Portal[3];
        /// <summary>Lamp stands (tile-space foot positions): pooled accent lights are placed on these when the camera is near.</summary>
        public readonly List<Vector2> Lamps = new List<Vector2>();
        /// <summary>Prop keys that are tall enough to need the fade-near-actors rule (everything standing above the floor).</summary>
        public static bool IsOverhead(string art) { return art != "temple.urn" && art != "temple.bench"; }

        /// <summary>Is this server/world position inside the temple (a hook for ambience, footsteps and the like). World = Unity world space (x = tile, y = -tile * GroundSquash).</summary>
        public bool InsideTemple(Vector3 world) { return Found && Contains(Mathf.FloorToInt(world.x), Mathf.FloorToInt(-world.y / ArenaView.GroundSquash)); }
        public bool InsideTempleTile(int tx, int ty) { return Contains(tx, ty); }
        /// <summary>Why no temple was produced (empty when Found).</summary>
        public string Reason { get; private set; }
        /// <summary>Origins (top-left tile) of the pillar blocks inside the footprint.</summary>
        public readonly List<Vector2Int> Pillars = new List<Vector2Int>();
        /// <summary>Braziers and other floor fixtures (tile-space positions), for the shader's warm light pools.</summary>
        public readonly List<Vector2> Braziers = new List<Vector2>();
        /// <summary>Decorative props the temple adds (towers, domes, braziers); the placements are deterministic.</summary>
        public readonly List<Decor> Props = new List<Decor>();
        byte[] _block;      // 0 none, else 1 + col + 3 * row

        public bool Contains(int tx, int ty) { return Found && tx >= X0 && ty >= Y0 && tx < X0 + Size && ty < Y0 + Size; }

        public bool TryBlock(int tx, int ty, out int col, out int row)
        {
            col = row = 0;
            if (_block == null || tx < 0 || ty < 0 || tx >= MapW || ty * MapW + tx >= _block.Length) return false;
            int v = _block[ty * MapW + tx]; if (v == 0) return false;
            v -= 1; col = v % 3; row = v / 3; return true;
        }

        /// <summary>Signed distance (tiles) inside the footprint edge: positive inside, negative outside.</summary>
        public float EdgeDistance(float tx, float ty)
        {
            if (!Found) return -999f;
            return Mathf.Min(Mathf.Min(tx - X0, X0 + Size - tx), Mathf.Min(ty - Y0, Y0 + Size - ty));
        }

        /// <summary>Smooth 0..1 interior weight used by the lighting (matches the weight baked into the region texture).</summary>
        public float WeightAt(float tx, float ty)
        {
            if (!Found) return 0f;
            float d = EdgeDistance(tx, ty), t = Mathf.Clamp01((d + 1f) / 4f);
            return t * t * (3f - 2f * t);
        }

        public bool TryGet(int tx, int ty, RegionId region, out SurfaceKind kind)
        {
            kind = SurfaceKind.TempleFloor;
            return region == RegionId.Holy && Contains(tx, ty);
        }

        public string Describe()
        {
            if (!Found) return "no temple (" + Reason + ")";
            return "temple " + Size + "x" + Size + " at (" + X0 + "," + Y0 + "), " + Pillars.Count + " pillar blocks, " + HolyInside + " of " + HolyTotal + " Holy tiles = " + (Coverage * 100f).ToString("0.0") + "%";
        }

        // ---- cache ------------------------------------------------------------------------------------------------------

        static MapBlob _cacheMap; static TempleLayout _cache;
        /// <summary>Detect once per map instance (the ground, walls, props and lighting all share the answer).</summary>
        public static TempleLayout For(MapBlob map)
        {
            if (map != null && ReferenceEquals(map, _cacheMap) && _cache != null) return _cache;
            var t = Detect(map); _cacheMap = map; _cache = t; return t;
        }

        // ---- detection --------------------------------------------------------------------------------------------------

        public static TempleLayout Detect(MapBlob map)
        {
            var t = new TempleLayout { Reason = "no region plane" };
            if (map == null || map.Regions == null || map.Tiles == null) return t;
            int w = map.W, h = map.H; var tiles = map.Tiles; var regions = map.Regions; var terrain = map.Terrain;
            t.MapW = w;
            for (int i = 0; i < regions.Length; i++) if (regions[i] == (byte)RegionId.Holy) t.HolyTotal++;
            if (t.HolyTotal == 0) { t.Reason = "no Holy region"; return t; }

            // 1. Isolated 3 x 3 pillar blocks wholly inside Holy.
            bool Wall(int x, int y) { return x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] == MapBlob.Wall; }
            var origins = new List<Vector2Int>();
            for (int y = 0; y + 2 < h; y++) for (int x = 0; x + 2 < w; x++)
            {
                bool all = true;
                for (int j = 0; j < 3 && all; j++) for (int i = 0; i < 3; i++)
                    if (!Wall(x + i, y + j) || regions[(y + j) * w + x + i] != (byte)RegionId.Holy || (terrain != null && terrain[(y + j) * w + x + i] != 0)) { all = false; break; }
                if (!all) continue;
                bool ring = false;
                for (int j = -1; j < 4 && !ring; j++) for (int i = -1; i < 4; i++)
                { if (i >= 0 && i < 3 && j >= 0 && j < 3) continue; if (Wall(x + i, y + j)) { ring = true; break; } }
                if (!ring) origins.Add(new Vector2Int(x, y));
            }
            if (origins.Count < 6) { t.Reason = "only " + origins.Count + " isolated pillar blocks"; return t; }

            // 2. Densest window of pillar blocks (the hall): integral image over block origins, window MaxHallWindow tiles wide.
            var cnt = new int[(w + 1) * (h + 1)];
            foreach (var o in origins) cnt[(o.y + 1) * (w + 1) + o.x + 1]++;
            for (int y = 1; y <= h; y++) for (int x = 1; x <= w; x++) cnt[y * (w + 1) + x] += cnt[(y - 1) * (w + 1) + x] + cnt[y * (w + 1) + x - 1] - cnt[(y - 1) * (w + 1) + x - 1];
            int S = Mathf.Min(MaxHallWindow, Mathf.Min(w, h)), bestN = -1, bx = 0, by = 0;
            int AreaSum(int x0, int y0, int x1, int y1) { return cnt[y1 * (w + 1) + x1] - cnt[y0 * (w + 1) + x1] - cnt[y1 * (w + 1) + x0] + cnt[y0 * (w + 1) + x0]; }
            for (int y = 0; y + S <= h; y++) for (int x = 0; x + S <= w; x++)
            {
                int n = AreaSum(x, y, x + S - 2, y + S - 2);    // origins whose 3x3 fits inside the window
                if (n > bestN) { bestN = n; bx = x; by = y; }
            }
            if (bestN < 6) { t.Reason = "no dense pillar hall"; return t; }
            int hx0 = int.MaxValue, hy0 = int.MaxValue, hx1 = int.MinValue, hy1 = int.MinValue;
            foreach (var o in origins)
                if (o.x >= bx && o.y >= by && o.x + 3 <= bx + S && o.y + 3 <= by + S)
                { hx0 = Mathf.Min(hx0, o.x); hy0 = Mathf.Min(hy0, o.y); hx1 = Mathf.Max(hx1, o.x + 3); hy1 = Mathf.Max(hy1, o.y + 3); }
            t.Hall = new RectInt(hx0, hy0, hx1 - hx0, hy1 - hy0);

            // 3. Candidate squares: centred near the hall, wholly inside Holy, containing the hall (margin first, then none).
            var nonHoly = new int[(w + 1) * (h + 1)];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) nonHoly[(y + 1) * (w + 1) + x + 1] = regions[y * w + x] == (byte)RegionId.Holy ? 0 : 1;
            for (int y = 1; y <= h; y++) for (int x = 1; x <= w; x++) nonHoly[y * (w + 1) + x] += nonHoly[(y - 1) * (w + 1) + x] + nonHoly[y * (w + 1) + x - 1] - nonHoly[(y - 1) * (w + 1) + x - 1];
            int NonHoly(int x0, int y0, int s) { return nonHoly[(y0 + s) * (w + 1) + x0 + s] - nonHoly[y0 * (w + 1) + x0 + s] - nonHoly[(y0 + s) * (w + 1) + x0] + nonHoly[y0 * (w + 1) + x0]; }
            float cx = t.Hall.x + t.Hall.width * .5f, cy = t.Hall.y + t.Hall.height * .5f;
            int minSide = Mathf.CeilToInt(Mathf.Sqrt(MinCoverage * t.HolyTotal)), maxSide = Mathf.FloorToInt(Mathf.Sqrt(MaxCoverage * t.HolyTotal));
            bool found = false; int fs = 0, fx = 0, fy = 0;
            for (int margin = 2; margin >= 0 && !found; margin -= 2)
            {
                float best = float.MaxValue;
                for (int s = Mathf.Max(minSide, Mathf.Max(t.Hall.width, t.Hall.height) + 2 * margin); s <= maxSide; s++)
                    for (int dy = -14; dy <= 14; dy++) for (int dx = -14; dx <= 14; dx++)
                    {
                        int sx = Mathf.RoundToInt(cx - s * .5f) + dx, sy = Mathf.RoundToInt(cy - s * .5f) + dy;
                        if (sx < 0 || sy < 0 || sx + s > w || sy + s > h) continue;
                        if (sx > t.Hall.x - margin || sy > t.Hall.y - margin || sx + s < t.Hall.xMax + margin || sy + s < t.Hall.yMax + margin) continue;
                        if (NonHoly(sx, sy, s) != 0) continue;
                        float score = Score(tiles, regions, w, h, sx, sy, s, t.HolyTotal, dx, dy);
                        if (score < best) { best = score; found = true; fs = s; fx = sx; fy = sy; }
                    }
            }
            if (!found)
            {
                // Terrain does not allow 35%: take the largest square that still holds the hall inside Holy (fewer than minSide is reported).
                for (int s = maxSide; s >= Mathf.Max(MinSide, Mathf.Max(t.Hall.width, t.Hall.height)) && !found; s--)
                    for (int dy = -14; dy <= 14 && !found; dy++) for (int dx = -14; dx <= 14; dx++)
                    {
                        int sx = Mathf.RoundToInt(cx - s * .5f) + dx, sy = Mathf.RoundToInt(cy - s * .5f) + dy;
                        if (sx < 0 || sy < 0 || sx + s > w || sy + s > h) continue;
                        if (sx > t.Hall.x || sy > t.Hall.y || sx + s < t.Hall.xMax || sy + s < t.Hall.yMax) continue;
                        if (NonHoly(sx, sy, s) != 0) continue;
                        found = true; fs = s; fx = sx; fy = sy; break;
                    }
                if (!found) { t.Reason = "no square inside Holy holds the hall"; return t; }
            }
            t.X0 = fx; t.Y0 = fy; t.Size = fs; t.Found = true; t.Reason = "";
            t.HolyInside = fs * fs;                  // the square is wholly inside Holy by construction
            // 4. Pillar blocks inside, per-tile block lookup, decorations.
            t._block = new byte[w * h];
            foreach (var o in origins)
            {
                if (o.x < fx || o.y < fy || o.x + 3 > fx + fs || o.y + 3 > fy + fs) continue;
                t.Pillars.Add(o);
                for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) t._block[(o.y + j) * w + o.x + i] = (byte)(1 + i + 3 * j);
            }
            t.BuildDecor(map);
            return t;
        }

        /// <summary>Lower is better: coverage near the target, close to the hall centre, few oasis tiles or wall runs cut by the edge.</summary>
        static float Score(byte[] tiles, byte[] regions, int w, int h, int sx, int sy, int s, int holyTotal, int dx, int dy)
        {
            float cov = s * s / (float)holyTotal;
            int pocketEdge = 0, wallCuts = 0;
            for (int k = 0; k < s; k++)
            {
                // top and bottom rows, left and right columns of the square
                pocketEdge += (RegionPocket.At(sx + k + .5f, sy + .5f) >= RegionPocket.HolyThreshold ? 1 : 0) + (RegionPocket.At(sx + k + .5f, sy + s - .5f) >= RegionPocket.HolyThreshold ? 1 : 0)
                            + (RegionPocket.At(sx + .5f, sy + k + .5f) >= RegionPocket.HolyThreshold ? 1 : 0) + (RegionPocket.At(sx + s - .5f, sy + k + .5f) >= RegionPocket.HolyThreshold ? 1 : 0);
                if (sy > 0 && tiles[sy * w + sx + k] == MapBlob.Wall && tiles[(sy - 1) * w + sx + k] == MapBlob.Wall) wallCuts++;
                if (sy + s < h && tiles[(sy + s - 1) * w + sx + k] == MapBlob.Wall && tiles[(sy + s) * w + sx + k] == MapBlob.Wall) wallCuts++;
                if (sx > 0 && tiles[(sy + k) * w + sx] == MapBlob.Wall && tiles[(sy + k) * w + sx - 1] == MapBlob.Wall) wallCuts++;
                if (sx + s < w && tiles[(sy + k) * w + sx + s - 1] == MapBlob.Wall && tiles[(sy + k) * w + sx + s] == MapBlob.Wall) wallCuts++;
            }
            return 400f * Mathf.Abs(cov - TargetCoverage) + .5f * (Mathf.Abs(dx) + Mathf.Abs(dy)) + .12f * pocketEdge + 1.5f * wallCuts;
        }

        // ---- decoration plan ------------------------------------------------------------------------------------------------

        void BuildDecor(MapBlob map)
        {
            int w = map.W, h = map.H; var tiles = map.Tiles; var terrain = map.Terrain;
            int seed = unchecked((int)(map.LayerHash ^ (map.SemanticHash * 2654435761u)));
            bool Walk(int x, int y)
            {
                if (x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] != MapBlob.Floor) return false;
                return terrain == null || terrain[y * w + x] == 0;
            }
            bool Free(int x, int y, int r)
            {
                for (int j = -r; j <= r; j++) for (int i = -r; i <= r; i++) if (!Walk(x + i, y + j)) return false;
                return true;
            }
            // The great crossing: the aisle intersection nearest the footprint centre. Pier centres are at (pierX0 + 6 i), aisle centre lines halfway between.
            float fcx = X0 + Size * .5f, fcy = Y0 + Size * .5f;
            if (Pillars.Count > 0)
            {
                float Snap(float v, float pierC) { float aisle = Mathf.Repeat(pierC + Pitch * .5f, Pitch); return aisle + Pitch * Mathf.Round((v - aisle) / Pitch); }
                CenterX = Snap(fcx, Pillars[0].x + 1.5f); CenterY = Snap(fcy, Pillars[0].y + 1.5f);
            }
            else { CenterX = fcx; CenterY = fcy; }
            float cx = CenterX, cy = CenterY, x1 = X0 + Size, y1 = Y0 + Size;

            // Apse at the north end (a half disc above the hall; radius limited by the room between the footprint edge and the first pier row).
            float hallTop = Hall.y;
            ApseRadius = Mathf.Clamp(hallTop - Y0 - 6f, 0f, 7f); if (ApseRadius < 4f) ApseRadius = 0f;
            ApseY = Y0 + 3.4f + ApseRadius;

            // Corner towers (minaret-like), set in from the perimeter steps.
            float inset = 1.5f;
            float[] txs = { X0 + inset, x1 - inset, X0 + inset, x1 - inset }, tys = { Y0 + inset, Y0 + inset, y1 - inset, y1 - inset };
            for (int k = 0; k < 4; k++) Props.Add(new Decor { Art = "temple.minaret", X = txs[k], Y = tys[k], Scale = 1f, Flip = k % 2 == 1, Bias = 0 });

            // Portals: the main axis first, then the neighbouring aisle lines if something solid is in the way.
            int[] order = { 0, 1, -1, 2, -2 };
            for (int side = 0; side < 3; side++)
            {
                var pt = new Portal { Side = (Side)side, Open = false };
                foreach (int o in order)
                {
                    float axis = (side == 0 ? cx : cy) + o * Pitch; bool ok = true;
                    for (int d = -1; d <= 1 && ok; d++) for (int depth = 1; depth <= 6 && ok; depth++)
                    {
                        int px, py;
                        if (side == 0) { px = Mathf.FloorToInt(axis) + d; py = Mathf.FloorToInt(y1) - depth; }
                        else if (side == 1) { px = Mathf.FloorToInt(x1) - depth; py = Mathf.FloorToInt(axis) + d; }
                        else { px = X0 + depth - 1; py = Mathf.FloorToInt(axis) + d; }
                        ok = Walk(px, py);
                    }
                    if (ok) { pt.Axis = axis; pt.Open = true; break; }
                }
                Portals[side] = pt;
            }
            bool NearPortal(float x, float y, float reach)
            {
                if (Portals[0].Open && y > y1 - 6f && Mathf.Abs(x - Portals[0].Axis) < reach) return true;
                if (Portals[1].Open && x > x1 - 6f && Mathf.Abs(y - Portals[1].Axis) < reach) return true;
                if (Portals[2].Open && x < X0 + 6f && Mathf.Abs(y - Portals[2].Axis) < reach) return true;
                return false;
            }
            // Gate piers: two heavy jambs flanking every portal, set on the colonnade line.
            const float colLine = 2.85f;
            for (int side = 0; side < 3; side++)
            {
                if (!Portals[side].Open) continue; float a = Portals[side].Axis;
                for (int sgn = -1; sgn <= 1; sgn += 2)
                {
                    float gx, gy;
                    if (side == 0) { gx = a + sgn * 3.2f; gy = y1 - colLine; } else if (side == 1) { gx = x1 - colLine; gy = a + sgn * 3.2f; } else { gx = X0 + colLine; gy = a + sgn * 3.2f; }
                    if (Walk(Mathf.FloorToInt(gx), Mathf.FloorToInt(gy))) Props.Add(new Decor { Art = "temple.gate", X = gx, Y = gy, Scale = 1f, Flip = sgn > 0, Bias = 0 });
                }
            }
            // Colonnade: slim columns on the arcade line every 3 tiles, offset 1.5 from the grid so the arcade bays sit between them; open at the portals and corners.
            for (int side = 0; side < 4; side++)
            {
                bool horiz = side < 2; float lo = (horiz ? X0 : Y0) + 4.5f, hi = (horiz ? x1 : y1) - 4.5f, ctr = horiz ? cx : cy;
                for (float u = ctr + 1.5f - 3f * Mathf.Floor((ctr + 1.5f - lo) / 3f); u <= hi; u += 3f)
                {
                    float px = horiz ? u : (side == 2 ? X0 + colLine : x1 - colLine), py = horiz ? (side == 0 ? Y0 + colLine : y1 - colLine) : u;
                    if (NearPortal(px, py, 3.8f) || !Walk(Mathf.FloorToInt(px), Mathf.FloorToInt(py))) continue;
                    Props.Add(new Decor { Art = "temple.column", X = px, Y = py, Scale = 1f, Flip = ((int)(u / 3f) & 1) == 1, Bias = 0 });
                }
            }
            // Mihrab niche behind the apse dais, with the dais flanked by two braziers and two screens.
            if (ApseRadius > 0f)
            {
                float my = ApseY - ApseRadius + .9f;
                if (Walk(Mathf.FloorToInt(cx), Mathf.FloorToInt(my))) Props.Add(new Decor { Art = "temple.mihrab", X = cx, Y = my, Scale = 1f, Flip = false, Bias = 0 });
                foreach (int sg in new[] { -1, 1 })
                {
                    float bx = cx + sg * (ApseRadius * .55f), by = ApseY - ApseRadius * .55f;
                    if (Walk(Mathf.FloorToInt(bx), Mathf.FloorToInt(by))) { Braziers.Add(new Vector2(Mathf.Floor(bx) + .5f, Mathf.Floor(by) + .5f)); Props.Add(new Decor { Art = "temple.brazier", X = Mathf.Floor(bx) + .5f, Y = Mathf.Floor(by) + .5f, Scale = 1f, Bias = 0 }); }
                    float sx = cx + sg * (ApseRadius + 1.5f), sy = ApseY - 1.2f;
                    if (Walk(Mathf.FloorToInt(sx), Mathf.FloorToInt(sy)) && !TryBlock(Mathf.FloorToInt(sx), Mathf.FloorToInt(sy), out _, out _)) Props.Add(new Decor { Art = "temple.screen", X = sx, Y = sy, Scale = 1f, Flip = sg > 0, Bias = 0 });
                }
            }
            // Braziers just inside each portal.
            for (int side = 0; side < 3; side++)
            {
                if (!Portals[side].Open) continue; float a = Portals[side].Axis;
                foreach (int sg in new[] { -1, 1 })
                {
                    float bx, by;
                    if (side == 0) { bx = a + sg * 2.3f; by = y1 - 5.6f; } else if (side == 1) { bx = x1 - 5.6f; by = a + sg * 2.3f; } else { bx = X0 + 5.6f; by = a + sg * 2.3f; }
                    int tx = Mathf.FloorToInt(bx), ty = Mathf.FloorToInt(by);
                    if (!Free(tx, ty, 0) || TryBlock(tx, ty, out _, out _) || Braziers.Count >= 8) continue;
                    Braziers.Add(new Vector2(tx + .5f, ty + .5f));
                    Props.Add(new Decor { Art = "temple.brazier", X = tx + .5f, Y = ty + .5f, Scale = 1f, Bias = 0 });
                }
            }
            // Lamp stands on the aisle edges just south of some piers (each one is also a pooled accent light site), and a few urns and benches.
            foreach (var o in Pillars)
            {
                float r = RegionNoise.Hash01(o.x, o.y, seed + 41);
                if (r > .34f || Lamps.Count >= 10 || o.x - X0 < 4 || o.y - Y0 < 4 || X0 + Size - o.x < 8 || Y0 + Size - o.y < 8) continue;
                float lx = o.x + (r < .17f ? .35f : 2.65f), ly = o.y + 3.6f; int tx = Mathf.FloorToInt(lx), ty = Mathf.FloorToInt(ly);
                if (!Free(tx, ty, 0) || TryBlock(tx, ty, out _, out _)) continue;
                Lamps.Add(new Vector2(lx, ly));
                Props.Add(new Decor { Art = "temple.lamp", X = lx, Y = ly, Scale = 1f, Flip = r < .17f, Bias = 0 });
            }
            int urns = 0, benches = 0;
            for (int side = 0; side < 4 && urns + benches < 14; side++)
            {
                bool horiz = side < 2; float lo = (horiz ? X0 : Y0) + 7f, hi = (horiz ? x1 : y1) - 7f;
                for (float u = lo; u <= hi; u += 3f)
                {
                    float r = RegionNoise.Hash01((int)(u * 4f), side, seed + 77); if (r > .22f) continue;
                    float inner = 4.6f; float px = horiz ? u : (side == 2 ? X0 + inner : x1 - inner), py = horiz ? (side == 0 ? Y0 + inner : y1 - inner) : u;
                    int tx = Mathf.FloorToInt(px), ty = Mathf.FloorToInt(py);
                    if (NearPortal(px, py, 4.5f) || !Free(tx, ty, 0) || TryBlock(tx, ty, out _, out _) || ApseRadius > 0f && Mathf.Abs(px - cx) < ApseRadius + 3f && py < ApseY + 1f) continue;
                    bool bench = r < .11f; if (bench) benches++; else urns++;
                    Props.Add(new Decor { Art = bench ? "temple.bench" : "temple.urn", X = tx + .5f, Y = ty + .5f, Scale = 1f, Flip = r < .05f, Bias = 0 });
                }
            }
        }
    }
}

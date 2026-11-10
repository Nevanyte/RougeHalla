// Contrast lab plan: the synthetic map and the deterministic layout of every measurement cell. Pure data and arithmetic over the
// public map planes (no GPU, no scene), so EditMode tests can check coverage. Presentation tooling only: it feeds no game rule.
//
// Map: six zone blocks side by side (Fire, Sentenced, Plague, Frost, Holy, Coliseum), each BlockW x BlockH tiles, split into four
// slots (A..D). Terrain patches fill slots with the zone's terrain kinds; decorative surfaces (temple floor, Plague mud/grass/water
// when they land) come from the SurfaceMap itself, so the planner scans the finished map for every surface that really exists
// instead of assuming a list.
//
// Cells: for every (zone, surface) the planner finds clean lattice points (uniform surface, no prop in the way) and stamps every
// (appearance x pose x facing) there. A second family stamps every appearance in front of and beside the zone's most common props.
using System;
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public enum LabPose : byte { Idle = 0, Walk = 1 }

    /// <summary>One catalog look and the synthetic public row that makes the real presenter pick it.</summary>
    public sealed class LabAppearance
    {
        public string Key;          // catalog key
        public string Id;           // unique id (Key, or Key@faction for a second faction wearing the same look)
        public ActorKind Kind;
        public FactionId? Faction;
        public MobTypeId? Mob;
        public WeaponId? Weapon;
    }

    public sealed class LabCell
    {
        public int Id;
        public RegionId Zone;
        public SurfaceKind Surface;      // surface under the feet, as the SurfaceMap answers
        public LabAppearance Appearance;
        public LabPose Pose;
        public int FacingIndex;
        public float Facing;             // radians, server axes (0 = east, pi/2 = south)
        public float TileX, TileY;       // feet, in tiles
        public string Prop;              // prop art id, null for a plain ground cell
        public string PropMode;          // "front" or "beside"
        public float Purity = 1f;        // share of the surrounding floor tiles that carry the same surface
    }

    public sealed class LabPage
    {
        public RegionId Zone;
        public int Index;                // within the zone
        public string Kind;              // "surface" or "props"
        public SurfaceKind Surface;      // surface pages
        public string Prop;              // props pages: art id
        public Vector2 ViewTile;         // tile the camera centres on
        public List<LabCell> Cells = new List<LabCell>();
    }

    public sealed class LabOptions
    {
        public int Facings = 2;          // 1 to 8
        public int PropArts = 2;         // props pages stamp about PropArts x (number of looks) cells near the zone's most common props (0 = none)
        public int PageCells = 30;
    }

    public sealed class LabPlan
    {
        public List<LabPage> Pages = new List<LabPage>();
        public List<string> Notes = new List<string>();
        public int Unplaced;
        public List<LabPage> ForZone(RegionId zone) { return Pages.FindAll(p => p.Zone == zone); }
    }

    public static class ContrastLabMap
    {
        public const int BlockW = 72, BlockH = 80, Border = 2;
        public static readonly RegionId[] Zones = { RegionId.Fire, RegionId.Sentenced, RegionId.Plague, RegionId.Frost, RegionId.Holy, RegionId.Coliseum };
        public static int MapW { get { return BlockW * Zones.Length; } }
        // Slot rectangles inside a block: x0, y0, x1, y1 (exclusive end).
        public static readonly int[][] Slots = { new[] { 3, 3, 35, 36 }, new[] { 37, 3, 69, 36 }, new[] { 3, 38, 35, 71 }, new[] { 37, 38, 69, 71 } };

        public static string ZoneName(RegionId zone) { return zone.ToString().ToLowerInvariant(); }
        public static int ZoneIndex(RegionId zone) { return Array.IndexOf(Zones, zone); }
        public static bool TryZone(string name, out RegionId zone)
        {
            zone = RegionId.None;
            if (string.IsNullOrEmpty(name)) return false;
            foreach (var z in Zones) if (string.Equals(ZoneName(z), name, StringComparison.OrdinalIgnoreCase)) { zone = z; return true; }
            return false;
        }

        /// <summary>Tile class with out-of-range answered as wall.</summary>
        public static byte TileAt(MapBlob map, int x, int y)
        {
            return (uint)x >= map.W || (uint)y >= map.H ? MapBlob.Wall : map.At(x, y);
        }

        /// <summary>Terrain kind laid over each slot (A..D) of a zone; None leaves the region's default ground.</summary>
        public static TerrainKind[] SlotTerrain(RegionId zone)
        {
            switch (zone)
            {
                case RegionId.Fire: return new[] { TerrainKind.None, TerrainKind.Lava, TerrainKind.Ember, TerrainKind.None };
                case RegionId.Sentenced: return new[] { TerrainKind.None, TerrainKind.Fence, TerrainKind.None, TerrainKind.None };
                case RegionId.Plague: return new[] { TerrainKind.None, TerrainKind.Bog, TerrainKind.None, TerrainKind.None };
                case RegionId.Frost: return new[] { TerrainKind.None, TerrainKind.Ice, TerrainKind.None, TerrainKind.None };
                case RegionId.Holy: return new[] { TerrainKind.None, TerrainKind.Light, TerrainKind.None, TerrainKind.None };
                default: return new[] { TerrainKind.None, TerrainKind.None, TerrainKind.None, TerrainKind.None };
            }
        }

        public static MapBlob Build()
        {
            int w = MapW, h = BlockH;
            var tiles = new byte[w * h]; var regions = new byte[w * h]; var terrain = new byte[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x;
                    if (x < Border || y < Border || x >= w - Border || y >= h - Border) { tiles[i] = MapBlob.Wall; continue; }
                    regions[i] = (byte)Zones[x / BlockW];
                }
            for (int z = 0; z < Zones.Length; z++)
            {
                int bx = z * BlockW; var terr = SlotTerrain(Zones[z]);
                for (int s = 0; s < Slots.Length; s++)
                {
                    int x0 = bx + Slots[s][0], y0 = Slots[s][1], x1 = bx + Slots[s][2], y1 = Slots[s][3];
                    if (s == 0)
                    {
                        // Slot A is the clean-ground slot. Props never stand on tiles that carry terrain, and a Fence terrain code on a floor tile draws
                        // nothing (the ground shader paints only lava, ice, bog, ember, light and crevasse), so it keeps this slot prop-free without
                        // changing the surface under it. The other slots keep the zone's natural deterministic props.
                        for (int y = y0 + 1; y < y1 - 1; y++) for (int x = x0 + 1; x < x1 - 1; x++) terrain[y * w + x] = (byte)TerrainKind.Fence;
                    }
                    else if (terr[s] == TerrainKind.Fence)
                    {
                        // Fences: a low timber fence run every 8 rows, leaving 7-row aisles of plain ground.
                        for (int y = y0 + 3; y < y1 - 1; y += 8) for (int x = x0 + 3; x < x1 - 3; x++) { tiles[y * w + x] = MapBlob.Low; terrain[y * w + x] = (byte)TerrainKind.Fence; }
                    }
                    else if (terr[s] != TerrainKind.None)
                    {
                        for (int y = y0 + 1; y < y1 - 1; y++) for (int x = x0 + 1; x < x1 - 1; x++) terrain[y * w + x] = (byte)terr[s];
                    }
                    // Obstacles along each slot's upper edge (inside the view, outside the cell lattice): a wall run and a low run.
                    for (int x = x0 + 1; x <= x0 + 7; x++) { tiles[y0 * w + x] = MapBlob.Wall; terrain[y0 * w + x] = 0; }
                    for (int x = x1 - 9; x <= x1 - 3; x++) { tiles[y0 * w + x] = MapBlob.Low; terrain[y0 * w + x] = 0; }
                }
                if (Zones[z] == RegionId.Holy) PillarGrid(tiles, terrain, w, bx + Slots[2][0] + 2, Slots[2][1] + 2, bx + Slots[2][2] - 2, Slots[2][3] - 2);
            }
            return new MapBlob((ushort)w, (ushort)h, tiles, terrain, regions, MapBlob.GroundTerrainAll);
        }

        /// <summary>Dense pillar grid (single wall tiles on a 3-tile pitch) big enough for temple detection.</summary>
        static void PillarGrid(byte[] tiles, byte[] terrain, int w, int x0, int y0, int x1, int y1)
        {
            for (int y = y0; y < y1; y += 3) for (int x = x0; x < x1; x += 3) { tiles[y * w + x] = MapBlob.Wall; terrain[y * w + x] = 0; }
        }
    }

    public static class ContrastLabAppearances
    {
        /// <summary>Every catalog key mapped to a synthetic public row that makes the real presenter choose it (see ShowcaseActorLook).</summary>
        public static List<LabAppearance> Build(IList<string> catalogKeys, out List<string> unreachable)
        {
            var result = new List<LabAppearance>(); var seen = new HashSet<string>(); unreachable = new List<string>();
            foreach (var key in catalogKeys)
            {
                if (!seen.Add(key)) continue;
                var rows = new List<LabAppearance>();
                if (ShowcaseActorLook.AppearanceKey(ActorKind.TrainingDummy, null, null) == key)
                    rows.Add(new LabAppearance { Key = key, Id = key, Kind = ActorKind.TrainingDummy });
                else if (ShowcaseActorLook.AppearanceKey(ActorKind.Zombie, null, null) == key)
                    rows.Add(new LabAppearance { Key = key, Id = key, Kind = ActorKind.Zombie });
                // Players first: one row per distinct faction that wears this look (hero is worn by Fire and Sentenced).
                for (int f = 0; f < 5; f++)
                    if (ShowcaseActorLook.AppearanceKey(ActorKind.Player, (FactionId)f, null) == key)
                        rows.Add(new LabAppearance { Key = key, Id = rows.Count == 0 ? key : key + "@" + ((FactionId)f).ToString().ToLowerInvariant(), Kind = ActorKind.Player, Faction = (FactionId)f,
                            Weapon = key.StartsWith("mage") ? WeaponId.Wand : WeaponId.Sword });
                if (rows.Count == 0)
                    for (int t = 0; t <= (int)MobTypeId.Archon && rows.Count == 0; t++)
                    {
                        var type = (MobTypeId)t;
                        if (!ShowcaseIdentityAssets.TryGetMobInfo(type, out var info)) continue;
                        if (ShowcaseActorLook.AppearanceKey(ActorKind.RegionalMob, info.Faction, type) != key) continue;
                        rows.Add(new LabAppearance { Key = key, Id = key, Kind = ActorKind.RegionalMob, Faction = info.Faction, Mob = type,
                            Weapon = key == "mob-skeleton-archer" ? WeaponId.Bow : key == "mob-skeleton-mage" ? WeaponId.Wand : (WeaponId?)null });
                    }
                if (rows.Count == 0) unreachable.Add(key); else result.AddRange(rows);
            }
            return result;
        }
    }

    public static class ContrastLabPlanner
    {
        const float PitchX = 2.7f, PitchY = 4.2f;
        static readonly float[] FacingDegrees = { 90f, -90f, 0f, 180f, 45f, -135f, -45f, 135f };
        public static readonly string[] FacingNames = { "S", "N", "E", "W", "SE", "NW", "NE", "SW" };
        // Camera clamp so the whole view stays inside one zone block (half view 16 x 11.5 tiles at the normal ortho size and 16:9).
        const float ViewHalfX = 16.5f, ViewHalfY = 12.2f;

        static float Facing(int index) { return FacingDegrees[index] * Mathf.Deg2Rad; }

        public static LabPlan Plan(MapBlob map, SurfaceMap surfaces, IList<LabAppearance> appearances, LabOptions options)
        {
            var plan = new LabPlan(); if (options == null) options = new LabOptions();
            var placements = RegionProps.Scatter(map);
            int nextId = 1;
            for (int z = 0; z < ContrastLabMap.Zones.Length; z++)
            {
                var zone = ContrastLabMap.Zones[z]; int x0 = z * ContrastLabMap.BlockW;
                var zonePlacements = placements.FindAll(p => p.Tx >= x0 && p.Tx < x0 + ContrastLabMap.BlockW);
                int pageIndex = 0;
                foreach (var surface in ScanSurfaces(map, surfaces, x0))
                {
                    var tuples = Tuples(appearances, options);
                    var points = LatticePoints(map, surfaces, zonePlacements, x0, surface, tuples.Count, out float purityFloor);
                    string label = ContrastLabMap.ZoneName(zone) + "/" + surface;
                    if (points.Count == 0) { plan.Notes.Add(label + ": no clean ground, nothing stamped"); plan.Unplaced += tuples.Count; continue; }
                    int ti = 0;
                    while (ti < tuples.Count && points.Count > 0)
                    {
                        // Balanced pages (52 cells become 26 + 26, not 30 + 22), each inside one view window.
                        int remaining = tuples.Count - ti, pagesLeft = Mathf.CeilToInt(remaining / (float)options.PageCells), cap = Mathf.CeilToInt(remaining / (float)pagesLeft);
                        var chosen = TakeCluster(points, cap);
                        if (chosen.Count == 0) break;
                        var page = new LabPage { Zone = zone, Index = pageIndex++, Kind = "surface", Surface = surface };
                        chosen.Sort((a, b) => { int c = a.y.CompareTo(b.y); return c != 0 ? c : a.x.CompareTo(b.x); });
                        foreach (var pt in chosen)
                        {
                            if (ti >= tuples.Count) break;
                            var t = tuples[ti++];
                            page.Cells.Add(new LabCell { Id = nextId++, Zone = zone, Surface = surface, Appearance = t.App, Pose = t.Pose, FacingIndex = t.Facing, Facing = Facing(t.Facing),
                                TileX = pt.x, TileY = pt.y, Purity = pt.purity });
                        }
                        Frame(page, x0);
                        plan.Pages.Add(page);
                    }
                    plan.Unplaced += tuples.Count - ti;
                    if (ti < tuples.Count) plan.Notes.Add(label + ": only " + ti + " of " + tuples.Count + " cells fit on clean ground");
                    if (purityFloor < 1f) plan.Notes.Add(label + ": patch is mixed, cells sit on at least " + Mathf.RoundToInt(purityFloor * 100) + "% pure ground");
                }
                PropPages(plan, surfaces, zone, x0, zonePlacements, appearances, options, ref pageIndex, ref nextId);
            }
            return plan;
        }

        struct Tuple { public LabAppearance App; public LabPose Pose; public int Facing; }
        static List<Tuple> Tuples(IList<LabAppearance> apps, LabOptions options)
        {
            var list = new List<Tuple>(); int facings = Mathf.Clamp(options.Facings, 1, 8);
            for (int pose = 0; pose < 2; pose++)
                for (int f = 0; f < facings; f++)
                    foreach (var a in apps) list.Add(new Tuple { App = a, Pose = (LabPose)pose, Facing = f });
            return list;
        }

        /// <summary>Every surface that exists on a useful number of floor tiles of a zone block, in SurfaceKind order.</summary>
        public static List<SurfaceKind> ScanSurfaces(MapBlob map, SurfaceMap surfaces, int blockX0)
        {
            var count = new SortedDictionary<SurfaceKind, int>();
            for (int y = ContrastLabMap.Border; y < map.H - ContrastLabMap.Border; y++)
                for (int x = blockX0; x < blockX0 + ContrastLabMap.BlockW; x++)
                {
                    if (ContrastLabMap.TileAt(map, x, y) != MapBlob.Floor) continue;
                    var k = surfaces.SurfaceAtTile(x, y); if (k == SurfaceKind.None) continue;
                    count[k] = (count.TryGetValue(k, out int c) ? c : 0) + 1;
                }
            var found = new List<SurfaceKind>();
            foreach (var pair in count) if (pair.Value >= 24) found.Add(pair.Key);
            return found;
        }

        struct Pt { public float x, y, purity; }

        static List<Pt> LatticePoints(MapBlob map, SurfaceMap surfaces, List<RegionProps.Placement> props, int x0, SurfaceKind surface, int needed, out float purityFloor)
        {
            // Descending purity thresholds: take the cleanest points first and relax only if there are too few.
            float[] thresholds = { 1f, .85f, .7f, .5f };
            var all = new List<Pt>();
            for (float cy = 5f; cy < ContrastLabMap.BlockH - 3f; cy += PitchY)
                for (float cx = x0 + 3.5f; cx < x0 + ContrastLabMap.BlockW - 3f; cx += PitchX)
                {
                    if (PropInTheWay(props, cx, cy)) continue;
                    if (!Purity(map, surfaces, surface, cx, cy, out float purity)) continue;
                    all.Add(new Pt { x = cx, y = cy, purity = purity });
                }
            purityFloor = 1f;
            foreach (float th in thresholds)
            {
                var pick = all.FindAll(p => p.purity >= th);
                purityFloor = th;
                if (pick.Count >= needed || th == thresholds[thresholds.Length - 1]) return pick;
            }
            return new List<Pt>();
        }

        /// <summary>Surface purity of the box an actor and its ring cover: the foot 3x3 must be floor of this surface; walls in the box are tolerated up to a few tiles.</summary>
        static bool Purity(MapBlob map, SurfaceMap surfaces, SurfaceKind surface, float cx, float cy, out float purity)
        {
            purity = 0f;
            for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
            {
                int tx = Mathf.FloorToInt(cx) + dx, ty = Mathf.FloorToInt(cy) + dy;
                if (ContrastLabMap.TileAt(map, tx, ty) != MapBlob.Floor || surfaces.SurfaceAtTile(tx, ty) != surface) return false;
            }
            int floor = 0, same = 0, walls = 0;
            for (int ty = Mathf.FloorToInt(cy - 3.6f); ty <= Mathf.FloorToInt(cy + 1.1f); ty++)
                for (int tx = Mathf.FloorToInt(cx - 1.9f); tx <= Mathf.FloorToInt(cx + 1.9f); tx++)
                {
                    if (ContrastLabMap.TileAt(map, tx, ty) != MapBlob.Floor) { walls++; continue; }
                    floor++; if (surfaces.SurfaceAtTile(tx, ty) == surface) same++;
                }
            if (walls > 6 || floor == 0) return false;
            purity = same / (float)floor; return true;
        }

        static bool PropInTheWay(List<RegionProps.Placement> props, float cx, float cy)
        {
            foreach (var p in props)
            {
                float dx = p.X - cx, dy = p.Y - cy;
                if (Mathf.Abs(dx) <= 2.6f && dy >= -3.6f && dy <= 4.5f) return true;
            }
            return false;
        }

        /// <summary>Up to <paramref name="count"/> points nearest a good seed inside one view window; removes them from <paramref name="points"/>.</summary>
        static List<Pt> TakeCluster(List<Pt> points, int count)
        {
            var result = new List<Pt>(); if (points.Count == 0) return result;
            int bestSeed = 0, bestN = -1;
            for (int i = 0; i < points.Count; i++)
            {
                int n = 0; for (int j = 0; j < points.Count; j++) if (Mathf.Abs(points[j].x - points[i].x) <= 12.5f && Mathf.Abs(points[j].y - points[i].y) <= 8.5f) n++;
                if (n > bestN) { bestN = n; bestSeed = i; }
            }
            var seed = points[bestSeed];
            var near = points.FindAll(p => Mathf.Abs(p.x - seed.x) <= 12.5f && Mathf.Abs(p.y - seed.y) <= 8.5f);
            near.Sort((a, b) => ((a.x - seed.x) * (a.x - seed.x) + (a.y - seed.y) * (a.y - seed.y)).CompareTo((b.x - seed.x) * (b.x - seed.x) + (b.y - seed.y) * (b.y - seed.y)));
            for (int i = 0; i < near.Count && i < count; i++) result.Add(near[i]);
            foreach (var p in result) points.Remove(p);
            return result;
        }

        static void Frame(LabPage page, int blockX0)
        {
            if (page.Cells.Count == 0) return;
            float minX = float.MaxValue, maxX = float.MinValue, minY = float.MaxValue, maxY = float.MinValue;
            foreach (var c in page.Cells) { minX = Mathf.Min(minX, c.TileX); maxX = Mathf.Max(maxX, c.TileX); minY = Mathf.Min(minY, c.TileY); maxY = Mathf.Max(maxY, c.TileY); }
            // Actors reach about 3.3 tiles above their feet, so the visual centre is above the feet box.
            float vx = (minX + maxX) * .5f, vy = (minY + maxY) * .5f - 1.5f;
            vx = Mathf.Clamp(vx, blockX0 + ViewHalfX, blockX0 + ContrastLabMap.BlockW - ViewHalfX);
            vy = Mathf.Clamp(vy, ViewHalfY, ContrastLabMap.BlockH - ViewHalfY);
            page.ViewTile = new Vector2(vx, vy);
        }

        static void PropPages(LabPlan plan, SurfaceMap surfaces, RegionId zone, int x0, List<RegionProps.Placement> zoneProps,
            IList<LabAppearance> apps, LabOptions options, ref int pageIndex, ref int nextId)
        {
            if (options.PropArts <= 0 || zoneProps.Count == 0) return;
            var counts = new Dictionary<string, int>();
            foreach (var p in zoneProps) counts[p.Art] = (counts.TryGetValue(p.Art, out int c) ? c : 0) + 1;
            // Typical props: the two most common TALL arts (trees, tombstones, pillars, spires: the ones that can hide a character) and the two most common
            // low ones (grass, rocks, drifts), taken in turns so each gets its share of the looks.
            var tall = new List<string>(); var low = new List<string>();
            foreach (var key in counts.Keys) { if (RegionPropArt.TryGet(key, out var art) && art.Tall) tall.Add(key); else low.Add(key); }
            Comparison<string> byCount = (a, b) => { int c = counts[b].CompareTo(counts[a]); return c != 0 ? c : string.CompareOrdinal(a, b); };
            tall.Sort(byCount); low.Sort(byCount);
            var arts = new List<string>();
            for (int i = 0; i < 2; i++) { if (i < tall.Count) arts.Add(tall[i]); if (i < low.Count) arts.Add(low[i]); }
            int wanted = Mathf.Max(1, options.PropArts) * apps.Count;
            // Props are dense, so neighbours are allowed (they are part of the real scene); only the actor cells must not overlap each other.
            var cand = new List<KeyValuePair<int, RegionProps.Placement>>();
            for (int rank = 0; rank < arts.Count; rank++)
                foreach (var p in zoneProps)
                    if (p.Art == arts[rank] && p.Tx >= x0 + 6 && p.Tx <= x0 + ContrastLabMap.BlockW - 6 && p.Ty >= 6 && p.Ty <= ContrastLabMap.BlockH - 6)
                        cand.Add(new KeyValuePair<int, RegionProps.Placement>(rank, p));
            var selected = new List<RegionProps.Placement>(); int k = 0;
            while (selected.Count < wanted && cand.Count > 0)
            {
                int bestSeed = 0, bestN = -1;
                for (int i = 0; i < cand.Count; i++)
                {
                    int n = 0; foreach (var c in cand) if (Mathf.Abs(c.Value.X - cand[i].Value.X) <= 12.5f && Mathf.Abs(c.Value.Y - cand[i].Value.Y) <= 8.5f) n++;
                    if (n > bestN) { bestN = n; bestSeed = i; }
                }
                var seed = cand[bestSeed].Value;
                var near = cand.FindAll(c => Mathf.Abs(c.Value.X - seed.X) <= 12.5f && Mathf.Abs(c.Value.Y - seed.Y) <= 8.5f);
                near.Sort((a, b) => Dist2(a.Value, seed).CompareTo(Dist2(b.Value, seed)));
                var page = new LabPage { Zone = zone, Index = pageIndex, Kind = "props" };
                var picked = new List<RegionProps.Placement>();
                // Take turns between the arts so tall and low props share the page.
                var cursor = new int[arts.Count]; bool progress = true;
                while (progress && picked.Count < options.PageCells && selected.Count + picked.Count < wanted)
                {
                    progress = false;
                    for (int rank = 0; rank < arts.Count && picked.Count < options.PageCells && selected.Count + picked.Count < wanted; rank++)
                    {
                        while (cursor[rank] < near.Count)
                        {
                            var c = near[cursor[rank]++]; if (c.Key != rank) continue;
                            bool apart = true;
                            foreach (var q in picked) if (Mathf.Abs(q.X - c.Value.X) < 3.4f && Mathf.Abs(q.Y - c.Value.Y) < 4.6f) { apart = false; break; }
                            if (apart) foreach (var q in selected) if (Mathf.Abs(q.X - c.Value.X) < 3.4f && Mathf.Abs(q.Y - c.Value.Y) < 4.6f) { apart = false; break; }
                            if (!apart) continue;
                            picked.Add(c.Value); progress = true; break;
                        }
                    }
                }
                if (picked.Count == 0) break;
                picked.Sort((a, b) => { int r = a.Y.CompareTo(b.Y); return r != 0 ? r : a.X.CompareTo(b.X); });
                foreach (var p in picked)
                {
                    // One actor per instance (two would overlap), alternating in front of / beside the prop while the look cycles: with 13 looks and
                    // 2 modes (coprime) every look meets every mode within 26 instances.
                    bool inFront = k % 2 == 0;
                    float tx = inFront ? p.X : p.X + 1.4f, ty = inFront ? p.Y + .9f : p.Y;
                    page.Cells.Add(new LabCell { Id = nextId++, Zone = zone, Surface = surfaces.SurfaceAtTile(Mathf.FloorToInt(tx), Mathf.FloorToInt(ty)), Appearance = apps[k % apps.Count], Pose = LabPose.Idle,
                        FacingIndex = 0, Facing = Facing(0), TileX = tx, TileY = ty, Prop = p.Art, PropMode = inFront ? "front" : "beside" });
                    k++;
                }
                selected.AddRange(picked);
                page.Prop = page.Cells[0].Prop; page.Surface = page.Cells[0].Surface; pageIndex++;
                Frame(page, x0); plan.Pages.Add(page);
                cand.RemoveAll(c => { foreach (var q in selected) if (Mathf.Abs(q.X - c.Value.X) < 3.4f && Mathf.Abs(q.Y - c.Value.Y) < 4.6f) return true; return false; });
            }
            if (selected.Count < wanted) plan.Notes.Add(ContrastLabMap.ZoneName(zone) + ": props pages hold " + selected.Count + " of the " + wanted + " wanted cells");
        }

        static float Dist2(RegionProps.Placement a, RegionProps.Placement b) { return (a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y); }
    }
}

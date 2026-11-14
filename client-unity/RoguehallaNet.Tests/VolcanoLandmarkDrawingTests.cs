using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using MapRect = Roguehalla.Net.Protocol.MapRect;   // Net.Ui has a MapRect of its own (the map screen's)

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-LANDMARK-2 oracle, engine-free half: guards on the approved drawing docs/landmarks/blueprints/volcano.txt (22 x 22; '#', 'X',
    /// 'H' wall; '~' and 'O' lava = LOW tiles with terrain Lava; '.' floor) and on the tier rule the Unity art must follow
    /// (docs/backlog/packets/P-UNITY-LANDMARK-2.md, "Established facts"). These pass today: they pin the drawing and the rule, not code.
    /// </summary>
    public sealed class VolcanoLandmarkDrawingTests
    {
        const int Size = 22;

        static string[] Rows()
        {
            string path = Path.Combine(Util.RepoRoot(), "docs", "landmarks", "blueprints", "volcano.txt");
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            return File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
        }

        /// <summary>One of the eight placements: swap x and y, then flip x, then flip y.</summary>
        static string[] Orient(string[] rows, int k)
        {
            bool swap = (k & 1) != 0, fx = (k & 2) != 0, fy = (k & 4) != 0; int n = rows.Length;
            var o = new string[n];
            for (int y = 0; y < n; y++)
            {
                var r = new char[n];
                for (int x = 0; x < n; x++) { int sx = fx ? n - 1 - x : x, sy = fy ? n - 1 - y : y; r[x] = swap ? rows[sx][sy] : rows[sy][sx]; }
                o[y] = new string(r);
            }
            return o;
        }

        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }
        static bool IsWall(char c) { return c == '#' || c == 'X' || c == 'H'; }
        static bool IsLava(char c) { return c == '~' || c == 'O'; }

        [Test]
        public void TheDrawingHasTheCountsTheBriefPins()
        {
            var rows = Rows();
            Assert.That(rows.Length, Is.EqualTo(Size)); Assert.That(rows.All(r => r.Length == Size), Is.True);
            var all = string.Concat(rows);
            Assert.That(all.Count(c => c == '#'), Is.EqualTo(136), "foot ring");
            Assert.That(all.Count(c => c == 'X'), Is.EqualTo(146), "slope ring");
            Assert.That(all.Count(c => c == 'H'), Is.EqualTo(40), "rim ring");
            Assert.That(all.Count(c => c == '~'), Is.EqualTo(130), "lava");
            Assert.That(all.Count(c => c == 'O'), Is.EqualTo(6), "outlet lava");
            Assert.That(all.Count(c => c == '.'), Is.EqualTo(26), "floor (the four cut corners)");
            Assert.That(all.Count(IsLava), Is.EqualTo(136), "the lava tile count inside the box");
            Assert.That(all.Count(IsWall), Is.EqualTo(322), "the cone's wall tiles");
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheLavaIsLowTilesAndThereAreThreeTwoTileOutletsOnOneBorderRowInEveryOrientation(int k)
        {
            var rows = Orient(Rows(), k);
            var outlets = new List<(int x, int y)>(); int lava = 0;
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                if (IsLava(rows[y][x])) lava++;
                if (rows[y][x] == 'O') outlets.Add((x, y));
            }
            Assert.That(lava, Is.EqualTo(136));
            Assert.That(outlets.Count, Is.EqualTo(6));
            // All six on one border line of the box (the front edge), as three runs of exactly two.
            bool onX0 = outlets.All(o => o.x == 0), onX1 = outlets.All(o => o.x == Size - 1), onY0 = outlets.All(o => o.y == 0), onY1 = outlets.All(o => o.y == Size - 1);
            Assert.That(onX0 || onX1 || onY0 || onY1, Is.True, "orientation " + k + ": every outlet tile is on the same border line");
            var along = outlets.Select(o => (onX0 || onX1) ? o.y : o.x).OrderBy(v => v).ToArray();
            var runs = new List<int>(); int len = 1;
            for (int i = 1; i <= along.Length; i++)
            {
                if (i < along.Length && along[i] == along[i - 1] + 1) len++; else { runs.Add(len); len = 1; }
            }
            Assert.That(runs, Is.EqualTo(new[] { 2, 2, 2 }), "orientation " + k + ": three runs of two tiles");
        }

        /// <summary>The drawing in an open map in orientation k: wall for the cone, LOW for lava, floor elsewhere.</summary>
        static bool[] Interior(int k, bool withEntrance)
        {
            const int mapW = 44, mapH = 44, ox = 7, oy = 5;
            var rows = Orient(Rows(), k); var tiles = new byte[mapW * mapH]; var entrance = new List<MapTile>();
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                char c = rows[y][x]; int i = (oy + y) * mapW + ox + x;
                if (IsWall(c)) tiles[i] = MapBlob.Wall; else if (IsLava(c)) tiles[i] = MapBlob.Low;
                if (c == 'O') entrance.Add(new MapTile((ushort)(ox + x), (ushort)(oy + y)));
            }
            return LandmarkInterior.Find(tiles, mapW, mapH, new MapRect(ox, oy, Size, Size), withEntrance ? entrance.ToArray() : new MapTile[0]);
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheVolcanoHasNoInteriorInAnyOrientationWithOrWithoutTheEntrance(int k)
        {
            Assert.That(LandmarkInterior.Count(Interior(k, true)), Is.EqualTo(0), "orientation " + k + ": the lake is lava, not floor; the corners are open to the border");
            Assert.That(LandmarkInterior.Count(Interior(k, false)), Is.EqualTo(0), "orientation " + k + ": and the entrance does not matter");
        }

        // ---- the tier rule (the one the Unity art must follow; the test in Unity repeats it on the delivered tiles) -----------------

        /// <summary>Tier of every cone tile of a footprint-local drawing: 0 foot, 1 slope, 2 rim, -1 not a wall tile. DEPTH of a wall tile = the Euclidean
        /// distance between tile centres to the nearest tile that is neither wall nor lava (tiles outside the footprint count as such); D = the
        /// largest depth; depth <= 0.4 D foot, <= 0.8 D slope, else rim.</summary>
        static int[] Tiers(string[] rows)
        {
            var t = new int[Size * Size]; var depth = new double[Size * Size]; double dmax = 0;
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
            {
                if (!IsWall(rows[y][x])) continue;
                double best = Math.Min(Math.Min(x + 1, Size - x), Math.Min(y + 1, Size - y)); best *= best;   // the nearest tile outside the box, squared
                for (int yy = 0; yy < Size; yy++) for (int xx = 0; xx < Size; xx++)
                    if (!IsWall(rows[yy][xx]) && !IsLava(rows[yy][xx])) best = Math.Min(best, (x - xx) * (x - xx) + (y - yy) * (y - yy));
                depth[y * Size + x] = Math.Sqrt(best); dmax = Math.Max(dmax, depth[y * Size + x]);
            }
            for (int i = 0; i < t.Length; i++)
            {
                if (!IsWall(rows[i / Size][i % Size])) { t[i] = -1; continue; }
                t[i] = depth[i] <= .4 * dmax ? 0 : depth[i] <= .8 * dmax ? 1 : 2;
            }
            return t;
        }

        /// <summary>Distance from each tile to the nearest lake-core tile (a lava tile whose eight neighbours are all lava).</summary>
        static double[] LakeDistance(string[] rows)
        {
            var core = new List<(int x, int y)>();
            for (int y = 1; y < Size - 1; y++) for (int x = 1; x < Size - 1; x++)
            {
                bool all = true; for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) all &= IsLava(rows[y + dy][x + dx]);
                if (all) core.Add((x, y));
            }
            Assert.That(core.Count, Is.EqualTo(58), "the lake core");
            var d = new double[Size * Size];
            for (int i = 0; i < d.Length; i++) d[i] = core.Min(c => Math.Sqrt((c.x - i % Size) * (c.x - i % Size) + (c.y - i / Size) * (c.y - i / Size)));
            return d;
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheTierRuleReproducesTheDrawingsRingsAndPutsEveryRimTileNearerTheLakeThanEveryFootTile(int k)
        {
            var rows = Orient(Rows(), k); var t = Tiers(rows); var lake = LakeDistance(rows);
            Assert.That(t.Count(v => v == 0), Is.EqualTo(136), "foot tiles (the drawing draws 136)");
            Assert.That(t.Count(v => v == 1), Is.EqualTo(146), "slope tiles (the drawing draws 146)");
            Assert.That(t.Count(v => v == 2), Is.EqualTo(40), "rim tiles (the drawing draws 40)");
            int wrong = 0;
            for (int i = 0; i < t.Length; i++)
            {
                char c = rows[i / Size][i % Size];
                if (IsWall(c) && "#XH".IndexOf(c) != t[i]) wrong++;
            }
            Assert.That(wrong, Is.EqualTo(0), "orientation " + k + ": the rule reproduces the drawn rings on all 322 wall tiles");
            double rimFar = 0, footNear = double.MaxValue;
            for (int i = 0; i < t.Length; i++)
            {
                if (t[i] == 2) rimFar = Math.Max(rimFar, lake[i]);
                if (t[i] == 0) footNear = Math.Min(footNear, lake[i]);
            }
            Assert.That(rimFar, Is.LessThan(footNear), "every rim tile is nearer the lake core than every foot tile");
        }
    }
}

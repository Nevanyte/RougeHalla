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
    /// P-UNITY-LANDMARK-5 oracle, engine-free guards on the approved drawing docs/landmarks/blueprints/hall.txt (37 x 37; '#' pier or shrine
    /// wall, 'L' healing light = floor with terrain Light, 'D' door, '*' nave light mark = not a tile, 'E' camp centre = plain floor), and on
    /// what the framework's interior rule makes of it (the shrine's floor only). These pass today: they pin the drawing, not new code.
    /// </summary>
    public sealed class HallLandmarkDrawingTests
    {
        const int Size = 37;

        static string[] Rows()
        {
            string path = Path.Combine(Util.RepoRoot(), "docs", "landmarks", "blueprints", "hall.txt");
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

        static int Count(string[] rows, char c) { return rows.Sum(r => r.Count(ch => ch == c)); }

        static List<List<(int x, int y)>> WallGroups(string[] rows)
        {
            var left = new HashSet<(int, int)>();
            for (int y = 0; y < rows.Length; y++) for (int x = 0; x < rows[y].Length; x++) if (rows[y][x] == '#') left.Add((x, y));
            var groups = new List<List<(int x, int y)>>();
            while (left.Count > 0)
            {
                var first = left.First(); left.Remove(first); var g = new List<(int x, int y)> { first }; var st = new Stack<(int, int)>(); st.Push(first);
                while (st.Count > 0) { var (a, b) = st.Pop(); for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) if (left.Remove((a + dx, b + dy))) { g.Add((a + dx, b + dy)); st.Push((a + dx, b + dy)); } }
                groups.Add(g);
            }
            return groups;
        }

        [Test]
        public void TheDrawingIs37SquareWithTheTileCountsTheOracleExpects()
        {
            var rows = Rows();
            Assert.That(rows.Length, Is.EqualTo(Size)); Assert.That(rows.All(r => r.Length == Size), Is.True);
            Assert.That(Count(rows, '#'), Is.EqualTo(315), "32 piers x 9 + the shrine's 27 wall tiles");
            Assert.That(Count(rows, 'L'), Is.EqualTo(9), "the healing light: 3 x 3 floor tiles with terrain Light");
            Assert.That(Count(rows, 'D'), Is.EqualTo(3), "the shrine's door");
            Assert.That(Count(rows, 'E'), Is.EqualTo(2), "two camp centres, on the nave, rows 15 and 27, column 18");
            Assert.That(rows[15][18], Is.EqualTo('E')); Assert.That(rows[27][18], Is.EqualTo('E'));
            Assert.That(Count(rows, '*'), Is.EqualTo(6), "nave light marks: decorations, not tiles");
        }

        [Test]
        public void ThereAre32PierGroupsOfNineTilesInA3x3BoxAndOneShrineGroupOf27()
        {
            var groups = WallGroups(Rows());
            Assert.That(groups.Count, Is.EqualTo(33));
            var piers = groups.Where(g => g.Count == 9).ToList(); var other = groups.Where(g => g.Count != 9).ToList();
            Assert.That(piers.Count, Is.EqualTo(32));
            foreach (var g in piers) { Assert.That(g.Max(t => t.x) - g.Min(t => t.x), Is.EqualTo(2)); Assert.That(g.Max(t => t.y) - g.Min(t => t.y), Is.EqualTo(2)); }
            Assert.That(other.Count, Is.EqualTo(1)); var s = other[0];
            Assert.That(s.Count, Is.EqualTo(27));
            Assert.That((s.Min(t => t.x), s.Max(t => t.x), s.Min(t => t.y), s.Max(t => t.y)), Is.EqualTo((14, 22, 1, 7)), "the shrine's box: 9 wide, 7 tall");
        }

        [Test]
        public void TheNaveIsSevenWideAndItsEndIsTheFrontRowBetweenTheLastPiers()
        {
            var rows = Rows();
            for (int x = 15; x <= 21; x++) Assert.That(rows[36][x], Is.EqualTo('.'), "entrance column " + x + " on the front row");
            Assert.That(rows[36][14], Is.EqualTo('#')); Assert.That(rows[36][22], Is.EqualTo('#'));
            for (int x = 17; x <= 19; x++) Assert.That(rows[7][x], Is.EqualTo('D'), "door column " + x + " on the shrine's front wall");
        }

        [TestCase(0), TestCase(1), TestCase(2), TestCase(3), TestCase(4), TestCase(5), TestCase(6), TestCase(7)]
        public void TheInteriorRuleFindsTheShrinesFloorOnly(int k)
        {
            var rows = Orient(Rows(), k);
            const int W = 50, H = 50, Ox = 6, Oy = 5;
            var tiles = new byte[W * H];
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++) if (rows[y][x] == '#') tiles[(Oy + y) * W + Ox + x] = MapBlob.Wall;
            // The entrance, as the generator is to record it: the nave's 7 tiles on the front row (drawing row 36, columns 15-21), oriented.
            var entrance = new List<MapTile>();
            var orig = Rows();
            var marked = orig.Select(r => r.ToCharArray()).ToArray();
            for (int x = 15; x <= 21; x++) marked[36][x] = 'M';
            var oriented = Orient(marked.Select(r => new string(r)).ToArray(), k);
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++) if (oriented[y][x] == 'M') entrance.Add(new MapTile((ushort)(Ox + x), (ushort)(Oy + y)));
            Assert.That(entrance.Count, Is.EqualTo(7));
            var interior = LandmarkInterior.Find(tiles, W, H, new MapRect(Ox, Oy, Size, Size), entrance.ToArray());
            Assert.That(LandmarkInterior.Count(interior), Is.EqualTo(33), "orientation " + k + ": rows 2-5 x 7 + row 6 x 5, the shrine's floor (the door tiles are closed, not interior)");
            // No interior tile is a floor tile outside the shrine's box, none is a door tile, and no pier is a building.
            var shrine = WallGroups(rows).Single(g => g.Count == 27);
            int x0 = shrine.Min(t => t.x), x1 = shrine.Max(t => t.x), y0 = shrine.Min(t => t.y), y1 = shrine.Max(t => t.y);
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++)
                if (interior[y * Size + x])
                {
                    Assert.That(x >= x0 && x <= x1 && y >= y0 && y <= y1, Is.True, "orientation " + k + ": interior tile (" + x + ", " + y + ") is inside the shrine's box");
                    Assert.That(rows[y][x] != 'D' && rows[y][x] != '#', Is.True);
                }
        }
    }
}

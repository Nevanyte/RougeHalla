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
    /// P-UNITY-LANDMARK-4 oracle, engine-free half: guards on the approved drawing docs/landmarks/blueprints/bog.txt (29 x 29; 'T' trunk and
    /// 'r' root are wall; '%' bog is floor with terrain Bog; ':' causeway and '.' are plain floor) and on the canopy's cover rule the Unity art
    /// must follow (docs/backlog/packets/P-UNITY-LANDMARK-4.md, "Established facts"). They pass today: they pin the drawing and the rule.
    /// THE COVER RULE: the trunk is the largest 8-connected group of wall tiles of the footprint (roots touching it belong to it); the
    /// cover is the trunk group's own tiles plus every floor tile of the footprint that is not bog and whose centre is within
    /// EUCLIDEAN distance 3 (dx*dx + dy*dy &lt;= 9) of the centre of some trunk-group tile.
    /// </summary>
    public sealed class BogTreeLandmarkDrawingTests
    {
        const int Size = 29, CoverRadiusSquared = 9;

        static string[] Rows()
        {
            string path = Path.Combine(Util.RepoRoot(), "docs", "landmarks", "blueprints", "bog.txt");
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
        static int Count(string[] rows, char c) { return rows.Sum(r => r.Count(ch => ch == c)); }

        static List<List<(int x, int y)>> WallGroups(string[] rows)
        {
            var left = new HashSet<(int, int)>();
            for (int y = 0; y < rows.Length; y++) for (int x = 0; x < rows[y].Length; x++) if (rows[y][x] == 'T' || rows[y][x] == 'r') left.Add((x, y));
            var groups = new List<List<(int x, int y)>>();
            while (left.Count > 0)
            {
                var first = left.OrderBy(t => t).First(); left.Remove(first); var g = new List<(int x, int y)> { first }; var st = new Stack<(int, int)>(); st.Push(first);
                while (st.Count > 0) { var (a, b) = st.Pop(); for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) if (left.Remove((a + dx, b + dy))) { g.Add((a + dx, b + dy)); st.Push((a + dx, b + dy)); } }
                groups.Add(g);
            }
            return groups;
        }

        /// <summary>The cover set of the rule above (trunk tiles included) for a drawing.</summary>
        static HashSet<(int x, int y)> Cover(string[] rows)
        {
            var groups = WallGroups(rows); var trunk = groups.OrderByDescending(g => g.Count).First();
            var cover = new HashSet<(int x, int y)>(trunk);
            for (int y = 0; y < rows.Length; y++) for (int x = 0; x < rows[y].Length; x++)
            {
                if (rows[y][x] == 'T' || rows[y][x] == 'r' || rows[y][x] == '%') continue;
                if (trunk.Any(t => (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y) <= CoverRadiusSquared)) cover.Add((x, y));
            }
            return cover;
        }

        [Test]
        public void TheDrawingIs29SquareWithTheTileCountsTheOracleExpects()
        {
            var rows = Rows();
            Assert.That(rows.Length, Is.EqualTo(Size)); Assert.That(rows.All(r => r.Length == Size), Is.True);
            Assert.That(Count(rows, 'T'), Is.EqualTo(93)); Assert.That(Count(rows, 'r'), Is.EqualTo(62));
            Assert.That(Count(rows, '%'), Is.EqualTo(213)); Assert.That(Count(rows, ':'), Is.EqualTo(62)); Assert.That(Count(rows, '.'), Is.EqualTo(411));
            Assert.That(Count(rows, 'E') + Count(rows, 'D') + Count(rows, '+'), Is.EqualTo(0), "no entrance, no door, no fence");
            Assert.That(Count(rows, 'T') + Count(rows, 'r'), Is.EqualTo(155), "Landmark.WallCount of the bog tree");
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheTrunkIsTheLargestWallGroupWithItsRootsAndThreeFreeStumpsOfSixTilesStandAlone(int k)
        {
            var groups = WallGroups(Orient(Rows(), k)).OrderByDescending(g => g.Count).ToList();
            Assert.That(groups.Select(g => g.Count).ToArray(), Is.EqualTo(new[] { 137, 6, 6, 6 }), "orientation " + k + ": trunk (93 trunk + 44 root tiles) and three stumps");
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheCoverIsTheTrunkGroupPlusTheDryFloorWithinThreeTilesAndHasTheSameCountInEveryOrientation(int k)
        {
            var rows = Orient(Rows(), k); var cover = Cover(rows);
            Assert.That(cover.Count, Is.EqualTo(275), "orientation " + k + ": 137 trunk-group tiles + 138 floor tiles");
            int dry = cover.Count(t => rows[t.y][t.x] == '.'), causeway = cover.Count(t => rows[t.y][t.x] == ':');
            Assert.That(dry, Is.EqualTo(120), "orientation " + k); Assert.That(causeway, Is.EqualTo(18), "orientation " + k + ": the causeways' stretches inside the ring");
            Assert.That(cover.Any(t => rows[t.y][t.x] == '%'), Is.False, "no bog tile");
            Assert.That(Count(Orient(Rows(), k), ':') - causeway, Is.EqualTo(62 - 18), "the rest of the causeways lies beyond the ring and is not covered");
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheBogTreeHasNoInteriorInAnyOrientationSoTheCoverMustBeHandedOverByTheArt(int k)
        {
            var rows = Orient(Rows(), k); const int N = 48, X0 = 9, Y0 = 7;
            var tiles = new byte[N * N];
            // The generator's entrance (agreed with its session): the six causeway tiles on the box's edge, in the drawing's coordinates.
            var drawn = new[] { (12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28) };
            var plain = Rows(); Assert.That(plain[14][14], Is.EqualTo('T'), "the anchor's centre (14, 14) is a trunk tile");
            foreach (var (dx, dy) in drawn) Assert.That(plain[dy][dx], Is.EqualTo(':'), "entrance (" + dx + ", " + dy + ") is a causeway tile");
            var entrance = new List<MapTile>();
            var marked = plain.Select(r => r.ToCharArray()).ToArray(); foreach (var (dx, dy) in drawn) marked[dy][dx] = 'e';
            rows = Orient(marked.Select(r => new string(r)).ToArray(), k);
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++) if (rows[y][x] == 'e') entrance.Add(new MapTile((ushort)(X0 + x), (ushort)(Y0 + y)));
            Assert.That(entrance.Count, Is.EqualTo(6));
            for (int y = 0; y < Size; y++) for (int x = 0; x < Size; x++) if (rows[y][x] == 'T' || rows[y][x] == 'r') tiles[(Y0 + y) * N + X0 + x] = MapBlob.Wall;
            var flags = LandmarkInterior.Find(tiles, N, N, new MapRect(X0, Y0, Size, Size), entrance.ToArray());
            Assert.That(LandmarkInterior.Count(flags), Is.EqualTo(0), "orientation " + k);
        }
    }
}

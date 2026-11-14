using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-LANDMARK-3 oracle, engine-free guards: the counts the EditMode church tests rely on, read from the approved drawing
    /// docs/landmarks/blueprints/church.txt (never edited here). If the drawing changes, these say which assumption moved.
    /// </summary>
    public sealed class ChurchLandmarkDrawingTests
    {
        static string[] Rows()
        {
            string path = Path.Combine(Util.RepoRoot(), "docs", "landmarks", "blueprints", "church.txt");
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            return File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray();
        }

        static int Count(string[] rows, char c) { return rows.Sum(r => r.Count(ch => ch == c)); }

        [Test]
        public void TheDrawingIs29SquareWithTheTileCountsTheOracleExpects()
        {
            var rows = Rows();
            Assert.That(rows.Length, Is.EqualTo(29)); Assert.That(rows.All(r => r.Length == 29), Is.True);
            Assert.That(Count(rows, '#'), Is.EqualTo(67), "building wall (70 border tiles less the 3 door tiles)");
            Assert.That(Count(rows, 'P'), Is.EqualTo(48), "pillar tiles");
            Assert.That(Count(rows, 'G'), Is.EqualTo(24), "headstone tiles");
            Assert.That(Count(rows, 'D'), Is.EqualTo(3), "door tiles");
            Assert.That(Count(rows, 'E'), Is.EqualTo(1));
            Assert.That(Count(rows, '#') + Count(rows, 'P') + Count(rows, 'G'), Is.EqualTo(139), "Landmark.WallCount of the church");
        }

        [Test]
        public void TheDoorIsThreeTilesOnTheBuildingsFrontWallAndTheMainGateIsFiveOnTheFrontRow()
        {
            var rows = Rows();
            for (int x = 13; x <= 15; x++) Assert.That(rows[16][x], Is.EqualTo('D'), "door column " + x + " on row 16");
            for (int x = 12; x <= 16; x++) Assert.That(rows[28][x], Is.EqualTo('.'), "main gate column " + x + " on row 28");
            Assert.That(rows[28][11], Is.EqualTo('+')); Assert.That(rows[28][17], Is.EqualTo('+'));
        }

        [Test]
        public void ThereAreFourHeadstoneGroupsEachTwoWideAndThreeTallOutsideTheBuildingBox()
        {
            // The brief and the owner's ruling say "2 x 2"; the drawing has 2 wide x 3 tall (rows 21-23). Pinned as drawn.
            var rows = Rows(); var left = new HashSet<(int, int)>();
            for (int y = 0; y < 29; y++) for (int x = 0; x < 29; x++) if (rows[y][x] == 'G') left.Add((x, y));
            var groups = new List<List<(int x, int y)>>();
            while (left.Count > 0)
            {
                var first = left.First(); left.Remove(first); var g = new List<(int x, int y)> { first }; var st = new Stack<(int, int)>(); st.Push(first);
                while (st.Count > 0) { var (a, b) = st.Pop(); for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) if (left.Remove((a + dx, b + dy))) { g.Add((a + dx, b + dy)); st.Push((a + dx, b + dy)); } }
                groups.Add(g);
            }
            Assert.That(groups.Count, Is.EqualTo(4));
            foreach (var g in groups)
            {
                Assert.That(g.Count, Is.EqualTo(6));
                Assert.That(g.Max(t => t.x) - g.Min(t => t.x), Is.EqualTo(1)); Assert.That(g.Max(t => t.y) - g.Min(t => t.y), Is.EqualTo(2));
                Assert.That(g.Min(t => t.y), Is.GreaterThan(16), "south of the building (rows 3-16)");
            }
        }
    }
}

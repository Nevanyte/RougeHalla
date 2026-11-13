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
    /// P-UNITY-LANDMARK-1 oracle, engine-free half: which floor tiles of a landmark's footprint are interior (under the roof), found
    /// from the delivered collision tiles only. The rule (docs/backlog/packets/P-UNITY-LANDMARK-1.md section 3, fact 4): take each
    /// 8-connected group of wall tiles inside the footprint and its bounding box; a run of at most LandmarkInterior.MaxOpening
    /// non-wall tiles between two wall tiles ALONG THE BOX'S BORDER (a doorway, a mouth) is closed, and so is every entrance tile
    /// inside the box whatever the run's width; the interior is the floor inside the box that cannot be reached from the box's
    /// border through non-wall tiles once those are closed. Doorway tiles are not interior; low tiles (fences) do not enclose.
    /// The approved blueprints are read from docs/landmarks/blueprints and placed in all eight orientations.
    /// </summary>
    public sealed class LandmarkInteriorTests
    {
        // ---- maps from drawings ------------------------------------------------------------------------------------------------

        /// <summary>A drawing: '#', 'R', 'P', 'G' wall; '+' and '-' low; anything else floor.</summary>
        sealed class Drawing
        {
            public char[,] Cell; public int W, H;
            public Drawing(string[] rows) { H = rows.Length; W = rows[0].Length; Cell = new char[W, H]; for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) Cell[x, y] = rows[y][x]; }
            public static byte Tile(char c) { return "#RPG".IndexOf(c) >= 0 ? MapBlob.Wall : "+-".IndexOf(c) >= 0 ? MapBlob.Low : MapBlob.Floor; }
            public IEnumerable<(int x, int y, char c)> All() { for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) yield return (x, y, Cell[x, y]); }
            /// <summary>One of the eight placements: swap x and y, then flip x, then flip y (square drawings only).</summary>
            public Drawing Orient(int k)
            {
                bool swap = (k & 1) != 0, fx = (k & 2) != 0, fy = (k & 4) != 0;
                var rows = new string[H];
                for (int y = 0; y < H; y++)
                {
                    var r = new char[W];
                    for (int x = 0; x < W; x++) { int sx = fx ? W - 1 - x : x, sy = fy ? H - 1 - y : y; r[x] = swap ? Cell[sy, sx] : Cell[sx, sy]; }
                    rows[y] = new string(r);
                }
                return new Drawing(rows);
            }
        }

        static Drawing Load(string file)
        {
            string path = Path.Combine(Util.RepoRoot(), "docs", "landmarks", "blueprints", file);
            Assert.That(File.Exists(path), "blueprint missing: " + path);
            return new Drawing(File.ReadAllLines(path).Where(l => l.Length > 0 && l[0] != ';').ToArray());
        }

        const int MapW = 44, MapH = 44, OffX = 7, OffY = 5;

        /// <summary>The drawing stamped at (ox, oy) in an open floor map; returns the interior flags over the footprint.</summary>
        static bool[] Run(Drawing d, int ox, int oy, int mapW, int mapH, IEnumerable<(int x, int y)> entranceInDrawing)
        {
            var tiles = new byte[mapW * mapH];
            foreach (var (x, y, c) in d.All()) tiles[(oy + y) * mapW + ox + x] = Drawing.Tile(c);
            var entrance = entranceInDrawing.Select(e => new MapTile((ushort)(ox + e.x), (ushort)(oy + e.y))).ToArray();
            return LandmarkInterior.Find(tiles, mapW, mapH, new MapRect((ushort)ox, (ushort)oy, (ushort)d.W, (ushort)d.H), entrance);
        }

        static Drawing Box(params string[] rows) { return new Drawing(rows); }

        // ---- hand-made boxes ---------------------------------------------------------------------------------------------------

        [Test]
        public void TheConstantIsThePinnedOpeningWidth() => Assert.That(LandmarkInterior.MaxOpening, Is.EqualTo(5), "wide enough for the church's 5-tile main gate");

        [Test]
        public void AWalledBoxWithOneOpeningHasItsEnclosedFloorAsInterior()
        {
            var box = Box("#########", "#.......#", "#.......#", "#.......#", "#.......#", "#.......#", "####.####");
            var flags = Run(box, 3, 3, MapW, MapH, new[] { (4, 6) });
            Assert.That(LandmarkInterior.Count(flags), Is.EqualTo(35), "7 x 5 enclosed floor; the doorway tile is not interior");
            Assert.That(flags[6 * 9 + 4], Is.False, "the doorway tile itself");
            Assert.That(flags[1 * 9 + 1], Is.True, "a floor tile in the corner of the room");
        }

        [Test]
        public void TheOpeningNeedNotBeListedWhenItIsNarrow()
        {
            var box = Box("#########", "#.......#", "#.......#", "#.......#", "#.......#", "#.......#", "####.####");
            Assert.That(LandmarkInterior.Count(Run(box, 3, 3, MapW, MapH, new (int, int)[0])), Is.EqualTo(35), "a one-tile gap between walls is a doorway without the entrance list");
        }

        [Test]
        public void ABoxWithTwoOpeningsIsStillInterior()
        {
            var box = Box("#########", "#.......#", "#.......#", "........#", "#.......#", "#.......#", "###...###");
            var flags = Run(box, 3, 3, MapW, MapH, new[] { (3, 6), (4, 6), (5, 6) });
            Assert.That(LandmarkInterior.Count(flags), Is.EqualTo(35), "a 3-wide mouth and a 1-wide side door, both closed; neither doorway is interior");
            Assert.That(flags[3 * 9 + 0], Is.False, "the side doorway");
        }

        [Test]
        public void ABoxWithAWideGapHasNoInteriorUnlessTheGapIsTheEntrance()
        {
            var box = Box("#############", "#...........#", "#...........#", "#...........#", "#...........#", "###.......###");
            Assert.That(LandmarkInterior.Count(Run(box, 3, 3, MapW, MapH, new (int, int)[0])), Is.EqualTo(0), "a 7-wide gap is open ground, not a doorway");
            var entrance = Enumerable.Range(3, 7).Select(x => (x, 5)).ToArray();
            Assert.That(LandmarkInterior.Count(Run(box, 3, 3, MapW, MapH, entrance)), Is.EqualTo(44), "the anchor's entrance tiles are doorways whatever their width: 11 x 4 enclosed floor");
        }

        [Test]
        public void ABoxOpenToTheMapEdgeHasNoInterior()
        {
            // Footprint at the map's corner; the top wall has a 6-wide hole whose far side is the map's edge, not another tile.
            var open = Box("##......##", "#........#", "#........#", "#........#", "#........#", "#........#", "##########");
            Assert.That(LandmarkInterior.Count(Run(open, 0, 0, 20, 20, new (int, int)[0])), Is.EqualTo(0), "open to the map edge");
            var door = Box("###...####", "#........#", "#........#", "#........#", "#........#", "#........#", "##########");
            Assert.That(LandmarkInterior.Count(Run(door, 0, 0, 20, 20, new (int, int)[0])), Is.EqualTo(40), "the same box with a 3-wide doorway at the edge is closed: 8 x 5 floor");
        }

        [Test]
        public void AFenceDoesNotEncloseAndFloorOutsideTheWallsIsNotInterior()
        {
            var fenced = Box("-----------", "-.........-", "-.........-", "-.........-", "-----------");
            Assert.That(LandmarkInterior.Count(Run(fenced, 3, 3, MapW, MapH, new (int, int)[0])), Is.EqualTo(0), "low tiles do not enclose: shots cross a fence");
            var yard = Box(".........", ".#######.", ".#.....#.", ".#.....#.", ".###.###.", ".........");
            Assert.That(LandmarkInterior.Count(Run(yard, 3, 3, MapW, MapH, new (int, int)[0])), Is.EqualTo(10), "only the building's own 5 x 2 floor, not the open ground round it");
        }

        // ---- the approved drawings, in all eight orientations -----------------------------------------------------------------

        static IEnumerable<int> Orientations() { return Enumerable.Range(0, 8); }

        [Test]
        public void TheCaveDrawingHas627FloorTilesAndTheMouthIsThreeOfThem()
        {
            var cave = Load("cave.txt");
            Assert.That(cave.W, Is.EqualTo(29)); Assert.That(cave.H, Is.EqualTo(29));
            Assert.That(cave.All().Count(t => Drawing.Tile(t.c) == MapBlob.Floor), Is.EqualTo(627), "guard on the checked-in drawing");
            Assert.That(cave.All().Count(t => t.c == 'D'), Is.EqualTo(3));
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheCaveInteriorIsItsEnclosedFloorInEveryOrientation(int k)
        {
            var cave = Load("cave.txt").Orient(k);
            var mouth = cave.All().Where(t => t.c == 'D').Select(t => (t.x, t.y)).ToArray();
            var flags = Run(cave, OffX, OffY, MapW, MapH, mouth);
            Assert.That(LandmarkInterior.Count(flags), Is.EqualTo(624), "orientation " + k + ": 627 floor tiles less the 3 mouth tiles; all of them are enclosed and reachable from the mouth");
            foreach (var (x, y, c) in cave.All())
                Assert.That(flags[y * cave.W + x], Is.EqualTo(".=E".IndexOf(c) >= 0), "orientation " + k + " tile (" + x + ", " + y + ") is '" + c + "'");
        }

        [Test]
        public void TheChurchDrawingBuildingIs204FloorTilesAndTheMainGateIsFiveOnTheFrontRow()
        {
            var church = Load("church.txt");
            Assert.That(church.W, Is.EqualTo(29)); Assert.That(church.H, Is.EqualTo(29));
            int building = 0; for (int y = 4; y <= 15; y++) for (int x = 4; x <= 24; x++) if (".E".IndexOf(church.Cell[x, y]) >= 0) building++;
            Assert.That(building, Is.EqualTo(204), "guard on the checked-in drawing: 21 x 12 less 48 pillar tiles");
            for (int x = 12; x <= 16; x++) Assert.That(church.Cell[x, 28], Is.EqualTo('.'), "main gate column " + x);
        }

        [TestCaseSource(nameof(Orientations))]
        public void TheChurchInteriorIsTheWalledBuildingAndNotTheYardInEveryOrientation(int k)
        {
            // The anchor's entrance is the main gate (front row, columns 12-16), twelve rows of yard from the building's own
            // three-tile door: the roofed interior is the walled building. The yard, the graveyard and the fence are not.
            var original = Load("church.txt");
            var church = original.Orient(k);
            int n = original.W;
            // Where each original tile landed: orient the coordinate drawing the same way.
            var marks = new string[n];
            for (int y = 0; y < n; y++) marks[y] = new string(Enumerable.Range(0, n).Select(x => y >= 4 && y <= 15 && x >= 4 && x <= 24 && ".E".IndexOf(original.Cell[x, y]) >= 0 ? 'i' : y == 28 && x >= 12 && x <= 16 ? 'g' : '.').ToArray());
            var where = new Drawing(marks).Orient(k);
            var gate = where.All().Where(t => t.c == 'g').Select(t => (t.x, t.y)).ToArray();
            var flags = Run(church, OffX, OffY, MapW, MapH, gate);
            Assert.That(LandmarkInterior.Count(flags), Is.EqualTo(204), "orientation " + k + ": the building's floor only");
            foreach (var (x, y, c) in where.All())
                Assert.That(flags[y * church.W + x], Is.EqualTo(c == 'i'), "orientation " + k + " tile (" + x + ", " + y + ")");
        }
    }
}

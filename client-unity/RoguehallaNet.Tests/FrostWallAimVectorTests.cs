using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-1 oracle: <c>FrostWallAim</c> gives what rh-sim's wall placement gives, on
    /// <c>protocol/fixtures/frost_wall_aim_v1.json</c> (written by <c>cargo run -p rh-parity --bin frost-wall-aim-fixtures</c>
    /// from <c>rh_sim::barriers::wall_segment_for</c> and <c>wall_cells</c>; ADR 0008's walk-prediction precedent): the same
    /// segment to 1e-3 and exactly the same tiles, and, for the closed-gate map, the same body map from the plan-map step.
    /// </summary>
    public class FrostWallAimVectorTests
    {
        static JsonElement Root()
        {
            return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "frost_wall_aim_v1.json"))).RootElement;
        }
        static byte[] Bytes(JsonElement a) { return a.EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray(); }

        public static IEnumerable<string> CaseNames()
        {
            foreach (var c in Root().GetProperty("cases").EnumerateArray()) yield return c.GetProperty("name").GetString();
        }

        [Test]
        public void TheFileIsTheFrostWallAndCoversTheBriefsCases()
        {
            var root = Root();
            Assert.AreEqual("rh-frost-wall-aim/1", root.GetProperty("format").GetString());
            var n = root.GetProperty("numbers");
            Assert.AreEqual(450, n.GetProperty("range").GetDouble()); Assert.AreEqual(64, n.GetProperty("minRange").GetDouble());
            Assert.AreEqual(224, n.GetProperty("length").GetDouble()); Assert.AreEqual(24, n.GetProperty("cellReach").GetDouble());
            Assert.AreEqual(8, n.GetProperty("endSlack").GetDouble()); Assert.AreEqual(FrostWallAim.Tile, root.GetProperty("tile").GetDouble());
            var names = CaseNames().ToList();
            foreach (var want in new[] { "axis", "inside_min_range", "beyond_range", "diagonal", "cursor_on_caster", "into_rock", "partly_low",
                "closed_gate", "top_edge", "right_edge", "end_slack_inclusive", "end_slack_just_out" })
                CollectionAssert.Contains(names, want);
        }

        [TestCaseSource(nameof(CaseNames))]
        public void TheMirrorGivesRustsSegmentAndTiles(string name)
        {
            var root = Root();
            var n = root.GetProperty("numbers");
            double range = n.GetProperty("range").GetDouble(), minRange = n.GetProperty("minRange").GetDouble(), length = n.GetProperty("length").GetDouble();
            double reach = n.GetProperty("cellReach").GetDouble(), slack = n.GetProperty("endSlack").GetDouble();
            var c = root.GetProperty("cases").EnumerateArray().First(e => e.GetProperty("name").GetString() == name);
            var m = root.GetProperty("maps").EnumerateArray().First(e => e.GetProperty("name").GetString() == c.GetProperty("map").GetString());
            var from = c.GetProperty("from"); var cursor = c.GetProperty("cursor"); var s = c.GetProperty("segment");

            var seg = FrostWallAim.SegmentFor(from[0].GetDouble(), from[1].GetDouble(), cursor[0].GetDouble(), cursor[1].GetDouble(),
                range, minRange, length, c.GetProperty("facing").GetDouble());
            Assert.AreEqual(s.GetProperty("cx").GetDouble(), seg.Cx, 1e-3, "cx"); Assert.AreEqual(s.GetProperty("cy").GetDouble(), seg.Cy, 1e-3, "cy");
            Assert.AreEqual(s.GetProperty("x1").GetDouble(), seg.X1, 1e-3, "x1"); Assert.AreEqual(s.GetProperty("y1").GetDouble(), seg.Y1, 1e-3, "y1");
            Assert.AreEqual(s.GetProperty("x2").GetDouble(), seg.X2, 1e-3, "x2"); Assert.AreEqual(s.GetProperty("y2").GetDouble(), seg.Y2, 1e-3, "y2");

            // The tiles from Rust's own segment, so a segment error cannot hide a tile error (and the other way round).
            var rustSeg = new FrostWallSegment(s.GetProperty("cx").GetDouble(), s.GetProperty("cy").GetDouble(), s.GetProperty("x1").GetDouble(),
                s.GetProperty("y1").GetDouble(), s.GetProperty("x2").GetDouble(), s.GetProperty("y2").GetDouble());
            var want = c.GetProperty("cells").EnumerateArray().Select(e => e.GetUInt32()).ToList();
            var got = new List<uint> { 12345 };
            FrostWallAim.Cells(Bytes(m.GetProperty("tiles")), m.GetProperty("w").GetInt32(), m.GetProperty("h").GetInt32(), rustSeg, reach, slack, got);
            CollectionAssert.AreEqual(want, got, "tiles from Rust's segment");
            FrostWallAim.Cells(Bytes(m.GetProperty("tiles")), m.GetProperty("w").GetInt32(), m.GetProperty("h").GetInt32(), seg, reach, slack, got);
            CollectionAssert.AreEqual(want, got, "tiles from the mirror's segment");
        }

        [Test]
        public void ThePlanMapOfTheOpenGateMapWithTheGatesLockedIsRustsClosedGateMap()
        {
            var m = Root().GetProperty("maps").EnumerateArray().First(e => e.GetProperty("name").GetString() == "gate_closed");
            ushort w = (ushort)m.GetProperty("w").GetInt32(), h = (ushort)m.GetProperty("h").GetInt32();
            var gates = m.GetProperty("gateTiles").EnumerateArray().Select(t => new MapTile((ushort)t[0].GetInt32(), (ushort)t[1].GetInt32())).ToArray();
            var open = new MapBlob(w, h, Bytes(m.GetProperty("openTiles")))
                .WithPublic(null, new MapColiseum(0, 0, w, h, new[] { new MapGate(1, gates) }), null, null, null);
            CollectionAssert.AreEqual(Bytes(m.GetProperty("tiles")), FrostWallAim.PlanMap(open, true, System.Array.Empty<AreaView>(), null));
            CollectionAssert.AreEqual(Bytes(m.GetProperty("openTiles")), FrostWallAim.PlanMap(open, false, System.Array.Empty<AreaView>(), null));
        }
    }
}

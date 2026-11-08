using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-NET-1 Phase 1 parity: the C# pathfinder must reproduce the Rust server's <c>find_path</c> query for query.
    /// <c>protocol/fixtures/pathfinding_v1.json</c> carries the seed-1 map as canonical <see cref="MapBlob"/> wire bytes
    /// (the client never generates maps) plus the 300 legacy queries and their expected waypoints. The golden was generated
    /// outside the repo by recomputing every query with <c>rh_sim::pathfind::Pathfinder::find_path</c> and asserting it
    /// matched <c>parity/fixtures/pathfinding_seed1.json</c> within <c>rh_parity::TOL</c> before writing (the recomputed
    /// paths were bit-identical; see <c>sourceMaxAbsCoordinateError</c>). This test enforces the brief's stricter
    /// <b>1e-6</b>; the fixture records the source harness tolerance (<c>rh_parity::TOL</c> = 2e-6) as metadata, and the
    /// observed maximum coordinate error is 0.
    /// </summary>
    public class PathfindingTests
    {
        /// <summary>Acceptance tolerance from the P-NET-1 brief (stricter than the 2e-6 the Rust harness accepts).</summary>
        const double Tol = 1e-6;
        /// <summary>The tolerance recorded in the golden's metadata (crates/rh-parity/src/lib.rs <c>TOL</c>).</summary>
        const double SourceTolerance = 2e-6;
        const int QueryCount = 300;
        /// <summary>Sum of all expected path lengths in the fixture: every waypoint is compared.</summary>
        const int WaypointCount = 975;

        static JsonElement Golden()
        {
            string path = Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "pathfinding_v1.json");
            return JsonDocument.Parse(File.ReadAllText(path)).RootElement;
        }

        static MapBlob DecodeMap(JsonElement golden)
        {
            var blob = golden.GetProperty("mapBlob");
            byte[] bytes = Util.FromHex(blob.GetProperty("hex").GetString());
            Assert.AreEqual(blob.GetProperty("wireBytes").GetInt32(), bytes.Length, "hex length");
            var reader = new Reader(bytes);
            var map = MapBlob.Read(ref reader);
            reader.End();
            Assert.AreEqual((int)blob.GetProperty("w").GetInt32(), (int)map.W, "decoded width");
            Assert.AreEqual((int)blob.GetProperty("h").GetInt32(), (int)map.H, "decoded height");
            Assert.AreEqual(blob.GetProperty("layerHash").GetUInt32(), map.LayerHash, "decoded layer hash");
            return map;
        }

        static PathPoint[] Expected(JsonElement query)
        {
            var path = query.GetProperty("path");
            var points = new PathPoint[path.GetArrayLength()];
            for (int i = 0; i < points.Length; i++)
                points[i] = new PathPoint(path[i][0].GetDouble(), path[i][1].GetDouble());
            return points;
        }

        static PathPoint[] Run(Pathfinder pf, MapBlob map, JsonElement query)
        {
            var from = query.GetProperty("from");
            var to = query.GetProperty("to");
            return pf.FindPath(map, from[0].GetDouble(), from[1].GetDouble(), to[0].GetDouble(), to[1].GetDouble());
        }

        [Test]
        public void GoldenDecodesTheSeedOneMap()
        {
            var golden = Golden();
            Assert.AreEqual("rh-pathfinding-golden/1", golden.GetProperty("format").GetString());
            Assert.AreEqual("parity/fixtures/pathfinding_seed1.json", golden.GetProperty("source").GetString());
            Assert.AreEqual(1, golden.GetProperty("sourceSeed").GetInt32());
            Assert.AreEqual(12.0, golden.GetProperty("radius").GetDouble());
            Assert.AreEqual(SourceTolerance, golden.GetProperty("tolerance").GetDouble(), "source harness tolerance");
            Assert.AreEqual(QueryCount, golden.GetProperty("queries").GetArrayLength());

            var map = DecodeMap(golden);
            Assert.AreEqual(160, (int)map.W);
            Assert.AreEqual(160, (int)map.H);
            Assert.AreEqual(160 * 160, map.Tiles.Length);
            int floor = 0, wall = 0, low = 0;
            foreach (byte t in map.Tiles)
            {
                if (t == MapBlob.Floor) floor++;
                else if (t == MapBlob.Wall) wall++;
                else if (t == MapBlob.Low) low++;
                else Assert.Fail("decoded a tile class the wire cannot carry: " + t);
            }
            // The seed-1 collision grid, as captured in the parity fixture's rows. The layer hash above already pins them.
            Assert.AreEqual(23183, floor);
            Assert.AreEqual(1945, wall);
            Assert.AreEqual(472, low);
            Assert.AreEqual(12 + 3 * golden.GetProperty("mapBlob").GetProperty("runCount").GetInt32(),
                golden.GetProperty("mapBlob").GetProperty("wireBytes").GetInt32(), "RLE size");
        }

        [Test]
        public void AllThreeHundredQueriesMatchTheRustWaypoints()
        {
            var golden = Golden();
            var map = DecodeMap(golden);
            var pf = new Pathfinder();
            var queries = golden.GetProperty("queries");
            Assert.AreEqual(QueryCount, queries.GetArrayLength());

            var bad = new List<string>();
            int badQueries = 0;
            int waypoints = 0;
            double maxErr = 0.0;
            for (int q = 0; q < queries.GetArrayLength(); q++)
            {
                var expected = Expected(queries[q]);
                var got = Run(pf, map, queries[q]);
                if (got.Length != expected.Length)
                {
                    badQueries++;
                    if (bad.Count < 20)
                        bad.Add("query " + q + ": got " + got.Length + " waypoints, expected " + expected.Length);
                    continue;
                }
                bool ok = true;
                for (int j = 0; j < got.Length; j++)
                {
                    double dx = Math.Abs(got[j].X - expected[j].X);
                    double dy = Math.Abs(got[j].Y - expected[j].Y);
                    if (dx > maxErr) maxErr = dx;
                    if (dy > maxErr) maxErr = dy;
                    waypoints++;
                    if (dx > Tol || dy > Tol)
                    {
                        ok = false;
                        if (bad.Count < 20)
                            bad.Add(string.Format(
                                "query {0} waypoint {1}: got ({2:R}, {3:R}) expected ({4:R}, {5:R}); |dx| = {6:E3}, |dy| = {7:E3}",
                                q, j, got[j].X, got[j].Y, expected[j].X, expected[j].Y, dx, dy));
                    }
                }
                if (!ok) badQueries++;
            }

            Assert.AreEqual(0, badQueries,
                badQueries + " of " + QueryCount + " queries differ (max absolute coordinate error "
                + maxErr.ToString("E3") + " > tolerance " + Tol.ToString("E3") + "):" + Environment.NewLine
                + string.Join(Environment.NewLine, bad));
            Assert.LessOrEqual(maxErr, Tol, "max absolute coordinate error must stay within 1e-6");
            Assert.AreEqual(WaypointCount, waypoints, "every expected waypoint was compared");
        }

        [Test]
        public void UnreachableGoalReturnsNoWaypoints()
        {
            var golden = Golden();
            var map = DecodeMap(golden);
            var pf = new Pathfinder();
            var queries = golden.GetProperty("queries");

            int empty = 0, emptyIndex = -1;
            for (int q = 0; q < queries.GetArrayLength(); q++)
            {
                if (queries[q].GetProperty("path").GetArrayLength() == 0)
                {
                    empty++;
                    emptyIndex = q;
                }
            }
            Assert.AreEqual(1, empty, "exactly one fixture query is unreachable");
            Assert.AreEqual(0, Run(pf, map, queries[emptyIndex]).Length, "query " + emptyIndex);

            // A goal outside the map is unreachable from the walkable start of a path that does exist.
            var from = queries[0].GetProperty("from");
            double fromX = from[0].GetDouble(), fromY = from[1].GetDouble();
            Assert.Greater(Run(pf, map, queries[0]).Length, 0);
            Assert.AreEqual(0, pf.FindPath(map, fromX, fromY, -5000.0, -5000.0).Length);
        }

        [Test]
        public void OnePathfinderInstanceReusesItsScratchWithoutLeakingState()
        {
            var golden = Golden();
            var map = DecodeMap(golden);
            var queries = golden.GetProperty("queries");
            var pf = new Pathfinder();

            var first = new PathPoint[queries.GetArrayLength()][];
            for (int q = 0; q < queries.GetArrayLength(); q++) first[q] = Run(pf, map, queries[q]);

            // Second pass, same instance, into a caller buffer: the generation stamps, candidate memo and tile path must
            // not leak from the previous query.
            var buffer = new PathPoint[map.W * map.H];
            for (int q = 0; q < queries.GetArrayLength(); q++)
            {
                var from = queries[q].GetProperty("from");
                var to = queries[q].GetProperty("to");
                int n = pf.FindPath(map, from[0].GetDouble(), from[1].GetDouble(),
                    to[0].GetDouble(), to[1].GetDouble(), Pathfinder.PlayerRadius, buffer);
                Assert.AreEqual(first[q].Length, n, "query " + q + " count on the second pass");
                for (int j = 0; j < n; j++)
                {
                    Assert.AreEqual(first[q][j].X, buffer[j].X, "query " + q + " waypoint " + j + " x");
                    Assert.AreEqual(first[q][j].Y, buffer[j].Y, "query " + q + " waypoint " + j + " y");
                }
            }
            Assert.Greater(pf.Searches, 0, "some queries need A*, not only the direct segment");

            // A different MapBlob instance with the same tiles rebuilds the derived tables without changing a result.
            var copy = new MapBlob(map.W, map.H, (byte[])map.Tiles.Clone());
            var again = pf.FindPath(copy, queries[0].GetProperty("from")[0].GetDouble(),
                queries[0].GetProperty("from")[1].GetDouble(), queries[0].GetProperty("to")[0].GetDouble(),
                queries[0].GetProperty("to")[1].GetDouble());
            Assert.AreEqual(first[0].Length, again.Length, "same tiles on a new MapBlob instance");
            for (int j = 0; j < again.Length; j++)
            {
                Assert.AreEqual(first[0][j].X, again[j].X, "new instance waypoint " + j + " x");
                Assert.AreEqual(first[0][j].Y, again[j].Y, "new instance waypoint " + j + " y");
            }
        }
    }
}

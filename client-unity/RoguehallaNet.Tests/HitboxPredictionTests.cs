using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// ADR0024 P-HB-7: the C# foot box (<see cref="Footprint"/>, <c>box_clear</c>, <c>segment_box_clear</c>, the box A*) against the
    /// Rust-generated v2 vectors. The Rust fixtures are the oracle: a disagreement is a C# bug. The v1 (disc) vector tests stay
    /// in PathfindingTests and LocalMotionTests, unchanged.
    /// </summary>
    public class HitboxPredictionTests
    {
        const double Tol = 1e-6;
        const double WalkTol = 0.01;

        static JsonDocument Read(string name)
        {
            return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", name)));
        }

        static MapBlob DecodeMap(JsonElement golden)
        {
            var reader = new Reader(Util.FromHex(golden.GetProperty("mapBlob").GetProperty("hex").GetString()));
            var map = MapBlob.ReadCollisionFixture(ref reader);
            reader.End();
            return map;
        }

        static Footprint FootOf(JsonElement f)
        {
            Assert.AreEqual("box", f.GetProperty("kind").GetString());
            return Footprint.Box(f.GetProperty("hx").GetDouble(), f.GetProperty("hy").GetDouble());
        }

        /// <summary>The Welcome table as the server's Rust source wrote it into archetypes_v1.json (never hand-copied).</summary>
        internal static WireArchetype[] TableFromFixture()
        {
            using var doc = Read("archetypes_v1.json");
            var rows = new List<WireArchetype>();
            foreach (var a in doc.RootElement.GetProperty("archetypes").EnumerateArray())
            {
                var h = a.GetProperty("hull");
                var row = new WireArchetype { Id = (byte)a.GetProperty("id").GetInt32(), Key = a.GetProperty("key").GetString(), Chest = (byte)a.GetProperty("chest").GetDouble() };
                if (h.GetProperty("kind").GetString() == "circle") { row.Hull = 0; row.R = (byte)h.GetProperty("r").GetDouble(); }
                else
                {
                    row.Hull = 1;
                    row.Fx = (byte)h.GetProperty("foot")[0].GetDouble(); row.Fy = (byte)h.GetProperty("foot")[1].GetDouble();
                    row.Bx = (byte)h.GetProperty("body")[0].GetDouble(); row.By = (byte)h.GetProperty("body")[1].GetDouble();
                    row.Ox = (sbyte)h.GetProperty("bodyOffset")[0].GetDouble(); row.Oy = (sbyte)h.GetProperty("bodyOffset")[1].GetDouble();
                }
                rows.Add(row);
            }
            return rows.ToArray();
        }

        [Test]
        public void AllThreeHundredBoxQueriesMatchTheRustWaypoints()
        {
            using var doc = Read("pathfinding_v2.json");
            var root = doc.RootElement;
            Assert.AreEqual("rh-pathfinding-golden/2", root.GetProperty("format").GetString());
            var foot = FootOf(root.GetProperty("footprint"));
            var map = DecodeMap(root);
            var pf = new Pathfinder();
            var queries = root.GetProperty("queries");
            Assert.AreEqual(300, queries.GetArrayLength());
            int waypoints = 0, bad = 0;
            double maxErr = 0;
            var notes = new List<string>();
            for (int q = 0; q < queries.GetArrayLength(); q++)
            {
                var from = queries[q].GetProperty("from"); var to = queries[q].GetProperty("to");
                var want = queries[q].GetProperty("path");
                var got = pf.FindPath(map, from[0].GetDouble(), from[1].GetDouble(), to[0].GetDouble(), to[1].GetDouble(), foot);
                bool ok = got.Length == want.GetArrayLength();
                if (ok)
                    for (int j = 0; j < got.Length; j++)
                    {
                        double dx = Math.Abs(got[j].X - want[j][0].GetDouble()), dy = Math.Abs(got[j].Y - want[j][1].GetDouble());
                        maxErr = Math.Max(maxErr, Math.Max(dx, dy)); waypoints++;
                        if (dx > Tol || dy > Tol) ok = false;
                    }
                if (!ok) { bad++; if (notes.Count < 10) notes.Add("query " + q + ": got " + got.Length + " waypoints, want " + want.GetArrayLength()); }
            }
            Assert.AreEqual(0, bad, string.Join("; ", notes));
            TestContext.Progress.WriteLine("pathfinding_v2: 300 queries, " + waypoints + " waypoints, max error " + maxErr.ToString("E3"));
            Assert.Greater(waypoints, 0);
        }

        [Test]
        public void TheBoxAndDiscFootprintsPlanDifferentlyOnTheSameMap()
        {
            // The v2 oracle only means something if the box changes plans: the same 300 queries with the 12 u disc must not all agree.
            using var doc = Read("pathfinding_v2.json");
            var map = DecodeMap(doc.RootElement);
            var pf = new Pathfinder();
            int differ = 0;
            foreach (var q in doc.RootElement.GetProperty("queries").EnumerateArray())
            {
                var from = q.GetProperty("from"); var to = q.GetProperty("to"); var want = q.GetProperty("path");
                var disc = pf.FindPath(map, from[0].GetDouble(), from[1].GetDouble(), to[0].GetDouble(), to[1].GetDouble());
                bool same = disc.Length == want.GetArrayLength();
                for (int j = 0; same && j < disc.Length; j++)
                    same = Math.Abs(disc[j].X - want[j][0].GetDouble()) < Tol && Math.Abs(disc[j].Y - want[j][1].GetDouble()) < Tol;
                if (!same) differ++;
            }
            Assert.Greater(differ, 0, "no query distinguishes the disc from the box");
        }

        static WireSelf Self(double x, double y, byte moveSeq, byte archetype)
        {
            return new WireSelf { Status = Wire.DefaultStatus, Id = 3, X = (float)x, Y = (float)y, MoveSeq = moveSeq, Hp = 10, MaxHp = 10, Archetype = archetype };
        }

        [Test]
        public void CornerWalksWithTheBoxFootMatchTheServerPerTickFixture()
        {
            using var walk = Read("server_walk_v2.json");
            using var paths = Read("pathfinding_v2.json");
            var root = walk.RootElement;
            Assert.AreEqual("rh-server-walk/2", root.GetProperty("format").GetString());
            var foot = FootOf(root.GetProperty("footprint"));
            byte archetype = (byte)root.GetProperty("archetype").GetInt32();
            var table = TableFromFixture();
            Assert.AreEqual(foot, Footprint.For(table, archetype), "the table row of the self archetype is the fixture's footprint");
            var map = DecodeMap(paths.RootElement);
            double maxError = 0;
            foreach (var one in root.GetProperty("cases").EnumerateArray())
            {
                var ticks = one.GetProperty("ticks");
                var motion = new LocalMotion(map) { Foot = Footprint.For(table, archetype) };
                var first = ticks[0];
                motion.OnSnapshot(Self(first.GetProperty("x").GetDouble(), first.GetProperty("y").GetDouble(), (byte)first.GetProperty("moveSeq").GetInt32(), archetype), 0.0);
                motion.Order((float)one.GetProperty("goal")[0].GetDouble(), (float)one.GetProperty("goal")[1].GetDouble(), 1, 0.0);
                for (int k = 1; k < ticks.GetArrayLength(); k++)
                {
                    double now = 50.0 * k;
                    motion.Step(now);
                    double sx = ticks[k].GetProperty("x").GetDouble(), sy = ticks[k].GetProperty("y").GetDouble();
                    motion.OnSnapshot(Self(sx, sy, (byte)ticks[k].GetProperty("moveSeq").GetInt32(), archetype), now);
                    double err = Math.Sqrt(Math.Pow(motion.DrawnX - sx, 2) + Math.Pow(motion.DrawnY - sy, 2));
                    maxError = Math.Max(maxError, err);
                    Assert.LessOrEqual(err, WalkTol, one.GetProperty("name").GetString() + " tick " + k);
                }
                Assert.AreEqual(0, motion.Snaps, one.GetProperty("name").GetString() + ": no snap");
                Assert.AreEqual(0, motion.ExpiredOrders);
            }
            TestContext.Progress.WriteLine("server_walk_v2: max |drawn - server| " + maxError.ToString("E3") + " u");
        }

        [Test]
        public void FootprintSelectionFollowsTheTableAndFallsBackToTheLegacyDisc()
        {
            var table = TableFromFixture();
            Assert.AreEqual(Footprint.Disc(12), Footprint.For(table, 0), "legacy row is the 12 u disc");
            Assert.AreEqual(Footprint.Disc(12), Footprint.For(null, 1), "no table: the 12 u disc");
            Assert.AreEqual(Footprint.Disc(12), Footprint.For(Array.Empty<WireArchetype>(), 1), "empty table: the 12 u disc");
            Assert.AreEqual(Footprint.Disc(12), Footprint.For(table, 250), "unknown id: the 12 u disc");
            var hero = WireArchetype.Find(table, 1);
            Assert.AreEqual(Footprint.Box(hero.Fx, hero.Fy), Footprint.For(table, 1));
            Assert.IsTrue(Footprint.For(table, 1).IsBox);
            Assert.AreEqual(Pathfinder.PlayerRadius, Footprint.LegacyRadius);
        }

        [Test]
        public void ALegacyOrTablelessLocalMotionPlansExactlyTheDiscPath()
        {
            using var doc = Read("pathfinding_v1.json");
            var map = DecodeMap(doc.RootElement);
            var pf = new Pathfinder();
            int n = 0;
            foreach (var q in doc.RootElement.GetProperty("queries").EnumerateArray())
            {
                if (n++ % 15 != 0) continue;
                var from = q.GetProperty("from"); var to = q.GetProperty("to");
                var viaFoot = pf.FindPath(map, from[0].GetDouble(), from[1].GetDouble(), to[0].GetDouble(), to[1].GetDouble(), Footprint.Legacy);
                var viaOld = pf.FindPath(map, from[0].GetDouble(), from[1].GetDouble(), to[0].GetDouble(), to[1].GetDouble());
                Assert.AreEqual(viaOld.Length, viaFoot.Length);
                for (int j = 0; j < viaOld.Length; j++) { Assert.AreEqual(viaOld[j].X, viaFoot[j].X); Assert.AreEqual(viaOld[j].Y, viaFoot[j].Y); }
            }
            Assert.AreEqual(Footprint.Legacy, new LocalMotion(map).Foot);
        }

        [Test]
        public void BoxClearTouchesAWallFaceAndKeepsKeyboardSteerOnTheSameFoot()
        {
            // A 5x5 map: a wall column at tile x = 3. A box (10, 6) standing 10 u west of the face touches it and is clear; 9 u is not.
            var tiles = new byte[25];
            for (int y = 0; y < 5; y++) tiles[y * 5 + 3] = MapBlob.Wall;
            var map = new MapBlob(5, 5, tiles);
            var pf = new Pathfinder();
            var box = Footprint.Box(10, 6);
            Assert.IsTrue(pf.Clear(map, 3 * 32 - 10, 80, box), "touching the face is clear");
            Assert.IsFalse(pf.Clear(map, 3 * 32 - 9.5, 80, box));
            Assert.IsFalse(pf.Clear(map, 3 * 32 - 11.5, 80, Footprint.Disc(12)), "the 12 u disc stops earlier");
            Assert.IsTrue(pf.Clear(map, 3 * 32 - 11.5, 80, box), "the box still fits where the disc cannot");
            // Walking south toward a wall row: the box foot reaches within hy = 6 of the south wall, the disc within 12.
            var rows = new byte[25];
            for (int x = 0; x < 5; x++) rows[3 * 5 + x] = MapBlob.Wall;
            var south = new MapBlob(5, 5, rows);
            Assert.IsTrue(pf.Clear(south, 80, 3 * 32 - 6, box));
            Assert.IsFalse(pf.Clear(south, 80, 3 * 32 - 6, Footprint.Disc(12)));
            // KeyboardSteer picks a goal that is clear for the SAME foot it is given.
            Assert.IsTrue(KeyboardSteer.TryGoal(pf, south, 80, 3 * 32 - 24, 0, 1, box, out _, out double gy));
            Assert.Greater(gy, 3 * 32 - 24 + 1e-9);
            Assert.Less(gy, 3 * 32 - 6, "the silhouette ray at the leading edge stops short of the face, as in Rust");
            Assert.IsTrue(pf.SegmentClear(south, 80, 3 * 32 - 24, 80, gy, box));
        }
    }
}

using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-AUG-NATIVE-3c: the local walk prediction of a Pathfinder holder. The server walks a holder at its folded speed times
    /// (1 + the card's share) and now publishes that speed in the owner block (<c>speed_milli</c>); the client's prediction,
    /// unchanged, reads it. <c>protocol/fixtures/pathfinder_walk_v1.json</c> is the Rust server's walk of the three
    /// server_walk_v2 corner walks with the walker holding Pathfinder (written by
    /// <c>rh-sim cards::native::walk_mirror_tests::pathfinder_walk_v1_is_the_current_server</c>, never by hand). The Rust
    /// fixture is the oracle: a disagreement is a C# bug or a server that does not publish its own speed.
    /// </summary>
    public class PathfinderWalkPredictionTests
    {
        /// <summary>The corner-walk tolerance of <see cref="HitboxPredictionTests"/> (drawn vs server, per tick).</summary>
        const double WalkTol = 0.01;

        static JsonDocument Read(string name)
        {
            string path = Path.Combine(Util.RepoRoot(), "protocol", "fixtures", name);
            Assert.IsTrue(File.Exists(path), name + " is missing: the Rust generator writes it (RH_WRITE_FIXTURES=1)");
            return JsonDocument.Parse(File.ReadAllText(path));
        }

        static MapBlob DecodeMap(JsonElement golden)
        {
            var reader = new Reader(Util.FromHex(golden.GetProperty("mapBlob").GetProperty("hex").GetString()));
            var map = MapBlob.ReadCollisionFixture(ref reader);
            reader.End();
            return map;
        }

        static WireSelf Self(double x, double y, byte moveSeq, byte archetype)
        {
            return new WireSelf { Status = Wire.DefaultStatus, Id = 3, X = (float)x, Y = (float)y, MoveSeq = moveSeq, Hp = 10, MaxHp = 10, Archetype = archetype };
        }

        /// <summary>Replays one case; <paramref name="useOwnerBlock"/> false feeds no owner block (base speed). Returns the
        /// largest per-tick |drawn - server| and the snaps.</summary>
        static (double maxErr, int snaps, int expired) Replay(JsonElement one, MapBlob map, WireArchetype[] table, byte archetype, bool useOwnerBlock)
        {
            var ticks = one.GetProperty("ticks");
            var motion = new LocalMotion(map) { Foot = Footprint.For(table, archetype) };
            var first = ticks[0];
            double? Milli(JsonElement row) => useOwnerBlock ? row.GetProperty("speedMilli").GetDouble() : (double?)null;
            motion.OnSnapshot(Self(first.GetProperty("x").GetDouble(), first.GetProperty("y").GetDouble(), (byte)first.GetProperty("moveSeq").GetInt32(), archetype), 0.0, null, null, Milli(first));
            motion.Order((float)one.GetProperty("goal")[0].GetDouble(), (float)one.GetProperty("goal")[1].GetDouble(), 1, 0.0);
            double maxErr = 0;
            for (int k = 1; k < ticks.GetArrayLength(); k++)
            {
                double now = 50.0 * k;
                motion.Step(now);
                double sx = ticks[k].GetProperty("x").GetDouble(), sy = ticks[k].GetProperty("y").GetDouble();
                motion.OnSnapshot(Self(sx, sy, (byte)ticks[k].GetProperty("moveSeq").GetInt32(), archetype), now, null, null, Milli(ticks[k]));
                double err = Math.Sqrt(Math.Pow(motion.DrawnX - sx, 2) + Math.Pow(motion.DrawnY - sy, 2));
                maxErr = Math.Max(maxErr, err);
            }
            return (maxErr, motion.Snaps, motion.ExpiredOrders);
        }

        [Test]
        public void APathfinderHoldersWalkIsPredictedFromTheOwnerBlockWithinTheCornerWalkTolerance()
        {
            using var walk = Read("pathfinder_walk_v1.json");
            using var paths = Read("pathfinding_v2.json");
            var root = walk.RootElement;
            Assert.AreEqual("rh-pathfinder-walk/1", root.GetProperty("format").GetString());
            byte archetype = (byte)root.GetProperty("archetype").GetInt32();
            var table = HitboxPredictionTests.TableFromFixture();
            var f = root.GetProperty("footprint");
            Assert.AreEqual(Footprint.Box(f.GetProperty("hx").GetDouble(), f.GetProperty("hy").GetDouble()), Footprint.For(table, archetype));
            var map = DecodeMap(paths.RootElement);
            int cases = 0;
            foreach (var one in root.GetProperty("cases").EnumerateArray())
            {
                string name = one.GetProperty("name").GetString() + " @" + one.GetProperty("counter").GetDouble();
                double counter = one.GetProperty("counter").GetDouble();
                Assert.Greater(counter, 0.0, name + ": a holder with a share");
                foreach (var row in one.GetProperty("ticks").EnumerateArray())
                    Assert.AreEqual(Math.Round(1000.0 * (1.0 + counter)), row.GetProperty("speedMilli").GetDouble(), name + " tick " + row.GetProperty("tick").GetInt32() + ": the owner block carries the share");
                var (err, snaps, expired) = Replay(one, map, table, archetype, true);
                TestContext.Progress.WriteLine("pathfinder_walk_v1 " + name + ": max |drawn - server| " + err.ToString("E3") + " u");
                Assert.LessOrEqual(err, WalkTol, name + ": predicted from the owner block");
                Assert.AreEqual(0, snaps, name + ": no snap");
                Assert.AreEqual(0, expired, name);
                // The share matters: predicting at base speed (no owner block) falls behind the server past the tolerance.
                var (baseErr, _, _) = Replay(one, map, table, archetype, false);
                Assert.Greater(baseErr, 10 * WalkTol, name + ": a base-speed prediction would be corrected");
                cases++;
            }
            Assert.GreaterOrEqual(cases, 4, "three corners at 0.24 and one at 0.12");
        }
    }
}

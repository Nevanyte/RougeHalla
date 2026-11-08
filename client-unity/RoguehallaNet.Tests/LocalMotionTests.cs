using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-NET-1 Phase 2: the local walk predictor and its reconciliation gates. <c>protocol/fixtures/server_walk_v1.json</c> was
    /// generated from the real <c>rh-sim</c> (seed-1 map, one <c>Move{seq=1}</c>, 20 Hz) for three corner queries of the Phase 1
    /// oracle; the acceptance test feeds the same order at the same clock and compares every predicted step with the server.
    /// </summary>
    public class LocalMotionTests
    {
        const double Tick = 50.0;
        /// <summary>Acceptance tolerance for the corner-walk fixture: wire x/y are <c>float</c> (about 1e-4 u at these coordinates).</summary>
        const double CornerTolerance = 0.01;
        const double Speed = 170.0;

        static JsonDocument ReadJson(string name)
        {
            return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", name)));
        }

        /// <summary>The seed-1 map exactly as the client decodes it (canonical MapBlob wire bytes; the client never builds maps).</summary>
        static MapBlob SeedMap(JsonElement pathfindingGolden)
        {
            var blob = pathfindingGolden.GetProperty("mapBlob");
            byte[] bytes = Util.FromHex(blob.GetProperty("hex").GetString());
            var reader = new Reader(bytes);
            var map = MapBlob.Read(ref reader);
            reader.End();
            Assert.AreEqual(160, (int)map.W);
            Assert.AreEqual(160, (int)map.H);
            return map;
        }

        static MapBlob FloorMap(ushort w, ushort h) { return new MapBlob(w, h, new byte[w * h]); }

        static WireSelf Self(double x, double y, byte moveSeq = 0)
        {
            return new WireSelf { Status = Wire.DefaultStatus, Id = 3, X = (float)x, Y = (float)y, MoveSeq = moveSeq, Hp = 10, MaxHp = 10 };
        }

        static double Dist(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx, dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static double PerpDistance(double px, double py, double ax, double ay, double bx, double by)
        {
            double vx = bx - ax, vy = by - ay;
            double len = Math.Sqrt(vx * vx + vy * vy);
            return Math.Abs(vx * (py - ay) - vy * (px - ax)) / len;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Acceptance: the predicted walk against the committed Rust per-tick fixture

        [Test]
        public void CornerWalksMatchTheServerPerTickFixture()
        {
            using (var walk = ReadJson("server_walk_v1.json"))
            using (var paths = ReadJson("pathfinding_v1.json"))
            {
                var root = walk.RootElement;
                Assert.AreEqual("rh-server-walk/1", root.GetProperty("format").GetString());
                Assert.AreEqual(3, root.GetProperty("cases").GetArrayLength());
                Assert.AreEqual(170.0, root.GetProperty("playerSpeed").GetDouble());
                Assert.AreEqual(50.0, root.GetProperty("tickMs").GetDouble());
                var map = SeedMap(paths.RootElement);
                var cases = root.GetProperty("cases");
                double maxError = 0.0;
                double maxPerp = 0.0;

                for (int c = 0; c < cases.GetArrayLength(); c++)
                {
                    var one = cases[c];
                    var ticks = one.GetProperty("ticks");
                    Assert.AreEqual(241, ticks.GetArrayLength(), one.GetProperty("name").GetString() + " is 240 ticks plus the pre-order sample");

                    var motion = new LocalMotion(map);
                    double t0 = 0.0;
                    double caseMax = 0.0;
                    var first = ticks[0];
                    motion.OnSnapshot(Self(first.GetProperty("x").GetDouble(), first.GetProperty("y").GetDouble(),
                        (byte)first.GetProperty("moveSeq").GetInt32()), t0);

                    double goalX = one.GetProperty("goal")[0].GetDouble();
                    double goalY = one.GetProperty("goal")[1].GetDouble();
                    motion.Order((float)goalX, (float)goalY, 1, t0);
                    Assert.IsTrue(motion.OrderPending, one.GetProperty("name").GetString() + ": order pending before the echo");

                    for (int k = 1; k < ticks.GetArrayLength(); k++)
                    {
                        double now = t0 + Tick * k;
                        motion.Step(now);
                        var tick = ticks[k];
                        double serverX = tick.GetProperty("x").GetDouble();
                        double serverY = tick.GetProperty("y").GetDouble();
                        motion.OnSnapshot(Self(serverX, serverY, (byte)tick.GetProperty("moveSeq").GetInt32()), now);

                        double err = Dist(motion.DrawnX, motion.DrawnY, serverX, serverY);
                        if (err > caseMax) caseMax = err;
                        if (err > maxError) maxError = err;
                        maxPerp = Math.Max(maxPerp, PerpDistance(motion.DrawnX, motion.DrawnY,
                            first.GetProperty("x").GetDouble(), first.GetProperty("y").GetDouble(), goalX, goalY));
                        if (err > CornerTolerance)
                            Assert.Fail(one.GetProperty("name").GetString() + " tick " + k + " drew (" + motion.DrawnX + ", "
                                + motion.DrawnY + "), server (" + serverX + ", " + serverY + "), error " + err
                                + " > " + CornerTolerance);
                    }

                    Assert.AreEqual(0, motion.Snaps, one.GetProperty("name").GetString() + ": no snap");
                    Assert.AreEqual(0, motion.ExpiredOrders, one.GetProperty("name").GetString() + ": no expired order");
                    Assert.AreEqual(0, motion.ConsecutiveOutOfToleranceSamples, one.GetProperty("name").GetString() + ": no divergence");
                    Assert.IsFalse(motion.OrderPending, one.GetProperty("name").GetString() + ": move_seq 1 acknowledged the order");
                    Assert.LessOrEqual(Dist(motion.DrawnX, motion.DrawnY, goalX, goalY), CornerTolerance,
                        one.GetProperty("name").GetString() + ": the walk reaches the goal");
                    TestContext.Progress.WriteLine(one.GetProperty("name").GetString() + " max error "
                        + caseMax.ToString("E3") + " u");
                }

                Assert.LessOrEqual(maxError, CornerTolerance,
                    "max |drawn - server| over all 720 compared ticks is " + maxError.ToString("R"));
                // The straight line from start to goal is a chord; these paths detour around walls. If the predictor walked a
                // straight line (or the last velocity) instead of the Phase 1 A* path, the drawn trace could not deviate this far
                // from the chord: the fixture paths themselves are 395-651 u long for 169-240 u chords.
                Assert.Greater(maxPerp, 50.0, "the predicted walk follows the A* corner path, not the straight line");
                TestContext.Progress.WriteLine("corner-walk max error " + maxError.ToString("E3") + " u, max chord deviation "
                    + maxPerp.ToString("F1") + " u (tolerance " + CornerTolerance + ")");
            }
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Prediction is real: it advances without new snapshots and without any extra uplink

        [Test]
        public void PredictionAdvancesWhileSnapshotsAreWithheld()
        {
            var motion = new LocalMotion(FloorMap(16, 16));
            motion.OnSnapshot(Self(100, 100), 0);
            motion.Order(400, 100, 1, 0);

            const int ticks = 15;
            for (int k = 1; k <= ticks; k++)
            {
                motion.Step(Tick * k);
                Assert.AreEqual(100 + Speed * (Tick * k / 1000.0), motion.DrawnX, 1e-3, "tick " + k);
                Assert.AreEqual(Speed * (Tick * k / 1000.0), motion.DrawnX - motion.SimX, 1e-3,
                    "the drawn walk leads the last accepted sim");
            }

            Assert.AreEqual(100, motion.SimX, 1e-6, "no snapshot was accepted, so sim is still the start");
            Assert.AreEqual(100 + Speed * (ticks * Tick / 1000.0), motion.DrawnX, 1e-3);
            Assert.IsTrue(motion.OrderPending, "the order is still unacknowledged");
            Assert.AreEqual(0, motion.Snaps);
            Assert.AreEqual(0, motion.ExpiredOrders);
            Assert.AreEqual(0, motion.ConsecutiveOutOfToleranceSamples);
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Gates: 100 ms fade, 96 u snap, 1 s expiry, move_seq echo, sequence semantics, AttackTime

        [Test]
        public void SmallErrorsFadeWithATauOfOneHundredMilliseconds()
        {
            var motion = new LocalMotion(FloorMap(4, 4));
            motion.OnSnapshot(Self(0, 0), 0);
            // A 20 u accepted-sample error while idle: the model moves to the server, the drawn position stays put.
            motion.OnSnapshot(Self(20, 0), 0);
            Assert.AreEqual(0, motion.DrawnX, 1e-3, "a small correction is not shown as a teleport");
            Assert.AreEqual(-20, motion.VisualX, 1e-3, "the error is the visual offset");
            Assert.AreEqual(motion.SimX + motion.VisualX, motion.DrawnX, 1e-4, "drawn = sim + visual");
            Assert.AreEqual(0, motion.Snaps, "20 u is under the snap distance");

            motion.Step(100);
            double expected = -20.0 / Math.E;
            Assert.AreEqual(expected, motion.VisualX, 1e-3, "after one tau the offset is 1/e of the error");
            Assert.AreEqual(20.0 + expected, motion.DrawnX, 1e-3);
            Assert.AreEqual(1, motion.ConsecutiveOutOfToleranceSamples, "20 u is past the 6 u divergence threshold");
        }

        [Test]
        public void ErrorsAbove96UnitsSnapAndSmallerOnesDoNot()
        {
            var under = new LocalMotion(FloorMap(16, 16));
            under.OnSnapshot(Self(0, 0), 0);
            under.OnSnapshot(Self(95, 0), 0);
            Assert.AreEqual(0, under.Snaps, "95 u is absorbed, not snapped");
            Assert.AreEqual(0, under.DrawnX, 1e-3);
            Assert.AreEqual(95, under.SimX, 1e-3);

            var over = new LocalMotion(FloorMap(16, 16));
            over.OnSnapshot(Self(0, 0), 0);
            over.OnSnapshot(Self(97, 0), 0);
            Assert.AreEqual(1, over.Snaps, "97 u snaps");
            Assert.AreEqual(0, over.VisualX, 1e-6, "a snap clears the visual offset");
            Assert.AreEqual(97, over.DrawnX, 1e-3, "the server position is shown at once");
            Assert.AreEqual(0, over.ConsecutiveOutOfToleranceSamples, "the snap is not carried as a divergence");
        }

        [Test]
        public void SnapReplansTheRemainingWalkFromTheServerPosition()
        {
            using (var paths = ReadJson("pathfinding_v1.json"))
            using (var walk = ReadJson("server_walk_v1.json"))
            {
                var map = SeedMap(paths.RootElement);
                var cases = walk.RootElement.GetProperty("cases");
                var a = cases[0];
                var b = cases[1];
                double goalX = a.GetProperty("goal")[0].GetDouble();
                double goalY = a.GetProperty("goal")[1].GetDouble();
                double snapX = b.GetProperty("start")[0].GetDouble();
                double snapY = b.GetProperty("start")[1].GetDouble();

                var motion = new LocalMotion(map);
                motion.OnSnapshot(Self(a.GetProperty("start")[0].GetDouble(), a.GetProperty("start")[1].GetDouble()), 0);
                motion.Order((float)goalX, (float)goalY, 1, 0);
                motion.OnSnapshot(Self(a.GetProperty("start")[0].GetDouble(), a.GetProperty("start")[1].GetDouble(), 1), 0);
                Assert.IsFalse(motion.OrderPending);
                motion.Step(50);
                Assert.Greater(Dist(motion.DrawnX, motion.DrawnY, snapX, snapY), 96, "the snap target is far enough");

                motion.OnSnapshot(Self(snapX, snapY, 1), 50);
                Assert.AreEqual(1, motion.Snaps);
                Assert.AreEqual(0, motion.VisualX, 1e-6);
                Assert.AreEqual((float)snapX, motion.DrawnX, 1e-6, "the server position is shown");
                Assert.AreEqual((float)snapY, motion.DrawnY, 1e-6);

                // The next step must follow a path planned from the snap point, not the old corner path.
                var planned = new Pathfinder().FindPath(map, (double)(float)snapX, (double)(float)snapY,
                    (double)(float)goalX, (double)(float)goalY);
                Assert.Greater(planned.Length, 0, "the goal is reachable from the snap point");
                double dx = planned[0].X - (double)(float)snapX;
                double dy = planned[0].Y - (double)(float)snapY;
                double dist = Math.Sqrt(dx * dx + dy * dy);
                double budget = Speed * 0.05;
                double wantX = dist <= budget ? planned[0].X : (double)(float)snapX + dx / dist * budget;
                double wantY = dist <= budget ? planned[0].Y : (double)(float)snapY + dy / dist * budget;
                motion.Step(100);
                Assert.AreEqual(wantX, motion.DrawnX, 1e-3, "walking the replanned waypoint x");
                Assert.AreEqual(wantY, motion.DrawnY, 1e-3, "walking the replanned waypoint y");
            }
        }

        [Test]
        public void AnOrderNotEchoedWithinOneSecondIsForgottenAndTheNextSampleCorrectsIt()
        {
            var motion = new LocalMotion(FloorMap(16, 16));
            motion.OnSnapshot(Self(100, 100), 0);
            motion.Order(400, 100, 1, 0);
            Assert.IsTrue(motion.OrderPending);

            for (int k = 1; k <= 19; k++)
            {
                motion.Step(Tick * k);
                Assert.IsTrue(motion.OrderPending, "still pending at " + (Tick * k) + " ms");
            }
            Assert.AreEqual(0, motion.ExpiredOrders);
            Assert.AreEqual(100 + Speed * (19 * Tick / 1000.0), motion.DrawnX, 1e-3);

            // Exactly one second: the order is forgotten; the predicted walk continues along its path (documented in the type).
            motion.Step(1000);
            Assert.IsFalse(motion.OrderPending, "1 s without an echo forgets the order");
            Assert.AreEqual(1, motion.ExpiredOrders);
            Assert.AreEqual(100 + Speed, motion.DrawnX, 1e-3, "the walk continues past the forgotten order");
            Assert.AreEqual(100, motion.SimX, 1e-6);

            // The server never moved: the next sample is 170 u away and snaps the prediction back.
            motion.OnSnapshot(Self(100, 100, 0), 1000);
            Assert.AreEqual(1, motion.Snaps);
            Assert.AreEqual(100, motion.DrawnX, 1e-3);
            Assert.AreEqual(0, motion.ConsecutiveOutOfToleranceSamples);

            // A late echo of the forgotten order does not resurrect a pending order.
            motion.OnSnapshot(Self(100, 100, 1), 1050);
            Assert.IsFalse(motion.OrderPending);
            Assert.AreEqual(108.5, motion.DrawnX, 1e-3, "elapsed time is advanced before the late sample; its echo does not create a new order");

            // At the exact boundary the echo is checked first: the sample acknowledged the order, so nothing expired.
            var boundary = new LocalMotion(FloorMap(16, 16));
            boundary.OnSnapshot(Self(100, 100), 0);
            boundary.Order(400, 100, 5, 0);
            boundary.OnSnapshot(Self(108.5, 100, 5), 1000);
            Assert.IsFalse(boundary.OrderPending, "the boundary sample echoes order 5");
            Assert.AreEqual(0, boundary.ExpiredOrders, "an acknowledged boundary sample is not an expiry");
        }

        [Test]
        public void TheMoveSeqEchoMustMatchAndZeroIsNeverAnOrder()
        {
            var motion = new LocalMotion(FloorMap(16, 16));
            motion.OnSnapshot(Self(100, 100), 0);
            motion.Order(400, 100, 7, 0);
            Assert.IsTrue(motion.OrderPending);
            motion.Step(50);

            motion.OnSnapshot(Self(108.5, 100, 0), 50);
            Assert.IsTrue(motion.OrderPending, "move_seq 0 means no order yet");
            motion.OnSnapshot(Self(108.5, 100, 6), 50);
            Assert.IsTrue(motion.OrderPending, "a different sequence does not acknowledge order 7");
            motion.OnSnapshot(Self(108.5, 100, 7), 50);
            Assert.IsFalse(motion.OrderPending, "the matching sequence clears pending");

            motion.Order(400, 400, 0, 60);
            Assert.IsFalse(motion.OrderPending, "sequence 0 is not an order");

            // A stop has the same sequence gate.
            double before = motion.DrawnX;
            motion.StopOrder(9, 100);
            Assert.IsTrue(motion.OrderPending);
            motion.Step(150);
            Assert.AreEqual(before, motion.DrawnX, 1e-3, "a stop clears the predicted path immediately");
            motion.OnSnapshot(Self(108.5, 100, 8), 150);
            Assert.IsTrue(motion.OrderPending);
            motion.OnSnapshot(Self(108.5, 100, 9), 150);
            Assert.IsFalse(motion.OrderPending);
        }

        [Test]
        public void ZeroSequenceOrderDoesNothing()
        {
            var motion = new LocalMotion(FloorMap(4, 4));
            motion.OnSnapshot(Self(10, 10), 0);
            motion.Order(100, 10, 0, 0);
            Assert.IsFalse(motion.OrderPending);
            motion.Step(100);
            Assert.AreEqual(10, motion.DrawnX, 1e-6);
        }

        [Test]
        public void BeforeTheFirstSnapshotThereIsNoPositionToPredictFrom()
        {
            var motion = new LocalMotion(FloorMap(16, 16));
            motion.Order(400, 100, 1, 0); // ordered before the first self sample: nothing is initialized yet
            Assert.IsFalse(motion.Initialized);
            motion.Step(100);
            Assert.AreEqual(0, motion.DrawnX, 1e-6, "no presentation before the first accepted self sample");
            Assert.IsTrue(motion.OrderPending);

            motion.OnSnapshot(Self(100, 100), 100);
            Assert.IsTrue(motion.Initialized);
            Assert.AreEqual(100, motion.DrawnX, 1e-3);
            Assert.IsTrue(motion.OrderPending, "the order survives the first sample");
            motion.Step(150);
            Assert.AreEqual(108.5, motion.DrawnX, 1e-3, "the held order walks from the first known position");
        }

        [Test]
        public void AttackTimeIsTheRenderTimeInThisPacket()
        {
            // No draw-ahead in P-NET-1 Phase 2: MatchClient's attack/release t stays the render time. P-NET-2 may change the
            // body of AttackTime; this test then changes with it, which is the point of the hook.
            Assert.AreEqual(1234.5, LocalMotion.AttackTime(1234.5), 0.0);
            Assert.AreEqual(0.0, LocalMotion.AttackTime(0.0), 0.0);
            Assert.AreEqual(-50.0, LocalMotion.AttackTime(-50.0), 0.0);
            Assert.AreEqual(1.0, LocalMotion.SpeedModifier(9999.0), 0.0, "this packet predicts the base walk speed only");
        }

        // ----------------------------------------------------------------------------------------------------------------
        // No extra uplink from the predictor

        [Test]
        public void EveryCornerVectorStillMatchesWithoutAnyLaterSnapshotCorrection()
        {
            using (var walk = ReadJson("server_walk_v1.json"))
            using (var paths = ReadJson("pathfinding_v1.json"))
            {
                foreach (var one in walk.RootElement.GetProperty("cases").EnumerateArray())
                {
                    var ticks = one.GetProperty("ticks");
                    var first = ticks[0];
                    var motion = new LocalMotion(SeedMap(paths.RootElement));
                    motion.OnSnapshot(Self(first.GetProperty("x").GetDouble(), first.GetProperty("y").GetDouble()), 0);
                    motion.Order((float)one.GetProperty("goal")[0].GetDouble(), (float)one.GetProperty("goal")[1].GetDouble(), 1, 0);
                    for (int k = 1; k < ticks.GetArrayLength(); k++)
                    {
                        motion.Step(k * Tick);
                        Assert.LessOrEqual(Dist(motion.DrawnX, motion.DrawnY, ticks[k].GetProperty("x").GetDouble(), ticks[k].GetProperty("y").GetDouble()), CornerTolerance, "uncorrected " + one.GetProperty("name").GetString() + " tick " + k);
                    }
                }
            }
        }

        [Test]
        public void HardDisplacementAndDeathOverrideAnUnacknowledgedOrder()
        {
            var motion = new LocalMotion(FloorMap(32, 32));
            motion.OnSnapshot(Self(100, 100), 0);
            motion.Order(600, 100, 1, 0);
            motion.Step(50);
            var cut = Self(500, 500); cut.DisplaceSeq = 1;
            motion.OnSnapshot(cut, 50);
            Assert.IsFalse(motion.OrderPending);
            Assert.AreEqual(500, motion.DrawnX);
            Assert.AreEqual(500, motion.DrawnY);
            motion.Step(100);
            Assert.AreEqual(500, motion.DrawnX, "the obsolete goal is gone");
            motion.Order(600, 500, 2, 100);
            var dead = Self(500, 500); dead.DisplaceSeq = 1; dead.Status = 2;
            motion.OnSnapshot(dead, 150);
            motion.Step(200);
            Assert.AreEqual(500, motion.DrawnX, "an authoritative dead actor never keeps walking");
            motion.Order(600, 500, 3, 200);
            Assert.IsFalse(motion.OrderPending, "drawing a refused/dead order is not prediction");
            var revive = Self(510, 500); revive.DisplaceSeq = 1;
            motion.OnSnapshot(revive, 250);
            motion.Step(300);
            Assert.AreEqual(510, motion.DrawnX, "revival does not resurrect a pre-death path");
        }

        [Test]
        public void CoalescedSamplesCannotAccumulateAnUnboundedVisualCorrection()
        {
            var motion = new LocalMotion(FloorMap(32, 32));
            motion.OnSnapshot(Self(100, 100), 0);
            motion.OnSnapshot(Self(195, 100), 0);
            motion.OnSnapshot(Self(290, 100), 0);
            Assert.AreEqual(1, motion.Snaps, "the composed 190u correction exceeds the 96u cap");
            Assert.AreEqual(290, motion.DrawnX);
            Assert.AreEqual(0, motion.VisualX);
        }

        [Test]
        public void ExplicitCollisionReplacementInvalidatesCachedNavigationAndTheOldWalk()
        {
            var map = FloorMap(12, 6);
            var motion = new LocalMotion(map);
            motion.OnSnapshot(Self(48, 80), 0);
            motion.Order(304, 80, 1, 0);
            motion.Step(50);
            Assert.Greater(motion.DrawnX, 48);
            for (int y = 0; y < map.H; y++) map.Tiles[y * map.W + 5] = MapBlob.Wall;
            motion.SetCollisionMap(map); // the actual public geometry changed in place
            motion.Order(304, 80, 2, 50);
            motion.Step(100);
            Assert.AreEqual(48, motion.DrawnX, "the new map disconnects the goal; no cached route crosses the wall");
            motion.SuspendPrediction();
            motion.Order(80, 80, 3, 100);
            motion.Step(150);
            Assert.AreEqual(48, motion.DrawnX, "unknown geometry falls back to authoritative self");
        }

        static int InputFrames(FakeTransport t)
        {
            int n = 0;
            foreach (var frame in t.Sent) if (ClientMsg.Decode(frame) is ClientMsg.Input) n++;
            return n;
        }

        static int InputCommands(FakeTransport t)
        {
            int n = 0;
            foreach (var frame in t.Sent)
            {
                var input = ClientMsg.Decode(frame) as ClientMsg.Input;
                if (input != null) n += input.Commands.Count;
            }
            return n;
        }

        [Test]
        public void PredictedFramesNeverSendMoreInput()
        {
            double now = 1000;
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Now = () => now });
            s.Connect();
            t.Open();
            t.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3, Session = new byte[16],
                TickRate = 20, Tick = 1, ServerMs = 50, Map = FloorMap(16, 16),
            });
            t.Deliver(new ServerMsg.Snapshot { Tick = 2, Me = Self(100, 100) });
            s.OrderMove(400, 100);
            s.Update(); // flush the one Move the player asked for
            Assert.AreEqual(1, InputFrames(t));
            Assert.AreEqual(1, InputCommands(t));

            float x = 100f;
            for (int k = 1; k <= 30; k++)
            {
                now += 50;
                s.Update(); // Motion.Step runs here, exactly as in a real frame loop
                x += 8.5f;
                t.Deliver(new ServerMsg.Snapshot { Tick = (uint)(2 + k), Me = Self(x, 100, 1) });
            }

            Assert.AreEqual(1, InputFrames(t), "prediction produced no extra Input frame");
            Assert.AreEqual(1, InputCommands(t), "prediction produced no extra order");
            var only = ClientMsg.Decode(t.Sent[t.Sent.Count - 1]);
            // The last sent frame may be a Ping (1 s interval); the single Input frame is the one checked above.
            Assert.IsTrue(only is ClientMsg.Ping || only is ClientMsg.Input);
            Assert.Greater(s.Motion.DrawnX, s.Motion.SimX - 0.01, "the prediction advanced");
        }
    }
}

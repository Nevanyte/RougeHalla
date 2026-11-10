using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Local walk prediction under simulated latency, through the real <see cref="Session"/> poll order (frames at 120 Hz:
    /// snapshots, then the frame step, then input flush). The other prediction tests feed every sample at zero latency with an
    /// instant echo; these deliver each server tick <c>uplink + tick phase + downlink</c> late, with the source clock on another
    /// base than the local one, and check that a correct prediction keeps its lead instead of being pulled back by a round trip.
    /// </summary>
    public class PredictionLatencyTests
    {
        const double Tick = 50.0;
        const double Frame = 1000.0 / 120.0;
        /// <summary>The source clock runs on another base than the local clock: reconciliation must not need them equal.</summary>
        const double ServerClockOffset = 7000.0;
        /// <summary>The zero-latency acceptance tolerance (wire floats): delay alignment leaves no round-trip error at all.</summary>
        const double LeadTolerance = 0.01;
        const double TickWalk = 170.0 * Tick / 1000.0;

        sealed class QueuedTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            readonly Queue<byte[]> incoming = new Queue<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (incoming.Count != 0) Received(incoming.Dequeue()); }
            public void Open() { Opened(); }
            public void Enqueue(ServerMsg msg) { incoming.Enqueue(msg.Encode()); }
        }

        static WireSelf Self(double x, double y, byte seq = 0)
        {
            return new WireSelf { Id = 3, X = (float)x, Y = (float)y, Hp = 10, MaxHp = 10, Status = 1, MoveSeq = seq };
        }

        static Session Start(QueuedTransport t, MapBlob map, Func<double> now, WireSelf self)
        {
            var s = new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Now = now });
            s.Connect(); t.Open();
            t.Enqueue(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3, Session = new byte[16], TickRate = 20, Tick = SourceTick(0), ServerMs = ServerClockOffset, Map = map });
            t.Enqueue(new ServerMsg.Snapshot { Tick = SourceTick(0), Phase = 1, Me = self });
            s.Poll();
            return s;
        }

        /// <summary>The source tick at local-equivalent time <paramref name="ms"/>; its ServerMs is <c>ServerClockOffset + ms</c>.</summary>
        static uint SourceTick(double ms) { return (uint)Math.Round((ServerClockOffset + ms) / Tick); }

        static double CeilTick(double ms) { return Math.Ceiling(ms / Tick - 1e-9) * Tick; }

        static double Dist(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx, dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        // ----------------------------------------------------------------------------------------------------------------
        // The Rust corner walks (server_walk_v1), delivered late

        [TestCase(25.0, 25.0)]
        [TestCase(50.0, 50.0)]
        [TestCase(75.0, 75.0)]
        public void RustCornerWalksKeepTheirLeadUnderLatency(double uplink, double downlink)
        {
            using var paths = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/pathfinding_v1.json")));
            using var walk = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/server_walk_v1.json")));
            foreach (var one in walk.RootElement.GetProperty("cases").EnumerateArray())
            {
                string name = one.GetProperty("name").GetString() + " at " + (uplink + downlink) + " ms RTT";
                var reader = new Reader(Util.FromHex(paths.RootElement.GetProperty("mapBlob").GetProperty("hex").GetString()));
                var map = MapBlob.ReadCollisionFixture(ref reader); reader.End();
                var ticks = one.GetProperty("ticks");
                int last = ticks.GetArrayLength() - 1;
                var xs = new double[last + 1];
                var ys = new double[last + 1];
                for (int k = 0; k <= last; k++) { xs[k] = ticks[k].GetProperty("x").GetDouble(); ys[k] = ticks[k].GetProperty("y").GetDouble(); }

                double now = 0;
                var t = new QueuedTransport();
                var s = Start(t, map, () => now, Self(xs[0], ys[0]));
                double c = Frame; // ordered one frame in: off the tick grid, so the tick phase is not zero
                double applied = CeilTick(c + uplink); // the server tick that applies the Move
                double nextServerTick = Tick;
                double maxError = 0;
                bool ordered = false;
                double end = applied + Tick * last + downlink + 200;
                for (int f = 1; f * Frame <= end; f++)
                {
                    now = f * Frame;
                    // Every server tick that has arrived by this frame, oldest first (the vector's tick k is k ticks of walking).
                    while (nextServerTick + downlink <= now + 1e-9)
                    {
                        int k = nextServerTick < applied ? 0 : Math.Min(last, (int)((nextServerTick - applied) / Tick) + 1);
                        t.Enqueue(new ServerMsg.Snapshot
                        {
                            Tick = SourceTick(nextServerTick), Phase = 1, Me = Self(xs[k], ys[k], (byte)(k > 0 ? 1 : 0)),
                            AckInput = k > 0 ? 1u : 0u,
                        });
                        nextServerTick += Tick;
                    }
                    s.Poll();
                    if (!ordered && now >= c - 1e-9)
                    {
                        s.OrderMove((float)one.GetProperty("goal")[0].GetDouble(), (float)one.GetProperty("goal")[1].GetDouble());
                        ordered = true;
                    }
                    s.FlushInput();
                    if (!ordered) continue;
                    // Where the zero-latency walk is now: the order's own timeline, which is what the server will have walked
                    // by the time an order sent now lands. A correct prediction is not dragged back from it by the echo. It
                    // is exact on frames a whole number of ticks after the order (between them, interpolating the tick
                    // samples would cut the path's corners), and within one tick of walking on every other frame.
                    double kf = Math.Min(last, Math.Max(0, (now - c) / Tick));
                    int k0 = (int)Math.Floor(kf + 1e-6), k1 = Math.Min(last, k0 + 1);
                    bool onTick = Math.Abs(kf - Math.Round(kf)) < 1e-6;
                    double err = onTick ? Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[k0], ys[k0])
                        : Math.Min(Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[k0], ys[k0]), Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[k1], ys[k1]));
                    double tolerance = onTick ? LeadTolerance : TickWalk;
                    double idealX = xs[k0], idealY = ys[k0];
                    if (onTick) maxError = Math.Max(maxError, err);
                    if (err > tolerance)
                        Assert.Fail(name + " at " + now.ToString("F1") + " ms drew (" + s.Motion.DrawnX + ", " + s.Motion.DrawnY
                            + "), the zero-latency walk is at (" + idealX + ", " + idealY + "): error " + err + " > " + tolerance);
                }
                Assert.AreEqual(0, s.Motion.Snaps, name + ": a correct prediction never snaps");
                Assert.IsFalse(s.Motion.OrderPending, name + ": the echo acknowledged the order");
                Assert.LessOrEqual(Dist(s.Motion.DrawnX, s.Motion.DrawnY, xs[last], ys[last]), 0.01, name + ": the walk ends on the server");
                TestContext.Progress.WriteLine(name + " max lead error " + maxError.ToString("E3") + " u");
            }
        }

        // ----------------------------------------------------------------------------------------------------------------
        // A straight-line server on an open floor (advance_along_path is exact there), with stops, steering and speed

        /// <summary>
        /// The server side of the straight-line tests: inputs land <c>uplink</c> after they are flushed, are applied at the next
        /// 50 ms tick before that tick's walk, and every tick's self sample arrives <c>downlink</c> later.
        /// </summary>
        sealed class LineServer
        {
            public double X = 100, Y = 100, Mult = 1.0;
            public double? SpeedMilli;
            double? _goal;
            byte _seq;
            uint _ack;
            readonly List<(double at, uint frame, ClientMsg.Input input)> _inbound = new List<(double, uint, ClientMsg.Input)>();
            public readonly List<(double server, double x)> History = new List<(double, double)>();

            public void Receive(byte[] frame, double landsAt)
            {
                var input = ClientMsg.Decode(frame) as ClientMsg.Input;
                if (input != null) _inbound.Add((landsAt, input.Seq, input));
            }

            public ServerMsg.Snapshot Step(double tickAt)
            {
                for (int i = 0; i < _inbound.Count; i++)
                {
                    if (_inbound[i].at > tickAt + 1e-9) continue;
                    foreach (var cmd in _inbound[i].input.Commands)
                    {
                        if (cmd.Kind == CommandKind.Move) _goal = cmd.X;
                        else if (cmd.Kind == CommandKind.Stop) _goal = null;
                        if (cmd.Seq.HasValue) _seq = cmd.Seq.Value;
                    }
                    _ack = _inbound[i].frame;
                    _inbound.RemoveAt(i--);
                }
                if (_goal.HasValue)
                {
                    double budget = 170.0 * Mult * Tick / 1000.0;
                    double d = _goal.Value - X;
                    if (Math.Abs(d) <= budget) { X = _goal.Value; _goal = null; }
                    else X += Math.Sign(d) * budget;
                }
                History.Add((tickAt, X));
                var snap = new ServerMsg.Snapshot
                {
                    Tick = SourceTick(tickAt), Phase = 1, Me = Self(X, Y, _seq), AckInput = _ack,
                };
                if (SpeedMilli.HasValue)
                    snap.OwnerCombat = new WireOwnerCombat { AsMilli = 1000, WindupMilli = 1000, SpeedMilli = SpeedMilli.Value };
                return snap;
            }

            /// <summary>The server's x at server time <paramref name="at"/>, linear between its tick samples.</summary>
            public double XAt(double at)
            {
                if (History.Count == 0 || at <= History[0].server) return History.Count == 0 ? X : History[0].x;
                for (int i = 1; i < History.Count; i++)
                    if (History[i].server >= at)
                    {
                        var a = History[i - 1]; var b = History[i];
                        return a.x + (b.x - a.x) * (at - a.server) / (b.server - a.server);
                    }
                return History[History.Count - 1].x;
            }
        }

        /// <summary>Runs frames to <paramref name="endMs"/>: deliver, poll, let <paramref name="input"/> order, flush, observe.</summary>
        static void Run(Session s, QueuedTransport t, LineServer server, Func<double> clock, Action<double> setClock,
            double uplink, double downlink, double fromMs, double endMs, Action<double> input, Action<double> observe)
        {
            var pending = new List<(double arrives, ServerMsg.Snapshot snap)>();
            double nextTick = CeilTick(fromMs + 1e-6);
            int sent = t.Sent.Count;
            for (double now = fromMs + Frame; now <= endMs + 1e-9; now += Frame)
            {
                setClock(now);
                while (nextTick <= now + 1e-9)
                {
                    pending.Add((nextTick + downlink, server.Step(nextTick)));
                    nextTick += Tick;
                }
                for (int i = 0; i < pending.Count; i++)
                    if (pending[i].arrives <= now + 1e-9) { t.Enqueue(pending[i].snap); pending.RemoveAt(i--); }
                s.Poll();
                input?.Invoke(now);
                s.FlushInput();
                for (; sent < t.Sent.Count; sent++) server.Receive(t.Sent[sent], now + uplink);
                observe?.Invoke(now);
            }
        }

        [TestCase(25.0, 25.0)]
        [TestCase(50.0, 50.0)]
        [TestCase(75.0, 75.0)]
        public void AStopMidWalkLandsWhereTheServerStops(double uplink, double downlink)
        {
            double now = 0;
            var t = new QueuedTransport();
            var server = new LineServer();
            var s = Start(t, new MapBlob(64, 16, new byte[64 * 16]), () => now, Self(server.X, server.Y));
            double minStep = double.PositiveInfinity, lastX = s.Motion.DrawnX;
            double stopX = double.NaN, stopAt = 1500 + 3 * Frame;
            Run(s, t, server, () => now, v => now = v, uplink, downlink, 0, 3000,
                at =>
                {
                    if (Math.Abs(at - 5 * Frame) < 1e-6) s.OrderMove(1500, 100);
                    if (Math.Abs(at - stopAt) < 1e-6) { s.OrderStop(); stopX = s.Motion.DrawnX; }
                },
                at =>
                {
                    if (at > 5 * Frame && at < stopAt) minStep = Math.Min(minStep, s.Motion.DrawnX - lastX);
                    lastX = s.Motion.DrawnX;
                });
            string name = (uplink + downlink) + " ms RTT";
            Assert.Greater(minStep, 0.0, name + ": the drawn walk never stalls or turns round before the stop");
            // The server applies the stop at its next tick after it lands; the prediction stopped at the click. They differ by
            // the tick phase only (under one tick of walking), never by a round trip of lag.
            Assert.LessOrEqual(Math.Abs(stopX - server.X), TickWalk, name + ": predicted stop " + stopX + ", server stop " + server.X);
            Assert.AreEqual(server.X, s.Motion.DrawnX, 0.01, name + ": settled on the server");
            Assert.AreEqual(0, s.Motion.Snaps, name);
        }

        [TestCase(75.0, 75.0, 0.9)]
        [TestCase(75.0, 75.0, 1.1)]
        [TestCase(50.0, 50.0, 0.9)]
        public void AHeldMovementKeyStillReconcilesWhenTheEchoIsSlowerThanTheRepeat(double uplink, double downlink, double serverMult)
        {
            // MatchClient re-sends a Move 64 u ahead of the drawn position every 100 ms while a key is held. With an echo slower
            // than that, a newer order is always outstanding; the server here walks at a speed the client cannot know (a hidden
            // slow or haste), so only reconciliation can keep the drawn walk honest during the hold.
            double now = 0;
            var t = new QueuedTransport();
            var server = new LineServer { Mult = serverMult };
            var s = Start(t, new MapBlob(160, 16, new byte[160 * 16]), () => now, Self(server.X, server.Y));
            double lastSteer = double.NegativeInfinity;
            double lastX = s.Motion.DrawnX, minStep = double.PositiveInfinity;
            const double holdFrom = 50, holdTo = 4050;
            bool pendingSeen = false;
            var drawn = new List<(double at, double x)>();
            Run(s, t, server, () => now, v => now = v, uplink, downlink, 0, holdTo,
                at =>
                {
                    if (at >= holdFrom && at - lastSteer >= 100 - 1e-6) { s.OrderMove(s.Motion.DrawnX + 64, 100); lastSteer = at; }
                },
                at =>
                {
                    if (at < holdFrom + 1000) { lastX = s.Motion.DrawnX; return; }
                    pendingSeen |= s.Motion.OrderPending;
                    drawn.Add((at, s.Motion.DrawnX));
                    minStep = Math.Min(minStep, s.Motion.DrawnX - lastX);
                    lastX = s.Motion.DrawnX;
                });
            string name = (uplink + downlink) + " ms RTT, server speed x" + serverMult;
            // Against where the server is when an order sent at that frame is applied (uplink plus, on average, half a tick),
            // for every frame whose answer the server has already walked.
            double maxErr = 0;
            foreach (var d in drawn)
                if (d.at + uplink + Tick / 2 <= holdTo - Tick)
                    maxErr = Math.Max(maxErr, Math.Abs(d.x - server.XAt(d.at + uplink + Tick / 2)));
            Assert.IsTrue(pendingSeen, name + ": the repeat outruns the echo (the case under test)");
            // Without reconciliation during the hold the error grows by 17 u per second of holding (68 u here).
            Assert.LessOrEqual(maxErr, 2 * TickWalk, name + ": drawn x against where the server will be, max " + maxErr);
            Assert.Greater(minStep, 0.0, name + ": corrections never turn the drawn walk round");
            Assert.AreEqual(0, s.Motion.Snaps, name + ": a 10% speed error is absorbed, not snapped");
        }

        [Test]
        public void AFrozenServerDuringAHeldKeyIsCorrectedBeforeTheKeyIsReleased()
        {
            // The server stops the fighter outright (a root the client cannot know) for 600 ms of a held key at 150 ms RTT.
            double now = 0;
            var t = new QueuedTransport();
            var server = new LineServer();
            var s = Start(t, new MapBlob(160, 16, new byte[160 * 16]), () => now, Self(server.X, server.Y));
            double lastSteer = double.NegativeInfinity, worstAfter = 0;
            var drawn = new List<(double at, double x)>();
            Run(s, t, server, () => now, v => now = v, 75, 75, 0, 4000,
                at =>
                {
                    server.Mult = at >= 1000 && at < 1600 ? 0.0 : 1.0;
                    if (at - lastSteer >= 100 - 1e-6) { s.OrderMove(s.Motion.DrawnX + 64, 100); lastSteer = at; }
                },
                at =>
                {
                    if (at >= 3000) drawn.Add((at, s.Motion.DrawnX));
                });
            foreach (var d in drawn)
                if (d.at + 75 + Tick / 2 <= 4000 - Tick) worstAfter = Math.Max(worstAfter, Math.Abs(d.x - server.XAt(d.at + 75 + Tick / 2)));
            Assert.IsTrue(s.Motion.OrderPending, "the key is still held");
            // 600 ms frozen is 102 u of server walk the prediction did not see; it is corrected (snapped or absorbed) during the
            // hold, not carried until release.
            Assert.LessOrEqual(worstAfter, 2 * TickWalk, "after the freeze the drawn walk is back on the server, max " + worstAfter);
        }

        // ----------------------------------------------------------------------------------------------------------------
        // The owner speed multiplier the server already sends

        [TestCase(1200.0)]
        [TestCase(800.0)]
        [TestCase(200.0)] // under rh-sim's MOVE_MULT_FLOOR (0.35): the server walks at the floor
        public void TheOwnerSpeedMultiplierDrivesThePredictedWalk(double speedMilli)
        {
            double now = 0;
            var t = new QueuedTransport();
            double serverMult = Math.Max(0.35, speedMilli / 1000.0);
            var server = new LineServer { Mult = serverMult, SpeedMilli = speedMilli };
            var s = Start(t, new MapBlob(160, 16, new byte[160 * 16]), () => now, Self(server.X, server.Y));
            // Learn the multiplier from one sample, then walk at zero latency: every sample must match exactly, as in the
            // base-speed Rust vectors.
            Run(s, t, server, () => now, v => now = v, 0, 0, 0, 50, null, null);
            Assert.AreEqual(speedMilli, s.Me.OwnerCombat.Value.SpeedMilli);
            bool ordered = false;
            var drawn = new List<(double at, double x)>();
            Run(s, t, server, () => now, v => now = v, 0, 0, 50, 1550,
                at => { if (!ordered && Math.Abs(at - 50 - Frame) < 1e-6) { s.OrderMove(1200, 100); ordered = true; } },
                at => drawn.Add((at, s.Motion.DrawnX)));
            // Zero latency: the order (one frame after 50 ms) is applied on the 100 ms tick, which walks one tick, so the server
            // at 100 ms is where the prediction is one tick after the order: the drawn walk at t is the server's at t - Frame.
            double maxErr = 0;
            foreach (var d in drawn)
                if (d.at >= 100 + Frame) maxErr = Math.Max(maxErr, Math.Abs(d.x - server.XAt(d.at - Frame)));
            string name = "speed_milli " + speedMilli;
            Assert.LessOrEqual(maxErr, 0.05, name + ": the predicted walk keeps the server's speed, max " + maxErr);
            Assert.AreEqual(0, s.Motion.ConsecutiveOutOfToleranceSamples, name);
            Assert.AreEqual(0, s.Motion.Snaps, name);
        }

        [Test]
        public void WithoutOwnerCombatThePredictionWalksAtTheBaseSpeed()
        {
            var motion = new LocalMotion(new MapBlob(64, 16, new byte[64 * 16]));
            motion.OnSnapshot(Self(100, 100), 0, null, null, 1500);
            motion.OnSnapshot(Self(100, 100), 50, null, null, null);
            motion.Order(1000, 100, 1, 50);
            motion.Step(150);
            Assert.AreEqual(117.0, motion.DrawnX, 1e-3, "no owner block: 170 u/s, the rh-sim decode default of 1.0");
        }
    }
}

using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The draw-ahead aiming policy: what an attack's render time stamps against the remote pose the player saw. The judged pose is
    /// modelled like the server (rh-sim <c>position_at</c>: a lerp between tick samples, the room clamp of <c>t</c> to at most
    /// <c>now_apply</c>, and the simulation's one-tick lag floor), with the server time at the press no earlier than the newest
    /// snapshot the client holds. Presentation and stamp only; no hit rule is modelled.
    /// </summary>
    public class RemoteDrawAimTests
    {
        const double Frame = 1000.0 / 60.0, Speed = 170.0;
        // Bounds as numbers, derived in docs/PLAYER_PREDICTION.md from LeadMs 50, MaxLeadDistance 10 and walk speed 170 u/s.
        const float TargetBoundAtWalk = 17f, FollowLag = 20f;
        const double TimeBoundMs = 50;

        [Test]
        public void TheExposedBoundsAreTheDerivedNumbers()
        {
            Assert.AreEqual(TargetBoundAtWalk, RemoteDraw.AimTargetErrorBound((float)Speed), 1e-4, "min(10, 8.5) + 8.5");
            Assert.AreEqual(FollowLag, RemoteDraw.MaxFollowLag);
            Assert.AreEqual(TimeBoundMs, RemoteDraw.AimTimeErrorBoundMs);
            Assert.AreEqual(37f, RemoteDraw.AimTargetErrorBound((float)Speed) + RemoteDraw.MaxFollowLag, 1e-4, "drawn figure vs judged pose at walk speed");
            Assert.Less(RemoteDraw.MaxFollowLag, RemoteDraw.SnapDistance);
        }

        static ServerMsg.Snapshot Snap(int tick, double x, double y, byte status = 1)
        {
            return new ServerMsg.Snapshot { Tick = (uint)tick, Actors = new[] { new WireActor { Id = 7, X = (float)x, Y = (float)y, HpPct = 100, Status = status, Kind = (byte)ActorKind.Player } } };
        }
        delegate (double x, double y) Path(double t);
        /// <summary>The server's rewound pose: its tick history lerped (rh-sim FighterCore::position_at).</summary>
        static (double x, double y) Judged(Path p, double t)
        {
            double k = Math.Floor(t / 50.0); var a = p(k * 50); var b = p(k * 50 + 50); double f = (t - k * 50) / 50.0;
            return (a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        }
        /// <summary>The rewind time the server uses for stamp t: clamped to now_apply, then the one-tick lag floor.</summary>
        static double ServerRewind(double t, double nowApply) { t = Math.Min(t, nowApply); return Math.Min(t, nowApply - Wire.TickMs); }
        /// <summary>
        /// The server step that applies a press made at render time <paramref name="render"/> with the smallest render delay and
        /// no downlink: the press is at server time render + 70 at the earliest, and lands up ms later on the next tick boundary.
        /// </summary>
        static double ApplyAt(double render, double up = 0) { return Math.Floor((render + RenderClock.MinDelayMs + up) / 50.0) * 50 + 50; }
        static double Dist(InterpActor a, (double x, double y) b) { return Math.Sqrt(Math.Pow(a.X - b.x, 2) + Math.Pow(a.Y - b.y, 2)); }

        static Path Walk = t => (100 + Speed * t / 1000.0, 50);

        [Test]
        public void NewestThousandRenderNineEightyStampsTheExtrapolatedTimeItDraws()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k <= 20; k++) { var p = Walk(k * 50.0); buf.Add(Snap(k, p.x, p.y)); }
            Assert.AreEqual(1000.0, buf.NewestMs);
            var o = new List<InterpActor>();
            rd.Sample(980, o);
            // Drawn: the walk extrapolated to 1030 (1000 + 30 ms of lead), i.e. truth at 1030.
            Assert.AreEqual(Walk(1030).x, o[0].X, 1e-3);
            double t = rd.AttackTime(980);
            Assert.AreEqual(1030.0, t, 1e-9, "the stamp is the time drawn, not the newest snapshot (1000)");
            double rewind = ServerRewind(t, ApplyAt(980));
            Assert.AreEqual(t, rewind, 1e-9, "inside the window: neither the future clamp nor the lag floor moves it");
            Assert.Less(Dist(o[0], Judged(Walk, rewind)), 1e-3, "a steady walker is judged where it was drawn");
            // The previous stamp (capped at the newest snapshot) judged it a full lead of walk behind the drawn figure.
            Assert.AreEqual(Speed * 30 / 1000.0, Dist(o[0], Judged(Walk, Math.Min(980 + RemoteDraw.LeadMs, buf.NewestMs))), 1e-3);
        }

        [Test]
        public void AHeldTargetAtTheSameClickIsWithinOneLeadOfWalk()
        {
            // Walks +x, then turns 90 degrees at the newest snapshot: no extrapolation, drawn at the newest pose.
            Path turn = t => t <= 950 ? (Speed * t / 1000.0, 0) : (Speed * 0.95, Speed * (t - 950) / 1000.0);
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k <= 20; k++) { var p = turn(k * 50.0); buf.Add(Snap(k, p.x, p.y)); }
            var o = new List<InterpActor>();
            rd.Sample(980, o);
            Assert.AreEqual(turn(1000).y, o[0].Y, 1e-3, "held at the newest pose");
            double t = rd.AttackTime(980);
            double e = Dist(o[0], Judged(turn, ServerRewind(t, ApplyAt(980))));
            Assert.AreEqual(Speed * 30 / 1000.0, e, 1e-3, "30 ms of its walk");
            Assert.LessOrEqual(e, Speed * RemoteDraw.LeadMs / 1000.0 + 1e-3);
            Assert.LessOrEqual(t - buf.NewestMs, TimeBoundMs, "drawn time (newest) and stamp differ by at most one lead");
        }

        [Test]
        public void OnANearZeroLinkTheServersLagFloorJudgesNoEarlierThanTheNewestSnapshot()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k <= 20; k++) buf.Add(Snap(k, Walk(k * 50.0).x, 50));
            double t = rd.AttackTime(980);
            // The earliest possible apply step for any snapshot already published: one tick past it. The one-tick lag floor then
            // rewinds to the newest snapshot, 30 ms (5.1 u of walk) earlier than drawn and never earlier than the newest pose.
            double rewind = ServerRewind(t, buf.NewestMs + Wire.TickMs);
            Assert.AreEqual(buf.NewestMs, rewind, 1e-9);
            Assert.LessOrEqual(t - rewind, TimeBoundMs);
            var o = new List<InterpActor>(); rd.Sample(980, o);
            Assert.AreEqual(Speed * 30 / 1000.0, Dist(o[0], Judged(Walk, rewind)), 1e-3);
        }

        [Test]
        public void TooFewSamplesHoldEveryoneAndStampTheNewestSnapshot()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            buf.Add(Snap(19, Walk(950).x, 50)); buf.Add(Snap(20, Walk(1000).x, 50));
            var o = new List<InterpActor>();
            rd.Sample(980, o);
            Assert.AreEqual(Walk(1000).x, o[0].X, 1e-3);
            Assert.AreEqual(1000.0, rd.AttackTime(980), 1e-9, "nothing is extrapolated, so nothing later than the newest pose is stamped");
            Assert.AreEqual(960.0, rd.AttackTime(910), 1e-9, "inside the buffer: render + lead");
        }

        [Test]
        public void TheStampNeverPassesTheServersApplyTime()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k <= 20; k++) buf.Add(Snap(k, Walk(k * 50.0).x, 50));
            Assert.LessOrEqual(RemoteDraw.LeadMs, Wire.TickMs, "one lead is at most one tick, the server's least distance from a snapshot to its apply time");
            foreach (double r in new[] { 0.0, 900, 949.9, 950, 980, 1000, 1200, 5000 })
            {
                double t = rd.AttackTime(r);
                Assert.LessOrEqual(t, buf.NewestMs + Wire.TickMs, "at most one lead past the newest snapshot, so never past now_apply (no future-edge clamp)");
                Assert.GreaterOrEqual(t, Math.Min(r, buf.NewestMs), "never older than what is drawn");
            }
        }

        [Test]
        public void FollowerLagIsCappedSoTheDrawnFigureStaysNearItsTarget()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k < 10; k++) buf.Add(Snap(k, 300, 50));
            var o = new List<InterpActor>();
            // Render time already past the newest snapshot (450): a standing player is held there.
            double r = 470;
            rd.Sample(r, o);
            Assert.AreEqual(300f, o[0].X, 1e-4);
            // A 28 u correction arrives late, under the 32 u snap, with no displacement or status change, and with an effect bit
            // so it is held, not extrapolated: the target jumps 28 u in one frame.
            var late = Snap(10, 328, 50); late.Actors[0].Effects = 1;
            buf.Add(late);
            r += Frame; rd.Sample(r, o);
            Assert.LessOrEqual(328 - o[0].X, FollowLag + 1e-3, "the drawn figure trails its target by at most the cap");
            Assert.Greater(328 - o[0].X, 0f, "a capped blend, not a snap");
            for (int i = 0; i < 20; i++) { r += Frame; rd.Sample(r, o); Assert.LessOrEqual(Math.Abs(328 - o[0].X), FollowLag + 1e-3); }
            Assert.AreEqual(328f, o[0].X, 1e-3, "and it converges");
        }

        /// <summary>Snapshot k (server 50k) reaches the client at 50k + down + jitter; the press reaches the server up ms later.</summary>
        static (double mean, double max, double oldMean, double maxDt, double targetMax) Replay(Path truth, double up, double down, double jitter)
        {
            var buf = new SnapshotBuffer(); var rd = new RemoteDraw(buf) { Enabled = true }; var o = new List<InterpActor>();
            var rng = new Random(3); int next = 0; double sum = 0, max = 0, oldSum = 0, maxDt = 0, targetMax = 0; int n = 0;
            var lag = new double[200]; for (int i = 0; i < lag.Length; i++) lag[i] = down + rng.NextDouble() * jitter;
            for (double now = 0; now < 6000; now += Frame)
            {
                while (next * 50.0 + lag[next % lag.Length] <= now) { var p = truth(next * 50.0); buf.Add(Snap(next, p.x, p.y)); next++; }
                if (buf.Count == 0) continue;
                double render = now - down - RenderClock.MinDelayMs;
                rd.Sample(render, o);
                if (now < 1000) continue;
                double nowApply = Math.Floor((now + up) / 50.0) * 50 + 50;
                double rewind = ServerRewind(rd.AttackTime(render), nowApply);
                double e = Dist(o[0], Judged(truth, rewind));
                // The pose the follower chases (before its speed cap) against the pose the server would judge.
                if (!rd.TryGetTarget(o[0].Id, out float tgx, out float tgy)) throw new InvalidOperationException("no target for the drawn player");
                var jp = Judged(truth, rewind);
                targetMax = Math.Max(targetMax, Math.Sqrt(Math.Pow(tgx - jp.x, 2) + Math.Pow(tgy - jp.y, 2)));
                double old = Dist(o[0], Judged(truth, ServerRewind(Math.Max(render, Math.Min(render + RemoteDraw.LeadMs, buf.NewestMs)), nowApply)));
                sum += e; oldSum += old; max = Math.Max(max, e); n++;
                maxDt = Math.Max(maxDt, Math.Abs(rewind - buf.NewestMs) > RemoteDraw.LeadMs ? Math.Abs(rewind - (render + RemoteDraw.LeadMs)) : 0);
            }
            return (sum / n, max, oldSum / n, maxDt, targetMax);
        }

        [Test]
        public void ReplayedTracesStayWithinTheBoundAndSteadyWalkersAreJudgedWhereDrawn()
        {
            Path stop = t => (100 + Speed * Math.Min(t, 2000) / 1000.0, 50);
            Path reverse = t => (100 + Speed * (t < 2000 ? t : 4000 - t) / 1000.0, 50);
            Path circle = t => (300 + 80 * Math.Cos(t * Speed / 80 / 1000), 300 + 80 * Math.Sin(t * Speed / 80 / 1000));
            Path zigzag = t => { double seg = Math.Floor(t / 400), ph = t - seg * 400; return (100 + Speed * t / 1000.0 / Math.Sqrt(2), 50 + (seg % 2 == 0 ? ph : 400 - ph) * Speed / 1000.0 / Math.Sqrt(2)); };
            foreach (var link in new[] { (0.0, 0.0, 0.0), (15.0, 15.0, 0.0), (30.0, 30.0, 20.0), (60.0, 60.0, 30.0) })
                foreach (var tr in new (string, Path)[] { ("walk", Walk), ("stop", stop), ("reverse", reverse), ("circle", circle), ("zigzag", zigzag) })
                {
                    var r = Replay(tr.Item2, link.Item1, link.Item2, link.Item3);
                    TestContext.Out.WriteLine($"{tr.Item1,-8} up {link.Item1} down {link.Item2} jitter {link.Item3}: mean {r.mean:F2} max {r.max:F2} target-only max {r.targetMax:F2} (stamp capped at newest: mean {r.oldMean:F2})");
                    Assert.LessOrEqual(r.targetMax, RemoteDraw.AimTargetErrorBound((float)Speed) + 1e-3, tr.Item1 + ": pre-follower target vs judged pose");
                    Assert.LessOrEqual(r.max, TargetBoundAtWalk + FollowLag, tr.Item1);
                    Assert.LessOrEqual(r.mean, r.oldMean + 1e-6, tr.Item1 + ": never worse on average than the newest-capped stamp");
                    if (link.Item1 > 0 && (tr.Item1 == "walk" || tr.Item1 == "circle")) Assert.Less(r.mean, 0.5, tr.Item1 + ": judged where drawn");
                }
        }
    }
}

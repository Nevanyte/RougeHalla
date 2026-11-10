using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>Bounded remote draw-ahead: presentation only, so these replay snapshot arrival traces and score the drawn pose against truth.</summary>
    public class RemoteDrawTests
    {
        const double DelayMs = 70, Frame = 1000.0 / 60.0, Speed = 170.0;

        static ServerMsg.Snapshot Snap(int tick, WireActor a) { return new ServerMsg.Snapshot { Tick = (uint)tick, Actors = new[] { a } }; }
        static WireActor Act(uint id, float x, float y, byte status = 1, ushort effects = 0, byte hp = 100, byte disp = 0)
        {
            return new WireActor { Id = id, X = x, Y = y, HpPct = hp, Status = status, Effects = effects, DisplaceSeq = disp, Kind = (byte)ActorKind.Player };
        }

        /// <summary>Truth path: pose of player 7 at server ms t.</summary>
        delegate WireActor Truth(double t);

        sealed class Run
        {
            public double Sum, Max, MaxStep, BaseSum, Age; public int N;
            public double MaxLeadSeen;
        }

        /// <summary>
        /// Feeds a trace through SnapshotBuffer: snapshot k (server time 50k) arrives at 50k + lag(k) ms; each 60 Hz frame draws at
        /// serverNow - 70. Scores the drawn pose against truth at the pose the viewer wants (render time + 50 ms).
        /// </summary>
        static Run Replay(Truth truth, bool enabled, Func<int, double> lag, double fromMs = 1000, double toMs = 4000, Func<double, bool> dropped = null)
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = enabled };
            var plain = new List<InterpActor>();
            var o = new List<InterpActor>();
            var r = new Run();
            int next = 0;
            double px = double.NaN, py = double.NaN;
            for (double now = 0; now < toMs; now += Frame)
            {
                while (next * 50.0 + lag(next) <= now)
                {
                    if (dropped == null || !dropped(next * 50.0)) buf.Add(Snap(next, truth(next * 50.0)));
                    next++;
                }
                if (buf.Count == 0) continue;
                double renderMs = now - DelayMs;
                Assert.True(rd.Sample(renderMs, o));
                buf.Sample(renderMs, plain);
                if (now < fromMs) { px = o[0].X; py = o[0].Y; continue; }
                var want = truth(renderMs + RemoteDraw.LeadMs);
                double e = Math.Sqrt(Math.Pow(o[0].X - want.X, 2) + Math.Pow(o[0].Y - want.Y, 2));
                double be = Math.Sqrt(Math.Pow(plain[0].X - want.X, 2) + Math.Pow(plain[0].Y - want.Y, 2));
                r.Sum += e; r.BaseSum += be; r.Max = Math.Max(r.Max, e); r.N++;
                r.MaxStep = Math.Max(r.MaxStep, Math.Sqrt(Math.Pow(o[0].X - px, 2) + Math.Pow(o[0].Y - py, 2)));
                px = o[0].X; py = o[0].Y;
            }
            return r;
        }

        static WireActor Walk(double t) { return Act(7, (float)(100 + Speed * t / 1000.0), 50); }
        static double NoLag(int k) { return 0; }

        [Test]
        public void StraightWalkIsDrawnAboutFiftyMsFresher()
        {
            var on = Replay(Walk, true, NoLag);
            Assert.Less(on.Sum / on.N, 0.05, "walking straight, draw-ahead lands on the fresh pose");
            Assert.Less(on.Max, 0.2);
            // Without it the figure is a full lead (50 ms x 170 u/s = 8.5 u) behind the same target.
            Assert.Greater(on.BaseSum / on.N, 8.4);
            // Smooth: a figure moves at most its walk step per frame.
            Assert.LessOrEqual(on.MaxStep, Speed * Frame / 1000.0 + 0.01);
        }

        [Test]
        public void ExtrapolationPastTheNewestSnapshotIsBoundedInTimeAndDistance()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k < 6; k++) buf.Add(Snap(k, Walk(k * 50.0)));
            var o = new List<InterpActor>();
            var newest = Walk(250);
            // Render time far past the data (a starved clock): lead is capped at one tick of walk, which is also under MaxLeadDistance.
            rd.Sample(250 + 1000, o);
            Assert.LessOrEqual(o[0].X - newest.X, 8.5f + 0.01f);
            Assert.GreaterOrEqual(o[0].X - newest.X, 0f);
            Assert.LessOrEqual(8.5f, RemoteDraw.MaxLeadDistance);
            // A fast mover (beyond the speed the server allows) is still held to MaxLeadDistance.
            var buf2 = new SnapshotBuffer();
            var rd2 = new RemoteDraw(buf2) { Enabled = true };
            for (int k = 0; k < 6; k++) buf2.Add(Snap(k, Act(7, 100 + 100f * k, 50)));
            rd2.Sample(250 + 1000, o);
            Assert.LessOrEqual(o[0].X - 600f, RemoteDraw.MaxLeadDistance + 0.01f);
        }

        [Test]
        public void AStoppedPlayerGetsNoLeadAndOvershootIsBlendedBackNotSnapped()
        {
            // Walks, then stops dead at t = 2000 ms.
            Truth stop = t => Act(7, (float)(100 + Speed * Math.Min(t, 2000) / 1000.0), 50);
            var on = Replay(stop, true, NoLag, 1000, 5000);
            Assert.LessOrEqual(on.MaxStep, Speed * Frame / 1000.0 + 0.01, "no frame moves more than a walk step");
            // Standing still: the stationary pose equals truth exactly once settled.
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k < 10; k++) buf.Add(Snap(k, Act(7, 300, 50)));
            var o = new List<InterpActor>();
            rd.Sample(450 + 500, o);
            Assert.AreEqual(300f, o[0].X, 1e-4);
        }

        [Test]
        public void ASharpTurnGetsNoExtrapolation()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            buf.Add(Snap(0, Act(7, 0, 0)));
            buf.Add(Snap(1, Act(7, 8.5f, 0)));
            buf.Add(Snap(2, Act(7, 17f, 0)));
            buf.Add(Snap(3, Act(7, 17f, 8.5f))); // 90 degrees
            var o = new List<InterpActor>();
            rd.Sample(150 + 1000, o);
            Assert.AreEqual(17f, o[0].X, 1e-4); Assert.AreEqual(8.5f, o[0].Y, 1e-4);
        }

        [Test]
        public void StunnedHitDeadDisplacedOrTooFewSamplesGetNoLead()
        {
            Func<Action<SnapshotBuffer>, float> drawnX = fill =>
            {
                var buf = new SnapshotBuffer(); fill(buf);
                var rd = new RemoteDraw(buf) { Enabled = true };
                var o = new List<InterpActor>(); rd.Sample(buf.NewestMs + 1000, o); return o[0].X;
            };
            // Control: the same walk extrapolates.
            Assert.Greater(drawnX(b => { for (int k = 0; k < 4; k++) b.Add(Snap(k, Act(7, 8.5f * k, 0))); }), 25.5f + 1f);
            Assert.AreEqual(25.5f, drawnX(b => { for (int k = 0; k < 4; k++) b.Add(Snap(k, Act(7, 8.5f * k, 0, 1, k == 3 ? (ushort)1 : (ushort)0))); }), 1e-4, "effect");
            Assert.AreEqual(25.5f, drawnX(b => { for (int k = 0; k < 4; k++) b.Add(Snap(k, Act(7, 8.5f * k, 0, 1, 0, (byte)(k == 3 ? 80 : 100)))); }), 1e-4, "hit");
            Assert.AreEqual(25.5f, drawnX(b => { for (int k = 0; k < 4; k++) b.Add(Snap(k, Act(7, 8.5f * k, 0, (byte)(k == 3 ? 2 : 1)))); }), 1e-4, "dead");
            Assert.AreEqual(25.5f, drawnX(b => { for (int k = 0; k < 4; k++) b.Add(Snap(k, Act(7, 8.5f * k, 0, 1, 0, 100, (byte)(k == 3 ? 1 : 0)))); }), 1e-4, "displaced");
        }

        [Test]
        public void TwoSamplesAreNotEnoughToExtrapolate()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            buf.Add(Snap(0, Act(7, 0, 0))); buf.Add(Snap(1, Act(7, 8.5f, 0)));
            var o = new List<InterpActor>(); rd.Sample(50 + 1000, o);
            Assert.AreEqual(8.5f, o[0].X, 1e-4);
        }

        [Test]
        public void JitterAndADroppedSnapshotStayBoundedAndSmooth()
        {
            var rng = new Random(5);
            var jitter = new double[400];
            for (int i = 0; i < jitter.Length; i++) jitter[i] = rng.NextDouble() * 30;
            var on = Replay(Walk, true, k => jitter[k % jitter.Length], 1000, 6000, t => t == 2500);
            var off = Replay(Walk, false, k => jitter[k % jitter.Length], 1000, 6000, t => t == 2500);
            Assert.Less(on.Sum / on.N, off.Sum / off.N, "still fresher on average");
            Assert.Less(on.Max, 12.0, "error stays within the lead cap plus a short blend");
            Assert.LessOrEqual(on.MaxStep, RemoteDraw.MovingCorrectSpeed * Frame / 1000.0 + 0.01, "no snap: a frame moves at most the follower cap");
        }

        [Test]
        public void DisabledIsExactlyTheSnapshotBufferAndAttackTimeIsIdentity()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf);
            for (int k = 0; k < 8; k++) buf.Add(Snap(k, Act(7, 8.5f * k + (k == 5 ? 3 : 0), 0)));
            var a = new List<InterpActor>(); var b = new List<InterpActor>();
            for (double t = 0; t < 700; t += 7.3)
            {
                Assert.True(rd.Sample(t, a)); Assert.True(buf.Sample(t, b));
                Assert.AreEqual(b.Count, a.Count);
                Assert.AreEqual(b[0].X, a[0].X); Assert.AreEqual(b[0].Y, a[0].Y); Assert.AreEqual(b[0].Facing, a[0].Facing);
                Assert.AreEqual(t, rd.AttackTime(t));
            }
        }

        [Test]
        public void AttackTimeAdvancesByTheLeadAndNeverPastTheNewestSnapshot()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            Assert.AreEqual(100.0, rd.AttackTime(100.0), "empty buffer: unchanged");
            for (int k = 0; k < 20; k++) buf.Add(Snap(k, Act(7, 8.5f * k, 0)));
            Assert.AreEqual(300.0 + RemoteDraw.LeadMs, rd.AttackTime(300.0), 1e-9);
            Assert.AreEqual(buf.NewestMs, rd.AttackTime(buf.NewestMs - 10), 1e-9, "capped at the newest snapshot (inside the server window)");
            Assert.AreEqual(buf.NewestMs + 40, rd.AttackTime(buf.NewestMs + 40), 1e-9, "never earlier than the render time itself");
        }

        [Test]
        public void SessionAttackRenderMsFollowsTheSwitchAndTheSampledLead()
        {
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions());
            s.Clock.OnSnapshot(1000, 5000);
            Assert.AreEqual(s.Clock.RenderMs, s.AttackRenderMs, "off: today's value");
            for (int k = 0; k < 40; k++) s.Snapshots.Add(Snap(k, Act(7, 8.5f * k, 0)));
            s.RemoteDraw.Enabled = true;
            double r = s.Clock.RenderMs;
            Assert.AreEqual(Math.Max(r, Math.Min(r + RemoteDraw.LeadMs, s.Snapshots.NewestMs)), s.AttackRenderMs, 1e-9);
        }

        [Test]
        public void SteadyStateSamplingMakesNoGarbage()
        {
            var buf = new SnapshotBuffer();
            var rd = new RemoteDraw(buf) { Enabled = true };
            for (int k = 0; k < 12; k++) buf.Add(Snap(k, Act(7, 8.5f * k, 0)));
            var o = new List<InterpActor>();
            for (int i = 0; i < 3000; i++) rd.Sample(300 + i * 0.05, o);
            GC.GetAllocatedBytesForCurrentThread(); // counter first use is outside the measured work
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 2000; i++) rd.Sample(400 + i * 0.05, o);
            long used = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.AreEqual(0L, used);
        }
    }
}

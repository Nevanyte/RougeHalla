using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class SnapshotAndClockTests
    {
        static ServerMsg.Snapshot Snap(double ms, params WireActor[] a) { return new ServerMsg.Snapshot { ServerMs = ms, Tick = (uint)(ms / 50), Actors = a }; }
        static WireActor Act(uint id, float x, float y, float facing = 0) { return new WireActor { Id = id, X = x, Y = y, Facing = facing, HpPct = 100 }; }

        [Test]
        public void InterpolatesBetweenTheTwoSnapshotsAroundRenderTime()
        {
            var b = new SnapshotBuffer();
            b.Add(Snap(1000, Act(1, 0, 10))); b.Add(Snap(1050, Act(1, 100, 30)));
            var o = new List<InterpActor>();
            Assert.IsTrue(b.Sample(1025, o));
            Assert.AreEqual(50f, o[0].X, 1e-3); Assert.AreEqual(20f, o[0].Y, 1e-3);
            b.Sample(1010, o); Assert.AreEqual(20f, o[0].X, 1e-3);
        }

        [Test]
        public void HoldsNewestWhenStarvedAndOldestBeforeTheBuffer()
        {
            var b = new SnapshotBuffer();
            b.Add(Snap(1000, Act(1, 0, 0))); b.Add(Snap(1050, Act(1, 100, 0)));
            var o = new List<InterpActor>();
            b.Sample(5000, o); Assert.AreEqual(100f, o[0].X);
            b.Sample(10, o); Assert.AreEqual(0f, o[0].X);
        }

        [Test]
        public void FacingTakesTheShortWayAndTeleportsAreNotSlid()
        {
            var b = new SnapshotBuffer();
            b.Add(Snap(0, Act(1, 0, 0, 3.0f), Act(2, 0, 0))); b.Add(Snap(50, Act(1, 0, 0, -3.0f), Act(2, 1000, 0), Act(3, 5, 5)));
            var o = new List<InterpActor>();
            b.Sample(25, o);
            Assert.Greater(Math.Abs(o[0].Facing), 3.0f, "went through pi, not through 0");
            Assert.AreEqual(1000f, o[1].X, "teleport shown at once");
            Assert.AreEqual(3, o.Count); Assert.AreEqual(5f, o[2].X, "new actor appears where it is");
        }

        [Test]
        public void IgnoresDuplicateAndReorderedSnapshots()
        {
            var b = new SnapshotBuffer();
            Assert.IsTrue(b.Add(Snap(100))); Assert.IsFalse(b.Add(Snap(100))); Assert.IsFalse(b.Add(Snap(50)));
            Assert.AreEqual(1, b.Count);
        }

        // Snapshots every 50 ms arrive 30 ms late plus up to 40 ms of jitter; frames at 8 ms; a 1 s stall at 5 s.
        static void Drive(RenderClock c, Func<int, double> jitter, double stallFrom, double stallTo, double seconds, Action<double, double> frame)
        {
            var arrivals = new List<(double local, double server)>();
            for (int i = 0; i * 50.0 < seconds * 1000; i++)
            {
                double s = 1000 + i * 50.0, l = s + 30 + jitter(i);
                if (l >= stallFrom && l < stallTo) l = stallTo + (l - stallFrom) * 0.01; // held back, then a burst
                arrivals.Add((l, s));
            }
            arrivals.Sort((a, b) => a.local.CompareTo(b.local));
            int next = 0;
            for (double t = 1000; t < 1000 + seconds * 1000; t += 8)
            {
                while (next < arrivals.Count && arrivals[next].local <= t) { c.OnSnapshot(arrivals[next].local, arrivals[next].server); next++; }
                if (c.Ready) frame(t, c.Update(t));
            }
        }

        [Test]
        public void RenderTimeNeverRunsBackwardsUnderJitterAndAStall()
        {
            var rnd = new Random(7);
            var c = new RenderClock();
            double last = double.NegativeInfinity; int frames = 0;
            Drive(c, i => rnd.NextDouble() * 40, 6000, 7000, 12, (t, r) =>
            {
                Assert.GreaterOrEqual(r, last, "render time went backwards at local " + t);
                last = r; frames++;
                if (t > 3000) Assert.That(c.DelayMs, Is.InRange(RenderClock.MinDelayMs - 1, RenderClock.MaxDelayMs + 1), "delay at " + t);
            });
            Assert.Greater(frames, 1000);
        }

        [Test]
        public void DelayConvergesTowardTheFloorOnAPerfectLinkAndGrowsWithJitter()
        {
            var calm = new RenderClock();
            Drive(calm, i => 0, double.MaxValue, double.MaxValue, 15, (t, r) => { });
            Assert.That(calm.DelayMs, Is.InRange(70, 73), "delay " + calm.DelayMs);

            var rnd = new Random(3);
            var noisy = new RenderClock();
            Drive(noisy, i => rnd.NextDouble() * 80, double.MaxValue, double.MaxValue, 15, (t, r) => { });
            Assert.Greater(noisy.TargetDelayMs, 110);
            Assert.LessOrEqual(noisy.TargetDelayMs, RenderClock.MaxDelayMs);
        }

        [Test]
        public void StartsAtAHundredMilliseconds()
        {
            var c = new RenderClock();
            c.OnSnapshot(2000, 1000);
            Assert.AreEqual(100, c.DelayMs, 1e-6);
            Assert.AreEqual(900, c.RenderMs, 1e-6);
        }

        [Test]
        public void ClockSyncPicksTheMinimumRttSample()
        {
            var s = new ClockSync();
            // true offset +1000: server = local + 1000. Sample 1 has a slow return path (asymmetric), sample 2 is clean.
            s.OnPong(new ServerMsg.Pong { ClientMs = 0, ServerMs = 1010 }, 100);   // rtt 100, offset 960
            s.OnPong(new ServerMsg.Pong { ClientMs = 200, ServerMs = 1210 }, 220); // rtt 20, offset 1000
            Assert.AreEqual(20, s.RttMs, 1e-9);
            Assert.AreEqual(1000, s.OffsetMs, 1e-9);
            Assert.AreEqual(1500, s.ServerNowMs(500), 1e-9);
            s.OnPong(new ServerMsg.Pong { ClientMs = 900, ServerMs = 0 }, 800); // negative rtt: ignored
            Assert.AreEqual(20, s.RttMs);
        }
    }

    public class InputSenderTests
    {
        [Test]
        public void AimIsRateLimitedToFortyPerSecond()
        {
            var s = new InputSender();
            int aims = 0;
            for (double t = 0; t < 1000; t += 5)
            {
                s.Aim((float)(t / 100));
                foreach (var f in s.Flush(t)) aims += f.Commands.Count(c => c.Kind == CommandKind.Aim);
            }
            Assert.That(aims, Is.InRange(38, 40));
        }

        [Test]
        public void LatestAimWinsAndNonAimLeavesImmediately()
        {
            var s = new InputSender();
            s.Aim(1f); s.Flush(0);
            s.Aim(2f); s.Aim(3f);
            var seq = s.Move(10, 20);
            var frames = s.Flush(10); // aim not due yet
            Assert.AreEqual(1, frames.Count);
            Assert.AreEqual(1, frames[0].Commands.Count);
            Assert.AreEqual(CommandKind.Move, frames[0].Commands[0].Kind);
            Assert.AreEqual(seq, frames[0].Commands[0].Seq);
            frames = s.Flush(30);
            Assert.AreEqual(3f, frames[0].Commands[0].A);
        }

        [Test]
        public void FramesCarryAtMostSixteenCommandsAndSequencesIncrease()
        {
            var s = new InputSender();
            for (int i = 0; i < 40; i++) s.Attack(0.5f, 1000 + i);
            var frames = s.Flush(0);
            CollectionAssert.AreEqual(new[] { 16, 16, 8 }, frames.Select(f => f.Commands.Count).ToArray());
            CollectionAssert.AreEqual(new uint[] { 1, 2, 3 }, frames.Select(f => f.Seq).ToArray());
            foreach (var f in frames) Assert.DoesNotThrow(() => ClientMsg.Decode(f.Encode()));
            Assert.AreEqual(4u, new InputSender().Also(x => { x.Stop(); x.Flush(0); x.Stop(); x.Flush(0); x.Stop(); x.Flush(0); x.Stop(); }).Flush(0)[0].Seq);
        }

        [Test]
        public void OrderSequencesWrapSkippingZeroAndNonFiniteInputIsDropped()
        {
            var s = new InputSender();
            byte last = 0;
            for (int i = 0; i < 300; i++) { last = s.Stop(); Assert.AreNotEqual(0, last); }
            Assert.AreEqual(0, s.Move(float.NaN, 0));
            s.Aim(float.PositiveInfinity); s.Attack(float.NaN, null);
            Assert.AreEqual(3, s.Dropped);
            foreach (var f in s.Flush(0)) Assert.DoesNotThrow(() => ClientMsg.Decode(f.Encode()));
        }
    }

    static class Ext { public static T Also<T>(this T t, Action<T> a) { a(t); return t; } }

    public class LocalMotionTests
    {
        // 20x10 tiles, border walls; optional wall column at tx = 6.
        static MapBlob Map(bool wallColumn)
        {
            var t = new byte[20 * 10];
            for (int y = 0; y < 10; y++) for (int x = 0; x < 20; x++)
                t[y * 20 + x] = (byte)(x == 0 || y == 0 || x == 19 || y == 9 || (wallColumn && x == 6) ? 1 : 0);
            return new MapBlob(20, 10, t);
        }
        static WireSelf Me(float x, float y, byte seq = 0, float hp = 100) { return new WireSelf { X = x, Y = y, MoveSeq = seq, Hp = hp }; }

        static LocalMotion Started(bool wall, float x = 100, float y = 100)
        {
            var m = new LocalMotion(Map(wall)) { LatencyMs = 0 };
            m.OnSnapshot(Me(x, y), 0);
            return m;
        }
        static void Run(LocalMotion m, double from, double to) { for (double t = from + 16; t <= to; t += 16) m.Step(t); m.Step(to); }

        [Test]
        public void WalksStraightAtPlayerSpeed()
        {
            var m = Started(false);
            m.Order(500, 100, 1, 0);
            Run(m, 0, 1000);
            Assert.AreEqual(100 + LocalMotion.PlayerSpeed, m.SimX, 1.0);
            Assert.AreEqual(100, m.SimY, 1e-3);
        }

        [Test]
        public void StopsAtItsGoal()
        {
            var m = Started(false);
            m.Order(150, 100, 1, 0);
            Run(m, 0, 2000);
            Assert.AreEqual(150, m.SimX, 0.5); Assert.IsFalse(m.HasGoal);
        }

        [Test]
        public void StopsAtAWallWithTheDiscNotTheCentre()
        {
            var m = Started(true);
            m.Order(500, 100, 1, 0);
            Run(m, 0, 3000);
            // wall column spans x 192..224; the disc (r 12) stops with its centre at 180
            Assert.AreEqual(180, m.SimX, 4.5); Assert.Less(m.SimX, 180.01f);
            Assert.IsFalse(m.HasGoal);
        }

        [Test]
        public void SlidesAlongAWallTowardsADiagonalGoal()
        {
            var m = Started(true, 100, 100);
            m.Order(300, 250, 1, 0);
            Run(m, 0, 800);
            Assert.Less(m.SimX, 180.01f);
            Assert.Greater(m.SimY, 150f, "kept sliding down the wall face");
        }

        [Test]
        public void SmallErrorsAreAbsorbedWithoutAJumpAndDecay()
        {
            var m = Started(false);
            m.OnSnapshot(Me(105, 100), 100); // not moving, server 5 u away
            Assert.AreEqual(100, m.DrawnX, 1e-3, "the drawn position did not jump");
            Assert.AreEqual(105, m.SimX, 1e-3);
            Assert.AreEqual(-5, m.VisualX, 1e-3);
            Run(m, 100, 200); // one tau
            Assert.AreEqual(105 - 5 * Math.Exp(-1), m.DrawnX, 0.05);
            Run(m, 200, 800);
            Assert.AreEqual(105, m.DrawnX, 0.15);
        }

        [Test]
        public void LargeErrorsSnap()
        {
            var m = Started(false);
            m.OnSnapshot(Me(300, 100), 100);
            Assert.AreEqual(300, m.DrawnX, 1e-3); Assert.AreEqual(0, m.VisualX);
        }

        [Test]
        public void NoReconcileUntilTheOrderIsAcknowledgedThenItSettlesOnTheServer()
        {
            var m = Started(false);
            m.Order(500, 100, 5, 0);
            Run(m, 0, 100); // model ~17 u ahead
            float before = m.SimX;
            m.OnSnapshot(Me(100, 100, 0), 100); // server has not applied order 5 yet
            Assert.AreEqual(before, m.SimX, 1e-3); Assert.IsTrue(m.OrderPending);
            int rec = m.Reconciles;
            m.OnSnapshot(Me(103, 100, 5), 150); // acked
            Assert.IsFalse(m.OrderPending); Assert.AreEqual(rec + 1, m.Reconciles);
        }

        [Test]
        public void AnOrderTheServerNeverAppliesExpires()
        {
            var m = Started(false);
            m.Order(500, 100, 9, 0);
            m.OnSnapshot(Me(100, 100, 0), 500);
            Assert.IsTrue(m.OrderPending);
            m.OnSnapshot(Me(100, 100, 0), 1200);
            Assert.IsFalse(m.OrderPending);
        }

        [Test]
        public void ReconcilesAgainstWhereTheModelWasOneLatencyAgo()
        {
            var m = Started(false); m.LatencyMs = 100;
            m.Order(500, 100, 1, 0);
            Run(m, 0, 400); // model at ~168
            m.OnSnapshot(Me(100 + 0.3f * 170, 100, 1), 400); // server saw the walk 100 ms behind: model then was 0.3 s in
            Assert.AreEqual(0, Math.Abs(m.DrawnX - (100 + 0.4f * 170)), 0.6, "no visible correction");
            Assert.Less(Math.Abs(m.VisualX), 1.0f);
        }

        [Test]
        public void DoesNotPredictADeadPlayerWalking()
        {
            var m = Started(false);
            m.Order(500, 100, 1, 0);
            m.OnSnapshot(Me(100, 100, 1, 0), 50);
            Assert.IsFalse(m.HasGoal);
        }
    }
}

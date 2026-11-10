using System;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public class GaitTests
    {
        const float East = 0f, South = MathF.PI / 2, West = MathF.PI, North = -MathF.PI / 2;
        static float Rad(float deg) { return deg * MathF.PI / 180f; }

        [TestCase(170f, 0f, East, GaitMode.Backward, ExpectedResult = GaitMode.Forward)]
        [TestCase(170f, 0f, West, GaitMode.Forward, ExpectedResult = GaitMode.Backward)]
        [TestCase(170f, 0f, North, GaitMode.Forward, ExpectedResult = GaitMode.Strafe)]
        [TestCase(170f, 0f, South, GaitMode.Backward, ExpectedResult = GaitMode.Strafe)]
        [TestCase(0f, 170f, North, GaitMode.Forward, ExpectedResult = GaitMode.Backward)]
        public GaitMode Cardinals(float vx, float vy, float facing, GaitMode prev) { return Gait.Classify(vx, vy, facing, prev); }

        [Test]
        public void SlowKeepsPrevious()
        {
            Assert.AreEqual(GaitMode.Backward, Gait.Classify(10, 0, East, GaitMode.Backward));
            Assert.AreEqual(GaitMode.Forward, Gait.Classify(0, 0, West, GaitMode.Forward));
        }

        [Test]
        public void NonFiniteKeepsPrevious()
        {
            Assert.AreEqual(GaitMode.Strafe, Gait.Classify(float.NaN, 0, 0, GaitMode.Strafe));
            Assert.AreEqual(GaitMode.Strafe, Gait.Classify(170, 0, float.PositiveInfinity, GaitMode.Strafe));
        }

        [Test]
        public void BackwardBoundaryHasHysteresis()
        {
            // Velocity east; facing is the angle from the velocity. 112.5 is the nominal edge.
            GaitMode At(float deg, GaitMode prev) { return Gait.Classify(170, 0, Rad(deg), prev); }
            // Between the nominal edge and the enter threshold (cos -0.483 = 118.9 degrees): still not backward from strafe.
            Assert.AreEqual(GaitMode.Strafe, At(113f, GaitMode.Strafe));
            Assert.AreEqual(GaitMode.Strafe, At(118f, GaitMode.Strafe));
            Assert.AreEqual(GaitMode.Backward, At(120f, GaitMode.Strafe));
            // Once backward, stays until cos >= -0.283 (106.4 degrees).
            Assert.AreEqual(GaitMode.Backward, At(111f, GaitMode.Backward));
            Assert.AreEqual(GaitMode.Backward, At(107f, GaitMode.Backward));
            Assert.AreEqual(GaitMode.Strafe, At(105f, GaitMode.Backward));
        }

        [Test]
        public void ForwardBoundaryHasHysteresis()
        {
            GaitMode At(float deg, GaitMode prev) { return Gait.Classify(170, 0, Rad(deg), prev); }
            Assert.AreEqual(GaitMode.Strafe, At(66f, GaitMode.Strafe));  // enter needs cos >= 0.483 (61.1 degrees)
            Assert.AreEqual(GaitMode.Forward, At(60f, GaitMode.Strafe));
            Assert.AreEqual(GaitMode.Forward, At(70f, GaitMode.Forward)); // leave needs cos < 0.283 (73.6 degrees)
            Assert.AreEqual(GaitMode.Strafe, At(75f, GaitMode.Forward));
        }

        [Test]
        public void CircularCursorDoesNotFlickerAtEdge()
        {
            var s = new GaitState();
            int flips = 0; GaitMode last = GaitMode.Forward;
            for (int i = 0; i < 200; i++)
            {
                float deg = 112.5f + 2.5f * MathF.Sin(i * 0.7f); // jitters across the nominal edge
                var m = Gait.Classify(170, 0, Rad(deg), s.Mode);
                s.Mode = m;
                if (i > 0 && m != last) flips++;
                last = m;
            }
            Assert.LessOrEqual(flips, 1);
        }

        [Test]
        public void PhaseRunsBackwardWhenReversed()
        {
            var s = new GaitState();
            float dt = 1f / 60f, step = 170f * dt;
            // Moving east, facing west: backward.
            float prev = 0;
            Gait.Advance(ref s, step, 0, dt, West, 10);
            Assert.AreEqual(GaitMode.Backward, s.Mode);
            for (int i = 0; i < 20; i++)
            {
                prev = s.Phase;
                Gait.Advance(ref s, step, 0, dt, West, 10);
                Assert.Less(s.Phase, prev);
            }
            // Frame indices descend modulo count.
            Assert.GreaterOrEqual(Gait.FrameIndex(s.Phase, 8), 0);
            Assert.Less(Gait.FrameIndex(s.Phase, 8), 8);
        }

        [Test]
        public void PhaseForwardAndContinuousAcrossModeFlip()
        {
            var s = new GaitState();
            float dt = 1f / 60f, step = 170f * dt;
            for (int i = 0; i < 30; i++) Gait.Advance(ref s, step, 0, dt, East, 10);
            Assert.AreEqual(GaitMode.Forward, s.Mode);
            float before = s.Phase;
            Assert.Greater(before, 0);
            for (int i = 0; i < 10; i++) Gait.Advance(ref s, step, 0, dt, West, 10);
            // Phase never jumps by more than one frame step on any tick.
            Assert.Less(MathF.Abs(s.Phase - before), 10 * 10 * dt * 1.2f + 0.01f);
        }

        [Test]
        public void StopResetsAndRestartsOnContactPose()
        {
            var s = new GaitState();
            float dt = 1f / 60f;
            for (int i = 0; i < 17; i++) Gait.Advance(ref s, 170f * dt, 0, dt, East, 10);
            Assert.IsTrue(s.Walking);
            Assert.IsFalse(Gait.Advance(ref s, 0, 0, dt, East, 10));
            Assert.AreEqual(0f, s.Phase);
            Gait.Advance(ref s, 170f * dt, 0, dt, East, 10);
            Assert.IsTrue(s.Walking);
            Assert.Less(s.Phase, 0.5f);
        }

        [Test]
        public void ZeroOrNegativeDtAndTeleportDoNotCorrupt()
        {
            var s = new GaitState();
            Gait.Advance(ref s, 3, 0, 1f / 60f, East, 10);
            var copy = s;
            Gait.Advance(ref s, 3, 0, 0f, East, 10);
            Gait.Advance(ref s, 3, 0, -1f, East, 10);
            Gait.Advance(ref s, float.NaN, 0, 0.016f, East, 10);
            Assert.AreEqual(copy.Phase, s.Phase);
            Assert.AreEqual(copy.VelX, s.VelX);
            Assert.IsFalse(Gait.Advance(ref s, 500, 0, 0.016f, East, 10)); // teleport
            Assert.AreEqual(0f, s.VelX);
            Assert.IsFalse(float.IsNaN(s.Phase));
        }

        [TestCase(-1f, 8, 7)]
        [TestCase(-8.5f, 8, 7)]
        [TestCase(0f, 8, 0)]
        [TestCase(7.99f, 8, 7)]
        [TestCase(9.2f, 8, 1)]
        [TestCase(5f, 1, 0)]
        public void FrameIndexWraps(float phase, int count, int expected) { Assert.AreEqual(expected, Gait.FrameIndex(phase, count)); }

        [Test]
        public void HoldBridgesSnapshotRateGaps()
        {
            var s = new GaitState();
            float dt = 1f / 60f;
            Gait.Advance(ref s, 170f * dt, 0, dt, East, 10, 0.12f);
            Gait.Advance(ref s, 170f * dt, 0, dt, East, 10, 0.12f);
            Assert.IsTrue(Gait.Advance(ref s, 0, 0, dt, East, 10, 0.12f));
            Assert.IsTrue(Gait.Advance(ref s, 0, 0, dt, East, 10, 0.12f));
            Assert.IsTrue(s.Walking);
            for (int i = 0; i < 10; i++) Gait.Advance(ref s, 0, 0, dt, East, 10, 0.12f);
            Assert.IsFalse(s.Walking);
        }
    }
}

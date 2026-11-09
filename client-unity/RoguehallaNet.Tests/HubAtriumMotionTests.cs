using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public sealed class HubAtriumMotionTests
    {
        [Test]
        public void KeyboardMovementCapsDiagonalSpeedAndStaysInsideCosmeticFloor()
        {
            var motion = new HubAtriumMotion(.5f, .5f);
            Assert.IsTrue(motion.Move(1f, 1f, .1f, 1f));
            float dx = motion.X - .5f, dy = motion.Y - .5f;
            Assert.That(dx, Is.EqualTo(dy).Within(.00001f));
            Assert.That(dx * dx + dy * dy, Is.EqualTo(.01f).Within(.0001f));

            var edge = new HubAtriumMotion(.01f, .99f);
            edge.Move(-1f, 1f, 1f, 1f);
            Assert.AreEqual(0f, edge.X);
            Assert.AreEqual(1f, edge.Y);
        }

        [Test]
        public void ClickWalkArrivesWithoutOvershootAndEFindsNearestStationOnlyInRange()
        {
            var motion = new HubAtriumMotion(.4f, .4f);
            var target = new HubPoint(.7f, .4f);
            Assert.IsFalse(motion.MoveToward(target, .1f, 1f));
            Assert.That(motion.X, Is.EqualTo(.5f).Within(.00001f));
            Assert.IsFalse(motion.MoveToward(target, .1f, 1f));
            Assert.IsTrue(motion.MoveToward(target, .1f, 1f));
            Assert.AreEqual(.7f, motion.X);

            var stations = new[] { new HubPoint(.68f, .4f), new HubPoint(.74f, .4f) };
            Assert.AreEqual(0, motion.FindNearby(stations, .05f), "E chooses the nearest station and preserves ties by array order.");
            Assert.AreEqual(-1, motion.FindNearby(stations, .01f));
            Assert.AreEqual(-1, motion.FindNearby(null, .2f));
        }

        [Test]
        public void InvalidOrPausedMovementDoesNotChangeTheCosmeticPosition()
        {
            var motion = new HubAtriumMotion(.25f, .75f);
            Assert.IsFalse(motion.Move(1f, 0f, 0f, 1f));
            Assert.IsFalse(motion.Move(float.NaN, 1f, .1f, 1f));
            Assert.IsFalse(motion.MoveToward(new HubPoint(1f, 1f), float.PositiveInfinity, 1f));
            Assert.AreEqual(.25f, motion.X);
            Assert.AreEqual(.75f, motion.Y);
        }
    }
}

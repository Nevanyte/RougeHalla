using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public sealed class MinimapGestureTests
    {
        static RoutePoint P(double x, double y) => new RoutePoint(x, y);

        [Test]
        public void RightPressEmitsInitialMoveThenLatestChangedPointAtMostEveryHundredMs()
        {
            var gesture = new MinimapGesture();
            Assert.AreEqual(P(0, 0), gesture.Press(MinimapButton.Right, P(0, 0), 10));
            Assert.IsTrue(gesture.IsSteering);
            gesture.Drag(MinimapButton.Right, P(10, 20));
            Assert.IsNull(gesture.Tick(109));
            Assert.AreEqual(P(10, 20), gesture.Tick(110));
            gesture.Drag(MinimapButton.Right, P(15, 25));
            Assert.IsNull(gesture.Tick(209));
            Assert.IsNull(gesture.Tick(208), "a backwards clock value cannot make an intent early");
            Assert.AreEqual(P(15, 25), gesture.Tick(210));
            Assert.IsNull(gesture.Tick(210), "same coordinates never resend");
        }

        [Test]
        public void RightReleaseFlushesChangedFinalDestinationEvenBeforeThrottleAndOnlyOnce()
        {
            var gesture = new MinimapGesture();
            gesture.Press(MinimapButton.Right, P(2, 3), 0);
            gesture.Drag(MinimapButton.Right, P(8, 9));
            Assert.AreEqual(P(8, 9), gesture.Release(MinimapButton.Right, 20));
            Assert.IsFalse(gesture.IsSteering);
            Assert.IsNull(gesture.Release(MinimapButton.Right, 21));
            Assert.IsNull(gesture.Tick(500));
        }

        [Test]
        public void ReleasingLeftPeekPreservesRightSteeringAndTheTwoPointsAreIndependent()
        {
            var gesture = new MinimapGesture();
            gesture.Press(MinimapButton.Left, P(0, 0), 0);
            gesture.Press(MinimapButton.Right, P(100, 100), 1);
            gesture.Drag(MinimapButton.Left, P(10, 20));
            gesture.Drag(MinimapButton.Right, P(80, 90));
            Assert.AreEqual(P(10, 20), gesture.PeekPoint);
            Assert.IsTrue(gesture.IsPeeking);
            Assert.IsTrue(gesture.IsSteering);
            Assert.IsNull(gesture.Release(MinimapButton.Left, 2));
            Assert.IsFalse(gesture.IsPeeking);
            Assert.IsTrue(gesture.IsSteering);
            Assert.AreEqual(P(80, 90), gesture.Release(MinimapButton.Right, 3));
        }

        [Test]
        public void RepeatedPointDoesNotResendAndBlurDropsQueuedDestination()
        {
            var gesture = new MinimapGesture();
            gesture.Press(MinimapButton.Right, P(4, 5), 0);
            gesture.Drag(MinimapButton.Right, P(4, 5));
            Assert.IsNull(gesture.Tick(100));
            gesture.Drag(MinimapButton.Right, P(40, 50));
            gesture.Abort();
            Assert.IsFalse(gesture.IsPeeking);
            Assert.IsFalse(gesture.IsSteering);
            Assert.IsNull(gesture.Tick(500));
            Assert.IsNull(gesture.Release(MinimapButton.Right, 501));
        }

        [Test]
        public void CancellingLostRightCaptureDropsQueuedMoveAndPreservesIndependentPeek()
        {
            var gesture = new MinimapGesture();
            gesture.Press(MinimapButton.Left, P(10, 20), 0);
            gesture.Press(MinimapButton.Right, P(30, 40), 1);
            gesture.Drag(MinimapButton.Right, P(80, 90));
            gesture.Cancel(MinimapButton.Right);
            Assert.IsTrue(gesture.IsPeeking); Assert.IsFalse(gesture.IsSteering);
            Assert.IsNull(gesture.Tick(200)); Assert.IsNull(gesture.Release(MinimapButton.Right, 201));
            gesture.Cancel(MinimapButton.Left); Assert.IsFalse(gesture.IsPeeking);
        }

        [Test]
        public void CoordinatesAtAllMapCornersArePreservedWithoutClamping()
        {
            var gesture = new MinimapGesture();
            Assert.AreEqual(P(0, 0), gesture.Press(MinimapButton.Right, P(0, 0), 0));
            gesture.Drag(MinimapButton.Right, P(100, 100));
            Assert.AreEqual(P(100, 100), gesture.Release(MinimapButton.Right, 1));
            gesture.Press(MinimapButton.Left, P(0, 100), 2);
            Assert.AreEqual(P(0, 100), gesture.PeekPoint);
            gesture.Drag(MinimapButton.Left, P(100, 0));
            Assert.AreEqual(P(100, 0), gesture.PeekPoint);
        }
    }
}

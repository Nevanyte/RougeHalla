using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    /// <summary>The pixel rule that removes the baked ground shadow from actor frames (owner decision 2026-11-10; docs/rework/CONTRAST_GATE.md).</summary>
    public class ActorShadowStripTests
    {
        static byte[] Image(int w, int h, System.Func<int, int, byte> alpha)
        {
            var px = new byte[w * h * 4];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int i = (y * w + x) * 4; byte a = alpha(x, y); px[i] = 90; px[i + 1] = 80; px[i + 2] = 70; px[i + 3] = a; }
            return px;
        }

        public static int Alpha(byte[] px, int w, int x, int y) { return px[(y * w + x) * 4 + 3]; }

        [Test] public void ASoftShadowBesideTheBodyIsClearedAndItsEdgeAndTheBodyStay()
        {
            // 12x6: opaque body at x 1..3, a one pixel soft edge at x 4 (alpha 120), a soft shadow at x 5..10 (alpha 60), nothing at 11.
            var px = Image(12, 6, (x, y) => x >= 1 && x <= 3 ? (byte)255 : x == 4 ? (byte)120 : x >= 5 && x <= 10 ? (byte)60 : (byte)0);
            var before = (byte[])px.Clone();
            int cleared = ActorShadowStrip.Strip(px, 12, 6);
            Assert.AreEqual(6 * 6, cleared);
            for (int y = 0; y < 6; y++)
            {
                for (int x = 1; x <= 3; x++) Assert.AreEqual(255, Alpha(px, 12, x, y));
                Assert.AreEqual(120, Alpha(px, 12, 4, y), "the anti-aliased edge stays");
                for (int x = 5; x <= 10; x++) { Assert.AreEqual(0, Alpha(px, 12, x, y), "shadow at " + x); Assert.AreEqual(0, px[(y * 12 + x) * 4], "rgb is cleared too"); }
            }
            for (int i = 0; i < px.Length; i += 4) if (before[i + 3] >= ActorShadowStrip.OpaqueMin) for (int c = 0; c < 4; c++) Assert.AreEqual(before[i + c], px[i + c], "opaque pixels are untouched");
        }

        [Test] public void NoSemiTransparentPixelFartherThanOnePixelFromAnOpaqueOneRemains()
        {
            var rnd = new System.Random(7);
            var px = Image(40, 30, (x, y) => (byte)(x > 10 && x < 20 && y > 5 && y < 25 ? 255 : rnd.Next(0, 3) == 0 ? 0 : rnd.Next(1, 204)));
            ActorShadowStrip.Strip(px, 40, 30);
            AssertCleanAnywhere(px, 40, 30);
        }

        public static void AssertCleanAnywhere(byte[] px, int w, int h)
        {
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int a = Alpha(px, w, x, y);
                if (a == 0 || a >= ActorShadowStrip.OpaqueMin) continue;
                bool near = false;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                {
                    int xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    if (Alpha(px, w, xx, yy) >= ActorShadowStrip.OpaqueMin) near = true;
                }
                Assert.IsTrue(near, "semi-transparent pixel at " + x + "," + y + " alpha " + a + " is farther than 1 px from an opaque one");
            }
        }

        [Test] public void ApplyingTheRuleTwiceChangesNothingAndAFullyOpaqueOrEmptyImageIsUntouched()
        {
            var rnd = new System.Random(3);
            var px = Image(32, 32, (x, y) => (byte)(rnd.Next(0, 4) == 0 ? 255 : rnd.Next(0, 200)));
            ActorShadowStrip.Strip(px, 32, 32);
            var once = (byte[])px.Clone();
            Assert.AreEqual(0, ActorShadowStrip.Strip(px, 32, 32));
            CollectionAssert.AreEqual(once, px);
            var solid = Image(8, 8, (x, y) => 255); Assert.AreEqual(0, ActorShadowStrip.Strip(solid, 8, 8));
            var empty = Image(8, 8, (x, y) => 0); Assert.AreEqual(0, ActorShadowStrip.Strip(empty, 8, 8));
        }

        [Test] public void AnIsolatedSoftPixelWithNoOpaqueNeighbourIsRemovedAndADiagonalNeighbourKeepsOne()
        {
            var px = Image(5, 5, (x, y) => x == 0 && y == 0 ? (byte)255 : (x == 1 && y == 1) ? (byte)100 : (x == 4 && y == 4) ? (byte)100 : (byte)0);
            ActorShadowStrip.Strip(px, 5, 5);
            Assert.AreEqual(100, Alpha(px, 5, 1, 1)); Assert.AreEqual(0, Alpha(px, 5, 4, 4));
        }
    }
}

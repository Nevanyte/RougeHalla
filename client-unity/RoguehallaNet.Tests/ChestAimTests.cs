using System;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>ADR0024 P-HB-8 aim maths: the raised projectile leaves the chest and passes through the cursor.</summary>
    public class ChestAimTests
    {
        [Test]
        public void ZeroChestIsTheLegacyFeetToCursorAngle()
        {
            for (int i = 0; i < 64; i++)
            {
                double ox = 100 + i * 3.7, oy = 80 - i * 1.3, cx = ox + 50 * Math.Cos(i), cy = oy + 40 * Math.Sin(i * 1.7);
                Assert.AreEqual(Math.Atan2(cy - oy, cx - ox), ChestAim.Angle(ox, oy, cx, cy, 0.0), 0.0);
            }
        }

        [Test]
        public void TheRaisedLineLeavesTheChestAndPassesThroughTheCursor()
        {
            foreach (double h in new[] { 11.0, 19.0, 30.0, 35.0 })
                for (int i = 0; i < 90; i++)
                {
                    double ox = 640, oy = 500;
                    double ang = i * Math.PI / 45.0 + 0.01, dist = 40 + 7 * i;
                    // The cursor point as the camera sees it, on the raised plane at that screen spot, mapped to the ground.
                    double cx = ox + dist * Math.Cos(ang), cy = oy + dist * Math.Sin(ang);
                    double a = ChestAim.Angle(ox, oy, cx, cy, h);
                    // Drawn track: ground track from the feet along a, drawn at (x, y - h).
                    double ca = Math.Cos(a), sa = Math.Sin(a);
                    if (Math.Abs(ca) < 1e-6) continue; // a vertical shot: solve with y instead
                    double t = (cx - ox) / ca;
                    double drawnY = oy + t * sa - h;
                    Assert.AreEqual(cy, drawnY, 1e-9, "h " + h + " angle " + ang);
                }
        }

        [Test]
        public void TheTargetIsTheCursorShiftedTowardScreenDown()
        {
            ChestAim.Target(300, 200, 30, out double tx, out double ty);
            Assert.AreEqual(300, tx); Assert.AreEqual(230, ty);
            Assert.AreEqual(Math.Atan2(230 - 200, 300 - 100), ChestAim.Angle(100, 200, 300, 200, 30), 0.0);
        }

        [Test]
        public void AShotAtACursorLevelWithTheFeetTiltsBelowTheHorizontalByTheChest()
        {
            // Cursor straight east of the feet: the ground line must tilt south so the raised line rises back to it.
            double a = ChestAim.Angle(0, 0, 100, 0, 30);
            Assert.Greater(a, 0.0);
            Assert.AreEqual(Math.Atan2(30, 100), a, 1e-12);
        }

        [Test]
        public void ChestComesFromTheWelcomeTableAndIsZeroWithoutIt()
        {
            var table = HitboxPredictionTests.TableFromFixture();
            var hero = WireArchetype.Find(table, 1);
            Assert.AreEqual((double)hero.Chest, ChestAim.ChestOf(table, 1));
            Assert.AreEqual(0.0, ChestAim.ChestOf(table, 0), "legacy row");
            Assert.AreEqual(0.0, ChestAim.ChestOf(null, 1), "no table");
            Assert.AreEqual(0.0, ChestAim.ChestOf(table, 200), "unknown id");
        }
    }
}

using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public class InputLatencyTrackerTests
    {
        [Test]
        public void MeasuresLocalThenServerAndCompletes()
        {
            var t = new InputLatencyTracker();
            t.KeyDown(1000, 1008, 5, 5, 5, 5);
            Assert.IsNull(t.Update(1010, 5, 5, 5, 5));
            Assert.IsNull(t.Update(1025, 7, 5, 5, 5));
            var line = t.Update(1090, 9, 5, 6, 5);
            StringAssert.Contains("key->frame 8.0", line);
            StringAssert.Contains("key->local 25.0", line);
            StringAssert.Contains("key->server 90.0", line);
            Assert.AreEqual(1, t.Samples);
            Assert.IsNull(t.Update(1100, 10, 5, 7, 5));
        }

        [Test]
        public void TimesOutWithoutServerMotion()
        {
            var t = new InputLatencyTracker();
            t.KeyDown(0, 1, 0, 0, 0, 0);
            t.Update(20, 1, 0, 0, 0);
            var line = t.Update(2500, 3, 0, 0, 0);
            StringAssert.Contains("key->server none", line);
        }

        [Test]
        public void SummaryPercentiles()
        {
            var t = new InputLatencyTracker();
            for (int i = 1; i <= 20; i++)
            {
                t.KeyDown(0, 0, 0, 0, 0, 0);
                t.Update(i * 10, 1, 0, 1, 0);
            }
            var s = t.Summary();
            StringAssert.Contains("n=20", s);
            StringAssert.Contains("local p50 100.0 p95 190.0", s);
        }
    }
}

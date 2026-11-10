using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    public class OrderBudgetTests
    {
        [Test]
        public void BurstThenRate()
        {
            var b = new OrderBudget(10, 3);
            Assert.IsTrue(b.TryTake(0)); Assert.IsTrue(b.TryTake(0)); Assert.IsTrue(b.TryTake(0));
            Assert.IsFalse(b.TryTake(0));
            Assert.IsFalse(b.TryTake(50));
            Assert.IsTrue(b.TryTake(100));
        }

        [Test]
        public void SpendAlwaysSucceedsAndMakesRepeatsBackOff()
        {
            var b = new OrderBudget(10, 3);
            for (int i = 0; i < 10; i++) b.Spend(0);
            Assert.Less(b.Tokens, 0);
            Assert.IsFalse(b.TryTake(100));
            Assert.IsTrue(b.TryTake(600));
        }

        [Test]
        public void SteadyRepeatAt100msFitsTheBudget()
        {
            var b = new OrderBudget();
            int sent = 0;
            for (int t = 0; t < 5000; t += 100) if (b.TryTake(t)) sent++;
            Assert.AreEqual(50, sent);
        }

        [Test]
        public void ClockStepBackDoesNotCreateTokens()
        {
            var b = new OrderBudget(10, 2);
            b.TryTake(1000); b.TryTake(1000);
            Assert.IsFalse(b.TryTake(500));
        }

        [Test]
        public void StopRetriesOnlyWhileUnechoedAndAtMostTwice()
        {
            var r = new StopRetry();
            r.Sent(0, true);
            Assert.IsFalse(r.Due(100, true));
            Assert.IsTrue(r.Due(150, true));
            r.Sent(150, false);
            Assert.IsTrue(r.Due(300, true));
            r.Sent(300, false);
            Assert.IsFalse(r.Due(500, true));
            Assert.IsFalse(r.Armed);
        }

        [Test]
        public void EchoDisarms()
        {
            var r = new StopRetry();
            r.Sent(0, true);
            Assert.IsFalse(r.Due(200, false));
            Assert.IsFalse(r.Armed);
        }
    }
}

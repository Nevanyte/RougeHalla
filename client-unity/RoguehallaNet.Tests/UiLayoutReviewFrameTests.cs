using System.Linq;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class UiLayoutReviewFrameTests
    {
        [TestCase("hud")]
        [TestCase("planning")]
        [TestCase("map")]
        public void ActualOfflineReviewFramesRoundtripAndAdvanceWithoutPresentationClockCuts(string mode)
        {
            var state = UiLayoutReviewFrames.State(mode, 100);
            CollectionAssert.AreEqual(Enumerable.Range(1, 10).Select(x => (uint)x), state.Items.Select(x => x.Key));
            var decoded = (ServerMsg.State)ServerMsg.Decode(state.Encode());
            Assert.AreEqual(10, decoded.Items.Length);

            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://127.0.0.1/layout-review", Profile = "Layout review", Now = () => 0 });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Tick = 100, ServerMs = 5000, Map = UiLayoutReviewFrames.Map() });
            transport.Deliver(state);
            transport.Deliver(UiLayoutReviewFrames.Snapshot(mode, 100));
            Assert.AreEqual(SessionState.InMatch, session.State);
            Assert.IsTrue(session.Collections.HasFullState);
            Assert.IsNotNull(session.Collections.Quests);
            Assert.IsFalse(session.Collections.Quests.Available);
            Assert.AreEqual(mode == "planning" ? MatchPhase.Planning : MatchPhase.Active, session.Phase);
            Assert.AreEqual(mode == "planning", session.Collections.Plan != null);
            var inventory = session.Collections.Inventory.Value;
            Assert.AreEqual(5, inventory.PotionSmall); Assert.AreEqual(5, inventory.PotionLarge); Assert.AreEqual(3, inventory.PotionsHealing);
            if (mode == "planning")
            {
                var plan = session.Collections.Plan;
                Assert.IsTrue(plan.Pick.HasValue && plan.Pick.Value < 2);
                Assert.IsTrue(plan.Boon.HasValue && plan.Boon.Value < plan.Boons.Count);
                foreach (var option in new[] { plan.Option0.Value, plan.Option1.Value })
                {
                    Assert.IsTrue(option.X >= 0 && option.X < session.Map.W * 32);
                    Assert.IsTrue(option.Y >= 0 && option.Y < session.Map.H * 32);
                    Assert.IsTrue(option.Zone >= 1 && option.Zone <= 5);
                }
            }
            Assert.AreEqual(80, session.Collections.Cards.Count); Assert.IsTrue(session.Collections.Cards.All(x => x == 255));
            Assert.AreEqual(7, session.Latest.Actors.Length);
            Assert.AreEqual(79, (byte)session.Collections.RewardChests[0].Options[1].Card.Value);
            Assert.AreEqual(99999f, session.Me.MaxHp);
            uint epoch = session.TimelineEpoch;
            transport.Deliver(UiLayoutReviewFrames.Snapshot(mode, 101));
            Assert.AreEqual(5050, session.ServerTimeMs); Assert.AreEqual(epoch, session.TimelineEpoch);
            session.Leave();
        }
    }
}

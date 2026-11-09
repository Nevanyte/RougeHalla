using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public sealed class PlanningSelectionsTests
    {
        static ServerMsg.Welcome Welcome() => new ServerMsg.Welcome
        {
            Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3,
            TickRate = 20, Map = new MapBlob(4, 4, new byte[16])
        };

        static WirePlan Deal(byte? pick = null, byte? boon = null, bool ready = false, bool taken0 = false, bool taken1 = false, double endsAt = 1000)
        {
            return new WirePlan { EndsAt = endsAt, Spawn0 = 5, Spawn1 = 8, Taken0 = taken0, Taken1 = taken1,
                Pick = pick, Boon = boon, Ready = ready, Boons = new[] { "first", "second" } };
        }

        sealed class Fixture
        {
            public readonly FakeTransport Transport = new FakeTransport();
            public readonly Session Session;
            public readonly InputSender Sender = new InputSender();
            public readonly PlanningSelections Selections = new PlanningSelections();
            public Fixture()
            {
                Session = new Session(Transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>() });
                Session.Connect(); Transport.Open(); Transport.Deliver(Welcome());
                SendPlan(Deal());
                Selections.Update(Session.Collections.Plan, true, 0);
            }
            public void SendPlan(WirePlan value)
            {
                Transport.Deliver(new ServerMsg.State { Tick = 1, Items = new StateItem[] { new PlanState { Value = value } } });
            }
            public WireCommand[] FlushCommands()
            {
                return Sender.Flush(0).SelectMany(x => x.Commands).ToArray();
            }
        }

        [Test]
        public void SpawnChoiceQueuesOneWireIntentAndOnlyServerStateConfirmsIt()
        {
            var f = new Fixture();
            Assert.IsTrue(f.Selections.CanPickSpawn(1));
            Assert.IsTrue(f.Selections.TryPickSpawn(1, f.Sender, 10));
            Assert.IsFalse(f.Selections.TryPickSpawn(1, f.Sender, 11), "duplicate clicks wait for confirmation");
            Assert.AreEqual((byte)1, f.Selections.PendingSpawn);
            Assert.IsNull(f.Selections.ConfirmedSpawn, "pending intent does not masquerade as a server pick");
            var command = f.FlushCommands().Single();
            Assert.AreEqual(CommandKind.Plan, command.Kind);
            Assert.AreEqual((byte)1, command.Spawn);
            Assert.IsNull(command.Boon);
            Assert.IsNull(command.Ready);
            var decoded = (ClientMsg.Input)ClientMsg.Decode(new ClientMsg.Input { Seq = 0, Commands = new System.Collections.Generic.List<WireCommand> { command } }.Encode());
            Assert.AreEqual((byte)1, decoded.Commands.Single().Spawn);

            f.SendPlan(Deal(pick: 1));
            f.Selections.Update(f.Session.Collections.Plan, true, 20);
            Assert.IsNull(f.Selections.PendingSpawn);
            Assert.AreEqual((byte)1, f.Selections.ConfirmedSpawn);
            StringAssert.Contains("confirmed by the server", f.Selections.Feedback);
        }

        [Test]
        public void BoonChoiceUsesExistingPlanCommandAndDealIndex()
        {
            var f = new Fixture();
            Assert.IsTrue(f.Selections.CanPickBoon(1));
            Assert.IsTrue(f.Selections.TryPickBoon(1, f.Sender, 4));
            var command = f.FlushCommands().Single();
            Assert.AreEqual(CommandKind.Plan, command.Kind);
            Assert.IsNull(command.Spawn);
            Assert.AreEqual((byte)1, command.Boon);
            Assert.IsNull(command.Ready);
            Assert.DoesNotThrow(() => new ClientMsg.Input { Seq = 0, Commands = new System.Collections.Generic.List<WireCommand> { command } }.Encode());
            f.SendPlan(Deal(boon: 1));
            f.Selections.Update(f.Session.Collections.Plan, true, 5);
            Assert.IsNull(f.Selections.PendingBoon);
            Assert.AreEqual((byte)1, f.Selections.ConfirmedBoon);
        }

        [Test]
        public void TakenSpawnSettlesPendingImmediatelyAndReadyTimeoutNeverFakesConfirmation()
        {
            var f = new Fixture();
            Assert.IsTrue(f.Selections.TryPickSpawn(1, f.Sender, 10));
            f.SendPlan(Deal(taken1: true));
            f.Selections.Update(f.Session.Collections.Plan, true, 11);
            Assert.IsNull(f.Selections.PendingSpawn);
            StringAssert.Contains("taken by another player", f.Selections.Feedback);

            Assert.IsTrue(f.Selections.TryReady(f.Sender, 20));
            Assert.IsTrue(f.Selections.PendingReady);
            Assert.IsFalse(f.Selections.ServerReady);
            Assert.IsFalse(f.Selections.CanReady);
            var ready = f.FlushCommands().Last();
            Assert.AreEqual(CommandKind.Plan, ready.Kind);
            Assert.AreEqual(true, ready.Ready);
            f.Selections.Update(f.Session.Collections.Plan, true, 620);
            Assert.IsFalse(f.Selections.PendingReady);
            Assert.IsFalse(f.Selections.ServerReady, "local timeout cannot make Ready authoritative");
            Assert.IsTrue(f.Selections.CanReady, "timeout lets the player retry");
        }

        [Test]
        public void ReconnectClearsPendingPreservesServerFactsAndLateAckIsStillAuthoritative()
        {
            var f = new Fixture();
            f.SendPlan(Deal(pick: 0));
            f.Selections.Update(f.Session.Collections.Plan, true, 1);
            Assert.IsTrue(f.Selections.TryPickBoon(1, f.Sender, 2));
            f.Selections.Update(f.Session.Collections.Plan, false, 3);
            Assert.IsFalse(f.Selections.IsConnected);
            Assert.IsNull(f.Selections.PendingBoon);
            Assert.AreEqual((byte)0, f.Selections.ConfirmedSpawn);
            Assert.IsFalse(f.Selections.TryReady(f.Sender, 4));
            f.Selections.Update(null, false, 5);
            Assert.AreEqual((byte)0, f.Selections.ConfirmedSpawn, "temporary empty disconnected collection keeps last confirmation");
            f.Selections.Update(f.Session.Collections.Plan, true, 6);
            Assert.IsTrue(f.Selections.IsConnected);
            Assert.IsTrue(f.Selections.TryPickBoon(1, f.Sender, 7));
            f.Selections.Update(f.Session.Collections.Plan, true, 608);
            Assert.IsNull(f.Selections.PendingBoon);
            f.SendPlan(Deal(pick: 0, boon: 1));
            f.Selections.Update(f.Session.Collections.Plan, true, 609);
            Assert.AreEqual((byte)1, f.Selections.ConfirmedBoon, "late reliable acknowledgment becomes the owned fact");
            Assert.IsNull(f.Selections.PendingBoon);
        }

        [Test]
        public void NewDealClearsPendingAndServerReadyCannotBeOverridden()
        {
            var f = new Fixture();
            Assert.IsTrue(f.Selections.TryPickSpawn(1, f.Sender, 1));
            f.SendPlan(Deal(endsAt: 2000));
            f.Selections.Update(f.Session.Collections.Plan, true, 2);
            Assert.IsNull(f.Selections.PendingSpawn);
            StringAssert.Contains("options changed", f.Selections.Feedback);
            f.SendPlan(Deal(pick: 0, ready: true, endsAt: 2000));
            f.Selections.Update(f.Session.Collections.Plan, true, 3);
            Assert.IsTrue(f.Selections.ServerReady);
            Assert.IsFalse(f.Selections.CanReady);
            Assert.IsFalse(f.Selections.TryPickSpawn(1, f.Sender, 4));
            Assert.AreEqual((byte)0, f.Selections.ConfirmedSpawn);
        }
    }
}

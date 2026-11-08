using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class WishSessionTests
    {
        sealed class QueuedTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            readonly Queue<byte[]> incoming = new Queue<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (incoming.Count != 0) Received(incoming.Dequeue()); }
            public void Open() { Opened(); }
            public void Enqueue(ServerMsg msg, uint? ack = null)
            {
                if (ack.HasValue && msg is ServerMsg.Snapshot snapshot) snapshot.AckInput = ack.Value;
                incoming.Enqueue(msg.Encode());
            }
            public T LastSent<T>() where T : ClientMsg
            {
                for (int k = Sent.Count - 1; k >= 0; k--) if (ClientMsg.Decode(Sent[k]) is T one) return one;
                throw new Exception("No matching sent frame");
            }
        }

        static WireSelf Self(float x = 100, byte seq = 0)
        { return new WireSelf { Id = 3, X = x, Y = 100, Hp = 10, MaxHp = 10, Status = 1, MoveSeq = seq }; }
        static ServerMsg.Snapshot Snapshot(uint tick, WireSelf self, double? time = null)
        { return new ServerMsg.Snapshot { Tick = tick, Phase = 1, Me = self, ServerTimeOverrideMs = time }; }
        static ServerMsg.Welcome Welcome()
        {
            return new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3,
                Session = new byte[16], TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(32, 32, new byte[1024]) };
        }
        static Session Start(QueuedTransport t, Func<double> now, WireSelf self = null, double? time = null)
        {
            var s = new Session(t, new SessionOptions { Url = "ws://test/ws", Profile = "p", Now = now });
            s.Connect(); t.Open(); t.Enqueue(Welcome()); t.Enqueue(Snapshot(1, self ?? Self(), time)); s.Poll();
            return s;
        }

        [Test]
        public void CastLeavesInTheCollectedFrameWithoutChangingTheWalkOrInventingAnAbility()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            byte move = s.OrderMove(600, 100);
            byte cast = s.Cast(0, 120, 200, 19, -25); // finite client time is admitted/clamped by the server
            s.FlushInput();
            var input = t.LastSent<ClientMsg.Input>();
            Assert.AreEqual(2, input.Commands.Count);
            Assert.AreEqual(CommandKind.Move, input.Commands[0].Kind);
            var c = input.Commands[1]; Assert.AreEqual(CommandKind.Cast, c.Kind);
            Assert.AreEqual(0, c.Slot); Assert.AreEqual(120, c.X); Assert.AreEqual(200, c.Y);
            Assert.AreEqual(19, c.ActorRef); Assert.AreEqual(-25, c.T); Assert.AreEqual(cast, c.Seq);
            Assert.AreEqual((byte)(move + 1), cast); Assert.IsTrue(s.Motion.OrderPending);
            now = 50; s.Poll(); Assert.Greater(s.Motion.DrawnX, 100, "Cast does not predict a root or cancel a walk");
        }

        [Test]
        public void MoveThenRefusedCastEchoAcknowledgesTheMoveAndPreservesItsDestination()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            s.OrderMove(600, 100); byte cast = s.Cast(0, 120, 200); s.FlushInput();
            now = 50; t.Enqueue(Snapshot(2, Self(108.5f, cast)), t.LastSent<ClientMsg.Input>().Seq); s.Poll();
            Assert.IsFalse(s.Motion.OrderPending, "a cast can echo even when gameplay refuses it");
            Assert.AreEqual(108.5f, s.Motion.SimX);
            now = 100; s.Poll(); Assert.Greater(s.Motion.DrawnX, 108.5f);
        }

        [Test]
        public void CastBeforeANewerMoveCannotAcknowledgeThatMove()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            byte cast = s.Cast(0, 120, 200); byte move = s.OrderMove(600, 100); s.FlushInput();
            var sent = t.LastSent<ClientMsg.Input>();
            Assert.AreEqual(CommandKind.Cast, sent.Commands[0].Kind); Assert.AreEqual(CommandKind.Move, sent.Commands[1].Kind);
            now = 50; t.Enqueue(Snapshot(2, Self(100, cast))); s.Poll(); Assert.IsTrue(s.Motion.OrderPending);
            now = 100; t.Enqueue(Snapshot(3, Self(117, move)), t.LastSent<ClientMsg.Input>().Seq); s.Poll(); Assert.IsFalse(s.Motion.OrderPending);
        }

        [Test]
        public void CoalescedAndWrappedOrdersKeepOnlyAliasesAfterTheCurrentMove()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            for (int k = 0; k < 254; k++) s.Input.Stop(); // advance the shared wire byte counter
            s.FlushInput();
            Assert.AreEqual(255, s.OrderMove(500, 100)); byte oldCast = s.Cast(0, 120, 200);
            Assert.AreEqual(1, oldCast);
            byte move = s.OrderMove(600, 100); byte newCast = s.Cast(0, 120, 200); s.FlushInput();
            Assert.AreEqual(2, move); Assert.AreEqual(3, newCast);
            now = 50; t.Enqueue(Snapshot(2, Self(108.5f, oldCast))); s.Poll(); Assert.IsTrue(s.Motion.OrderPending);
            now = 100; t.Enqueue(Snapshot(3, Self(117, newCast)), t.LastSent<ClientMsg.Input>().Seq); s.Poll(); Assert.IsFalse(s.Motion.OrderPending);
            now = 150; s.Poll(); Assert.Greater(s.Motion.DrawnX, 117);
        }

        [Test]
        public void CastDoesNotExtendThePendingMovementLifetimeAndStopReplacesItsAliases()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            s.OrderMove(600, 100); s.FlushInput(); now = 999; byte cast = s.Cast(0, 120, 200); s.FlushInput();
            now = 1000; s.Poll(); Assert.IsFalse(s.Motion.OrderPending); Assert.AreEqual(1, s.Motion.ExpiredOrders);
            s.OrderMove(600, 100); cast = s.Cast(0, 120, 200); byte stop = s.OrderStop(); s.FlushInput();
            now = 1050; t.Enqueue(Snapshot(2, Self(110, cast))); s.Poll(); Assert.IsTrue(s.Motion.OrderPending);
            now = 1100; t.Enqueue(Snapshot(3, Self(110, stop)), t.LastSent<ClientMsg.Input>().Seq); s.Poll(); Assert.IsFalse(s.Motion.OrderPending);
        }

        [Test]
        public void MalformedCastIsDroppedWithoutSpendingAnOrderNumber()
        {
            var input = new InputSender();
            Assert.AreEqual(0, input.Cast(3, 1, 2)); Assert.AreEqual(0, input.Cast(0, float.NaN, 2));
            Assert.AreEqual(0, input.Cast(0, 1, 2, 0)); Assert.AreEqual(0, input.Cast(0, 1, 2, null, double.PositiveInfinity));
            Assert.AreEqual(4, input.Dropped); Assert.AreEqual(1, input.Cast(2, 1, 2));
            var frame = input.Flush(0); Assert.AreEqual(1, frame[0].Commands.Count);
            Assert.AreEqual(CommandKind.Cast, frame[0].Commands[0].Kind);
        }

        [Test]
        public void RealWishCollectorUsesOnlyPressUiAndLifecycleGatesAndKeepsTheBaselineRenderTime()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            Assert.AreEqual(0, s.CollectWishInput(false, false, true, 10, 20));
            Assert.AreEqual(0, s.CollectWishInput(true, true, true, 10, 20));
            Assert.AreEqual(0, s.CollectWishInput(true, false, false, 10, 20));
            // No Wish owner record (Off profile) is intentionally not a client eligibility rule.
            Assert.AreNotEqual(0, s.CollectWishInput(true, false, true, 10, 20)); s.FlushInput();
            var cast = t.LastSent<ClientMsg.Input>().Commands[0];
            Assert.AreEqual(CommandKind.Cast, cast.Kind); Assert.AreEqual(s.Clock.RenderMs, cast.T);
            var planning = Snapshot(2, Self()); planning.Phase = 3; t.Enqueue(planning); s.Poll();
            Assert.AreEqual(0, s.CollectWishInput(true, false, true, 10, 20));
            var dead = Self(); dead.Status = 2; t.Enqueue(Snapshot(3, dead)); s.Poll();
            Assert.AreEqual(0, s.CollectWishInput(true, false, true, 10, 20));
            t.Close(); Assert.AreEqual(0, s.CollectWishInput(true, false, true, 10, 20));
        }

        [Test]
        public void CastAliasRequiresItsSentFrameAndDoesNotReuseTheHeldAuthoritativeByte()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now);
            s.OrderMove(600, 100); byte cast = s.Cast(0, 120, 200);
            now = 10; t.Enqueue(Snapshot(2, Self(100, cast))); s.Poll();
            Assert.IsTrue(s.Motion.OrderPending, "a queued cast was not sent yet");
            s.FlushInput(); uint sent = t.LastSent<ClientMsg.Input>().Seq;
            now = 20; t.Enqueue(Snapshot(3, Self(100, cast))); s.Poll();
            Assert.IsTrue(s.Motion.OrderPending, "a fresh frame still predates the cast's input-frame receipt");
            now = 30; t.Enqueue(Snapshot(4, Self(100, cast)), sent); s.Poll();
            Assert.IsFalse(s.Motion.OrderPending);

            var wrapped = new QueuedTransport(); var other = Start(wrapped, () => now, Self(seq: 1));
            for (int k = 0; k < 254; k++) other.Input.Stop(); other.FlushInput();
            other.OrderMove(600, 100); Assert.AreEqual(1, other.Cast(0, 120, 200)); other.FlushInput();
            now = 50; wrapped.Enqueue(Snapshot(2, Self(100, 1)), wrapped.LastSent<ClientMsg.Input>().Seq); other.Poll();
            Assert.IsTrue(other.Motion.OrderPending, "the same previously held byte is ambiguous after wrap");
            now = 1030; other.Poll(); Assert.IsFalse(other.Motion.OrderPending);
            Assert.AreEqual(1, other.Motion.ExpiredOrders, "normal bounded expiry is retained rather than guessing an acknowledgement");
        }

        [TestCase(false)]
        [TestCase(true)]
        public void WrappedMoveOrStopNeedsItsOwnSentFrameEvenWhenTheHeldByteMatches(bool stop)
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now, Self(seq: 1));
            for (int k = 0; k < 255; k++) s.Input.Stop(); s.FlushInput();
            byte seq = stop ? s.OrderStop() : s.OrderMove(600, 100); Assert.AreEqual(1, seq);
            now = 10; t.Enqueue(Snapshot(2, Self(100, 1)), t.LastSent<ClientMsg.Input>().Seq); s.Poll();
            Assert.IsTrue(s.Motion.OrderPending, "the matching held byte predates transmission");
            s.FlushInput(); uint frame = t.LastSent<ClientMsg.Input>().Seq;
            now = 20; t.Enqueue(Snapshot(3, Self(100, 1)), frame - 1); s.Poll();
            Assert.IsTrue(s.Motion.OrderPending, "a receipt for an older frame cannot acknowledge a wrapped order");
            now = 30; t.Enqueue(Snapshot(4, Self(100, 1)), frame); s.Poll(); Assert.IsFalse(s.Motion.OrderPending);
        }

        [Test]
        public void OwnerWishDisplayFactsAreOwnedCopiesAndFullAbsenceClearsThem()
        {
            double now = 0; var t = new QueuedTransport(); var self = Self();
            self.Barrier = 7; self.BarrierRingStep = 2;
            self.Wish = new WireWishOwner { Ability = 3, ReadyAt = 50, FullAt = 80, MaxCharges = 2, Charges = 1,
                RechargeMs = 30, NextChargeAt = 80, Cast = new WireWishCast { Ability = 3, StartedAt = 10, LandsAt = 40 } };
            var s = Start(t, () => now, self);
            Assert.AreEqual(7, s.Me.Barrier); Assert.AreEqual(2, s.Me.BarrierRingStep);
            Assert.AreEqual(1, s.Me.Wish.Value.Charges); Assert.AreEqual(AbilityId.Blaze, s.Me.Wish.Value.Ability);
            s.Latest.Me.Wish.ReadyAt = 999; s.Latest.Me.Wish.Cast.LandsAt = 999;
            Assert.AreEqual(50, s.Me.Wish.Value.ReadyAt); Assert.AreEqual(40, s.Me.Wish.Value.Cast.Value.LandsAt);
            now = 50; t.Enqueue(Snapshot(2, Self())); s.Poll();
            Assert.IsNull(s.Me.Wish); Assert.AreEqual(0, s.Me.Barrier); Assert.AreEqual(0, s.Me.BarrierRingStep);
        }

        [Test]
        public void SourceClockCutsAcceptFreshTicksClearTemporalConsumersAndPreserveCanonicalStateAndWalk()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now, time: 1250);
            var transientCues = new List<double> { 1400 }; int resets = 0;
            s.TimelineReset += () => { resets++; transientCues.Clear(); };
            t.Enqueue(new ServerMsg.State { Tick = 1, Items = new StateItem[] {
                new InventoryState { Value = new WireInventory { PotionSmall = 2 } } } }); s.Poll();
            byte move = s.OrderMove(600, 100); byte cast = s.Cast(0, 120, 200); s.FlushInput();
            now = 50; t.Enqueue(Snapshot(2, Self(108.5f, cast), 1250), t.LastSent<ClientMsg.Input>().Seq); s.Poll();
            Assert.AreEqual(2, s.Latest.Tick); Assert.AreEqual(1250, s.ServerTimeMs);
            Assert.AreEqual(1, resets); Assert.IsEmpty(transientCues); Assert.AreEqual(1, s.Snapshots.Count);
            Assert.AreEqual(1150, s.Clock.RenderMs); Assert.IsFalse(s.Motion.OrderPending);
            Assert.AreEqual(2, s.Collections.Inventory.Value.PotionSmall);
            now = 100; t.Enqueue(Snapshot(3, Self(117, cast), 1200)); s.Poll();
            Assert.AreEqual(2, resets); Assert.AreEqual(1100, s.Clock.RenderMs); Assert.AreEqual(117, s.Motion.SimX);
            now = 150; s.Poll(); now = 200; s.Poll(); now = 250; s.Poll();
            Assert.Greater(s.Motion.DrawnX, 117, "the walk continues beyond authoritative x after its correction offset drains");
            t.Enqueue(Snapshot(4, Self(125.5f, cast))); s.Poll(); // default200, never inherit1200
            Assert.AreEqual(200, s.ServerTimeMs); Assert.AreEqual(100, s.Clock.RenderMs); Assert.AreEqual(3, resets);
            t.Enqueue(Snapshot(3, Self(999), 9999)); s.Poll();
            Assert.AreEqual(4, s.Latest.Tick); Assert.AreEqual(125.5f, s.Me.X); Assert.AreEqual(3, resets);
        }

        [Test]
        public void AClockCutRejectsDelayedOldPongsAndReconnectClearsOldWishAndMovement()
        {
            double now = 0; var t = new QueuedTransport(); var s = Start(t, () => now, time: 1250);
            var oldPing = t.LastSent<ClientMsg.Ping>();
            now = 10; t.Enqueue(new ServerMsg.Pong { Nonce = oldPing.Nonce, ClientMs = oldPing.ClientMs, ServerMs = 1260 }); s.Poll();
            Assert.IsTrue(s.Sync.HasSample);
            s.OrderMove(600, 100); s.Cast(0, 120, 200); s.FlushInput();
            now = 50; t.Enqueue(Snapshot(2, Self(108.5f), 100)); s.Poll();
            Assert.IsFalse(s.Sync.HasSample); var freshPing = t.LastSent<ClientMsg.Ping>();
            now = 60; t.Enqueue(new ServerMsg.Pong { Nonce = oldPing.Nonce, ClientMs = oldPing.ClientMs, ServerMs = 1300 }); s.Poll();
            Assert.IsFalse(s.Sync.HasSample);
            t.Enqueue(new ServerMsg.Pong { Nonce = freshPing.Nonce, ClientMs = freshPing.ClientMs, ServerMs = 110 }); s.Poll();
            Assert.IsTrue(s.Sync.HasSample); Assert.AreEqual(115, s.Sync.ServerNowMs(now));
            t.Close(); now = 10000; s.Poll(); t.Open(); t.Enqueue(Welcome()); t.Enqueue(Snapshot(1, Self())); s.Poll();
            Assert.IsNull(s.Me.Wish); Assert.IsFalse(s.Motion.OrderPending); Assert.IsFalse(s.Sync.HasSample);
            Assert.AreEqual(50, s.ServerTimeMs);
        }
    }
}

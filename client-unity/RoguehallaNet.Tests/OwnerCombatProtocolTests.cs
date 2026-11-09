using System;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class OwnerCombatProtocolTests
    {
        const uint BaseTick = 20000;

        static WireOwnerCombat Group(uint? target = null, double asMilli = 100d, double windup = 250d, double speed = 100d, bool held = false)
        {
            return new WireOwnerCombat {
                Lock = new WireOwnerLock { Kind = target.HasValue || held ? WireOwnerLockKind.Held : WireOwnerLockKind.Clear, Target = target },
                DrawStartedAt = uint.MaxValue, ReadyAt = 70000,
                AsMilli = asMilli, WindupMilli = windup, SpeedMilli = speed,
            };
        }

        static WireActor Actor(uint id) { return new WireActor { Id = id, X = id, Y = 1, HpPct = 100, Status = Wire.DefaultStatus }; }
        static ServerMsg.Snapshot Full(uint tick, WireOwnerCombat group, params WireActor[] actors)
        {
            return new ServerMsg.Snapshot { Tick = tick, Me = new WireSelf { Id = 1 }, Actors = actors, OwnerCombat = group };
        }
        static ServerMsg.Snapshot DecodeFull(SnapshotTracker tracker, ServerMsg.Snapshot full)
        {
            byte[] bytes = full.Encode(); return (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, null);
        }
        static ServerMsg.Snapshot Apply(SnapshotTracker tracker, ServerMsg.SnapshotDelta delta, ServerMsg.Snapshot reuse = null)
        {
            byte[] bytes = delta.Encode(); return (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, reuse);
        }
        static void SetThreeByteVarint(byte[] frame, uint value)
        {
            frame[1] = (byte)((value & 0x7f) | 0x80);
            frame[2] = (byte)(((value >> 7) & 0x7f) | 0x80);
            frame[3] = (byte)(value >> 14);
        }
        static ServerMsg.SnapshotDelta Delta(uint tick, uint baseTick, bool self = true)
        {
            return new ServerMsg.SnapshotDelta { Tick = tick, BaseTick = baseTick, HasSelf = self, Me = default(SelfDelta) };
        }

        [Test]
        public void FullAndOwnedSelfProjectionPreserveExactCombatValuesAndLockKinds()
        {
            foreach (var group in new[] { Group(), Group(held: true), Group(2), Group(null, 50, 1e303, double.MaxValue) })
            {
                var snap = Full(1, group, Actor(2));
                byte[] bytes = snap.Encode();
                Assert.AreEqual(bytes.Length, snap.EncodedLength);
                var decoded = (ServerMsg.Snapshot)ServerMsg.Decode(bytes);
                CollectionAssert.AreEqual(bytes, decoded.Encode());
                Assert.AreEqual(group.Lock.Kind, decoded.OwnerCombat.Lock.Kind);
                Assert.AreEqual(group.Lock.Target, decoded.OwnerCombat.Lock.Target);
                Assert.AreEqual(group.DrawStartedAt, decoded.OwnerCombat.DrawStartedAt);
                Assert.AreEqual(group.ReadyAt, decoded.OwnerCombat.ReadyAt);
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(group.AsMilli), BitConverter.DoubleToInt64Bits(decoded.OwnerCombat.AsMilli));
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(group.WindupMilli), BitConverter.DoubleToInt64Bits(decoded.OwnerCombat.WindupMilli));
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(group.SpeedMilli), BitConverter.DoubleToInt64Bits(decoded.OwnerCombat.SpeedMilli));
            }

            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://owner-combat", Profile = "p", Now = () => 1 });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, PlayerId = 1, TickRate = 20, MatchId = new byte[16], Session = new byte[16], Map = new MapBlob(1, 1, new byte[] { 1 }) });
            transport.Deliver(Full(1, Group(2, 1e303, 50, double.MaxValue), Actor(2)));
            Assert.IsTrue(session.Me.OwnerCombat.HasValue);
            Assert.AreEqual((uint?)2, session.Me.OwnerCombat.Value.Lock.Target);
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(1e303), BitConverter.DoubleToInt64Bits(session.Me.OwnerCombat.Value.AsMilli));
            Assert.AreEqual(uint.MaxValue, session.Me.OwnerCombat.Value.DrawStartedAt);
            Assert.AreEqual(70000u, session.Me.OwnerCombat.Value.ReadyAt);
            transport.Deliver(new ServerMsg.Snapshot { Tick = 2, Me = null, Actors = new[] { Actor(2) } });
            Assert.IsNull(session.Me);

            var unavailable = (ServerMsg.Snapshot)ServerMsg.Decode(new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Id = 1 } }.Encode());
            Assert.IsNull(unavailable.OwnerCombat);
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Tick = 1, OwnerCombat = Group() }.Encode());
            Assert.Throws<ArgumentException>(() => Full(1, Group(8), Actor(2)).Encode());
        }

        [Test]
        public void MultipliersRequireFiniteIntegralValuesAtLeastFiftyWithoutUpperClamp()
        {
            foreach (double valid in new[] { 50d, 65536d, 1e303, double.MaxValue })
                Assert.DoesNotThrow(() => Full(1, Group(null, valid, valid, valid)).Encode());
            foreach (double invalid in new[] { 49d, 50.5d, double.NaN, double.PositiveInfinity, double.NegativeInfinity })
                Assert.Throws<ArgumentException>(() => Full(1, Group(null, invalid, 100, 100)).Encode());
        }

        [Test]
        public void DeltaRetainsReplacesAndClearsGroupAndOwnerLossClearsIt()
        {
            var tracker = new SnapshotTracker();
            var first = DecodeFull(tracker, Full(1, Group(2), Actor(2)));
            first.OwnerCombat.AsMilli = 999; // Returned DTO storage is not the tracker's held baseline.

            var retained = Apply(tracker, Delta(2, 1));
            Assert.AreEqual(100d, retained.OwnerCombat.AsMilli);
            var replacement = Group(null, 777, 88, 99);
            var groupOnly = Delta(3, 2); groupOnly.HasOwnerCombat = true; groupOnly.OwnerCombat = replacement;
            var changed = Apply(tracker, groupOnly, retained);
            Assert.AreEqual(777d, changed.OwnerCombat.AsMilli);
            Assert.AreEqual(WireOwnerLockKind.Clear, changed.OwnerCombat.Lock.Kind);

            var unavailable = Delta(4, 3); unavailable.HasOwnerCombat = true; unavailable.OwnerCombat = null;
            var cleared = Apply(tracker, unavailable, changed);
            Assert.IsNull(cleared.OwnerCombat);

            var restored = Delta(5, 4); restored.HasOwnerCombat = true; restored.OwnerCombat = Group(2);
            var available = Apply(tracker, restored, cleared);
            Assert.IsNotNull(available.OwnerCombat);
            var ownerLoss = Delta(6, 5, false);
            var lost = Apply(tracker, ownerLoss, available);
            Assert.IsNull(lost.Me);
            Assert.IsNull(lost.OwnerCombat);

            var explicitOwnerlessClear = new SnapshotTracker();
            DecodeFull(explicitOwnerlessClear, Full(20, Group(), Array.Empty<WireActor>()));
            var clearWithoutOwner = Delta(21, 20, false); clearWithoutOwner.HasOwnerCombat = true;
            var clearedWithoutOwner = Apply(explicitOwnerlessClear, clearWithoutOwner);
            Assert.IsNull(clearedWithoutOwner.Me);
            Assert.IsNull(clearedWithoutOwner.OwnerCombat);

            tracker.Reset();
            Assert.IsFalse(tracker.HasBase);
            Assert.AreEqual("no_base", Assert.Throws<DeltaException>(() => Apply(tracker, Delta(7, 6))).Code);
        }

        [Test]
        public void DanglingRetainedLockRefusesAtomicallyBeforeHeldTickOrOutputChanges()
        {
            var tracker = new SnapshotTracker();
            DecodeFull(tracker, Full(10, Group(2), Actor(2)));
            var delta = Delta(11, 10); delta.Departed = new[] { 2u }; delta.DepartedCount = 1;
            var reuse = new ServerMsg.Snapshot { Tick = 800, Me = new WireSelf { Id = 99 }, Actors = new[] { Actor(99) }, OwnerCombat = Group() };
            byte[] bytes = delta.Encode();
            var error = Assert.Throws<DeltaException>(() => tracker.Decode(bytes, bytes.Length, reuse));
            Assert.AreEqual("owner_combat", error.Code);
            Assert.AreEqual(10u, tracker.HeldTick);
            Assert.AreEqual(1, tracker.HeldActors);
            Assert.AreEqual(800u, reuse.Tick);
            Assert.AreEqual(99u, reuse.Actors[0].Id);
            var retained = Apply(tracker, Delta(11, 10));
            Assert.AreEqual(2u, retained.OwnerCombat.Lock.Target.Value);

            var missingSelf = Delta(12, 11, false); missingSelf.HasOwnerCombat = true; missingSelf.OwnerCombat = Group();
            var missingSelfError = Assert.Throws<DeltaException>(() => tracker.Apply(missingSelf, null));
            Assert.AreEqual("owner_combat", missingSelfError.Code);
            Assert.AreEqual(11u, tracker.HeldTick);

            var invalid = Delta(12, 11); invalid.HasOwnerCombat = true; invalid.OwnerCombat = Group(null, 49, 100, 100);
            var invalidError = Assert.Throws<DeltaException>(() => tracker.Apply(invalid, null));
            Assert.AreEqual("owner_combat", invalidError.Code);
            Assert.AreEqual(11u, tracker.HeldTick);
        }

        [Test]
        public void DeltaAvailabilityTagIsStrict()
        {
            var delta = Delta(2, 1); delta.HasOwnerCombat = true;
            byte[] bytes = delta.Encode(); bytes[bytes.Length - 1] = 2;
            var error = Assert.Throws<DecodeException>(() => ServerMsg.Decode(bytes));
            Assert.AreEqual(DecodeError.BadField, error.Error);
        }

        [Test]
        public void SessionClockCutRetainsAuthoritativeGroupButOwnerLossAndWelcomeClearIt()
        {
            double now = 1000;
            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://owner-combat", Profile = "p", Now = () => now, ReconnectBaseMs = 500 });
            session.Connect(); transport.Open();
            var welcome = new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, PlayerId = 1, TickRate = 20,
                MatchId = new byte[16], Session = new byte[16], Map = new MapBlob(1, 1, new byte[] { 1 }) };
            transport.Deliver(welcome);
            transport.Deliver(new ServerMsg.Snapshot { Tick = 1, ServerTimeOverrideMs = 1000, Me = new WireSelf { Id = 1 }, Actors = new[] { Actor(2) }, OwnerCombat = Group(2) });
            uint epoch = session.TimelineEpoch;
            var cut = Delta(2, 1); cut.ServerTimeOverrideMs = 900;
            transport.Deliver(cut);
            Assert.Greater(session.TimelineEpoch, epoch);
            Assert.AreEqual(900d, session.Latest.ServerMs);
            Assert.IsTrue(session.Me.OwnerCombat.HasValue);
            Assert.AreEqual((uint?)2, session.Me.OwnerCombat.Value.Lock.Target);

            transport.Drop(); now += 500; session.Update(); transport.Open(); transport.Deliver(welcome);
            Assert.IsNull(session.Latest);
            Assert.IsNull(session.Me);
            Assert.AreEqual(SessionState.InMatch, session.State);

            transport.Deliver(new ServerMsg.Snapshot { Tick = 3, Me = new WireSelf { Id = 1 }, Actors = new[] { Actor(2) }, OwnerCombat = Group(2) });
            Assert.IsNotNull(session.Me.OwnerCombat);
            transport.Deliver(new ServerMsg.Snapshot { Tick = 4, Me = null, Actors = new[] { Actor(2) } });
            Assert.IsNull(session.Me);
            Assert.IsNull(session.Latest.OwnerCombat);
        }

        [Test]
        public void RetainingOwnerCombatAcrossPooledDeltasDoesNotAllocateSteadily()
        {
            var tracker = new SnapshotTracker();
            var reuse = DecodeFull(tracker, Full(BaseTick, Group(), Array.Empty<WireActor>()));
            var delta = Delta(BaseTick + 1, BaseTick);
            byte[] frame = delta.Encode();
            for (int i = 0; i < 200; i++)
            {
                SetThreeByteVarint(frame, BaseTick + 1u + (uint)i);
                reuse = (ServerMsg.Snapshot)tracker.Decode(frame, frame.Length, reuse);
            }
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 200; i < 2200; i++)
            {
                SetThreeByteVarint(frame, BaseTick + 1u + (uint)i);
                reuse = (ServerMsg.Snapshot)tracker.Decode(frame, frame.Length, reuse);
            }
            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
            GC.KeepAlive(reuse);
            Assert.AreEqual(0, allocated);
            Assert.AreEqual(100d, reuse.OwnerCombat.AsMilli);
        }
    }
}

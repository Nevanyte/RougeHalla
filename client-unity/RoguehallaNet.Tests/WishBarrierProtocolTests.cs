using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class WishBarrierProtocolTests
    {
        static WireWishOwner Owner(byte charges = 2) => new WireWishOwner
        {
            Ability = 3, ReadyAt = 1200.5, FullAt = 2000.25, MaxCharges = 2, RechargeMs = 800,
            Charges = charges, NextChargeAt = 1600.125,
            Cast = new WireWishCast { Ability = 3, StartedAt = 1100, LandsAt = 1250 }
        };

        [Test]
        public void CastTagRoundTripsAllOptionalFactsAndRemainsOnlyARequest()
        {
            Assert.AreEqual(13, Wire.ProtocolVersion);
            var input = new ClientMsg.Input { Seq = 19 };
            input.Commands.Add(WireCommand.Cast(0, 8.5f, 12.25f, 77, 991.125, 255));
            var bytes = input.Encode();
            var decoded = (ClientMsg.Input)ClientMsg.Decode(bytes);
            var cast = decoded.Commands.Single();
            Assert.AreEqual(CommandKind.Cast, cast.Kind); Assert.AreEqual((byte)0, cast.Slot);
            Assert.AreEqual(8.5f, cast.X); Assert.AreEqual(12.25f, cast.Y); Assert.AreEqual((uint)77, cast.ActorRef);
            Assert.AreEqual(991.125, cast.T); Assert.AreEqual((byte)255, cast.Seq);

            var noHints = new ClientMsg.Input(); noHints.Commands.Add(WireCommand.Cast(2, 1, 2));
            var bare = (ClientMsg.Input)ClientMsg.Decode(noHints.Encode());
            Assert.IsNull(bare.Commands[0].T); Assert.IsNull(bare.Commands[0].Seq); Assert.AreEqual(0u, bare.Commands[0].ActorRef);
        }

        [Test]
        public void CastRejectsUnknownSlotZeroActorAndMalformedNewOptionTags()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => WireCommand.Cast(3, 0, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() => WireCommand.Cast(0, 0, 0, 0));

            var input = new ClientMsg.Input(); input.Commands.Add(WireCommand.Cast(0, 0, 0, 5));
            var frame = input.Encode();
            frame[8] = 3; // slot
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(frame));
            frame = input.Encode(); frame[17] = 2; // actor option tag
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(frame));
            frame = input.Encode(); Array.Clear(frame, 18, 4); // actor-present, id is zero
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(frame));
            frame = input.Encode(); frame[22] = 3; // time option tag (after fixed actor option)
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(frame));
        }

        [Test]
        public void FullSnapshotRoundTripsOwnerBarrierActorAndExplicitTime()
        {
            var source = new ServerMsg.Snapshot
            {
                Tick = 24,
                ServerTimeOverrideMs = 1201.25,
                Me = new WireSelf { Id = 9, Wish = Owner(), Barrier = 19.75f, BarrierRingStep = 4 },
                Actors = new[] { new WireActor { Id = 10, X = 3, Y = 4, HpPct = 100, BarrierPct = 55, BarrierRingStep = 7 } }
            };
            var decoded = (ServerMsg.Snapshot)ServerMsg.Decode(source.Encode());
            Assert.AreEqual(1201.25, decoded.ServerMs);
            Assert.AreEqual(3, decoded.Me.Wish.Ability); Assert.AreEqual(2, decoded.Me.Wish.Charges);
            Assert.AreEqual(3, decoded.Me.Wish.Cast.Ability); Assert.AreEqual(1250, decoded.Me.Wish.Cast.LandsAt);
            Assert.AreEqual(19.75f, decoded.Me.Barrier); Assert.AreEqual(4, decoded.Me.BarrierRingStep);
            Assert.AreEqual((byte)55, decoded.Actors[0].BarrierPct); Assert.AreEqual((byte)7, decoded.Actors[0].BarrierRingStep);
            CollectionAssert.AreEqual(source.Encode(), decoded.Encode());
        }

        [Test]
        public void FullSnapshotTimeOverrideIsPerFrameAndIndependentOfSelf()
        {
            var reuse = new ServerMsg.Snapshot();
            var withOverride = new ServerMsg.Snapshot { Tick = 20, ServerTimeOverrideMs = 901.75, Me = new WireSelf { Id = 9, Wish = Owner(), Barrier = 4, BarrierRingStep = 2 } };
            var frame = withOverride.Encode(); ServerMsg.Decode(frame, frame.Length, reuse);
            Assert.AreEqual(901.75, reuse.ServerMs);
            var defaultTime = new ServerMsg.Snapshot { Tick = 21, Me = new WireSelf { Id = 9 } };
            frame = defaultTime.Encode();
            ServerMsg.Decode(frame, frame.Length, reuse);
            Assert.IsNull(reuse.ServerTimeOverrideMs); Assert.AreEqual(1050, reuse.ServerMs);
            Assert.IsNull(reuse.Me.Wish); Assert.AreEqual(0, reuse.Me.Barrier); Assert.AreEqual(0, reuse.Me.BarrierRingStep);
        }

        [Test]
        public void DeltaClearsWishAndBarrierAndDoesNotInheritSourceTime()
        {
            var tracker = new SnapshotTracker();
            var full = new ServerMsg.Snapshot
            {
                Tick = 1, ServerTimeOverrideMs = 180,
                Me = new WireSelf { Id = 9, Wish = Owner(), Barrier = 8, BarrierRingStep = 2 },
                Actors = new[] { new WireActor { Id = 10, X = 2, Y = 3, HpPct = 100, BarrierPct = 50, BarrierRingStep = 3 } }
            };
            var snapshot = (ServerMsg.Snapshot)tracker.Decode(full.Encode(), full.Encode().Length, null);
            var clear = new ServerMsg.SnapshotDelta
            {
                Tick = 2, BaseTick = 1, HasSelf = true, HasWish = true, Wish = null,
                HasBarrier = true, Barrier = 0, BarrierRingStep = 0, ServerTimeOverrideMs = 225,
                Changed = new[] { new ActorDelta { Id = 10, Mask = ActorDelta.MBarrier, BarrierPct = 0, BarrierRingStep = 0 } }, ChangedCount = 1
            };
            var bytes = clear.Encode(); snapshot = (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, null);
            Assert.IsNull(snapshot.Me.Wish); Assert.AreEqual(0, snapshot.Me.Barrier); Assert.AreEqual(0, snapshot.Me.BarrierRingStep);
            Assert.AreEqual(225, snapshot.ServerMs); Assert.AreEqual(0, snapshot.Actors[0].BarrierPct);

            var defaultTime = new ServerMsg.SnapshotDelta { Tick = 3, BaseTick = 2, HasSelf = true };
            bytes = defaultTime.Encode(); snapshot = (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, null);
            Assert.IsNull(snapshot.ServerTimeOverrideMs); Assert.AreEqual(150, snapshot.ServerMs, "delta default is its own tick clock");
            Assert.IsNull(snapshot.Me.Wish); Assert.AreEqual(0, snapshot.Me.Barrier); Assert.AreEqual(0, snapshot.Actors[0].BarrierRingStep);
        }

        [Test]
        public void WishFxRoundTripAndRejectMalformedGeometryAndRanges()
        {
            var source = new ServerMsg.Fx
            {
                Tick = 41,
                List = new System.Collections.Generic.List<WireFx>
                {
                    new WireFx { Kind = FxKind.WishStarted, EventTime = 2000.25, Caster = 5, Ability = 3, Duration = 400, Target = 7, HasAnchor = true, AnchorX = 32, AnchorY = 44 },
                    new WireFx { Kind = FxKind.WishLanded, EventTime = 2400.5, Caster = 5, Target = 7, Ability = 3, HasAnchor = true, AnchorX = 32, AnchorY = 44, HasDestination = true, DestinationX = 64, DestinationY = 72 },
                    new WireFx { Kind = FxKind.WishEnded, EventTime = 2600, Caster = 5, Ability = 3, Reason = 1 }
                }
            };
            var decoded = (ServerMsg.Fx)ServerMsg.Decode(source.Encode());
            Assert.AreEqual(new[] { FxKind.WishStarted, FxKind.WishLanded, FxKind.WishEnded }, decoded.List.Select(x => x.Kind));
            Assert.AreEqual(2400.5, decoded.List[1].EventTime); Assert.AreEqual(64, decoded.List[1].DestinationX);
            Assert.AreEqual(1, decoded.List[2].Reason);

            var invalidPair = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishLanded, EventTime = 1, Ability = 3, HasAnchor = true, AnchorX = 1, AnchorY = 1 } } };
            Assert.Throws<ArgumentException>(() => invalidPair.Encode());
            var invalidDest = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishLanded, EventTime = 1, Ability = 0, HasDestination = true, DestinationX = 1, DestinationY = 1 } } };
            Assert.Throws<ArgumentException>(() => invalidDest.Encode());
            var noCasterOrGeometry = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishLanded, EventTime = 1, Ability = 0 } } };
            Assert.Throws<ArgumentException>(() => noCasterOrGeometry.Encode());
            var targetWithoutCasterOrGeometry = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishLanded, EventTime = 1, Ability = 0, Target = 9 } } };
            Assert.Throws<ArgumentException>(() => targetWithoutCasterOrGeometry.Encode());
            var invalidReason = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishEnded, EventTime = 1, Caster = 2, Ability = 0, Reason = 3 } } };
            Assert.Throws<ArgumentException>(() => invalidReason.Encode());
        }

        [Test]
        public void WishFxDecoderRejectsMalformedNewOptionsAndCrossFieldShapes()
        {
            var started = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishStarted, EventTime = 1, Caster = 2, Ability = 0, Duration = 0 } } };
            var frame = started.Encode(); frame[22] = 2; // optional target flag
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(frame));

            var landed = new ServerMsg.Fx { List = new System.Collections.Generic.List<WireFx> { new WireFx { Kind = FxKind.WishLanded, EventTime = 1, Ability = 0, Caster = 2 } } };
            frame = landed.Encode(); frame[13] = 2; // optional caster flag
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(frame));

            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawBlazeAnchorOnly()));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawLandedWithoutCaster(null)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawLandedWithoutCaster(9)));
        }

        static byte[] RawLandedWithoutCaster(uint? target)
        {
            var w = new Writer(); w.U8(0x85); w.Varint(0); w.Varint(1); w.U8((byte)FxKind.WishLanded); w.F64(1); w.U8(0); w.U8(0);
            if (target.HasValue) { w.U8(1); w.Varint(target.Value); } else w.U8(0);
            w.U8(0); w.U8(0); return w.Finish();
        }

        static byte[] RawBlazeAnchorOnly()
        {
            var w = new Writer(); w.U8(0x85); w.Varint(0); w.Varint(1); w.U8((byte)FxKind.WishLanded); w.F64(1); w.U8(3);
            w.U8(0); w.U8(0); w.U8(1); w.U16(8); w.U16(16); w.U8(0); return w.Finish();
        }

        [Test]
        public void WishOwnerAndBarrierRangesAreStrict()
        {
            var badCharges = new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Wish = Owner(3) } };
            Assert.Throws<ArgumentException>(() => badCharges.Encode());
            var badRing = new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { BarrierRingStep = 9 } };
            Assert.Throws<ArgumentException>(() => badRing.Encode());
            var badTime = new ServerMsg.Snapshot { Tick = 1, ServerTimeOverrideMs = double.PositiveInfinity };
            Assert.Throws<ArgumentException>(() => badTime.Encode());
        }
    }
}

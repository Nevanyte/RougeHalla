using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class GiverActorProtocolTests
    {
        static ServerMsg.Snapshot Full(WireActor actor, WireSelf me = null, uint tick = 1)
        {
            return new ServerMsg.Snapshot { Tick = tick, Me = me, Actors = new[] { actor } };
        }

        static ServerMsg.SnapshotDelta Change(uint tick, uint baseTick, ActorDelta actor)
        {
            return new ServerMsg.SnapshotDelta { Tick = tick, BaseTick = baseTick, Changed = new[] { actor }, ChangedCount = 1 };
        }

        static ServerMsg.Snapshot ApplyFull(SnapshotTracker tracker, WireActor actor, WireSelf me = null)
        {
            byte[] bytes = Full(actor, me).Encode();
            return (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, null);
        }

        static ServerMsg.Snapshot Apply(SnapshotTracker tracker, ServerMsg.SnapshotDelta delta, ServerMsg.Snapshot reuse = null)
        {
            byte[] bytes = delta.Encode();
            return (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, reuse);
        }

        [Test]
        public void QuestGiverFullActorUsesKitSentinelAndOnlyOwnedRemoteViewMakesItNullable()
        {
            var giver = new WireActor { Id = 7, Kind = 4, Faction = 15, Weapon = 15 };
            byte[] bytes = Full(giver).Encode();
            var decoded = (ServerMsg.Snapshot)ServerMsg.Decode(bytes);
            CollectionAssert.AreEqual(bytes, decoded.Encode());
            Assert.AreEqual((byte)15, decoded.Actors[0].Faction);
            Assert.AreEqual((byte)15, decoded.Actors[0].Weapon);
            Assert.AreEqual((byte)0, decoded.Actors[0].MobTypeCode);

            var buffer = new SnapshotBuffer();
            Assert.IsTrue(buffer.Add(decoded));
            var actors = new List<InterpActor>();
            Assert.IsTrue(buffer.Sample(decoded.ServerMs, actors));
            Assert.AreEqual(ActorKind.QuestGiver, actors[0].Kind);
            Assert.IsNull(actors[0].Faction);
            Assert.IsNull(actors[0].Weapon);
            Assert.IsNull(actors[0].MobType);

            // A non-giver's same raw nibbles remain unknown codes; Kind alone selects the nullable projection.
            var unknown = new WireActor { Id = 8, Kind = 255, Faction = 15, Weapon = 15, MobTypeCode = 15 };
            bytes = Full(unknown).Encode();
            decoded = (ServerMsg.Snapshot)ServerMsg.Decode(bytes);
            CollectionAssert.AreEqual(bytes, decoded.Encode());
            buffer.Clear(); buffer.Add(decoded); actors.Clear(); buffer.Sample(decoded.ServerMs, actors);
            Assert.AreEqual((ActorKind)255, actors[0].Kind);
            Assert.AreEqual((FactionId)15, actors[0].Faction.Value);
            Assert.AreEqual((WeaponId)15, actors[0].Weapon.Value);
            Assert.AreEqual((MobTypeId)14, actors[0].MobType.Value);

            // The reserved remote-actor sentinel has no meaning in self's kit.
            var self = new WireSelf { Id = 3, Faction = 15, Weapon = 15 };
            bytes = new ServerMsg.Snapshot { Tick = 1, Me = self }.Encode();
            decoded = (ServerMsg.Snapshot)ServerMsg.Decode(bytes);
            CollectionAssert.AreEqual(bytes, decoded.Encode());
            Assert.AreEqual((byte)15, decoded.Me.Faction);
            Assert.AreEqual((byte)15, decoded.Me.Weapon);
        }

        [Test]
        public void FullWriterRejectsOnlyMalformedQuestGiverIdentityTuples()
        {
            foreach (var bad in new[]
            {
                new WireActor { Id = 1, Kind = 4 },
                new WireActor { Id = 1, Kind = 4, Faction = 15, Weapon = 14 },
                new WireActor { Id = 1, Kind = 4, Faction = 14, Weapon = 15 },
                new WireActor { Id = 1, Kind = 4, Faction = 15, Weapon = 15, MobTypeCode = 1 },
            })
                Assert.Throws<ArgumentException>(() => Full(bad).Encode());

            Assert.DoesNotThrow(() => Full(new WireActor { Id = 1, Kind = 0, Faction = 15, Weapon = 15 }).Encode());
            Assert.DoesNotThrow(() => Full(new WireActor { Id = 1, Kind = 255, Faction = 15, Weapon = 15 }).Encode());
        }

        [Test]
        public void DeltaValidatesRetainedAndChangedIdentityBeforeCommitting()
        {
            var tracker = new SnapshotTracker();
            var unknown = new WireActor { Id = 7, Kind = 255, Faction = 15, Weapon = 15 };
            ApplyFull(tracker, unknown);

            // Identity fields can be retained across a kind transition when their reconstructed tuple is valid.
            var qg = Apply(tracker, Change(2, 1, new ActorDelta { Id = 7, Mask = ActorDelta.MKind, Kind = 4 }));
            Assert.AreEqual((byte)4, qg.Actors[0].Kind);
            Assert.AreEqual((byte)15, qg.Actors[0].Faction);
            Assert.AreEqual((byte)15, qg.Actors[0].Weapon);

            // A later positional delta retains the sentinel without needing either identity bit.
            qg = Apply(tracker, Change(3, 2, new ActorDelta { Id = 7, Mask = ActorDelta.MX, X = 80 }));
            Assert.AreEqual((byte)4, qg.Actors[0].Kind);
            Assert.AreEqual((byte)15, qg.Actors[0].Faction);

            // Kind 4 back to an opaque future kind also keeps the raw sentinel untouched.
            var future = Apply(tracker, Change(4, 3, new ActorDelta { Id = 7, Mask = ActorDelta.MKind, Kind = 255 }));
            Assert.AreEqual((byte)255, future.Actors[0].Kind);
            Assert.AreEqual((byte)15, future.Actors[0].Weapon);
        }

        [Test]
        public void InvalidRetainedDeltaDoesNotChangeHeldSnapshotOrReuseTargetAndResetClearsBase()
        {
            var tracker = new SnapshotTracker();
            ApplyFull(tracker, new WireActor { Id = 7, Kind = 0, Faction = 2, Weapon = 1 });
            var reuse = new ServerMsg.Snapshot { Tick = 900, Actors = new[] { new WireActor { Id = 99 } } };
            var bad = Change(2, 1, new ActorDelta { Id = 7, Mask = ActorDelta.MKind, Kind = 4 });
            byte[] bytes = bad.Encode();
            var error = Assert.Throws<DeltaException>(() => tracker.Decode(bytes, bytes.Length, reuse));
            Assert.AreEqual("giver_actor", error.Code);
            Assert.AreEqual(1u, tracker.HeldTick);
            Assert.AreEqual(1, tracker.HeldActors);
            Assert.AreEqual(900u, reuse.Tick);
            Assert.AreEqual(99u, reuse.Actors[0].Id);

            // A kit-only attempt to remove a retained giver identity is also refused before commit.
            var giverTracker = new SnapshotTracker();
            ApplyFull(giverTracker, new WireActor { Id = 7, Kind = 4, Faction = 15, Weapon = 15 });
            bad = Change(2, 1, new ActorDelta { Id = 7, Mask = ActorDelta.MKit, Kit = 0x00 });
            bytes = bad.Encode();
            error = Assert.Throws<DeltaException>(() => giverTracker.Decode(bytes, bytes.Length, null));
            Assert.AreEqual("giver_actor", error.Code);
            Assert.AreEqual(1u, giverTracker.HeldTick);
            Assert.AreEqual(1, giverTracker.HeldActors);

            bad = Change(2, 1, new ActorDelta { Id = 7, Mask = ActorDelta.MMobType, MobTypeCode = 1 });
            bytes = bad.Encode();
            error = Assert.Throws<DeltaException>(() => giverTracker.Decode(bytes, bytes.Length, null));
            Assert.AreEqual("giver_actor", error.Code);
            Assert.AreEqual(1u, giverTracker.HeldTick);

            giverTracker.Reset();
            Assert.IsFalse(giverTracker.HasBase);
            Assert.AreEqual(0, giverTracker.HeldActors);
            bad = Change(2, 1, new ActorDelta { Id = 7, Mask = ActorDelta.MX, X = 80 });
            bytes = bad.Encode();
            error = Assert.Throws<DeltaException>(() => giverTracker.Decode(bytes, bytes.Length, null));
            Assert.AreEqual("no_base", error.Code);
        }
    }
}

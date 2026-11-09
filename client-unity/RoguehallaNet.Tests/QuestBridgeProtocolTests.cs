using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class QuestBridgeProtocolTests
    {
        static WireQuestView View()
        {
            return new WireQuestView
            {
                UnknownCount = 2,
                DisplayUnknownCount = 1,
                OwnerRoster = new RosterId(10),
                Roster = new[]
                {
                    new WireQuestRosterEntry { Id = new RosterId(10), Label = "duplicate label" },
                    new WireQuestRosterEntry { Id = new RosterId(11), Label = "duplicate label" },
                },
                Rows = new[]
                {
                    new WireQuestRow
                    {
                        Handle = new QuestHandle(7), Def = "collect_wood",
                        GiverX = BitConverter.Int64BitsToDouble(unchecked((long)0x3ff0000000000001UL)), GiverY = 8191.875,
                        State = QuestRowState.Open, ExpiresAt = 123456.125,
                        Participants = new[] { new WireQuestParticipant { Id = new RosterId(10), Accepted = true, Progress = uint.MaxValue, Visited = 0x1f } },
                        Carrier = new RosterId(11), DoneBy = "duplicate label", CanAccept = true, OwnerAccepted = true,
                        OwnerCompleted = true, OwnerReady = true, OwnerProgress = 0xf1234567, OwnerVisited = 0x1f,
                    },
                },
                Objectives = new[] { new WireQuestObjective { Quest = new QuestHandle(7), X = 0, Y = 8191.875 } },
            };
        }

        static QuestsState Available(WireQuestView view = null) => new QuestsState { Available = true, View = view ?? View() };

        static byte[] RawQuestPayload(Action<Writer> write)
        {
            var w = new Writer();
            w.U8(0x88); w.Varint(1); w.Varint(1); w.Varint((uint)StateKey.Quests);
            write(w);
            return w.Finish();
        }

        static void WriteEmptyAvailable(Writer w)
        {
            w.U8(1); // available
            w.Varint(0); w.Varint(0); w.Varint(0); // unknown/display/owner roster
            w.Varint(0); w.Varint(0); w.Varint(0); // roster/rows/objectives
        }

        [Test]
        public void QuestStateRoundTripsExactDoubleBitsTypedReferencesAndPropKindSeven()
        {
            var source = new ServerMsg.State
            {
                Tick = 44,
                Items = new StateItem[]
                {
                    new PropsState { Rows = new[] { new WireProp { Handle = new PickupHandle(7), X = 1, Y = 2, Kind = PropKind.QuestItem,
                        QuestRef = new QuestHandle(7), QuestFetch = true } } },
                    Available(),
                },
            };

            byte[] bytes = source.Encode();
            var decoded = (ServerMsg.State)ServerMsg.Decode(bytes);
            CollectionAssert.AreEqual(bytes, decoded.Encode());
            var prop = ((PropsState)decoded.Items[0]).Rows[0];
            Assert.AreEqual(PropKind.QuestItem, prop.Kind);
            Assert.AreEqual(new PickupHandle(7), prop.Handle);
            Assert.AreEqual(new QuestHandle(7), prop.QuestRef);
            Assert.IsTrue(prop.QuestFetch);
            var quest = (QuestsState)decoded.Items[1];
            Assert.IsTrue(quest.Available);
            Assert.AreEqual(new RosterId(10), quest.View.OwnerRoster.Value);
            Assert.AreEqual("duplicate label", quest.View.Roster[0].Label);
            Assert.AreEqual("duplicate label", quest.View.Roster[1].Label, "display labels are not IDs");
            Assert.AreEqual(new QuestHandle(7), quest.View.Rows[0].Handle);
            Assert.AreEqual(uint.MaxValue, quest.View.Rows[0].Participants[0].Progress);
            Assert.AreEqual(unchecked((ulong)BitConverter.DoubleToInt64Bits(View().Rows[0].GiverX)),
                unchecked((ulong)BitConverter.DoubleToInt64Bits(quest.View.Rows[0].GiverX)));
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(8191.875), BitConverter.DoubleToInt64Bits(quest.View.Objectives[0].Y));
        }

        [Test]
        public void UnavailableAndAvailableEmptyAreDistinctAndRetainOnOmission()
        {
            var unavailable = (ServerMsg.State)ServerMsg.Decode(new ServerMsg.State
            {
                Tick = 1, Items = new StateItem[] { new QuestsState { Available = false } },
            }.Encode());
            Assert.IsFalse(((QuestsState)unavailable.Items[0]).Available);
            Assert.IsNull(((QuestsState)unavailable.Items[0]).View);

            var empty = (ServerMsg.State)ServerMsg.Decode(new ServerMsg.State
            {
                Tick = 2, Items = new StateItem[] { Available(new WireQuestView()) },
            }.Encode());
            Assert.IsTrue(((QuestsState)empty.Items[0]).Available);
            Assert.AreEqual(0, ((QuestsState)empty.Items[0]).View.Rows.Length);

            var session = ReadySession(out var transport);
            transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { Available() } });
            var old = session.Collections.Quests;
            Assert.IsTrue(old.Available);
            Assert.AreEqual("collect_wood", old.Rows[0].Def);
            Assert.IsTrue(old.Rows[0].OwnerCompleted);
            Assert.AreEqual(new RosterId(11), old.Rows[0].Carrier.Value);
            Assert.Throws<NotSupportedException>(() => ((System.Collections.Generic.IList<QuestRowView>)old.Rows).Clear());
            transport.Deliver(new ServerMsg.State { Tick = 4, Items = Array.Empty<StateItem>() });
            Assert.AreSame(old, session.Collections.Quests, "omitted key retains its prior owned replacement");
            transport.Deliver(new ServerMsg.State { Tick = 5, Items = new StateItem[] { new PropsState(), new QuestsState { Available = false } } });
            Assert.IsNotNull(session.Collections.Quests);
            Assert.IsFalse(session.Collections.Quests.Available);
        }

        [Test]
        public void InputQuestAcceptUsesTagSeventeenAndNonzeroCanonicalVarint()
        {
            var sender = new InputSender();
            sender.QuestAccept(new QuestHandle(128));
            var frames = sender.Flush(0);
            Assert.AreEqual(1, frames.Count);
            CollectionAssert.AreEqual(new byte[] { 2, 1, 0, 0, 0, 1, 0, 17, 0x80, 0x01 }, frames[0].Encode());
            var decoded = (ClientMsg.Input)ClientMsg.Decode(frames[0].Encode());
            Assert.AreEqual(CommandKind.QuestAccept, decoded.Commands[0].Kind);
            Assert.AreEqual(new QuestHandle(128), decoded.Commands[0].QuestRef);
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(new byte[] { 2, 0, 0, 0, 0, 1, 0, 17, 0 }));
            Assert.Throws<ArgumentException>(() => new ClientMsg.Input
            {
                Commands = new List<WireCommand> { new WireCommand { Kind = CommandKind.QuestAccept } },
            }.Encode());
        }

        [Test]
        public void QuestDecoderRejectsStrictFlagsRangesAndBrokenInternalReferences()
        {
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawQuestPayload(w => { w.U8(2); })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawQuestPayload(w => { w.U8(1); w.Varint(0); w.Varint(1); })));

            // Two roster entries with the same typed ID are invalid even when their labels differ.
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawQuestPayload(w =>
            {
                w.U8(1); w.Varint(0); w.Varint(0); w.Varint(0); w.Varint(2);
                w.Varint(1); w.Str("same"); w.Varint(1); w.Str("different");
            })));

            // Available with an owner roster that does not exist.
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawQuestPayload(w =>
            {
                w.U8(1); w.Varint(0); w.Varint(0); w.Varint(1); w.Varint(0); w.Varint(0); w.Varint(0);
            })));

            // An objective is a navigation reference to a row, not a pickup/actor capability.
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawQuestPayload(w =>
            {
                w.U8(1); w.Varint(0); w.Varint(0); w.Varint(0); w.Varint(0); w.Varint(1);
                w.Varint(1); w.F64(0); w.F64(0);
            })));

            // Present QuestItem flag is strict and its typed reference is nonzero.
            byte[] badFlag = new ServerMsg.State { Tick = 1, Items = new StateItem[]
            {
                new PropsState { Rows = new[] { new WireProp { Handle = new PickupHandle(1), Kind = PropKind.QuestItem, QuestRef = new QuestHandle(1) } } },
            } }.Encode();
            badFlag[badFlag.Length - 2] = 2;
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(badFlag));
        }

        [Test]
        public void InvalidCrossCollectionReplacementFailsBeforeAnyApplyOrSeenTickMutation()
        {
            var session = ReadySession(out var transport);
            transport.Deliver(new ServerMsg.State
            {
                Tick = 10,
                Items = new StateItem[]
                {
                    new InventoryState { Value = new WireInventory { ActiveSlot = 0 } },
                    new PropsState { Rows = new[] { new WireProp { Handle = new PickupHandle(1), Kind = PropKind.QuestItem, QuestRef = new QuestHandle(7) } } },
                    Available(),
                },
            });
            Assert.AreEqual(10u, session.Collections.Tick);
            Assert.AreEqual(1, session.Collections.Props.Count);
            var priorQuests = session.Collections.Quests;
            var priorInventory = session.Collections.Inventory;
            var priorErrors = session.DecodeErrors;

            // Replacing inventory and quests but omitting props would orphan its retained quest item.
            transport.Deliver(new ServerMsg.State
            {
                Tick = 11,
                Items = new StateItem[] { new InventoryState { Value = null }, Available(new WireQuestView()) },
            });

            Assert.AreEqual(priorErrors + 1, session.DecodeErrors);
            Assert.AreEqual(10u, session.Collections.Tick);
            Assert.AreEqual(1, session.Collections.Props.Count);
            Assert.AreSame(priorQuests, session.Collections.Quests);
            Assert.AreEqual(priorInventory.HasValue, session.Collections.Inventory.HasValue);
            Assert.AreEqual(SessionState.Failed, session.State);
            Assert.IsTrue(transport.CloseCalled);
        }

        static Session ReadySession(out FakeTransport transport)
        {
            transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => 0 });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            return session;
        }
    }
}

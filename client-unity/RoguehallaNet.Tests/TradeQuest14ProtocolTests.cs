using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class TradeQuest14ProtocolTests
    {
        static WireTradeView TradeSample() => new WireTradeView
        {
            TradeUsed = true,
            Offers = new[]
            {
                new WireTradeOffer { Cost = TradeStat.Ad, CostValue = 1.25, Gain = TradeStat.MaxHp, GainValue = 3.5, Label = "A label" },
                new WireTradeOffer { Cost = TradeStat.Ad, CostValue = 2, Gain = TradeStat.MaxHp, GainValue = 4, Label = "A label" },
            },
            Stats = new[]
            {
                new WireTradeDelta { Stat = TradeStat.Ad, Value = -0.0 },
                new WireTradeDelta { Stat = TradeStat.Ad, Value = -2.25 },
            },
            BarterReadyAt = -0.0,
            Merchants = new[]
            {
                new WireMerchant { Kind = TradeKind.Barter, X = 8191.875, Y = 0, Name = "same" },
                new WireMerchant { Kind = TradeKind.Barter, X = 8191.875, Y = 0, Name = "same" },
            },
            BarterLabels = new[] { "", "same", "same" },
        };

        static ServerMsg.State TradeFrame(uint tick, TradeState trade) => new ServerMsg.State
        {
            Tick = tick, Items = new StateItem[] { trade },
        };

        static Session ReadySession(out FakeTransport transport)
        {
            transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions
            {
                Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => 0,
            });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]),
            });
            return session;
        }

        static byte[] RawTrade(Action<Writer> write)
        {
            var w = new Writer();
            w.U8(0x88); w.Varint(1); w.Varint(1); w.Varint((uint)StateKey.Trade);
            write(w); return w.Finish();
        }

        static void ApplyDirect(CollectionsView collections, ServerMsg.State state)
        {
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(collections, new object[] { state });
        }

        [Test]
        public void TradeReplacementRoundTripsOrderedDuplicatesSignedZeroAndExactLabels()
        {
            var source = TradeFrame(17, new TradeState { Available = true, Value = TradeSample() });
            byte[] bytes = source.Encode();
            var decoded = (ServerMsg.State)ServerMsg.Decode(bytes);
            CollectionAssert.AreEqual(bytes, decoded.Encode());
            var view = ((TradeState)decoded.Items[0]).Value;
            Assert.IsTrue(view.TradeUsed);
            Assert.AreEqual(2, view.Offers.Length);
            Assert.AreEqual("A label", view.Offers[0].Label);
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(1.25), BitConverter.DoubleToInt64Bits(view.Offers[0].CostValue));
            Assert.AreEqual(TradeStat.Ad, view.Stats[0].Stat);
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(-0.0), BitConverter.DoubleToInt64Bits(view.Stats[0].Value));
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(-2.25), BitConverter.DoubleToInt64Bits(view.Stats[1].Value));
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(-0.0), BitConverter.DoubleToInt64Bits(view.BarterReadyAt.Value));
            Assert.AreEqual(2, view.Merchants.Length);
            Assert.AreEqual(TradeKind.Barter, view.Merchants[1].Kind);
            Assert.AreEqual("same", view.Merchants[0].Name);
            CollectionAssert.AreEqual(new[] { "", "same", "same" }, view.BarterLabels);
        }

        [Test]
        public void TradeMaximumCompleteReplacementFitsItsDeclaredBudget()
        {
            string text255 = new string('x', 255);
            var view = new WireTradeView
            {
                Offers = new[]
                {
                    new WireTradeOffer { Cost = TradeStat.MaxHp, CostValue = 1, Gain = TradeStat.Ad, GainValue = 1, Label = text255 },
                    new WireTradeOffer { Cost = TradeStat.Ad, CostValue = 2, Gain = TradeStat.Ap, GainValue = 2, Label = text255 },
                    new WireTradeOffer { Cost = TradeStat.Ap, CostValue = 3, Gain = TradeStat.Shield, GainValue = 3, Label = text255 },
                },
                Stats = new[]
                {
                    new WireTradeDelta { Stat = TradeStat.MaxHp, Value = -1 }, new WireTradeDelta { Stat = TradeStat.Ad, Value = -1 },
                    new WireTradeDelta { Stat = TradeStat.Ap, Value = -1 }, new WireTradeDelta { Stat = TradeStat.AttackSpeed, Value = -1 },
                    new WireTradeDelta { Stat = TradeStat.MoveSpeed, Value = -1 }, new WireTradeDelta { Stat = TradeStat.Armor, Value = -1 },
                    new WireTradeDelta { Stat = TradeStat.Shield, Value = -1 },
                },
                BarterReadyAt = 0,
                Merchants = new[]
                {
                    new WireMerchant { Kind = TradeKind.Barter, X = 0, Y = 0, Name = text255 },
                    new WireMerchant { Kind = TradeKind.Stats, X = 8191.875, Y = 8191.875, Name = text255 },
                },
                BarterLabels = new[] { text255, text255, text255 },
            };
            var frame = TradeFrame(1, new TradeState { Available = true, Value = view }).Encode();
            Assert.AreEqual(2217, frame.Length, "four-byte state header plus the 2213-byte maximum complete value");
            Assert.DoesNotThrow(() => ServerMsg.Decode(frame));
        }

        [Test]
        public void TradeMissingUnavailableAndAvailableEmptyAreDifferentAndCopiedOnReplace()
        {
            var session = ReadySession(out var transport);
            Assert.IsNull(session.Collections.Trade, "missing key means no Trade replacement has arrived yet");
            var source = new TradeState { Available = true, Value = TradeSample() };
            transport.Deliver(TradeFrame(1, source));
            var held = session.Collections.Trade;
            Assert.IsTrue(held.Available);
            Assert.AreEqual(2, held.Offers.Count);
            Assert.AreEqual("same", held.Merchants[0].Name);
            source.Value.Offers[0].Label = "mutated source";
            source.Value.Merchants[0].Name = "mutated source";
            source.Value.BarterLabels[1] = "mutated source";
            Assert.AreEqual("A label", held.Offers[0].Label);
            Assert.AreEqual("same", held.Merchants[0].Name);
            Assert.AreEqual("same", held.BarterLabels[1]);
            Assert.Throws<NotSupportedException>(() => ((IList<TradeOfferView>)held.Offers).Clear());
            Assert.Throws<NotSupportedException>(() => ((IList<string>)held.BarterLabels)[0] = "change");

            transport.Deliver(new ServerMsg.State { Tick = 2, Items = Array.Empty<StateItem>() });
            Assert.AreSame(held, session.Collections.Trade, "an omitted key retains the previous complete value");
            transport.Deliver(TradeFrame(3, new TradeState { Available = true, Value = new WireTradeView() }));
            var empty = session.Collections.Trade;
            Assert.IsTrue(empty.Available); Assert.AreEqual(0, empty.Offers.Count); Assert.AreEqual(0, empty.Merchants.Count);
            Assert.AreEqual(3, empty.BarterLabels.Count);
            transport.Deliver(TradeFrame(4, new TradeState { Available = false }));
            Assert.IsFalse(session.Collections.Trade.Available);
            Assert.AreEqual(0, session.Collections.Trade.Offers.Count);
            Assert.AreNotSame(empty, session.Collections.Trade);

            transport.Deliver(TradeFrame(5, new TradeState { Available = true, Value = new WireTradeView() }));
            session.Input.Trade(TradeKind.Stats, 1);
            transport.Drop(); session.Update(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]),
            });
            Assert.IsNull(session.Collections.Trade, "Welcome resets prior Trade state before the replacement arrives");
            Assert.AreEqual(0, session.Input.Flush(0).Count, "Welcome clears commands queued for the prior connection");
        }

        [Test]
        public void TradeDecoderRejectsMalformedFlagsKindsCountsValuesAndCoordinates()
        {
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w => w.U8(2))));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w => { w.U8(1); w.U8(2); })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w => { w.U8(1); w.U8(0); w.Varint(4); })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(1); w.U8(7);
            })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(1); w.U8(1); w.F64(1); w.U8(1); w.F64(2); w.Str("same stat");
            })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(0); w.Varint(1); w.U8(0); w.F64(double.NaN);
            })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(0); w.Varint(0); w.U8(2);
            })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(0); w.Varint(0); w.U8(0); w.Varint(1); w.U8(2);
            })));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(0); w.Varint(0); w.U8(0); w.Varint(1); w.U8(0); w.F64(8192);
            })));
            byte[] trailing = RawTrade(w =>
            {
                w.U8(1); w.U8(0); w.Varint(0); w.Varint(0); w.U8(0); w.Varint(0); w.Str(""); w.Str(""); w.Str("");
            });
            Array.Resize(ref trailing, trailing.Length + 1); trailing[trailing.Length - 1] = 0;
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(trailing), "a byte after a structurally complete maximum-shaped value is trailing frame data");
        }

        [Test]
        public void MalformedTradeReplacementCannotPartiallyApplyEarlierStateKeys()
        {
            var session = ReadySession(out var transport);
            transport.Deliver(new ServerMsg.State
            {
                Tick = 1,
                Items = new StateItem[]
                {
                    new InventoryState { Value = new WireInventory { ActiveSlot = 0, PotionSmall = 3 } },
                    new TradeState { Available = true, Value = new WireTradeView() },
                },
            });
            var oldTrade = session.Collections.Trade;
            byte[] malformedLaterKey = { 0x88, 2, 2, 1, 0, 11, 2 }; // valid inventory replacement, invalid strict Trade availability
            int errors = session.DecodeErrors;
            transport.DeliverRaw(malformedLaterKey);
            Assert.AreEqual(errors + 1, session.DecodeErrors);
            Assert.AreEqual(1, session.Collections.Tick);
            Assert.AreEqual((byte)3, session.Collections.Inventory.Value.PotionSmall);
            Assert.AreSame(oldTrade, session.Collections.Trade);
        }

        [Test]
        public void DirectCollectionApplyRevalidatesTradeAndCopiesMutableWireArraysBeforeCommit()
        {
            var session = ReadySession(out _);
            var source = TradeSample();
            ApplyDirect(session.Collections, new ServerMsg.State
            {
                Tick = 1,
                Items = new StateItem[]
                {
                    new InventoryState { Value = new WireInventory { ActiveSlot = 0, PotionSmall = 2 } },
                    new TradeState { Available = true, Value = source },
                },
            });
            var held = session.Collections.Trade;
            source.Offers[0].Label = "mutated DTO";
            source.Stats[0].Value = 17;
            source.Merchants[0].Name = "mutated DTO";
            source.BarterLabels[0] = "mutated DTO";
            Assert.AreEqual("A label", held.Offers[0].Label);
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(-0.0), BitConverter.DoubleToInt64Bits(held.Stats[0].Value));
            Assert.AreEqual("same", held.Merchants[0].Name);
            Assert.AreEqual("", held.BarterLabels[0]);

            var invalid = new WireTradeView { Stats = new[] { new WireTradeDelta { Stat = (TradeStat)7, Value = 1 } } };
            var applyError = Assert.Throws<TargetInvocationException>(() => ApplyDirect(session.Collections, new ServerMsg.State
            {
                Tick = 2,
                Items = new StateItem[]
                {
                    new InventoryState { Value = new WireInventory { ActiveSlot = 0, PotionSmall = 5 } },
                    new TradeState { Available = true, Value = invalid },
                },
            }));
            Assert.AreEqual("InvalidCollectionStateException", applyError.InnerException.GetType().Name);
            Assert.AreEqual(1, session.Collections.Tick);
            Assert.AreEqual((byte)2, session.Collections.Inventory.Value.PotionSmall);
            Assert.AreSame(held, session.Collections.Trade);
        }

        [Test]
        public void TradeInput18UsesOrdinaryBatchQueueAndRejectsBadKindOrPick()
        {
            var sender = new InputSender();
            for (byte i = 0; i < 17; i++) sender.Trade((i & 1) == 0 ? TradeKind.Barter : TradeKind.Stats, (byte)(i % 3));
            var frames = sender.Flush(0);
            Assert.AreEqual(2, frames.Count);
            Assert.AreEqual(16, frames[0].Commands.Count); Assert.AreEqual(1, frames[1].Commands.Count);
            byte[] expectedFirst = { 2, 1, 0, 0, 0, 16, 0, 18, 0, 0 };
            CollectionAssert.AreEqual(expectedFirst, frames[0].Encode().AsSpan(0, 10).ToArray());
            var decoded = (ClientMsg.Input)ClientMsg.Decode(frames[0].Encode());
            Assert.AreEqual(CommandKind.Trade, decoded.Commands[0].Kind);
            Assert.AreEqual(TradeKind.Barter, decoded.Commands[0].TradeKind);
            Assert.AreEqual(0, decoded.Commands[0].Pick);
            Assert.AreEqual(TradeKind.Stats, decoded.Commands[1].TradeKind);
            Assert.AreEqual(1, decoded.Commands[1].Pick);
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(new byte[] { 2, 1, 0, 0, 0, 1, 0, 18, 2, 0 }));
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(new byte[] { 2, 1, 0, 0, 0, 1, 0, 18, 0, 3 }));
            Assert.Throws<ArgumentException>(() => new ClientMsg.Input
            {
                Commands = new List<WireCommand> { new WireCommand { Kind = CommandKind.Trade, TradeKind = (TradeKind)2, Pick = 0 } },
            }.Encode());
            Assert.Throws<ArgumentException>(() => new ClientMsg.Input
            {
                Commands = new List<WireCommand> { new WireCommand { Kind = CommandKind.Trade, TradeKind = TradeKind.Barter, Pick = -1 } },
            }.Encode());
            var bad = new InputSender(); bad.Trade(TradeKind.Stats, 3);
            Assert.AreEqual(1, bad.Dropped); Assert.AreEqual(0, bad.Flush(0).Count);
            bad.Trade((TradeKind)2, 1); Assert.AreEqual(2, bad.Dropped);
        }

        [Test]
        public void QuestMetadataStringsAreOpaqueUtf8AndAggregateBudgetIsEnforced()
        {
            string at255 = new string('é', 127) + "x";
            var row = new WireQuestRow
            {
                Handle = new QuestHandle(1), Def = "x", State = QuestRowState.Open,
                Name = at255, GiverLabel = "", Brief = "", Objective = "", Reward = "",
            };
            var single = new WireQuestView { Rows = new[] { row } };
            Assert.DoesNotThrow(() => ServerMsg.Decode(new ServerMsg.State
            {
                Tick = 1, Items = new StateItem[] { new QuestsState { Available = true, View = single } },
            }.Encode()));
            row.Name = new string('é', 128);
            Assert.Throws<EncodeException>(() => new ServerMsg.State
            {
                Tick = 1, Items = new StateItem[] { new QuestsState { Available = true, View = single } },
            }.Encode());

            var rows = new WireQuestRow[20];
            for (int i = 0; i < rows.Length; i++) rows[i] = new WireQuestRow
            {
                Handle = new QuestHandle((uint)(i + 1)), Def = "x", State = QuestRowState.Open,
                Name = "", GiverLabel = "", Brief = "", Objective = "", Reward = "",
            };
            var view = new WireQuestView { Rows = rows };
            int baseline = new ServerMsg.State { Tick = 1, Items = new StateItem[] { new QuestsState { Available = true, View = view } } }.Encode().Length - 4;
            int allowedBytes = 24576 - baseline;
            for (int i = 0; i < 100 && allowedBytes > 0; i++)
            {
                int n = Math.Min(255, allowedBytes);
                string value = new string('a', n);
                int rowIndex = i / 5;
                switch (i % 5)
                {
                    case 0: rows[rowIndex].Name = value; break;
                    case 1: rows[rowIndex].GiverLabel = value; break;
                    case 2: rows[rowIndex].Brief = value; break;
                    case 3: rows[rowIndex].Objective = value; break;
                    default: rows[rowIndex].Reward = value; break;
                }
                allowedBytes -= n;
            }
            Assert.AreEqual(0, allowedBytes, "the view has sufficient bounded text slots to hit the aggregate cap");
            var exact = new ServerMsg.State { Tick = 1, Items = new StateItem[] { new QuestsState { Available = true, View = view } } };
            Assert.AreEqual(24580, exact.Encode().Length, "four-byte frame header plus the exact 24,576-byte Quests value");
            rows[19].Reward += "x";
            Assert.Throws<EncodeException>(() => exact.Encode());
        }
    }
}

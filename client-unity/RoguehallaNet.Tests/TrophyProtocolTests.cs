using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class TrophyProtocolTests
    {
        static readonly TrophyStatKey[] Keys = {
            TrophyStatKey.Ad, TrophyStatKey.Ap, TrophyStatKey.Damage, TrophyStatKey.Health, TrophyStatKey.AttackSpeed,
            TrophyStatKey.Armor, TrophyStatKey.Mr, TrophyStatKey.Speed, TrophyStatKey.Leech
        };
        static double Gain(int i) => BitConverter.Int64BitsToDouble(unchecked((long)(0x3ff0000000000001UL + (ulong)i)));
        static WireRewardOption Kill(TrophyStatKey key, double gain) => new WireRewardOption { Kind = 3, KillKey = key, KillGain = gain };
        static WireRewardChest Chest(uint handle, params WireRewardOption[] options) => new WireRewardChest {
            Handle = new RewardChestHandle(handle), X = 80, Y = 160, ExpiresAt = 9000, Options = options, CanChoose = true
        };
        static ServerMsg.State MixedState() => new ServerMsg.State { Tick = 203, Items = new StateItem[] {
            new RewardChestsState { Rows = new[] {
                Chest(1, new WireRewardOption { Kind = 1, Id = 79 }, new WireRewardOption { Kind = 2, Id = 7 }),
                Chest(2, Kill(Keys[0], Gain(0)), Kill(Keys[1], Gain(1)), Kill(Keys[2], Gain(2))),
                Chest(3, Kill(Keys[3], Gain(3)), Kill(Keys[4], Gain(4)), Kill(Keys[5], Gain(5))),
                Chest(4, Kill(Keys[6], Gain(6)), Kill(Keys[7], Gain(7)), Kill(Keys[8], Gain(8)))
            }}
        }};
        static ServerMsg.Welcome Welcome() => new ServerMsg.Welcome {
            Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 42,
            TickRate = 20, Map = new MapBlob(4, 4, new byte[16])
        };

        [Test]
        public void AllNineTypedKeysAndExactGainsRoundTripIntoCopiedViewsWithoutChangingChoiceIdentity()
        {
            var encoded = MixedState().Encode();
            var decoded = (ServerMsg.State)ServerMsg.Decode(encoded);
            CollectionAssert.AreEqual(encoded, decoded.Encode());
            var wireRows = ((RewardChestsState)decoded.Items[0]).Rows;
            for (int i = 0; i < Keys.Length; i++)
            {
                var wireOption = wireRows[1 + i / 3].Options[i % 3];
                Assert.AreEqual(Keys[i], wireOption.KillKey);
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(Gain(i)), BitConverter.DoubleToInt64Bits(wireOption.KillGain));
            }

            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => 0 });
            session.Connect(); transport.Open(); transport.Deliver(Welcome()); transport.DeliverRaw(encoded);
            var chests = session.Collections.RewardChests;
            Assert.AreEqual(4, chests.Count);
            Assert.AreEqual(1u, chests[0].Handle.Value); Assert.AreEqual(79, (byte)chests[0].Options[0].Card.Value);
            Assert.AreEqual(7, (byte)chests[0].Options[1].Boost.Value);
            Assert.IsNull(chests[0].Options[0].KillKey); Assert.AreEqual(0, chests[0].Options[0].KillGain);
            Assert.AreEqual(2u, chests[1].Handle.Value); Assert.IsTrue(chests[1].CanChoose);
            var copied = chests.Skip(1).SelectMany(chest => chest.Options).ToArray();
            for (int i = 0; i < Keys.Length; i++)
            {
                Assert.AreEqual(Keys[i], copied[i].KillKey);
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(Gain(i)), BitConverter.DoubleToInt64Bits(copied[i].KillGain));
            }
            var input = new ClientMsg.Input { Seq = 10 };
            input.Commands.Add(WireCommand.Choose(chests[3].Handle, 2));
            var choose = ((ClientMsg.Input)ClientMsg.Decode(input.Encode())).Commands.Single();
            Assert.AreEqual(new RewardChestHandle(4), choose.RewardRef); Assert.AreEqual((sbyte)2, choose.Pick);
        }

        [Test]
        public void KillOptionEncoderRejectsUnknownOrIllTypedValues()
        {
            foreach (var bad in new[] {
                new WireRewardOption { Kind = 4 },
                new WireRewardOption { Kind = 3, KillGain = 1 },
                new WireRewardOption { Kind = 3, KillKey = (TrophyStatKey)9, KillGain = 1 },
                new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Ad, KillGain = 0 },
                new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Ad, KillGain = -1 },
                new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Ad, KillGain = double.NaN },
                new WireRewardOption { Kind = 3, KillKey = TrophyStatKey.Ad, KillGain = double.PositiveInfinity },
                new WireRewardOption { Kind = 3, Id = 1, KillKey = TrophyStatKey.Ad, KillGain = 1 },
                new WireRewardOption { Kind = 1, Id = 1, KillKey = TrophyStatKey.Ad, KillGain = 1 },
                new WireRewardOption { Kind = 2, Id = 1, KillGain = 1 },
            }) Assert.Throws<EncodeException>(() => OneOptionState(bad).Encode());
        }

        [Test]
        public void KillOptionDecoderRejectsUnknownKindKeyInvalidGainCountsAndEveryTruncation()
        {
            var valid = RawOption(3, (byte)TrophyStatKey.Leech, Gain(8));
            for (int end = 0; end < valid.Length; end++)
            {
                var prefix = new byte[end]; Array.Copy(valid, prefix, end);
                Assert.Throws<DecodeException>(() => ServerMsg.Decode(prefix), "prefix " + end);
            }
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawOption(4, 0, 1)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawOption(3, 9, 1)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawOption(3, 0, 0)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawOption(3, 0, -1)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawOption(3, 0, double.NaN)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawOption(3, 0, double.PositiveInfinity)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawCountState(4, 1)));
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(RawCountState(1, 513)));
        }

        [Test]
        public void CardAndBoostBytesRemainExactlyTheV12OptionShape()
        {
            var state = new ServerMsg.State { Tick = 1, Items = new StateItem[] { new RewardChestsState { Rows = new[] {
                Chest(1, new WireRewardOption { Kind = 1, Id = 79 }, new WireRewardOption { Kind = 2, Id = 7 })
            }}}};
            var bytes = state.Encode();
            CollectionAssert.AreEqual(new byte[] { 0x88, 1, 1, 4, 1, 1, 80, 0, 160, 0 }, bytes.Take(10).ToArray());
            Assert.AreEqual(2, bytes[18]);
            CollectionAssert.AreEqual(new byte[] { 1, 79, 0, 0, 2, 7, 0, 0 }, bytes.Skip(19).Take(8).ToArray());
            CollectionAssert.AreEqual(bytes, ServerMsg.Decode(bytes).Encode());
        }

        static ServerMsg.State OneOptionState(WireRewardOption option) => new ServerMsg.State { Tick = 1, Items = new StateItem[] {
            new RewardChestsState { Rows = new[] { Chest(1, option) } }
        }};

        static byte[] RawCountState(byte optionCount, uint rowCount)
        {
            var w = new Writer(); w.U8(0x88); w.Varint(1); w.Varint(1); w.Varint(4); w.Varint(rowCount);
            if (rowCount > 0) { w.Varint(1); w.U16(0); w.U16(0); w.F64(1); w.U8(optionCount); }
            return w.Finish();
        }

        static byte[] RawOption(byte kind, byte key, double gain)
        {
            var w = new Writer(); w.U8(0x88); w.Varint(1); w.Varint(1); w.Varint(4); w.Varint(1);
            w.Varint(1); w.U16(0); w.U16(0); w.F64(10); w.U8(1); w.U8(kind);
            if (kind == 3) { w.U8(key); w.F64(gain); }
            else w.U8(0);
            w.U8(0); // Taken
            w.U8(0); // TakenBy
            w.U8(0); // Picked
            w.U8(1); // CanChoose
            return w.Finish();
        }
    }
}

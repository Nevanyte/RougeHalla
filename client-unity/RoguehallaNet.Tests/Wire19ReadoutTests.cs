using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-WIRE19-B oracle (C# codec and client view): protocol 19 carries the viewer's own native readout rows as State
    /// key 14: count u8 (at most 28), then rows of card u8 (80..93), kind u8 (0..2), value f64, max f64, with 0 &lt;= value &lt;=
    /// max, both finite, cards in native order. The bytes are the brief's (docs/backlog/packets/P-WIRE19-B.md, "Wire layout"),
    /// shared with the Rust and JS oracles.</summary>
    public class Wire19ReadoutTests
    {
        // state_readouts: Marksman's Tally counter, Bastion meter, Pathfinder counter and marks, Marked Man counter 0.
        const string ReadoutsHex = "88dc01010e055000b81e85eb51b8be3f333333333333d33f510100000000000044400000000000406f405500cdcccccccccc0c4000000000000038405502000000000000084000000000000034405d000000000000000000000000000000f03f";
        // state_readouts_empty: key 14 with no rows.
        const string EmptyHex = "88dc01010e00";
        // Header (tag, tick 2, item count, key, row count); 18 bytes a row (card, kind, value, max).
        const int Header = 6, Row = 18;

        static WireReadout R(byte card, byte kind, double value, double max)
        {
            return new WireReadout { Card = card, Kind = kind, Value = value, Max = max };
        }

        static WireReadout[] Rows()
        {
            return new[] { R(80, 0, 0.12, 0.3), R(81, 1, 40, 250), R(85, 0, 3.6, 24), R(85, 2, 3, 20), R(93, 0, 0, 1) };
        }

        static ServerMsg.State Frame(params WireReadout[] rows)
        {
            return new ServerMsg.State { Tick = 220, Items = new StateItem[] { new ReadoutsState { Rows = rows } } };
        }

        static byte[] Patched(int row, int at, byte[] with)
        {
            var b = Util.FromHex(ReadoutsHex);
            Array.Copy(with, 0, b, Header + Row * row + at, with.Length);
            return b;
        }

        static DecodeError Refusal(byte[] bytes)
        {
            return Assert.Throws<DecodeException>(() => ServerMsg.Decode(bytes)).Error;
        }

        [Test]
        public void Key14IsTheNewestStateKeyInsideProtocol22()
        {
            Assert.AreEqual(22, Wire.ProtocolVersion); // P-SYNC-ORIGIN-1 (20); P-SYNC-ORIGIN-2 (22)
            Assert.AreEqual(14, (int)StateKey.Readouts);
            Assert.AreEqual(14u, new ReadoutsState().Key);
            Assert.AreEqual(28, ReadoutsState.MaxCount);
        }

        [Test]
        public void TheRowsEncodeToTheSpecifiedBytes()
        {
            Assert.AreEqual(ReadoutsHex, Util.ToHex(Frame(Rows()).Encode()), "five rows");
            Assert.AreEqual(EmptyHex, Util.ToHex(Frame().Encode()), "no rows");
        }

        [Test]
        public void TheVectorsDecodeToTheirRowsAndEveryPrefixIsRefused()
        {
            foreach (var (hex, want) in new[] { (ReadoutsHex, Rows()), (EmptyHex, Array.Empty<WireReadout>()) })
            {
                var bytes = Util.FromHex(hex);
                var state = (ServerMsg.State)ServerMsg.Decode(bytes);
                Assert.AreEqual(220u, state.Tick);
                var rows = ((ReadoutsState)state.Items.Single()).Rows;
                CollectionAssert.AreEqual(want, rows, hex + ": rows");
                CollectionAssert.AreEqual(bytes, state.Encode(), "re-encodes byte for byte");
                for (int end = 0; end < bytes.Length; end++)
                {
                    var prefix = new byte[end]; Array.Copy(bytes, prefix, end);
                    Assert.Throws<DecodeException>(() => ServerMsg.Decode(prefix), hex + ": prefix " + end);
                }
            }
        }

        [Test]
        public void TheEncoderRefusesEveryInvalidRow()
        {
            var tooMany = Enumerable.Range(0, 29).Select(i => R((byte)(80 + i / 3), 0, 0, 1)).ToArray();
            var cases = new (string, WireReadout[])[]
            {
                ("29 rows", tooMany),
                ("catalog card 79", new[] { R(79, 0, 0, 1) }),
                ("card 94", new[] { R(94, 0, 0, 1) }),
                ("kind 3", new[] { R(80, 3, 0, 1) }),
                ("value NaN", new[] { R(80, 0, double.NaN, 1) }),
                ("max infinite", new[] { R(80, 0, 0, double.PositiveInfinity) }),
                ("value negative", new[] { R(80, 0, -0.5, 1) }),
                ("value over max", new[] { R(80, 0, 1.5, 1) }),
                ("order", new[] { R(81, 0, 0, 1), R(80, 0, 0, 1) }),
            };
            foreach (var (what, rows) in cases)
                Assert.Throws<EncodeException>(() => Frame(rows).Encode(), what);
            Assert.DoesNotThrow(() => Frame(R(80, 2, 20, 20), R(85, 0, 1, 2), R(85, 2, 1, 2), R(93, 0, 0, 0)).Encode(),
                "value equal to max, two rows of one card, the last native id");
        }

        [Test]
        public void TheDecoderRefusesEveryInvalidRowAsBadField()
        {
            var cases = new (string, byte[])[]
            {
                ("count 29", Util.FromHex("88dc01010e1d")),
                ("card 79", Patched(0, 0, new byte[] { 79 })),
                ("card 94", Patched(4, 0, new byte[] { 94 })),
                ("kind 3", Patched(1, 1, new byte[] { 3 })),
                ("value NaN", Patched(0, 2, BitConverter.GetBytes(double.NaN))),
                ("value negative", Patched(0, 2, BitConverter.GetBytes(-0.5))),
                ("value over max", Patched(1, 2, BitConverter.GetBytes(250.5))),
                ("max infinite", Patched(1, 10, BitConverter.GetBytes(double.PositiveInfinity))),
                ("order", Patched(2, 0, new byte[] { 80 })),
            };
            foreach (var (what, bytes) in cases)
                Assert.AreEqual(DecodeError.BadField, Refusal(bytes), what);
            // P-AUG-NATIVE-5 (oracle-amend): key 15 is the Marked Man rows; 16 is the first unknown key.
            Assert.AreEqual(DecodeError.BadField, Refusal(new byte[] { 0x88, 0, 1, 16 }), "key 16 is unknown");
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(new byte[] { 0x88, 0, 16 }), "16 keys are too many");
        }

        static (Session, FakeTransport) Connected()
        {
            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => 0 });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome
            {
                Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 42,
                TickRate = 20, Map = new MapBlob(4, 4, new byte[16])
            });
            return (session, transport);
        }

        [Test]
        public void TheClientViewHoldsTheOwnersRowsUntilReplaced()
        {
            var (session, transport) = Connected();
            Assert.AreEqual(0, session.Collections.Readouts.Count, "empty before key 14 arrives");
            Assert.IsFalse(session.Collections.HasFullState, "premise: no full state yet");
            transport.DeliverRaw(Util.FromHex(ReadoutsHex));
            var rows = session.Collections.Readouts;
            Assert.AreEqual(5, rows.Count, "the view keeps every row");
            CollectionAssert.AreEqual(Rows(), rows.ToArray(), "in wire order");
            Assert.AreEqual(93, rows[4].Card, "a native id is kept");
            transport.DeliverRaw(Util.FromHex(EmptyHex));
            Assert.AreEqual(0, session.Collections.Readouts.Count, "key 14 with no rows clears them");
        }

        [Test]
        public void TheV19FixtureCarriesTheseVectors()
        {
            // P-SYNC-ORIGIN-2: the local v20 vectors live in v22.json (v20.json is origin's protocol 20).
            string path = Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "v22.json");
            Assert.IsTrue(File.Exists(path), "protocol/fixtures/v22.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)");
            var root = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
            Assert.AreEqual(22, root.GetProperty("protocol").GetInt32());
            string Named(string list, string name)
            {
                foreach (var v in root.GetProperty(list).EnumerateArray())
                    if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
                return null;
            }
            Assert.AreEqual(ReadoutsHex, Named("server", "state_readouts"));
            Assert.AreEqual(EmptyHex, Named("server", "state_readouts_empty"));
            foreach (var name in new[] { "state_readouts_count_29", "state_readouts_card_79", "state_readouts_card_94",
                "state_readouts_kind_3", "state_readouts_value_nan", "state_readouts_value_negative",
                "state_readouts_value_over_max", "state_readouts_max_infinite", "state_readouts_order" })
            {
                var hex = Named("malformedServer", name);
                Assert.IsNotNull(hex, "malformedServer has " + name);
                Assert.AreEqual(DecodeError.BadField, Refusal(Util.FromHex(hex)), name);
            }
            // P-AUG-NATIVE-5 (oracle-amend): the two vectors name 16 now.
            Assert.AreEqual("88000110", Named("malformedServer", "state_unknown_key"), "the unknown key is 16");
            Assert.AreEqual("880010", Named("malformedServer", "state_too_many_keys"), "16 keys are too many");
        }
    }
}

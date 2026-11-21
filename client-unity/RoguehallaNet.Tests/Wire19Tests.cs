using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-WIRE19-A oracle (C# codec and client view): protocol 19 carries native card ids (80..=93) in a reward option
    /// and the killer first-pick window as one trailing field of a reward chest row (tag u8, then f64 until and u8 mine).
    /// The bytes are the brief's (docs/backlog/packets/P-WIRE19-A.md, "Wire layout"), shared with the Rust and JS oracles.</summary>
    public class Wire19Tests
    {
        // state_reward_first_pick_other: row A (Marked Man 93, Marksman's Tally 80, boost 2) under a window ending at 11000 that is
        // not this viewer's; row B (card 79 taken by 4) without a window.
        const string OtherHex = "88dc01010402052003c003000000000082d44003015d0000015000000202000000000100000000007cc54000066400c80000000000004ccd4001014f010104000000";
        // state_reward_first_pick_killer: the same rows as the killer sees them (row A: CanChoose and Mine true).
        const string KillerHex = "88dc01010402052003c003000000000082d44003015d0000015000000202000000010100000000007cc54001066400c80000000000004ccd4001014f010104000000";
        // Header (tag, tick 2, item count, key, row count), then row A: handle, x, y, expiry, n, three options, picked, can_choose.
        const int WindowTagAt = 6 + 1 + 2 + 2 + 8 + 1 + 3 * 4 + 2;

        static WireRewardOption Option(byte kind, byte id) { return new WireRewardOption { Kind = kind, Id = id }; }

        static WireRewardChest RowA(bool mine)
        {
            return new WireRewardChest
            {
                Handle = new RewardChestHandle(5), X = 800, Y = 960, ExpiresAt = 21000,
                Options = new[] { Option(1, 93), Option(1, 80), Option(2, 2) },
                CanChoose = mine, FirstPick = new WireFirstPick { Until = 11000, Mine = mine }
            };
        }

        static WireRewardChest RowB()
        {
            return new WireRewardChest
            {
                Handle = new RewardChestHandle(6), X = 100, Y = 200, ExpiresAt = 15000,
                Options = new[] { new WireRewardOption { Kind = 1, Id = 79, Taken = true, TakenBy = 4 } }
            };
        }

        static ServerMsg.State Frame(params WireRewardChest[] rows)
        {
            return new ServerMsg.State { Tick = 220, Items = new StateItem[] { new RewardChestsState { Rows = rows } } };
        }

        static DecodeError Refusal(byte[] bytes)
        {
            return Assert.Throws<DecodeException>(() => ServerMsg.Decode(bytes)).Error;
        }

        [Test] public void CodecSpeaksProtocol22() { Assert.AreEqual(22, Wire.ProtocolVersion); } // P-SYNC-ORIGIN-1 (20); P-SYNC-ORIGIN-2 (22)

        [Test]
        public void TheWindowAndANativeCardEncodeToTheSpecifiedBytes()
        {
            Assert.AreEqual(OtherHex, Util.ToHex(Frame(RowA(false), RowB()).Encode()), "a viewer who is not the killer");
            Assert.AreEqual(KillerHex, Util.ToHex(Frame(RowA(true), RowB()).Encode()), "the killer");
        }

        [Test]
        public void TheVectorsDecodeToTheirRowsAndEveryPrefixIsRefused()
        {
            foreach (var (hex, mine) in new[] { (OtherHex, false), (KillerHex, true) })
            {
                var bytes = Util.FromHex(hex);
                var state = (ServerMsg.State)ServerMsg.Decode(bytes);
                Assert.AreEqual(220u, state.Tick);
                var rows = ((RewardChestsState)state.Items.Single()).Rows;
                Assert.AreEqual(2, rows.Length);
                CollectionAssert.AreEqual(new byte[] { 93, 80, 2 }, rows[0].Options.Select(o => o.Id).ToArray(), "native ids decode");
                CollectionAssert.AreEqual(new byte[] { 1, 1, 2 }, rows[0].Options.Select(o => o.Kind).ToArray());
                Assert.AreEqual(mine, rows[0].CanChoose);
                Assert.IsTrue(rows[0].FirstPick.HasValue, "row A carries the window");
                Assert.AreEqual(11000.0, rows[0].FirstPick.Value.Until);
                Assert.AreEqual(mine, rows[0].FirstPick.Value.Mine);
                Assert.IsFalse(rows[1].FirstPick.HasValue, "row B has no window");
                Assert.AreEqual(79, rows[1].Options[0].Id); Assert.AreEqual(4u, rows[1].Options[0].TakenBy);
                CollectionAssert.AreEqual(bytes, state.Encode(), "re-encodes byte for byte");
                for (int end = 0; end < bytes.Length; end++)
                {
                    var prefix = new byte[end]; Array.Copy(bytes, prefix, end);
                    Assert.Throws<DecodeException>(() => ServerMsg.Decode(prefix), "prefix " + end);
                }
            }
        }

        [Test]
        public void CardIdsRunTo93And94IsRefusedBothWays()
        {
            foreach (byte id in new byte[] { 0, 79, 80, 93 })
            {
                var row = RowB(); row.Options[0].Id = id;
                var bytes = Frame(row).Encode();
                Assert.AreEqual(id, ((RewardChestsState)((ServerMsg.State)ServerMsg.Decode(bytes)).Items[0]).Rows[0].Options[0].Id, "card " + id);
            }
            var past = RowB(); past.Options[0].Id = 94;
            Assert.Throws<EncodeException>(() => Frame(past).Encode(), "card 94 is past the native ids");
            var patched = Util.FromHex(OtherHex);
            patched[WindowTagAt - 2 - 3 * 4 + 1] = 94; // the first option's id (Marked Man)
            Assert.AreEqual(DecodeError.BadField, Refusal(patched), "card 94 decoded");
        }

        [Test]
        public void AWindowMustBeFiniteAndEndByTheChestsExpiry()
        {
            var ok = RowA(false); ok.FirstPick = new WireFirstPick { Until = 21000, Mine = false };
            Assert.DoesNotThrow(() => Frame(ok).Encode(), "a window may end with the chest");
            foreach (var until in new[] { 21000.5, double.NaN, double.PositiveInfinity, double.NegativeInfinity })
            {
                var bad = RowA(false); bad.FirstPick = new WireFirstPick { Until = until, Mine = false };
                Assert.Throws<EncodeException>(() => Frame(bad).Encode(), "until " + until);
            }
            var other = Util.FromHex(OtherHex);
            Assert.AreEqual(1, other[WindowTagAt], "the window's tag");
            byte[] Patch(int at, byte[] with) { var b = (byte[])other.Clone(); Array.Copy(with, 0, b, at, with.Length); return b; }
            Assert.AreEqual(DecodeError.BadTag, Refusal(Patch(WindowTagAt, new byte[] { 2 })), "tag 2");
            Assert.AreEqual(DecodeError.BadTag, Refusal(Patch(WindowTagAt + 9, new byte[] { 2 })), "mine 2");
            Assert.AreEqual(DecodeError.BadField, Refusal(Patch(WindowTagAt + 1, BitConverter.GetBytes(double.NaN))), "until NaN");
            Assert.AreEqual(DecodeError.BadField, Refusal(Patch(WindowTagAt + 1, BitConverter.GetBytes(21000.5))), "until after the expiry");
        }

        [Test]
        public void TheClientViewCopiesTheWindowAndANativeCard()
        {
            foreach (var (hex, mine) in new[] { (OtherHex, false), (KillerHex, true) })
            {
                var transport = new FakeTransport();
                var session = new Session(transport, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = Array.Empty<byte>(), Now = () => 0 });
                session.Connect(); transport.Open();
                transport.Deliver(new ServerMsg.Welcome
                {
                    Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 42,
                    TickRate = 20, Map = new MapBlob(4, 4, new byte[16])
                });
                transport.DeliverRaw(Util.FromHex(hex));
                var chests = session.Collections.RewardChests;
                Assert.AreEqual(2, chests.Count, "mine=" + mine + ": both rows reach the view");
                Assert.AreEqual(93, (byte)chests[0].Options[0].Card.Value, "a native card id is kept, not refused");
                Assert.AreEqual(80, (byte)chests[0].Options[1].Card.Value);
                Assert.AreEqual(mine, chests[0].CanChoose);
                Assert.IsTrue(chests[0].FirstPick.HasValue, "mine=" + mine + ": the view carries the window");
                Assert.AreEqual(11000.0, chests[0].FirstPick.Value.Until);
                Assert.AreEqual(mine, chests[0].FirstPick.Value.Mine);
                Assert.IsFalse(chests[1].FirstPick.HasValue, "a row without a window");
            }
        }

        [Test]
        public void TheV19FixtureCarriesTheseVectors()
        {
            // P-SYNC-ORIGIN-2: the local v20 vectors live in v22.json (v20.json is origin's protocol 20).
            string path = Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "v22.json");
            Assert.IsTrue(File.Exists(path), "protocol/fixtures/v22.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)");
            var root = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
            Assert.AreEqual(22, root.GetProperty("protocol").GetInt32());
            string Server(string name)
            {
                foreach (var v in root.GetProperty("server").EnumerateArray())
                    if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
                return null;
            }
            Assert.AreEqual(OtherHex, Server("state_reward_first_pick_other"));
            Assert.AreEqual(KillerHex, Server("state_reward_first_pick_killer"));
            var malformed = root.GetProperty("malformedServer").EnumerateArray().Select(v => v.GetProperty("name").GetString()).ToArray();
            foreach (var name in new[] { "state_reward_card_id_94", "state_reward_first_pick_tag_2", "state_reward_first_pick_mine_2",
                "state_reward_first_pick_nonfinite", "state_reward_first_pick_after_expiry" })
                CollectionAssert.Contains(malformed, name);
            CollectionAssert.DoesNotContain(malformed, "state_reward_card_id_80", "card 80 is a native id now");
        }
    }
}

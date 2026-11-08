using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public sealed class TrophyTextTests
    {
        static readonly string[] Keys = { "ad", "ap", "damage", "health", "attackSpeed", "armor", "mr", "speed", "leech" };

        [Test]
        public void ActualSourceWordsSurviveExactWireAndOwnedViewAcrossAllKeysAndTieNeighbours()
        {
            var bytes = File.ReadAllBytes(Path.Combine(Util.RepoRoot(), "docs/evidence/trophy-wire13/source-format.json"));
            Assert.AreEqual("b75078a3286913391d5c7f309536bc6e8e8c4ea2f101a8ad939ad1f235e4673c",
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), "immutable source capture from 7bf5806c");
            using var corpus = JsonDocument.Parse(bytes);
            var cases = corpus.RootElement.GetProperty("cases");
            int words = 0, ties = 0;
            foreach (var row in cases.GetProperty("keys").EnumerateArray())
            { CheckWords(row); words++; }
            Assert.AreEqual(9, words);
            foreach (var group in cases.GetProperty("ties").EnumerateArray())
            {
                foreach (var row in group.GetProperty("rows").EnumerateObject())
                {
                    CheckWords(row.Value);
                    if (group.GetProperty("kind").GetString() == "flat-1dp")
                    {
                        long expectedBits = unchecked((long)Convert.ToUInt64(row.Value.GetProperty("bits").GetString().Substring(2), 16));
                        double raw = row.Value.GetProperty("raw").GetDouble();
                        Assert.AreEqual(expectedBits, BitConverter.DoubleToInt64Bits(raw));
                        Assert.AreEqual(row.Value.GetProperty("fixed").GetString(), TrophyText.FixedOne(raw));
                    }
                }
                ties++;
            }
            Assert.AreEqual(28, ties);
            foreach (var group in cases.GetProperty("tiny").EnumerateArray())
                foreach (var row in group.GetProperty("rows").EnumerateArray()) CheckWords(row);
        }

        static void CheckWords(JsonElement row)
        {
            if (row.GetProperty("parsed").ValueKind == JsonValueKind.Null) return;
            var parsed = row.GetProperty("parsed");
            var key = (TrophyStatKey)Array.IndexOf(Keys, parsed.GetProperty("key").GetString());
            double gain = parsed.GetProperty("gain").GetDouble();
            var state = new ServerMsg.State { Tick = 20, Items = new StateItem[] {
                new RewardChestsState { Rows = new[] { new WireRewardChest {
                    Handle = new RewardChestHandle(73), X = 10, Y = 20, ExpiresAt = 15000, CanChoose = true,
                    Options = new[] { new WireRewardOption { Kind = 3, KillKey = key, KillGain = gain } }
                } } }
            } };
            var transport = new FakeTransport();
            var session = new Session(transport, new SessionOptions { Url = "ws://fixture/ws", Profile = "fixture", Ticket = new byte[0] });
            session.Connect(); transport.Open();
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            transport.Deliver(state);
            var option = session.Collections.RewardChests[0].Options[0];
            Assert.AreEqual(key, option.KillKey);
            Assert.AreEqual(BitConverter.DoubleToInt64Bits(gain), BitConverter.DoubleToInt64Bits(option.KillGain));
            var text = row.GetProperty("text");
            Assert.AreEqual(text.GetProperty("title").GetString(), TrophyText.Title(option.KillKey.Value, option.KillGain));
            Assert.AreEqual(text.GetProperty("text").GetString(), TrophyText.Description(option.KillKey.Value, option.KillGain));
            session.Leave();
        }
    }
}

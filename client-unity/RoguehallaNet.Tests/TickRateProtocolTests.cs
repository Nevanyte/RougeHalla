using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-TICK-3 oracle (C#, ADR 0029, protocol 21): a snapshot's server time is Tick * (1000 / Welcome.TickRate);
    /// only 20 and 40 are rates, so a Welcome at 30 is refused. The same frame bytes stand for Tick * 50 at 20 and Tick * 25
    /// at 40; a decoded 40 Hz snapshot re-encodes to its own bytes (the override test in ServerMsg.Snapshot.cs reads the
    /// snapshot's rate, not Wire.TickMs). A session ignores a snapshot before its Welcome and reads later ones at the
    /// Welcome's rate. The frames below are the Rust encoder's (crates/rh-protocol/tests/tick_rate_wire.rs).</summary>
    public class TickRateProtocolTests
    {
        /// <summary>A Full snapshot of tick 10 (12 actors, ack 10), no source-time override.</summary>
        const string Full10 = "830a0a000c01006004c00600000100a005400700000100e006c0070000010020084008000001006009c00800000100a00a400900000100e00bc00900000100200d400a00000100600ec00a00000100a00f400b00000100e010c00b000001002012400c0000";
        /// <summary>The delta of tick 11 against <see cref="Full10"/> (actor 3 moved), no override.</summary>
        const string Delta11 = "870b010b000103012007";
        /// <summary>Tick 20 with an override of 888.75 ms (the default at neither rate).</summary>
        const string Tick20At888 = "8314038080200000000000c68b4000";
        /// <summary>Tick 7, no override.</summary>
        const string Tick7 = "8307030000";
        /// <summary>Byte offset of TickRate in a Welcome: tag 1 + protocol 2 + content hash 8 + match 16 + player 4 + session 16.</summary>
        const int WelcomeRateAt = 47;

        static ServerMsg.Welcome Welcome(byte rate)
        {
            return new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3, Session = new byte[16],
                TickRate = rate, Tick = 1, ServerMs = 50, Map = new MapBlob(4, 4, new byte[16]) };
        }

        /// <summary>A 20 Hz Welcome's bytes with the rate byte replaced (an encoder may refuse to write a bad rate).</summary>
        static byte[] WelcomeBytes(byte rate)
        {
            byte[] b = Welcome(20).Encode();
            Assert.AreEqual(20, b[WelcomeRateAt], "the rate byte of a Welcome");
            b[WelcomeRateAt] = rate;
            return b;
        }

        static ServerMsg.Snapshot At(string hex, byte rate)
        {
            byte[] b = Util.FromHex(hex);
            return (ServerMsg.Snapshot)ServerMsg.Decode(b, b.Length, null, rate);
        }

        static ServerMsg.Snapshot Track(SnapshotTracker t, string hex)
        {
            byte[] b = Util.FromHex(hex);
            return (ServerMsg.Snapshot)t.Decode(b, b.Length, null);
        }

        static Session NewSession(FakeTransport t)
        {
            return new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = new byte[] { 1 }, Now = () => 1000, ReconnectBaseMs = 500, MaxReconnectAttempts = 3 });
        }

        [Test] public void CodecSpeaksProtocol22() { Assert.AreEqual(22, Wire.ProtocolVersion, "snapshot time read from Welcome.TickRate is an incompatible wire change: 20 -> 21 (origin); P-SYNC-ORIGIN-2 carries it as 22"); }

        [Test]
        public void TheSameSnapshotBytesAreTickTimes50At20AndTickTimes25At40()
        {
            Assert.AreEqual(500.0, At(Full10, 20).ServerMs);
            Assert.AreEqual(250.0, At(Full10, 40).ServerMs, "tick 10 at 40 Hz");
            Assert.AreEqual(350.0, At(Tick7, 20).ServerMs);
            Assert.AreEqual(175.0, At(Tick7, 40).ServerMs, "tick 7 at 40 Hz");
            Assert.AreEqual(500.0, ((ServerMsg.Snapshot)ServerMsg.Decode(Util.FromHex(Full10))).ServerMs, "a decode without a rate is the 20 Hz decode");
            Assert.AreEqual(888.75, At(Tick20At888, 20).ServerMs, "an override is read as written");
            Assert.AreEqual(888.75, At(Tick20At888, 40).ServerMs, "at both rates");
        }

        [Test]
        public void ADecoded40HzSnapshotReencodesToItsOwnBytes()
        {
            foreach (var hex in new[] { Full10, Tick7, Tick20At888 })
            {
                var s = At(hex, 40);
                Assert.AreEqual(hex, Util.ToHex(s.Encode()), "a 40 Hz snapshot's default time is not written as an override");
                // The session's own copy of the time: an override equal to the 40 Hz default is still the default.
                s.ServerTimeOverrideMs = s.ServerMs;
                Assert.AreEqual(hex, Util.ToHex(s.Encode()), "an override equal to Tick * 25 is omitted at 40 Hz");
            }
        }

        [Test]
        public void AWelcomeAt30IsRefusedAnd20And40Accepted()
        {
            Assert.AreEqual((byte)20, ((ServerMsg.Welcome)ServerMsg.Decode(WelcomeBytes(20))).TickRate);
            Assert.AreEqual((byte)40, ((ServerMsg.Welcome)ServerMsg.Decode(WelcomeBytes(40))).TickRate);
            foreach (byte rate in new byte[] { 30, 0, 60 })
                Assert.Throws<DecodeException>(() => ServerMsg.Decode(WelcomeBytes(rate)), "a Welcome at " + rate + " Hz is refused");
            byte[] tick7 = Util.FromHex(Tick7);
            Assert.Throws<DecodeException>(() => ServerMsg.Decode(tick7, tick7.Length, null, 30), "a snapshot cannot be read at 30 Hz");
        }

        [Test]
        public void ATrackerReadsSnapshotsAtItsLatestWelcomesRate()
        {
            var t = new SnapshotTracker();
            byte[] w40 = WelcomeBytes(40), w20 = WelcomeBytes(20), w30 = WelcomeBytes(30);
            t.Decode(w40, w40.Length, null);
            Assert.AreEqual(250.0, Track(t, Full10).ServerMs, "a Full frame after a 40 Hz Welcome");
            Assert.AreEqual(275.0, Track(t, Delta11).ServerMs, "the delta resolves at 40 Hz");
            Assert.Throws<DecodeException>(() => t.Decode(w30, w30.Length, null), "a 30 Hz Welcome is refused");
            Assert.AreEqual(11u, t.HeldTick, "a refused Welcome resets nothing");
            Assert.AreEqual(175.0, Track(t, Tick7).ServerMs, "still at 40 Hz");
            t.Decode(w20, w20.Length, null);
            Assert.AreEqual(500.0, Track(t, Full10).ServerMs);
            Assert.AreEqual(550.0, Track(t, Delta11).ServerMs);
        }

        [Test]
        public void ASessionIgnoresASnapshotBeforeItsWelcomeAndReadsLaterOnesAtTheWelcomesRate()
        {
            var tr = new FakeTransport(); var s = NewSession(tr);
            s.Connect(); tr.Open();
            tr.DeliverRaw(Util.FromHex(Full10));
            Assert.IsNull(s.Latest, "a snapshot before the Welcome is not taken");
            Assert.AreEqual(SessionState.HelloSent, s.State, "and the handshake goes on");

            byte[] w30 = WelcomeBytes(30);
            tr.DeliverRaw(w30);
            Assert.AreNotEqual(SessionState.InMatch, s.State, "a 30 Hz Welcome does not start the match");
            Assert.IsNull(s.Welcome, "nor is it kept");
            tr.DeliverRaw(Util.FromHex(Full10));
            Assert.IsNull(s.Latest, "a refused Welcome gives no rate");

            var ok = new FakeTransport(); var s40 = NewSession(ok);
            s40.Connect(); ok.Open();
            ok.Deliver(Welcome(40));
            Assert.AreEqual(SessionState.InMatch, s40.State, "a 40 Hz Welcome starts the match");
            ok.DeliverRaw(Util.FromHex(Full10));
            Assert.AreEqual(250.0, s40.Latest.ServerMs, "tick 10 at 40 Hz");
            ok.DeliverRaw(Util.FromHex(Delta11));
            Assert.AreEqual(11u, s40.Latest.Tick);
            Assert.AreEqual(275.0, s40.Latest.ServerMs, "tick 11 at 40 Hz");
        }

        [Test]
        public void V21FortyHertzVectorsDecodeToTickTimes25()
        {
            string path = Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "v21.json");
            Assert.IsTrue(File.Exists(path), "protocol/fixtures/v21.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)");
            var root = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
            Assert.AreEqual(21, root.GetProperty("protocol").GetInt32());
            Assert.IsTrue(root.TryGetProperty("serverTickRate40", out var section), "v21.json has a serverTickRate40 section");
            int n = 0;
            foreach (var v in section.EnumerateArray())
            {
                string name = v.GetProperty("name").GetString();
                var s = At(v.GetProperty("hex").GetString(), 40);
                double want = v.GetProperty("decoded").GetProperty("serverMs").GetDouble();
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(want), BitConverter.DoubleToInt64Bits(s.ServerMs), name + " serverMs");
                Assert.AreEqual(v.GetProperty("decoded").GetProperty("tick").GetUInt32(), s.Tick, name + " tick");
                n++;
            }
            Assert.GreaterOrEqual(n, 3, "at least three 40 Hz vectors");
        }
    }
}

using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-PROTOCOL-18-STAMP-1 oracle (client): the codec speaks protocol 18 (owner approval 9, 2026-11-12), decodes the
    /// v18 golden vectors as protocol 18, and a session refuses a protocol-17 server's Welcome while accepting an 18 one.
    /// P-NET-DRAWAHEAD-1a moved the codec to protocol 19 (the walk hint): an 18 Welcome is now the refused one.
    /// P-COLISEUM-HEALS-2 moved it to protocol 20 (the heal prop): a 19 Welcome is now the refused one.
    /// P-TICK-3 moved it to protocol 21 (snapshot time from the Welcome rate): a 20 Welcome is now the refused one.
    /// P-SYNC-ORIGIN-2 merged both lines as protocol 22: every Welcome of 17 to 21 is refused.</summary>
    public class Protocol18StampTests
    {
        /// <summary>P-WIRE19-A moved the codec to 19; the v18 history below stays.</summary>
        [Test] public void CodecSpeaksProtocol18OrLater() { Assert.GreaterOrEqual((int)Wire.ProtocolVersion, 18); }
        /// <summary>P-NET-DRAWAHEAD-1a pinned 19; P-SYNC-ORIGIN-1 merged both protocol-19 wires as 20; origin took 20 and 21
        /// (heal props, tick rate); P-SYNC-ORIGIN-2 merged both lines as 22.</summary>
        [Test] public void CodecSpeaksProtocol22() { Assert.AreEqual(22, Wire.ProtocolVersion); }

        [Test]
        public void V18FixtureExistsAndItsHelloSays18()
        {
            string path = Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "v18.json");
            Assert.IsTrue(File.Exists(path), "protocol/fixtures/v18.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)");
            var root = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
            Assert.AreEqual(18, root.GetProperty("protocol").GetInt32());
            ClientMsg.Hello hello = null; ServerMsg.Welcome welcome = null;
            foreach (var v in root.GetProperty("client").EnumerateArray())
                if (v.GetProperty("name").GetString() == "hello") hello = (ClientMsg.Hello)ClientMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
            foreach (var v in root.GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == "welcome") welcome = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
            Assert.IsNotNull(hello, "v18.json has a hello vector"); Assert.IsNotNull(welcome, "v18.json has a welcome vector");
            Assert.AreEqual(18, hello.Protocol); Assert.AreEqual(18, welcome.Protocol);
        }

        static Session NewSession(FakeTransport t)
        {
            return new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = new byte[] { 1 }, Now = () => 1000, ReconnectBaseMs = 500, MaxReconnectAttempts = 3 });
        }

        static ServerMsg.Welcome Welcome(ushort protocol)
        {
            return new ServerMsg.Welcome { Protocol = protocol, MatchId = new byte[16], PlayerId = 3, Session = new byte[16], TickRate = 20, Tick = 1, ServerMs = 50, Map = new MapBlob(4, 4, new byte[16]) };
        }

        [Test]
        public void AProtocol21WelcomeIsRefusedAndA22WelcomeAccepted()
        {
            // P-WIRE19-A refused 17, P-NET-DRAWAHEAD-1a refused 18; P-SYNC-ORIGIN-1 (protocol 20) refuses both and 19;
            // P-SYNC-ORIGIN-2 (protocol 22) refuses 20 (both lines' 20s) and origin's 21 as well.
            foreach (ushort oldProtocol in new ushort[] { 17, 18, 19, 20, 21 })
            {
                var old = new FakeTransport(); var sOld = NewSession(old);
                sOld.Connect(); old.Open();
                Assert.AreEqual(Wire.ProtocolVersion, old.LastSent<ClientMsg.Hello>().Protocol, "the Hello says the codec's version");
                old.Deliver(Welcome(oldProtocol));
                Assert.AreEqual(SessionState.Failed, sOld.State, $"a protocol-{oldProtocol} Welcome is refused");
                StringAssert.Contains($"server protocol {oldProtocol}", sOld.Error);
            }

            var cur = new FakeTransport(); var sCur = NewSession(cur);
            sCur.Connect(); cur.Open();
            cur.Deliver(Welcome(Wire.ProtocolVersion));
            Assert.AreEqual(SessionState.InMatch, sCur.State, "a Welcome of the codec's version starts the match");
        }
    }
}

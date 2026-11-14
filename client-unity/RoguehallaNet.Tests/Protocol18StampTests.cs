using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-PROTOCOL-18-STAMP-1 oracle (client): the codec speaks protocol 18 (owner approval 9, 2026-11-12), decodes the
    /// v18 golden vectors as protocol 18, and a session refuses a protocol-17 server's Welcome while accepting an 18 one.</summary>
    public class Protocol18StampTests
    {
        [Test] public void CodecSpeaksProtocol18() { Assert.AreEqual(18, Wire.ProtocolVersion); }

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
        public void AProtocol17WelcomeIsRefusedAndA18WelcomeAccepted()
        {
            var old = new FakeTransport(); var s17 = NewSession(old);
            s17.Connect(); old.Open();
            Assert.AreEqual(18, old.LastSent<ClientMsg.Hello>().Protocol, "the Hello says 18");
            old.Deliver(Welcome(17));
            Assert.AreEqual(SessionState.Failed, s17.State, "a protocol-17 Welcome is refused");
            StringAssert.Contains("server protocol 17", s17.Error);

            var cur = new FakeTransport(); var s18 = NewSession(cur);
            s18.Connect(); cur.Open();
            cur.Deliver(Welcome(18));
            Assert.AreEqual(SessionState.InMatch, s18.State, "a protocol-18 Welcome starts the match");
        }
    }
}

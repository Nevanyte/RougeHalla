using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class ProtocolVectorTests
    {
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", "v1.json"))).RootElement; }

        static IEnumerable<TestCaseData> Vectors(string section)
        {
            foreach (var v in Fixture().GetProperty(section).EnumerateArray())
                yield return new TestCaseData(v.GetProperty("name").GetString(), v.GetProperty("hex").GetString()).SetName(section + ":" + v.GetProperty("name").GetString());
        }
        static IEnumerable<TestCaseData> ClientVectors() { return Vectors("client"); }
        static IEnumerable<TestCaseData> ServerVectors() { return Vectors("server"); }
        static IEnumerable<TestCaseData> MalformedVectors() { return Vectors("malformedClient"); }

        static T Server<T>(string name) where T : ServerMsg
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return (T)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
            throw new KeyNotFoundException(name);
        }
        static T Client<T>(string name) where T : ClientMsg
        {
            foreach (var v in Fixture().GetProperty("client").EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return (T)ClientMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
            throw new KeyNotFoundException(name);
        }

        [Test] public void FixtureIsProtocolV1() { Assert.AreEqual(Wire.ProtocolVersion, Fixture().GetProperty("protocol").GetInt32()); }

        [TestCaseSource(nameof(ClientVectors))]
        public void ClientVectorRoundTripsByteForByte(string name, string hex)
        {
            byte[] bytes = Util.FromHex(hex);
            Assert.AreEqual(hex, Util.ToHex(ClientMsg.Decode(bytes).Encode()), name);
        }

        [TestCaseSource(nameof(ServerVectors))]
        public void ServerVectorRoundTripsByteForByte(string name, string hex)
        {
            byte[] bytes = Util.FromHex(hex);
            Assert.AreEqual(hex, Util.ToHex(ServerMsg.Decode(bytes).Encode()), name);
        }

        [TestCaseSource(nameof(MalformedVectors))]
        public void MalformedClientFrameIsRejected(string name, string hex)
        {
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(Util.FromHex(hex)), name);
        }

        [Test]
        public void MalformedFramesFailForTheDocumentedReason()
        {
            DecodeError Err(string n) { foreach (var v in Fixture().GetProperty("malformedClient").EnumerateArray()) if (v.GetProperty("name").GetString() == n) { try { ClientMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString())); } catch (DecodeException e) { return e.Error; } } throw new Exception(n); }
            Assert.AreEqual(DecodeError.Truncated, Err("empty"));
            Assert.AreEqual(DecodeError.BadTag, Err("unknown_tag"));
            Assert.AreEqual(DecodeError.BadTag, Err("server_tag_from_client"));
            Assert.AreEqual(DecodeError.NonFinite, Err("nan_angle"));
            Assert.AreEqual(DecodeError.Trailing, Err("trailing_byte"));
            Assert.AreEqual(DecodeError.Truncated, Err("truncated"));
            Assert.AreEqual(DecodeError.TooMany, Err("too_many_commands"));
            Assert.AreEqual(DecodeError.BadUtf8, Err("bad_utf8"));
            Assert.AreEqual(DecodeError.TooLarge, Err("oversize"));
            Assert.AreEqual(DecodeError.BadTag, Err("bad_option_flag"));
        }

        [Test]
        public void HelloFields()
        {
            var h = Client<ClientMsg.Hello>("hello");
            Assert.AreEqual(1, h.Protocol);
            Assert.AreEqual(0x1122334455667788UL, h.ContentHash);
            Assert.AreEqual("web-0.1.0", h.Build);
            Assert.AreEqual("Nevan_01", h.Profile);
            Assert.AreEqual("tok-abc", h.Token);
            Assert.AreEqual((byte)4, h.Faction);
            Assert.IsNull(h.Resume);
            var r = Client<ClientMsg.Hello>("hello_resume");
            Assert.AreEqual("Ünïcode", r.Profile);
            Assert.IsNull(r.Faction);
            CollectionAssert.AreEqual(new byte[] { 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9 }, r.Resume);
        }

        [Test]
        public void InputAllCommandsFields()
        {
            var i = Client<ClientMsg.Input>("input_all_commands");
            Assert.AreEqual(42u, i.Seq);
            Assert.AreEqual(5, i.Commands.Count);
            var m = i.Commands[0];
            Assert.AreEqual(CommandKind.Move, m.Kind); Assert.AreEqual(1234.5f, m.X); Assert.AreEqual(-0.25f, m.Y); Assert.AreEqual((byte)7, m.Seq);
            Assert.AreEqual(CommandKind.Stop, i.Commands[1].Kind); Assert.IsNull(i.Commands[1].Seq);
            Assert.AreEqual(-3.1415927f, i.Commands[2].A);
            Assert.AreEqual(CommandKind.Attack, i.Commands[3].Kind); Assert.AreEqual(0.5f, i.Commands[3].A); Assert.AreEqual(12345.75, i.Commands[3].T);
            Assert.AreEqual(CommandKind.Release, i.Commands[4].Kind); Assert.IsNull(i.Commands[4].T);
        }

        [Test]
        public void WelcomeFieldsMapAndHash()
        {
            var w = Server<ServerMsg.Welcome>("welcome");
            Assert.AreEqual(0x0102030405060708UL, w.ContentHash);
            Assert.AreEqual(3u, w.PlayerId);
            Assert.AreEqual((byte)20, w.TickRate);
            Assert.AreEqual(100u, w.Tick);
            Assert.AreEqual(5000.0, w.ServerMs);
            CollectionAssert.AreEqual(new byte[] { 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 }, w.MatchId);
            CollectionAssert.AreEqual(new byte[] { 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 }, w.Session);
            Assert.AreEqual(4, w.Map.W); Assert.AreEqual(3, w.Map.H);
            CollectionAssert.AreEqual(new byte[] { 1, 1, 1, 1, 1, 0, 2, 0, 1, 0, 0, 0 }, w.Map.Tiles);
            Assert.AreEqual(1573354892u, w.Map.LayerHash);
            Assert.AreEqual(2, w.Map.At(2, 1));
        }

        [Test]
        public void MapWithWrongHashOrRunsIsRejected()
        {
            var good = ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            byte[] f = good.Encode();
            // The hash sits right after the 4 size bytes of the map blob; the blob starts at 1+2+8+16+4+16+1+4+8 = 60.
            f[64] ^= 1;
            Assert.AreEqual(DecodeError.BadMap, Assert.Throws<DecodeException>(() => ServerMsg.Decode(f)).Error);
        }

        static string SrvHex(string name)
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray()) if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
            throw new KeyNotFoundException(name);
        }

        [Test]
        public void RejectSnapshotFields()
        {
            var rj = Server<ServerMsg.Reject>("reject");
            Assert.AreEqual(RejectCode.ProtocolMismatch, rj.Code);
            Assert.AreEqual("client protocol 2, server 1", rj.Reason);

            var s = Server<ServerMsg.Snapshot>("snapshot");
            Assert.AreEqual(101u, s.Tick); Assert.AreEqual(5050.0, s.ServerMs); Assert.AreEqual((byte)1, s.Phase); Assert.AreEqual(42u, s.AckInput);
            Assert.AreEqual(3u, s.Me.Id); Assert.AreEqual((byte)4, s.Me.Faction); Assert.AreEqual(400f, s.Me.X); Assert.AreEqual(320.5f, s.Me.Y);
            Assert.AreEqual(1.5f, s.Me.Facing); Assert.AreEqual(1000.25f, s.Me.Hp); Assert.AreEqual(1145f, s.Me.MaxHp);
            Assert.AreEqual((byte)1, s.Me.Status); Assert.AreEqual((byte)5, s.Me.Weapon); Assert.AreEqual((ushort)250, s.Me.ReadyInMs);
            Assert.AreEqual((ushort)2, s.Me.Kills); Assert.AreEqual((ushort)0, s.Me.Bounty); Assert.AreEqual((ushort)20, s.Me.Gv); Assert.AreEqual((byte)7, s.Me.MoveSeq);
            Assert.AreEqual(1, s.Actors.Length);
            var a = s.Actors[0];
            Assert.AreEqual(1u, a.Id); Assert.AreEqual(456f, a.X); Assert.AreEqual(320f, a.Y); Assert.AreEqual(-1f, a.Facing);
            Assert.AreEqual((byte)87, a.HpPct); Assert.AreEqual((ushort)28, a.Bounty);

            var sp = Server<ServerMsg.Snapshot>("snapshot_spectator");
            Assert.IsNull(sp.Me); Assert.AreEqual(0, sp.Actors.Length);
        }

        [Test]
        public void EventsFxPongFields()
        {
            var e = Server<ServerMsg.Events>("events");
            Assert.AreEqual(281u, e.Tick);
            Assert.AreEqual(5, e.List.Count);
            Assert.AreEqual(1u, e.List[0].Id); Assert.AreEqual(2u, e.List[0].By);
            Assert.AreEqual(28, e.List[1].Bounty);
            Assert.AreEqual(2u, e.List[2].Winner); Assert.IsFalse(e.List[2].Draw);
            var r1 = e.List[3].Result;
            Assert.AreEqual(EventKind.Result, e.List[3].Kind);
            Assert.AreEqual(1, r1.Place); Assert.AreEqual(2, r1.Players); Assert.AreEqual(1, r1.Kills); Assert.IsNull(r1.KilledBy);
            Assert.AreEqual(10u, r1.GvTotal); Assert.AreEqual(14u, r1.DurationSec); Assert.IsTrue(r1.WinBonusWithheld);
            var r2 = e.List[4].Result;
            Assert.AreEqual(2, r2.Outcome); Assert.AreEqual("P1", r2.KilledBy); Assert.IsFalse(r2.WinBonusWithheld);

            var f = Server<ServerMsg.Fx>("fx");
            Assert.AreEqual(3u, f.Tick); Assert.AreEqual(2, f.List.Count);
            Assert.AreEqual(FxKind.Swing, f.List[0].Kind); Assert.AreEqual(1u, f.List[0].By); Assert.AreEqual(400f, f.List[0].X);
            Assert.AreEqual(FxKind.Hit, f.List[1].Kind); Assert.AreEqual(2u, f.List[1].Victim); Assert.AreEqual(17.690966f, f.List[1].Amount);

            var p = Server<ServerMsg.Pong>("pong");
            Assert.AreEqual(0xdeadbeefu, p.Nonce); Assert.AreEqual(1.5, p.ClientMs); Assert.AreEqual(5051.25, p.ServerMs);
        }

        [Test]
        public void ClientPingAndLeave()
        {
            var p = Client<ClientMsg.Ping>("ping");
            Assert.AreEqual(0xdeadbeefu, p.Nonce); Assert.AreEqual(1.5, p.ClientMs);
            Assert.IsInstanceOf<ClientMsg.Leave>(Client<ClientMsg.Leave>("leave"));
        }

        [Test]
        public void LongStringsAreCutAtACharacterBoundary()
        {
            // 128 two-byte characters = 256 bytes: the writer keeps 127 whole characters (254 bytes), as the Rust writer does.
            var h = new ClientMsg.Hello { Profile = new string('é', 128) };
            var back = (ClientMsg.Hello)ClientMsg.Decode(h.Encode());
            Assert.AreEqual(new string('é', 127), back.Profile);
        }

        [Test]
        public void ServerFramesMayCarryNonFiniteFloatsButClientsMayNot()
        {
            var snap = new ServerMsg.Snapshot { Actors = new[] { new WireActor { X = float.NaN } } };
            Assert.DoesNotThrow(() => ServerMsg.Decode(snap.Encode()));
            var inp = new ClientMsg.Input(); inp.Commands.Add(WireCommand.Aim(float.PositiveInfinity));
            Assert.AreEqual(DecodeError.NonFinite, Assert.Throws<DecodeException>(() => ClientMsg.Decode(inp.Encode())).Error);
        }

        [Test]
        public void EmptyFrameAndAllTruncationsOfServerVectorsThrowCleanly()
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
            {
                byte[] full = Util.FromHex(v.GetProperty("hex").GetString());
                for (int n = 0; n < full.Length; n++)
                {
                    var cut = new byte[n]; Array.Copy(full, cut, n);
                    Assert.Throws<DecodeException>(() => ServerMsg.Decode(cut), v.GetProperty("name").GetString() + " cut " + n);
                }
            }
        }

        [Test]
        public void MapRunsOverflowingU16AreSplit()
        {
            var tiles = new byte[70000];
            var m = new MapBlob(500, 140, tiles);
            var w = new ServerMsg.Welcome { Protocol = 1, MatchId = new byte[16], Session = new byte[16], Map = m };
            var back = (ServerMsg.Welcome)ServerMsg.Decode(w.Encode());
            Assert.AreEqual(70000, back.Map.Tiles.Length);
        }
    }
}

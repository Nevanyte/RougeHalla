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
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement; }

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

        [Test] public void FixtureIsProtocolV13() { Assert.AreEqual(13, Wire.ProtocolVersion); Assert.AreEqual(Wire.ProtocolVersion, Fixture().GetProperty("protocol").GetInt32()); }

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
            Assert.AreEqual(Wire.ProtocolVersion, h.Protocol);
            Assert.AreEqual(0x1122334455667788UL, h.ContentHash);
            Assert.AreEqual("web-0.1.0", h.Build);
            Assert.AreEqual("Nevan_01", h.Profile);
            CollectionAssert.AreEqual(System.Text.Encoding.UTF8.GetBytes("tok-abc"), h.Ticket);
            Assert.AreEqual((byte)4, h.Faction);
            Assert.IsNull(h.Resume);
            var r = Client<ClientMsg.Hello>("hello_resume");
            Assert.AreEqual("Ünïcode", r.Profile);
            Assert.IsNull(r.Faction);
            CollectionAssert.AreEqual(new byte[] { 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9 }, r.Resume);
        }

        [TestCase(0)]
        [TestCase(9)]
        [TestCase(255)]
        public void FxEncoderRefusesUndefinedKindsBeforeWriting(int kind)
        {
            var fx = new ServerMsg.Fx();
            fx.List.Add(new WireFx { Kind = FxKind.Stagger, Id = 1 });
            fx.List.Add(new WireFx { Kind = (FxKind)kind });
            Assert.Throws<EncodeException>(() => fx.Encode());
        }

        [Test]
        public void TrainCommandFieldsAndDecoder()
        {
            var input = Client<ClientMsg.Input>("input_train");
            Assert.AreEqual(5, input.Commands.Count);
            for (int i = 0; i < 5; i++) Assert.AreEqual(CommandKind.Train, input.Commands[i].Kind);
            var chest = input.Commands[3];
            Assert.AreEqual((byte)4, chest.TrainCommand);
            CollectionAssert.AreEqual(new byte[] { 3, 7, 12 }, chest.TrainOptions);
            Assert.AreEqual(9_007_199_254_740_991UL, input.Commands[1].TrainCount);
            var built = new ClientMsg.Input { Seq = 46 };
            built.Commands.Add(WireCommand.Train(5, 0, 0));
            var decoded = (ClientMsg.Input)ClientMsg.Decode(built.Encode());
            Assert.AreEqual(CommandKind.Train, decoded.Commands[0].Kind);
            Assert.AreEqual((byte)5, decoded.Commands[0].TrainCommand);
        }

        [Test]
        public void TrainingSnapshotAndDeltaCarryThePublicFact()
        {
            var snap = Server<ServerMsg.Snapshot>("snapshot_training");
            Assert.IsTrue(snap.Training);
            Assert.AreEqual(1, snap.Actors.Length);
            Assert.AreEqual(3, snap.Actors[0].Kind); // protocol 11 training dummy, distinct from zombie
            Assert.AreEqual(0, snap.Actors[0].MobTypeCode);
            Assert.IsTrue(Server<ServerMsg.SnapshotDelta>("snapshot_delta_training").Training);
            Assert.IsFalse(Server<ServerMsg.Snapshot>("snapshot").Training);
        }

        [Test]
        public void ToastEventDecodesWithItsText()
        {
            var ev = Server<ServerMsg.Events>("events_toasts");
            Assert.AreEqual(2, ev.List.Count);
            Assert.AreEqual(EventKind.Toast, ev.List[0].Kind);
            Assert.AreEqual("Slow down", ev.List[0].ToastText);
            Assert.AreEqual("Cleared: cards, practice mobs and chests", ev.List[1].ToastText);
        }

        [TestCase(0)]
        [TestCase(11)]
        [TestCase(255)]
        public void EventsEncoderRefusesUndefinedKindsBeforeWriting(int kind)
        {
            var events = new ServerMsg.Events();
            events.List.Add(new WireEvent { Kind = EventKind.PickupRefused, PickupReason = 1 });
            events.List.Add(new WireEvent { Kind = (EventKind)kind });
            Assert.Throws<EncodeException>(() => events.Encode());
        }

        [Test]
        public void ServerEncodersEnforceExactFrameAndCountBoundaries()
        {
            var fx = new ServerMsg.Fx();
            var block = new WireFx { Kind = FxKind.Block, Id = 1, By = uint.MaxValue, Weapon = 1 };
            for (int i = 0; i < 32767; i++) fx.List.Add(block);
            var stagger = new WireFx { Kind = FxKind.Stagger, Id = 128 }; fx.List.Add(stagger);
            byte[] max = fx.Encode(); Assert.AreEqual(Wire.MaxServerFrame, max.Length);
            Assert.DoesNotThrow(() => ServerMsg.Decode(max));
            stagger.Id = 16384; Assert.Throws<ArgumentException>(() => fx.Encode());
            var plusOne = new byte[max.Length + 1]; Array.Copy(max, plusOne, max.Length);
            Assert.AreEqual(DecodeError.TooLarge, Assert.Throws<DecodeException>(() => ServerMsg.Decode(plusOne)).Error);
            fx.List[fx.List.Count - 1] = block; Assert.Throws<ArgumentException>(() => fx.Encode());

            var events = new ServerMsg.Events();
            var result = new WireEvent { Kind = EventKind.Result, Result = new WireResult() };
            for (int i = 0; i < 13105; i++) events.List.Add(result);
            var last = new WireEvent { Kind = EventKind.Result, Result = new WireResult { KilledBy = new string('a', 16) } };
            events.List.Add(last);
            max = events.Encode(); Assert.AreEqual(Wire.MaxServerFrame, max.Length);
            Assert.DoesNotThrow(() => ServerMsg.Decode(max));
            last.Result.KilledBy += "a"; Assert.Throws<ArgumentException>(() => events.Encode());
            events.List.Clear();
            for (int i = 0; i < ushort.MaxValue; i++) events.List.Add(new WireEvent { Kind = EventKind.PickupRefused, PickupReason = 1 });
            Assert.DoesNotThrow(() => ServerMsg.Decode(events.Encode()));
            events.List.Add(new WireEvent { Kind = EventKind.PickupRefused, PickupReason = 1 });
            Assert.Throws<ArgumentException>(() => events.Encode());
        }

        [Test]
        public void UnknownRejectPreservesLeadingBom()
        {
            var r = Server<ServerMsg.Reject>("reject_unknown_bom");
            Assert.AreEqual((ushort)300, (ushort)r.Code); Assert.AreEqual("\uFEFFa", r.Reason);
        }

        [Test]
        public void CombatCommandsAndPrivateRefusalsKeepEveryField()
        {
            var i = Client<ClientMsg.Input>("input_combat");
            Assert.AreEqual(4, i.Commands.Count);
            Assert.AreEqual(CommandKind.Swap, i.Commands[0].Kind); Assert.IsNull(i.Commands[0].Slot);
            Assert.AreEqual((byte)0, i.Commands[1].Slot); Assert.AreEqual((byte)1, i.Commands[2].Slot);
            Assert.AreEqual(CommandKind.Pickup, i.Commands[3].Kind); Assert.AreEqual(42u, i.Commands[3].PickupRef.Value);
            var e = Server<ServerMsg.Events>("pickup_refusals");
            Assert.AreEqual(5, e.List.Count);
            for (int n = 0; n < 5; n++) { Assert.AreEqual(EventKind.PickupRefused, e.List[n].Kind); Assert.AreEqual(n + 1, e.List[n].PickupReason); }
            var f = Server<ServerMsg.Fx>("fx_combat");
            Assert.AreEqual(uint.MaxValue, f.List[0].By); Assert.AreEqual(1u, f.List[1].By);
            Assert.IsTrue(f.List[3].Passive); Assert.AreEqual(uint.MaxValue, f.List[3].By);
            foreach (var bad in new[] { WireCommand.Swap(2), WireCommand.Pickup(default(PickupHandle)) }) {
                var input = new ClientMsg.Input(); input.Commands.Add(bad); Assert.Throws<ArgumentException>(() => input.Encode());
            }
        }

        [Test]
        public void HuntCommandAndSelfFieldsRoundTrip()
        {
            var h = Client<ClientMsg.Input>("input_hunt");
            Assert.AreEqual(1, h.Commands.Count);
            Assert.AreEqual(CommandKind.HuntTarget, h.Commands[0].Kind);
            Assert.AreEqual(2u, h.Commands[0].ActorRef);
            var snap = Server<ServerMsg.Snapshot>("snapshot");
            Assert.AreEqual(2u, snap.Me.HuntTarget);
            Assert.AreEqual((ushort)3, snap.Me.HuntStacks);
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
        public void AnUnnamedRejectCodeDecodesAsItselfAndRoundTrips()
        {
            // The vector "reject_code_unknown" is code 12 with an empty reason: every decoder accepts it (codes are append only).
            var rj = Server<ServerMsg.Reject>("reject_code_unknown");
            Assert.AreEqual((ushort)12, (ushort)rj.Code); Assert.IsFalse(Enum.IsDefined(typeof(RejectCode), rj.Code));
            Assert.AreEqual(SrvHex("reject_code_unknown"), Util.ToHex(rj.Encode()));
            var big = (ServerMsg.Reject)ServerMsg.Decode(new ServerMsg.Reject { Code = (RejectCode)0xFFFF, Reason = "update required" }.Encode());
            Assert.AreEqual((ushort)0xFFFF, (ushort)big.Code); Assert.AreEqual("update required", big.Reason);
            Assert.AreEqual(DecodeError.BadTag, Assert.Throws<DecodeException>(() => ServerMsg.Decode(new byte[] { 0x82, 0, 0, 0 })).Error, "0 is not a code");
        }

        [Test]
        public void StringsOver255BytesAreRefusedNotTruncated()
        {
            var ok = new string('x', 255);
            Assert.AreEqual(1 + 255, new ServerMsg.Reject { Code = RejectCode.Malformed, Reason = ok }.Encode().Length - 3);
            var two = new string('\u00e9', 128); // 256 bytes
            var e = Assert.Throws<EncodeException>(() => new ServerMsg.Reject { Code = RejectCode.Malformed, Reason = two }.Encode());
            StringAssert.Contains("256", e.Message);
            Assert.Throws<EncodeException>(() => new ClientMsg.Hello { Ticket = new byte[Wire.MaxTicket + 1] }.Encode());
            Assert.Throws<EncodeException>(() => new ClientMsg.Hello { Profile = two }.Encode());
            Assert.Throws<EncodeException>(() => new ClientMsg.Hello { Build = two }.Encode());
            Assert.DoesNotThrow(() => new ClientMsg.Hello { Build = ok, Profile = ok, Ticket = new byte[Wire.MaxTicket] }.Encode());
        }

        [Test]
        public void RejectSnapshotFields()
        {
            var rj = Server<ServerMsg.Reject>("reject");
            Assert.AreEqual(RejectCode.ProtocolMismatch, rj.Code);
            Assert.AreEqual("client protocol 1, server 2", rj.Reason);

            var s = Server<ServerMsg.Snapshot>("snapshot");
            Assert.AreEqual(101u, s.Tick); Assert.AreEqual(5050.0, s.ServerMs); Assert.AreEqual((byte)1, s.Phase); Assert.AreEqual(42u, s.AckInput);
            Assert.AreEqual(3u, s.Me.Id); Assert.AreEqual((byte)4, s.Me.Faction); Assert.AreEqual(400f, s.Me.X); Assert.AreEqual(320.5f, s.Me.Y);
            Assert.AreEqual(1.5f, s.Me.Facing); Assert.AreEqual(1000.25f, s.Me.Hp); Assert.AreEqual(1145f, s.Me.MaxHp);
            Assert.AreEqual((byte)1, s.Me.Status); Assert.AreEqual((byte)5, s.Me.Weapon); Assert.AreEqual((ushort)250, s.Me.ReadyInMs);
            Assert.AreEqual((ushort)2, s.Me.Kills); Assert.AreEqual((ushort)0, s.Me.Bounty); Assert.AreEqual((ushort)20, s.Me.Gv); Assert.AreEqual((byte)7, s.Me.MoveSeq);
            Assert.AreEqual(1, s.Actors.Length);
            var a = s.Actors[0];
            Assert.AreEqual(1u, a.Id); Assert.AreEqual(456f, a.X); Assert.AreEqual(320f, a.Y); Assert.AreEqual(-0.99996376f, a.Facing); // -1 rad, quantized to 2 pi / 65536
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

        static int Bits(float f) { return BitConverter.SingleToInt32Bits(f); }

        static IEnumerable<TestCaseData> DecodedVectors()
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.TryGetProperty("decoded", out _))
                    yield return new TestCaseData(v.GetProperty("name").GetString()).SetName("decoded:" + v.GetProperty("name").GetString());
        }

        /// <summary>The vectors carry what a decoder must produce (floats as bit patterns): the quantization is held across languages, not just the bytes.</summary>
        [TestCaseSource(nameof(DecodedVectors))]
        public void DecodedVectorMatchesFieldForField(string name)
        {
            JsonElement v = default;
            foreach (var e in Fixture().GetProperty("server").EnumerateArray()) if (e.GetProperty("name").GetString() == name) v = e;
            var d = v.GetProperty("decoded");
            var msg = ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
            if (msg is ServerMsg.Fx fx)
            {
                Assert.AreEqual(d.GetProperty("tick").GetUInt32(), fx.Tick);
                var items = d.GetProperty("fx");
                Assert.AreEqual(items.GetArrayLength(), fx.List.Count);
                for (int i = 0; i < fx.List.Count; i++)
                {
                    var it = items[i]; var f = fx.List[i];
                    if (it.GetProperty("k").GetString() == "swing")
                    {
                        Assert.AreEqual(FxKind.Swing, f.Kind);
                        Assert.AreEqual(it.GetProperty("by").GetUInt32(), f.By); Assert.AreEqual(it.GetProperty("weapon").GetByte(), f.Weapon);
                        Assert.AreEqual(it.GetProperty("xBits").GetInt64(), (long)(uint)Bits(f.X)); Assert.AreEqual(it.GetProperty("yBits").GetInt64(), (long)(uint)Bits(f.Y));
                        Assert.AreEqual(it.GetProperty("aBits").GetInt64(), (long)(uint)Bits(f.A));
                    }
                    else if (it.GetProperty("k").GetString() == "block") { Assert.AreEqual(FxKind.Block, f.Kind); Assert.AreEqual(it.GetProperty("id").GetUInt32(), f.Id); Assert.AreEqual(it.GetProperty("by").GetUInt32(), f.By); Assert.AreEqual(it.GetProperty("weapon").GetByte(), f.Weapon); }
                    else if (it.GetProperty("k").GetString() == "stagger") { Assert.AreEqual(FxKind.Stagger, f.Kind); Assert.AreEqual(it.GetProperty("id").GetUInt32(), f.Id); }
                    else if (it.GetProperty("k").GetString() == "teleport") { Assert.AreEqual(FxKind.Teleport, f.Kind); }
                    else if (it.GetProperty("k").GetString() == "castStarted")
                    {
                        Assert.AreEqual(FxKind.WishStarted, f.Kind); Assert.AreEqual(it.GetProperty("eventTime").GetDouble(), f.EventTime);
                        Assert.AreEqual(it.GetProperty("caster").GetUInt32(), f.Caster); Assert.AreEqual(it.GetProperty("ability").GetByte(), f.Ability);
                        Assert.AreEqual(it.GetProperty("duration").GetDouble(), f.Duration); AssertOptionalRef(it.GetProperty("target"), f.Target);
                        AssertPoint(it.GetProperty("anchor"), f.HasAnchor, f.AnchorX, f.AnchorY);
                    }
                    else if (it.GetProperty("k").GetString() == "castLanded")
                    {
                        Assert.AreEqual(FxKind.WishLanded, f.Kind); Assert.AreEqual(it.GetProperty("eventTime").GetDouble(), f.EventTime);
                        Assert.AreEqual(it.GetProperty("ability").GetByte(), f.Ability); AssertOptionalRef(it.GetProperty("caster"), f.Caster);
                        AssertOptionalRef(it.GetProperty("target"), f.Target); AssertPoint(it.GetProperty("anchor"), f.HasAnchor, f.AnchorX, f.AnchorY);
                        AssertPoint(it.GetProperty("destination"), f.HasDestination, f.DestinationX, f.DestinationY);
                    }
                    else if (it.GetProperty("k").GetString() == "castEnded")
                    {
                        Assert.AreEqual(FxKind.WishEnded, f.Kind); Assert.AreEqual(it.GetProperty("eventTime").GetDouble(), f.EventTime);
                        Assert.AreEqual(it.GetProperty("caster").GetUInt32(), f.Caster); Assert.AreEqual(it.GetProperty("ability").GetByte(), f.Ability);
                        Assert.AreEqual(it.GetProperty("reason").GetByte(), f.Reason);
                    }
                    else
                    {
                        Assert.AreEqual(it.GetProperty("passive").GetBoolean(), f.Passive);
                        Assert.AreEqual(FxKind.Hit, f.Kind);
                        Assert.AreEqual(it.GetProperty("victim").GetUInt32(), f.Victim); Assert.AreEqual(it.GetProperty("by").GetUInt32(), f.By);
                        Assert.AreEqual(it.GetProperty("amountBits").GetInt64(), (long)(uint)Bits(f.Amount));
                    }
                }
                return;
            }
            if (msg is ServerMsg.State state)
            {
                Assert.AreEqual("state", d.GetProperty("kind").GetString());
                Assert.AreEqual(d.GetProperty("tick").GetUInt32(), state.Tick);
                var expectedItems = d.GetProperty("items");
                Assert.AreEqual(expectedItems.GetArrayLength(), state.Items.Length);
                for (int i = 0; i < state.Items.Length; i++)
                {
                    var expectedItem = expectedItems[i];
                    Assert.AreEqual(expectedItem.GetProperty("key").GetUInt32(), state.Items[i].Key);
                    if (state.Items[i] is RewardChestsState rewardChests)
                    {
                        var expectedRows = expectedItem.GetProperty("value");
                        Assert.AreEqual(expectedRows.GetArrayLength(), rewardChests.Rows.Length);
                        for (int rowIndex = 0; rowIndex < rewardChests.Rows.Length; rowIndex++)
                        {
                            var row = rewardChests.Rows[rowIndex]; var expectedRow = expectedRows[rowIndex];
                            Assert.AreEqual(expectedRow.GetProperty("handle").GetUInt32(), row.Handle.Value);
                            Assert.AreEqual(expectedRow.GetProperty("x").GetUInt16(), row.X);
                            Assert.AreEqual(expectedRow.GetProperty("y").GetUInt16(), row.Y);
                            Assert.AreEqual(expectedRow.GetProperty("expiresAt").GetDouble(), row.ExpiresAt);
                            Assert.AreEqual(expectedRow.GetProperty("picked").GetBoolean(), row.Picked);
                            Assert.AreEqual(expectedRow.GetProperty("canChoose").GetBoolean(), row.CanChoose);
                            var expectedOptions = expectedRow.GetProperty("options");
                            Assert.AreEqual(expectedOptions.GetArrayLength(), row.Options.Length);
                            for (int optionIndex = 0; optionIndex < row.Options.Length; optionIndex++)
                            {
                                var option = row.Options[optionIndex]; var expectedOption = expectedOptions[optionIndex];
                                Assert.AreEqual(expectedOption.GetProperty("kind").GetByte(), option.Kind);
                                Assert.AreEqual(expectedOption.GetProperty("taken").GetBoolean(), option.Taken);
                                var takenBy = expectedOption.GetProperty("takenBy");
                                Assert.AreEqual(takenBy.ValueKind == JsonValueKind.Null ? (uint?)null : takenBy.GetUInt32(), option.TakenBy);
                                if (option.Kind == 3)
                                {
                                    Assert.AreEqual(expectedOption.GetProperty("key").GetByte(), (byte)option.KillKey.Value);
                                    Assert.AreEqual(BitConverter.DoubleToInt64Bits(expectedOption.GetProperty("gain").GetDouble()),
                                        BitConverter.DoubleToInt64Bits(option.KillGain));
                                }
                                else Assert.AreEqual(expectedOption.GetProperty("id").GetByte(), option.Id);
                            }
                        }
                    }
                }
                return;
            }
            CheckSnapshot(d, (ServerMsg.Snapshot)msg);
        }

        /// <summary>A snapshot equals the vector's decoded form field for field (floats as bit patterns).</summary>
        static void CheckSnapshot(JsonElement d, ServerMsg.Snapshot s)
        {
            Assert.AreEqual(d.GetProperty("tick").GetUInt32(), s.Tick);
            Assert.AreEqual(d.GetProperty("serverMs").GetDouble(), s.ServerMs);
            Assert.AreEqual(d.GetProperty("phase").GetByte(), s.Phase);
            Assert.AreEqual(d.GetProperty("ack").GetUInt32(), s.AckInput);
            Assert.AreEqual(d.GetProperty("training").GetBoolean(), s.Training);
            var me = d.GetProperty("me");
            if (me.ValueKind == JsonValueKind.Null) Assert.IsNull(s.Me);
            else
            {
                Assert.AreEqual(me.GetProperty("id").GetUInt32(), s.Me.Id); Assert.AreEqual(me.GetProperty("faction").GetByte(), s.Me.Faction);
                Assert.AreEqual(me.GetProperty("xBits").GetInt64(), (long)(uint)Bits(s.Me.X)); Assert.AreEqual(me.GetProperty("yBits").GetInt64(), (long)(uint)Bits(s.Me.Y));
                Assert.AreEqual(me.GetProperty("facingBits").GetInt64(), (long)(uint)Bits(s.Me.Facing));
                Assert.AreEqual(me.GetProperty("hpBits").GetInt64(), (long)(uint)Bits(s.Me.Hp)); Assert.AreEqual(me.GetProperty("maxHpBits").GetInt64(), (long)(uint)Bits(s.Me.MaxHp));
                Assert.AreEqual(me.GetProperty("status").GetByte(), s.Me.Status); Assert.AreEqual(me.GetProperty("weapon").GetByte(), s.Me.Weapon);
                Assert.AreEqual(me.GetProperty("readyInMs").GetUInt16(), s.Me.ReadyInMs); Assert.AreEqual(me.GetProperty("kills").GetUInt16(), s.Me.Kills);
                Assert.AreEqual(me.GetProperty("bounty").GetUInt16(), s.Me.Bounty); Assert.AreEqual(me.GetProperty("gv").GetUInt16(), s.Me.Gv);
                Assert.AreEqual(me.GetProperty("moveSeq").GetByte(), s.Me.MoveSeq);
                Assert.AreEqual(me.GetProperty("effects").GetUInt16(), s.Me.Effects); Assert.AreEqual(me.GetProperty("displaceSeq").GetByte(), s.Me.DisplaceSeq); Assert.AreEqual(me.GetProperty("sig").GetByte(),s.Me.Sig);
                var hunt = me.GetProperty("huntTarget");
                Assert.AreEqual(hunt.ValueKind == JsonValueKind.Null ? (uint?)null : hunt.GetUInt32(), s.Me.HuntTarget);
                Assert.AreEqual(me.GetProperty("huntStacks").GetUInt16(), s.Me.HuntStacks);
                Assert.AreEqual(me.GetProperty("barrierBits").GetUInt32(), unchecked((uint)Bits(s.Me.Barrier)));
                Assert.AreEqual(me.GetProperty("barrierRingStep").GetByte(), s.Me.BarrierRingStep);
                var wish = me.GetProperty("wish");
                if (wish.ValueKind == JsonValueKind.Null) Assert.IsNull(s.Me.Wish);
                else
                {
                    Assert.IsNotNull(s.Me.Wish); Assert.AreEqual(wish.GetProperty("ability").GetByte(), s.Me.Wish.Ability);
                    Assert.AreEqual(wish.GetProperty("readyAt").GetDouble(), s.Me.Wish.ReadyAt);
                    var full = wish.GetProperty("fullAt"); Assert.AreEqual(full.ValueKind == JsonValueKind.Null ? (double?)null : full.GetDouble(), s.Me.Wish.FullAt);
                    Assert.AreEqual(wish.GetProperty("maxCharges").GetByte(), s.Me.Wish.MaxCharges);
                    Assert.AreEqual(wish.GetProperty("rechargeMs").GetDouble(), s.Me.Wish.RechargeMs);
                    Assert.AreEqual(wish.GetProperty("charges").GetByte(), s.Me.Wish.Charges);
                    var next = wish.GetProperty("nextChargeAt"); Assert.AreEqual(next.ValueKind == JsonValueKind.Null ? (double?)null : next.GetDouble(), s.Me.Wish.NextChargeAt);
                    var cast = wish.GetProperty("cast");
                    if (cast.ValueKind == JsonValueKind.Null) Assert.IsNull(s.Me.Wish.Cast);
                    else
                    {
                        Assert.IsNotNull(s.Me.Wish.Cast); Assert.AreEqual(cast.GetProperty("ability").GetByte(), s.Me.Wish.Cast.Ability);
                        Assert.AreEqual(cast.GetProperty("startedAt").GetDouble(), s.Me.Wish.Cast.StartedAt);
                        Assert.AreEqual(cast.GetProperty("landsAt").GetDouble(), s.Me.Wish.Cast.LandsAt);
                    }
                }
            }
            var actors = d.GetProperty("actors");
            Assert.AreEqual(actors.GetArrayLength(), s.Actors.Length);
            for (int i = 0; i < s.Actors.Length; i++)
            {
                var e = actors[i]; var a = s.Actors[i];
                Assert.AreEqual(e.GetProperty("id").GetUInt32(), a.Id); Assert.AreEqual(e.GetProperty("faction").GetByte(), a.Faction);
                Assert.AreEqual(e.GetProperty("xBits").GetInt64(), (long)(uint)Bits(a.X)); Assert.AreEqual(e.GetProperty("yBits").GetInt64(), (long)(uint)Bits(a.Y));
                Assert.AreEqual(e.GetProperty("facingBits").GetInt64(), (long)(uint)Bits(a.Facing));
                Assert.AreEqual(e.GetProperty("hpPct").GetByte(), a.HpPct); Assert.AreEqual(e.GetProperty("status").GetByte(), a.Status);
                Assert.AreEqual(e.GetProperty("weapon").GetByte(), a.Weapon); Assert.AreEqual(e.GetProperty("bounty").GetUInt16(), a.Bounty);
                Assert.AreEqual(e.GetProperty("kind").GetByte(), a.Kind);
                Assert.AreEqual(e.GetProperty("effects").GetUInt16(), a.Effects); Assert.AreEqual(e.GetProperty("displaceSeq").GetByte(), a.DisplaceSeq); Assert.AreEqual(e.GetProperty("mobTypeCode").GetByte(),a.MobTypeCode); Assert.AreEqual(e.GetProperty("sig").GetByte(),a.Sig);
                Assert.AreEqual(e.GetProperty("barrierPct").GetByte(), a.BarrierPct); Assert.AreEqual(e.GetProperty("barrierRingStep").GetByte(), a.BarrierRingStep);
            }
        }

        static void AssertOptionalRef(JsonElement actual, uint? value)
        {
            Assert.AreEqual(actual.ValueKind == JsonValueKind.Null ? (uint?)null : actual.GetUInt32(), value);
        }

        static void AssertPoint(JsonElement actual, bool has, float x, float y)
        {
            Assert.AreEqual(has, actual.ValueKind != JsonValueKind.Null);
            if (!has) return;
            Assert.AreEqual(actual.GetProperty("xBits").GetUInt32(), unchecked((uint)Bits(x)));
            Assert.AreEqual(actual.GetProperty("yBits").GetUInt32(), unchecked((uint)Bits(y)));
        }

        static IEnumerable<TestCaseData> MalformedServerVectors() { return Vectors("malformedServer"); }

        [TestCaseSource(nameof(MalformedServerVectors))]
        public void MalformedServerFrameIsRejectedForTheDocumentedReason(string name, string hex)
        {
            DecodeError want;
            switch (name)
            {
                case "empty": case "truncated_snapshot": case "self_truncated": case "actor_count_without_actors": want = DecodeError.Truncated; break;
                case "projectile_owner_flag": case "hit_bad_passive": case "wish_option_over_1": case "wish_fx_option_over_1": want = DecodeError.BadTag; break;
                case "projectile_kind": case "projectile_owner_zero":
                case "potion_notice_zero": case "potion_notice_unknown":
                case "cannon_notice_zero": case "cannon_notice_unknown": case "cannon_notice_bad_seconds": case "cannon_notice_seconds_over":
                case "camp_mob_type": case "camp_elite": case "camp_alive": case "camp_state": case "camp_negative_time": case "camp_nonfinite_time": case "camp_time_order":
                case "wish_ability_over_4": case "wish_charge_count_invalid": case "wish_time_nonfinite": case "wish_cast_time_order":
                case "wish_fx_caster_zero": case "wish_fx_ability_over_4": case "wish_fx_time_nonfinite": case "wish_fx_blaze_one_point":
                case "wish_fx_nonblaze_destination": case "wish_fx_anonymous_landed_target": case "wish_fx_anonymous_landed_no_target": case "wish_fx_end_reason_over_2":
                case "actor_mob_type_over_30": case "delta_actor_mob_type_over_30":
                case "chest_bad_reason_zero": case "chest_bad_reason_unknown":
                case "pickup_bad_reason_zero": case "pickup_bad_reason_unknown": want = DecodeError.BadField; break;
                case "unknown_tag": case "client_tag_from_server": case "fx_bad_tag": want = DecodeError.BadTag; break;
                case "trailing_byte": case "state_trailing_byte": want = DecodeError.Trailing; break;
                case "state_truncated": case "state_reward_kill_truncated_key": case "state_reward_kill_truncated_gain":
                case "cannon_notice_missing_seconds": want = DecodeError.Truncated; break;
                case "overlong_varint": case "varint_past_u32": case "varint_too_long": case "head_overlong_varint": case "actor_mask_overlong_varint":
                case "projectile_owner_overlong": case "delta_head_overlong_varint":
                    want = DecodeError.BadVarint; break;
                case "state_too_many_keys": case "state_too_many_props": case "state_too_many_fields": case "state_too_many_projectiles": case "state_too_many_camps": case "state_too_many_rewards": case "state_reward_options_too_many":
                case "too_many_actors": case "fx_too_many": want = DecodeError.TooMany; break;
                case "head_self_bit_without_present_bit": case "head_unknown_bit": case "self_max_hp_over_u16": case "actor_reserved_mask_bit":
                case "self_status_over_3": case "phase_over_3": case "actor_status_over_3": case "actor_unknown_mask_bit_after_kind":
                case "state_duplicate_key": case "state_key_order": case "state_bad_potion_count": case "state_zero_prop_handle": case "state_missing_focus":
                case "state_reward_kind_unknown":
                case "state_reward_kill_key_unknown": case "state_reward_kill_gain_zero": case "state_reward_kill_gain_negative":
                case "state_reward_kill_gain_nan": case "state_reward_kill_gain_infinity":
                case "state_reward_card_id_80": case "state_plan_negative_deadline": case "state_unknown_key": case "delta_head_unknown_bit": case "delta_phase_over_3": case "delta_actor_mask_unknown_bit":
                case "delta_actor_status_over_3":
                case "actor_id_gap_zero": case "actor_id_overflow": case "actor_hp_over_100": case "actor_bounty_over_u16":
                case "delta_age_zero": case "delta_age_over_max": case "delta_age_past_tick": case "delta_head_field_without_present_bit":
                case "delta_self_status_over_3": case "delta_actor_id_gap_zero": case "delta_actor_hp_over_100": case "delta_actor_bounty_over_u16":
                case "delta_departed_empty": case "delta_departed_id_gap_zero":
                    want = DecodeError.BadField; break;
                case "delta_too_many_actors": case "delta_departed_too_many": want = DecodeError.TooMany; break;
                case "delta_truncated": want = DecodeError.Truncated; break;
                case "delta_trailing_byte": want = DecodeError.Trailing; break;
                case "reject_code_zero": want = DecodeError.BadTag; break;
                case "server_bad_utf8": want = DecodeError.BadUtf8; break;
                case "map_zero_size": case "map_too_large": case "map_bad_tile": case "map_zero_run": case "map_run_past_size":
                case "map_short": case "map_hash_mismatch":
                    want = DecodeError.BadMap; break;
                default: throw new KeyNotFoundException("no expectation for " + name);
            }
            Assert.AreEqual(want, Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(hex)), name).Error, name);
        }

        [Test]
        public void ServerMsIsTickTimes50AndNotOnTheWire()
        {
            Assert.AreEqual(5050.0, Server<ServerMsg.Snapshot>("snapshot").ServerMs);
            Assert.AreEqual(1000000 * 50.0, Server<ServerMsg.Snapshot>("snapshot_full").ServerMs);
            // The frame of a spectator snapshot in the default phase at tick 1 is 5 bytes: tag, tick, ack, a one-byte head varint, count.
            Assert.AreEqual(5, new ServerMsg.Snapshot { Tick = 1, Phase = Wire.DefaultPhase }.Encode().Length);
        }

        [Test]
        public void QuantizationErrorStaysWithinTheDocumentedBounds()
        {
            for (int i = 0; i <= 40960; i++)
            {
                float v = i * 0.125f + 0.0625f;
                Assert.LessOrEqual(Math.Abs(Quant.DequantizePos(Quant.QuantizePos(v)) - v), 0.0625f, "pos " + v);
            }
            Assert.AreEqual(0, Quant.QuantizePos(-5f)); Assert.AreEqual(0, Quant.QuantizePos(float.NaN)); Assert.AreEqual(65535, Quant.QuantizePos(1e9f));
            Assert.AreEqual(1, Quant.QuantizePos(0.0625f), "ties round away from zero");
            const double Tau = Math.PI * 2;
            for (int i = 0; i < 10000; i++)
            {
                float a = -3.2f + 6.4f * i / 10000f;
                double d = ((Quant.DequantizeFacing(Quant.QuantizeFacing(a)) - (double)a) % Tau + Tau) % Tau;
                if (d > Tau / 2) d -= Tau;
                Assert.LessOrEqual(Math.Abs(d), 4.85e-5, "facing " + a);
            }
            Assert.AreEqual(0, Quant.QuantizeFacing(float.PositiveInfinity));
            Assert.AreEqual(-(float)Math.PI, Quant.DequantizeFacing(0x8000));
            Assert.AreEqual(0x8000, Quant.QuantizeFacing((float)Math.PI));
        }

        [Test]
        public void EncodersRefuseWhatNoDecoderAccepts()
        {
            WireActor A(uint id) { return new WireActor { Id = id }; }
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { A(2), A(2) } }.Encode(), "duplicate ids");
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { A(3), A(2) } }.Encode(), "descending ids");
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, HpPct = 101 } } }.Encode(), "hp over 100");
            // Positions off the grid are refused like rh-protocol (BadValue "position"), never saturated.
            foreach (float bad in new[] { -0.5f, Quant.PosMax + 0.125f, float.NaN, float.PositiveInfinity })
            {
                Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, X = bad } } }.Encode(), "actor x " + bad);
                Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, Y = bad } } }.Encode(), "actor y " + bad);
                var fx = new ServerMsg.Fx(); fx.List.Add(new WireFx { Kind = FxKind.Swing, X = bad, Y = 1f });
                Assert.Throws<ArgumentException>(() => fx.Encode(), "swing x " + bad);
            }
            Assert.DoesNotThrow(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, X = Quant.PosMax, Y = 0f } } }.Encode(), "the edges are on the grid");
            var hit = new ServerMsg.Fx(); hit.List.Add(new WireFx { Kind = FxKind.Hit, X = -5f });
            Assert.DoesNotThrow(() => hit.Encode(), "a hit carries no position");
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, Faction = 16 } } }.Encode(), "faction over 4 bits");
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, Status = 4 } } }.Encode(), "status over 2 bits");
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Phase = 4 }.Encode(), "phase over 2 bits");
        }

        /// <summary>
        /// The chains in the vectors (frames a client's tracker applies in order): after every frame the tracker holds exactly the
        /// recorded snapshot, a Welcome resets it, and a refused delta is refused for the recorded reason and changes nothing.
        /// </summary>
        static IEnumerable<TestCaseData> Chains()
        {
            foreach (var c in Fixture().GetProperty("chains").EnumerateArray())
                yield return new TestCaseData(c.GetProperty("name").GetString()).SetName("chain:" + c.GetProperty("name").GetString());
        }

        [TestCaseSource(nameof(Chains))]
        public void ChainReplaysToTheRecordedOutcomeAtEveryStep(string name)
        {
            JsonElement chain = default;
            foreach (var c in Fixture().GetProperty("chains").EnumerateArray()) if (c.GetProperty("name").GetString() == name) chain = c;
            var track = new SnapshotTracker();
            int i = 0;
            foreach (var step in chain.GetProperty("steps").EnumerateArray())
            {
                byte[] frame = Util.FromHex(step.GetProperty("hex").GetString());
                string at = name + " step " + i++;
                if (step.TryGetProperty("refused", out var why))
                {
                    uint held = track.HeldTick; int actors = track.HeldActors;
                    var e = Assert.Throws<DeltaException>(() => track.Decode(frame, frame.Length, null), at);
                    Assert.AreEqual(why.GetString(), e.Code, at);
                    Assert.AreEqual(held, track.HeldTick, at + ": a refused delta changes nothing");
                    Assert.AreEqual(actors, track.HeldActors, at);
                    continue;
                }
                var msg = track.Decode(frame, frame.Length, null);
                if (step.TryGetProperty("reset", out _)) { Assert.IsInstanceOf<ServerMsg.Welcome>(msg, at); Assert.IsFalse(track.HasBase, at); }
                else if (step.TryGetProperty("held", out var held))
                {
                    Assert.AreEqual(held.GetProperty("tick").GetUInt32(), track.HeldTick, at);
                    Assert.AreEqual(held.GetProperty("actors").GetInt32(), track.HeldActors, at);
                }
                else CheckSnapshot(step.GetProperty("decoded"), (ServerMsg.Snapshot)msg);
            }
        }

        [Test]
        public void ADeltaDecodedAloneIsTheMessageAndReEncodesByteForByte()
        {
            foreach (var name in new[] { "snapshot_delta", "snapshot_delta_empty" })
            {
                var d = Server<ServerMsg.SnapshotDelta>(name);
                Assert.AreEqual(SrvHex(name), Util.ToHex(d.Encode()), name);
            }
            var full = Server<ServerMsg.SnapshotDelta>("snapshot_delta");
            Assert.AreEqual(1000000u, full.Tick); Assert.AreEqual(999990u, full.BaseTick); Assert.IsTrue(full.HasPhase); Assert.AreEqual((byte)2, full.Phase);
            Assert.IsTrue(full.HasSelf); Assert.AreEqual(2, full.ChangedCount); Assert.AreEqual(2, full.DepartedCount);
            Assert.AreEqual(70000u, full.Departed[1]); Assert.AreEqual(128u, full.Changed[1].Id); Assert.AreEqual(ActorDelta.MAll, full.Changed[1].Mask);
        }

        [Test]
        public void TheReservedStateMessageDecodesOnlyEmpty()
        {
            var st = Server<ServerMsg.State>("state_empty");
            Assert.AreEqual(300u, st.Tick);
            Assert.AreEqual(SrvHex("state_empty"), Util.ToHex(st.Encode()));
        }

        [Test]
        public void DefaultsAndKindCostNothingAndNonDefaultsAreExplicit()
        {
            // An alive player (kind 0) in the active phase takes exactly the bytes of the five required actor fields.
            var calm = new ServerMsg.Snapshot { Tick = 1, Phase = Wire.DefaultPhase, Actors = new[] { new WireActor { Id = 4, Status = Wire.DefaultStatus, HpPct = 100 } } };
            Assert.AreEqual(13, calm.Encode().Length, "tag, tick, ack, head, count, id, mask, x y facing");
            var mob = (ServerMsg.Snapshot)ServerMsg.Decode(new ServerMsg.Snapshot { Tick = 1, Phase = 2, Actors = new[] { new WireActor { Id = 9, Status = 2, HpPct = 100, Kind = 7 } } }.Encode());
            Assert.AreEqual((byte)2, mob.Phase); Assert.AreEqual((byte)2, mob.Actors[0].Status); Assert.AreEqual((byte)7, mob.Actors[0].Kind);
            Assert.AreEqual((byte)0, Server<ServerMsg.Snapshot>("snapshot").Actors[0].Kind);
        }

        [Test]
        public void AResyncIsOneByteWithNoBody()
        {
            CollectionAssert.AreEqual(new byte[] { 5 }, new ClientMsg.Resync().Encode());
            Assert.IsInstanceOf<ClientMsg.Resync>(Client<ClientMsg.Resync>("resync"));
            Assert.Throws<DecodeException>(() => ClientMsg.Decode(new byte[] { 5, 0 }));
        }

        [Test]
        public void ClientPingAndLeave()
        {
            var p = Client<ClientMsg.Ping>("ping");
            Assert.AreEqual(0xdeadbeefu, p.Nonce); Assert.AreEqual(1.5, p.ClientMs);
            Assert.IsInstanceOf<ClientMsg.Leave>(Client<ClientMsg.Leave>("leave"));
        }

        [Test]
        public void ServerFramesMayCarryNonFiniteFloatsButClientsMayNot()
        {
            // The self's floats travel as f32 bit patterns (a remote actor's position is a grid code: NaN is refused there).
            var snap = new ServerMsg.Snapshot { Me = new WireSelf { X = float.NaN, Hp = float.PositiveInfinity } };
            var back = (ServerMsg.Snapshot)ServerMsg.Decode(snap.Encode());
            Assert.IsTrue(float.IsNaN(back.Me.X) && float.IsPositiveInfinity(back.Me.Hp));
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
            var w = new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], Map = m };
            var back = (ServerMsg.Welcome)ServerMsg.Decode(w.Encode());
            Assert.AreEqual(70000, back.Map.Tiles.Length);
        }
    }
}

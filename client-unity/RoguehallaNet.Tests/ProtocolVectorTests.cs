using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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

        [Test] public void FixtureIsProtocolV16() { Assert.AreEqual(16, Wire.ProtocolVersion); Assert.AreEqual(Wire.ProtocolVersion, Fixture().GetProperty("protocol").GetInt32()); }

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
        [TestCase(13)]
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
        [TestCase(12)]
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
        public void WelcomeCarriesTheArchetypeTableRustWrote()
        {
            var w = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            Assert.AreEqual(3, w.Archetypes.Length);
            var circle = w.Archetypes[0];
            Assert.AreEqual((0, "legacy_circle", 0, 12, 0), (circle.Id, circle.Key, circle.Hull, circle.R, circle.Chest));
            var hero = WireArchetype.Find(w.Archetypes, 1);
            Assert.AreEqual(("hero", 1, 10, 6, 16, 35), (hero.Key, hero.Hull, hero.Fx, hero.Fy, hero.Bx, hero.By));
            Assert.AreEqual((0, -30, 30), (hero.Ox, hero.Oy, hero.Chest));
            Assert.AreEqual("mob-zombie", WireArchetype.Find(w.Archetypes, 12).Key);
            Assert.IsNull(WireArchetype.Find(w.Archetypes, 2));
            CollectionAssert.AreEqual(Util.FromHex(SrvHex("welcome")), w.Encode());
        }

        [Test]
        public void WelcomeCarriesTheVisionBlockRustWrote()
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
            {
                string name = v.GetProperty("name").GetString();
                if (!name.StartsWith("welcome")) continue;
                var w = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
                var want = v.GetProperty("decoded").GetProperty("vision");
                Assert.AreEqual(want.GetProperty("version").GetInt32(), w.Vision.Version, name);
                Assert.AreEqual(want.GetProperty("tile").GetDouble(), w.Vision.Tile, name);
                Assert.AreEqual(want.GetProperty("radius").GetDouble(), w.Vision.Radius, name);
                Assert.AreEqual(want.GetProperty("trailMs").GetDouble(), w.Vision.TrailMs, name);
                Assert.AreEqual(want.GetProperty("updateMs").GetDouble(), w.Vision.UpdateMs, name);
                Assert.AreEqual(want.GetProperty("sightMask").GetInt32(), w.Vision.SightMask, name);
                var c = want.GetProperty("coliseum");
                Assert.AreEqual(c.ValueKind != System.Text.Json.JsonValueKind.Null, w.Vision.HasColiseum, name);
                if (w.Vision.HasColiseum)
                    Assert.AreEqual((c.GetProperty("x").GetInt32(), c.GetProperty("y").GetInt32(), c.GetProperty("w").GetInt32(), c.GetProperty("h").GetInt32()),
                        ((int)w.Vision.ColiseumX, (int)w.Vision.ColiseumY, (int)w.Vision.ColiseumW, (int)w.Vision.ColiseumH), name);
                CollectionAssert.AreEqual(Util.FromHex(v.GetProperty("hex").GetString()), w.Encode(), name);
            }
            var sample = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            Assert.IsTrue(sample.Vision.HasColiseum);
            Assert.AreEqual((1, 1, 2, 1), ((int)sample.Vision.ColiseumX, (int)sample.Vision.ColiseumY, (int)sample.Vision.ColiseumW, (int)sample.Vision.ColiseumH));
        }

        [Test]
        public void WelcomeCarriesTheWeaponTableRustWrote()
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
            {
                string name = v.GetProperty("name").GetString();
                if (!name.StartsWith("welcome")) continue;
                var w = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
                var want = v.GetProperty("decoded").GetProperty("weapons");
                Assert.AreEqual(want.GetArrayLength(), w.Weapons.Length, name);
                int i = 0;
                foreach (var row in want.EnumerateArray())
                {
                    var got = w.Weapons[i++];
                    Assert.AreEqual(row.GetProperty("id").GetInt32(), got.Id, name);
                    Assert.AreEqual(row.GetProperty("kind").GetInt32(), got.Kind, name);
                    // Exact doubles: Rust prints the shortest round-trip form, so the parsed value is the sent value.
                    Assert.AreEqual(row.GetProperty("reach").GetDouble(), got.Reach, 0.0, name);
                    Assert.AreEqual(row.GetProperty("halfArc").GetDouble(), got.HalfArc, 0.0, name);
                    Assert.AreEqual(row.GetProperty("speed").GetDouble(), got.Speed, 0.0, name);
                    Assert.AreEqual(row.GetProperty("radius").GetDouble(), got.Radius, 0.0, name);
                }
                CollectionAssert.AreEqual(Util.FromHex(v.GetProperty("hex").GetString()), w.Encode(), name);
            }
            var sample = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            Assert.AreEqual(7, sample.Weapons.Length);
            var sword = WireWeapon.Find(sample.Weapons, 0);
            Assert.AreEqual((WireWeapon.KindArc, 112.0, Math.PI / 4, 0.0, 0.0), (sword.Kind, sword.Reach, sword.HalfArc, sword.Speed, sword.Radius));
            var bow = WireWeapon.Find(sample.Weapons, 1);
            Assert.AreEqual((WireWeapon.KindProjectile, 520.0, 0.0, 900.0, 7.0), (bow.Kind, bow.Reach, bow.HalfArc, bow.Speed, bow.Radius));
            Assert.AreEqual(WireWeapon.KindNone, WireWeapon.Find(sample.Weapons, 31).Kind);
            Assert.IsNull(WireWeapon.Find(sample.Weapons, 6));
        }

        [Test]
        public void MalformedWeaponTablesAreRefusedForTheRustReason()
        {
            int seen = 0;
            foreach (var v in Fixture().GetProperty("malformedServer").EnumerateArray())
            {
                string name = v.GetProperty("name").GetString();
                if (!name.StartsWith("welcome_weapon_")) continue;
                seen++;
                string why = name == "welcome_weapon_count" ? "weapon count" : name == "welcome_weapon_kind" ? "weapon kind"
                    : name == "welcome_weapon_order" || name == "welcome_weapon_duplicate_id" ? "weapon order"
                    : name == "welcome_weapon_truncated" ? null : "weapon";
                var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString())), name);
                if (why == null) Assert.AreEqual(DecodeError.Truncated, e.Error, name);
                else Assert.AreEqual(DecodeError.BadField + ": " + why, e.Message, name);
            }
            Assert.AreEqual(16, seen);
        }

        [Test]
        public void WelcomeEncoderRefusesAWeaponTableTheDecoderWouldRefuse()
        {
            var good = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            Func<int, Func<WireWeapon, WireWeapon>, WireWeapon[]> with = (i, f) =>
            {
                var t = new WireWeapon[good.Weapons.Length];
                for (int k = 0; k < t.Length; k++)
                {
                    var g = good.Weapons[k];
                    t[k] = new WireWeapon { Id = g.Id, Kind = g.Kind, Reach = g.Reach, HalfArc = g.HalfArc, Speed = g.Speed, Radius = g.Radius };
                }
                t[i] = f(t[i]);
                return t;
            };
            var tooMany = new WireWeapon[WireWeapon.MaxRows + 1];
            for (int k = 0; k < tooMany.Length; k++) tooMany[k] = new WireWeapon { Id = (byte)k, Kind = WireWeapon.KindArc, Reach = 1, HalfArc = 1 };
            var cases = new (string, WireWeapon[])[]
            {
                ("weapon count", tooMany),
                ("weapon kind", with(0, a => { a.Kind = 3; return a; })),
                ("weapon order", with(1, a => { a.Id = 0; return a; })),
                ("weapon", with(0, a => { a.Reach = double.NaN; return a; })),
                ("weapon", with(1, a => { a.Speed = double.PositiveInfinity; return a; })),
                ("weapon", with(1, a => { a.Radius = -1; return a; })),
                ("weapon", with(1, a => { a.Reach = 1e6 + 1; return a; })),
                ("weapon", with(0, a => { a.HalfArc = Math.PI + 1e-9; return a; })),
                ("weapon", with(0, a => { a.HalfArc = 0; return a; })),
                ("weapon", with(0, a => { a.Reach = 0; return a; })),
                ("weapon", with(0, a => { a.Speed = 1; return a; })),
                ("weapon", with(1, a => { a.Speed = 0; return a; })),
                ("weapon", with(1, a => { a.HalfArc = 0.1; return a; })),
                ("weapon", with(6, a => { a.Radius = 1; return a; })),
            };
            foreach (var (why, bad) in cases)
            {
                var msg = new ServerMsg.Welcome { Protocol = good.Protocol, MatchId = good.MatchId, Session = good.Session, Map = good.Map, Weapons = bad };
                Assert.AreEqual(why, Assert.Throws<ArgumentException>(() => msg.Encode(), why).Message, why);
            }
            // The edges are valid.
            var edge = new ServerMsg.Welcome { Protocol = good.Protocol, MatchId = good.MatchId, Session = good.Session, Map = good.Map,
                Weapons = with(0, a => { a.HalfArc = Math.PI; return a; }) };
            var back = (ServerMsg.Welcome)ServerMsg.Decode(edge.Encode());
            Assert.AreEqual(Math.PI, back.Weapons[0].HalfArc);
        }

        [Test]
        public void MapWithWrongHashOrRunsIsRejected()
        {
            var good = ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            byte[] f = good.Encode();
            // The hash sits right after the 4 size bytes of the map blob; the blob follows the 60-byte header and the archetype
            // table (protocol 16), so it starts EncodedLength bytes before the end.
            f[f.Length - ((ServerMsg.Welcome)good).Map.EncodedLength + 4] ^= 1;
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

        [Test]
        public void SnapshotCarriesTheIndicatorFactsRustWrote()
        {
            var s = Server<ServerMsg.Snapshot>("snapshot_indicator_facts");
            Assert.AreEqual((byte)13, s.Me.Flags, "Wish ready | teleport immune | roam ready");
            Assert.AreEqual((byte)0x31, s.Me.BuildMarks); Assert.AreEqual((2, 50, 15), (s.Me.MarkTier, s.Me.Brand, s.Me.MarkTax));
            var byId = s.Actors.ToDictionary(a => a.Id);
            Assert.AreEqual((1, 2, 0x59, 4, 100, 100), (byId[6].Flags, byId[6].Offhand, byId[6].BuildMarks, byId[6].MarkTier, byId[6].Brand, byId[6].MarkTax));
            Assert.AreEqual((0, 6, 4), (byId[7].Flags, byId[7].Offhand, byId[7].BuildMarks));
            Assert.AreEqual((byte)WireIndicators.FlagEngaged, byId[40].Flags);
            Assert.AreEqual(WireIndicators.FlagsKnown, byId[41].Flags);
            CollectionAssert.AreEqual(Util.FromHex(SrvHex("snapshot_indicator_facts")), s.Encode());

            // The Net views expose the same facts, decoded.
            var buffer = new SnapshotBuffer(); buffer.Add(s);
            var rows = new List<InterpActor>(); buffer.Sample(s.ServerMs, rows);
            var six = rows.Single(r => r.Id == 6);
            Assert.IsTrue(six.WishReady); Assert.IsFalse(six.Engaged || six.TeleportImmune || six.RoamReady);
            Assert.AreEqual(WeaponId.Bow, six.OffhandWeapon);
            Assert.AreEqual(StatKey.Leech, six.TopStat1); Assert.AreEqual(StatKey.AttackSpeed, six.TopStat2);
            Assert.AreEqual((4, 100, 100), (six.MarkTier, six.Brand, six.MarkTax));
            var seven = rows.Single(r => r.Id == 7);
            Assert.AreEqual(WeaponId.Fists, seven.OffhandWeapon); Assert.AreEqual(StatKey.Health, seven.TopStat1); Assert.IsNull(seven.TopStat2);
            Assert.AreEqual((0, 0, 0), (seven.MarkTier, seven.Brand, seven.MarkTax));
            var mob = rows.Single(r => r.Id == 40);
            Assert.IsTrue(mob.Engaged); Assert.IsFalse(mob.WishReady); Assert.IsNull(mob.OffhandWeapon); Assert.IsNull(mob.TopStat1);
            var all = rows.Single(r => r.Id == 41);
            Assert.IsTrue(all.WishReady && all.Engaged && all.TeleportImmune && all.RoamReady);
        }

        [Test]
        public void FxCarryWindupCancelSignatureHitsHealsAndCriticalsRustWrote()
        {
            var f = Server<ServerMsg.Fx>("fx_indicators");
            Assert.AreEqual(901u, f.Tick); Assert.AreEqual(12, f.List.Count);
            Assert.AreEqual((FxKind.Windup, 70000u, (byte)0, (ushort)350), (f.List[0].Kind, f.List[0].By, f.List[0].Weapon, f.List[0].Ms));
            Assert.AreEqual((FxKind.Windup, 3u, (byte)4, ushort.MaxValue), (f.List[1].Kind, f.List[1].By, f.List[1].Weapon, f.List[1].Ms));
            Assert.AreEqual((FxKind.Cancel, 70000u), (f.List[2].Kind, f.List[2].Id));
            Assert.AreEqual((FxKind.Hit, false, true), (f.List[3].Kind, f.List[3].Passive, f.List[3].Critical));
            Assert.AreEqual((FxKind.Hit, true, true), (f.List[4].Kind, f.List[4].Passive, f.List[4].Critical));
            Assert.AreEqual((FxKind.SigHit, 2u, 3u, WireFx.HitKindBurn), (f.List[5].Kind, f.List[5].Victim, f.List[5].By, f.List[5].HitKind));
            Assert.AreEqual((uint.MaxValue, WireFx.HitKindDisease), (f.List[6].By, f.List[6].HitKind), "an absent source is u32::MAX");
            Assert.AreEqual(WireFx.HitKindBacklash, f.List[7].HitKind); Assert.AreEqual(WireFx.HitKindMark, f.List[8].HitKind);
            Assert.AreEqual((byte)(WireFx.HitKindAbility + 4), f.List[9].HitKind, "Last Stand");
            Assert.AreEqual((FxKind.Heal, 3u), (f.List[10].Kind, f.List[10].Id)); Assert.AreEqual((FxKind.Heal, 128u, 0.5f), (f.List[11].Kind, f.List[11].Id, f.List[11].Amount));
            Assert.IsFalse(Server<ServerMsg.Fx>("fx").List[1].Critical, "a plain hit is not critical");
        }

        [Test]
        public void StateCarriesTheRosterRustWrote()
        {
            var st = Server<ServerMsg.State>("state_roster");
            var roster = (RosterState)st.Items.Single();
            Assert.AreEqual(12u, roster.Key);
            Assert.AreEqual(4, roster.Rows.Length);
            Assert.AreEqual((1u, false, "Wren"), (roster.Rows[0].Id, roster.Rows[0].Bot, roster.Rows[0].Name));
            Assert.AreEqual((2u, true, "bot-Ashen_7"), (roster.Rows[1].Id, roster.Rows[1].Bot, roster.Rows[1].Name));
            Assert.AreEqual((300u, false, new string('x', 24)), (roster.Rows[2].Id, roster.Rows[2].Bot, roster.Rows[2].Name));
            Assert.AreEqual((301u, true, "Søren"), (roster.Rows[3].Id, roster.Rows[3].Bot, roster.Rows[3].Name));
            CollectionAssert.AreEqual(Util.FromHex(SrvHex("state_roster")), st.Encode());
            var empty = (RosterState)Server<ServerMsg.State>("state_roster_empty").Items.Single();
            Assert.AreEqual(0, empty.Rows.Length);
        }

        [Test]
        public void EventsCarryCampClears()
        {
            var e = Server<ServerMsg.Events>("events_camp_cleared");
            Assert.AreEqual(902u, e.Tick); Assert.AreEqual(2, e.List.Count);
            Assert.AreEqual((EventKind.CampCleared, (ushort)0), (e.List[0].Kind, e.List[0].Camp));
            Assert.AreEqual((EventKind.CampCleared, (ushort)511), (e.List[1].Kind, e.List[1].Camp));
        }

        [Test]
        public void IndicatorEncodersRefuseWhatNoDecoderAccepts()
        {
            WireActor A(Action<WireActor[]> set) { var a = new[] { new WireActor { Id = 1, HpPct = 100, Status = 1 } }; set(a); return a[0]; }
            void Refused(WireActor a, string why) => Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { a } }.Encode(), why);
            Refused(A(a => a[0].Flags = 0x10), "unknown flag bit");
            Refused(A(a => a[0].Offhand = 17), "off-hand over 16");
            Refused(A(a => a[0].BuildMarks = 0x0a), "key over 9");
            Refused(A(a => a[0].BuildMarks = 0x10), "second without first");
            Refused(A(a => a[0].BuildMarks = 0x33), "equal keys");
            Refused(A(a => a[0].MarkTier = 5), "tier over 4");
            Refused(A(a => a[0].Brand = 101), "brand over 100");
            Refused(A(a => a[0].MarkTax = 101), "tax over 100");
            Assert.DoesNotThrow(() => new ServerMsg.Snapshot { Actors = new[] { A(a => { a[0].Flags = 0x0f; a[0].Offhand = 16; a[0].BuildMarks = 0x98; a[0].MarkTier = 4; a[0].Brand = 100; a[0].MarkTax = 100; }) } }.Encode());
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Me = new WireSelf { Id = 1, Status = 1, Flags = 0x80 } }.Encode(), "self flag bit");
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Me = new WireSelf { Id = 1, Status = 1, BuildMarks = 0x11 } }.Encode(), "self equal keys");
            ServerMsg.SnapshotDelta D() => new ServerMsg.SnapshotDelta { Tick = 2, BaseTick = 1, HasSelf = true };
            var badSelf = D(); badSelf.HasMark = true; badSelf.MarkTier = 5;
            Assert.Throws<ArgumentException>(() => badSelf.Encode(), "delta self tier");
            var orphan = D(); orphan.HasSelf = false; orphan.HasFlags = true;
            Assert.Throws<ArgumentException>(() => orphan.Encode(), "self facts need the self");
            var badActor = D(); badActor.Changed = new[] { new ActorDelta { Id = 2, Mask = ActorDelta.MOffhand, Offhand = 17 } }; badActor.ChangedCount = 1;
            Assert.Throws<ArgumentException>(() => badActor.Encode(), "delta off-hand");
            var unmasked = D(); unmasked.Changed = new[] { new ActorDelta { Id = 2, Mask = ActorDelta.MX, Offhand = 17 } }; unmasked.ChangedCount = 1;
            Assert.DoesNotThrow(() => unmasked.Encode(), "a field outside the mask is not sent");
            var fx = new ServerMsg.Fx(); fx.List.Add(new WireFx { Kind = FxKind.Windup, Weapon = 16 });
            Assert.Throws<ArgumentException>(() => fx.Encode(), "windup weapon");
            foreach (byte kind in new byte[] { 0, 6, 15, 21, 255 })
            {
                var sig = new ServerMsg.Fx(); sig.List.Add(new WireFx { Kind = FxKind.SigHit, HitKind = kind });
                Assert.Throws<ArgumentException>(() => sig.Encode(), "hit kind " + kind);
            }
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
                    else if (it.GetProperty("k").GetString() == "windup")
                    {
                        Assert.AreEqual(FxKind.Windup, f.Kind); Assert.AreEqual(it.GetProperty("by").GetUInt32(), f.By);
                        Assert.AreEqual(it.GetProperty("weapon").GetByte(), f.Weapon); Assert.AreEqual(it.GetProperty("aBits").GetInt64(), (long)(uint)Bits(f.A));
                        Assert.AreEqual(it.GetProperty("ms").GetUInt16(), f.Ms);
                    }
                    else if (it.GetProperty("k").GetString() == "cancel") { Assert.AreEqual(FxKind.Cancel, f.Kind); Assert.AreEqual(it.GetProperty("id").GetUInt32(), f.Id); }
                    else if (it.GetProperty("k").GetString() == "sigHit")
                    {
                        Assert.AreEqual(FxKind.SigHit, f.Kind); Assert.AreEqual(it.GetProperty("victim").GetUInt32(), f.Victim);
                        Assert.AreEqual(it.GetProperty("by").GetUInt32(), f.By); Assert.AreEqual(it.GetProperty("kind").GetByte(), f.HitKind);
                        Assert.AreEqual(it.GetProperty("amountBits").GetInt64(), (long)(uint)Bits(f.Amount));
                    }
                    else if (it.GetProperty("k").GetString() == "heal")
                    {
                        Assert.AreEqual(FxKind.Heal, f.Kind); Assert.AreEqual(it.GetProperty("id").GetUInt32(), f.Id);
                        Assert.AreEqual(it.GetProperty("amountBits").GetInt64(), (long)(uint)Bits(f.Amount));
                    }
                    else
                    {
                        Assert.AreEqual("hit", it.GetProperty("k").GetString());
                        Assert.AreEqual(it.GetProperty("passive").GetBoolean(), f.Passive);
                        Assert.AreEqual(it.GetProperty("critical").GetBoolean(), f.Critical);
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
                    if (state.Items[i] is PropsState props)
                    {
                        var expectedValue = expectedItem.GetProperty("value");
                        var expectedRows = expectedValue.GetProperty("rows");
                        Assert.AreEqual(expectedRows.GetArrayLength(), props.Rows.Length);
                        for (int rowIndex = 0; rowIndex < props.Rows.Length; rowIndex++)
                        {
                            var row = props.Rows[rowIndex]; var expectedRow = expectedRows[rowIndex];
                            Assert.AreEqual(expectedRow.GetProperty("handle").GetUInt32(), row.Handle.Value);
                            Assert.AreEqual(expectedRow.GetProperty("x").GetUInt16(), row.X);
                            Assert.AreEqual(expectedRow.GetProperty("y").GetUInt16(), row.Y);
                            Assert.AreEqual(expectedRow.GetProperty("kind").GetByte(), (byte)row.Kind);
                            if (row.Kind == PropKind.QuestItem)
                            {
                                Assert.AreEqual(expectedRow.GetProperty("quest").GetUInt32(), row.QuestRef.Value);
                                Assert.AreEqual(expectedRow.GetProperty("fetch").GetBoolean(), row.QuestFetch);
                            }
                        }
                        var focus = expectedValue.GetProperty("focus");
                        Assert.AreEqual(focus.ValueKind == JsonValueKind.Null, !props.Focus.HasValue);
                        if (props.Focus.HasValue) Assert.AreEqual(focus.GetProperty("handle").GetUInt32(), props.Focus.Value.Handle.Value);
                    }
                    else if (state.Items[i] is RewardChestsState rewardChests)
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
                    else if (state.Items[i] is QuestsState quests)
                    {
                        var expectedValue = expectedItem.GetProperty("value");
                        if (expectedValue.ValueKind == JsonValueKind.Null)
                        {
                            Assert.IsFalse(quests.Available);
                            Assert.IsNull(quests.View);
                            continue;
                        }

                        Assert.IsTrue(quests.Available);
                        Assert.IsNotNull(quests.View);
                        var view = quests.View;
                        Assert.AreEqual(expectedValue.GetProperty("unknownCount").GetUInt32(), view.UnknownCount);
                        Assert.AreEqual(expectedValue.GetProperty("displayUnknownCount").GetUInt32(), view.DisplayUnknownCount);
                        var ownerRoster = expectedValue.GetProperty("ownerRoster");
                        Assert.AreEqual(ownerRoster.ValueKind == JsonValueKind.Null ? (uint?)null : ownerRoster.GetUInt32(),
                            view.OwnerRoster.HasValue ? (uint?)view.OwnerRoster.Value.Value : null);

                        var roster = expectedValue.GetProperty("roster");
                        Assert.AreEqual(roster.GetArrayLength(), view.Roster.Length);
                        for (int j = 0; j < view.Roster.Length; j++)
                        {
                            Assert.AreEqual(roster[j].GetProperty("id").GetUInt32(), view.Roster[j].Id.Value);
                            Assert.AreEqual(roster[j].GetProperty("label").GetString(), view.Roster[j].Label);
                        }

                        var rows = expectedValue.GetProperty("rows");
                        Assert.AreEqual(rows.GetArrayLength(), view.Rows.Length);
                        for (int j = 0; j < view.Rows.Length; j++)
                        {
                            var expectedRow = rows[j]; var row = view.Rows[j];
                            Assert.AreEqual(expectedRow.GetProperty("handle").GetUInt32(), row.Handle.Value);
                            Assert.AreEqual(expectedRow.GetProperty("def").GetString(), row.Def);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expectedRow.GetProperty("giver").GetProperty("x").GetDouble()), BitConverter.DoubleToInt64Bits(row.GiverX));
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expectedRow.GetProperty("giver").GetProperty("y").GetDouble()), BitConverter.DoubleToInt64Bits(row.GiverY));
                            Assert.AreEqual(expectedRow.GetProperty("state").GetByte(), (byte)row.State);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expectedRow.GetProperty("expiresAt").GetDouble()), BitConverter.DoubleToInt64Bits(row.ExpiresAt));
                            var participants = expectedRow.GetProperty("participants");
                            Assert.AreEqual(participants.GetArrayLength(), row.Participants.Length);
                            for (int k = 0; k < row.Participants.Length; k++)
                            {
                                var expectedParticipant = participants[k]; var participant = row.Participants[k];
                                Assert.AreEqual(expectedParticipant.GetProperty("id").GetUInt32(), participant.Id.Value);
                                Assert.AreEqual(expectedParticipant.GetProperty("accepted").GetBoolean(), participant.Accepted);
                                Assert.AreEqual(expectedParticipant.GetProperty("progress").GetUInt32(), participant.Progress);
                                Assert.AreEqual(expectedParticipant.GetProperty("visited").GetByte(), participant.Visited);
                            }
                            var carrier = expectedRow.GetProperty("carrier");
                            Assert.AreEqual(carrier.ValueKind == JsonValueKind.Null ? (uint?)null : carrier.GetUInt32(),
                                row.Carrier.HasValue ? (uint?)row.Carrier.Value.Value : null);
                            var doneBy = expectedRow.GetProperty("doneBy");
                            Assert.AreEqual(doneBy.ValueKind == JsonValueKind.Null ? null : doneBy.GetString(), row.DoneBy);
                            Assert.AreEqual(expectedRow.GetProperty("canAccept").GetBoolean(), row.CanAccept);
                            Assert.AreEqual(expectedRow.GetProperty("ownerAccepted").GetBoolean(), row.OwnerAccepted);
                            Assert.AreEqual(expectedRow.GetProperty("ownerCompleted").GetBoolean(), row.OwnerCompleted);
                            Assert.AreEqual(expectedRow.GetProperty("ownerReady").GetBoolean(), row.OwnerReady);
                            Assert.AreEqual(expectedRow.GetProperty("ownerProgress").GetUInt32(), row.OwnerProgress);
                            Assert.AreEqual(expectedRow.GetProperty("ownerVisited").GetByte(), row.OwnerVisited);
                            Assert.AreEqual(expectedRow.GetProperty("name").GetString(), row.Name);
                            Assert.AreEqual(expectedRow.GetProperty("giverLabel").GetString(), row.GiverLabel);
                            Assert.AreEqual(expectedRow.GetProperty("brief").GetString(), row.Brief);
                            Assert.AreEqual(expectedRow.GetProperty("objective").GetString(), row.Objective);
                            Assert.AreEqual(expectedRow.GetProperty("reward").GetString(), row.Reward);
                        }

                        var objectives = expectedValue.GetProperty("objectives");
                        Assert.AreEqual(objectives.GetArrayLength(), view.Objectives.Length);
                        for (int j = 0; j < view.Objectives.Length; j++)
                        {
                            var expectedObjective = objectives[j]; var objective = view.Objectives[j];
                            Assert.AreEqual(expectedObjective.GetProperty("quest").GetUInt32(), objective.Quest.Value);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expectedObjective.GetProperty("at").GetProperty("x").GetDouble()), BitConverter.DoubleToInt64Bits(objective.X));
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expectedObjective.GetProperty("at").GetProperty("y").GetDouble()), BitConverter.DoubleToInt64Bits(objective.Y));
                        }
                    }
                    else if (state.Items[i] is TradeState trade)
                    {
                        var expectedValue = expectedItem.GetProperty("value");
                        if (expectedValue.ValueKind == JsonValueKind.Null)
                        {
                            Assert.IsFalse(trade.Available); Assert.IsNull(trade.Value); continue;
                        }
                        Assert.IsTrue(trade.Available); Assert.IsNotNull(trade.Value);
                        var view = trade.Value;
                        Assert.AreEqual(expectedValue.GetProperty("tradeUsed").GetBoolean(), view.TradeUsed);
                        var offers = expectedValue.GetProperty("offers"); Assert.AreEqual(offers.GetArrayLength(), view.Offers.Length);
                        for (int j = 0; j < view.Offers.Length; j++)
                        {
                            var actual = view.Offers[j]; var expected = offers[j];
                            Assert.AreEqual(expected.GetProperty("cost").GetByte(), (byte)actual.Cost);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.GetProperty("costValue").GetDouble()), BitConverter.DoubleToInt64Bits(actual.CostValue));
                            Assert.AreEqual(expected.GetProperty("gain").GetByte(), (byte)actual.Gain);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.GetProperty("gainValue").GetDouble()), BitConverter.DoubleToInt64Bits(actual.GainValue));
                            Assert.AreEqual(expected.GetProperty("label").GetString(), actual.Label);
                        }
                        var stats = expectedValue.GetProperty("stats"); Assert.AreEqual(stats.GetArrayLength(), view.Stats.Length);
                        for (int j = 0; j < view.Stats.Length; j++)
                        {
                            Assert.AreEqual(stats[j].GetProperty("stat").GetByte(), (byte)view.Stats[j].Stat);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(stats[j].GetProperty("value").GetDouble()), BitConverter.DoubleToInt64Bits(view.Stats[j].Value));
                        }
                        var readyAt = expectedValue.GetProperty("barterReadyAt");
                        Assert.AreEqual(readyAt.ValueKind == JsonValueKind.Null, !view.BarterReadyAt.HasValue);
                        if (view.BarterReadyAt.HasValue)
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(readyAt.GetDouble()), BitConverter.DoubleToInt64Bits(view.BarterReadyAt.Value));
                        var merchants = expectedValue.GetProperty("merchants"); Assert.AreEqual(merchants.GetArrayLength(), view.Merchants.Length);
                        for (int j = 0; j < view.Merchants.Length; j++)
                        {
                            var actual = view.Merchants[j]; var expected = merchants[j];
                            Assert.AreEqual(expected.GetProperty("kind").GetByte(), (byte)actual.Kind);
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.GetProperty("x").GetDouble()), BitConverter.DoubleToInt64Bits(actual.X));
                            Assert.AreEqual(BitConverter.DoubleToInt64Bits(expected.GetProperty("y").GetDouble()), BitConverter.DoubleToInt64Bits(actual.Y));
                            Assert.AreEqual(expected.GetProperty("name").GetString(), actual.Name);
                        }
                        var labels = expectedValue.GetProperty("barterLabels"); Assert.AreEqual(3, labels.GetArrayLength());
                        for (int j = 0; j < 3; j++) Assert.AreEqual(labels[j].GetString(), view.BarterLabels[j]);
                    }
                }
                return;
            }
            if (msg is ServerMsg.Welcome welcome)
            {
                var expectedMap = d.GetProperty("map");
                Assert.AreEqual(expectedMap.GetProperty("w").GetUInt16(), welcome.Map.W);
                Assert.AreEqual(expectedMap.GetProperty("h").GetUInt16(), welcome.Map.H);
                Assert.AreEqual(expectedMap.GetProperty("layerHash").GetUInt32(), welcome.Map.LayerHash);
                Assert.AreEqual(expectedMap.GetProperty("terrainMode").GetByte(), welcome.Map.TerrainMode);
                Assert.AreEqual(expectedMap.GetProperty("semanticHash").GetUInt32(), welcome.Map.SemanticHash);
                Assert.AreEqual(expectedMap.GetProperty("contextHash").GetUInt32(), welcome.Map.ContextHash);
                CollectionAssert.AreEqual(JsonBytes(expectedMap.GetProperty("tiles")), welcome.Map.Tiles);
                JsonElement terrain = expectedMap.GetProperty("terrain");
                JsonElement regions = expectedMap.GetProperty("regions");
                if (terrain.ValueKind == JsonValueKind.Null) Assert.IsNull(welcome.Map.Terrain);
                else CollectionAssert.AreEqual(JsonBytes(terrain), welcome.Map.Terrain);
                if (regions.ValueKind == JsonValueKind.Null) Assert.IsNull(welcome.Map.Regions);
                else CollectionAssert.AreEqual(JsonBytes(regions), welcome.Map.Regions);
                return;
            }
            CheckSnapshot(d, (ServerMsg.Snapshot)msg);
        }

        static byte[] JsonBytes(JsonElement values)
        {
            var result = new byte[values.GetArrayLength()];
            for (int i = 0; i < result.Length; i++) result[i] = values[i].GetByte();
            return result;
        }

        /// <summary>A snapshot equals the vector's decoded form field for field (floats as bit patterns).</summary>
        static void CheckSnapshot(JsonElement d, ServerMsg.Snapshot s)
        {
            Assert.AreEqual(d.GetProperty("tick").GetUInt32(), s.Tick);
            Assert.AreEqual(d.GetProperty("serverMs").GetDouble(), s.ServerMs);
            Assert.AreEqual(d.GetProperty("phase").GetByte(), s.Phase);
            Assert.AreEqual(d.GetProperty("ack").GetUInt32(), s.AckInput);
            Assert.AreEqual(d.GetProperty("training").GetBoolean(), s.Training);
            var ownerCombat = d.GetProperty("ownerCombat");
            if (ownerCombat.ValueKind == JsonValueKind.Null) Assert.IsNull(s.OwnerCombat);
            else
            {
                Assert.IsNotNull(s.OwnerCombat);
                var lockState = ownerCombat.GetProperty("lock");
                if (lockState.TryGetProperty("clear", out var clear) && clear.GetBoolean())
                {
                    Assert.AreEqual(WireOwnerLockKind.Clear, s.OwnerCombat.Lock.Kind);
                    Assert.IsNull(s.OwnerCombat.Lock.Target);
                }
                else
                {
                    Assert.IsTrue(lockState.GetProperty("held").GetBoolean());
                    Assert.AreEqual(WireOwnerLockKind.Held, s.OwnerCombat.Lock.Kind);
                    var target = lockState.GetProperty("target");
                    Assert.AreEqual(target.ValueKind == JsonValueKind.Null ? (uint?)null : target.GetUInt32(), s.OwnerCombat.Lock.Target);
                }
                Assert.AreEqual(ownerCombat.GetProperty("drawStartedAt").GetUInt32(), s.OwnerCombat.DrawStartedAt);
                Assert.AreEqual(ownerCombat.GetProperty("readyAt").GetUInt32(), s.OwnerCombat.ReadyAt);
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(ownerCombat.GetProperty("asMilli").GetDouble()), BitConverter.DoubleToInt64Bits(s.OwnerCombat.AsMilli));
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(ownerCombat.GetProperty("windupMilli").GetDouble()), BitConverter.DoubleToInt64Bits(s.OwnerCombat.WindupMilli));
                Assert.AreEqual(BitConverter.DoubleToInt64Bits(ownerCombat.GetProperty("speedMilli").GetDouble()), BitConverter.DoubleToInt64Bits(s.OwnerCombat.SpeedMilli));
            }
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
                Assert.AreEqual(me.GetProperty("archetype").GetByte(), s.Me.Archetype);
                Assert.AreEqual(me.GetProperty("flags").GetByte(), s.Me.Flags); Assert.AreEqual(me.GetProperty("buildMarks").GetByte(), s.Me.BuildMarks);
                Assert.AreEqual(me.GetProperty("markTier").GetByte(), s.Me.MarkTier); Assert.AreEqual(me.GetProperty("brand").GetByte(), s.Me.Brand);
                Assert.AreEqual(me.GetProperty("markTax").GetByte(), s.Me.MarkTax);
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
                Assert.AreEqual(e.GetProperty("archetype").GetByte(), a.Archetype);
                Assert.AreEqual(e.GetProperty("flags").GetByte(), a.Flags); Assert.AreEqual(e.GetProperty("offhand").GetByte(), a.Offhand);
                Assert.AreEqual(e.GetProperty("buildMarks").GetByte(), a.BuildMarks); Assert.AreEqual(e.GetProperty("markTier").GetByte(), a.MarkTier);
                Assert.AreEqual(e.GetProperty("brand").GetByte(), a.Brand); Assert.AreEqual(e.GetProperty("markTax").GetByte(), a.MarkTax);
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
                case "projectile_owner_flag": case "wish_option_over_1": case "wish_fx_option_over_1": want = DecodeError.BadTag; break;
                case "projectile_kind": case "projectile_owner_zero":
                case "potion_notice_zero": case "potion_notice_unknown":
                case "cannon_notice_zero": case "cannon_notice_unknown": case "cannon_notice_bad_seconds": case "cannon_notice_seconds_over":
                case "camp_mob_type": case "camp_elite": case "camp_alive": case "camp_state": case "camp_negative_time": case "camp_nonfinite_time": case "camp_time_order":
                case "wish_ability_over_4": case "wish_charge_count_invalid": case "wish_time_nonfinite": case "wish_cast_time_order":
                case "wish_fx_caster_zero": case "wish_fx_ability_over_4": case "wish_fx_time_nonfinite": case "wish_fx_blaze_one_point":
                case "wish_fx_nonblaze_destination": case "wish_fx_anonymous_landed_target": case "wish_fx_anonymous_landed_no_target": case "wish_fx_end_reason_over_2":
                case "owner_combat_bad_lock": case "owner_combat_zero_target": case "owner_combat_missing_self": case "owner_combat_dangling_target":
                case "owner_combat_nonfinite_mirror": case "owner_combat_fractional_mirror": case "owner_combat_below_min_mirror":
                case "delta_owner_combat_option_unknown": case "delta_owner_combat_bad_lock": case "delta_owner_combat_zero_target": case "delta_owner_combat_nonfinite_mirror": case "delta_owner_combat_available_without_self":
                case "actor_mob_type_over_30": case "delta_actor_mob_type_over_30":
                case "snapshot_giver_kit_default": case "snapshot_giver_kit_half": case "snapshot_giver_kit_half_weapon": case "snapshot_giver_mob_type": want = DecodeError.BadField; break;
                case "chest_bad_reason_zero": case "chest_bad_reason_unknown":
                case "pickup_bad_reason_zero": case "pickup_bad_reason_unknown":
                case "state_quest_status_unknown": case "state_quest_flags_unknown": case "state_quest_visited_unknown":
                case "state_quest_ref_missing": case "state_quest_prop_missing_view": want = DecodeError.BadField; break;
                case "unknown_tag": case "client_tag_from_server": case "fx_bad_tag": want = DecodeError.BadTag; break;
                case "trailing_byte": case "state_trailing_byte": want = DecodeError.Trailing; break;
                case "state_truncated": case "state_reward_kill_truncated_key": case "state_reward_kill_truncated_gain":
                case "cannon_notice_missing_seconds": want = DecodeError.Truncated; break;
                case "overlong_varint": case "varint_past_u32": case "varint_too_long": case "head_overlong_varint": case "actor_mask_overlong_varint":
                case "projectile_owner_overlong": case "delta_head_overlong_varint":
                    want = DecodeError.BadVarint; break;
                case "state_too_many_keys": case "state_too_many_props": case "state_too_many_fields": case "state_too_many_projectiles": case "state_too_many_camps": case "state_too_many_rewards": case "state_reward_options_too_many":
                case "state_quest_roster_over_limit": case "state_quest_rows_over_limit": case "state_quest_participants_over_limit":
                case "state_quest_objectives_over_limit": case "state_quest_objectives_per_row_over_limit":
                case "state_trade_offers_over_limit": case "state_trade_stats_over_limit": case "state_trade_merchants_over_limit":
                case "too_many_actors": case "fx_too_many": want = DecodeError.TooMany; break;
                case "head_self_bit_without_present_bit": case "head_unknown_bit": case "self_max_hp_over_u16": case "actor_reserved_mask_bit":
                case "self_status_over_3": case "phase_over_3": case "actor_status_over_3": case "actor_unknown_mask_bit_after_kind":
                case "state_duplicate_key": case "state_key_order": case "state_bad_potion_count": case "state_zero_prop_handle": case "state_missing_focus":
                case "state_reward_kind_unknown":
                case "state_reward_kill_key_unknown": case "state_reward_kill_gain_zero": case "state_reward_kill_gain_negative":
                case "state_reward_kill_gain_nan": case "state_reward_kill_gain_infinity":
                case "state_reward_card_id_80": case "state_plan_negative_deadline": case "state_unknown_key": case "delta_head_unknown_bit": case "delta_phase_over_3": case "delta_actor_mask_unknown_bit":
                case "state_quest_row_handle_zero": case "state_quest_roster_id_zero": case "state_quest_objective_handle_zero": case "state_quest_prop_handle_zero":
                case "state_quest_availability_flag": case "state_quest_participant_accepted_flag": case "state_quest_done_by_flag": case "state_quest_prop_fetch_flag":
                case "state_quest_duplicate_row_handle": case "state_quest_duplicate_roster_id": case "state_quest_duplicate_participant_id":
                case "state_quest_owner_roster_missing": case "state_quest_carrier_missing": case "state_quest_participant_missing":
                case "state_quest_unknown_count": case "state_quest_display_count_over_unknown": case "state_quest_def_empty": case "state_quest_def_over_16":
                case "state_quest_giver_nonfinite": case "state_quest_giver_out_of_range": case "state_quest_objective_nonfinite": case "state_quest_objective_out_of_range":
                case "state_quest_expiry_negative": case "state_quest_expiry_nonfinite": case "state_quest_owner_visited_unknown":
                case "state_trade_availability_flag": case "state_trade_used_flag": case "state_trade_deadline_option_unknown":
                case "state_trade_kind_unknown": case "state_trade_stat_unknown": case "state_trade_offer_same_stat":
                case "state_trade_offer_nonpositive": case "state_trade_offer_nonfinite": case "state_trade_delta_nonfinite":
                case "state_trade_deadline_negative": case "state_trade_deadline_nonfinite": case "state_trade_merchant_nonfinite":
                case "state_trade_merchant_out_of_range":
                case "delta_actor_status_over_3":
                case "actor_id_gap_zero": case "actor_id_overflow": case "actor_hp_over_100": case "actor_bounty_over_u16":
                case "delta_age_zero": case "delta_age_over_max": case "delta_age_past_tick": case "delta_head_field_without_present_bit": case "delta_head_archetype_without_present_bit":
                case "delta_self_status_over_3": case "delta_actor_id_gap_zero": case "delta_actor_hp_over_100": case "delta_actor_bounty_over_u16":
                case "delta_departed_empty": case "delta_departed_id_gap_zero":
                    want = DecodeError.BadField; break;
                // Protocol 16 indicator facts (ADR0026): every refused fact is BadField, a cut field Truncated.
                case "self_flags_unknown_bit": case "self_build_marks_repeated": case "self_mark_tier_over_4":
                case "actor_flags_unknown_bit": case "actor_offhand_over_16": case "actor_build_marks_key_over_9":
                case "actor_build_marks_second_without_first": case "actor_build_marks_repeated": case "actor_mark_tier_over_4":
                case "actor_mark_brand_over_100": case "actor_mark_tax_over_100":
                case "delta_head_flags_without_present_bit": case "delta_self_flags_unknown_bit": case "delta_self_build_marks_key_over_9":
                case "delta_self_mark_brand_over_100": case "delta_actor_flags_unknown_bit": case "delta_actor_offhand_over_16":
                case "delta_actor_build_marks_repeated": case "delta_actor_mark_tier_over_4":
                case "hit_flags_unknown_bit": case "fx_windup_weapon_over_15": case "fx_sig_hit_kind_zero": case "fx_sig_hit_kind_6": case "fx_sig_hit_kind_21":
                case "state_roster_count_over_32": case "state_roster_id_zero": case "state_roster_order": case "state_roster_flags_unknown":
                case "state_roster_name_empty": case "state_roster_name_long": case "state_roster_name_control":
                    want = DecodeError.BadField; break;
                case "actor_mark_truncated": case "fx_windup_truncated": case "fx_heal_truncated": case "camp_cleared_truncated": case "state_roster_truncated":
                    want = DecodeError.Truncated; break;
                case "state_roster_name_utf8": want = DecodeError.BadUtf8; break;
                case "delta_too_many_actors": case "delta_departed_too_many": want = DecodeError.TooMany; break;
                case "delta_truncated": want = DecodeError.Truncated; break;
                case "delta_trailing_byte": want = DecodeError.Trailing; break;
                case "reject_code_zero": want = DecodeError.BadTag; break;
                case "server_bad_utf8": case "state_trade_label_bad_utf8": want = DecodeError.BadUtf8; break;
                case "state_quests_over_24576": want = DecodeError.TooLarge; break;
                case "map_zero_size": case "map_too_large": case "map_bad_tile": case "map_zero_run": case "map_run_past_size":
                case "map_short": case "map_hash_mismatch":
                case "map_ext_short": case "map_ext_version": case "map_ext_presence": case "map_ext_run_zero":
                case "map_ext_terrain_value": case "map_ext_region_value": case "map_ext_plane_length":
                case "map_ext_terrain_collision": case "map_ext_semantic_hash": case "map_ext_context_hash": case "map_ext_trailing":
                    want = DecodeError.BadMap; break;
                case "map_ext_mode": want = DecodeError.BadField; break;
                case "welcome_trailing": want = DecodeError.Trailing; break;
                case "welcome_archetype_order": case "welcome_archetype_hull": case "welcome_archetype_zero_box":
                case "welcome_archetype_count": case "welcome_archetype_key_long": case "welcome_archetype_key_ascii": want = DecodeError.BadField; break;
                case "welcome_archetype_truncated": case "welcome_vision_truncated": want = DecodeError.Truncated; break;
                case "welcome_vision_version_zero": case "welcome_vision_tile_zero": case "welcome_vision_radius_nan": case "welcome_vision_radius_negative":
                case "welcome_vision_trail_negative": case "welcome_vision_update_infinite": case "welcome_vision_mask_zero": case "welcome_vision_coliseum_flag":
                case "welcome_vision_coliseum_empty": case "welcome_vision_coliseum_outside": want = DecodeError.BadField; break;
                case "welcome_weapon_truncated": want = DecodeError.Truncated; break;
                case "welcome_weapon_count": case "welcome_weapon_kind": case "welcome_weapon_order": case "welcome_weapon_duplicate_id":
                case "welcome_weapon_reach_nan": case "welcome_weapon_speed_infinite": case "welcome_weapon_radius_negative":
                case "welcome_weapon_reach_over_max": case "welcome_weapon_arc_half_arc_over_pi": case "welcome_weapon_arc_half_arc_zero":
                case "welcome_weapon_arc_reach_zero": case "welcome_weapon_arc_speed": case "welcome_weapon_projectile_speed_zero":
                case "welcome_weapon_projectile_half_arc": case "welcome_weapon_none_values": want = DecodeError.BadField; break;
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
                IEnumerable<int> cuts = v.GetProperty("name").GetString() == "state_all_max_budget"
                    ? MaximumStateTruncationCuts(full)
                    : Enumerable.Range(0, full.Length);
                foreach (int n in cuts)
                {
                    var cut = new byte[n]; Array.Copy(full, cut, n);
                    Assert.Throws<DecodeException>(() => ServerMsg.Decode(cut), v.GetProperty("name").GetString() + " cut " + n);
                }
            }
        }

        static IEnumerable<int> MaximumStateTruncationCuts(byte[] bytes)
        {
            // The new 11-key maximum is 247,696 bytes; checking every prefix would repeatedly copy/decode about 30 GB.
            // Keep dense edge coverage, a 1 KiB stride and every top-level State item boundary for only this new vector.
            var state = (ServerMsg.State)ServerMsg.Decode(bytes);
            var cuts = new SortedSet<int>();
            int edge = Math.Min(512, bytes.Length);
            for (int i = 0; i <= edge; i++) cuts.Add(i);
            for (int i = Math.Max(0, bytes.Length - 512); i < bytes.Length; i++) cuts.Add(i);
            for (int i = 0; i < bytes.Length; i += 1024) cuts.Add(i);
            int emptyLength = new ServerMsg.State { Tick = state.Tick, Items = Array.Empty<StateItem>() }.Encode().Length;
            int offset = emptyLength;
            cuts.Add(offset);
            foreach (StateItem item in state.Items)
            {
                int length = new ServerMsg.State { Tick = state.Tick, Items = new[] { item } }.Encode().Length
                    - emptyLength;
                offset += length;
                cuts.Add(offset);
            }
            Assert.AreEqual(bytes.Length, offset, "computed boundaries should cover the entire canonical State frame");
            cuts.Remove(bytes.Length);
            return cuts;
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

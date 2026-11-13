using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-WIRE17-HUD-2b oracle (C# decoder): the Welcome's HUD content block after the weapon table and before the map
    /// (scaling count u8, rows of id u8, ad/ap/bonusHp/bonusDefense f64, dominant u8; term count u8, rows of code u8,
    /// value f64), the regenerated <c>welcome</c> vector carrying the legacy weapon scaling and Wish numbers, and the
    /// <c>welcome_hud_*</c> refusal vectors (docs/backlog/packets/P-WIRE17-HUD-2b.md, "Wire layout" and "Vector names").
    /// </summary>
    public sealed class HudContentProtocolTests
    {
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement; }

        static string SrvHex(string name)
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray()) if (v.GetProperty("name").GetString() == name) return v.GetProperty("hex").GetString();
            throw new KeyNotFoundException(name);
        }

        static WireWeaponScaling S(byte id, double ad, double ap, double hp, double def, bool dominant)
        {
            return new WireWeaponScaling { Id = id, Ad = ad, Ap = ap, BonusHp = hp, BonusDefense = def, Dominant = dominant };
        }

        static WireHudTerm T(byte code, double value) { return new WireHudTerm { Code = code, Value = value }; }

        /// <summary>Legacy weapons.ts:96-124 by wire id: sword, bow, wand, shield, axe, fists.</summary>
        static WireWeaponScaling[] LegacyScaling()
        {
            return new[] {
                S(0, 1.0, 1.0, 0, 0, true), S(1, 1.0, 0, 0, 0, false), S(2, 0.3, 1.0, 0, 0, false),
                S(3, 0, 0.3, 0, 0.4, false), S(4, 1.0, 0, 0.02, 0, false), S(5, 0.6, 0.6, 0, 0, false),
            };
        }

        /// <summary>Legacy abilities.ts:140-167 by HudTerm code, then (P-WIRE17-HUD-2c) fireRoam.ts:2-7, codes 19-22.</summary>
        static readonly double[] LegacyTerms = {
            1250, 450, 8000, 72, 5000, 0.8, 0.7, 1.2, 1500, 300, 200, 30, 2000, 64, 300, 5000, 0.3, 0.3, 1,
            20000, 1000, 50, 0.4,
        };

        static (byte, double, double, double, double, bool)[] Rows(WireWeaponScaling[] s)
        {
            return s.Select(r => (r.Id, r.Ad, r.Ap, r.BonusHp, r.BonusDefense, r.Dominant)).ToArray();
        }

        static (byte, double)[] Rows(WireHudTerm[] t) { return t.Select(r => (r.Code, r.Value)).ToArray(); }

        static ServerMsg.Welcome Small(ServerMsg.Welcome good, WireHudContent hud)
        {
            return new ServerMsg.Welcome { Protocol = good.Protocol, MatchId = good.MatchId, Session = good.Session, Map = good.Map, Hud = hud };
        }

        static byte[] Block((byte id, double[] v, byte dominant)[] scaling, (byte code, double value)[] terms)
        {
            var b = new List<byte> { (byte)scaling.Length };
            foreach (var s in scaling) { b.Add(s.id); foreach (var x in s.v) b.AddRange(BitConverter.GetBytes(x)); b.Add(s.dominant); }
            b.Add((byte)terms.Length);
            foreach (var t in terms) { b.Add(t.code); b.AddRange(BitConverter.GetBytes(t.value)); }
            return b.ToArray();
        }

        [Test]
        public void ConstantsMatchTheBrief()
        {
            Assert.AreEqual(23, WireHudContent.TermCount);
            Assert.AreEqual(23, WireHudContent.MaxTerms);
            Assert.AreEqual(32, WireHudContent.MaxScalingRows);
            Assert.AreEqual(34, WireHudContent.ScalingRowLength);
            Assert.AreEqual(9, WireHudContent.TermRowLength);
            Assert.AreEqual(18, (byte)HudTerm.LastStandFloorHp);
            Assert.AreEqual(8, (byte)HudTerm.TrialExitStunMs);
        }

        [Test]
        public void TheWelcomeVectorCarriesTheLegacyBlock()
        {
            var w = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            Assert.AreEqual(Rows(LegacyScaling()), Rows(w.Hud.Scaling), "weapon scaling rows");
            Assert.AreEqual(LegacyTerms.Select((v, i) => ((byte)i, v)).ToArray(), Rows(w.Hud.Terms), "HUD terms");
            Assert.AreEqual(1250.0, w.Hud.Term(HudTerm.FreezeStunMs));
            Assert.AreEqual(0.02, w.Hud.ScalingOf(4).BonusHp);
            CollectionAssert.AreEqual(Util.FromHex(SrvHex("welcome")), w.Encode(), "byte-exact re-encode");
        }

        [Test]
        public void TheBlockSitsBetweenTheWeaponTableAndTheMap()
        {
            var good = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            // No archetypes (1 byte), the default vision block, no weapons (1 byte): the block starts here.
            int off = 60 + 1 + WireVision.BlockLength + 1;
            byte[] empty = Small(good, new WireHudContent()).Encode();
            Assert.AreEqual(off + 2 + good.Map.EncodedLength, empty.Length, "an empty block is two count bytes");
            Assert.AreEqual(new byte[] { 0, 0 }, empty.Skip(off).Take(2).ToArray());

            var hud = new WireHudContent {
                Scaling = new[] { S(0, 1.0, 1.0, 0, 0, true), S(4, 1.0, 0, 0.02, 0, false) },
                Terms = new[] { T(0, 1250), T(16, 0.3) },
            };
            byte[] block = Block(new[] { ((byte)0, new[] { 1.0, 1.0, 0, 0 }, (byte)1), ((byte)4, new[] { 1.0, 0, 0.02, 0 }, (byte)0) },
                new[] { ((byte)0, 1250.0), ((byte)16, 0.3) });
            byte[] want = empty.Take(off).Concat(block).Concat(empty.Skip(off + 2)).ToArray();
            byte[] got = Small(good, hud).Encode();
            Assert.AreEqual(want, got, "block bytes in place");
            var back = (ServerMsg.Welcome)ServerMsg.Decode(got);
            Assert.AreEqual(Rows(hud.Scaling), Rows(back.Hud.Scaling));
            Assert.AreEqual(Rows(hud.Terms), Rows(back.Hud.Terms));
        }

        [Test]
        public void TheEncoderRefusesABlockTheDecoderWouldRefuse()
        {
            var good = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(SrvHex("welcome")));
            Func<WireHudContent> legacy = () => new WireHudContent { Scaling = LegacyScaling(), Terms = LegacyTerms.Select((v, i) => T((byte)i, v)).ToArray() };
            Func<Action<WireHudContent>, WireHudContent> with = f => { var c = legacy(); f(c); return c; };
            var cases = new (string, WireHudContent)[]
            {
                ("scaling count", with(c => c.Scaling = Enumerable.Range(0, 33).Select(i => S((byte)i, 1, 0, 0, 0, false)).ToArray())),
                ("scaling", with(c => c.Scaling[0].Ad = double.NaN)),
                ("scaling", with(c => c.Scaling[1].Ap = -0.5)),
                ("scaling", with(c => c.Scaling[3].BonusDefense = double.PositiveInfinity)),
                ("scaling", with(c => c.Scaling[2].BonusHp = 2e6)),
                ("scaling order", with(c => c.Scaling[1].Id = 0)),
                ("hud term count", with(c => c.Terms = c.Terms.Concat(new[] { T(18, 1) }).ToArray())),
                ("hud term code", with(c => c.Terms[22].Code = 23)),
                ("hud term", with(c => c.Terms[0].Value = double.NaN)),
                ("hud term", with(c => c.Terms[2].Value = 1e6 + 1)),
                ("hud term order", with(c => { var t = c.Terms[3]; c.Terms[3] = c.Terms[4]; c.Terms[4] = t; })),
                // Order of reasons: scaling before terms, a bad code before a bad value, values before order.
                ("scaling", with(c => { c.Scaling[0].Ap = double.NaN; c.Terms[0].Code = 200; })),
                ("hud term code", with(c => { c.Terms[0].Value = double.NaN; c.Terms[22].Code = 23; })),
                ("hud term", with(c => { var t = c.Terms[0]; c.Terms[0] = c.Terms[1]; c.Terms[1] = t; c.Terms[3].Value = double.PositiveInfinity; })),
            };
            foreach (var (why, bad) in cases)
                Assert.AreEqual(why, Assert.Throws<ArgumentException>(() => Small(good, bad).Encode(), why).Message, why);
            // The edges are valid.
            var edge = with(c => { c.Terms[0].Value = 1e6; c.Terms[1].Value = 0; });
            var back = (ServerMsg.Welcome)ServerMsg.Decode(Small(good, edge).Encode());
            Assert.AreEqual(1e6, back.Hud.Term(HudTerm.FreezeStunMs));
        }

        [Test]
        public void MalformedHudBlocksAreRefusedForTheRustReason()
        {
            var want = new Dictionary<string, string> {
                ["welcome_hud_scaling_count"] = "scaling count", ["welcome_hud_scaling_dominant"] = "scaling dominant",
                ["welcome_hud_scaling_nan"] = "scaling", ["welcome_hud_scaling_negative"] = "scaling",
                ["welcome_hud_scaling_order"] = "scaling order", ["welcome_hud_term_count"] = "hud term count",
                ["welcome_hud_term_code"] = "hud term code", ["welcome_hud_term_infinite"] = "hud term",
                ["welcome_hud_term_over_max"] = "hud term", ["welcome_hud_term_order"] = "hud term order",
                ["welcome_hud_truncated"] = null,
            };
            var seen = new HashSet<string>();
            foreach (var v in Fixture().GetProperty("malformedServer").EnumerateArray())
            {
                string name = v.GetProperty("name").GetString();
                if (!want.TryGetValue(name, out string why)) continue;
                seen.Add(name);
                var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString())), name);
                if (why == null) Assert.AreEqual(DecodeError.Truncated, e.Error, name);
                else Assert.AreEqual(DecodeError.BadField + ": " + why, e.Message, name);
            }
            CollectionAssert.AreEquivalent(want.Keys, seen, "every welcome_hud_* vector is committed");
        }
    }
}

using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-UNITY-DRESS-1 oracle, engine-free half: the client's table from kind code to sprite and from ground variant to
    /// tint is checked against the server's rule file (crates/rh-mapdress/rules/zones.json, edited by another session: a kind or
    /// variant added there without the client fails here). Sprite existence is checked in EditMode (DressedMapEditModeTests).</summary>
    public sealed class DecorationKindsTests
    {
        static JsonElement Rules()
        {
            string path = Path.Combine(Util.RepoRoot(), "crates", "rh-mapdress", "rules", "zones.json");
            Assert.That(File.Exists(path), "rules file missing: " + path);
            return JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { AllowTrailingCommas = true }).RootElement;
        }

        static List<(string name, byte code, bool tall)> RuleKinds()
        {
            var list = new List<(string, byte, bool)>();
            foreach (var k in Rules().GetProperty("kinds").EnumerateObject())
                list.Add((k.Name, k.Value.GetProperty("code").GetByte(), k.Value.TryGetProperty("tall", out var t) && t.GetBoolean()));
            return list;
        }

        static void CollectVariants(JsonElement e, SortedSet<int> into)
        {
            if (e.ValueKind == JsonValueKind.Object)
                foreach (var p in e.EnumerateObject())
                {
                    if (p.Name == "groundVariant") into.Add(p.Value.GetInt32());
                    else CollectVariants(p.Value, into);
                }
            else if (e.ValueKind == JsonValueKind.Array)
                foreach (var i in e.EnumerateArray()) CollectVariants(i, into);
        }

        /// <summary>Rule kinds that already have a sprite of the same name in RegionPropArt (packet table, "existing art").</summary>
        static readonly string[] OwnArt =
        {
            "fire.spire", "fire.crystal", "fire.rocks", "fire.vent",
            "sent.tomb", "sent.cross", "sent.slab", "sent.deadtree", "sent.lantern", "sent.deadgrass",
            "plague.column", "plague.rubble", "plague.tree", "plague.bush", "plague.fern", "plague.mushroom",
            "frost.rock2", "frost.shards", "frost.pine", "frost.pine2", "frost.drift", "frost.rock",
            "holy.pillar", "holy.rock", "holy.palm", "holy.shrub", "holy.flowers", "holy.grass",
        };

        [Test]
        public void TheKindTableHoldsExactlyTheKindsOfTheRuleFile()
        {
            var rules = RuleKinds();
            Assert.That(rules.Count, Is.GreaterThan(40), "the rule file has its kinds");
            var missing = rules.Where(k => !DecorationKinds.TryGet(k.code, out _)).Select(k => k.name + "=" + k.code).ToList();
            Assert.That(missing, Is.Empty, "the client's kind table lacks kinds of crates/rh-mapdress/rules/zones.json: " + string.Join(", ", missing));
            foreach (var k in rules)
            {
                DecorationKinds.TryGet(k.code, out var d);
                Assert.That(d.Name, Is.EqualTo(k.name), "name of code " + k.code);
                Assert.That(d.Code, Is.EqualTo(k.code));
                Assert.That(d.Tall, Is.EqualTo(k.tall), "tall flag of " + k.name);
            }
            Assert.That(DecorationKinds.All.Count, Is.EqualTo(rules.Count), "the table has no kind the rule file lacks");
            Assert.That(DecorationKinds.All.Select(d => d.Code).Distinct().Count(), Is.EqualTo(rules.Count), "codes are unique");
        }

        [Test]
        public void AKindWithItsOwnArtDrawsItAndEveryOtherKindDrawsAnExistingSpriteOfItsOwn()
        {
            Assert.That(DecorationKinds.All.Count, Is.GreaterThan(0), "the table is filled");
            foreach (var d in DecorationKinds.All)
            {
                Assert.That(d.Art, Is.Not.Null.And.Not.Empty, d.Name);
                Assert.That(d.Art, Is.Not.EqualTo(DecorationKinds.Placeholder), d.Name + ": a known kind never draws the placeholder");
                if (OwnArt.Contains(d.Name)) Assert.That(d.Art, Is.EqualTo(d.Name), d.Name + " has art under its own name");
            }
            foreach (var n in OwnArt) Assert.That(DecorationKinds.All.Any(d => d.Name == n), Is.True, n + " is a rule kind");
        }

        [Test]
        public void ArtKeyUsesTheVariantWhereTheArtHasOneAndThePlaceholderForWhatItDoesNotKnow()
        {
            Assert.That(DecorationKinds.ArtKey(35, 0, 0), Is.EqualTo("frost.drift"));
            Assert.That(DecorationKinds.ArtKey(35, 1, 0), Is.EqualTo("frost.drift2"), "variant 1 of the drift is the second drift sprite");
            Assert.That(DecorationKinds.ArtKey(1, 0, 1), Is.EqualTo("fire.spire"));
            Assert.That(DecorationKinds.ArtKey(1, 3, 1), Is.EqualTo("fire.spire"), "art without variants ignores the variant");
            Assert.That(DecorationKinds.ArtKey(99, 0, 0), Is.EqualTo(DecorationKinds.Placeholder), "a code inside 1..100 the table lacks");
            Assert.That(DecorationKinds.ArtKey(100, 0, 1), Is.EqualTo(DecorationKinds.Placeholder));
        }

        [Test]
        public void ALegacyPropDrawsThePlaceholderAndNothingThrows()
        {
            // Flag 2: kind is an index of the generator's catalogue (0..33), not a rule code; the client does not know the catalogue.
            // The server sends none today (decor off); if one arrives it must not throw and must not borrow a rule kind's art.
            foreach (byte kind in new byte[] { 0, 3, 33 })
                foreach (byte flags in new byte[] { 2, 3 })
                    Assert.That(DecorationKinds.ArtKey(kind, 200, flags), Is.EqualTo(DecorationKinds.Placeholder), "legacy kind " + kind + " flags " + flags);
        }

        [Test]
        public void EveryGroundVariantTheRuleFileUsesHasATintInEveryRegion()
        {
            var used = new SortedSet<int>(); CollectVariants(Rules(), used);
            Assert.That(used, Is.SupersetOf(new[] { 1, 2, 3, 4, 5, 6, 7, 8 }), "the shipped rules use the fallback rings 1-2, the landmark bands 3-6, Plague water 7 and mud 8");
            foreach (int v in used)
                for (int region = 1; region <= 5; region++)
                {
                    Assert.That(GroundVariantLook.TryGet(region, (byte)v, out var t), Is.True, "region " + region + " variant " + v + " has no ground look");
                    Assert.That(t.Strength, Is.GreaterThan(0f).And.LessThanOrEqualTo(1f), "region " + region + " variant " + v);
                }
        }

        [Test]
        public void VariantZeroAndAnUnusedVariantHaveNoLookSoTheBaseGroundShows()
        {
            for (int region = 1; region <= 5; region++)
            {
                Assert.That(GroundVariantLook.TryGet(region, 0, out _), Is.False, "variant 0 is the base ground");
                for (byte v = 9; v <= 15; v++) Assert.That(GroundVariantLook.TryGet(region, v, out _), Is.False, "variant " + v + " is unknown");
            }
        }

        [Test]
        public void TheBandsAreToldApartAndWaterReadsBluerThanMud()
        {
            for (int region = 1; region <= 5; region++)
            {
                var seen = new HashSet<(byte, byte, byte, int)>();
                for (byte v = 1; v <= 6; v++)
                {
                    Assert.That(GroundVariantLook.TryGet(region, v, out var t), Is.True, "region " + region + " variant " + v);
                    Assert.That(seen.Add((t.R, t.G, t.B, (int)(t.Strength * 1000))), Is.True, "region " + region + ": variant " + v + " looks like an earlier variant");
                }
            }
            Assert.That(GroundVariantLook.TryGet(3, 7, out var water), Is.True);
            Assert.That(GroundVariantLook.TryGet(3, 8, out var mud), Is.True);
            Assert.That(water.B, Is.GreaterThan(water.R), "Plague water is bluish");
            Assert.That(mud.R, Is.GreaterThan(mud.B), "Plague mud is brown, not blue");
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountFullJsonTests
    {
        static JObject Profile() => JObject.Parse(@"{""profile"":{
          ""name"":""Alice"",""gv"":9007199254740992,""gvLifetime"":9223372036854775807,
          ""gvByMonth"":{""2026-11"":9007199254740992},
          ""stats"":{""runs"":2,""wins"":1,""draws"":0,""deaths"":1,""kills"":3},
          ""cosmetics"":{""owned"":[""skin-crimson"",""future-item""],""equipped"":{""skin"":""skin-crimson"",""future-slot"":""future-item""}},
          ""achievements"":{""first_blood"":1790000000123,""future-achievement"":0},
          ""progress"":{""qualifiedWins"":1,""bountyRuns"":0,""bestRunKills"":3,""winsByFaction"":{""fire"":1,""future-faction"":2},""winsByWeapon"":{""future-weapon"":1}}
        }}");

        [Test]
        public void CompleteProfilePreservesExactInt64MapsAndUnknownFutureIdsWithoutGrantingAnything()
        {
            JObject body = Profile(); body["newEnvelopeField"] = new JObject(); body["profile"]["future"] = new JObject();
            Assert.IsTrue(AccountFullJson.TryProfile(body.ToString(), out var profile));
            Assert.AreEqual("Alice", profile.Name); Assert.AreEqual(9007199254740992L, profile.Gv);
            Assert.AreEqual(long.MaxValue, profile.GvLifetime); Assert.AreEqual(9007199254740992L, profile.GvByMonth["2026-11"]);
            Assert.AreEqual(1790000000123L, profile.Achievements["first_blood"]);
            Assert.AreEqual(0, profile.Achievements["future-achievement"]);
            Assert.AreEqual("future-item", profile.Cosmetics.Equipped["future-slot"]);
            Assert.AreEqual(2, profile.Progress.WinsByFaction["future-faction"]);
            Assert.AreEqual(1, profile.Progress.WinsByWeapon["future-weapon"]);
            Assert.Throws<NotSupportedException>(() => ((IDictionary<string, long>)profile.GvByMonth).Add("2026-12", 4));
            Assert.Throws<NotSupportedException>(() => ((IList<string>)profile.Cosmetics.Owned).Add("unearned"));
        }

        [TestCase("missing-month-map")]
        [TestCase("missing-counter")]
        [TestCase("missing-progress-map")]
        [TestCase("month-shape")]
        [TestCase("month-key")]
        [TestCase("null-stats")]
        [TestCase("owned-number")]
        [TestCase("equipped-number")]
        [TestCase("negative-achievement")]
        [TestCase("float-counter")]
        [TestCase("string-balance")]
        [TestCase("int64-overflow")]
        [TestCase("bad-name")]
        public void MalformedRequiredProfileDataFailsClosed(string mutation)
        {
            JObject root = Profile(); var p = (JObject)root["profile"];
            if (mutation == "missing-month-map") p.Remove("gvByMonth");
            if (mutation == "missing-counter") ((JObject)p["stats"]).Remove("kills");
            if (mutation == "missing-progress-map") ((JObject)p["progress"]).Remove("winsByWeapon");
            if (mutation == "month-shape") p["gvByMonth"] = new JArray();
            if (mutation == "month-key") p["gvByMonth"] = new JObject { ["2026-13"] = 4 };
            if (mutation == "null-stats") p["stats"] = null;
            if (mutation == "owned-number") p["cosmetics"]["owned"] = new JArray(1);
            if (mutation == "equipped-number") p["cosmetics"]["equipped"]["skin"] = 1;
            if (mutation == "negative-achievement") p["achievements"]["future"] = -1;
            if (mutation == "float-counter") p["stats"]["runs"] = 2.5;
            if (mutation == "string-balance") p["gv"] = "10";
            if (mutation == "bad-name") p["name"] = "Bob/../../";
            string json = root.ToString();
            if (mutation == "int64-overflow") json = json.Replace("9007199254740992", "9223372036854775808");
            Assert.IsFalse(AccountFullJson.TryProfile(json, out var rejected)); Assert.IsNull(rejected);
        }

        [Test]
        public void DuplicateRequiredFieldsAndTrailingDocumentsCannotMasqueradeAsOneProfile()
        {
            string original = Profile().ToString();
            string duplicate = original.Replace("\"name\": \"Alice\"", "\"name\":\"Alice\",\"name\":\"Bob\"");
            Assert.AreNotEqual(original, duplicate);
            Assert.IsFalse(AccountFullJson.TryProfile(duplicate, out _));
            Assert.IsFalse(AccountFullJson.TryProfile(original + "{}", out _));
            Assert.IsFalse(AccountFullJson.TryProfile("[]", out _));
        }

        [Test]
        public void MonthlyLeaderboardKeepsLargeRanksAndOptionalOwnedRankDistinctFromPublicRows()
        {
            string json = @"{""month"":""2026-11"",""entries"":[{""name"":""Alice"",""gv"":9007199254740992,""title"":""future-title""}],""months"":[""2026-11""],""you"":{""rank"":9223372036854775807,""gv"":9007199254740992}}";
            Assert.IsTrue(AccountFullJson.TryLeaderboard(json, out var board));
            Assert.AreEqual(long.MaxValue, board.You.Rank); Assert.AreEqual("future-title", board.Entries[0].Title);
            var publicJson = JObject.Parse(json); publicJson.Remove("you");
            Assert.IsTrue(AccountFullJson.TryLeaderboard(publicJson.ToString(), out var publicBoard)); Assert.IsNull(publicBoard.You);
            publicJson["you"] = new JObject { ["rank"] = 0, ["gv"] = 0 };
            Assert.IsFalse(AccountFullJson.TryLeaderboard(publicJson.ToString(), out _));
        }

        [TestCase("{\"month\":\"2026-11\",\"entries\":[],\"months\":null}")]
        [TestCase("{\"month\":\"2026-00\",\"entries\":[],\"months\":[]}")]
        [TestCase("{\"month\":\"2026-11\",\"entries\":[{\"name\":\"Alice\",\"gv\":1.5}],\"months\":[]}")]
        [TestCase("{\"month\":\"2026-11\",\"entries\":[],\"months\":[],\"you\":null}")]
        public void MalformedBoardFactsFailClosed(string json)
        { Assert.IsFalse(AccountFullJson.TryLeaderboard(json, out var board)); Assert.IsNull(board); }

        [Test]
        public void CurrentRustCatalogDecodesEveryPresentationFieldWithoutClientPriceOrEligibilityRules()
        {
            using var stream = typeof(AccountFullJsonTests).Assembly.GetManifestResourceStream("Account.Cosmetics.json");
            using var reader = new StreamReader(stream);
            string source = reader.ReadToEnd(); var raw = JArray.Parse(source);
            Assert.IsTrue(AccountFullJson.TryCosmeticCatalog(source, out var catalog));
            Assert.AreEqual(57, catalog.Count); Assert.AreEqual(raw.Count, catalog.Count);
            for (int i = 0; i < catalog.Count; i++)
            {
                JObject expected = (JObject)raw[i]; var actual = catalog[i];
                Assert.AreEqual((string)expected["id"], actual.Id); Assert.AreEqual((string)expected["slot"], actual.Slot);
                Assert.AreEqual((string)expected["name"], actual.Name); Assert.AreEqual((uint)expected["code"], actual.Code);
                Assert.AreEqual((long?)expected["price"], actual.Price); Assert.AreEqual((uint?)expected["color"], actual.Color);
                Assert.AreEqual((double?)expected["width"], actual.Width); Assert.AreEqual((string)expected["style"], actual.Style);
                Assert.AreEqual((string)expected["text"], actual.Text); Assert.AreEqual((string)expected["target"], actual.Target);
            }
        }

        [Test]
        public void CatalogRejectsDuplicateIdsAndInvalidNumericMetadata()
        {
            string entry = "{\"id\":\"future\",\"slot\":\"future-slot\",\"name\":\"Future\",\"code\":1}";
            Assert.IsFalse(AccountFullJson.TryCosmeticCatalog("[" + entry + "," + entry + "]", out _));
            Assert.IsFalse(AccountFullJson.TryCosmeticCatalog("[" + entry.Replace("\"code\":1", "\"code\":4294967296") + "]", out _));
            Assert.IsTrue(AccountFullJson.TryCosmeticCatalog("[" + entry + "]", out var future)); Assert.AreEqual("future-slot", future[0].Slot);
        }
    }
}

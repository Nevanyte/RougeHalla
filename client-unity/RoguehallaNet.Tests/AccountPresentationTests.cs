using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    public sealed class AccountPresentationTests
    {
        static string Resource(string name)
        { using (var stream = typeof(AccountPresentationTests).Assembly.GetManifestResourceStream("Account." + name + ".json")) using (var reader = new StreamReader(stream)) return reader.ReadToEnd(); }

        [Test]
        public void GeneratedPresentationPreservesEveryAuthoritativeCosmeticAndContainsNoGoalCode()
        {
            string cosmetics = Resource("PresentationCosmetics"), achievements = Resource("PresentationAchievements");
            Assert.IsTrue(JToken.DeepEquals(JToken.Parse(Resource("Cosmetics")), JToken.Parse(cosmetics)));
            Assert.IsTrue(AccountFullJson.TryCosmeticCatalog(cosmetics, out var catalog)); Assert.AreEqual(57, catalog.Count);
            Assert.IsTrue(AccountFullJson.TryAchievementCatalog(achievements, out var badges)); Assert.AreEqual(26, badges.Count);
            var ids = catalog.Select(c => c.Id).ToArray(); Assert.AreEqual(37, catalog.Count(c => c.Price.HasValue));
            foreach (var badge in badges) foreach (var reward in badge.Rewards) CollectionAssert.Contains(ids, reward);
            Assert.AreEqual("First Blood", badges[0].Name); Assert.AreEqual("Kill another player.", badges[0].Description);
            Assert.IsFalse(achievements.Contains("\"goal\""));
            Assert.Throws<NotSupportedException>(() => ((System.Collections.Generic.IList<string>)badges[0].Rewards).Add("unearned"));
            Assert.IsFalse(AccountFullJson.TryAchievementCatalog("[{\"id\":\"a\",\"name\":\"A\",\"desc\":\"A\",\"reward\":[],\"goal\":{}}]", out _));
            Assert.IsFalse(AccountFullJson.TryAchievementCatalog("[{\"id\":\"a\",\"name\":\"A\",\"desc\":\"A\",\"reward\":[42]}]", out _));
        }

        [TestCase(403, "forbidden", AccountApiFailure.Forbidden)]
        [TestCase(400, "bad_request", AccountApiFailure.BadRequest)]
        [TestCase(404, "unknown_cosmetic", AccountApiFailure.UnknownCosmetic)]
        [TestCase(400, "unknown_slot", AccountApiFailure.UnknownSlot)]
        [TestCase(409, "not_for_sale", AccountApiFailure.NotForSale)]
        [TestCase(409, "already_owned", AccountApiFailure.AlreadyOwned)]
        [TestCase(409, "not_owned", AccountApiFailure.NotOwned)]
        [TestCase(400, "slot_mismatch", AccountApiFailure.SlotMismatch)]
        public void ShopErrorsHaveTypedExactStatusAndCode(int status, string code, AccountApiFailure expected)
        {
            Assert.AreEqual(expected, AccountFullJson.DecodeError(status, "{\"error\":\"server text\",\"code\":\"" + code + "\"}").Failure);
            Assert.AreEqual(AccountApiFailure.Unavailable, AccountFullJson.DecodeError(500, "{\"error\":\"server text\",\"code\":\"" + code + "\"}").Failure);
        }

        [Test]
        public void MissingMalformedAndFutureShopErrorsDoNotInventBalancesOrSuccess()
        {
            foreach (string json in new[] { "{}", "bad json", "{\"error\":\"no\",\"code\":\"insufficient_gv\",\"need\":1.5,\"have\":0}", "{\"error\":\"no\",\"code\":\"insufficient_gv\",\"need\":10}" })
            { var error = AccountFullJson.DecodeError(402, json); Assert.AreEqual(AccountApiFailure.Unavailable, error.Failure); Assert.IsNull(error.Need); Assert.IsNull(error.Have); }
            Assert.AreEqual(AccountApiFailure.RateLimited, AccountFullJson.DecodeError(429, "{}").Failure);
            Assert.AreEqual(AccountApiFailure.Unavailable, AccountFullJson.DecodeError(409, "{\"error\":\"future\",\"code\":\"future_code\"}").Failure);
        }
    }
}

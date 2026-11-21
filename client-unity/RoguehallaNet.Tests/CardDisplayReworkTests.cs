using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-AUG-UI-1: hand-written card text carries the Rework numbers (docs/backlog/AUGMENT_ELITE_REWORK.md, Appendix A).</summary>
    public sealed class CardDisplayReworkTests
    {
        // id, substrings the description must contain, substrings it must no longer contain.
        static readonly object[][] Retuned =
        {
            new object[] { "TankEngine", new[] { "1.5", "+350" }, new[] { "+250" } },
            new object[] { "PlantYourFeet", new[] { "+35% range and damage", "1 s" }, new[] { "25%" } },
            new object[] { "SlowBurn", new[] { "15% less per second", "twice as long" }, new[] { "30%" } },
            new object[] { "PocketSand", new[] { "40%", "1.5 s" }, new[] { "30%", "for 1 s" } },
            new object[] { "WishfulThinking", new[] { "1.5%", "full", "20%" }, new[] { "1 s", "30 s" } },
            new object[] { "Overkill", new[] { "260 u" }, new[] { "200 u" } },
            new object[] { "ThirdTimesTheCharm", new[] { "3rd hit", "2.5x" }, new[] { "twice" } },
            new object[] { "SpikedShell", new[] { "20% of the damage" }, new[] { "15%" } },
            new object[] { "Siphon", new[] { "25% of the damage" }, new[] { "20%" } },
            new object[] { "Hemorrhage", new[] { "12% of the hit", "2 s" }, new[] { "10%" } },
            new object[] { "SecondWind", new[] { "below 30% health", "25% of max health", "1.5 s" }, new[] { "25% health", "20%" } },
            new object[] { "Gambler", new[] { "18% chance to deal double", "12% chance to deal half" }, new[] { "15%" } },
            new object[] { "Committed", new[] { "+22%", "15% faster" }, new[] { "+20%" } },
            new object[] { "FistsOfFury", new[] { "+50% attack speed", "twice" }, new[] { "40%" } },
            new object[] { "MachineGun", new[] { "doubled", "55%" }, new[] { "half" } },
            new object[] { "HereComesTheBoom", new[] { "halved", "2.6x", "1.25x" }, new[] { "2.5x" } },
            new object[] { "VampiricPact", new[] { "+18% lifesteal", "no other healing" }, new[] { "15%" } },
            new object[] { "ArcaneOverload", new[] { "1.5", "Wish" }, new[] { "doubled" } },
            new object[] { "GlassCannon", new[] { "+35% damage", "22% max health" }, new[] { "25%" } },
        };

        // Readability / pool-weighting / no-change cards keep their text byte for byte.
        static readonly string[][] Unchanged =
        {
            new[] { "BestOffense", "Your blocks count as hits." },
            new[] { "EyeForAnEye", "Damage you return to attackers applies your on-hit effects." },
            new[] { "RaceToZero", "Damage you deal and take is multiplied by 1 / your health fraction (up to 2.5x)." },
        };

        static CardDisplayCatalog.Entry ById(string id) =>
            CardDisplayCatalog.Snapshot().Single(e => e.Id == id);

        static string Sha(string s) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();

        [TestCaseSource(nameof(Retuned))]
        public void RetunedCardTextCarriesTheReworkNumbers(string id, string[] must, string[] mustNot)
        {
            var text = ById(id).Description;
            foreach (var m in must) StringAssert.Contains(m, text, id + " must mention '" + m + "': " + text);
            foreach (var m in mustNot) Assert.That(text, Does.Not.Contain(m), id + " must drop '" + m + "': " + text);
        }

        [Test]
        public void ArcaneOverloadMentionsTheNewMultiplierTwice()
        {
            var text = ById("ArcaneOverload").Description;
            Assert.That(text.Split(new[] { "1.5" }, StringSplitOptions.None).Length - 1, Is.GreaterThanOrEqualTo(2), text);
        }

        [TestCaseSource(nameof(Unchanged))]
        public void UnchangedCardsKeepTheirText(string id, string text)
        {
            Assert.AreEqual(text, ById(id).Description);
        }

        [Test]
        public void IdOrderAndTitlesAreUnchanged()
        {
            var rows = CardDisplayCatalog.Snapshot();
            Assert.AreEqual(80, rows.Length);
            Assert.AreEqual("9ef361531c6ca14ca7cc2eda01f959b266d4caee6b57975e687dd489d6c9a728",
                Sha(string.Join("\n", rows.Select(r => r.Id + "\u001f" + r.Title))));
        }

        [Test]
        public void EveryOtherCardRowIsUntouched()
        {
            var changed = Retuned.Select(r => (string)r[0]).Concat(Unchanged.Select(u => u[0])).ToHashSet();
            var rest = CardDisplayCatalog.Snapshot().Where(r => !changed.Contains(r.Id))
                .Select(r => string.Join("\u001f", r.Id, r.Title, r.Description, r.Tags));
            Assert.AreEqual(80 - 22, rest.Count());
            Assert.AreEqual("5cc91496a8f7c458fe8e4b7ffb1cad9c652001e3276e7ed807c52b117d56a4d0", Sha(string.Join("\n", rest)));
        }
    }
}

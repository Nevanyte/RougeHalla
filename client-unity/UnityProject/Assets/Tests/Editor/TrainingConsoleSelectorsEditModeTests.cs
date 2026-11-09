using System;
using NUnit.Framework;
using Roguehalla.Net;

namespace Roguehalla.Client.Tests
{
    public sealed class TrainingConsoleSelectorsEditModeTests
    {
        [Test]
        public void MobChoicesMatchThePinnedCatalogOrderAndDisplayNames()
        {
            string[] ids = {
                "emberImp", "cinderHound", "magmaBrute", "flameCaller", "wyrmling", "ashDrake",
                "bailiff", "chainWarden", "inquisitor", "pardoner", "executioner", "gaoler",
                "plagueRat", "bloatfly", "rotMonk", "miasmaWitch", "ratOgre", "poxBehemoth",
                "frostWisp", "iceGolem", "rimeStalker", "frostbowSentry", "glacialWarden", "avalancheTroll",
                "acolyte", "seraphShard", "penitent", "zealot", "bloodSaint", "archon"
            };
            string[] names = {
                "Ember Imp", "Cinder Hound", "Magma Brute", "Flame Caller", "Wyrmling", "Ash Drake",
                "Bailiff", "Chain Warden", "Inquisitor", "Pardoner", "Executioner", "Gaoler",
                "Plague Rat", "Bloatfly", "Rot Monk", "Miasma Witch", "Rat Ogre", "Pox Behemoth",
                "Frost Wisp", "Ice Golem", "Rime Stalker", "Frostbow Sentry", "Glacial Warden", "Avalanche Troll",
                "Acolyte", "Seraph Shard", "Penitent", "Zealot", "Blood Saint", "Archon"
            };
            Array values = Enum.GetValues(typeof(MobTypeId));
            Assert.That(TrainingConsoleSelectors.MobChoices.Count, Is.EqualTo(30));
            Assert.That(values.Length, Is.EqualTo(30));
            for (int i = 0; i < ids.Length; i++)
            {
                var choice = TrainingConsoleSelectors.MobChoices[i];
                Assert.That(choice.Position, Is.EqualTo(i));
                Assert.That(choice.Position, Is.EqualTo(Convert.ToByte(values.GetValue(i))));
                Assert.That(choice.Id, Is.EqualTo(ids[i]));
                Assert.That(choice.Name, Is.EqualTo(names[i]));
            }
        }

        [Test]
        public void InteractiveChoicesUseOnlyThePinnedWhitelistAndExistingCardTitles()
        {
            byte[] indices = { 44, 46, 47, 48, 49, 57, 58, 59, 63, 64, 65, 67, 70, 73 };
            string[] ids = {
                "SlowBurn", "Overkill", "TankEngine", "PocketSand", "Gambler", "ThirdTimesTheCharm",
                "EyeForAnEye", "BestOffense", "PlantYourFeet", "WishfulThinking", "Hemorrhage",
                "SpikedShell", "Siphon", "SecondWind"
            };
            Assert.That(TrainingConsoleSelectors.InteractiveCardIndices.Count, Is.EqualTo(indices.Length));
            for (int i = 0; i < indices.Length; i++)
            {
                byte index = TrainingConsoleSelectors.InteractiveCardIndices[i];
                Assert.That(index, Is.EqualTo(indices[i]));
                Assert.That(CardDisplayCatalog.Get(index).Id, Is.EqualTo(ids[i]));
                Assert.That(CardDisplayCatalog.Title(index), Is.Not.Empty);
            }
        }

        [Test]
        public void CardCopyChoicesMirrorTheSharedConsoleIncludingRemove()
        {
            int[] choices = { 1, 2, 3, 9, 0 };
            Assert.That(TrainingConsoleSelectors.CardCountChoices.Count, Is.EqualTo(choices.Length));
            for (int i = 0; i < choices.Length; i++)
                Assert.That(TrainingConsoleSelectors.CardCountChoices[i], Is.EqualTo(choices[i]));
        }

        [Test]
        public void SafeIntegerParserAcceptsZeroLeadingZerosAndTheExactMaximum()
        {
            AssertParsed("0", 0UL);
            AssertParsed("0009", 9UL);
            AssertParsed("9007199254740991", 9007199254740991UL);
        }

        [Test]
        public void SafeIntegerParserRejectsBlankSignsFractionsJunkAndOverflowWithoutClamping()
        {
            AssertRejected(null);
            AssertRejected("");
            AssertRejected(" ");
            AssertRejected("+1");
            AssertRejected("-1");
            AssertRejected("1.0");
            AssertRejected("1e2");
            AssertRejected("1x");
            AssertRejected("9007199254740992");
            AssertRejected("18446744073709551615");
        }

        static void AssertParsed(string text, ulong expected)
        {
            Assert.That(TrainingConsoleSelectors.TryParseNonnegativeSafeInteger(text, out ulong value), Is.True, text);
            Assert.That(value, Is.EqualTo(expected), text);
        }

        static void AssertRejected(string text)
        {
            Assert.That(TrainingConsoleSelectors.TryParseNonnegativeSafeInteger(text, out ulong value), Is.False, text);
            Assert.That(value, Is.EqualTo(0UL), "Failure must not leak a partial parse.");
        }
    }
}

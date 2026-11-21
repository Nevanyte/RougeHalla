using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-AUG-UI-2 oracle: native card text mirrors the sim's native table, the chest panel names natives, the HUD formats
    /// the owner's readout rows, the first-pick countdown follows the server window (docs/backlog/packets/P-AUG-UI-2.md).</summary>
    public sealed class AugmentUi2Tests
    {
        static string Root { get { return Util.RepoRoot(); } }

        static (string Id, string Title, string Text)[] RustNatives()
        {
            string table = File.ReadAllText(Path.Combine(Root, "crates/rh-sim/src/cards/native/table.rs"));
            var rows = Regex.Matches(table, @"native\(\s*CardId::(\w+),\s*""((?:\\.|[^""\\])*)"",\s*""((?:\\.|[^""\\])*)""\s*,?\s*\)", RegexOptions.Singleline);
            return rows.Cast<Match>().Select(m => (m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value)).ToArray();
        }

        [Test]
        public void EveryNativeCardHasTheSimsNameAndText()
        {
            var natives = RustNatives();
            Assert.AreEqual(14, natives.Length, "table.rs holds the 14 natives");
            string catalog = File.ReadAllText(Path.Combine(Root, "crates/rh-sim/src/cards/catalog.rs"));
            var order = Regex.Match(catalog, @"pub const NATIVE:\s*\[Self;\s*14\]\s*=\s*\[(.*?)\];", RegexOptions.Singleline);
            var ids = Regex.Matches(order.Groups[1].Value, @"Self::(\w+)").Cast<Match>().Select(m => m.Groups[1].Value).ToArray();
            CollectionAssert.AreEqual(ids, natives.Select(n => n.Id).ToArray(), "table order is CardId::NATIVE order");
            for (int i = 0; i < 14; i++)
            {
                var e = CardDisplayCatalog.Get(80 + i);
                Assert.AreEqual(natives[i].Id, e.Id, "id " + (80 + i));
                Assert.AreEqual(natives[i].Title, e.Title, "title " + (80 + i));
                Assert.AreEqual(natives[i].Text, e.Description, "text " + (80 + i));
                Assert.AreNotEqual("Unknown card", e.Title);
            }
            Assert.AreEqual("Marked Man", CardDisplayCatalog.Get(93).Title);
            StringAssert.Contains("minimap", CardDisplayCatalog.Get(93).Description);
        }

        [Test]
        public void TheCatalogKeepsItsEightyRowsAndAnythingPastTheNativesIsUnknown()
        {
            Assert.AreEqual(80, CardDisplayCatalog.Count);
            Assert.AreEqual(80, CardDisplayCatalog.Snapshot().Length);
            Assert.AreEqual("FinalVerdict", CardDisplayCatalog.Get(79).Id);
            Assert.AreEqual("Unknown card", CardDisplayCatalog.Get(94).Title);
        }

        [Test]
        public void TheChestPanelShowsANativeOptionByNameAndLeavesOtherKindsAlone()
        {
            var card = ChestOptionText.Describe(new RewardOptionView { Card = (CardId)85 });
            Assert.AreEqual("AUGMENT", card.Kind);
            Assert.AreEqual("Pathfinder", card.Title);
            Assert.AreEqual(CardDisplayCatalog.Get(85).Description, card.Text);
            for (int id = 80; id <= 93; id++)
                Assert.AreEqual(CardDisplayCatalog.Get(id).Title, ChestOptionText.Describe(new RewardOptionView { Card = (CardId)id }).Title);
            var old = ChestOptionText.Describe(new RewardOptionView { Card = (CardId)44 });
            Assert.AreEqual("Slow Burn", old.Title);
            Assert.AreEqual("AUGMENT", old.Kind);
            var boost = ChestOptionText.Describe(new RewardOptionView { Boost = BoostId.Ap });
            Assert.AreEqual("BOOST", boost.Kind);
            Assert.AreEqual("Permanent bonus for this run.", boost.Text);
        }

        static WireReadout R(byte card, byte kind, double value, double max) { return new WireReadout { Card = card, Kind = kind, Value = value, Max = max }; }

        [Test]
        public void ReadoutRowsBecomeValueOverMaxLinesInWireOrder()
        {
            var lines = NativeReadoutText.Lines(new[]
            {
                R(80, 0, 0.12, 0.3),    // Marksman's Tally: a damage share, shown as percent
                R(81, 1, 40, 250),      // Bastion meter
                R(84, 0, 3, 7),         // Eighth Strike
                R(85, 0, 0.072, 0.24),  // Pathfinder speed share
                R(85, 2, 3, 20),        // Pathfinder collection: 3 of 20 normal mob types
                R(86, 0, 4, 15),        // Hazard Walker stacks
                R(86, 1, 12000, 20000), // ember ms
                R(86, 1, 5000, 20000),  // bog ms
                R(93, 0, 0, 0),         // Marked Man: cap not set yet
            });
            Assert.AreEqual(new byte[] { 80, 81, 84, 85, 85, 86, 86, 86, 93 }, lines.Select(l => l.Card).ToArray());
            StringAssert.Contains("Marksman's Tally", lines[0].Text);
            StringAssert.Contains("12%", lines[0].Text);
            StringAssert.Contains("30%", lines[0].Text);
            Assert.AreEqual(0.4f, lines[0].Fill, 1e-4);
            StringAssert.Contains("Bastion", lines[1].Text);
            StringAssert.Contains("40/250", lines[1].Text.Replace(" ", ""));
            Assert.AreEqual(0.16f, lines[1].Fill, 1e-4);
            StringAssert.Contains("3/7", lines[2].Text.Replace(" ", ""));
            StringAssert.Contains("7.2%", lines[3].Text);
            StringAssert.Contains("24%", lines[3].Text);
            Assert.AreEqual(0, lines[3].Pips);
            StringAssert.Contains("3/20", lines[4].Text.Replace(" ", ""));
            Assert.AreEqual(20, lines[4].Pips);
            Assert.AreEqual(3, lines[4].PipsOn);
            Assert.AreEqual(0.15f, lines[4].Fill, 1e-4);
            Assert.AreEqual(0, lines[1].PipsOn);
            StringAssert.Contains("12/20", lines[6].Text.Replace(" ", ""), "hazard meters read in seconds");
            StringAssert.Contains("ember", lines[6].Text.ToLowerInvariant());
            StringAssert.Contains("5/20", lines[7].Text.Replace(" ", ""));
            StringAssert.Contains("bog", lines[7].Text.ToLowerInvariant());
            Assert.AreEqual(0f, lines[8].Fill, "max 0 gives an empty bar, never NaN");
            StringAssert.Contains("Marked Man", lines[8].Text);
        }

        [Test]
        public void NoRowsGiveNoLinesAndACardOutsideTheNativesIsSkipped()
        {
            Assert.AreEqual(0, NativeReadoutText.Lines(Array.Empty<WireReadout>()).Length);
            Assert.AreEqual(0, NativeReadoutText.Lines(new[] { R(50, 0, 1, 2) }).Length);
        }

        [Test]
        public void FirstPickCountdownShowsForTheKillerAndForOthersUntilTheWindowEnds()
        {
            var mine = new WireFirstPick { Until = 10000, Mine = true };
            var other = new WireFirstPick { Until = 10000, Mine = false };
            Assert.AreEqual("Your first pick 3 s", FirstPickText.Label(mine, 7000));
            Assert.AreEqual("Your first pick 3 s", FirstPickText.Label(mine, 7001), "rounds up like the chest timer");
            Assert.AreEqual("Your first pick 1 s", FirstPickText.Label(mine, 9500));
            Assert.AreEqual("First pick 3 s", FirstPickText.Label(other, 7000));
            Assert.AreEqual("", FirstPickText.Label(mine, 10000), "window over");
            Assert.AreEqual("", FirstPickText.Label(other, 12000), "window over");
            Assert.AreEqual("", FirstPickText.Label(null, 5000), "no window on the chest");
        }

        [Test]
        public void TheSelectorSourcePinFollowsTheCatalogFileAndSelectorsStayInTheCatalog()
        {
            string pins = File.ReadAllText(Path.Combine(Root, "tools/training-console/training-console-source-pins.json"));
            string rel = "client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs";
            var m = Regex.Match(pins, "\"" + Regex.Escape(rel) + "\":\\s*\"([0-9a-f]{64})\"");
            Assert.IsTrue(m.Success);
            string actual = BitConverter.ToString(SHA256.HashData(File.ReadAllBytes(Path.Combine(Root, rel)))).Replace("-", "").ToLowerInvariant();
            Assert.AreEqual(actual, m.Groups[1].Value, "regenerate with python3 -I tools/training-console/generate_training_console_selectors.py");
            Assert.IsTrue(pins.Contains("\"cards\": 80"));
            Assert.IsTrue(pins.Contains("\"interactiveCards\": 14"));
            Assert.AreEqual(14, TrainingConsoleSelectors.InteractiveCardIndices.Count);
            Assert.IsTrue(TrainingConsoleSelectors.InteractiveCardIndices.All(i => i < CardDisplayCatalog.Count));
        }
    }
}

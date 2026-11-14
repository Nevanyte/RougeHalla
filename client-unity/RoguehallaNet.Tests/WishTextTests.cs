using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-WISH-TEXT-1 oracle: in a room whose Welcome HUD block says Frost's Wish is the wall (term 23 = 1), every string that
    /// describes Frost's Wish is the wall's, built from the block's numbers (terms 24-29); under Freeze, or a block without term 23, every
    /// string is what it is today. Legacy (unreleased patch, read with git show): 78dd8bd4 championCombatModel.ts wishRow "frostWall"
    /// (name "Frost Wall", value "<fmt(ms/1000)>s wall · <fmt(range)> range", scaling "No damage scaling"), combatTip.ts effectTip "wall"
    /// (line 1 "Wall: <length> u long for <seconds>" with <c>seconds = num(ms/1000) + " s"</c>, num = one decimal, none when whole; line 2
    /// "Blocks walking and melee swings; shots fly over it"). Vectors: <c>welcome</c> (Freeze) and <c>welcome_frost_wall</c> (Wall), both
    /// carrying terms 0-1 (1250 ms stun, 450) and 24-29 (450, 64, 224, 4000, 24, 8), so a Wall block that still said "stun" would show it here.
    /// </summary>
    public sealed class WishTextTests
    {
        const string TipLine2 = "Blocks walking and melee swings; shots fly over it";

        static WireHudContent Vector(string name)
        {
            var root = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;
            foreach (var v in root.GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return ((ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()))).Hud;
            throw new InvalidOperationException("no server vector " + name);
        }

        static WireHudContent Terms(params (HudTerm code, double value)[] t)
        {
            return new WireHudContent { Terms = t.OrderBy(r => (byte)r.code).Select(r => new WireHudTerm { Code = (byte)r.code, Value = r.value }).ToArray() };
        }

        /// <summary>A hand-made Wall block: the stun terms of an ordinary Welcome, term 23 = 1, and the wall's six numbers.</summary>
        static WireHudContent Wall(double range = 450, double length = 224, double ms = 4000)
        {
            return Terms((HudTerm.FreezeStunMs, 1250), (HudTerm.FreezeRange, 450), (HudTerm.FrostWish, 1), (HudTerm.FrostWallRange, range),
                (HudTerm.FrostWallMinRange, 64), (HudTerm.FrostWallLength, length), (HudTerm.FrostWallMs, ms), (HudTerm.FrostWallCellReach, 24), (HudTerm.FrostWallEndSlack, 8));
        }

        static string All(WireHudContent hud)
        {
            var row = HudContentText.Wish(hud, FactionId.Frost);
            return string.Join("|", row.Name, row.Value, row.Scaling, row.Detail, HudContentText.WishTip(hud, FactionId.Frost), HudContentText.WishName(hud, AbilityId.Freeze));
        }

        // ---- red today: the wall's strings

        [Test]
        public void TheWallRowIsTheLegacyFrostWallRow()
        {
            var row = HudContentText.Wish(Vector("welcome_frost_wall"), FactionId.Frost);
            Assert.That(row.Name, Is.EqualTo("Frost Wall"));
            Assert.That(row.Value, Is.EqualTo("4s wall · 450 range"));       // fmt(4000 / 1000), fmt(450)
            Assert.That(row.Scaling, Is.EqualTo("No damage scaling"));
            Assert.That(row.Detail, Is.EqualTo(""), "the blurb has no delivered source, as for every other Wish");
        }

        [Test]
        public void TheWallRowReadsTheBlocksNumbersNotConstants()
        {
            // fmt keeps two decimals (1.25), the panel's convention; the range prints as sent.
            var row = HudContentText.Wish(Wall(range: 300, ms: 1250), FactionId.Frost);
            Assert.That(row.Value, Is.EqualTo("1.25s wall · 300 range"));
        }

        [Test]
        public void TheWallTipIsTheTwoLegacyLines()
        {
            Assert.That(HudContentText.WishTip(Vector("welcome_frost_wall"), FactionId.Frost), Is.EqualTo("Wall: 224 u long for 4 s\n" + TipLine2));
        }

        [Test]
        public void TheWallTipSecondsUseCombatTipsOneDecimalNotTheRowsTwo()
        {
            // Legacy quirk, pinned: combatTip num() is Math.round(n * 10) / 10 (1.25 -> 1.3, 1.5 -> "1.5", 4 -> "4"); the row above keeps 1.25.
            Assert.That(HudContentText.WishTip(Wall(length: 160, ms: 1250), FactionId.Frost), Is.EqualTo("Wall: 160 u long for 1.3 s\n" + TipLine2));
            Assert.That(HudContentText.WishTip(Wall(ms: 1500), FactionId.Frost), Is.EqualTo("Wall: 224 u long for 1.5 s\n" + TipLine2));
        }

        [Test]
        public void TheWishIsNamedFrostWallWhereTheCardAndCastNameIt()
        {
            Assert.That(HudContentText.WishName(Vector("welcome_frost_wall"), AbilityId.Freeze), Is.EqualTo("Frost Wall"));   // "R · Frost Wall · 1/1 charges", "Casting Frost Wall"
        }

        [Test]
        public void NoStringOfTheWallsWishSaysFreezeOrStun()
        {
            foreach (var hud in new[] { Vector("welcome_frost_wall"), Wall(), Wall(ms: 1250) })
            {
                var all = All(hud);
                StringAssert.DoesNotContain("Freeze", all);
                StringAssert.DoesNotContain("stun", all.ToLowerInvariant());
            }
        }

        [Test]
        public void AWallBlockWithoutTheNumbersNamesTheWallAndInventsNoNumbers()
        {
            // Term 23 says Wall, terms 24-29 are missing (the stun terms are there and must not leak into a wall row).
            var hud = Terms((HudTerm.FreezeStunMs, 1250), (HudTerm.FreezeRange, 450), (HudTerm.FrostWish, 1));
            var row = HudContentText.Wish(hud, FactionId.Frost);
            Assert.That(row.Name, Is.EqualTo("Frost Wall"));
            Assert.That(row.Value + row.Scaling + row.Detail, Is.EqualTo(""));
            Assert.That(HudContentText.WishTip(hud, FactionId.Frost), Is.EqualTo(""));
            Assert.That(HudContentText.WishName(hud, AbilityId.Freeze), Is.EqualTo("Frost Wall"));
        }

        // ---- green today: nothing else moves

        static readonly (FactionId, string, string, string)[] Rows =
        {
            (FactionId.Frost, "Freeze", "1.25s stun · 450 range", "No damage scaling"),
            (FactionId.Plague, "Swarm", "8s hidden · 72 radius", "No damage scaling"),
            (FactionId.Sentenced, "Trial", "5s zone · 20% less dealt", "30% slower · +20% taken · 1.5s exit stun"),
            (FactionId.Fire, "Blaze Step", "30 true DPS · 2s trail", "64–300 blink · fixed damage"),
            (FactionId.Holy, "Last Stand", "5s floor at 1 HP · +30% move", "30% of held damage healed back"),
        };

        [Test]
        public void UnderFreezeEveryWishStringIsTodays()
        {
            var hud = Vector("welcome");
            foreach (var (f, name, value, scaling) in Rows)
            {
                var row = HudContentText.Wish(hud, f);
                Assert.That(new[] { row.Name, row.Value, row.Scaling, row.Detail }, Is.EqualTo(new[] { name, value, scaling, "" }), f.ToString());
                Assert.That(HudContentText.WishTip(hud, f), Is.EqualTo(""), f + " has no extra tooltip lines today");
            }
            foreach (AbilityId a in Enum.GetValues(typeof(AbilityId)))
                Assert.That(HudContentText.WishName(hud, a), Is.EqualTo(a.ToString()), a.ToString());
        }

        [Test]
        public void ABlockWithoutTerm23IsFreezeEvenWithTheWallsNumbersPresent()
        {
            // An older server: no term 23. A block with the numbers but no term 23 must not turn the wall text on.
            var older = Terms((HudTerm.FreezeStunMs, 1250), (HudTerm.FreezeRange, 450), (HudTerm.FrostWallRange, 450), (HudTerm.FrostWallMinRange, 64),
                (HudTerm.FrostWallLength, 224), (HudTerm.FrostWallMs, 4000), (HudTerm.FrostWallCellReach, 24), (HudTerm.FrostWallEndSlack, 8));
            var oldest = Terms((HudTerm.FreezeStunMs, 1250), (HudTerm.FreezeRange, 450));
            foreach (var hud in new[] { older, oldest })
            {
                var row = HudContentText.Wish(hud, FactionId.Frost);
                Assert.That(new[] { row.Name, row.Value, row.Scaling, row.Detail }, Is.EqualTo(new[] { "Freeze", "1.25s stun · 450 range", "No damage scaling", "" }));
                Assert.That(HudContentText.WishTip(hud, FactionId.Frost), Is.EqualTo(""));
                Assert.That(HudContentText.WishName(hud, AbilityId.Freeze), Is.EqualTo("Freeze"));
            }
        }

        [Test]
        public void NoBlockAtAllIsTodaysNameAndNothingElse()
        {
            foreach (var hud in new WireHudContent[] { null, new WireHudContent() })
            {
                var row = HudContentText.Wish(hud, FactionId.Frost);
                Assert.That(new[] { row.Name, row.Value, row.Scaling, row.Detail }, Is.EqualTo(new[] { "Freeze", "", "", "" }));
                Assert.That(HudContentText.WishTip(hud, FactionId.Frost), Is.EqualTo(""));
                Assert.That(HudContentText.WishName(hud, AbilityId.Freeze), Is.EqualTo("Freeze"));
            }
        }

        [Test]
        public void UnderTheWallEveryOtherWishIsUnchanged()
        {
            var hud = Vector("welcome_frost_wall");
            foreach (var (f, name, value, scaling) in Rows.Where(r => r.Item1 != FactionId.Frost))
            {
                var row = HudContentText.Wish(hud, f);
                Assert.That(new[] { row.Name, row.Value, row.Scaling, row.Detail }, Is.EqualTo(new[] { name, value, scaling, "" }), f.ToString());
                Assert.That(HudContentText.WishTip(hud, f), Is.EqualTo(""), f.ToString());
            }
            foreach (var a in new[] { AbilityId.Swarm, AbilityId.Trial, AbilityId.Blaze, AbilityId.LastStand })
                Assert.That(HudContentText.WishName(hud, a), Is.EqualTo(a.ToString()), a.ToString());
        }
    }
}

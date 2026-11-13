using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-HUD-BUILD-3 oracle: the champion panel and slot texts that need the Welcome HUD block and owner panel codes 23-27,
    /// read from the committed v17 golden vectors (<c>welcome</c>, <c>state_build_summary_panel_tooltip</c>). Each expected string is the
    /// legacy template with its file:line, the numbers worked by hand from the vector values. fmt (championCombatModel.ts:74) is
    /// Math.round(n * 100) / 100 printed without trailing zeros; buildModel.ts:196 <c>scale</c> prints one decimal, two when the second matters.
    /// </summary>
    public sealed class HudContentTextTests
    {
        static JsonElement Fixture() { return JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement; }

        static byte[] Server(string name)
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return Util.FromHex(v.GetProperty("hex").GetString());
            throw new InvalidOperationException("no server vector " + name);
        }

        /// <summary>The Welcome vector's HUD block: scaling rows by weapon (weapons.ts:96-124) and terms 0-22 (abilities.ts:140-167, fireRoam.ts).</summary>
        static WireHudContent Hud() { return ((ServerMsg.Welcome)ServerMsg.Decode(Server("welcome"))).Hud; }

        /// <summary>The tooltip vector's owner panel: codes 0-9 of the worked Fire owner (charge 250, not armed), 23 = 0.125, 24 = 54.8, 25 = 2.5,
        /// 26 = 3.6364, 27 = 12.1212.</summary>
        static WireBuildSummary Tooltip() { return ((BuildSummaryState)((ServerMsg.State)ServerMsg.Decode(Server("state_build_summary_panel_tooltip"))).Items[0]).Value; }

        static WireBuildSummary Panel(params (byte code, int quanta)[] rows)
        {
            return new WireBuildSummary { Panel = rows.OrderBy(r => r.code).Select(r => new WirePanelValue { Code = r.code, Value = r.quanta }).ToArray() };
        }

        static WireHudContent Terms(params (byte code, double value)[] t)
        {
            return new WireHudContent { Terms = t.OrderBy(r => r.code).Select(r => new WireHudTerm { Code = r.code, Value = r.value }).ToArray() };
        }

        static WireHudContent Row(byte id, double ad, double ap, double hp, double def, bool dominant)
        {
            return new WireHudContent { Scaling = new[] { new WireWeaponScaling { Id = id, Ad = ad, Ap = ap, BonusHp = hp, BonusDefense = def, Dominant = dominant } } };
        }

        // ---- the weapon slot's line: buildModel.ts:204-213 weaponScalingText (drawn at weaponBar.ts:167)

        [TestCase(WeaponId.Sword, "Offense 1.0 or SO 1.0 (the higher)")]   // dominant, tie keeps order ad, ap; scale(1) = "1.0"
        [TestCase(WeaponId.Bow, "Offense 1.0")]
        [TestCase(WeaponId.Wand, "SO 1.0 + Offense 0.3")]                 // biggest first: ap 1.0 before ad 0.3
        [TestCase(WeaponId.Shield, "bonus Defense/SD 0.4 + SO 0.3")]      // def 0.4 before ap 0.3
        [TestCase(WeaponId.Axe, "Offense 1.0 + bonus HP 0.02")]           // scale(0.02) = "0.02" (two decimals when the second matters)
        [TestCase(WeaponId.Fists, "Offense 0.6 + SO 0.6")]
        public void TheSlotLineIsTheLegacyScalingTextOfTheWelcomeRow(WeaponId weapon, string expected)
        {
            Assert.That(HudContentText.SlotScaling(Hud(), weapon), Is.EqualTo(expected));
        }

        [Test]
        public void TheSlotLineHandlesTheOtherNumberShapesAndNoScaling()
        {
            // buildModel.ts:200 doc example "SO 1.2 + Offense 0.3"; 1.25 needs two decimals; 0.1 one.
            Assert.That(HudContentText.SlotScaling(Row(2, 0.3, 1.2, 0, 0, false), WeaponId.Wand), Is.EqualTo("SO 1.2 + Offense 0.3"));
            Assert.That(HudContentText.SlotScaling(Row(1, 1.25, 0.1, 0, 0, false), WeaponId.Bow), Is.EqualTo("Offense 1.25 + SO 0.1"));
            // :207 "No scaling" when no term is positive.
            Assert.That(HudContentText.SlotScaling(Row(1, 0, 0, 0, 0, false), WeaponId.Bow), Is.EqualTo("No scaling"));
        }

        [Test]
        public void TheSlotTipIsTheNameAndTheScalesWithLine()
        {
            // buildModel.ts:223-224 lines = [name, `Scales with ${weaponScalingText}`]; the tag and hit-type lines have no source.
            Assert.That(HudContentText.SlotTip(Hud(), WeaponId.Wand), Is.EqualTo("Wand\nScales with SO 1.0 + Offense 0.3"));
            Assert.That(HudContentText.SlotTip(null, WeaponId.Wand), Is.EqualTo("Wand"));
        }

        // ---- the auto row's line: championCombatModel.ts:119-122 (fixed order, fmt, " or " when dominant)

        [TestCase(WeaponId.Sword, "1× Offense or 1× SO")]
        [TestCase(WeaponId.Bow, "1× Offense")]
        [TestCase(WeaponId.Wand, "0.3× Offense + 1× SO")]
        [TestCase(WeaponId.Shield, "0.3× SO + 0.4× bonus defense")]
        [TestCase(WeaponId.Axe, "1× Offense + 0.02× bonus HP")]
        [TestCase(WeaponId.Fists, "0.6× Offense + 0.6× SO")]
        public void TheAutoRowLineKeepsTheFixedOrderAndTheFmtNumbers(WeaponId weapon, string expected)
        {
            Assert.That(HudContentText.AutoScaling(Hud(), weapon), Is.EqualTo(expected));
        }

        [Test]
        public void AnEmptyRowIsNoneAndAMissingRowIsBlank()
        {
            Assert.That(HudContentText.AutoScaling(Row(1, 0, 0, 0, 0, false), WeaponId.Bow), Is.EqualTo("none"));   // :122 `|| "none"`
            Assert.That(HudContentText.AutoScaling(Row(4, 1, 0, 0.02, 0, false), WeaponId.Wand), Is.EqualTo(""), "no row for the wand");
            foreach (var hud in new WireHudContent[] { null, new WireHudContent() })
            {
                Assert.That(HudContentText.AutoScaling(hud, WeaponId.Wand), Is.EqualTo(""));
                Assert.That(HudContentText.SlotScaling(hud, WeaponId.Wand), Is.EqualTo(""));
            }
            Assert.That(HudContentText.SlotScaling(Row(4, 1, 0, 0.02, 0, false), WeaponId.Wand), Is.EqualTo(""));
        }

        // ---- the Wish row: championCombatModel.ts:217-228 wishRow, terms of the welcome vector

        [TestCase(FactionId.Frost, "Freeze", "1.25s stun · 450 range", "No damage scaling")]                    // :219 terms 0, 1 = 1250 ms, 450
        [TestCase(FactionId.Plague, "Swarm", "8s hidden · 72 radius", "No damage scaling")]                      // :220 terms 2, 3 = 8000 ms, 72 (radius printed raw)
        [TestCase(FactionId.Sentenced, "Trial", "5s zone · 20% less dealt", "30% slower · +20% taken · 1.5s exit stun")] // :221 terms 4-8: 5000, 0.8, 0.7, 1.2, 1500
        [TestCase(FactionId.Fire, "Blaze Step", "30 true DPS · 2s trail", "64–300 blink · fixed damage")]         // :222 terms 11-14: 30, 2000, 64, 300 (en dash)
        [TestCase(FactionId.Holy, "Last Stand", "5s floor at 1 HP · +30% move", "30% of held damage healed back")] // :223 terms 15-17: 5000, 0.3, 0.3
        public void TheWishRowIsTheLegacyNumbersOfTheFactionsWish(FactionId faction, string name, string value, string scaling)
        {
            var row = HudContentText.Wish(Hud(), faction);
            Assert.That(row.Name, Is.EqualTo(name));
            Assert.That(row.Value, Is.EqualTo(value));
            Assert.That(row.Scaling, Is.EqualTo(scaling));
            Assert.That(row.Detail, Is.EqualTo(""), "the ability blurb is static prose with no delivered source");
        }

        [Test]
        public void ATermThatIsMissingBlanksOnlyTheFragmentThatNeedsIt()
        {
            // Blaze: the value needs terms 11, 12; the scaling needs 13, 14. Codes are read by code, not by position (only 11 and 12 here).
            var half = HudContentText.Wish(Terms((11, 30), (12, 2000)), FactionId.Fire);
            Assert.That(half.Name, Is.EqualTo("Blaze Step"));
            Assert.That(half.Value, Is.EqualTo("30 true DPS · 2s trail"));
            Assert.That(half.Scaling, Is.EqualTo(""));
            // Freeze with only the range: no value, so no "No damage scaling" either; never "0s stun".
            var one = HudContentText.Wish(Terms((1, 450)), FactionId.Frost);
            Assert.That(one.Name, Is.EqualTo("Freeze"));
            Assert.That(one.Value + one.Scaling, Is.EqualTo(""));
            foreach (var hud in new WireHudContent[] { null, new WireHudContent() })
                foreach (FactionId f in Enum.GetValues(typeof(FactionId)))
                {
                    var row = HudContentText.Wish(hud, f);
                    Assert.That(row.Name, Is.Not.EqualTo(""), f.ToString());
                    Assert.That(row.Value + row.Scaling, Is.EqualTo(""), f.ToString());
                }
        }

        // ---- the Fire roam sentence: championCombatModel.ts:114-116

        const string RoamTail = " out of combat, the next landed basic attack adds ";
        const string RoamEnd = "). Incoming damage resets partial charge but does not cancel an already armed burst; Defense mitigates the burst.";

        [Test]
        public void ChargingReadsTheChargeTheSpeedPercentAndTheBurst()
        {
            // Vector: code 8 = 250 (charge), 9 = 0, 23 = 0.125, 24 = 54.8; terms 19-22 = 20000, 1000, 50, 0.4.
            // :115 "250/1000 charged"; :116 (0.125 x 100 = 12.5)% move speed; after 20 s; adds 54.8 physical (50 + 0.4× Offense).
            Assert.That(HudContentText.FireRoam(Tooltip(), Hud(), FactionId.Fire), Is.EqualTo(
                "Fire Roam is 250/1000 charged (12.5% move speed); after 20 s" + RoamTail + "54.8 physical (50 + 0.4× Offense" + RoamEnd));
        }

        [Test]
        public void FullyChargedAndArmedReadsArmedWithTheCapSpeed()
        {
            // charge 1000, armed, 23 = 0.5 (fireRoam.ts:3 cap 1.5 -> 50%), burst 60.
            var panel = Panel((8, 10000000), (9, 10000), (23, 5000), (24, 600000));
            Assert.That(HudContentText.FireRoam(panel, Hud(), FactionId.Fire), Is.EqualTo(
                "Fire Roam is armed (50% move speed); after 20 s" + RoamTail + "60 physical (50 + 0.4× Offense" + RoamEnd));
        }

        [Test]
        public void ArmedRightAfterAResetReadsZeroPercent()
        {
            // Legacy quirk (fireRoam.ts server resetCharge zeroes roamCharge, keeps roamReady): "armed" with (0% move speed). Pinned, flagged in the brief.
            var panel = Panel((8, 0), (9, 10000), (23, 0), (24, 500000));
            Assert.That(HudContentText.FireRoam(panel, Hud(), FactionId.Fire), Is.EqualTo(
                "Fire Roam is armed (0% move speed); after 20 s" + RoamTail + "50 physical (50 + 0.4× Offense" + RoamEnd));
        }

        [Test]
        public void OtherFactionsShowNoRoamFragment()
        {
            foreach (var f in new[] { FactionId.Sentenced, FactionId.Plague, FactionId.Frost, FactionId.Holy })
                Assert.That(HudContentText.FireRoam(Tooltip(), Hud(), f), Is.EqualTo(""), f.ToString());
        }

        [Test]
        public void AMissingPanelCodeOrTermLeavesTheRoamBlankNeverZero()
        {
            var good = Tooltip();
            Assert.That(HudContentText.FireRoam(null, Hud(), FactionId.Fire), Is.EqualTo(""));
            Assert.That(HudContentText.FireRoam(good, null, FactionId.Fire), Is.EqualTo(""));
            Assert.That(HudContentText.FireRoam(good, new WireHudContent(), FactionId.Fire), Is.EqualTo(""));
            foreach (byte missing in new byte[] { 8, 9, 23, 24 })
            {
                var cut = new WireBuildSummary { Panel = good.Panel.Where(p => p.Code != missing).ToArray() };
                Assert.That(HudContentText.FireRoam(cut, Hud(), FactionId.Fire), Is.EqualTo(""), "panel code " + missing);
            }
            var hud = Hud();
            foreach (byte missing in new byte[] { 19, 20, 21, 22 })
            {
                var cut = new WireHudContent { Scaling = hud.Scaling, Terms = hud.Terms.Where(t => t.Code != missing).ToArray() };
                Assert.That(HudContentText.FireRoam(good, cut, FactionId.Fire), Is.EqualTo(""), "term " + missing);
            }
        }

        // ---- the auto row's tooltip: championCombatModel.ts:129-136

        const string Parts = "Raw damage per hit before target mitigation: 1.82 physical, 47.37 magic, 0 true.";     // :129 codes 0-2 (existing HUD-2 text)
        const string Excludes = "This raw packet excludes target defenses, outgoing damage bonuses, conditional effects, critical hits, Plant Your Feet, and player-versus-player scaling.";   // :132

        [Test]
        public void TheWholeTooltipOfTheWorkedFireOwner()
        {
            // :130 asMilli 1250 -> fmt(1.25) "1.25×"; :131 scaling (0.3× Offense + 1× SO) adds fmt(3.6364) 3.64 physical and fmt(12.1212) 12.12 magic
            // before the 2.5× hit multiplier (codes 26, 27, 25).
            string expected = Parts
                + " Attack rate uses your current attack-speed mirror (1.25×) and this weapon's interval."
                + " Weapon scaling (0.3× Offense + 1× SO) adds 3.64 physical and 12.12 magic before the 2.5× hit multiplier. "
                + Excludes
                + " " + HudContentText.FireRoam(Tooltip(), Hud(), FactionId.Fire);
            Assert.That(HudContentText.AutoTooltip(Tooltip(), Hud(), FactionId.Fire, WeaponId.Wand, 1250), Is.EqualTo(expected));
            Assert.That(expected, Does.Contain("(12.5% move speed)"), "the roam sentence is the one pinned above");
        }

        [Test]
        public void ASentenceWhoseNumbersAreMissingIsLeftOutAndTheFixedOneStays()
        {
            // Non-Fire, no attack-speed mirror: parts, scaling, excludes; no roam.
            string noMirror = Parts + " Weapon scaling (0.3× Offense + 1× SO) adds 3.64 physical and 12.12 magic before the 2.5× hit multiplier. " + Excludes;
            Assert.That(HudContentText.AutoTooltip(Tooltip(), Hud(), FactionId.Holy, WeaponId.Wand, null), Is.EqualTo(noMirror));
            // No HUD block: the scaling sentence needs its terms.
            Assert.That(HudContentText.AutoTooltip(Tooltip(), null, FactionId.Holy, WeaponId.Wand, null), Is.EqualTo(Parts + " " + Excludes));
            // Nothing delivered at all.
            Assert.That(HudContentText.AutoTooltip(null, null, FactionId.Holy, WeaponId.Wand, null), Is.EqualTo(Excludes));
            // A panel without codes 25-27 has no scaling sentence even with the block.
            var cut = new WireBuildSummary { Panel = Tooltip().Panel.Where(p => p.Code < 25).ToArray() };
            Assert.That(HudContentText.AutoTooltip(cut, Hud(), FactionId.Holy, WeaponId.Wand, null), Is.EqualTo(Parts + " " + Excludes));
        }
    }
}

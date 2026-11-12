using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>The bottom-left champion panel's auto and faction passive rows from the owner's panel values, pinned to legacy
    /// (packages/client/src/ui/championCombatModel.ts: auto :98-113,:117-128; Fire :144-155; Sentenced :157-175; Plague :177-194;
    /// Frost :196-203; Holy :205-214; fmt :74; visibility championCombatHud.ts :72). Values arrive as integers of 1e-4
    /// (<see cref="Hud.Quantum"/>); legacy's fmt prints two decimals, half up, trailing zeros dropped, and a percent
    /// (value x 100) therefore prints exactly. The Wish row and every number not among panel codes 0-22 are not pinned.</summary>
    public sealed class ChampionPanelTextTests
    {
        const byte HitPhysical = 0, HitMagic = 1, HitTrue = 2, Aps = 3, BurnDps = 4, BurnSo = 5, BurnOffense = 6, DotMult = 7,
            RoamCharge = 8, RoamArmed = 9, MarkPulse = 10, MarkKill = 11, DiseaseDps = 12, CorpseStacks = 13, ZombieHp = 14,
            ZombieMaxHp = 15, ChillSlow = 16, ChillMove = 17, GuardBonus = 18, GuardActive = 19, HolySteal = 20, HolyCamps = 21,
            HolyLeech = 22;

        static WireBuildSummary Panel(params (byte code, double value)[] values) => new WireBuildSummary
        {
            Panel = values.OrderBy(v => v.code)
                .Select(v => new WirePanelValue { Code = v.code, Value = (int)Math.Round(v.value / Hud.Quantum) }).ToArray(),
        };

        static (byte, double)[] Auto = { (HitPhysical, 1.8182), (HitMagic, 47.3697), (HitTrue, 0), (Aps, 1.98) };

        static ChampionRows Rows(FactionId f, params (byte, double)[] faction) =>
            ChampionPanelText.Rows(Panel(Auto.Concat(faction).ToArray()), f, WeaponId.Wand);

        [Test]
        public void VisibleOnlyWhileAliveAndTheRunIsActiveOrTraining()
        {
            Assert.That(ChampionPanelText.Visible(true, true, false), Is.True);
            Assert.That(ChampionPanelText.Visible(true, false, true), Is.True);
            Assert.That(ChampionPanelText.Visible(true, false, false), Is.False);
            Assert.That(ChampionPanelText.Visible(false, true, true), Is.False);
        }

        [Test]
        public void AutoRowIsTheTotalPerHitAndAttacksPerSecondWithThePartsInTheDetail()
        {
            // The v17 vector state_build_summary_panel: 18182 / 473697 / 0 / 19800 quanta.
            var auto = Rows(FactionId.Fire).Auto;
            Assert.That(auto.Name, Is.EqualTo("Wand hit"));
            Assert.That(auto.Value, Is.EqualTo("49.19 / hit · 1.98/s"));
            Assert.That(auto.Detail, Is.EqualTo("Raw damage per hit before target mitigation: 1.82 physical, 47.37 magic, 0 true."));
            // Weapon scaling terms are not on the wire yet (P-WIRE17-HUD-2b): the scaling line is empty, never invented.
            Assert.That(auto.Scaling, Is.EqualTo(""));
        }

        [Test]
        public void AutoTotalIsTheSumOfTheUnroundedPartsAndAZeroPartIsStillPrinted()
        {
            // 1.404 x 3 = 4.212 -> "4.21" (summing the displayed 1.4 would give 4.2); legacy rounds the total, not the parts.
            var rows = ChampionPanelText.Rows(Panel((HitPhysical, 1.404), (HitMagic, 1.404), (HitTrue, 1.404), (Aps, 1)), FactionId.Holy, WeaponId.Sword);
            Assert.That(rows.Auto.Value, Is.EqualTo("4.21 / hit · 1/s"));
            Assert.That(rows.Auto.Name, Is.EqualTo("Sword hit"));
            var zero = ChampionPanelText.Rows(Panel((HitPhysical, 20), (HitMagic, 0), (HitTrue, 0), (Aps, 0.5)), FactionId.Holy, WeaponId.Fists);
            Assert.That(zero.Auto.Value, Is.EqualTo("20 / hit · 0.5/s"));
            Assert.That(zero.Auto.Detail, Does.EndWith("20 physical, 0 magic, 0 true."));
        }

        [Test]
        public void AnAbsentAutoCodeIsNotShownNeverAZero()
        {
            var noRate = ChampionPanelText.Rows(Panel((HitPhysical, 3), (HitMagic, 2), (HitTrue, 1)), FactionId.Frost, WeaponId.Bow);
            Assert.That(noRate.Auto.Value, Is.EqualTo("6 / hit"));
            var noPart = ChampionPanelText.Rows(Panel((HitPhysical, 3), (HitTrue, 1), (Aps, 2)), FactionId.Frost, WeaponId.Bow);
            Assert.That(noPart.Auto.Value, Is.EqualTo("—"));
            Assert.That(noPart.Auto.Detail, Is.EqualTo(""));
        }

        [Test]
        public void FirePassiveIsDragonslayerBurnWithItsRatiosAndDotMultiplier()
        {
            var rows = Rows(FactionId.Fire, (BurnDps, 64.375), (BurnSo, 0.6), (BurnOffense, 0.5), (DotMult, 1.25), (RoamCharge, 250), (RoamArmed, 0));
            Assert.That(rows.Passive.Name, Is.EqualTo("Dragonslayer"));
            Assert.That(rows.Passive.Value, Is.EqualTo("64.38 magic/s"));
            Assert.That(rows.Passive.Scaling, Is.EqualTo("SO adds 0.6, Offense 0.5 magic DPS/point · DoT ×1.25"));
        }

        [Test]
        public void FireRoamIsArmedOrNOfMChargedAndNeverPrintsTheMoveSpeedPercent()
        {
            // Legacy's "(X% move speed)" comes from fireRoamSpeedMult, a content constant not on the wire: left out, listed in the brief.
            Assert.That(Rows(FactionId.Fire, (RoamCharge, 250), (RoamArmed, 0)).Roam, Is.EqualTo("Fire Roam is 250/1000 charged"));
            Assert.That(Rows(FactionId.Fire, (RoamCharge, 2.5), (RoamArmed, 0)).Roam, Is.EqualTo("Fire Roam is 2.5/1000 charged"));
            Assert.That(Rows(FactionId.Fire, (RoamCharge, 1000), (RoamArmed, 1)).Roam, Is.EqualTo("Fire Roam is armed"));
            Assert.That(Rows(FactionId.Fire, (RoamCharge, 1100), (RoamArmed, 0)).Roam, Is.EqualTo("Fire Roam is 1000/1000 charged"));
            Assert.That(Rows(FactionId.Fire).Roam, Is.EqualTo(""));
            Assert.That(Rows(FactionId.Holy, (RoamCharge, 250)).Roam, Is.EqualTo(""));
        }

        [Test]
        public void SentencedPassiveIsTheMarkPulseAsAPercentOfTargetHealthAndTheKillStackShare()
        {
            var passive = Rows(FactionId.Sentenced, (MarkPulse, 0.0216), (MarkKill, 0.0135)).Passive;
            Assert.That(passive.Name, Is.EqualTo("Sentence"));
            Assert.That(passive.Value, Is.EqualTo("2.16% target HP / hit"));
            Assert.That(passive.Scaling, Is.EqualTo("+1.35%/kill stack · attack speed"));
        }

        [Test]
        public void PlaguePassiveShowsTheZombieOnlyWhenBothHealthCodesArePresent()
        {
            var alive = Rows(FactionId.Plague, (DiseaseDps, 62.4), (CorpseStacks, 3), (ZombieHp, 412.5), (ZombieMaxHp, 600)).Passive;
            Assert.That(alive.Name, Is.EqualTo("Rat King"));
            Assert.That(alive.Value, Is.EqualTo("62.4 magic/s"));
            Assert.That(alive.Scaling, Is.EqualTo("Zombie 412.5/600 HP · 3 bodies"));
            Assert.That(Rows(FactionId.Plague, (DiseaseDps, 62.4), (CorpseStacks, 1), (ZombieHp, 80), (ZombieMaxHp, 80)).Passive.Scaling,
                Is.EqualTo("Zombie 80/80 HP · 1 body"));
            Assert.That(Rows(FactionId.Plague, (DiseaseDps, 62.4), (CorpseStacks, 2)).Passive.Scaling,
                Is.EqualTo("Zombie fallen · walk over a body to revive"));
            Assert.That(Rows(FactionId.Plague, (DiseaseDps, 62.4), (CorpseStacks, 0)).Passive.Scaling,
                Is.EqualTo("Walk over a body: raise zombie"));
            Assert.That(Rows(FactionId.Plague, (DiseaseDps, 62.4)).Passive.Scaling, Is.EqualTo(""));
        }

        [Test]
        public void FrostPassiveIsTheSlowsAndTheFrozenJusticeFlag()
        {
            var idle = Rows(FactionId.Frost, (ChillSlow, 0.32), (ChillMove, 0.3), (GuardBonus, 25), (GuardActive, 0)).Passive;
            Assert.That(idle.Name, Is.EqualTo("Ice wall"));
            Assert.That(idle.Value, Is.EqualTo("32% AS · 30% MS slow"));
            Assert.That(idle.Scaling, Is.EqualTo("Frozen Justice: +25 Defense/SD · elite fights"));
            var active = Rows(FactionId.Frost, (ChillSlow, 0.355), (ChillMove, 0.3), (GuardBonus, 25), (GuardActive, 1)).Passive;
            Assert.That(active.Value, Is.EqualTo("35.5% AS · 30% MS slow"));
            Assert.That(active.Scaling, Is.EqualTo("Frozen Justice: +25 Defense/SD · ACTIVE"));
        }

        [Test]
        public void HolyPassiveIsLifeStealWithCampClearsAndEarnedLeech()
        {
            var fresh = Rows(FactionId.Holy, (HolySteal, 0.07), (HolyCamps, 0), (HolyLeech, 0)).Passive;
            Assert.That(fresh.Name, Is.EqualTo("Radiant"));
            Assert.That(fresh.Value, Is.EqualTo("7% life steal"));
            Assert.That(fresh.Scaling, Is.EqualTo("0 camps · +0% earned leech"));
            var farmed = Rows(FactionId.Holy, (HolySteal, 0.1325), (HolyCamps, 6), (HolyLeech, 0.03)).Passive;
            Assert.That(farmed.Value, Is.EqualTo("13.25% life steal"));
            Assert.That(farmed.Scaling, Is.EqualTo("6 camps · +3% earned leech"));
            // Legacy never pluralises: one clear reads "1 camps" (championCombatModel.ts:212). Pinned as legacy.
            Assert.That(Rows(FactionId.Holy, (HolySteal, 0.08), (HolyCamps, 1), (HolyLeech, 0.005)).Passive.Scaling, Is.EqualTo("1 camps · +0.5% earned leech"));
        }

        [Test]
        public void AnAbsentPrimaryCodeIsNotShownAndAnUnknownCodeIsSkipped()
        {
            // No burn value: the value is the placeholder, not "0 magic/s"; the scaling needs codes 5, 6 and 7 and stays empty.
            var noBurn = Rows(FactionId.Fire, (DotMult, 1.25));
            Assert.That(noBurn.Passive.Value, Is.EqualTo("—"));
            Assert.That(noBurn.Passive.Scaling, Is.EqualTo(""));
            Assert.That(noBurn.Passive.Name, Is.EqualTo("Dragonslayer"));
            // Codes 23 and above are a newer server's: skipped, the rows read as without them.
            var withUnknown = Panel(Auto.Concat(new (byte, double)[] { (MarkPulse, 0.0216), (MarkKill, 0.0135), (23, 5), (200, 9) }).ToArray());
            Assert.That(ChampionPanelText.Rows(withUnknown, FactionId.Sentenced, WeaponId.Wand).Passive.Value, Is.EqualTo("2.16% target HP / hit"));
            Assert.That(ChampionPanelText.Rows(withUnknown, FactionId.Sentenced, WeaponId.Wand).Auto.Value, Is.EqualTo("49.19 / hit · 1.98/s"));
        }

        [Test]
        public void ANullSummaryOrAnEmptyPanelGivesTheEmptyState()
        {
            foreach (var summary in new[] { null, new WireBuildSummary() })
            {
                var rows = ChampionPanelText.Rows(summary, FactionId.Frost, WeaponId.Axe);
                Assert.That(rows.Auto.Name, Is.EqualTo("Axe hit"));
                Assert.That(rows.Auto.Value, Is.EqualTo("—"));
                Assert.That(rows.Passive.Name, Is.EqualTo("Ice wall"));
                Assert.That(rows.Passive.Value, Is.EqualTo("—"));
                Assert.That(rows.Auto.Scaling + rows.Auto.Detail + rows.Passive.Scaling + rows.Roam, Is.EqualTo(""));
            }
        }
    }
}

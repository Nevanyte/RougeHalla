using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>The GAINED strip and the mob-bonus row from the owner's build summary, pinned to legacy
    /// (packages/client/src/ui/buildModel.ts buildGains :154-181, num :47-50, signed :184; cell order HUD_GAIN_IDS
    /// buildModel.ts:14; mobStatsHud.ts :41-47, :56-58; shared/mobStats.ts mobStatText :130-141). Gains arrive as integers
    /// of 1e-4 (fractions for Damage, Attack speed, Life steal, Move speed; points for the rest), so every expectation is
    /// exact decimal arithmetic on the raw integer, rounded half up like JS Math.round.</summary>
    public sealed class BuildHudTextTests
    {
        static WireBuildSummary Summary(params int[] gains)
        {
            var s = new WireBuildSummary();
            for (int i = 0; i < gains.Length; i++) s.Gains[i] = gains[i];
            return s;
        }

        static WireMobBonusRow Row(MobTypeId mob, byte stat, uint stacks, int total) =>
            new WireMobBonusRow { MobType = (byte)mob, Stat = stat, Stacks = stacks, Total = total };

        static string[] Values(WireBuildSummary s) => BuildHudText.Cells(s).Select(c => c.Value).ToArray();

        [Test]
        public void NineCellsInLegacyOrderWithLegacyLabelsAndFormatting()
        {
            // Offense 24, SO 0, Damage 19%, Attack speed 12.5%, Life steal 3.25%, Health 150, Defense -2.5, Soul Defense 1.5, Move 5%.
            var cells = BuildHudText.Cells(Summary(240000, 0, 1900, 1250, 325, 1500000, -25000, 15000, 500));
            Assert.That(cells.Select(c => c.Label), Is.EqualTo(new[]
                { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" }));
            Assert.That(cells.Select(c => c.Value), Is.EqualTo(new[]
                { "+24", "+0", "+19%", "+12.5%", "+3.25%", "+150", "-2.5", "+1.5", "+5%" }));
        }

        [Test]
        public void ZeroIsShownGreyedNotHidden()
        {
            // Legacy dims the cell (class "dim") and still prints the value: "+0" for points and health, "0%" for the percent cells.
            var cells = BuildHudText.Cells(Summary(0, 0, 0, 0, 0, 0, 0, 0, 0));
            Assert.That(cells.Select(c => c.Value), Is.EqualTo(new[] { "+0", "+0", "0%", "0%", "0%", "+0", "+0", "+0", "0%" }));
            Assert.That(cells.All(c => c.Dim), Is.True);
            Assert.That(BuildHudText.Cells(Summary(240000, 0, 1900, 1250, 325, 1500000, -25000, 15000, 500)).Select(c => c.Dim),
                Is.EqualTo(new[] { false, true, false, false, false, false, false, false, false }));
        }

        [Test]
        public void NegativeValuesKeepTheirSign()
        {
            var cells = BuildHudText.Cells(Summary(-30000, -10000, -500, -1000, -50, 0, -25000, -15000, -200));
            Assert.That(cells.Select(c => c.Value), Is.EqualTo(new[] { "-3", "-1", "-5%", "-10%", "-0.5%", "+0", "-2.5", "-1.5", "-2%" }));
            Assert.That(cells.Select(c => c.Dim), Is.EqualTo(new[] { false, false, false, false, false, true, false, false, false }));
        }

        [Test]
        public void PointsRoundToOneDecimalHalfUpAndDropAZeroDecimal()
        {
            // num(): Math.round(v*10)/10, integers without ".0". JS rounds halves toward +infinity: 1.25 -> 1.3, 0.25 -> 0.3, -0.25 -> -0.2.
            Assert.That(Values(Summary(12500, 2500, 0, 0, 0, 125000, -2500, 30000, 0)),
                Is.EqualTo(new[] { "+1.3", "+0.3", "0%", "0%", "0%", "+12.5", "-0.2", "+3", "0%" }));
        }

        [Test]
        public void ANegativeValueThatRoundsToZeroShowsPlusZeroAndIsNotGreyed()
        {
            // Legacy quirk (pinned, not endorsed): Offense -0.04 -> Math.round(-0.4) = -0 -> "0" -> signed "+0"; dim tests only the raw value === 0.
            // Percent cells are exact at 1e-4, so -0.01% shows as "-0.01%".
            var cells = BuildHudText.Cells(Summary(-400, 0, -1, 0, 0, 0, -400, -400, 0));
            Assert.That(cells[0].Value, Is.EqualTo("+0"));
            Assert.That(cells[0].Dim, Is.False);
            Assert.That(cells[2].Value, Is.EqualTo("-0.01%"));
            Assert.That(cells[6].Value, Is.EqualTo("+0"));
            Assert.That(cells[7].Value, Is.EqualTo("+0"));
        }

        [Test]
        public void PercentCellsShowTwoDecimalsAtMostWithoutTrailingZeros()
        {
            Assert.That(Values(Summary(0, 0, 1, 125, 7500, 0, 0, 0, 10)),
                Is.EqualTo(new[] { "+0", "+0", "+0.01%", "+1.25%", "+75%", "+0", "+0", "+0", "+0.1%" }));
        }

        [Test]
        public void NoSummaryYetGivesNoCellsAndNoMobLinesNotZeros()
        {
            Assert.That(BuildHudText.Cells(null), Is.Empty);
            Assert.That(BuildHudText.MobLines(null), Is.Empty);
        }

        [Test]
        public void AnEmptyMobTableShowsTheLegacyNoBonusesLine()
        {
            var lines = BuildHudText.MobLines(Summary());
            Assert.That(lines.Count, Is.EqualTo(1));
            Assert.That(lines[0].Label, Is.EqualTo("No normal-mob bonuses yet"));
            Assert.That(lines[0].Total, Is.EqualTo(""));
        }

        [Test]
        public void EachFarmedStatGetsALegacyNameStacksAndTotalInArrivalOrder()
        {
            var s = Summary();
            s.MobRows = new[]
            {
                Row(MobTypeId.EmberImp, 2, 15, 1500),         // 15 x 1% damage
                Row(MobTypeId.CinderHound, 8, 3, 150),        // 3 x 0.5% move speed
                Row(MobTypeId.MagmaBrute, 5, 6, 600),         // 6 x 1% max health
                Row(MobTypeId.FlameCaller, 1, 4, 40000),      // 4 x 1 Soul Offence (flat, points)
                Row(MobTypeId.Bailiff, 6, 6, 75000),          // 6 x 1.25 Defense
                Row(MobTypeId.ChainWarden, 7, 3, 45000),      // 3 x 1.5 Soul Defense
                Row(MobTypeId.PlagueRat, 3, 9, 900),          // 9 x 1% attack speed
                Row(MobTypeId.RotMonk, 4, 3, 75),             // 3 x 0.25% lifesteal
                Row(MobTypeId.Pardoner, 0, 2, 20000),         // 2 x 1 Offense
            };
            var lines = BuildHudText.MobLines(s);
            Assert.That(lines.Select(l => l.Label + " | " + l.Total), Is.EqualTo(new[]
            {
                "Ember Imp ×15 | +15% damage",
                "Cinder Hound ×3 | +1.5% move speed",
                "Magma Brute ×6 | +6% max health",
                "Flame Caller ×4 | +4 Soul Offence",
                "Bailiff ×6 | +7.5 Defense",
                "Chain Warden ×3 | +4.5 Soul Defense",
                "Plague Rat ×9 | +9% attack speed",
                "Rot Monk ×3 | +0.75% lifesteal",
                "Pardoner ×2 | +2 Offense",
            }));
        }

        [Test]
        public void MobTotalsKeepTheirFractionsAndGroupThousandsLikeLegacy()
        {
            // Flat totals print the raw product (3 x 1.25 = 3.75, not rounded to one decimal); percent totals use
            // toLocaleString("en-US", maximumFractionDigits 2), so 100000 stacks of 1% reads "+100,000%".
            var s = Summary();
            s.MobRows = new[]
            {
                Row(MobTypeId.EmberImp, 2, 100000, 10000000),
                Row(MobTypeId.Bailiff, 6, 3, 37500),
            };
            var lines = BuildHudText.MobLines(s);
            Assert.That(lines[0].Label, Is.EqualTo("Ember Imp ×100000"));
            Assert.That(lines[0].Total, Is.EqualTo("+100,000% damage"));
            Assert.That(lines[1].Total, Is.EqualTo("+3.75 Defense"));
        }
    }
}

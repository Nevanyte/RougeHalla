using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-3, item 1. The drawer label "Cards &amp; mob bonuses · N" counted card types only, so a player with farmed
    /// mob bonuses and no cards read "· 0" while the mob rows (collapsed under the label) were present and correct. Legacy
    /// (packages/client/src/ui/hud.ts:111) has the bare label with no count; the port keeps a count, and it now covers what the label names.
    /// </summary>
    public sealed class BuildHudHeaderTests
    {
        static WireMobBonusRow Row(MobTypeId mob, byte stat, uint stacks, int total) =>
            new WireMobBonusRow { MobType = (byte)mob, Stat = stat, Stacks = stacks, Total = total };

        static WireBuildSummary TwoRows()
        {
            var s = new WireBuildSummary();
            s.MobRows = new[]
            {
                Row(MobTypeId.EmberImp, 2, 15, 1500),    // 15 x 1% damage
                Row(MobTypeId.SeraphShard, 7, 12, 180000), // 12 x 1.5 Soul Defense = +18
            };
            return s;
        }

        // The model already lists every farmed row with legacy text: nothing is lost between the summary and the row's text.
        [Test]
        public void TwoMobRowsAreBothListedWithLegacyText()
        {
            var lines = BuildHudText.MobLines(TwoRows());
            Assert.That(lines.Select(l => l.Label), Is.EqualTo(new[] { "Ember Imp ×15", "Seraph Shard ×12" }));
            Assert.That(lines.Select(l => l.Total), Is.EqualTo(new[] { "+15% damage", "+18 Soul Defense" }));
        }

        [Test]
        public void HeaderCountsFarmedMobTypesWhenNoCardIsHeld()
        {
            Assert.That(BuildHudText.ExtrasHeader(0, TwoRows()), Is.EqualTo("Cards & mob bonuses · 2"));
        }

        [Test]
        public void HeaderAddsCardTypesAndMobTypes()
        {
            Assert.That(BuildHudText.ExtrasHeader(3, TwoRows()), Is.EqualTo("Cards & mob bonuses · 5"));
        }

        [Test]
        public void HeaderWithNoMobRowsAndNoSummaryCountsCardsOnly()
        {
            Assert.That(BuildHudText.ExtrasHeader(2, null), Is.EqualTo("Cards & mob bonuses · 2"));
            Assert.That(BuildHudText.ExtrasHeader(0, new WireBuildSummary()), Is.EqualTo("Cards & mob bonuses · 0"));
        }
    }
}

using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>Legacy colours and texts of the protocol 16 indicator facts (ADR0026).</summary>
    public sealed class IndicatorFactsTests
    {
        [Test] public void Damage_over_time_numbers_take_the_legacy_kind_colour()
        {
            Assert.AreEqual(0xffa040u, Indicators.SigColour(1)); Assert.AreEqual(0xb2d96cu, Indicators.SigColour(2)); Assert.AreEqual(0xff7043u, Indicators.SigColour(3));
            Assert.AreEqual(0xd1a8ffu, Indicators.SigColour(4)); Assert.AreEqual(0xe53935u, Indicators.SigColour(5)); Assert.AreEqual(0xffd36au, Indicators.SigColour(18));
        }
        [Test] public void A_crit_reads_with_a_bang_and_five_more_pixels()
        {
            Assert.AreEqual("34!", Indicators.DamageText(34f, true)); Assert.AreEqual("34", Indicators.DamageText(34f, false));
            Assert.AreEqual(Indicators.DamageSize(34f) + 5, Indicators.DamageSize(34f, true));
        }
        [Test] public void Heals_under_one_are_not_shown() { Assert.IsNull(Indicators.HealText(.4f)); Assert.AreEqual("+12", Indicators.HealText(12.2f)); }
        [Test] public void Stat_marks_have_a_legacy_colour_each()
        {
            var seen = new System.Collections.Generic.HashSet<uint>();
            foreach (StatKey k in System.Enum.GetValues(typeof(StatKey))) Assert.IsTrue(seen.Add(Indicators.StatColour(k)), k.ToString());
            Assert.AreEqual(0xffb074u, Indicators.StatColour(StatKey.Ad));
        }
        [Test] public void A_bot_reads_bracket_bot_and_a_missing_name_reads_nothing()
        {
            Assert.AreEqual("[BOT] Ash", Indicators.DisplayName("Ash", true)); Assert.AreEqual("Ash", Indicators.DisplayName("Ash", false)); Assert.IsNull(Indicators.DisplayName("", false));
        }
        [Test] public void Mark_cues_carry_the_percentage_when_delivered()
        {
            Assert.AreEqual("AS -20%", Indicators.MarkCue(16, 20)); Assert.AreEqual("TAXED", Indicators.MarkCue(16, 0)); Assert.AreEqual("DMG -15%", Indicators.MarkCue(32, 15));
            Assert.AreEqual("EXEC BLOCKED", Indicators.MarkCue(64, 0)); Assert.IsNull(Indicators.MarkCue(1 | 2, 5));
        }
        [Test] public void Every_faction_owns_one_wish() { Assert.AreEqual(AbilityId.Freeze, Indicators.WishOf(FactionId.Frost)); Assert.AreEqual(AbilityId.LastStand, Indicators.WishOf(FactionId.Holy)); }
        [Test] public void The_coliseum_line_counts_down_warns_while_locked_and_turns_red_at_sudden_death()
        {
            Indicators.ArenaLineTone tone;
            Assert.IsNull(Indicators.ArenaLine(1000, 0, false, null, out tone)); Assert.AreEqual(Indicators.ArenaLineTone.None, tone);
            Assert.AreEqual("Coliseum 4:59", Indicators.ArenaLine(1000, 300000, false, null, out tone)); Assert.AreEqual(Indicators.ArenaLineTone.Normal, tone);
            Assert.AreEqual("Coliseum 1:12", Indicators.ArenaLine(1000, 300000, true, 73000, out tone)); Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone);
            Assert.AreEqual("Coliseum - sudden death", Indicators.ArenaLine(400000, 300000, false, null, out tone)); Assert.AreEqual(Indicators.ArenaLineTone.Danger, tone);
        }
        [Test] public void A_windup_lives_for_its_milliseconds()
        {
            Assert.IsTrue(Indicators.WindupLive(100, 300)); Assert.IsFalse(Indicators.WindupLive(400, 300)); Assert.AreEqual(.5f, Indicators.WindupProgress(150, 300), 1e-5f);
        }
    }
}

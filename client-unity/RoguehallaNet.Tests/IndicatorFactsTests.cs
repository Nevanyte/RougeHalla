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
        // ---- P-UNITY-TIMER-1: the legacy Coliseum countdown and phase lines (packages/client/src/ui/hud.ts) -----------------------------
        // hud.ts:15-18 fmtSeconds: ceil(ms / 1000) clamped at 0, "m:ss" (minutes unpadded and unwrapped).
        // hud.ts:259-276 updateArena: locked with a sudden-death time -> count to it, then "Coliseum · sudden death"; otherwise a
        // patience (gate-lock) time > 0 -> count to it; otherwise no line. style.css:319-320: every countdown is amber (--warn),
        // sudden death is red; the "locked" flag changes no colour. Legacy expectations reuse packages/client/test/hud.test.ts:27-43
        // and cardsRow.test.ts:300-318.
        const string Dot = "·", Dash = "—";
        static string Arena(double now, double suddenDeathAt, bool locked, double? patienceEndsAt, out Indicators.ArenaLineTone tone)
        {
            return Indicators.ArenaLine(now, suddenDeathAt, locked, patienceEndsAt, out tone);
        }

        [Test] public void Before_the_lock_the_coliseum_line_counts_down_to_the_gate_lock_in_amber()
        {
            Indicators.ArenaLineTone tone;
            // cardsRow.test.ts:309-317: patience 65 000, now 5 000, sudden death not yet set (0) -> "Coliseum 1:00".
            Assert.AreEqual("Coliseum 1:00", Arena(5000, 0, false, 65000, out tone), "pre-lock: counts to patienceEndsAt while suddenDeathAt is 0");
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone, "pre-lock countdown is amber (style.css:319 .hud-arena color var(--warn))");
            // Sudden-death time is not read before the lock (hud.ts:265): the gate-lock time decides.
            Assert.AreEqual("Coliseum 1:00", Arena(1000, 300000, false, 61000, out tone), "pre-lock: suddenDeathAt is ignored while the gates are open");
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone, "pre-lock countdown is amber even with a stale sudden-death time");
        }

        [Test] public void The_coliseum_countdown_rounds_up_to_the_second_and_stops_at_zero()
        {
            Indicators.ArenaLineTone tone;
            Assert.AreEqual("Coliseum 1:00", Arena(5001, 0, false, 65000, out tone), "59.999 s left rounds up to 1:00");
            Assert.AreEqual("Coliseum 0:59", Arena(6000, 0, false, 65000, out tone), "exactly 59 s left reads 0:59");
            Assert.AreEqual("Coliseum 0:01", Arena(64999, 0, false, 65000, out tone), "1 ms left reads 0:01");
            Assert.AreEqual("Coliseum 0:00", Arena(65000, 0, false, 65000, out tone), "at the gate-lock time reads 0:00");
            // Tick boundary: the clock has passed the gate-lock time but the server has not locked yet -> clamped at 0:00.
            Assert.AreEqual("Coliseum 0:00", Arena(70000, 0, false, 65000, out tone), "past the gate-lock time, before the lock arrives: 0:00");
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone, "the clamped countdown is still amber");
            Assert.AreEqual("Coliseum 60:05", Arena(0, 0, false, 3605000, out tone), "minutes are not wrapped into hours");
        }

        [Test] public void After_the_lock_the_coliseum_line_counts_down_to_sudden_death_in_amber()
        {
            Indicators.ArenaLineTone tone;
            Assert.AreEqual("Coliseum 4:59", Arena(1000, 300000, true, null, out tone), "locked: counts to suddenDeathAt");
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone, "locked countdown is amber");
            Assert.AreEqual("Coliseum 5:00", Arena(1, 300000, true, null, out tone), "299.999 s left rounds up to 5:00");
            Assert.AreEqual("Coliseum 0:01", Arena(299999, 300000, true, null, out tone), "1 ms before sudden death reads 0:01");
            // hud.ts:265 checks the lock first: a patience time still present while locked is not read.
            Assert.AreEqual("Coliseum 4:59", Arena(1000, 300000, true, 73000, out tone), "locked with a sudden-death time: patienceEndsAt is ignored");
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone, "locked countdown is amber");
        }

        [Test] public void At_sudden_death_the_coliseum_line_reads_the_legacy_text_in_red()
        {
            Indicators.ArenaLineTone tone;
            Assert.AreEqual("Coliseum " + Dot + " sudden death", Arena(300000, 300000, true, null, out tone), "at suddenDeathAt (>=): legacy text with a middle dot");
            Assert.AreEqual(Indicators.ArenaLineTone.Danger, tone, "sudden death is red (style.css:320 .hud-arena.sudden)");
            Assert.AreEqual("Coliseum " + Dot + " sudden death", Arena(400000, 300000, true, null, out tone), "after suddenDeathAt: same text");
            Assert.AreEqual(Indicators.ArenaLineTone.Danger, tone, "after sudden death: red");
        }

        [Test] public void Without_a_deadline_there_is_no_coliseum_line()
        {
            Indicators.ArenaLineTone tone;
            Assert.IsNull(Arena(1000, 0, false, null, out tone), "no patience, no lock: no line");
            Assert.AreEqual(Indicators.ArenaLineTone.None, tone, "no line: tone None");
            Assert.IsNull(Arena(1000, 0, false, 0d, out tone), "patienceEndsAt 0 means none (hud.ts:273 `> 0`)");
            Assert.AreEqual(Indicators.ArenaLineTone.None, tone, "no line: tone None");
            // hud.ts:265: a sudden-death time without the lock is not shown (the old Unity line turned red here).
            Assert.IsNull(Arena(400000, 300000, false, null, out tone), "unlocked with only a sudden-death time: no line");
            Assert.AreEqual(Indicators.ArenaLineTone.None, tone, "no line: tone None");
            // Locked without a sudden-death time falls through to the patience branch (hud.ts:265,273).
            Assert.IsNull(Arena(1000, 0, true, null, out tone), "locked, no sudden-death time, no patience: no line");
            Assert.AreEqual("Coliseum 1:00", Arena(1000, 0, true, 61000, out tone), "locked without a sudden-death time: counts to patience");
        }

        static ArenaView ArenaAt(double lobbyEndsAt = 0, double planEndsAt = 0, double raidStartedAt = 0, double? patienceEndsAt = null, bool locked = false, double suddenDeathAt = 0)
        {
            return new ArenaView { LobbyEndsAt = lobbyEndsAt, PlanEndsAt = planEndsAt, RaidStartedAt = raidStartedAt, PatienceEndsAt = patienceEndsAt, GatesLocked = locked, SuddenDeathAt = suddenDeathAt, StartedWith = 6 };
        }

        [Test] public void The_lobby_strip_counts_down_to_the_run_start()
        {
            Indicators.ArenaLineTone tone;
            // hud.ts:43-44, hud.test.ts:27-33.
            string Lobby(double now, double endsAt) => Indicators.PhaseLine(MatchPhase.Lobby, now, ArenaAt(lobbyEndsAt: endsAt), 1, 2, out tone);
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:10", Lobby(0, 10000), "lobby line: players/min and the countdown to lobbyEndsAt");
            Assert.AreEqual(Indicators.ArenaLineTone.Normal, tone, "the lobby line is plain text (.hud-status, no warn colour)");
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:02", Lobby(8001, 10000), "1.999 s left rounds up to 0:02");
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 2:05", Lobby(0, 125000), "minutes:seconds");
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:00", Lobby(20000, 10000), "past the start: 0:00");
            Assert.AreEqual("Waiting for players 7/2 " + Dash + " run starts in 0:10",
                Indicators.PhaseLine(MatchPhase.Lobby, 0, ArenaAt(lobbyEndsAt: 10000), 7, 2, out tone), "the count is not capped at the minimum");
        }

        [Test] public void The_planning_strip_counts_down_to_the_end_of_planning()
        {
            Indicators.ArenaLineTone tone;
            // hud.ts:46-47, hud.test.ts:35-43.
            string Planning(double now, double endsAt) => Indicators.PhaseLine(MatchPhase.Planning, now, ArenaAt(planEndsAt: endsAt), 6, 2, out tone);
            Assert.AreEqual("Planning 0:12", Planning(0, 12000), "planning line: countdown to planEndsAt");
            Assert.AreEqual(Indicators.ArenaLineTone.Normal, tone, "the planning line is plain text");
            Assert.AreEqual("Planning 0:08", Planning(4900, 12000), "7.1 s left rounds up to 0:08");
            Assert.AreEqual("Planning 0:01", Planning(11999, 12000), "1 ms left reads 0:01");
            Assert.AreEqual("Planning 0:00", Planning(20000, 12000), "past the end: 0:00");
            Assert.AreEqual("Planning", Planning(0, 0), "planEndsAt 0: no clock");
        }

        [Test] public void The_active_strip_is_the_coliseum_line_alone_with_no_elapsed_clock()
        {
            Indicators.ArenaLineTone tone;
            // hud.ts:197-199: the status line is hidden while active; hud.ts:114-116,139: the arena line is alone at top centre
            // (cardsRow.test.ts:316-317 "keeps the Coliseum timer by itself at top center").
            string line = Indicators.PhaseLine(MatchPhase.Active, 5000, ArenaAt(raidStartedAt: 5000, patienceEndsAt: 65000), 6, 2, out tone);
            Assert.AreEqual("Coliseum 1:00", line, "active, gates open: only the countdown to the gate lock");
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone, "active countdown is amber");
            line = Indicators.PhaseLine(MatchPhase.Active, 125000, ArenaAt(raidStartedAt: 5000, patienceEndsAt: 185000), 6, 2, out tone);
            Assert.AreEqual("Coliseum 1:00", line, "two minutes into the run the strip still counts down, never up");
            StringAssert.DoesNotContain("RAID", line, "no elapsed RAID clock");
            line = Indicators.PhaseLine(MatchPhase.Active, 200000, ArenaAt(raidStartedAt: 5000, locked: true, suddenDeathAt: 260000), 6, 2, out tone);
            Assert.AreEqual("Coliseum 1:00", line, "active, locked: only the countdown to sudden death");
            line = Indicators.PhaseLine(MatchPhase.Active, 260000, ArenaAt(raidStartedAt: 5000, locked: true, suddenDeathAt: 260000), 6, 2, out tone);
            Assert.AreEqual("Coliseum " + Dot + " sudden death", line, "active, sudden death: the legacy text alone");
            Assert.AreEqual(Indicators.ArenaLineTone.Danger, tone, "sudden death is red");
            line = Indicators.PhaseLine(MatchPhase.Active, 60000, ArenaAt(raidStartedAt: 5000), 6, 2, out tone);
            Assert.IsNull(line, "active without any deadline: no strip text (legacy hides the line)");
            Assert.AreEqual(Indicators.ArenaLineTone.None, tone, "no strip text: tone None");
        }
        [Test] public void A_windup_lives_for_its_milliseconds()
        {
            Assert.IsTrue(Indicators.WindupLive(100, 300)); Assert.IsFalse(Indicators.WindupLive(400, 300)); Assert.AreEqual(.5f, Indicators.WindupProgress(150, 300), 1e-5f);
        }
    }
}

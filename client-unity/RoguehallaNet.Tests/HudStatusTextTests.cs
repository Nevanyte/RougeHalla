using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-HUD-STATUS-1, loose proof against packages/client/src/ui/hud.ts statusLine (:41-56) and updateArena (:258-285).
    /// Legacy hides the status element while the phase is active (hud.ts:199), so "Alive a/b · Run GV n" (:50-52) is never on screen
    /// during a run: the active line stays the Coliseum line only. The alive count is also not on the wire (the roster has no status).
    /// </summary>
    public sealed class HudStatusTextTests
    {
        static string Line(MatchPhase phase, double now, ArenaView? arena, int players, int min, string winner, out Indicators.ArenaLineTone tone)
        {
            return Indicators.PhaseLine(phase, now, arena, players, min, winner, out tone);
        }

        [Test] public void Lobby_reads_players_over_minimum_and_the_lobby_countdown()
        {
            var arena = new ArenaView { LobbyEndsAt = 10000 };
            Assert.AreEqual("Waiting for players 2/4 — run starts in 0:10", Line(MatchPhase.Lobby, 0, arena, 2, 4, null, out var tone));
            Assert.AreEqual(Indicators.ArenaLineTone.Normal, tone);
            Assert.AreEqual("Waiting for players 2/4 — run starts in 1:00", Line(MatchPhase.Lobby, 0, new ArenaView { LobbyEndsAt = 60000 }, 2, 4, null, out tone));
        }
        [Test] public void Lobby_without_a_known_minimum_keeps_the_count_alone()
        {
            Assert.AreEqual("Waiting for players 3 — run starts in 0:05", Line(MatchPhase.Lobby, 0, new ArenaView { LobbyEndsAt = 4500 }, 3, 0, null, out _));
        }
        [Test] public void Planning_counts_down_and_reads_bare_without_an_end()
        {
            Assert.AreEqual("Planning 0:30", Line(MatchPhase.Planning, 1000, new ArenaView { PlanEndsAt = 31000 }, 2, 4, null, out _));
            Assert.AreEqual("Planning", Line(MatchPhase.Planning, 1000, new ArenaView { PlanEndsAt = 0 }, 2, 4, null, out _));
        }
        [Test] public void The_run_shows_the_coliseum_line_and_no_alive_text()
        {
            var arena = new ArenaView { PatienceEndsAt = 65000, StartedWith = 8 };
            Assert.AreEqual("Coliseum 1:00", Line(MatchPhase.Active, 5000, arena, 8, 4, "Ash", out var tone));
            Assert.AreEqual(Indicators.ArenaLineTone.Warn, tone);
            Assert.IsNull(Line(MatchPhase.Active, 5000, new ArenaView { StartedWith = 8 }, 8, 4, null, out _), "no deadline: no line");
        }
        [Test] public void A_finished_run_names_the_winner_or_reads_bare()
        {
            var arena = new ArenaView();
            Assert.AreEqual("Run over — Ash is victorious", Line(MatchPhase.Ended, 0, arena, 1, 4, "Ash", out var tone));
            Assert.AreEqual(Indicators.ArenaLineTone.Normal, tone);
            Assert.AreEqual("Run over — [BOT] Ash is victorious", Line(MatchPhase.Ended, 0, arena, 1, 4, Indicators.DisplayName("Ash", true), out _));
            Assert.AreEqual("Run over", Line(MatchPhase.Ended, 0, arena, 1, 4, null, out _), "a draw, or a winner not delivered");
            Assert.AreEqual("Run over", Line(MatchPhase.Ended, 0, null, 1, 4, "", out _), "the arena key is not needed");
        }
    }
}

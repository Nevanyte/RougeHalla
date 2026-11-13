using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-HUD-STATUS-2, loose proof against the legacy strings: hud.ts:44 (lobby line, minimum from state.minPlayers :193, countdown
    /// fmtSeconds :15-18 = "m:ss", rounded up, clamped at 0) and weaponBar.ts:146-148 (healing "Healing[ xN] Ns", wind "+50% speed" / "Active Ns" /
    /// "Walk over emblems"; N is ceil(ms / 1000)). "now" is the session's accepted server clock (Session.ServerTimeMs), the one the lobby
    /// countdown already uses (MatchHud.Features.cs TickMetrics). The wind emblem is one label in Unity: the two legacy spans are joined by " · " (U+00B7).
    /// </summary>
    public sealed class HudStatusClocksTests
    {
        const string Dash = "—", Dot = "·";

        static string Lobby(int players, byte min, double now, double endsAt)
        {
            return Indicators.PhaseLine(MatchPhase.Lobby, now, new ArenaView { LobbyEndsAt = endsAt, MinPlayers = min }, players, (string)null, out _);
        }
        static InventoryView Inv(byte healing, double? healingUntil, double? boostUntil)
        {
            return new InventoryView { PotionsHealing = healing, HealingUntil = healingUntil, SpeedBoostUntil = boostUntil };
        }

        // ---- 1. the lobby line ----
        [TestCase(1, 1, "Waiting for players 1/1 " + Dash + " run starts in 0:10")]
        [TestCase(1, 2, "Waiting for players 1/2 " + Dash + " run starts in 0:10")]
        [TestCase(3, 8, "Waiting for players 3/8 " + Dash + " run starts in 0:10")]
        [TestCase(8, 8, "Waiting for players 8/8 " + Dash + " run starts in 0:10")]
        public void The_lobby_line_reads_players_over_the_rooms_minimum(int players, int min, string expected)
        {
            Assert.AreEqual(expected, Lobby(players, (byte)min, 0, 10000), "hud.ts:44 `${playerCount}/${minPlayers}`");
        }
        [Test] public void A_minimum_not_delivered_keeps_todays_line_without_a_slash()
        {
            Assert.AreEqual("Waiting for players 3 " + Dash + " run starts in 0:10", Lobby(3, 0, 0, 10000), "GUARD (green today): MinPlayers 0 = absent");
        }
        [Test] public void The_lobby_countdown_rounds_up_and_clamps_at_zero_against_the_server_clock()
        {
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:40", Lobby(1, 2, 5000, 45000));
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:01", Lobby(1, 2, 44001, 45000), "999 ms left shows 1");
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:00", Lobby(1, 2, 45000, 45000), "at the end: 0:00");
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 0:00", Lobby(1, 2, 60000, 45000), "past it: clamped");
            Assert.AreEqual("Waiting for players 1/2 " + Dash + " run starts in 2:05", Lobby(1, 2, 0, 125000), "minutes:seconds (legacy fmtSeconds, not bare seconds)");
        }

        // ---- 2. the healing slot ----
        [TestCase(1, 6000, 1000, "Healing 5s")]
        [TestCase(2, 6000, 1000, "Healing x2 5s")]
        [TestCase(3, 5001, 1000, "Healing x3 5s")]
        [TestCase(1, 5000, 1000, "Healing 4s")]
        [TestCase(2, 1001, 1000, "Healing x2 1s")]
        [TestCase(1, 1000.5, 1000, "Healing 1s")]
        public void Healing_reads_the_count_only_above_one_and_the_seconds_rounded_up(int count, double until, double now, string expected)
        {
            Assert.AreEqual(expected, SlotText.HealingSlot(Inv((byte)count, until, null), now));
        }
        [TestCase(1000)] [TestCase(500)] [TestCase(1)]
        public void A_healing_end_at_or_before_now_shows_nothing(double until)
        {
            Assert.AreEqual("", SlotText.HealingSlot(Inv(2, until, null), 1000), "weaponBar.ts:147 shows it only while healingUntil > now");
        }
        [Test] public void Healing_without_a_delivered_clock_keeps_the_count_only_text_and_without_an_inventory_nothing()
        {
            Assert.AreEqual("Healing", SlotText.HealingSlot(Inv(1, null, null), 1000), "GUARD (green today)");
            Assert.AreEqual("Healing x2", SlotText.HealingSlot(Inv(2, null, null), 1000), "GUARD (green today)");
            Assert.AreEqual("", SlotText.HealingSlot(Inv(0, null, null), 1000), "GUARD (green today)");
            Assert.AreEqual("", SlotText.HealingSlot(null, 1000), "GUARD (green today): a seat without an inventory view");
        }

        // ---- 3. the wind emblem ----
        [TestCase(6000, 1000, "+50% speed " + Dot + " Active 5s")]
        [TestCase(5001, 1000, "+50% speed " + Dot + " Active 5s")]
        [TestCase(5000, 1000, "+50% speed " + Dot + " Active 4s")]
        [TestCase(1001, 1000, "+50% speed " + Dot + " Active 1s")]
        [TestCase(1000.5, 1000, "+50% speed " + Dot + " Active 1s")]
        public void The_wind_emblem_reads_active_seconds_rounded_up_while_the_boost_runs(double until, double now, string expected)
        {
            Assert.AreEqual(expected, SlotText.WindEmblem(Inv(0, null, until), now));
        }
        [TestCase(1000)] [TestCase(999)] [TestCase(0)]
        public void A_boost_end_at_or_before_now_reads_the_idle_text(double until)
        {
            Assert.AreEqual("Walk over emblems", SlotText.WindEmblem(Inv(0, null, until), 1000), "GUARD (green today): weaponBar.ts:146 needs speedBoostUntil > now");
        }
        [Test] public void An_absent_boost_clock_or_inventory_reads_the_idle_text()
        {
            Assert.AreEqual("Walk over emblems", SlotText.WindEmblem(Inv(0, null, null), 1000), "GUARD (green today)");
            Assert.AreEqual("Walk over emblems", SlotText.WindEmblem(null, 1000), "GUARD (green today): a spectator or another seat has no clocks");
        }
    }
}

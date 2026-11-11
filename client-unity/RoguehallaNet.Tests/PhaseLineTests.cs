using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public sealed class PhaseLineTests
    {
        [Test] public void The_lobby_line_drops_the_minimum_when_it_is_not_known()
        {
            var arena = new ArenaView { LobbyEndsAt = 10000 };
            Assert.AreEqual("Waiting for players 1 — run starts in 0:10", Indicators.PhaseLine(MatchPhase.Lobby, 0, arena, 1, 0, out var tone));
            Assert.AreEqual(Indicators.ArenaLineTone.Normal, tone);
        }
    }
}

using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Ui;

public sealed class LobbyRosterEditModeTests
{
    const string Sample =
        "{\"serverNow\":1731234567890,\"rooms\":[{\"phase\":\"lobby\",\"startedAt\":null,\"humanMin\":3,\"fillTarget\":0,\"humans\":1," +
        "\"players\":[{\"name\":\"Alpha\",\"kind\":\"human\"},{\"name\":\"bot1\",\"kind\":\"bot\"}]}]," +
        "\"waiting\":[{\"name\":\"bravo\"}],\"onlineCount\":2,\"arenaLimit\":16,\"arenaRoomCount\":1,\"arenaAvailable\":true}";

    [Test]
    public void HubPanelShowsTheGameThenTheWaitingGroupWithLegacyHeadings()
    {
        string text = HubLobbyActivityView.Compose(LobbyActivity.Parse(Sample), 1000, true);
        int game = text.IndexOf("Active game · 1 humans · 1 bots", System.StringComparison.Ordinal);
        int waiting = text.IndexOf("Waiting in the hub · 1", System.StringComparison.Ordinal);
        Assert.Greater(game, -1);
        Assert.Greater(waiting, game);
        StringAssert.Contains("Gathering players", text);
        StringAssert.Contains("bot1 · Bot", text);
        StringAssert.Contains("bravo · Human", text);
        StringAssert.Contains("Lobby activity · 2 online", text);
    }

    [Test]
    public void StaleOrMissingDataShowsTheUnavailableTexts()
    {
        string stale = HubLobbyActivityView.Compose(LobbyActivity.Parse(Sample), 30001, true);
        StringAssert.Contains("Lobby activity is out of date. Refreshing…", stale);
        StringAssert.Contains("Current players unavailable.", stale);
        string never = HubLobbyActivityView.Compose(LobbyActivityModel.Empty, 0, false);
        StringAssert.Contains("Lobby activity is unavailable. Retrying…", never);
    }

    [Test]
    public void PresenceBodyRefusesNamesOutsideTheServerAlphabet()
    {
        Assert.AreEqual("{\"name\":\"Alpha\",\"tabId\":\"0123456789abcdef\"}", LobbyActivityTransport.PresenceBody("Alpha", "0123456789abcdef"));
        Assert.IsNull(LobbyActivityTransport.PresenceBody("Al\"pha", "0123456789abcdef"));
        Assert.IsNull(LobbyActivityTransport.PresenceBody("Alpha", "short"));
    }
}

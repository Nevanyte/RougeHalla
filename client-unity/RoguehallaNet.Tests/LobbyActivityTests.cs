using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The lobby-activity model equals the legacy panel (docs/backlog/packets/P-UNITY-LOBBY-ROSTER-1.md).
    /// Legacy: packages/client/src/ui/lobbyActivity.ts:5-6 (15 s poll, 30 s stale), :16-23 (phase names), :132,148 (stale = age strictly
    /// over 30 s, or no snapshot), :174-202 (headings with counts, "N humans · M bots" even for 1, empty texts), :192-202 (waiting list);
    /// packages/client/src/ui/hud.ts:44 (the "n/m" of the lobby line). Response: crates/rh-server/src/lobby.rs (P-LOBBY-ACTIVITY-1).
    /// </summary>
    public class LobbyActivityTests
    {
        const string Sample =
            "{\"serverNow\":1731234567890,\"rooms\":[{\"phase\":\"lobby\",\"startedAt\":null,\"humanMin\":3,\"fillTarget\":0,\"humans\":1," +
            "\"players\":[{\"name\":\"Alpha\",\"kind\":\"human\"},{\"name\":\"bot1\",\"kind\":\"bot\"}]}]," +
            "\"waiting\":[{\"name\":\"bravo\"}],\"onlineCount\":2,\"arenaLimit\":16,\"arenaRoomCount\":1,\"arenaAvailable\":true}";

        const string Quiet =
            "{\"serverNow\":1,\"rooms\":[],\"waiting\":[],\"onlineCount\":0,\"arenaLimit\":16,\"arenaRoomCount\":0,\"arenaAvailable\":true}";

        [Test]
        public void Sample_response_groups_the_room_and_the_waiting_with_bot_tags()
        {
            var model = LobbyActivity.Parse(Sample);
            Assert.IsTrue(model.Available);
            Assert.AreEqual(2, model.OnlineCount);
            Assert.AreEqual(1, model.Rooms.Count);
            var room = model.Rooms[0];
            Assert.AreEqual(LobbyPhase.Lobby, room.Phase);
            Assert.AreEqual(-1, room.StartedAtMs);
            Assert.AreEqual(3, room.HumanMin);
            Assert.AreEqual(1, room.Humans);
            CollectionAssert.AreEqual(new[] { "Alpha", "bot1" }, room.Players.Select(p => p.Name).ToArray());
            CollectionAssert.AreEqual(new[] { false, true }, room.Players.Select(p => p.Bot).ToArray());
            CollectionAssert.AreEqual(new[] { "bravo" }, model.Waiting.Select(p => p.Name).ToArray());
            Assert.IsFalse(model.Waiting[0].Bot);

            // Legacy text, including "1 humans" (no singular).
            Assert.AreEqual("Active game", LobbyActivity.GameHeading);
            Assert.AreEqual("Waiting in the hub", LobbyActivity.WaitingHeading);
            Assert.AreEqual("Active game · 1 humans · 1 bots", LobbyActivity.RoomHeading(room));
            Assert.AreEqual("Waiting in the hub · 1", LobbyActivity.WaitingTitle(model));
            Assert.AreEqual("Gathering players", LobbyActivity.PhaseLabel(LobbyPhase.Lobby));
            Assert.AreEqual("Planning", LobbyActivity.PhaseLabel(LobbyPhase.Planning));
            Assert.AreEqual("Run in progress", LobbyActivity.PhaseLabel(LobbyPhase.Active));
            Assert.AreEqual("Finished", LobbyActivity.PhaseLabel(LobbyPhase.Finished));
        }

        [Test]
        public void Quiet_response_is_available_with_nothing_to_list()
        {
            var model = LobbyActivity.Parse(Quiet);
            Assert.IsTrue(model.Available);
            Assert.AreEqual(0, model.Rooms.Count);
            Assert.AreEqual(0, model.Waiting.Count);
            Assert.AreEqual("Waiting in the hub · 0", LobbyActivity.WaitingTitle(model));
        }

        [Test]
        public void Data_is_stale_only_when_older_than_thirty_seconds_or_absent()
        {
            var model = LobbyActivity.Parse(Sample);
            Assert.IsFalse(LobbyActivity.IsStale(model, 0));
            Assert.IsFalse(LobbyActivity.IsStale(model, 30000));
            Assert.IsTrue(LobbyActivity.IsStale(model, 30001));
            Assert.IsTrue(LobbyActivity.IsStale(LobbyActivityModel.Empty, 0));
            Assert.AreEqual(15000, LobbyActivity.PollMs);
            Assert.AreEqual(30000, LobbyActivity.StaleMs);
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase("not json")]
        [TestCase("{")]
        [TestCase("[]")]
        [TestCase("{\"rooms\":\"x\",\"waiting\":[]}")]
        [TestCase("{\"rooms\":[{\"phase\":\"bogus\",\"players\":[]}],\"waiting\":[]}")]
        [TestCase("{\"rooms\":[],\"waiting\":[]} trailing")]
        public void Malformed_input_gives_the_empty_model(string json)
        {
            var model = LobbyActivity.Parse(json);
            Assert.IsFalse(model.Available);
            Assert.AreEqual(0, model.Rooms.Count);
            Assert.AreEqual(0, model.Waiting.Count);
        }

        [Test]
        public void Oversized_input_gives_the_empty_model()
        {
            string pad = new string(' ', LobbyActivity.MaxJsonChars);
            var model = LobbyActivity.Parse(Quiet + pad);
            Assert.IsFalse(model.Available);
            Assert.AreEqual(0, model.Rooms.Count);
        }

        [Test]
        public void Names_are_plain_bounded_text()
        {
            string json = "{\"rooms\":[],\"waiting\":[{\"name\":\"ab\\u0007cd\"},{\"name\":\"" + new string('x', 40) + "\"},{\"name\":\"\"}]}";
            var model = LobbyActivity.Parse(json);
            Assert.IsTrue(model.Available);
            CollectionAssert.AreEqual(new[] { "abcd", new string('x', LobbyActivity.MaxNameChars) }, model.Waiting.Select(p => p.Name).ToArray());
        }

        [Test]
        public void Roster_lines_keep_seat_order_and_tag_bots()
        {
            var rows = new[]
            {
                new WireRosterRow { Id = 3, Bot = false, Name = "Alpha" },
                new WireRosterRow { Id = 5, Bot = true, Name = "bot1" },
                new WireRosterRow { Id = 9, Bot = false, Name = "Cy" },
            };
            CollectionAssert.AreEqual(new[] { "Alpha", "bot1 (Bot)", "Cy" }, LobbyActivity.RosterLines(rows));
            Assert.AreEqual(0, LobbyActivity.RosterLines(new WireRosterRow[0]).Length);
        }

        [Test]
        public void Lobby_count_is_humans_over_the_minimum_then_the_fill_target()
        {
            Assert.AreEqual("1/3", LobbyActivity.LobbyCount(1, 3, 0));
            Assert.AreEqual("1/3", LobbyActivity.LobbyCount(1, 3, 6));
            Assert.AreEqual("2/4", LobbyActivity.LobbyCount(2, 0, 4));
            Assert.AreEqual("2", LobbyActivity.LobbyCount(2, 0, 0));
        }
    }
}

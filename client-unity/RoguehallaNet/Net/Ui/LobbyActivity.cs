using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    public enum LobbyPhase { Lobby, Planning, Active, Finished }

    public sealed class LobbyPerson
    {
        public string Name { get; }
        public bool Bot { get; }
        public LobbyPerson(string name, bool bot) { Name = name; Bot = bot; }
    }

    /// <summary>One room of the lobby response (legacy "activeGame", now one per room).</summary>
    public sealed class LobbyRoom
    {
        public LobbyPhase Phase { get; }
        /// <summary>Epoch ms, or -1 when the run has not started.</summary>
        public long StartedAtMs { get; }
        public int HumanMin { get; }
        public int FillTarget { get; }
        public int Humans { get; }
        public IReadOnlyList<LobbyPerson> Players { get; }
        public LobbyRoom(LobbyPhase phase, long startedAtMs, int humanMin, int fillTarget, int humans, IReadOnlyList<LobbyPerson> players)
        { Phase = phase; StartedAtMs = startedAtMs; HumanMin = humanMin; FillTarget = fillTarget; Humans = humans; Players = players; }
    }

    /// <summary>A parsed GET /api/lobby response. <see cref="Available"/> is false for the empty model (nothing parsed).</summary>
    public sealed class LobbyActivityModel
    {
        public static readonly LobbyActivityModel Empty = new LobbyActivityModel();
        public bool Available { get; }
        public IReadOnlyList<LobbyRoom> Rooms { get; }
        public IReadOnlyList<LobbyPerson> Waiting { get; }
        public int OnlineCount { get; }
        LobbyActivityModel() { Rooms = Array.Empty<LobbyRoom>(); Waiting = Array.Empty<LobbyPerson>(); }
    }

    /// <summary>Pure model of the legacy lobby-activity panel (docs/backlog/packets/P-UNITY-LOBBY-ROSTER-1.md). Stub: nothing implemented.</summary>
    public static class LobbyActivity
    {
        public const int PollMs = 15000, StaleMs = 30000, MaxJsonChars = 65536, MaxNameChars = 24;
        public const string GameHeading = "Active game", WaitingHeading = "Waiting in the hub";

        public static LobbyActivityModel Parse(string json) { return LobbyActivityModel.Empty; }
        public static bool IsStale(LobbyActivityModel model, long ageMs) { return false; }
        public static string PhaseLabel(LobbyPhase phase) { return ""; }
        public static string RoomHeading(LobbyRoom room) { return ""; }
        public static string WaitingTitle(LobbyActivityModel model) { return ""; }
        public static string[] RosterLines(IReadOnlyList<WireRosterRow> rows) { return Array.Empty<string>(); }
        public static string LobbyCount(int humans, int humanMin, int fillTarget) { return ""; }
    }
}

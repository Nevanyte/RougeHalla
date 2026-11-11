using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
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
        internal LobbyActivityModel(List<LobbyRoom> rooms, List<LobbyPerson> waiting, int online)
        { Available = true; Rooms = rooms; Waiting = waiting; OnlineCount = online; }
    }

    /// <summary>Pure model of the legacy lobby-activity panel (docs/backlog/packets/P-UNITY-LOBBY-ROSTER-1.md).</summary>
    public static class LobbyActivity
    {
        public const int PollMs = 15000, StaleMs = 30000, MaxJsonChars = 65536, MaxNameChars = 24;
        public const string GameHeading = "Active game", WaitingHeading = "Waiting in the hub";
        public const string PanelTitle = "Lobby activity", Unavailable = "Current players unavailable.";
        public const string StatusStale = "Lobby activity is out of date. Refreshing…", StatusNever = "Lobby activity is unavailable. Retrying…";
        public const string NoGame = "No active game right now.", NoWaiting = "No players waiting in the hub.", NoPlayers = "Waiting for players to join.";
        const int MaxDepth = 16, MaxRooms = 64, MaxPeople = 256;

        public static LobbyActivityModel Parse(string json)
        {
            if (string.IsNullOrEmpty(json) || json.Length > MaxJsonChars) return LobbyActivityModel.Empty;
            try
            {
                var reader = new Reader(json);
                var root = reader.ReadDocument() as Dictionary<string, object>;
                if (root == null) return LobbyActivityModel.Empty;
                var rooms = root.TryGetValue("rooms", out var r) ? r as List<object> : null;
                var waiting = root.TryGetValue("waiting", out var w) ? w as List<object> : null;
                if (rooms == null || waiting == null || rooms.Count > MaxRooms || waiting.Count > MaxPeople) return LobbyActivityModel.Empty;
                var outRooms = new List<LobbyRoom>();
                foreach (var item in rooms)
                {
                    var room = ParseRoom(item as Dictionary<string, object>);
                    if (room == null) return LobbyActivityModel.Empty;
                    outRooms.Add(room);
                }
                var outWaiting = new List<LobbyPerson>();
                foreach (var item in waiting)
                {
                    var d = item as Dictionary<string, object>;
                    if (d == null) return LobbyActivityModel.Empty;
                    string name = d.TryGetValue("name", out var n) ? CleanName(n as string) : null;
                    if (name != null) outWaiting.Add(new LobbyPerson(name, false));
                }
                int online = root.TryGetValue("onlineCount", out var o) ? Int(o) : 0;
                return new LobbyActivityModel(outRooms, outWaiting, online);
            }
            catch (Exception)
            {
                return LobbyActivityModel.Empty;
            }
        }

        static LobbyRoom ParseRoom(Dictionary<string, object> d)
        {
            if (d == null) return null;
            if (!d.TryGetValue("phase", out var ph) || !(ph is string phase)) return null;
            LobbyPhase p;
            switch (phase)
            {
                case "lobby": p = LobbyPhase.Lobby; break;
                case "planning": p = LobbyPhase.Planning; break;
                case "active": p = LobbyPhase.Active; break;
                case "finished": p = LobbyPhase.Finished; break;
                default: return null;
            }
            if (!d.TryGetValue("players", out var pl) || !(pl is List<object> players) || players.Count > MaxPeople) return null;
            var list = new List<LobbyPerson>();
            foreach (var item in players)
            {
                var pd = item as Dictionary<string, object>;
                if (pd == null) return null;
                string name = pd.TryGetValue("name", out var n) ? CleanName(n as string) : null;
                if (name == null) continue;
                bool bot = pd.TryGetValue("kind", out var k) && k is string ks && ks == "bot";
                list.Add(new LobbyPerson(name, bot));
            }
            long started = d.TryGetValue("startedAt", out var sa) && sa is double sd ? (long)sd : -1;
            return new LobbyRoom(p, started, Int(d, "humanMin"), Int(d, "fillTarget"), Int(d, "humans"), list);
        }

        static int Int(Dictionary<string, object> d, string key) { return d.TryGetValue(key, out var v) ? Int(v) : 0; }
        static int Int(object v)
        {
            if (!(v is double x) || double.IsNaN(x) || x < 0) return 0;
            return x > 1000000 ? 1000000 : (int)x;
        }

        /// <summary>Plain bounded text: control characters and rich-text angle brackets removed, trimmed, cut to MaxNameChars; null when nothing is left.</summary>
        public static string CleanName(string raw)
        {
            if (raw == null) return null;
            var sb = new StringBuilder();
            foreach (char c in raw)
            {
                if (char.IsControl(c) || c == '<' || c == '>') continue;
                sb.Append(c);
                if (sb.Length >= MaxNameChars) break;
            }
            string s = sb.ToString().Trim();
            return s.Length == 0 ? null : s;
        }

        public static bool IsStale(LobbyActivityModel model, long ageMs)
        {
            return model == null || !model.Available || ageMs > StaleMs;
        }

        public static string PhaseLabel(LobbyPhase phase)
        {
            switch (phase)
            {
                case LobbyPhase.Lobby: return "Gathering players";
                case LobbyPhase.Planning: return "Planning";
                case LobbyPhase.Active: return "Run in progress";
                default: return "Finished";
            }
        }

        public static string RoomHeading(LobbyRoom room)
        {
            int bots = 0, humans = 0;
            foreach (var p in room.Players) { if (p.Bot) bots++; else humans++; }
            string s = GameHeading + " · " + humans.ToString(CultureInfo.InvariantCulture) + " humans";
            if (bots > 0) s += " · " + bots.ToString(CultureInfo.InvariantCulture) + " bots";
            return s;
        }

        public static string WaitingTitle(LobbyActivityModel model)
        {
            return WaitingHeading + " · " + model.Waiting.Count.ToString(CultureInfo.InvariantCulture);
        }

        public static string PanelHeader(LobbyActivityModel model)
        {
            return model.Available ? PanelTitle + " · " + model.OnlineCount.ToString(CultureInfo.InvariantCulture) + " online" : PanelTitle;
        }

        public static string[] RosterLines(IReadOnlyList<WireRosterRow> rows)
        {
            var lines = new string[rows.Count];
            for (int i = 0; i < lines.Length; i++) lines[i] = Line(rows[i].Name, rows[i].Bot);
            return lines;
        }

        public static string[] RosterLines(IReadOnlyList<RosterEntry> entries)
        {
            var lines = new string[entries.Count];
            for (int i = 0; i < lines.Length; i++) lines[i] = Line(entries[i].Name, entries[i].Bot);
            return lines;
        }

        static string Line(string name, bool bot)
        {
            string n = CleanName(name) ?? "?";
            return bot ? n + " (Bot)" : n;
        }

        public static string LobbyCount(int humans, int humanMin, int fillTarget)
        {
            string h = humans.ToString(CultureInfo.InvariantCulture);
            if (humanMin > 0) return h + "/" + humanMin.ToString(CultureInfo.InvariantCulture);
            if (fillTarget > 0) return h + "/" + fillTarget.ToString(CultureInfo.InvariantCulture);
            return h;
        }

        // Bounded recursive-descent JSON reader. Values: Dictionary<string,object>, List<object>, string, double, bool, null.
        sealed class Reader
        {
            readonly string s;
            int i;
            public Reader(string text) { s = text; }

            public object ReadDocument()
            {
                var v = Value(0);
                Ws();
                if (i != s.Length) throw new FormatException();
                return v;
            }

            void Ws() { while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++; }

            object Value(int depth)
            {
                if (depth > MaxDepth) throw new FormatException();
                Ws();
                if (i >= s.Length) throw new FormatException();
                char c = s[i];
                if (c == '{') return Obj(depth);
                if (c == '[') return Arr(depth);
                if (c == '"') return Str();
                if (Lit("true")) return true;
                if (Lit("false")) return false;
                if (Lit("null")) return null;
                return Num();
            }

            bool Lit(string w)
            {
                if (string.CompareOrdinal(s, i, w, 0, w.Length) != 0) return false;
                i += w.Length;
                return true;
            }

            object Obj(int depth)
            {
                i++;
                var d = new Dictionary<string, object>();
                Ws();
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    Ws();
                    if (i >= s.Length || s[i] != '"') throw new FormatException();
                    string key = Str();
                    Ws();
                    if (i >= s.Length || s[i] != ':') throw new FormatException();
                    i++;
                    d[key] = Value(depth + 1);
                    if (d.Count > 64) throw new FormatException();
                    Ws();
                    if (i >= s.Length) throw new FormatException();
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return d; }
                    throw new FormatException();
                }
            }

            object Arr(int depth)
            {
                i++;
                var l = new List<object>();
                Ws();
                if (i < s.Length && s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Value(depth + 1));
                    if (l.Count > 1024) throw new FormatException();
                    Ws();
                    if (i >= s.Length) throw new FormatException();
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return l; }
                    throw new FormatException();
                }
            }

            string Str()
            {
                i++;
                var sb = new StringBuilder();
                while (true)
                {
                    if (i >= s.Length) throw new FormatException();
                    char c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c < 0x20) throw new FormatException();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (i >= s.Length) throw new FormatException();
                    char e = s[i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw new FormatException();
                            sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
                            i += 4;
                            break;
                        default: throw new FormatException();
                    }
                }
            }

            object Num()
            {
                int start = i;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
                if (i == start) throw new FormatException();
                return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }
}

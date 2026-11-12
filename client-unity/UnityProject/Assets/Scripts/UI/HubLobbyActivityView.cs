using System;
using System.Text;
using TMPro;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The hub's lobby-activity card (legacy ui/lobbyActivity.ts): who is in a game and who waits in the hub. Polled every 15 s while the
    /// hub is up (never during a match); a signed-in hub posts its presence as the poll, an anonymous one only reads. All text is plain.
    /// </summary>
    public sealed class HubLobbyActivityView : MonoBehaviour
    {
        RectTransform _panel;
        TMP_Text _body;
        MatchClient _client;
        LobbyActivityTransport _transport;
        LobbyActivityModel _model = LobbyActivityModel.Empty;
        float _receivedAt = float.NegativeInfinity, _nextPollAt, _nextRenderAt;
        bool _inHub, _shown, _inFlight;
        int _generation;
        string _tabId, _presenceName, _presenceToken;
        Uri _presenceBase;

        public bool IsVisible => _panel != null && _panel.gameObject.activeSelf;
        public LobbyActivityModel Model => _model;
        public string Text => _body == null ? "" : _body.text;

        public void Initialize(Transform root, MatchClient client)
        {
            _client = client;
            _tabId = Guid.NewGuid().ToString("N");
            _transport = gameObject.GetComponent<LobbyActivityTransport>() ?? gameObject.AddComponent<LobbyActivityTransport>();
            _panel = MythicUi.Panel(root, "HubLobbyActivityPanel", new Vector2(.76f, .06f), new Vector2(.99f, .46f), ShowcasePalette.Panel, false);
            _body = MythicUi.Text(_panel, "LobbyActivityBody", "", new Vector2(.02f, .02f), new Vector2(.98f, .98f), 15, ShowcasePalette.Text, TextAlignmentOptions.TopLeft);
            _panel.gameObject.SetActive(false);
        }

        /// <summary>Card size and right/top inset in HUD units (legacy stage): the empty top-right floor of the hub room.</summary>
        public const float CardWidth = 300f, CardHeight = 150f, InsetRight = 12f, InsetTop = 122f;

        /// <summary>Places the card for the stage <paramref name="viewport"/> (HUD units) clear of the hub room's tiles, top right under the wordmark row.</summary>
        public void ApplyViewport(HudViewport viewport)
        {
            if (_panel == null) return;
            float w = Mathf.Max(viewport.UiWidth, 320f), h = Mathf.Max(viewport.UiHeight, 320f);
            float width = Mathf.Min(CardWidth, w - 2f * InsetRight), height = Mathf.Min(CardHeight, h - InsetTop - InsetRight);
            _panel.anchorMin = new Vector2(1f - (InsetRight + width) / w, 1f - (InsetTop + height) / h);
            _panel.anchorMax = new Vector2(1f - InsetRight / w, 1f - InsetTop / h);
            _panel.offsetMin = _panel.offsetMax = Vector2.zero;
        }

        /// <summary>Called every frame by the hub: <paramref name="inHub"/> while the join menu is up, <paramref name="shown"/> when no other hub panel covers the card.</summary>
        public void SetHub(bool inHub, bool shown)
        {
            if (_panel == null) return;
            if (inHub != _inHub)
            {
                _inHub = inHub;
                if (inHub) { _nextPollAt = 0; Render(); }
                else Leave();
            }
            if (shown != _shown || _panel.gameObject.activeSelf != (inHub && shown))
            {
                _shown = shown;
                _panel.gameObject.SetActive(inHub && shown);
                if (inHub && shown) Render();
            }
        }

        void Update()
        {
            if (!_inHub || _client == null) return;
            if (Time.realtimeSinceStartup >= _nextPollAt && !_inFlight) Poll();
            else if (_shown && Time.realtimeSinceStartup >= _nextRenderAt) { _nextRenderAt = Time.realtimeSinceStartup + 1f; Render(); }
        }

        void Poll()
        {
            _nextPollAt = Time.realtimeSinceStartup + LobbyActivity.PollMs / 1000f;
            AccountEndpoint endpoint;
            try { endpoint = AccountEndpoint.FromPage(_client.PageUrl, string.IsNullOrEmpty(_client.AccountApi) ? null : _client.AccountApi); }
            catch (ArgumentException) { Render(); return; }
            _inFlight = true;
            int generation = _generation;
            Action<int, string> done = (status, body) =>
            {
                _inFlight = false;
                if (generation != _generation || !_inHub) return;
                if (status == 200)
                {
                    var parsed = LobbyActivity.Parse(body);
                    // A failed or unreadable poll keeps the last good snapshot and its age.
                    if (parsed.Available) { _model = parsed; _receivedAt = Time.realtimeSinceStartup; }
                }
                Render();
            };
            if (TryPresence(endpoint, out string name, out string token) && LobbyActivityTransport.PresenceBody(name, _tabId) != null)
            {
                _presenceBase = endpoint.ApiBase; _presenceName = name; _presenceToken = token;
                _transport.Heartbeat(endpoint.ApiBase, token, name, _tabId, done);
            }
            else _transport.Get(endpoint.ApiBase, null, done);
        }

        bool TryPresence(AccountEndpoint endpoint, out string name, out string token)
        {
            name = token = null;
            var snapshot = _client.AccountOwner?.Snapshot;
            if (snapshot == null || snapshot.State != AccountHubState.Owned || string.IsNullOrEmpty(snapshot.SelectedName)) return false;
            try
            {
                string normalized = AccountEndpoint.NormalizeName(snapshot.SelectedName);
                string stored = new PlayerPrefsAccountCredentials().Read(endpoint.StorageScope, normalized);
                if (!AccountSession.ValidToken(stored)) return false;
                name = snapshot.SelectedName; token = stored;
                return true;
            }
            catch (ArgumentException) { return false; }
        }

        void Leave()
        {
            _generation++;
            _inFlight = false;
            if (_presenceToken != null && _transport != null) _transport.Withdraw(_presenceBase, _presenceToken, _presenceName, _tabId);
            _presenceToken = null;
        }

        void OnDisable() { if (_inHub) { _inHub = false; Leave(); } }
        void OnApplicationQuit() { if (_inHub) { _inHub = false; Leave(); } }

        void Render()
        {
            if (_body == null) return;
            double age = (Time.realtimeSinceStartup - _receivedAt) * 1000.0;
            _body.text = Compose(_model, _model.Available && age <= LobbyActivity.StaleMs ? (long)Math.Max(0, age) : long.MaxValue, _model.Available);
        }

        /// <summary>The card text (legacy panel content). <paramref name="ageMs"/> is the age of <paramref name="model"/>; names are already plain and bounded.</summary>
        public static string Compose(LobbyActivityModel model, long ageMs, bool hadData)
        {
            bool stale = LobbyActivity.IsStale(model, ageMs);
            var sb = new StringBuilder();
            sb.Append(stale ? LobbyActivity.PanelTitle : LobbyActivity.PanelHeader(model)).Append('\n');
            if (stale)
            {
                sb.Append(hadData ? LobbyActivity.StatusStale : LobbyActivity.StatusNever).Append("\n\n");
                sb.Append(LobbyActivity.GameHeading).Append('\n').Append(LobbyActivity.Unavailable).Append("\n\n");
                sb.Append(LobbyActivity.WaitingHeading).Append('\n').Append(LobbyActivity.Unavailable);
                return sb.ToString();
            }
            sb.Append('\n');
            if (model.Rooms.Count == 0) sb.Append(LobbyActivity.GameHeading).Append('\n').Append(LobbyActivity.NoGame).Append('\n');
            foreach (var room in model.Rooms)
            {
                sb.Append(LobbyActivity.RoomHeading(room)).Append(" · ").Append(LobbyActivity.PhaseLabel(room.Phase)).Append('\n');
                if (room.Players.Count == 0) sb.Append(LobbyActivity.NoPlayers).Append('\n');
                foreach (var p in room.Players) sb.Append(p.Name).Append(" · ").Append(p.Bot ? "Bot" : "Human").Append('\n');
            }
            sb.Append('\n').Append(LobbyActivity.WaitingTitle(model)).Append('\n');
            if (model.Waiting.Count == 0) sb.Append(LobbyActivity.NoWaiting);
            foreach (var p in model.Waiting) sb.Append(p.Name).Append(" · Human\n");
            return sb.ToString().TrimEnd('\n');
        }
    }
}

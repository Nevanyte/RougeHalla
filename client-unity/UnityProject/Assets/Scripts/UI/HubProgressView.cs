using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TMPro;
using Roguehalla.Net;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public enum HubProgressTab { Profile, Achievements, Leaderboard }

    /// <summary>Read-only account progress panes. All values come from the account API or its published snapshot.</summary>
    public sealed class HubProgressView : MonoBehaviour
    {
        sealed class RowPool
        {
            readonly RectTransform _content;
            readonly List<TMP_Text> _rows = new List<TMP_Text>();
            public RowPool(RectTransform content) { _content = content; }
            public void Set(IReadOnlyList<string> values)
            {
                for (int i = 0; i < values.Count; i++)
                {
                    if (i == _rows.Count) _rows.Add(CreateRow(_content, i));
                    TMP_Text row = _rows[i]; row.text = values[i]; row.gameObject.SetActive(true);
                }
                for (int i = values.Count; i < _rows.Count; i++)
                {
                    _rows[i].text = string.Empty;
                    _rows[i].gameObject.SetActive(false);
                }
                LayoutRebuilder.MarkLayoutForRebuild(_content);
            }
            static TMP_Text CreateRow(Transform parent, int index)
            {
                var panel = MythicUi.Panel(parent, "ProgressRow" + index, Vector2.zero, Vector2.one,
                    index % 2 == 0 ? ShowcasePalette.PanelRaised : ShowcasePalette.Panel, false);
                var layout = panel.gameObject.AddComponent<LayoutElement>(); layout.minHeight = 58; layout.preferredHeight = -1;
                var stack = panel.gameObject.AddComponent<VerticalLayoutGroup>();
                stack.padding = new RectOffset(14, 12, 8, 8); stack.childAlignment = TextAnchor.MiddleLeft;
                stack.childControlWidth = true; stack.childControlHeight = true; stack.childForceExpandWidth = true; stack.childForceExpandHeight = false;
                var text = MythicUi.Text(panel, "Value", "", Vector2.zero, Vector2.one, 16, ShowcasePalette.Text);
                text.enableAutoSizing = false; text.enableWordWrapping = true; text.alignment = TextAlignmentOptions.MidlineLeft;
                text.margin = Vector4.zero;
                return text;
            }
        }

        RectTransform _root, _card;
        Button[] _tabs = new Button[3];
        Button _close, _monthPrevious, _monthNext, _ownRank;
        TMP_Text _monthLabel;
        ScrollRect[] _scrolls = new ScrollRect[3];
        RowPool[] _rows = new RowPool[3];
        AccountCoordinator _owner;
        AccountHubFlow _flow;
        AccountApiService _api;
        IReadOnlyList<AccountAchievementDefinition> _achievementCatalog = Array.Empty<AccountAchievementDefinition>();
        Action _closeCallback;
        HubProgressTab _tab;
        string _month;
        IReadOnlyList<string> _months = Array.Empty<string>();
        AccountLeaderboard _publicLeaderboard;
        bool _initialized, _includeMyRank;
        int _viewGeneration;
        int _profileReadGeneration;
        bool _profileReadInFlight;
        string _profileReadName;
        CancellationTokenSource _readCancellation;
        string _selectedName;

        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;
        public HubProgressTab CurrentTab => _tab;
        public bool IncludeMyRank => _includeMyRank;

        public void Initialize(Transform root, AccountCoordinator owner, Action close = null)
        {
            if (_initialized) throw new InvalidOperationException("HubProgressView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            _initialized = true; _owner = owner; _flow = owner != null ? owner.Flow : null; _api = owner != null ? owner.Api : null;
            _closeCallback = close;
            _root = MythicUi.Panel(root, "HubProgressOverlay", Vector2.zero, Vector2.one, UiTheme.Current.Scrim);
            var dismiss = _root.gameObject.AddComponent<ModalDismissSurface>(); dismiss.Dismiss = CloseByUser;
            _card = MythicUi.Panel(_root, "HubProgressCard", new Vector2(.09f, .055f), new Vector2(.91f, .945f), ShowcasePalette.Panel);
            MythicUi.Text(_card, "ProgressTitle", "RECORDS", new Vector2(.035f, .925f), new Vector2(.68f, .995f), 27, ShowcasePalette.Gold, heading: true);
            _close = MythicUi.Button(_card, "CloseProgress", "CLOSE · ESC", new Vector2(.76f, .925f), new Vector2(.965f, .99f), CloseByUser, MythicUi.ButtonStyle.Secondary);
            string[] tabNames = { "PROFILE", "ACHIEVEMENTS", "LEADERBOARD" };
            for (int i = 0; i < _tabs.Length; i++)
            {
                int index = i;
                _tabs[i] = MythicUi.Button(_card, "ProgressTab" + i, tabNames[i], new Vector2(.035f + i * .313f, .865f), new Vector2(.335f + i * .313f, .925f), () => Show((HubProgressTab)index), i == 0 ? MythicUi.ButtonStyle.Primary : MythicUi.ButtonStyle.Secondary);
                _scrolls[i] = CreateScroll(_card, "ProgressScroll" + i, new Vector2(.035f, .075f), new Vector2(.965f, .85f), out var content);
                _rows[i] = new RowPool(content);
            }
            _monthPrevious = MythicUi.Button(_card, "PreviousMonth", "‹", new Vector2(.035f, .015f), new Vector2(.09f, .07f), () => MoveMonth(-1), MythicUi.ButtonStyle.Quiet);
            _monthLabel = MythicUi.Text(_card, "SelectedMonth", "", new Vector2(.095f, .015f), new Vector2(.25f, .07f), 16, ShowcasePalette.MutedText, TextAlignmentOptions.Center);
            _monthNext = MythicUi.Button(_card, "NextMonth", "›", new Vector2(.255f, .015f), new Vector2(.31f, .07f), () => MoveMonth(1), MythicUi.ButtonStyle.Quiet);
            _ownRank = MythicUi.Button(_card, "ToggleOwnRank", "INCLUDE MY RANK · OFF", new Vector2(.70f, .015f), new Vector2(.965f, .07f), ToggleOwnRank, MythicUi.ButtonStyle.Quiet);
            LoadCatalog();
            if (_flow != null) { _selectedName = _flow.Snapshot.SelectedName; _flow.Changed += OnFlowChanged; }
            Show(HubProgressTab.Profile); SetVisible(false);
        }

        /// <summary>Docks the card in the shared hub panel area for the current window (see <see cref="HubPanelDock"/>).</summary>
        public void ApplyViewport(HudViewport viewport) { HubPanelDock.Apply(_card, viewport); }

        public void Show(HubProgressTab tab)
        {
            if (tab < HubProgressTab.Profile || tab > HubProgressTab.Leaderboard) throw new ArgumentOutOfRangeException(nameof(tab));
            _tab = tab;
            for (int i = 0; i < _scrolls.Length; i++) _scrolls[i].gameObject.SetActive(i == (int)tab);
            for (int i = 0; i < _tabs.Length; i++) SetTabStyle(_tabs[i], i == (int)tab);
            bool board = tab == HubProgressTab.Leaderboard;
            _monthPrevious.gameObject.SetActive(board); _monthNext.gameObject.SetActive(board); _monthLabel.gameObject.SetActive(board); _ownRank.gameObject.SetActive(board);
            if (IsVisible && EventSystem.current != null) EventSystem.current.SetSelectedGameObject(_scrolls[(int)tab].gameObject);
            if (IsVisible) RefreshCurrent();
        }

        public void SetVisible(bool visible)
        {
            if (_root == null) return;
            if (_root.gameObject.activeSelf == visible)
            {
                if (!visible && EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null &&
                    EventSystem.current.currentSelectedGameObject.transform.IsChildOf(_root))
                    EventSystem.current.SetSelectedGameObject(null);
                return;
            }
            _root.gameObject.SetActive(visible);
            if (visible)
            {
                _root.SetAsLastSibling();
                if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(_scrolls[(int)_tab].gameObject);
                RefreshCurrent();
            }
            else InvalidateReads();
            if (!visible && EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null &&
                EventSystem.current.currentSelectedGameObject.transform.IsChildOf(_root))
                EventSystem.current.SetSelectedGameObject(null);
        }

        void RefreshCurrent()
        {
            if (_tab == HubProgressTab.Leaderboard) { BeginLeaderboardRead(); return; }
            AccountHubSnapshot snapshot = _flow != null ? _flow.Snapshot : null;
            AccountFullProfile profile = snapshot != null && snapshot.State == AccountHubState.Owned ? snapshot.FullProfile : null;
            if (profile != null)
            {
                RenderProfile(profile); RenderAchievements(profile); return;
            }
            RenderUnavailable(snapshot != null ? FailureCopy(snapshot) : "Account progress is unavailable.");
            if (_api != null && snapshot != null && snapshot.State == AccountHubState.Owned)
                RequestProfileRead(_viewGeneration, _tab, snapshot.SelectedName);
        }

        void RequestProfileRead(int generation, HubProgressTab tab, string name)
        {
            if (_api == null || _profileReadInFlight && string.Equals(_profileReadName, name, StringComparison.Ordinal)) return;
            _profileReadInFlight = true; _profileReadName = name;
            int request = ++_profileReadGeneration;
            _ = ReadProfile(request, generation, tab, name);
        }

        async Task ReadProfile(int request, int generation, HubProgressTab tab, string name)
        {
            try
            {
                var result = await _api.ReadProfileAsync();
                if (!PublicationCurrent(generation, tab, name) || !_api.IsCurrent(result)) return;
                var latest = _flow.Snapshot;
                if (latest.State == AccountHubState.Owned && latest.FullProfile != null)
                { RenderProfile(latest.FullProfile); RenderAchievements(latest.FullProfile); }
                else RenderUnavailable(FailureCopy(latest));
            }
            catch { if (PublicationCurrent(generation, tab, name)) RenderUnavailable("Profile could not be loaded. Try again shortly."); }
            finally
            {
                if (_profileReadGeneration == request) { _profileReadInFlight = false; _profileReadName = null; }
            }
        }

        void BeginLeaderboardRead()
        {
            InvalidateReads();
            int generation = _viewGeneration; string name = _flow?.Snapshot?.SelectedName;
            string requestedMonth = _month;
            SetBoardStatus("Loading leaderboard…");
            if (_api == null) { SetBoardStatus("Leaderboard is unavailable."); return; }
            _readCancellation = new CancellationTokenSource();
            _ = ReadLeaderboard(generation, name, requestedMonth, _includeMyRank, _readCancellation.Token);
        }

        async Task ReadLeaderboard(int generation, string name, string month, bool includeOwner, CancellationToken cancellation)
        {
            try
            {
                var result = await _api.ReadLeaderboardAsync(month, 20, includeOwner, cancellation);
                if (!PublicationCurrent(generation, HubProgressTab.Leaderboard, name) || !_api.IsCurrent(result)) return;
                if (result.Failure != AccountApiFailure.None || result.Leaderboard == null)
                { SetBoardStatus(FailureCopy(result.Failure)); return; }
                RenderLeaderboard(result.Leaderboard);
            }
            catch { if (PublicationCurrent(generation, HubProgressTab.Leaderboard, name)) SetBoardStatus("Leaderboard could not be loaded. Try again shortly."); }
        }

        bool PublicationCurrent(int generation, HubProgressTab tab, string name) => this != null && IsVisible && _viewGeneration == generation && _tab == tab &&
            string.Equals(name ?? "", _flow?.Snapshot?.SelectedName ?? "", StringComparison.Ordinal);

        void OnFlowChanged(AccountHubSnapshot snapshot)
        {
            string selected = snapshot?.SelectedName ?? "";
            bool changedOwner = !string.Equals(_selectedName ?? "", selected, StringComparison.Ordinal);
            _selectedName = selected;
            if (changedOwner)
            {
                InvalidateReads(); _profileReadGeneration++; _profileReadInFlight = false; _profileReadName = null;
                ClearPrivateRows(); ClearPrivateLeaderboard(); _month = null; _months = Array.Empty<string>();
                SetIncludeMyRank(false);
            }
            if (snapshot == null || snapshot.State != AccountHubState.Owned || snapshot.Profile == null)
            {
                if (!changedOwner)
                {
                    InvalidateReads(); _profileReadGeneration++; _profileReadInFlight = false; _profileReadName = null;
                }
                ClearPrivateRows();
                ClearPrivateLeaderboard();
                if (IsVisible && _tab != HubProgressTab.Leaderboard) RenderUnavailable(snapshot != null ? FailureCopy(snapshot) : "Account progress is unavailable.");
                return;
            }
            if (snapshot.FullProfile != null)
            {
                RenderProfile(snapshot.FullProfile); RenderAchievements(snapshot.FullProfile);
            }
            else if (IsVisible && _tab != HubProgressTab.Leaderboard)
            {
                RenderUnavailable(snapshot.FullProfileFailure == AccountFailure.None ? "Detailed records are not available yet." : FailureCopy(snapshot));
                if (_api != null && _tab == HubProgressTab.Profile) RequestProfileRead(_viewGeneration, _tab, selected);
            }
        }

        void RenderProfile(AccountFullProfile profile)
        {
            if (profile == null) return;
            var values = new List<string>
            {
                "PROFILE  ·  " + SafeText(profile.Name), "CURRENT GV  ·  " + FormatCount(profile.Gv), "LIFETIME GV  ·  " + FormatCount(profile.GvLifetime),
                "RUNS  ·  " + FormatCount(profile.Stats.Runs), "WINS  ·  " + FormatCount(profile.Stats.Wins), "DRAWS  ·  " + FormatCount(profile.Stats.Draws),
                "DEATHS  ·  " + FormatCount(profile.Stats.Deaths), "KILLS  ·  " + FormatCount(profile.Stats.Kills), "QUALIFIED WINS  ·  " + FormatCount(profile.Progress.QualifiedWins),
                "BOUNTY RUNS  ·  " + FormatCount(profile.Progress.BountyRuns), "BEST RUN KILLS  ·  " + FormatCount(profile.Progress.BestRunKills), "MONTHLY GV"
            };
            AddMap(values, profile.GvByMonth);
            values.Add("WINS BY FACTION"); AddMap(values, profile.Progress.WinsByFaction);
            values.Add("WINS BY WEAPON"); AddMap(values, profile.Progress.WinsByWeapon);
            _rows[(int)HubProgressTab.Profile].Set(values);
        }

        void RenderAchievements(AccountFullProfile profile)
        {
            _rows[(int)HubProgressTab.Achievements].Set(BuildAchievementRows(profile, _achievementCatalog));
        }

        void RenderLeaderboard(AccountLeaderboard board)
        {
            _months = board.Months ?? Array.Empty<string>();
            if (_months.Count > 0)
            {
                int selected = IndexOfMonth(_months, board.Month);
                _month = selected >= 0 ? _months[selected] : _months[0];
            }
            else _month = board.Month;
            _monthLabel.text = string.IsNullOrEmpty(board.Month) ? "CURRENT" : board.Month;
            _monthPrevious.interactable = MonthIndex() > 0;
            _monthNext.interactable = MonthIndex() >= 0 && MonthIndex() < _months.Count - 1;
            _publicLeaderboard = new AccountLeaderboard(board.Month, board.Entries, board.Months, null);
            _rows[(int)HubProgressTab.Leaderboard].Set(BuildLeaderboardRows(board, includePrivateRank: true));
        }

        static IReadOnlyList<string> BuildLeaderboardRows(AccountLeaderboard board, bool includePrivateRank)
        {
            var values = new List<string> { "MONTH  ·  " + (string.IsNullOrEmpty(board.Month) ? "CURRENT" : board.Month) };
            for (int i = 0; i < board.Entries.Count; i++)
            {
                var entry = board.Entries[i];
                values.Add((i + 1).ToString(CultureInfo.InvariantCulture) + "  ·  " + SafeText(entry.Name) +
                    (string.IsNullOrEmpty(entry.Title) ? "" : "  ·  " + SafeText(entry.Title)) + "\nGV  ·  " + FormatCount(entry.Gv));
            }
            if (includePrivateRank && board.You != null) values.Add("YOUR RANK  ·  " + FormatCount(board.You.Rank) + "\nGV  ·  " + FormatCount(board.You.Gv));
            return values.AsReadOnly();
        }

        void ClearPrivateLeaderboard()
        {
            if (_publicLeaderboard != null)
                _rows[(int)HubProgressTab.Leaderboard].Set(BuildLeaderboardRows(_publicLeaderboard, includePrivateRank: false));
            else SetBoardStatus("Select a leaderboard view to load public results.");
        }

        void RenderUnavailable(string message)
        {
            if (_tab == HubProgressTab.Profile) _rows[(int)HubProgressTab.Profile].Set(new[] { message });
            else if (_tab == HubProgressTab.Achievements) _rows[(int)HubProgressTab.Achievements].Set(new[] { message });
        }

        void ClearPrivateRows()
        {
            _rows[(int)HubProgressTab.Profile].Set(Array.Empty<string>());
            _rows[(int)HubProgressTab.Achievements].Set(Array.Empty<string>());
        }

        void SetBoardStatus(string message) => _rows[(int)HubProgressTab.Leaderboard].Set(new[] { message });
        void ToggleOwnRank() { SetIncludeMyRank(!_includeMyRank); if (IsVisible && _tab == HubProgressTab.Leaderboard) BeginLeaderboardRead(); }
        void SetIncludeMyRank(bool include) { _includeMyRank = include; if (_ownRank != null) _ownRank.GetComponentInChildren<TMP_Text>().text = _includeMyRank ? "INCLUDE MY RANK · ON" : "INCLUDE MY RANK · OFF"; }
        void MoveMonth(int delta)
        {
            int current = MonthIndex(); int next = current + delta;
            if (next < 0 || next >= _months.Count) return;
            _month = _months[next]; if (IsVisible && _tab == HubProgressTab.Leaderboard) BeginLeaderboardRead();
        }
        int MonthIndex() => IndexOfMonth(_months, _month);
        static int IndexOfMonth(IReadOnlyList<string> months, string month)
        { if (months == null || month == null) return -1; for (int i = 0; i < months.Count; i++) if (string.Equals(months[i], month, StringComparison.Ordinal)) return i; return -1; }

        void LoadCatalog()
        {
            TextAsset asset = Resources.Load<TextAsset>("Account/achievements");
            if (asset != null && AccountFullJson.TryAchievementCatalog(asset.text, out var catalog)) _achievementCatalog = catalog;
        }

        static void AddMap(List<string> output, IReadOnlyDictionary<string, long> map)
        { foreach (var pair in map.OrderBy(x => x.Key, StringComparer.Ordinal)) output.Add(SafeText(pair.Key) + "  ·  " + FormatCount(pair.Value)); }
        public static IReadOnlyList<string> BuildAchievementRows(AccountFullProfile profile, IReadOnlyList<AccountAchievementDefinition> catalog)
        {
            if (profile == null) throw new ArgumentNullException(nameof(profile));
            catalog = catalog ?? Array.Empty<AccountAchievementDefinition>();
            var values = new List<string>(); var known = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in catalog)
            {
                if (entry == null || string.IsNullOrEmpty(entry.Id)) continue;
                known.Add(entry.Id);
                bool earned = profile.Achievements.TryGetValue(entry.Id, out long when);
                values.Add((earned ? "EARNED  ·  " : "NOT RECORDED  ·  ") + SafeText(entry.Name) + "\n" + SafeText(entry.Description) +
                    (entry.Rewards.Count == 0 ? "" : "\nREWARDS  ·  " + string.Join(", ", entry.Rewards.Select(SafeText))) +
                    (earned ? "\nRECORDED  ·  " + FormatTimestamp(when) : ""));
            }
            foreach (var pair in profile.Achievements.OrderBy(x => x.Key, StringComparer.Ordinal))
                if (!known.Contains(pair.Key)) values.Add("UNKNOWN ACHIEVEMENT  ·  " + SafeText(pair.Key) + "\nServer record  ·  " + FormatTimestamp(pair.Value));
            if (values.Count == 0) values.Add("No achievement records are available.");
            return values.AsReadOnly();
        }
        public static string FormatCount(long value) => value.ToString("N0", CultureInfo.InvariantCulture);
        public static string FormatTimestamp(long unixMilliseconds)
        {
            try { return DateTimeOffset.FromUnixTimeMilliseconds(unixMilliseconds).UtcDateTime.ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture); }
            catch (ArgumentOutOfRangeException) { return unixMilliseconds.ToString(CultureInfo.InvariantCulture) + " ms"; }
        }
        static string SafeText(string value) => string.IsNullOrEmpty(value) ? "—" : value.Replace("\r", " ").Replace("\n", " ");
        static string FailureCopy(AccountHubSnapshot snapshot)
        {
            if (snapshot.State == AccountHubState.Failed)
            {
                if (snapshot.Failure == AccountFailure.InvalidName) return "That profile name is invalid.";
                if (snapshot.Failure == AccountFailure.Taken) return "This profile belongs to another owner.";
                if (snapshot.Failure == AccountFailure.PasscodeRequired) return "Enter the profile passcode to load these records.";
                if (snapshot.Failure == AccountFailure.RateLimited) return "Too many requests. Try again shortly.";
                if (snapshot.Failure == AccountFailure.Unreadable) return "The profile response could not be read.";
                return "Profile could not be loaded. Try again shortly.";
            }
            if (snapshot.State == AccountHubState.Opening || snapshot.State == AccountHubState.Refreshing) return "Loading profile…";
            if (snapshot.State == AccountHubState.Owned) return snapshot.FullProfileFailure == AccountFailure.None ?
                "Detailed records are not available yet." : "Detailed records could not be loaded. Select this tab again to retry.";
            return "Select and open a profile to view private records.";
        }
        static string FailureCopy(AccountApiFailure failure)
        {
            switch (failure)
            {
                case AccountApiFailure.NoOwner: return "Open your profile to include your private rank.";
                case AccountApiFailure.RateLimited: return "Too many requests. Try again shortly.";
                case AccountApiFailure.BadRequest: return "The leaderboard request could not be used.";
                case AccountApiFailure.Forbidden: return "Your private rank is unavailable for this profile.";
                case AccountApiFailure.Unreadable: return "The leaderboard response could not be read.";
                case AccountApiFailure.Cancelled: case AccountApiFailure.Stale: return "Leaderboard request was replaced.";
                default: return "Leaderboard could not be loaded. Try again shortly.";
            }
        }
        static ScrollRect CreateScroll(Transform parent, string name, Vector2 min, Vector2 max, out RectTransform content)
        {
            var frame = MythicUi.Rect(parent, name, min, max); var scroll = frame.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false; scroll.vertical = true; scroll.movementType = ScrollRect.MovementType.Clamped; scroll.scrollSensitivity = 42; scroll.inertia = true;
            var viewport = MythicUi.Rect(frame, "Viewport", Vector2.zero, Vector2.one);
            var image = viewport.gameObject.AddComponent<Image>(); image.color = new Color(1, 1, 1, .01f); image.raycastTarget = true;
            viewport.gameObject.AddComponent<RectMask2D>();
            content = MythicUi.Rect(viewport, "Content", new Vector2(0, 1), new Vector2(1, 1)); content.pivot = new Vector2(.5f, 1);
            var layout = content.gameObject.AddComponent<VerticalLayoutGroup>(); layout.childAlignment = TextAnchor.UpperCenter; layout.spacing = 8;
            layout.padding = new RectOffset(8, 8, 8, 8); layout.childControlWidth = true; layout.childControlHeight = false; layout.childForceExpandWidth = true; layout.childForceExpandHeight = false;
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport; scroll.content = content; scroll.scrollSensitivity = 42;
            frame.gameObject.AddComponent<KeyboardScrollPane>().Initialize(scroll);
            return scroll;
        }
        static void SetTabStyle(Button button, bool selected)
        {
            var colors = button.colors; colors.normalColor = selected ? MythicUi.SelectedFill : ShowcasePalette.PanelRaised;
            colors.highlightedColor = MythicUi.HoverFill; colors.selectedColor = colors.highlightedColor; button.colors = colors;
            var label = button.GetComponentInChildren<TMP_Text>(); if (label != null) label.color = selected ? ShowcasePalette.Text : ShowcasePalette.MutedText;
        }
        void CloseByUser() { SetVisible(false); _closeCallback?.Invoke(); }
        void InvalidateReads()
        {
            _viewGeneration++;
            if (_readCancellation != null) { _readCancellation.Cancel(); _readCancellation.Dispose(); _readCancellation = null; }
        }
        void OnDestroy()
        {
            if (_flow != null) _flow.Changed -= OnFlowChanged;
            InvalidateReads();
        }
    }
}

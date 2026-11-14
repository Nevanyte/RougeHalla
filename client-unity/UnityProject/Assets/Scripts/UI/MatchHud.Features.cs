using System;
using System.Collections.Generic;
using Roguehalla.Net;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        BuildDrawer _drawer;
        TacticalMapController _map;
        RectTransform _help;
        HelpGuideView _helpGuide;
        bool _chestFocus, _chestConsumedDigits;
        PointerEventData _pointerQuery;
        readonly List<RaycastResult> _pointerHits = new List<RaycastResult>(32);
        ModernSettingsView _modernSettings;
        UiDisplayPreferences _uiPrefs;
        TMP_Text _phaseStrip, _metrics;
        double _nextMetricsAt;
        float _frameAverage;
        readonly TMP_Text[] _gainValues = new TMP_Text[9];
        Roguehalla.Net.Protocol.WireBuildSummary _shownSummary;
        IReadOnlyList<Roguehalla.Net.Ui.BuildCell> _gainCells = Array.Empty<Roguehalla.Net.Ui.BuildCell>();
        bool _gainsShown;
        readonly UnityEngine.UI.Image[] _weaponIcons = new UnityEngine.UI.Image[2];
        readonly UnityEngine.UI.Image[] _weaponActiveBars = new UnityEngine.UI.Image[2];
        UnityEngine.UI.Image _potionIcon;
        TMP_Text _wishSummary;
        RectTransform _wishDetails;
        RectTransform _vitalsPanel, _buildStrip, _combatActions, _damagePanel;
        TMP_Text _combatStats;
        bool _worldHudVisible = true;
        GameObject _worldHudFocus;
        bool WorldHudVisible => !BlocksKeyboardInput && !(_map?.IsOpen ?? false);
        // Panels (plate, champion, hotbar, minimap) read console focus only while the console is open; the closed CONSOLE button takes focus on a plain Tab.
        bool PanelHudVisible => !BlocksKeyboardInputCore(_trainingConsole?.IsOpen == true) && !(_map?.IsOpen ?? false);
        public TacticalMapController TacticalMap => _map;
        public bool ChestOwnsDigits => _chestFocus || _chestConsumedDigits;
        public bool ConsumesArrowNavigation => _chestFocus || _map != null && _map.ContainsFocus || ReadingPaneSelected;
        bool ReadingPaneSelected => EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null &&
            EventSystem.current.currentSelectedGameObject.activeInHierarchy &&
            EventSystem.current.currentSelectedGameObject.GetComponent<KeyboardScrollPane>() != null;
        public bool BlocksKeyboardInput => BlocksKeyboardInputCore(true);
        bool BlocksKeyboardInputCore(bool consoleFocus) => ResumeChooserVisible || consoleFocus && TrainingInputConsumed || TrainingOwnsKeyboardCore(consoleFocus) || (_client != null && _client.LaunchPending) || _menu != null && (_menu.gameObject.activeSelf || _results.gameObject.activeSelf ||
            _settings.gameObject.activeSelf || (_signIn != null && _signIn.gameObject.activeSelf) || AnyHubPanelVisible || PlayerFlowVisible || Typing || (_drawer != null && _drawer.IsVisible) || (_help != null && _help.gameObject.activeSelf) || (_map != null && _map.IsPlanning));
        public bool BlocksPointerInput => BlocksKeyboardInput || (_map != null && _map.PointerBlocked) ||
            PointerHitsUi();
        bool PointerHitsUi()
        {
            if (EventSystem.current == null || Mouse.current == null) return false;
            if (_pointerQuery == null) _pointerQuery = new PointerEventData(EventSystem.current);
            _pointerQuery.Reset(); _pointerQuery.position = Mouse.current.position.ReadValue();
            _pointerHits.Clear(); EventSystem.current.RaycastAll(_pointerQuery, _pointerHits);
            return _pointerHits.Count > 0;
        }
        Transform FocusRoot
        {
            get
            {
                if (ResumeChooserVisible) return _resumeOverlay;
                if (_recovery != null && _recovery.IsVisible) return _recovery.Root;
                if (_signIn != null && _signIn.gameObject.activeSelf) return _signIn;
                if (_settings.gameObject.activeSelf) return _settings;
                if (_hubGuide != null && _hubGuide.IsVisible) return _hubGuide.FocusRoot;
                if (_hubProgress != null && _hubProgress.IsVisible) return _hubProgress.Root;
                if (_hubCosmetics != null && _hubCosmetics.IsVisible) return _hubCosmetics.Root;
                if (PlayerFlowFocus != null) return PlayerFlowFocus;
                if (_help != null && _help.gameObject.activeSelf) return _help;
                if (_drawer != null && _drawer.IsVisible) return _root.Find("BuildDrawer");
                if (_results.gameObject.activeSelf) return _results;
                if (_menu.gameObject.activeSelf) return _root;
                if (_chestFocus) return _rewards;
                if (_map != null && _map.IsPlanning) return _root.Find("TacticalMap/PlanningDecisions");
                if (_trainingConsole?.ActionsAvailable == true) return _trainingConsole.IsOpen ? _trainingConsole.Panel : _trainingConsole.Root;
                return null;
            }
        }
        bool Typing
        {
            get
            {
                var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
                var input = selected != null ? selected.GetComponent<TMP_InputField>() : null;
                return input != null && input.isFocused;
            }
        }

        /// <summary>
        /// Creates the legacy-sized HUD stages (1 unit = 1 legacy CSS px, see <see cref="HudStage"/>): the in-world HUD stage, and a chrome
        /// stage kept above every modal for the always-visible chrome buttons and the settings/help cards.
        /// </summary>
        void EnsureStage()
        {
            if (_stage != null) return;
            _stage = CreateStage("HudStage", out _stageScaler);
            _chromeStage = CreateStage("ChromeStage", out _chromeScaler);
            _stageScaler.ViewportChanged += ApplyViewport; _chromeScaler.ViewportChanged += ApplyViewport;
        }

        RectTransform CreateStage(string name, out HudStage scaler)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(HudStage));
            go.transform.SetParent(_root, false);
            scaler = go.GetComponent<HudStage>();
            scaler.Relayout();
            return (RectTransform)go.transform;
        }

        /// <summary>Re-solves every size that depends on the laid-out width or height (legacy min()/clamp() widths).</summary>
        void ApplyViewport(HudViewport viewport) { ApplyLegacyViewport(viewport); }

        /// <summary>Builds the in-world HUD in legacy anchors; see MatchHud.Legacy.cs.</summary>
        void CreateCombatHud()
        {
            EnsureStage();
            _hud = Rect(_stage, "PlayerHUD", 0, 0, 1, 1);
            _edgeThreats = new EdgeThreatView(_hud);
            CreatePlate();
            CreateWeaponBar();
            CreateDeathLine();
            _edgeThreats.Root.SetAsFirstSibling();
        }
        void SetBaseSize(TMP_Text label, float size)
        {
            int i = _scaledText.IndexOf(label); if (i >= 0) _textBaseSize[i] = size;
            label.fontSize = size * _showcaseSettings.TextScale; label.fontSizeMin = label.fontSize * .75f; label.fontSizeMax = label.fontSize;
        }
        SentencedHuntPanel _huntPanel;
        public SentencedHuntPanel HuntPanel => _huntPanel;
        void InitializeFeatures()
        {
            InitializeHubGuides();
            _drawer = gameObject.AddComponent<BuildDrawer>(); _drawer.Initialize(_root, RefreshHeaderActionsVisibility);
            _huntPanel = gameObject.AddComponent<SentencedHuntPanel>(); _huntPanel.Initialize(_hud);
            _uiPrefs = new UiDisplayPreferences();
            _map = gameObject.AddComponent<TacticalMapController>(); _map.Initialize(_client, _root, _uiPrefs, _stage);
            _modernSettings = gameObject.AddComponent<ModernSettingsView>();
            _modernSettings.Initialize(_chromeStage, _showcaseSettings, _map, _uiPrefs, () => _modernSettings.SetVisible(false), () => _client.Leave());
            _settings = _modernSettings.Root;
            _uiPrefs.Changed += ApplyDisplayPreferences;
            ApplyDisplayPreferences();
            _helpGuide = gameObject.AddComponent<HelpGuideView>();
            _helpGuide.Initialize(_chromeStage, () => { ToggleHelpClosed(); });
            _help = _helpGuide.Root;
            InitializePlayerFlows();
        }
        void ApplyDisplayPreferences()
        {
            if (_map == null || _uiPrefs == null) return;
            ApplyLegacyViewport(_viewport);
        }
        // P-UNITY-HUD-STATUS-1: the MatchEnded event's winner (roster id), kept here because Session keeps no copy.
        bool _matchEnded; uint? _winnerId; string _winnerLabel; uint? _winnerLabelFor;
        void NoteMatchEnded(Roguehalla.Net.Protocol.ServerMsg.Events batch)
        {
            foreach (var e in batch.List)
                if (e.Kind == Roguehalla.Net.Protocol.EventKind.MatchEnded) { _matchEnded = true; _winnerId = e.Draw ? null : e.Winner; _winnerLabel = null; _winnerLabelFor = null; }
        }
        // A new match on a reused Session (rematch without a fresh Bind) must not inherit the previous winner: entering InMatch clears it.
        void NoteSessionState(SessionState state) { if (state == SessionState.InMatch) ResetMatchEnded(); }
        void ResetMatchEnded() { _matchEnded = false; _winnerId = null; _winnerLabel = null; _winnerLabelFor = null; }
        string WinnerLabel()
        {
            if (!_winnerId.HasValue) return null;
            if (_winnerLabel != null && _winnerLabelFor == _winnerId) return _winnerLabel;
            var roster = _session.Collections.Roster;
            for (int i = 0; i < roster.Count; i++)
                if (roster[i].Id == _winnerId.Value && roster[i].Name != null)
                { _winnerLabel = Roguehalla.Net.Ui.Indicators.DisplayName(roster[i].Name, roster[i].Bot); _winnerLabelFor = _winnerId; return _winnerLabel; }
            return null;
        }
        void TickMetrics()
        {
            if (_metrics == null || _phaseStrip == null) return;
            _frameAverage = _frameAverage <= 0 ? Time.unscaledDeltaTime : Mathf.Lerp(_frameAverage, Time.unscaledDeltaTime, .08f);
            if (Time.realtimeSinceStartupAsDouble < _nextMetricsAt) return;
            _nextMetricsAt = Time.realtimeSinceStartupAsDouble + .25;
            // Legacy perf pill: "144 fps - 32 ms", each half only when enabled in settings; fps tone good >= 50, warn >= 30, bad below.
            var theme = UiTheme.Current;
            string metrics = ""; Color tone = theme.TextSecondary;
            int fps = _frameAverage > 0 ? Mathf.RoundToInt(1 / _frameAverage) : 0;
            if (_uiPrefs.ShowFps && fps > 0) { metrics = fps + " fps"; tone = fps >= 50 ? theme.Success : fps >= 30 ? theme.Warning : theme.Danger; }
            if (_uiPrefs.ShowPing && _session != null) metrics += (metrics.Length == 0 ? "" : " · ") + (_session.Sync.HasSample ? _session.Sync.LastRttMs.ToString("0") + " ms" : "— ms");
            _metrics.text = metrics; _metrics.color = tone;
            if (_metricsPill != null) _metricsPill.gameObject.SetActive(metrics.Length > 0);
            bool runOver = _session != null && _session.State == SessionState.Ended && _matchEnded;
            if (_session == null || _session.State != SessionState.InMatch && !runOver) { _phaseStrip.text = ""; return; }
            if (_client != null && _client.LaunchPending) { ApplyPhaseStrip("VERIFYING DESTINATION", Roguehalla.Net.Ui.Indicators.ArenaLineTone.Normal); return; }
            if (_client != null && _client.ConfirmedPractice) { ApplyPhaseStrip("PRACTICE · NO RUN REWARDS", Roguehalla.Net.Ui.Indicators.ArenaLineTone.Normal); return; }
            // Legacy top-centre strip (hud.ts statusLine / updateArena), produced by the library. the room minimum comes from ArenaView.MinPlayers; 0 (not delivered) drops "/min".
            MatchPhase phase = runOver ? MatchPhase.Ended : _session.Collections.Plan != null ? MatchPhase.Planning : (_session.Phase ?? MatchPhase.Lobby);
            var text = Roguehalla.Net.Ui.Indicators.PhaseLine(phase, _session.ServerTimeMs, _session.Collections.Arena, _session.Collections.Roster.Count, runOver ? WinnerLabel() : null, out var lineTone);
            if (text == null) { _phaseStrip.text = ""; return; }
            ApplyPhaseStrip(text, lineTone);
        }
        /// <summary>Writes the top-centre phase line and its tone (P-UNITY-HUD-VISUAL-FIX-1 test seam: the tone must reach the label's colour, never tags in its text).</summary>
        public void ApplyPhaseStrip(string text, Roguehalla.Net.Ui.Indicators.ArenaLineTone tone)
        {
            // Colour through the label, never tags: HudUi.Label is plain text (richText = false). Legacy --warn and .hud-arena.sudden (style.css:44,320).
            _phaseStrip.color = tone == Roguehalla.Net.Ui.Indicators.ArenaLineTone.Danger ? (Color)new Color32(0xff, 0x8a, 0x80, 255)
                : tone == Roguehalla.Net.Ui.Indicators.ArenaLineTone.Warn ? (Color)new Color32(0xff, 0xcc, 0x80, 255) : (Color)UiTheme.Current.TextPrimary;
            // Legacy's line is as wide as its text (hud.ts updateArena): size the pill to the measured text, only when the text changed.
            bool changed = _phaseStrip.text != text;
            _phaseStrip.text = text;
            if (changed && _phasePill != null)
            {
                float w = _phaseStrip.GetPreferredValues(text, 0f, 0f).x;
                _phasePill.sizeDelta = new Vector2(Mathf.Max(120f, Mathf.Ceil(w) + 24f), _phasePill.sizeDelta.y);
                PlacePhasePill();
            }
        }
        void ToggleBuild()
        {
            if (_drawer == null || _session == null) return;
            SuspendTrainingForPanel();
            _drawer.SetVisible(!_drawer.IsVisible); if (_drawer.IsVisible) { _map?.SetOpen(false); if (_help != null) _help.gameObject.SetActive(false); } ReleaseChestFocus();
            RefreshHeaderActionsVisibility();
        }
        void ToggleHelp() { if (_help != null) { SuspendTrainingForPanel(); _help.gameObject.SetActive(!_help.gameObject.activeSelf); if (_help.gameObject.activeSelf) { CloseHubPanels(); _drawer?.SetVisible(false); _map?.SetOpen(false); } ReleaseChestFocus(); RefreshHeaderActionsVisibility(); } }
        void ToggleHelpClosed() { ReleaseChestFocus(); RefreshHeaderActionsVisibility(); }
        void RefreshHeaderActionsVisibility()
        {
            bool visible = (_drawer == null || !_drawer.IsVisible) && !PlayerFlowVisible;
            for (int i = 0; i < _headerActions.Length; i++)
                if (_headerActions[i] != null && _headerActions[i].gameObject.activeSelf != visible)
                    _headerActions[i].gameObject.SetActive(visible);
            RefreshJournalLauncher();
        }
        public void ReadUiInput()
        {
            if (TrainingInputConsumed) return;
            if (ReadResumeChooserInput()) return;
            // Text entry owns this whole read; generic navigation must not remove its
            // focus and reclassify the same keys as planning or world input.
            bool typing = Typing;
            bool trainingOwnsKeys = TrainingOwnsKeyboard;
            if (trainingOwnsKeys) ConsumeTrainingUiUpdate();
            RememberWorldHudFocus();
            _chestConsumedDigits = false;
            var kb = Keyboard.current;
            if (kb != null && kb.altKey.isPressed && (kb.enterKey.wasPressedThisFrame || kb.numpadEnterKey.wasPressedThisFrame)) ToggleFullscreen();
            if (_client != null && _client.ConfirmedPractice && BareTrainingEscape(kb) &&
                (TrainingHigherPanelVisible || _chestFocus)) ConsumeTrainingUiUpdate();
            if (ReadTrainingEscape(kb, typing)) return;
            if (!TrainingHigherPanelVisible && ExpandedTrainingDropdown() != null)
            { ConsumeTrainingUiUpdate(); _map?.ReadUiInput(true, true); return; }
            // Recovery's read-only selectable key is still a focused input field. Escape must
            // clear it and close the Hub panel before the ordinary typing gate runs.
            bool aimEsc = _client != null && _client.EscapeConsumedByAim; // this Esc only closed the Frost Wall aim
            if (kb != null && !aimEsc && AnyHubPanelVisible && kb.escapeKey.wasPressedThisFrame && !kb.ctrlKey.isPressed && !kb.altKey.isPressed && !kb.leftMetaKey.isPressed && !kb.rightMetaKey.isPressed)
            {
                var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
                selected?.GetComponent<TMP_InputField>()?.DeactivateInputField();
                EventSystem.current?.SetSelectedGameObject(null);
                CloseHubPanels();
            }
            bool dialog = trainingOwnsKeys || _settings.gameObject.activeSelf || _results.gameObject.activeSelf || _menu.gameObject.activeSelf || (_signIn != null && _signIn.gameObject.activeSelf) || AnyHubPanelVisible ||
                _drawer != null && _drawer.IsVisible || _help != null && _help.gameObject.activeSelf || PlayerFlowVisible;
            bool unrelatedModal = trainingOwnsKeys || _settings.gameObject.activeSelf || _results.gameObject.activeSelf || _menu.gameObject.activeSelf ||
                (_signIn != null && _signIn.gameObject.activeSelf) || AnyHubPanelVisible || PlayerFlowVisible;
            if (kb != null && !typing)
            {
                bool modified = kb.ctrlKey.isPressed || kb.altKey.isPressed || kb.leftMetaKey.isPressed || kb.rightMetaKey.isPressed || kb.shiftKey.isPressed;
                if (!modified)
                {
                    if (!trainingOwnsKeys && kb.jKey.wasPressedThisFrame && (PlayerFlowVisible || PlayerFlowLauncherAllowed))
                    {
                        if (PlayerFlowVisible) ClosePlayerFlows();
                        else ShowPlayerFlow(DefaultPlayerFlowPage);
                        if (TrainingInputConsumed) return;
                    }
                    if (kb.escapeKey.wasPressedThisFrame && !aimEsc && PlayerFlowVisible) ClosePlayerFlows();
                    // Build and Help can switch between each other, but neither may steal keys from
                    // account, menu, result, guide, or settings panels.
                    if (!unrelatedModal && !PlayerFlowVisible && kb.bKey.wasPressedThisFrame && !(_map?.IsPlanning ?? false))
                    { ToggleBuild(); if (TrainingInputConsumed) return; }
                    if (!unrelatedModal && !PlayerFlowVisible && kb.hKey.wasPressedThisFrame)
                    { ToggleHelp(); if (TrainingInputConsumed) return; }
                    if (kb.escapeKey.wasPressedThisFrame && !aimEsc)
                    {
                        if (_signIn.gameObject.activeSelf) SetSignInVisible(false);
                        else
                        if (_settings.gameObject.activeSelf) ToggleSettings();
                        else if (_help.gameObject.activeSelf) ToggleHelp();
                        else if (_drawer.IsVisible) { _drawer.SetVisible(false); RefreshHeaderActionsVisibility(); }
                        else if (_chestFocus) ReleaseChestFocus();
                        if (TrainingInputConsumed) return;
                    }
                    if (!dialog && _rewards.gameObject.activeSelf && kb.cKey.wasPressedThisFrame)
                    {
                        _chestFocus = !_chestFocus;
                        if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(_chestFocus ? _options[0].gameObject : null);
                    }
                    if (_chestFocus && !dialog)
                    {
                        _chestConsumedDigits = kb.digit1Key.wasPressedThisFrame || kb.digit2Key.wasPressedThisFrame || kb.digit3Key.wasPressedThisFrame || kb.digit0Key.wasPressedThisFrame;
                        if (kb.digit1Key.wasPressedThisFrame) Choose(0);
                        else if (kb.digit2Key.wasPressedThisFrame) Choose(1);
                        else if (kb.digit3Key.wasPressedThisFrame) Choose(2);
                        else if (kb.digit0Key.wasPressedThisFrame) Choose(-1);
                    }
                }
            }
            var focusRoot = FocusRoot;
            if (kb != null && !typing && focusRoot != null && kb.tabKey.wasPressedThisFrame && !kb.ctrlKey.isPressed && !kb.altKey.isPressed && !kb.leftMetaKey.isPressed && !kb.rightMetaKey.isPressed)
                UiFocusNavigation.Cycle(focusRoot, kb.shiftKey.isPressed);
            _map?.ReadUiInput(typing, dialog || PlayerFlowVisible || _chestFocus);
            if (focusRoot != null) UiBrowserStorage.CaptureTab(true, true);
        }
        public void ReleaseUiFocusForWindowLoss()
        {
            _trainingWindowFocused = false; UnbindTrainingSession();
            _recovery?.SetVisible(false); ReleaseChestFocus(); _chestConsumedDigits = false; _map?.ReleaseTransient();
        }
        void ReleaseChestFocus()
        {
            _chestFocus = false;
            if (EventSystem.current == null || EventSystem.current.currentSelectedGameObject == null || _rewards == null) return;
            if (EventSystem.current.currentSelectedGameObject.transform.IsChildOf(_rewards)) EventSystem.current.SetSelectedGameObject(null);
        }
        void TickFeatures()
        {
            // The launch menu's account, resume and play state is shown only on the launch screen. While a match covers it, it is
            // refreshed four times a second instead of every frame: each refresh builds several status strings (about 3 KB of
            // garbage a frame in a match, so a garbage collection every second or two). It still refreshes every frame while visible.
            bool launchShown = _menu != null && _menu.gameObject.activeSelf || ResumeChooserVisible;
            var pm = PerfMarks.Begin();
            if (launchShown || Time.unscaledTime >= _nextHiddenAccountRefresh) { _nextHiddenAccountRefresh = Time.unscaledTime + .25f; RefreshAccountMenu(); }
            TickHubAtrium();
            PerfMarks.End(PerfMarks.Sec.HudAccount, pm); pm = PerfMarks.Begin();
            TickMetrics();
            TickLobbyRoster();
            TickPlayerFlows();
            if (TrainingHigherPanelVisible) UnbindTrainingSession();
            _trainingConsole?.Refresh();
            AlignTrainingLauncher();
            PerfMarks.End(PerfMarks.Sec.HudFlows, pm); pm = PerfMarks.Begin();
            _map?.Tick();
            PerfMarks.End(PerfMarks.Sec.HudMap, pm); pm = PerfMarks.Begin();
            RefreshWorldHudVisibility();
            SyncTopCentre();
            UpdateEdgeThreats(); TickTerrain();
            PerfMarks.End(PerfMarks.Sec.HudEdge, pm); pm = PerfMarks.Begin();
            if (_session != null) _drawer?.Refresh(_session.Collections, _session.Me, _showcaseSettings.TextScale);
            PerfMarks.End(PerfMarks.Sec.HudDrawer, pm);
        }
        float _nextHiddenAccountRefresh;

        // In the lobby phase: the seated players in seat order (bots tagged) under a "Players n" count. The room's own minimum is not on
        // the wire, so no "n/m" is shown in a match (the hub poll's numbers are never used here). Names are plain text.
        TMP_Text _lobbyRoster;
        object _lobbyRosterSource; bool _lobbyRosterOn;
        void TickLobbyRoster()
        {
            bool on = _session != null && _session.State == SessionState.InMatch && _hud != null && _hud.gameObject.activeSelf &&
                _session.Collections.Plan == null && (_session.Phase ?? MatchPhase.Lobby) == MatchPhase.Lobby &&
                !(_client != null && _client.LaunchPending) && _session.Collections.Roster.Count > 0;
            if (!on)
            {
                if (_lobbyRosterOn && _lobbyRoster != null) { _lobbyRoster.gameObject.SetActive(false); _lobbyRosterSource = null; }
                _lobbyRosterOn = false;
                return;
            }
            var roster = _session.Collections.Roster;
            if (_lobbyRosterOn && ReferenceEquals(_lobbyRosterSource, roster)) return;
            if (_lobbyRoster == null)
                _lobbyRoster = MythicUi.Text(_hud, "LobbyRoster", "", new Vector2(.02f, .50f), new Vector2(.27f, .78f), 15, ShowcasePalette.Text, TextAlignmentOptions.TopLeft);
            _lobbyRoster.gameObject.SetActive(true);
            _lobbyRosterOn = true; _lobbyRosterSource = roster;
            _lobbyRoster.text = ComposeLobbyRoster(roster);
        }

        public static string ComposeLobbyRoster(System.Collections.Generic.IReadOnlyList<RosterEntry> roster)
        {
            var sb = new System.Text.StringBuilder("Players " + roster.Count);
            foreach (string line in Roguehalla.Net.Ui.LobbyActivity.RosterLines(roster)) sb.Append('\n').Append(line);
            return sb.ToString();
        }
        void RefreshWorldHudVisibility()
        {
            bool visible = PanelHudVisible;
            if (_worldHudVisible != visible)
            {
                HudIconHint.CloseAll();
                _worldHudVisible = visible;
                RefreshHudElementVisibility();
                var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
                var target = _worldHudFocus != null ? _worldHudFocus.GetComponent<UnityEngine.UI.Selectable>() : null;
                if (visible && target != null && target.IsActive() && target.IsInteractable() &&
                    EventSystem.current != null && (selected == null || !selected.activeInHierarchy))
                    EventSystem.current.SetSelectedGameObject(_worldHudFocus);
                _dirty = _rewardsDirty = true;
            }
            _map?.SetMinimapSuppressed(!visible);
            RefreshHeaderActionsVisibility();
            RememberWorldHudFocus();
        }
        void RememberWorldHudFocus()
        {
            if (!_worldHudVisible || !WorldHudVisible || EventSystem.current == null) return;
            var selected = EventSystem.current.currentSelectedGameObject;
            _worldHudFocus = selected != null && selected.transform.IsChildOf(_hud) ? selected : null;
        }
        static int CountCards(CollectionsView view) { int count = 0; foreach (byte card in view.Cards) if (card > 0) count++; return count; }
        /// <summary>Redraws the GAINED cells and the mob-bonus row from the owner's summary; null (none arrived yet) hides the
        /// strip and the mob row rather than showing zeros. Runs only when the summary object changes.</summary>
        void ApplyBuildSummary(Roguehalla.Net.Protocol.WireBuildSummary summary)
        {
            _gainCells = Roguehalla.Net.Ui.BuildHudText.Cells(summary);
            _gainsShown = _gainCells.Count == _gainValues.Length;
            for (int i = 0; i < _gainValues.Length; i++)
            {
                if (_gainValues[i] == null || i >= _gainCells.Count) continue;
                var cell = _gainCells[i];
                _gainValues[i].text = cell.Value;
                // Legacy "dim" cell: a zero value is muted and regular weight.
                _gainValues[i].color = cell.Dim ? UiTheme.Current.TextSecondary : UiTheme.Current.TextPrimary;
                _gainValues[i].fontStyle = cell.Dim ? FontStyles.Normal : FontStyles.Bold;
            }
            if (_mobText != null)
            {
                var lines = Roguehalla.Net.Ui.BuildHudText.MobLines(summary);
                var sb = new System.Text.StringBuilder();
                for (int i = 0; i < lines.Count; i++)
                    sb.Append(i > 0 ? " · " : "").Append(lines[i].Label).Append(lines[i].Total.Length > 0 ? " " + lines[i].Total : "");
                Set(_mobText, sb.ToString());
                _mobText.gameObject.SetActive(lines.Count > 0);
            }
            SetPlateMode(_plateActive);
        }
        /// <summary>Test seam: the text of GAINED cell <paramref name="index"/> as drawn.</summary>
        public string GainedCellText(int index) => _gainValues[index] != null ? _gainValues[index].text : null;
        public bool GainedStripVisible => _buildBox != null && _buildBox.gameObject.activeSelf;

        void RefreshBuildIcons(CollectionsView view)
        {
            if (!ReferenceEquals(view.Summary, _shownSummary)) { _shownSummary = view.Summary; ApplyBuildSummary(view.Summary); }
            if (view.Inventory.HasValue)
            {
                var inv = view.Inventory.Value;
                for (int i = 0; i < 2; i++)
                {
                    var weapon = i == 0 ? inv.Slot0 : inv.Slot1;
                    if (_weaponIcons[i] == null) continue;
                    _weaponIcons[i].enabled = weapon.HasValue;
                    bool inHand = weapon.HasValue && inv.ActiveSlot == i;
                    if (_weaponActiveBars[i] != null) _weaponActiveBars[i].enabled = inHand;
                    if (_slots[i] != null) HudUi.ApplyColors(_slots[i], inHand ? UiTheme.Current.SurfaceSelected : UiTheme.Current.SurfaceRaised);
                    if (_slotGroups[i] != null) _slotGroups[i].alpha = weapon.HasValue ? 1f : .5f;
                    if (_slotNames[i] != null) Set(_slotNames[i], weapon.HasValue ? weapon.Value.ToString() : "Empty");
                    if (weapon.HasValue)
                    {
                        MythicGlyph glyph = weapon == WeaponId.Bow ? MythicGlyph.Bow : weapon == WeaponId.Wand ? MythicGlyph.Wand : weapon == WeaponId.Shield ? MythicGlyph.Shield : weapon == WeaponId.Axe ? MythicGlyph.Axe : MythicGlyph.Sword;
                        _weaponIcons[i].sprite = MythicUi.GlyphSprite(glyph);
                        _weaponIcons[i].color = MythicUi.GlyphColor(glyph);
                    }
                }
            }
            else for (int i = 0; i < _weaponIcons.Length; i++)
            {
                if (_slotGroups[i] != null) _slotGroups[i].alpha = .5f;
                if (_slotNames[i] != null) Set(_slotNames[i], "Empty");
                if (_weaponIcons[i] != null) _weaponIcons[i].enabled = false;
                if (_weaponActiveBars[i] != null) _weaponActiveBars[i].enabled = false;
            }
        }
    }
}

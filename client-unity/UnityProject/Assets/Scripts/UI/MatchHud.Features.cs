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
        readonly TMP_Text[] _buildCounts = new TMP_Text[8];
        readonly byte[] _visibleBoosts = new byte[8];
        bool _visibleBuild;
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
        public TacticalMapController TacticalMap => _map;
        public bool ChestOwnsDigits => _chestFocus || _chestConsumedDigits;
        public bool ConsumesArrowNavigation => _chestFocus || _map != null && _map.ContainsFocus || ReadingPaneSelected;
        bool ReadingPaneSelected => EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null &&
            EventSystem.current.currentSelectedGameObject.activeInHierarchy &&
            EventSystem.current.currentSelectedGameObject.GetComponent<KeyboardScrollPane>() != null;
        public bool BlocksKeyboardInput => ResumeChooserVisible || TrainingInputConsumed || TrainingOwnsKeyboard || (_client != null && _client.LaunchPending) || _menu != null && (_menu.gameObject.activeSelf || _results.gameObject.activeSelf ||
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
            if (_session == null || _session.State != SessionState.InMatch) { _phaseStrip.text = ""; return; }
            if (_client != null && _client.LaunchPending) { _phaseStrip.text = "VERIFYING DESTINATION"; return; }
            if (_client != null && _client.ConfirmedPractice) { _phaseStrip.text = "PRACTICE · NO RUN REWARDS"; return; }
            var arena = _session.Collections.Arena;
            double elapsed = arena.HasValue ? System.Math.Max(0, (_session.ServerTimeMs - arena.Value.RaidStartedAt) / 1000) : 0;
            _phaseStrip.text = _session.Collections.Plan != null ? "PLANNING" : _session.Phase == MatchPhase.Active ? "RAID · " + ((int)elapsed / 60).ToString("00") + ":" + ((int)elapsed % 60).ToString("00") : "FORMING MATCH";
            // The legacy arena line (hud.ts:259): "Coliseum m:ss", warn while the gates are locked, red "sudden death" after the deadline.
            if (_session.Phase == MatchPhase.Active && arena.HasValue && _session.Collections.Plan == null)
            {
                var line = Roguehalla.Net.Ui.Indicators.ArenaLine(_session.ServerTimeMs, arena.Value.SuddenDeathAt, arena.Value.GatesLocked, arena.Value.PatienceEndsAt, out var lineTone);
                if (line != null) _phaseStrip.text += " · <color=" + (lineTone == Roguehalla.Net.Ui.Indicators.ArenaLineTone.Danger ? "#ff8a80" : lineTone == Roguehalla.Net.Ui.Indicators.ArenaLineTone.Warn ? "#ffca28" : "#eceff1") + ">" + line + "</color>";
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
            if (kb != null && AnyHubPanelVisible && kb.escapeKey.wasPressedThisFrame && !kb.ctrlKey.isPressed && !kb.altKey.isPressed && !kb.leftMetaKey.isPressed && !kb.rightMetaKey.isPressed)
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
                    if (kb.escapeKey.wasPressedThisFrame && PlayerFlowVisible) ClosePlayerFlows();
                    // Build and Help can switch between each other, but neither may steal keys from
                    // account, menu, result, guide, or settings panels.
                    if (!unrelatedModal && !PlayerFlowVisible && kb.bKey.wasPressedThisFrame && !(_map?.IsPlanning ?? false))
                    { ToggleBuild(); if (TrainingInputConsumed) return; }
                    if (!unrelatedModal && !PlayerFlowVisible && kb.hKey.wasPressedThisFrame)
                    { ToggleHelp(); if (TrainingInputConsumed) return; }
                    if (kb.escapeKey.wasPressedThisFrame)
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
            RefreshAccountMenu();
            TickHubAtrium();
            TickMetrics();
            TickPlayerFlows();
            if (TrainingHigherPanelVisible) UnbindTrainingSession();
            _trainingConsole?.Refresh();
            AlignTrainingLauncher();
            _map?.Tick();
            RefreshWorldHudVisibility();
            SyncTopCentre();
            UpdateEdgeThreats();
            if (_session != null) _drawer?.Refresh(_session.Collections, _session.Me, _showcaseSettings.TextScale);
        }
        void RefreshWorldHudVisibility()
        {
            bool visible = WorldHudVisible;
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
        void RefreshBuildIcons(CollectionsView view)
        {
            for (int i = 0; i < _buildCounts.Length; i++) if (_buildCounts[i] != null)
            {
                byte count = i < view.Boosts.Count ? view.Boosts[i] : (byte)0;
                if (!_visibleBuild || count != _visibleBoosts[i])
                {
                    _buildCounts[i].text = view.HasBuild ? "×" + count : "—";
                    // Legacy "dim" cell: a zero value is muted and regular weight.
                    _buildCounts[i].color = count == 0 ? UiTheme.Current.TextSecondary : UiTheme.Current.TextPrimary;
                    _buildCounts[i].fontStyle = count == 0 ? FontStyles.Normal : FontStyles.Bold;
                }
                _visibleBoosts[i] = count;
            }
            _visibleBuild = view.HasBuild;
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

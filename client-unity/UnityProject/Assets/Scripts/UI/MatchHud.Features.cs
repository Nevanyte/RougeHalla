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

        void CreateCombatHud()
        {
            _hud = Rect(_root, "PlayerHUD", 0, 0, 1, 1);
            var vitals = _vitalsPanel = Panel(_hud, "VitalsPanel", .015f, .146f, .285f, .266f);
            _vitals = Text(vitals, "Vitals", "Waiting for player state", .04f, .35f, .96f, .95f, 15);
            SetBaseSize(_vitals, 22);
            var bar = Rect(vitals, "OwnerVitalBar", .04f, .12f, .96f, .22f);
            var bg = bar.gameObject.AddComponent<UnityEngine.UI.Image>(); bg.color = ShowcasePalette.PanelStroke; bg.raycastTarget = false;
            _healthBarFill = Rect(bar, "HealthFill", 0, 0, 0, 1);
            var health = _healthBarFill.gameObject.AddComponent<UnityEngine.UI.Image>(); health.color = ShowcasePalette.Success; health.raycastTarget = false;
            _barrierBarFill = Rect(bar, "BarrierFill", 0, 0, 0, 1);
            var barrier = _barrierBarFill.gameObject.AddComponent<UnityEngine.UI.Image>(); barrier.color = ShowcasePalette.Gold; barrier.raycastTarget = false;
            CreateDamageReadout();
            var actions = _combatActions = Panel(_hud, "CombatActions", .315f, .015f, .615f, .135f);
            var wishInfo = Button(actions, "WishInfo", "", .565f, .58f, .98f, .98f, () => { });
            var wishIcon = MythicUi.Icon(wishInfo.transform, "WishIcon", MythicGlyph.Wish, 36);
            wishIcon.rectTransform.anchorMin = wishIcon.rectTransform.anchorMax = new Vector2(.17f, .5f);
            _wishSummary = wishInfo.GetComponentInChildren<TMP_Text>();
            _wishSummary.rectTransform.anchorMin = new Vector2(.30f, .04f); _wishSummary.rectTransform.anchorMax = new Vector2(.98f, .96f);
            SetBaseSize(_wishSummary, 20);
            _wishSummary.text = "R · —";
            _wishSummary.color = ShowcasePalette.Gold;
            _wishHint = HudIconHint.Attach(wishInfo, _root, "R · Wish\nAwaiting server");
            // Retain the existing formatted detail model for tests/readers, without a permanent world overlay.
            _wishDetails = Panel(_hud, "WishPanel", .775f, .70f, .985f, .915f);
            _wishCard = Text(_wishDetails, "WishCard", "R · WISH\nAwaiting server", .04f, .04f, .96f, .96f, 14);
            _wishCard.color = ShowcasePalette.Gold;
            _wishDetails.gameObject.SetActive(false);
            for (int i = 0; i < 2; i++)
            {
                byte slot = (byte)i;
                _slots[i] = Button(actions, "Slot" + (i + 1), (i + 1) + " · EMPTY", .02f + i * .18f, .035f, .185f + i * .18f, .965f, () => Swap(slot));
                var label = _slots[i].GetComponentInChildren<TMP_Text>();
                label.rectTransform.anchorMin = new Vector2(.02f, .02f); label.rectTransform.anchorMax = new Vector2(.98f, .49f); SetBaseSize(label, 20);
                _weaponIcons[i] = MythicUi.Icon(_slots[i].transform, "WeaponIcon", MythicGlyph.Sword, 48);
                _weaponIcons[i].rectTransform.anchorMin = _weaponIcons[i].rectTransform.anchorMax = new Vector2(.5f, .75f);
                _weaponIcons[i].rectTransform.anchoredPosition = Vector2.zero;
                var activeBar = Rect(_slots[i].transform, "ActiveWeapon", .18f, .95f, .82f, .99f);
                _weaponActiveBars[i] = activeBar.gameObject.AddComponent<UnityEngine.UI.Image>();
                _weaponActiveBars[i].color = ShowcasePalette.Gold;
                _weaponActiveBars[i].raycastTarget = false; _weaponActiveBars[i].enabled = false;
                _weaponHints[i] = HudIconHint.Attach(_slots[i], _root, (i + 1) + " · Empty weapon slot");
            }
            var potion = Button(actions, "Potion", "E · POTION", .38f, .035f, .545f, .965f, UsePotion);
            var potionText = potion.GetComponentInChildren<TMP_Text>();
            potionText.rectTransform.anchorMin = new Vector2(.02f, .02f); potionText.rectTransform.anchorMax = new Vector2(.98f, .49f); SetBaseSize(potionText, 20);
            _potionIcon = MythicUi.Icon(potion.transform, "PotionIcon", MythicGlyph.Potion, 48);
            _potionIcon.rectTransform.anchorMin = _potionIcon.rectTransform.anchorMax = new Vector2(.5f, .75f);
            _potionIcon.rectTransform.anchoredPosition = Vector2.zero;
            _potionHint = HudIconHint.Attach(potion, _root, "E · Drink potion\nAwaiting inventory");
            _pickup = Button(actions, "Pickup", "F · PICK UP", .565f, .035f, .98f, .55f, () => _client.PickupFocus());
            var pickupIcon = HudActionGlyphs.Icon(_pickup.transform, "PickupIcon", HudActionGlyph.Pickup, 34);
            pickupIcon.rectTransform.anchorMin = pickupIcon.rectTransform.anchorMax = new Vector2(.20f, .5f);
            _pickup.GetComponentInChildren<TMP_Text>().rectTransform.anchorMin = new Vector2(.4f, .05f);
            _pickupHint = HudIconHint.Attach(_pickup, _root, "F · Pick up\nNo pickup in range");
            SetBaseSize(_pickup.GetComponentInChildren<TMP_Text>(), 20);
            var buildStrip = _buildStrip = Panel(_hud, "BuildStrip", .015f, .645f, .285f, .915f);
            _combatStats = Text(buildStrip, "CombatStats", "Awaiting player stats", .04f, .82f, .96f, .99f, 15);
            SetBaseSize(_combatStats, 22);
            _focusLabel = Text(buildStrip, "Focus", "", .04f, .715f, .96f, .81f, 12);
            var buildButton = Button(buildStrip, "BuildDetails", "B · BUILD DETAILS", .025f, .015f, .975f, .25f, ToggleBuild);
            _build = buildButton.GetComponentInChildren<TMP_Text>();
            _buildHint = HudIconHint.Attach(buildButton, _root, "B · Full build details");
            var buildIcon = MythicUi.Icon(buildButton.transform, "BuildIcon", MythicGlyph.Cards, 30);
            buildIcon.rectTransform.anchorMin = buildIcon.rectTransform.anchorMax = new Vector2(.10f, .5f);
            _build.rectTransform.anchorMin = new Vector2(.18f, .05f);
            SetBaseSize(_build, 20);
            var glyphs = new[] { MythicGlyph.Sword, MythicGlyph.Wish, MythicGlyph.Armor, MythicGlyph.Shield, MythicGlyph.Health, MythicGlyph.Bow, MythicGlyph.Speed, MythicGlyph.Potion };
            var labels = new[] { "OFF", "SOUL", "DEF", "S.DEF", "HP", "ATK", "MOVE", "LEECH" };
            for (int i = 0; i < 8; i++)
            {
                float x = .02f + (i % 4) * .245f, y = i < 4 ? .49f : .26f;
                var cell = Rect(buildStrip, "Build" + labels[i], x, y, x + .235f, y + .22f);
                var icon = MythicUi.Icon(cell, "StatIcon", glyphs[i], 32);
                icon.color = MythicUi.BoostColor(i);
                icon.rectTransform.anchorMin = icon.rectTransform.anchorMax = new Vector2(.20f, .5f);
                _buildCounts[i] = Text(cell, "Count", "—", .40f, .05f, .98f, .95f, 14);
                SetBaseSize(_buildCounts[i], 20);
                var statSelect = cell.gameObject.AddComponent<UnityEngine.UI.Button>();
                var target = cell.gameObject.AddComponent<UnityEngine.UI.Image>(); target.color = Color.clear;
                statSelect.targetGraphic = target;
                HudIconHint.Attach(statSelect, _root, StatNames[i] + " · build boost stacks\nOpen B for the full build ledger.");
            }
        }
        void SetBaseSize(TMP_Text label, float size)
        {
            int i = _scaledText.IndexOf(label); if (i >= 0) _textBaseSize[i] = size;
            label.fontSize = size * _showcaseSettings.TextScale; label.fontSizeMin = label.fontSize * .75f; label.fontSizeMax = label.fontSize;
        }
        void InitializeFeatures()
        {
            InitializeHubGuides();
            _drawer = gameObject.AddComponent<BuildDrawer>(); _drawer.Initialize(_root, RefreshHeaderActionsVisibility);
            _uiPrefs = new UiDisplayPreferences();
            _map = gameObject.AddComponent<TacticalMapController>(); _map.Initialize(_client, _root, _uiPrefs);
            _modernSettings = gameObject.AddComponent<ModernSettingsView>();
            _modernSettings.Initialize(_root, _showcaseSettings, _map, _uiPrefs, () => _modernSettings.SetVisible(false));
            _settings = _modernSettings.Root;
            _uiPrefs.Changed += ApplyDisplayPreferences;
            _phaseStrip = Text(_root, "PhaseTimer", "", .31f, .925f, .60f, .99f, 20);
            _metrics = Text(_root, "PerformanceReadout", "", .40f, .855f, .66f, .92f, 15);
            ApplyDisplayPreferences();
            _help = Panel(_root, "ControlsHelp", .18f, .28f, .82f, .90f);
            Text(_help, "HelpTitle", "CONTROLS & FIELD GUIDE", .04f, .87f, .96f, .99f, 26).color = ShowcasePalette.Gold;
            Text(_help, "HelpText", "WASD / arrows   Move\nLeft click / hold   Attack; wand selects a target\nRight click   Move to a point\nQ / 1 / 2   Swap / select weapon\nE   Drink potion       R   Cast Wish at cursor\nF   Interact / pick up\nJ   Quest journal, traders and notices (planning: quests only)\nHold Tab   Tactical map and personal route\nB   Full build details\nC   Give the chest keyboard focus; 1–3 choose, 0 skip\nMinimap RMB   Move       Minimap hold LMB   Camera peek\nEscape   Close the focused panel\n\nPlanning: 1 / 2 select spawn. Select an offered boon, then Ready.\nA planned route is a personal guide. It never moves your character.\nThe run continues while panels are open.", .04f, .12f, .96f, .86f, 17);
            Button(_help, "HelpClose", "CLOSE · H / ESC", .30f, .02f, .70f, .11f, ToggleHelp);
            _help.gameObject.SetActive(false);
            InitializePlayerFlows();
        }
        void ApplyDisplayPreferences()
        {
            if (_map == null || _uiPrefs == null) return;
            _map.SetMinimapScale(_uiPrefs.MinimapScale);
            // Keep the saved scale useful at its full range without covering rewards or combat controls.
            _rewards.anchorMin = new Vector2(.70f, Mathf.Max(.425f, .018f + .36f * _uiPrefs.MinimapScale + .015f));
        }
        void TickMetrics()
        {
            if (_metrics == null || _phaseStrip == null) return;
            _frameAverage = _frameAverage <= 0 ? Time.unscaledDeltaTime : Mathf.Lerp(_frameAverage, Time.unscaledDeltaTime, .08f);
            if (Time.realtimeSinceStartupAsDouble < _nextMetricsAt) return;
            _nextMetricsAt = Time.realtimeSinceStartupAsDouble + .25;
            string metrics = "";
            if (_uiPrefs.ShowFps && _frameAverage > 0) metrics = "FPS " + Mathf.RoundToInt(1 / _frameAverage);
            if (_uiPrefs.ShowPing && _session != null) metrics += (metrics.Length == 0 ? "" : " · ") + "PING " + (_session.Sync.HasSample ? _session.Sync.LastRttMs.ToString("0") + " ms" : "—");
            _metrics.text = metrics;
            if (_session == null || _session.State != SessionState.InMatch) { _phaseStrip.text = ""; return; }
            if (_client != null && _client.LaunchPending) { _phaseStrip.text = "VERIFYING DESTINATION"; return; }
            if (_client != null && _client.ConfirmedPractice) { _phaseStrip.text = "PRACTICE · NO RUN REWARDS"; return; }
            var arena = _session.Collections.Arena;
            double elapsed = arena.HasValue ? System.Math.Max(0, (_session.ServerTimeMs - arena.Value.RaidStartedAt) / 1000) : 0;
            _phaseStrip.text = _session.Collections.Plan != null ? "PLANNING" : _session.Phase == MatchPhase.Active ? "RAID · " + ((int)elapsed / 60).ToString("00") + ":" + ((int)elapsed % 60).ToString("00") : "FORMING MATCH";
        }
        void ToggleBuild()
        {
            if (_drawer == null || _session == null) return;
            SuspendTrainingForPanel();
            _drawer.SetVisible(!_drawer.IsVisible); if (_drawer.IsVisible) { _map?.SetOpen(false); if (_help != null) _help.gameObject.SetActive(false); } ReleaseChestFocus();
            RefreshHeaderActionsVisibility();
        }
        void ToggleHelp() { if (_help != null) { SuspendTrainingForPanel(); _help.gameObject.SetActive(!_help.gameObject.activeSelf); if (_help.gameObject.activeSelf) { CloseHubPanels(); _drawer?.SetVisible(false); _map?.SetOpen(false); } ReleaseChestFocus(); RefreshHeaderActionsVisibility(); } }
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
            if (_session != null) _drawer?.Refresh(_session.Collections, _session.Me, _showcaseSettings.TextScale);
        }
        void RefreshWorldHudVisibility()
        {
            bool visible = WorldHudVisible;
            if (_worldHudVisible != visible)
            {
                HudIconHint.CloseAll();
                _worldHudVisible = visible;
                _vitalsPanel.gameObject.SetActive(visible); _damagePanel.gameObject.SetActive(visible); _buildStrip.gameObject.SetActive(visible); _combatActions.gameObject.SetActive(visible);
                _notice.gameObject.SetActive(visible);
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
                    _buildCounts[i].text = view.HasBuild ? "×" + count : "—";
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
                    if (_weaponActiveBars[i] != null) _weaponActiveBars[i].enabled = weapon.HasValue && inv.ActiveSlot == i;
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
                if (_weaponIcons[i] != null) _weaponIcons[i].enabled = false;
                if (_weaponActiveBars[i] != null) _weaponActiveBars[i].enabled = false;
            }
        }
    }
}

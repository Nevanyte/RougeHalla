using System;
using System.Collections.Generic;
using System.Text;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>Local map/planning presentation. All selections go through the normal validated input sender.</summary>
    public sealed class TacticalMapController : MonoBehaviour
    {
        const float Tile = 32f;
        const double PreviewSpeed = 170d;
        MatchClient _client;
        UiDisplayPreferences _prefs;
        Session _bound;
        RectTransform _panel, _miniRoot, _planningRail, _runRail;
        TacticalMapSurface _large, _mini;
        TacticalMapMarks _largeMarks, _miniMarks;
        QuestHandle? _trackedQuest;
        TMP_Text _title, _status, _routeText, _contactsText;
        readonly UnityEngine.UI.Button[] _spawns = new UnityEngine.UI.Button[2];
        readonly UnityEngine.UI.Button[] _boons = new UnityEngine.UI.Button[2];
        UnityEngine.UI.Button _ready;
        readonly RouteState _route = new RouteState();
        readonly UiInputGate _mapKeys = new UiInputGate();
        readonly PlanningSelections _selections = new PlanningSelections();
        readonly MinimapGesture _miniGesture = new MinimapGesture();
        readonly UnityEngine.UI.Button[] _spawnMarks = new UnityEngine.UI.Button[2];
        readonly List<InterpActor> _contacts = new List<InterpActor>();
        RoutePlanSnapshot _routePlan;
        IReadOnlyList<RoutePoint> _routePoints = Array.Empty<RoutePoint>();
        string _storageKey;
        uint _timelineEpoch;
        int _lastContactsSnapshot = -1;
        WeaponCounterGuide _counterGuide;
        RectTransform _contactRail, _counterRail;
        bool _routeStorageDirty;
        double _nextPaint, _nextPath;
        bool _factsDirty = true;
        bool _mapOpen;
        bool _minimapSuppressed;
        public bool ToggleMode => _prefs.MapToggle;
        public bool ShowRoute => _prefs.ShowRoute;
        public bool IsPlanning => _bound?.Collections.Plan != null && _bound.LastResult == null && (_bound.State == SessionState.InMatch || _bound.State == SessionState.Reconnecting || _bound.State == SessionState.HelloSent);
        public bool IsOpen => _panel != null && _panel.gameObject.activeSelf;
        public bool IsPeeking => _miniGesture.IsPeeking;
        public bool ContainsFocus => IsOpen && EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null && EventSystem.current.currentSelectedGameObject.transform.IsChildOf(_panel);
        public bool PointerBlocked => IsOpen || IsPeeking;
        public Vector2 PeekAt => _miniGesture.PeekPoint.HasValue ? new Vector2((float)_miniGesture.PeekPoint.Value.X, (float)_miniGesture.PeekPoint.Value.Y) : Vector2.zero;

        public void Initialize(MatchClient client, Transform root, UiDisplayPreferences preferences = null, Transform hudStage = null)
        {
            _client = client;
            _prefs = preferences ?? new UiDisplayPreferences();
            Color mapFill = ShowcasePalette.Panel; mapFill.a = 1;
            _panel = MythicUi.Panel(root, "TacticalMap", new Vector2(.025f, .155f), new Vector2(.975f, .915f), mapFill);
            _title = MythicUi.Text(_panel, "MapHeading", "TACTICAL MAP", new Vector2(.025f, .89f), new Vector2(.72f, .995f), 22, ShowcasePalette.Gold, heading: true);
            MythicUi.Button(_panel, "CloseMap", "CLOSE", new Vector2(.87f, .91f), new Vector2(.985f, .985f), () => SetOpen(false));
            var mapFrame = MythicUi.Panel(_panel, "MapFrame", new Vector2(.02f, .22f), new Vector2(.69f, .89f), ShowcasePalette.Background);
            mapFrame.GetComponent<Image>().color = Color.clear;
            var mapRect = MythicUi.Rect(mapFrame, "PublicMap", Vector2.zero, Vector2.one);
            _large = mapRect.gameObject.AddComponent<TacticalMapSurface>(); _large.Initialize();
            _largeMarks = _large.GetComponentInChildren<TacticalMapMarks>(); _largeMarks.ShowDeliveredLabels = true;
            _large.Pressed = (point, button) => { if (button == PointerEventData.InputButton.Left) AddRoutePoint(point); };
            for (byte i = 0; i < 2; i++)
            {
                byte pick = i;
                _spawnMarks[i] = MythicUi.Button(_large.transform, "SpawnMarker" + i, (i + 1).ToString(), Vector2.zero, Vector2.zero, () => PickSpawn(pick));
                ((RectTransform)_spawnMarks[i].transform).sizeDelta = new Vector2(80, 64);
                _spawnMarks[i].gameObject.SetActive(false);
            }
            _planningRail = MythicUi.Rect(_panel, "PlanningDecisions", new Vector2(.715f, .18f), new Vector2(.98f, .89f));
            for (int i = 0; i < 2; i++)
            {
                byte pick = (byte)i;
                _spawns[i] = MythicUi.Button(_planningRail, "Spawn" + i, (i + 1) + " · SPAWN", new Vector2(0, .77f - i * .19f), new Vector2(1, .94f - i * .19f), () => PickSpawn(pick));
                _boons[i] = MythicUi.Button(_planningRail, "Boon" + i, "BOON", new Vector2(0, .36f - i * .15f), new Vector2(1, .49f - i * .15f), () => PickBoon(pick));
            }
            _ready = MythicUi.Button(_planningRail, "Ready", "READY", Vector2.zero, new Vector2(1, .17f), Ready);
            _runRail = MythicUi.Rect(_panel, "TacticalInformation", new Vector2(.715f, .18f), new Vector2(.98f, .89f));
            _contactRail = MythicUi.Rect(_runRail, "ContactsPage", Vector2.zero, new Vector2(1, .86f));
            _counterRail = MythicUi.Rect(_runRail, "WeaponsPage", Vector2.zero, new Vector2(1, .86f));
            _contactsText = MythicUi.ScrollText(_contactRail, "DeliveredContacts", "", Vector2.zero, Vector2.one, 16);
            MythicUi.Button(_runRail, "ContactsTab", "CONTACTS", new Vector2(0, .89f), new Vector2(.48f, 1), () => ShowRail(false));
            MythicUi.Button(_runRail, "WeaponsTab", "WEAPONS", new Vector2(.52f, .89f), Vector2.one, () => ShowRail(true));
            var wheelFrame = MythicUi.Rect(_counterRail, "Diagram", new Vector2(0, .23f), Vector2.one);
            _counterGuide = new WeaponCounterGuide(wheelFrame, "fists");
            _counterGuide.LegendRoot.SetParent(_counterRail, false);
            _counterGuide.SetLayout(Vector2.zero, Vector2.one, Vector2.zero, new Vector2(1, .22f));
            _counterGuide.LegendRoot.GetComponentInChildren<TMP_Text>().text = "Arrows point to countered weapons. + advantage; ! threat.";
            ShowRail(false);
            _routeText = MythicUi.Text(_panel, "RouteSummary", "Click map to add a route stop", new Vector2(.025f, .085f), new Vector2(.69f, .21f), 15);
            MythicUi.Button(_panel, "UndoRoute", "UNDO", new Vector2(.715f, .09f), new Vector2(.84f, .17f), () => { _route.Undo(); _routeStorageDirty = true; _nextPath = _nextPaint = 0; });
            MythicUi.Button(_panel, "ClearRoute", "CLEAR", new Vector2(.855f, .09f), new Vector2(.98f, .17f), () => { _route.Clear(); _routeStorageDirty = true; _nextPath = _nextPaint = 0; });
            _status = MythicUi.Text(_panel, "MapStatus", "", new Vector2(.025f, .005f), new Vector2(.98f, .075f), 17, ShowcasePalette.MutedText);
            // Legacy minimap: a square 12/12 from the bottom-right corner, no button strip, frame ring is the border (drawn rect = hit rect).
            var theme = UiTheme.Current;
            _miniRoot = HudUi.Box(hudStage ?? root, "Minimap", HudAnchor.BottomRight, 12f, 12f, 270f, 270f);
            HudUi.Surface(_miniRoot, theme.SurfaceSunken, theme.CornerRadius, theme.Border, false);
            var miniFrame = MythicUi.Rect(_miniRoot, "TerrainFrame", Vector2.zero, Vector2.one);
            _mini = miniFrame.gameObject.AddComponent<TacticalMapSurface>(); _mini.Initialize();
            _miniMarks = _mini.GetComponentInChildren<TacticalMapMarks>();
            _mini.Pressed = MinimapPress; _mini.Dragged = MinimapDrag; _mini.PointerReleased = MinimapRelease; _mini.Aborted = ReleaseMinimap;
            _panel.gameObject.SetActive(false); _miniRoot.gameObject.SetActive(false);
        }

        public void Bind(Session session)
        {
            UnsubscribeMapFacts();
            ReleaseTransient(); _selections.Update(null, false, Time.realtimeSinceStartupAsDouble * 1000); _bound = session; _storageKey = null; _routeStorageDirty = false; _route.Clear(); _route.SetStart(null);
            _factsDirty = true; _lastContactsSnapshot = -1; _contacts.Clear(); _contactsText.text = "";
            if (_bound != null)
            {
                _bound.SnapshotReceived += MapSnapshotChanged;
                _bound.CollectionsChanged += MapCollectionsChanged;
                _bound.StateChanged += MapStateChanged;
            }
            _large.SetMap(null); _mini.SetMap(null); _routePlan = null; _routePoints = Array.Empty<RoutePoint>();
            SetTrackedQuest(null);
            RefreshMinimapVisibility(); _nextPaint = _nextPath = 0;
        }
        public void SetTrackedQuest(QuestHandle? handle)
        {
            if (Nullable.Equals(_trackedQuest, handle)) return;
            _trackedQuest = handle;
            _largeMarks.TrackedQuest = _miniMarks.TrackedQuest = handle;
            RefreshDeliveredMarks(); _factsDirty = true; _nextPaint = 0;
        }
        void RefreshDeliveredMarks()
        {
            _large.Present(_bound, ShowRoute ? _routePoints : null);
            _mini.Present(_bound, ShowRoute ? _routePoints : null);
        }
        public void SetToggleMode(bool value) { _prefs.SetMapToggle(value); ReleaseTransient(); }
        public void SetShowRoute(bool value) { _prefs.SetShowRoute(value); _nextPaint = 0; }
        /// <summary>Sizes the minimap by the legacy formula for the laid-out HUD (units) and the user's minimap scale setting.</summary>
        public void ApplyViewport(HudViewport viewport, float userScale)
        {
            if (_miniRoot == null || viewport.UiWidth <= 0f) return;
            float size = HudLayout.MinimapSize(viewport.UiWidth, viewport.UiHeight, userScale);
            _miniRoot.sizeDelta = new Vector2(size, size);
        }
        public RectTransform MinimapRoot => _miniRoot;
        public void SetMinimapSuppressed(bool suppressed)
        {
            if (_minimapSuppressed == suppressed) return;
            _minimapSuppressed = suppressed; RefreshMinimapVisibility();
        }
        void RefreshMinimapVisibility()
        {
            if (_miniRoot == null) return;
            bool visible = !_minimapSuppressed && !IsOpen && _bound != null && _bound.LastResult == null &&
                (_bound.State == SessionState.InMatch || _bound.State == SessionState.Reconnecting);
            if (!visible) ReleaseMinimap();
            if (_miniRoot.gameObject.activeSelf != visible) _miniRoot.gameObject.SetActive(visible);
        }
        public void SetOpen(bool open)
        {
            if (open) _mapKeys.OpenMap(MapContext(false, false)); else _mapKeys.CloseMap();
            _mapOpen = _mapKeys.MapHeld;
            _panel.gameObject.SetActive(IsPlanning || _mapOpen);
            RefreshMinimapVisibility();
            if (open) ReleaseMinimap();
        }
        bool MapAllowed => _bound != null && _bound.State == SessionState.InMatch && _bound.Phase == MatchPhase.Active && !_bound.Training && _bound.LastResult == null;
        UiInputContext MapContext(bool typing, bool dialog) => new UiInputContext(MapAllowed, _bound != null && _bound.Training,
            _bound != null && _bound.LastResult != null, false, typing, dialog);
        public void ReadUiInput(bool typing, bool dialogOwnsKeys)
        {
            UpdateSelections();
            if (dialogOwnsKeys || typing) ReleaseMinimap();
            else ReconcileMinimapButtons();
            var context = MapContext(typing, dialogOwnsKeys);
            _mapKeys.MapToggle = ToggleMode; _mapKeys.Reconcile(context);
            UiBrowserStorage.CaptureTab(MapAllowed && !typing && !dialogOwnsKeys);
            var kb = Keyboard.current;
            if (kb != null)
            {
                var modifiers = new UiKeyModifiers(kb.ctrlKey.isPressed, kb.leftMetaKey.isPressed || kb.rightMetaKey.isPressed, kb.altKey.isPressed, kb.shiftKey.isPressed);
                if (kb.tabKey.wasPressedThisFrame) _mapKeys.KeyDown(UiKey.Tab, modifiers, context);
                if (kb.tabKey.wasReleasedThisFrame) _mapKeys.KeyUp(UiKey.Tab);
                if (kb.escapeKey.wasPressedThisFrame) { ReleaseMinimap(); if (IsOpen && !IsPlanning) _mapKeys.CloseMap(); }
                if (IsPlanning && !typing && !dialogOwnsKeys && !modifiers.Any)
                {
                    if (kb.digit1Key.wasPressedThisFrame) PickSpawn(0);
                    if (kb.digit2Key.wasPressedThisFrame) PickSpawn(1);
                }
            }
            _mapOpen = _mapKeys.MapHeld;
            _panel.gameObject.SetActive(IsPlanning || _mapOpen);
            RefreshMinimapVisibility();
        }
        public void Tick()
        {
            if (_bound == null || _bound.Map == null) return;
            _large.SetMap(_bound.Map); _mini.SetMap(_bound.Map);
            if ((_storageKey == null || _timelineEpoch != _bound.TimelineEpoch) && _bound.Welcome != null)
            {
                _timelineEpoch = _bound.TimelineEpoch;
                string key = new Uri(_client.Url).GetLeftPart(UriPartial.Authority) + "/" + BitConverter.ToString(_bound.Welcome.MatchId) + "/" + Uri.EscapeDataString(_client.Profile);
                if (_storageKey != key) { _storageKey = key; _route.Clear(); _route.SetStart(null); LoadRoute(); }
            }
            if (_bound.State != SessionState.InMatch || _bound.LastResult != null) ReleaseTransient();
            _panel.gameObject.SetActive(_bound.LastResult == null && (IsPlanning || _mapOpen));
            RefreshMinimapVisibility();
            if (_factsDirty) _nextPaint = 0;
            if (Time.realtimeSinceStartupAsDouble < _nextPaint) return;
            _factsDirty = false;
            _nextPaint = Time.realtimeSinceStartupAsDouble + 1d / 30d;
            var plan = _bound.Collections.Plan;
            _planningRail.gameObject.SetActive(plan != null); _runRail.gameObject.SetActive(plan == null);
            if (plan != null) PresentPlan(plan); else if (IsOpen) PresentTactics();
            if (plan == null) foreach (var marker in _spawnMarks) marker.gameObject.SetActive(false);
            var me = _bound.Me;
            if (plan == null && me != null)
            {
                _route.Advance(new RoutePoint(me.X, me.Y), Tile);
                if (Time.realtimeSinceStartupAsDouble >= _nextPath) _route.SetStart(new RoutePoint(me.X, me.Y));
            }
            if (Time.realtimeSinceStartupAsDouble >= _nextPath)
            {
                _nextPath = Time.realtimeSinceStartupAsDouble + .25;
                _routePlan = _route.PlanAhead(_bound.Map, new RouteGeometry(Tile, Pathfinder.PlayerRadius, PreviewSpeed), plan == null && me != null ? new RoutePoint(me.X, me.Y) : _route.Start);
                _routePoints = _routePlan.Points;
                _routeText.text = (_route.Waypoints.Count - _route.NextIndex) + "/12 stops · " + (_routePlan.Start.HasValue ? _routePlan.EtaSeconds.ToString("0") + "s base-speed walk" : "choose a spawn for ETA") +
                    (_routePlan.Unreachable.Count > 0 ? " · " + _routePlan.Unreachable.Count + " unreachable" : "") + "\nClick map to add; click an upcoming stop to remove.";
            }
            SaveRoute();
            _large.Present(_bound, ShowRoute ? _routePoints : null); _mini.Present(_bound, ShowRoute ? _routePoints : null);
            SubmitMiniMove(_miniGesture.Tick(Time.realtimeSinceStartupAsDouble * 1000));
        }
        void PresentPlan(PlanView plan)
        {
            bool connected = _bound.State == SessionState.InMatch;
            UpdateSelections();
            _title.text = "PLAN YOUR RUN · " + Math.Max(0, Math.Ceiling((plan.EndsAt - _bound.ServerTimeMs) / 1000d)) + "s";
            for (byte i = 0; i < 2; i++)
            {
                var option = i == 0 ? plan.Option0 : plan.Option1;
                bool taken = i == 0 ? plan.Taken0 : plan.Taken1;
                var label = _spawns[i].GetComponentInChildren<TMP_Text>();
                label.text = (i + 1) + " · SPAWN " + (i + 1) + (plan.Pick == i ? " · SELECTED" : taken ? " · TAKEN" : _selections.PendingSpawn == i ? " · PENDING" : "") +
                    (option.HasValue ? "\n" + ShowcasePalette.GetFactionName(option.Value.Zone - 1) : "");
                _spawnMarks[i].gameObject.SetActive(option.HasValue);
                if (option.HasValue)
                {
                    var at = new Vector2(option.Value.X / (_bound.Map.W * Tile), 1 - option.Value.Y / (_bound.Map.H * Tile));
                    var marker = (RectTransform)_spawnMarks[i].transform;
                    marker.anchorMin = marker.anchorMax = at; marker.anchoredPosition = Vector2.zero;
                    _spawnMarks[i].GetComponentInChildren<TMP_Text>().text = (i + 1) + (plan.Pick == i ? " [S]" : taken ? " [X]" : "");
                }
                _spawns[i].interactable = _selections.CanPickSpawn(i);
                _spawnMarks[i].interactable = _spawns[i].interactable;
                _boons[i].gameObject.SetActive(i < plan.Boons.Count);
                if (i < plan.Boons.Count)
                {
                    _boons[i].GetComponentInChildren<TMP_Text>().text = plan.Boons[i] + (plan.Boon == i ? " · SELECTED" : _selections.PendingBoon == i ? " · PENDING" : "");
                    _boons[i].interactable = _selections.CanPickBoon(i);
                }
            }
            _ready.GetComponentInChildren<TMP_Text>().text = plan.Ready ? "READY · CONFIRMED" : _selections.PendingReady ? "READY · PENDING" : connected ? "READY" : "RECONNECTING";
            _ready.interactable = _selections.CanReady;
            var picked = plan.Pick == 0 ? plan.Option0 : plan.Pick == 1 ? plan.Option1 : null;
            if (picked.HasValue) _route.SetStart(new RoutePoint(picked.Value.X, picked.Value.Y));
            _status.text = !string.IsNullOrEmpty(_selections.Feedback) ? _selections.Feedback : connected ? "Choose spawn + boon, then Ready · your route stays private." : "Reconnecting · wait for the server plan.";
        }
        void PresentTactics()
        {
            _title.text = _bound.Phase == MatchPhase.Lobby ? "LOBBY MAP" : "TACTICAL MAP";
            if (_lastContactsSnapshot == _bound.SnapshotsReceived) return;
            _lastContactsSnapshot = _bound.SnapshotsReceived;
            _contacts.Clear(); _bound.Snapshots.Sample(_bound.Snapshots.NewestMs, _contacts);
            var text = new StringBuilder("OBSERVED CONTACTS\n");
            int shown = 0;
            foreach (var actor in _contacts)
            {
                if (actor.Id == _bound.PlayerId) continue;
                shown++; text.Append(actor.Faction.HasValue ? ShowcasePalette.GetFactionName((int)actor.Faction.Value) : "Neutral").Append(" · ").Append(actor.Kind).Append("\n");
            }
            if (shown == 0) text.Append("No other contacts in view.");
            _contactsText.text = text.ToString();
            _counterGuide.SetWeapon(_bound.Me != null ? _bound.Me.Weapon.ToString() : "fists");
            _status.text = "Delivered terrain/contacts · " + (ToggleMode ? "Tab closes" : "Release Tab to return") + " · routes never move you.";
        }
        void ShowRail(bool weapons) { _contactRail.gameObject.SetActive(!weapons); _counterRail.gameObject.SetActive(weapons); }
        void OnDestroy() { UnsubscribeMapFacts(); _counterGuide?.Destroy(); }
        void UnsubscribeMapFacts()
        {
            if (_bound == null) return;
            _bound.SnapshotReceived -= MapSnapshotChanged;
            _bound.CollectionsChanged -= MapCollectionsChanged;
            _bound.StateChanged -= MapStateChanged;
        }
        void MapSnapshotChanged(ServerMsg.Snapshot _) { _factsDirty = true; _nextPaint = 0; }
        void MapCollectionsChanged(CollectionsView _) { _factsDirty = true; _lastContactsSnapshot = -1; _nextPaint = 0; RefreshDeliveredMarks(); }
        void MapStateChanged(SessionState _)
        {
            _factsDirty = true; _nextPaint = 0;
            RefreshDeliveredMarks();
            if (_bound?.State != SessionState.InMatch) { _contactsText.text = "No current contacts."; _lastContactsSnapshot = -1; }
        }
        void UpdateSelections() => _selections.Update(_bound?.Collections.Plan, _bound != null && _bound.State == SessionState.InMatch, Time.realtimeSinceStartupAsDouble * 1000);
        void PickSpawn(byte pick) { UpdateSelections(); if (_bound != null && _selections.TryPickSpawn(pick, _bound.Input, Time.realtimeSinceStartupAsDouble * 1000)) _nextPaint = 0; }
        void PickBoon(byte pick) { UpdateSelections(); if (_bound != null && _selections.TryPickBoon(pick, _bound.Input, Time.realtimeSinceStartupAsDouble * 1000)) _nextPaint = 0; }
        void Ready() { UpdateSelections(); if (_bound != null && _selections.TryReady(_bound.Input, Time.realtimeSinceStartupAsDouble * 1000)) _nextPaint = 0; }
        void AddRoutePoint(Vector2 point) { if (_bound?.Map == null) return; _route.ToggleUpcoming(new RoutePoint(point.x, point.y), _bound.Map, Tile); _routeStorageDirty = true; _nextPath = _nextPaint = 0; }
        void ReconcileMinimapButtons()
        {
            if (!_miniGesture.IsPeeking && !_miniGesture.IsSteering) return;
            var mouse = Mouse.current;
            if (mouse == null) { ReleaseMinimap(); return; }
            if (_miniGesture.IsPeeking && !mouse.leftButton.isPressed)
            {
                _miniGesture.Cancel(MinimapButton.Left); RestoreCamera();
            }
            if (_miniGesture.IsSteering && !mouse.rightButton.isPressed)
            {
                if (mouse.rightButton.wasReleasedThisFrame)
                {
                    // Reconcile a missing UI pointer-up using this overlay canvas's current release position.
                    if (_mini.ScreenWorld(mouse.position.ReadValue(), null, out var point))
                        _miniGesture.Drag(MinimapButton.Right, new RoutePoint(point.x, point.y));
                    SubmitMiniMove(_miniGesture.Release(MinimapButton.Right, Time.realtimeSinceStartupAsDouble * 1000));
                }
                else _miniGesture.Cancel(MinimapButton.Right);
            }
        }
        static MinimapButton MiniButton(PointerEventData.InputButton button) => button == PointerEventData.InputButton.Left ? MinimapButton.Left : MinimapButton.Right;
        void MinimapPress(Vector2 point, PointerEventData.InputButton button)
        {
            if (_bound == null || _bound.State != SessionState.InMatch || IsPlanning || _bound.LastResult != null || button == PointerEventData.InputButton.Middle) return;
            SubmitMiniMove(_miniGesture.Press(MiniButton(button), new RoutePoint(point.x, point.y), Time.realtimeSinceStartupAsDouble * 1000));
        }
        void MinimapDrag(Vector2 point, PointerEventData.InputButton button)
        {
            if (button != PointerEventData.InputButton.Middle) _miniGesture.Drag(MiniButton(button), new RoutePoint(point.x, point.y));
        }
        void MinimapRelease(Vector2 point, PointerEventData.InputButton button)
        {
            if (button == PointerEventData.InputButton.Middle) return;
            _miniGesture.Drag(MiniButton(button), new RoutePoint(point.x, point.y));
            SubmitMiniMove(_miniGesture.Release(MiniButton(button), Time.realtimeSinceStartupAsDouble * 1000));
            if (!IsPeeking) RestoreCamera();
        }
        void SubmitMiniMove(RoutePoint? point)
        {
            if (point.HasValue && _bound?.State == SessionState.InMatch) _bound.OrderMove((float)point.Value.X, (float)point.Value.Y);
        }
        public void ReleaseMinimap() { _miniGesture.Abort(); RestoreCamera(); }
        void RestoreCamera()
        {
            var motion = _client != null ? _client.Session?.Motion : null;
            if (motion != null && motion.Initialized && _client.Cam != null && _client.Arena != null)
                _client.Arena.Follow(_client.Cam, motion.DrawnX, motion.DrawnY);
        }
        public void ReleaseTransient() { _mapOpen = false; _mapKeys.WindowBlur(); ReleaseMinimap(); if (_panel != null) _panel.gameObject.SetActive(false); UiBrowserStorage.CaptureTab(false); }
        void OnApplicationFocus(bool focused) { if (!focused) ReleaseTransient(); }
        void OnDisable() => ReleaseTransient();
        [Serializable] sealed class SavedRoute { public int version = 1; public double[] x, y; }
        void SaveRoute()
        {
            if (_storageKey == null || _bound.Training || !_routeStorageDirty) return;
            var points = _route.Export(); var saved = new SavedRoute { x = new double[points.Length], y = new double[points.Length] };
            for (int i = 0; i < points.Length; i++) { saved.x[i] = points[i].X; saved.y[i] = points[i].Y; }
            UiBrowserStorage.Set(_storageKey, JsonUtility.ToJson(saved)); _routeStorageDirty = false;
        }
        void LoadRoute()
        {
            if (_bound.Training) return;
            try
            {
                string text = UiBrowserStorage.Get(_storageKey); if (string.IsNullOrEmpty(text) || text.Length > 8192) return;
                var saved = JsonUtility.FromJson<SavedRoute>(text);
                if (saved == null || saved.version != 1 || saved.x == null || saved.y == null || saved.x.Length != saved.y.Length) return;
                var points = new List<RouteWaypoint>();
                for (int i = 0; i < Math.Min(saved.x.Length, RouteState.MaxWaypoints); i++) points.Add(new RouteWaypoint(saved.x[i], saved.y[i]));
                _route.Load(points, _bound.Map, Tile);
            } catch { /* Corrupt/blocked session storage starts with an empty private route. */ }
        }
    }
}

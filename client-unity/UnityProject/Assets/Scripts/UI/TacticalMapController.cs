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
using MapRect = Roguehalla.Net.Ui.MapRect;   // Net.Protocol gained a MapRect (P-WIRE17-MAP-3): the map screen's is meant here
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

        RectTransform _stage, _titleRect, _frameRect, _legendRect, _keyRoot, _zoneLegend, _planBar, _questScroll, _contactScroll;
        Image _planBarFill;
        TMP_Text _hint, _timer, _questsText, _inViewHeading, _questHeading, _planHeading;
        UnityEngine.UI.Button _close, _undo, _clear;
        readonly RectTransform[] _chips = new RectTransform[MapZones.Count + 1];
        readonly MinimapGesture _largeGesture = new MinimapGesture();
        MapScreenLayout _layout;
        Vector2 _layoutSize; MapScreenMode _layoutMode; float _layoutScale = -1f;
        double _planTotalMs;
        int _ownZone = -1;

        static void Put(RectTransform rect, MapRect m) { HudUi.Place(rect, HudAnchor.TopLeft, m.X, m.Y, m.W, m.H); }

        static Image GlyphImage(Transform parent, string name, MapGlyph glyph, Color color, float size, float x, float y)
        {
            float full = size * 64f / 52f;
            var rect = HudUi.At(parent, name, x - (full - size) / 2f, y - (full - size) / 2f, full, full);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = MapGlyphs.Sprite(glyph); image.color = color; image.preserveAspect = true; image.raycastTarget = false;
            return image;
        }

        public void Initialize(MatchClient client, Transform root, UiDisplayPreferences preferences = null, Transform hudStage = null)
        {
            _client = client;
            _prefs = preferences ?? new UiDisplayPreferences();
            var theme = UiTheme.Current;
            _stage = hudStage as RectTransform;
            // The panel is a stage-sized, stage-scaled rect (legacy units), so every number below is in HUD units.
            _panel = MythicUi.Rect(root, "TacticalMap", Vector2.zero, Vector2.one);
            var scrim = HudUi.Fill(_panel, "Scrim", UiTheme.With(theme.OutlineDark, .5f), true);
            scrim.rectTransform.offsetMin = new Vector2(-4000f, -4000f); scrim.rectTransform.offsetMax = new Vector2(4000f, 4000f);
            _scrim = scrim;
            _titleRect = HudUi.Box(_panel, "MapTitle", HudAnchor.TopLeft, 0, 0, 100, 30);
            _title = HudUi.Label(_titleRect, "MapHeading", "TACTICAL MAP", 20f, theme.Accent, TextAlignmentOptions.MidlineLeft, false, UiFontRole.Display);
            _hint = HudUi.Label(_titleRect, "MapHint", "", 11f, theme.TextSecondary, TextAlignmentOptions.MidlineRight);
            ((RectTransform)_hint.transform).offsetMax = new Vector2(-92f, ((RectTransform)_hint.transform).offsetMax.y);
            _timer = HudUi.Label(_titleRect, "PlanTimer", "", 26f, theme.Accent, TextAlignmentOptions.MidlineRight, false, UiFontRole.Display);
            _close = HudUi.Button(_titleRect, "CloseMap", "Close · Tab", HudAnchor.TopRight, 0, 4, 84, 24, () => SetOpen(false), 11f);
            _planBar = HudUi.Box(_titleRect, "PlanProgress", HudAnchor.BottomLeft, 0, 0, 100, 3);
            HudUi.Fill(_planBar, "Track", UiTheme.With(theme.Border, .35f));
            _planBarFill = HudUi.Fill(_planBar, "Fill", theme.AccentDim);

            _frameRect = HudUi.Box(_panel, "MapFrame", HudAnchor.TopLeft, 0, 0, 100, 100);
            HudUi.Surface(_frameRect, theme.SurfaceSunken, theme.CornerRadiusLarge, theme.Border, true, false);
            var mapRect = HudUi.Inset(_frameRect, "PublicMap", MapScreenLayout.FramePad, MapScreenLayout.FramePad, MapScreenLayout.FramePad, MapScreenLayout.FramePad);
            _large = mapRect.gameObject.AddComponent<TacticalMapSurface>(); _large.Initialize();
            _largeMarks = _large.GetComponentInChildren<TacticalMapMarks>(); _largeMarks.Large = true;
            _large.Pressed = LargePress; _large.Dragged = LargeDrag; _large.PointerReleased = LargeRelease; _large.Aborted = ReleaseLarge;
            for (byte i = 0; i < 2; i++)
            {
                byte pick = i;
                _spawnMarks[i] = HudUi.Button(_large.transform, "SpawnMarker" + i, (i + 1).ToString(), HudAnchor.Center, 0, 0, 52, 28, () => PickSpawn(pick), 12f);
                _spawnMarks[i].gameObject.SetActive(false);
            }

            // Zone legend under the map (Tab): icon + name per zone, so zones read without colour.
            _legendRect = HudUi.Box(_panel, "ZoneLegend", HudAnchor.TopLeft, 0, 0, 100, 30);
            _zoneLegend = _legendRect;
            for (int r = 1; r <= MapZones.Count; r++)
            {
                var chip = HudUi.Box(_legendRect, "Zone" + r, HudAnchor.TopLeft, 0, 0, 100, 26);
                HudUi.Surface(chip, theme.SurfaceRaised, theme.CornerRadiusSmall, theme.Border, false, false);
                GlyphImage(chip, "Icon", MapGlyphs.ForShape(MapZones.Shape(r)), theme.ZoneColor(r), 14f, 6f, 6f);
                var name = HudUi.Label(chip, "Name", MapZones.Name(r), 11f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft);
                ((RectTransform)name.transform).offsetMin = new Vector2(26f, ((RectTransform)name.transform).offsetMin.y);
                _chips[r] = chip;
            }

            _planningRail = HudUi.Box(_panel, "PlanningDecisions", HudAnchor.TopLeft, 0, 0, 340, 400);
            HudUi.Surface(_planningRail, theme.Surface, theme.CornerRadiusLarge, theme.Border, true, true);
            _ready = HudUi.Button(_planningRail, "Ready", "READY", HudAnchor.TopLeft, 12, 12, 316, 46, Ready, 14f);
            _planHeading = HudUi.Label(_planningRail, "SpawnHeading", "CHOOSE YOUR SPAWN  ·  keys 1 / 2", 11f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft);
            for (int i = 0; i < 2; i++)
            {
                byte pick = (byte)i;
                _spawns[i] = HudUi.Button(_planningRail, "Spawn" + i, (i + 1) + " · SPAWN", HudAnchor.TopLeft, 12, 0, 316, 56, () => PickSpawn(pick), 13f);
                _boons[i] = HudUi.Button(_planningRail, "Boon" + i, "BOON", HudAnchor.TopLeft, 12, 0, 316, 40, () => PickBoon(pick), 12f);
            }
            _routeText = HudUi.Label(_panel, "RouteSummary", "Click the map to add a route stop", 11f, theme.TextSecondary, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            _undo = HudUi.Button(_panel, "UndoRoute", "Undo stop", HudAnchor.TopLeft, 0, 0, 100, 26, () => { _route.Undo(); _routeStorageDirty = true; _nextPath = _nextPaint = 0; }, 11f);
            _clear = HudUi.Button(_panel, "ClearRoute", "Clear route", HudAnchor.TopLeft, 0, 0, 100, 26, () => { _route.Clear(); _routeStorageDirty = true; _nextPath = _nextPaint = 0; }, 11f);
            _status = HudUi.Label(_panel, "MapStatus", "", 12f, theme.TextSecondary, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);

            // Tab columns: left = map key + contacts in view, right = weapon guide + quests/traders.
            _runRail = MythicUi.Rect(_panel, "TacticalInformation", Vector2.zero, Vector2.one);
            _contactRail = HudUi.Box(_runRail, "ContactsPage", HudAnchor.TopLeft, 0, 0, 250, 500);
            HudUi.Surface(_contactRail, theme.Surface, theme.CornerRadiusLarge, theme.Border, true, true);
            HudUi.Label(_contactRail, "KeyHeading", "MAP KEY", 13f, theme.Accent, TextAlignmentOptions.TopLeft, false, UiFontRole.Display).rectTransform.offsetMin = new Vector2(12f, -20f);
            ((RectTransform)_contactRail.Find("KeyHeading")).offsetMax = new Vector2(-12f, -10f);
            BuildKey(theme);
            _inViewHeading = HudUi.Label(_contactRail, "InViewHeading", "IN VIEW", 13f, theme.Accent, TextAlignmentOptions.TopLeft, false, UiFontRole.Display);
            _contactsText = MythicUi.ScrollText(_contactRail, "DeliveredContacts", "", Vector2.zero, Vector2.one, 7.7f);
            _contactScroll = (RectTransform)_contactsText.transform.parent.parent;
            _counterRail = HudUi.Box(_runRail, "WeaponsPage", HudAnchor.TopLeft, 0, 0, 250, 500);
            HudUi.Surface(_counterRail, theme.Surface, theme.CornerRadiusLarge, theme.Border, true, true);
            HudUi.Label(_counterRail, "WeaponHeading", "WEAPON COUNTERS", 13f, theme.Accent, TextAlignmentOptions.TopLeft, false, UiFontRole.Display).rectTransform.offsetMin = new Vector2(12f, -20f);
            ((RectTransform)_counterRail.Find("WeaponHeading")).offsetMax = new Vector2(-12f, -10f);
            var wheelFrame = HudUi.At(_counterRail, "Diagram", 10, 34, 230, 230);
            _counterGuide = new WeaponCounterGuide(wheelFrame, "fists");
            _counterGuide.SetLayout(Vector2.zero, Vector2.one, Vector2.zero, Vector2.one);
            _counterGuide.LegendRoot.SetParent(_counterRail, false);
            foreach (var node in _counterGuide.WheelRoot.GetComponentsInChildren<UnityEngine.UI.Button>(true))
            {
                ((RectTransform)node.transform).sizeDelta = new Vector2(68f, 26f);
                foreach (var t in node.GetComponentsInChildren<TMP_Text>(true)) FixSize(t, 11f);
            }
            var legendText = _counterGuide.LegendRoot.GetComponentInChildren<TMP_Text>();
            legendText.text = "Arrows point to the weapon each one counters. + advantage, ! threat."; FixSize(legendText, 10f);
            _questHeading = HudUi.Label(_counterRail, "QuestHeading", "QUESTS & TRADERS", 13f, theme.Accent, TextAlignmentOptions.TopLeft, false, UiFontRole.Display);
            _questsText = MythicUi.ScrollText(_counterRail, "QuestList", "", Vector2.zero, Vector2.one, 7.7f);
            _questScroll = (RectTransform)_questsText.transform.parent.parent;

            // Legacy minimap: a square 12/12 from the bottom-right corner, no button strip, frame ring is the border (drawn rect = hit rect).
            _miniRoot = HudUi.Box(hudStage ?? root, "Minimap", HudAnchor.BottomRight, 12f, 12f, 270f, 270f);
            HudUi.Surface(_miniRoot, theme.SurfaceSunken, theme.CornerRadius, theme.Border, false, true);
            var miniFrame = MythicUi.Rect(_miniRoot, "TerrainFrame", Vector2.zero, Vector2.one);
            _mini = miniFrame.gameObject.AddComponent<TacticalMapSurface>(); _mini.Initialize();
            _miniMarks = _mini.GetComponentInChildren<TacticalMapMarks>();
            _mini.Pressed = MinimapPress; _mini.Dragged = MinimapDrag; _mini.PointerReleased = MinimapRelease; _mini.Aborted = ReleaseMinimap;
            // Route controls draw over both the planning card and the Tab columns.
            _routeText.transform.SetAsLastSibling(); _undo.transform.SetAsLastSibling(); _clear.transform.SetAsLastSibling(); _status.transform.SetAsLastSibling();
            _layoutScale = -1f;
            SyncStage(); ApplyLayout(true);
            _panel.gameObject.SetActive(false); _miniRoot.gameObject.SetActive(false);
        }
        Image _scrim;

        void BuildKey(UiTheme theme)
        {
            _keyRoot = HudUi.At(_contactRail, "Key", 0, 34, 250, 218);
            float y = 0f;
            Func<string, RectTransform> row = text =>
            {
                var r = HudUi.At(_keyRoot, "KeyRow", 0, y, 250, 19);
                var l = HudUi.Label(r, "Text", text, 11f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft);
                ((RectTransform)l.transform).offsetMin = new Vector2(34f, ((RectTransform)l.transform).offsetMin.y);
                y += 19f; return r;
            };
            var r0 = row("You"); GlyphImage(r0, "Icon", MapGlyph.Disc, theme.Info, 12f, 14f, 3f);
            var r1 = row("Players");
            for (int f = 0; f < 5; f++)
            {
                MapGlyph g = f == 0 ? MapGlyph.Triangle : f == 1 ? MapGlyph.Diamond : f == 2 ? MapGlyph.Trefoil : f == 3 ? MapGlyph.Asterisk : MapGlyph.Ring;
                GlyphImage(r1, "Faction" + f, g, theme.Faction[f], 12f, 14f + f * 15f, 3f);
            }
            ((RectTransform)r1.Find("Text")).offsetMin = new Vector2(34f + 4f * 15f + 4f, ((RectTransform)r1.Find("Text")).offsetMin.y);
            var r2 = row("Creatures"); GlyphImage(r2, "Icon", MapGlyph.Disc, theme.TextSecondary, 8f, 16f, 5f);
            var rb = row("Camp buff");   // one stat icon per camp, in the stat's colour (P-UNITY-DECLUTTER-1)
            {
                var rect = HudUi.At(rb, "Icon", 14f, 2f, 14f, 14f);
                var img = rect.gameObject.AddComponent<Image>();
                img.sprite = CampRespawnLabels.Art(CampBadges.IconKey(2)); img.color = theme.TextPrimary;   // the map tints it per stat
                img.preserveAspect = true; img.raycastTarget = false;
            }
            var re = row("Elite camp"); GlyphImage(re, "Icon", MapGlyph.Diamond, theme.Accent, 12f, 14f, 3f);   // the gold of the map's elite diamond
            var r3 = row("Quest giver"); GlyphImage(r3, "Icon", MapGlyph.Diamond, theme.TextPrimary, 12f, 14f, 3f);
            var r4 = row("Trader"); GlyphImage(r4, "Icon", MapGlyph.Ring, theme.TextPrimary, 12f, 14f, 3f);
            var r5 = row("Quest objective"); GlyphImage(r5, "Icon", MapGlyph.Cross, theme.TextPrimary, 12f, 14f, 3f);
            var r6 = row("Reward chest"); GlyphImage(r6, "Icon", MapGlyph.Plus, theme.Accent, 12f, 14f, 3f);
            var r7 = row("Route stop"); GlyphImage(r7, "Icon", MapGlyph.Disc, theme.Accent, 8f, 16f, 5f);
            var r8 = row("Walk target (right-click)"); GlyphImage(r8, "Icon", MapGlyph.Ring, theme.Success, 12f, 14f, 3f);
        }

        /// <summary>Pins a Mythic text to an exact HUD size (its MythicTextScale would otherwise re-apply a larger base).</summary>
        static void FixSize(TMP_Text t, float size)
        {
            t.enableAutoSizing = false; t.fontSize = size;
            var scale = t.GetComponent<MythicTextScale>();
            if (scale != null) { scale.BaseSize = size; scale.Apply(1f); }
        }

        float TextScale() { var s = ShowcaseSettings.Current; return s != null ? Mathf.Clamp(s.TextScale, 1f, 1.5f) : 1f; }

        /// <summary>Gives the panel the stage's size and scale, so its children use legacy HUD units.</summary>
        void SyncStage()
        {
            if (_panel == null || _stage == null) return;
            _panel.anchorMin = _panel.anchorMax = _panel.pivot = new Vector2(.5f, .5f);
            _panel.anchoredPosition = Vector2.zero; _panel.sizeDelta = _stage.sizeDelta; _panel.localScale = _stage.localScale;
        }

        string _laidLegend;
        void ApplyLayout(bool force = false)
        {
            if (_panel == null) return;
            SyncStage();
            var size = _stage != null ? _stage.sizeDelta : _panel.rect.size;
            if (size.x < 2f || size.y < 2f) size = new Vector2(1280f, 800f);
            var mode = IsPlanning ? MapScreenMode.Planning : MapScreenMode.Tab; float ts = TextScale();
            if (!force && size == _layoutSize && mode == _layoutMode && Mathf.Approximately(ts, _layoutScale)) return;
            _layoutSize = size; _layoutMode = mode; _layoutScale = ts;
            var L = _layout = MapScreenLayout.Compute(size.x, size.y, mode, ts);
            bool tab = mode == MapScreenMode.Tab;
            var theme = UiTheme.Current;
            _scrim.color = UiTheme.With(theme.OutlineDark, tab ? .72f : .84f);
            Put(_titleRect, L.Title); Put(_frameRect, L.Frame);
            _close.gameObject.SetActive(tab); _timer.gameObject.SetActive(!tab); _planBar.gameObject.SetActive(!tab);
            _planBar.sizeDelta = new Vector2(L.Title.W, 3f);
            _hint.gameObject.SetActive(tab);
            _zoneLegend.gameObject.SetActive(tab); _planningRail.gameObject.SetActive(!tab); _runRail.gameObject.SetActive(tab);
            if (tab)
            {
                Put(_legendRect, L.Legend);
                float gap = 4f, cw = (L.Legend.W - gap * (MapZones.Count - 1)) / MapZones.Count;
                for (int r = 1; r <= MapZones.Count; r++) HudUi.Place(_chips[r], HudAnchor.TopLeft, (r - 1) * (cw + gap), 2f, cw, 26f);
                Put((RectTransform)_contactRail, L.Left); Put((RectTransform)_counterRail, L.Right);
                float lw = L.Left.W, lh = L.Left.H; bool compact = lh < 430f;
                _keyRoot.gameObject.SetActive(!compact);
                float viewY = compact ? 10f : 252f;
                var vh = (RectTransform)_inViewHeading.transform; vh.anchorMin = vh.anchorMax = vh.pivot = new Vector2(.5f, 1f); vh.sizeDelta = new Vector2(lw - 24f, 20f); vh.anchoredPosition = new Vector2(0f, -viewY);
                _contactScroll.anchorMin = Vector2.zero; _contactScroll.anchorMax = Vector2.one;
                _contactScroll.offsetMin = new Vector2(8f, 112f); _contactScroll.offsetMax = new Vector2(-8f, -(viewY + 22f));
                float rw = L.Right.W, rh = L.Right.H;
                float sq = Mathf.Max(80f, Mathf.Min(rw - 20f, rh * .48f));
                var diagram = (RectTransform)_counterGuide.WheelRoot.parent;
                HudUi.Place(diagram, HudAnchor.TopLeft, (rw - sq) / 2f, 34f, sq, sq);
                // The legend takes the height its text needs (two to four lines once a weapon is highlighted); the quests heading follows it.
                var legendLabel = _counterGuide.LegendRoot.GetComponentInChildren<TMP_Text>();
                float legendH = 30f;
                if (legendLabel != null) { legendH = Mathf.Max(30f, Mathf.Ceil(legendLabel.GetPreferredValues(legendLabel.text, rw - 20f, 0f).y) + 4f); _laidLegend = legendLabel.text; }
                HudUi.Place(_counterGuide.LegendRoot, HudAnchor.TopLeft, 10f, 34f + sq + 2f, rw - 20f, legendH);
                float qy = 34f + sq + 2f + legendH + 6f;
                var qh = (RectTransform)_questHeading.transform; qh.anchorMin = qh.anchorMax = qh.pivot = new Vector2(.5f, 1f); qh.sizeDelta = new Vector2(rw - 24f, 20f); qh.anchoredPosition = new Vector2(0f, -qy);
                _questScroll.anchorMin = Vector2.zero; _questScroll.anchorMax = Vector2.one;
                _questScroll.offsetMin = new Vector2(8f, 10f); _questScroll.offsetMax = new Vector2(-8f, -(qy + 22f));
                // Route controls sit at the foot of the left column.
                Put((RectTransform)_routeText.transform, new MapRect(L.Left.X + 12f, L.Left.Bottom - 104f, lw - 24f, 44f));
                float bw = (lw - 30f) / 2f;
                HudUi.Place(_undo.GetComponent<RectTransform>(), HudAnchor.TopLeft, L.Left.X + 12f, L.Left.Bottom - 54f, bw, 28f);
                HudUi.Place(_clear.GetComponent<RectTransform>(), HudAnchor.TopLeft, L.Left.X + 18f + bw, L.Left.Bottom - 54f, bw, 28f);
                _status.gameObject.SetActive(false);
            }
            else
            {
                float f = Mathf.Clamp(L.Right.H / 520f, .72f, 1f);
                float y = 12f;
                HudUi.Place(_ready.GetComponent<RectTransform>(), HudAnchor.TopLeft, 12f, y, 316f, 46f * f); y += 46f * f + 12f;
                HudUi.Place(_planHeading.rectTransform, HudAnchor.TopLeft, 12f, y, 316f, 16f); y += 20f;
                for (int i = 0; i < 2; i++) { HudUi.Place(_spawns[i].GetComponent<RectTransform>(), HudAnchor.TopLeft, 12f, y, 316f, 56f * f); y += 56f * f + 6f; }
                y += 8f;
                for (int i = 0; i < 2; i++) { HudUi.Place(_boons[i].GetComponent<RectTransform>(), HudAnchor.TopLeft, 12f, y, 316f, 40f * f); y += 40f * f + 6f; }
                y += 10f;
                float bw = 154f;
                HudUi.Place(_undo.GetComponent<RectTransform>(), HudAnchor.TopLeft, L.Right.X + 12f, L.Right.Y + y, bw, 28f);
                HudUi.Place(_clear.GetComponent<RectTransform>(), HudAnchor.TopLeft, L.Right.X + 12f + bw + 8f, L.Right.Y + y, bw, 28f);
                y += 38f;
                // The card hugs its content (legacy side column), never a tall empty panel.
                float cardH = Mathf.Min(L.Right.H, y + 76f);
                Put((RectTransform)_planningRail, new MapRect(L.Right.X, L.Right.Y, L.Right.W, cardH));
                Put(_status.rectTransform, new MapRect(L.Right.X + 12f, L.Right.Y + y, 316f, Mathf.Max(30f, cardH - y - 10f)));
                _status.gameObject.SetActive(true);
                Put((RectTransform)_routeText.transform, L.Legend);
            }
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
            ApplyLayout();
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
            _panel.gameObject.SetActive(IsPlanning || _mapOpen); WorldLabelVisibility.Hidden = _panel.gameObject.activeSelf;
            ApplyLayout();
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
            _panel.gameObject.SetActive(IsPlanning || _mapOpen); WorldLabelVisibility.Hidden = _panel.gameObject.activeSelf;
            if (_panel.gameObject.activeSelf) ApplyLayout();
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
            _panel.gameObject.SetActive(_bound.LastResult == null && (IsPlanning || _mapOpen)); WorldLabelVisibility.Hidden = _panel.gameObject.activeSelf;
            if (_panel.gameObject.activeSelf) ApplyLayout();
            UpdateMinimapRing();
            RefreshMinimapVisibility();
            if (_factsDirty) _nextPaint = 0;
            if (Time.realtimeSinceStartupAsDouble < _nextPaint) return;
            _factsDirty = false;
            _nextPaint = Time.realtimeSinceStartupAsDouble + 1d / 30d;
            var plan = _bound.Collections.Plan;
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
                _routePlan = _route.PlanAhead(_bound.Map, new RouteGeometry(Tile, _bound.OwnFoot, PreviewSpeed), plan == null && me != null ? new RoutePoint(me.X, me.Y) : _route.Start);
                _routePoints = _routePlan.Points;
                _routeText.text = (_route.Waypoints.Count - _route.NextIndex) + "/12 stops · " + (_routePlan.Start.HasValue ? _routePlan.EtaSeconds.ToString("0") + "s base-speed walk" : "choose a spawn for ETA") +
                    (_routePlan.Unreachable.Count > 0 ? " · " + _routePlan.Unreachable.Count + " unreachable" : "") + "\nClick the map to add a stop.";
            }
            SaveRoute();
            _large.Present(_bound, ShowRoute ? _routePoints : null); _mini.Present(_bound, ShowRoute ? _routePoints : null);
            TickGesture(_miniGesture);
            TickGesture(_largeGesture);
        }
        void TickGesture(MinimapGesture gesture)
        {
            var point = gesture.Tick(Time.realtimeSinceStartupAsDouble * 1000);
            if (point.HasValue && !SubmitMapMove(point, true)) gesture.Unsend();
        }
        void PresentPlan(PlanView plan)
        {
            bool connected = _bound.State == SessionState.InMatch;
            UpdateSelections();
            double remainingMs = Math.Max(0d, plan.EndsAt - _bound.ServerTimeMs);
            if (remainingMs > _planTotalMs) _planTotalMs = remainingMs;
            _title.text = "PLAN YOUR RUN";
            _timer.text = Math.Ceiling(remainingMs / 1000d) + "s";
            _planBarFill.rectTransform.anchorMax = new Vector2(_planTotalMs > 0d ? (float)Math.Min(1d, remainingMs / _planTotalMs) : 0f, 1f);
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
            _hint.text = ToggleMode ? "Delivered terrain and contacts · Tab closes · right-click to walk" : "Delivered terrain and contacts · release Tab to return · right-click to walk";
            RefreshOwnZone();
            if (_lastContactsSnapshot == _bound.SnapshotsReceived) return;
            _lastContactsSnapshot = _bound.SnapshotsReceived;
            _contacts.Clear(); _bound.Snapshots.Sample(_bound.Snapshots.NewestMs, _contacts);
            var text = new StringBuilder();
            int shown = 0;
            var groups = new List<KeyValuePair<string, int>>();
            foreach (var actor in _contacts)
            {
                if (actor.Id == _bound.PlayerId) continue;
                shown++;
                string faction = actor.Faction.HasValue ? ShowcasePalette.GetFactionName((int)actor.Faction.Value) : "Neutral";
                if (actor.Kind == ActorKind.Player) { text.Append(faction).Append(" · Player\n"); continue; }
                string key = faction + " · " + actor.Kind;
                int at = groups.FindIndex(g => g.Key == key);
                if (at < 0) groups.Add(new KeyValuePair<string, int>(key, 1)); else groups[at] = new KeyValuePair<string, int>(key, groups[at].Value + 1);
            }
            foreach (var g in groups) text.Append(g.Key).Append(" x").Append(g.Value).Append("\n");
            if (shown == 0) text.Append("No other contacts in view.");
            _contactsText.text = text.ToString().TrimEnd('\n');
            _counterGuide.SetWeapon(_bound.Me != null ? _bound.Me.Weapon.ToString() : "fists");
            var legendNow = _counterGuide.LegendRoot != null ? _counterGuide.LegendRoot.GetComponentInChildren<TMP_Text>() : null;
            if (legendNow != null && legendNow.text != _laidLegend && _panel.gameObject.activeSelf) ApplyLayout(true);
            var quests = new StringBuilder();
            var qs = _bound.Collections.Quests;
            if (qs != null && qs.Available) foreach (var row in qs.Rows) quests.Append(row.GiverLabel).Append(": ").Append(row.Name).Append("\n");
            var trade = _bound.Collections.Trade;
            if (trade != null && trade.Available) foreach (var m in trade.Merchants) quests.Append(m.Name).Append(" · trader\n");
            if (quests.Length == 0) quests.Append("No quest givers or traders delivered.");
            _questsText.text = quests.ToString().TrimEnd('\n');
        }
        /// <summary>The zone chip of the region under the player gets the gold frame.</summary>
        void RefreshOwnZone()
        {
            int zone = 0;
            var map = _bound.Map; var me = _bound.Me;
            if (map != null && map.Regions != null && map.Regions.Length == map.W * map.H && me != null)
            {
                int tx = Mathf.FloorToInt(me.X / Tile), ty = Mathf.FloorToInt(me.Y / Tile);
                if ((uint)tx < (uint)map.W && (uint)ty < (uint)map.H) zone = map.Regions[ty * map.W + tx];
            }
            if (zone == _ownZone) return;
            _ownZone = zone;
            var theme = UiTheme.Current;
            for (int r = 1; r <= MapZones.Count; r++) HudUi.SetFrame(_chips[r], r == zone ? theme.BorderStrong : theme.Border);
        }
        void ShowRail(bool weapons) { }
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
            Reconcile(_miniGesture, _mini);
            Reconcile(_largeGesture, _large);
        }
        void Reconcile(MinimapGesture gesture, TacticalMapSurface surface)
        {
            if (!gesture.IsPeeking && !gesture.IsSteering) return;
            var mouse = Mouse.current;
            if (mouse == null) { ReleaseMinimap(); return; }
            if (gesture.IsPeeking && !mouse.leftButton.isPressed)
            {
                gesture.Cancel(MinimapButton.Left); RestoreCamera();
            }
            if (gesture.IsSteering && !mouse.rightButton.isPressed)
            {
                if (mouse.rightButton.wasReleasedThisFrame)
                {
                    // Reconcile a missing UI pointer-up using this overlay canvas's current release position.
                    if (surface.ScreenWorld(mouse.position.ReadValue(), null, out var point))
                        gesture.Drag(MinimapButton.Right, new RoutePoint(point.x, point.y));
                    SubmitMapMove(gesture.Release(MinimapButton.Right, Time.realtimeSinceStartupAsDouble * 1000), false);
                }
                else gesture.Cancel(MinimapButton.Right);
            }
        }
        static MinimapButton MiniButton(PointerEventData.InputButton button) => button == PointerEventData.InputButton.Left ? MinimapButton.Left : MinimapButton.Right;
        bool CanWalkFromMap => _bound != null && _bound.State == SessionState.InMatch && !IsPlanning && _bound.LastResult == null;
        void MinimapPress(Vector2 point, PointerEventData.InputButton button)
        {
            if (!CanWalkFromMap || button == PointerEventData.InputButton.Middle) return;
            SubmitMapMove(_miniGesture.Press(MiniButton(button), new RoutePoint(point.x, point.y), Time.realtimeSinceStartupAsDouble * 1000), false);
        }
        void MinimapDrag(Vector2 point, PointerEventData.InputButton button)
        {
            if (button != PointerEventData.InputButton.Middle) _miniGesture.Drag(MiniButton(button), new RoutePoint(point.x, point.y));
        }
        void MinimapRelease(Vector2 point, PointerEventData.InputButton button)
        {
            if (button == PointerEventData.InputButton.Middle) return;
            _miniGesture.Drag(MiniButton(button), new RoutePoint(point.x, point.y));
            SubmitMapMove(_miniGesture.Release(MiniButton(button), Time.realtimeSinceStartupAsDouble * 1000), false);
            if (!IsPeeking) RestoreCamera();
        }
        // The Tab map: left click plans a route stop (as before); right click or right drag walks there like a minimap right-click.
        void LargePress(Vector2 point, PointerEventData.InputButton button)
        {
            if (button == PointerEventData.InputButton.Left) { AddRoutePoint(point); return; }
            if (button != PointerEventData.InputButton.Right || !CanWalkFromMap) return;
            SubmitMapMove(_largeGesture.Press(MinimapButton.Right, new RoutePoint(point.x, point.y), Time.realtimeSinceStartupAsDouble * 1000), false);
        }
        void LargeDrag(Vector2 point, PointerEventData.InputButton button)
        {
            if (button == PointerEventData.InputButton.Right) _largeGesture.Drag(MinimapButton.Right, new RoutePoint(point.x, point.y));
        }
        void LargeRelease(Vector2 point, PointerEventData.InputButton button)
        {
            if (button != PointerEventData.InputButton.Right) return;
            _largeGesture.Drag(MinimapButton.Right, new RoutePoint(point.x, point.y));
            SubmitMapMove(_largeGesture.Release(MinimapButton.Right, Time.realtimeSinceStartupAsDouble * 1000), false);
        }
        /// <summary>
        /// Sends a map destination as an ordinary move order through the match client: the world right-click's path (it spends the order
        /// budget and cancels a pending Stop retry; a held repeat is dropped when over budget). The server resolves walkability and pathing.
        /// </summary>
        bool SubmitMapMove(RoutePoint? point, bool repeat)
        {
            if (!point.HasValue || _bound?.State != SessionState.InMatch) return false;
            float x = (float)point.Value.X, y = (float)point.Value.Y;
            bool sent = _client != null && ReferenceEquals(_client.Session, _bound) ? _client.OrderMapMove(x, y, repeat) : _bound.OrderMove(x, y) != 0;
            if (sent && !repeat) { var at = new Vector2(x, y); _miniMarks.Ping(at); _largeMarks.Ping(at); }
            return sent;
        }
        void UpdateMinimapRing()
        {
            if (_miniRoot == null) return;
            var theme = UiTheme.Current;
            HudUi.SetFrame(_miniRoot, _miniGesture.IsSteering ? theme.Success : _miniGesture.IsPeeking ? theme.OutlineLight : theme.Border);
        }
        void ReleaseLarge() { _largeGesture.Abort(); }
        public void ReleaseMinimap() { _miniGesture.Abort(); _largeGesture.Abort(); RestoreCamera(); }
        void RestoreCamera()
        {
            var motion = _client != null ? _client.Session?.Motion : null;
            if (motion != null && motion.Initialized && _client.Cam != null && _client.Arena != null)
                _client.Arena.Follow(_client.Cam, motion.DrawnX, motion.DrawnY);
        }
        public void ReleaseTransient() { _mapOpen = false; WorldLabelVisibility.Hidden = false; _mapKeys.WindowBlur(); ReleaseMinimap(); if (_panel != null) _panel.gameObject.SetActive(false); UiBrowserStorage.CaptureTab(false); }
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

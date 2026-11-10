using System;
using System.Collections.Generic;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// The hub room, laid out as the legacy walkable hub (packages/client/src/hub/hubLayout.ts, world px, 28 x 18 tiles = 896 x 576):
    /// the arena stairs at the top centre, the training door in the east wall, the shop / wardrobe / titles / achievements / leaderboard
    /// kiosks down the west side, the weapon-counters decal in the middle and the five faction pedestals on an arc by the south wall.
    /// Each station appears exactly once, as a control in the room. The avatar only moves across this floor; stations are forwarded to
    /// the caller and this view never touches a Session or issues a gameplay command.
    ///
    /// Controls (legacy): WASD or arrows walk, E uses the station in reach, right-click walks to a point, a left-click on a station walks
    /// there and uses it. Every station is also an ordinary focusable button, so the keyboard can reach and press it directly.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HubAtriumView : MonoBehaviour
    {
        public const float RoomW = 896f, RoomH = 576f, Wall = 32f, AvatarRadius = 12f, Reach = 32f, MaxScale = 1.15f, MinScale = .45f; // the room never blows up past 1.15x: a bigger window gets margin, not a larger, emptier floor
        const float WalkSpeed = 210f;
        const float StallSeconds = .6f;
        public const string DefaultHint = "WASD or arrows to walk  ·  E to use a station  ·  right-click to walk  ·  or click a station";

        enum Kind { Arena, Training, Kiosk, Counters, Pedestal }

        sealed class Station
        {
            public Kind Kind; public string Id, Label, Hint, Verb;
            public LaunchIcon Icon; public MapGlyph Shape;
            public float X, Y, W, H, StandX, StandY;
            public int Faction = -1; public HubDestination Destination; public bool IsDestination;
            public bool Available = true, Solid; public string Reason = "", OffHint = "Unavailable";
            public Button Button; public TMP_Text HintText; public Image IconImage; public Image SelectedMark;
        }

        static readonly HubDestination[] KioskOrder = { HubDestination.Shop, HubDestination.Wardrobe, HubDestination.Titles, HubDestination.Achievements, HubDestination.Leaderboard };
        static readonly string[] KioskLabels = { "Shop", "Wardrobe", "Titles", "Achievements", "Leaderboard" };
        static readonly string[] KioskHints = { "Cosmetics", "Change your look", "Earned titles", "Your milestones", "Top this month" };
        static readonly LaunchIcon[] KioskIcons = { LaunchIcon.Shop, LaunchIcon.Wardrobe, LaunchIcon.Titles, LaunchIcon.Achievements, LaunchIcon.Leaderboard };
        static readonly Vector2[] PedestalSpots = { new Vector2(248, 456), new Vector2(348, 492), new Vector2(448, 504), new Vector2(548, 492), new Vector2(648, 456) };

        readonly List<Station> _stations = new List<Station>();
        RectTransform _area, _room, _avatar, _floorTint;
        Image _avatarDisc, _avatarShape;
        TMP_Text _prompt;
        HubAtriumMotion _motion;
        Action<HubDestination> _onStation;
        GameObject _returnFocus;
        Station _walkTarget;
        Vector2? _walkPoint;
        float _stall, _lastDistance;
        int _faction = 4;
        bool _initialized;

        /// <summary>Raised when the arena stairs are used (the same action as the panel's Start Run).</summary>
        public Action PlayRequested;
        /// <summary>Raised when the training door is used.</summary>
        public Action TrainingRequested;
        /// <summary>Raised when a pedestal is used, with its faction index (0 Fire .. 4 Holy).</summary>
        public Action<int> FactionPicked;

        public bool IsVisible { get { return _area != null && _area.gameObject.activeSelf; } }
        public RectTransform Room { get { return _room; } }
        public RectTransform Area { get { return _area; } }
        public float RoomScale { get { return _room != null ? _room.localScale.x : 1f; } }
        public Vector2 AvatarPosition { get { return Px(_motion); } }
        public string Prompt { get { return _prompt != null ? _prompt.text : ""; } }

        /// <summary>Builds the hub under <paramref name="parent"/>. Call <see cref="ApplyArea"/> to size it.</summary>
        public void Initialize(Transform parent, Action<HubDestination> onStation)
        {
            if (_initialized) throw new InvalidOperationException("HubAtriumView is already initialized.");
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            _onStation = onStation;
            var theme = UiTheme.Current;
            _area = HudUi.Box(parent, "HubAtrium", HudAnchor.TopLeft, 0, 0, RoomW, RoomH + 40f);
            _room = HudUi.Box(_area, "Room", HudAnchor.TopLeft, 0, 0, RoomW, RoomH);
            _room.pivot = new Vector2(.5f, 1f);
            BuildShell(theme);
            BuildStations(theme);
            BuildAvatar(theme);
            var promptBox = HudUi.Box(_area, "StationMessageBox", HudAnchor.BottomCenter, 0, 0, 620f, 28f);
            HudUi.Surface(promptBox, UiTheme.With(theme.Surface, .94f), 14f, theme.Border, false, false);
            var promptText = HudUi.Inset(promptBox, "StationMessageInset", 12f, 0f, 12f, 0f);
            _prompt = HudUi.Label(promptText, "StationMessage", DefaultHint, 13f, theme.TextPrimary, TextAlignmentOptions.Center, false, UiFontRole.Body, false);
            _prompt.name = "StationMessage";
            _motion = new HubAtriumMotion(Norm(448f, true), Norm(408f, false));
            _initialized = true;
            SetFaction(_faction);
            SetVisible(false);
        }

        /// <summary>Puts the avatar at a point of the room (legacy room pixels, y down), kept on the floor and out of solid stations.</summary>
        public void PlaceAvatar(float roomX, float roomY)
        {
            _walkTarget = null; _walkPoint = null;
            _motion = new HubAtriumMotion(Norm(roomX, true), Norm(roomY, false));
            Settle(); UpdateAvatar();
        }

        public void SetStationHandler(Action<HubDestination> onStation) { _onStation = onStation; }

        /// <summary>Places the hub in a rectangle of the parent (top-left inset and size, HUD units); the room is scaled to fit it.</summary>
        public void ApplyArea(float x, float y, float width, float height)
        {
            if (_area == null) return;
            float k = Mathf.Clamp(Mathf.Min(width / RoomW, (height - 36f) / RoomH), MinScale, MaxScale);
            // The area hugs the scaled room plus its prompt line, so the prompt sits just under the room instead of at the window's foot.
            HudUi.Place(_area, HudAnchor.TopLeft, x, y, width, Mathf.Min(height, RoomH * k + 36f));
            _room.anchorMin = _room.anchorMax = new Vector2(.5f, 1f);
            _room.pivot = new Vector2(.5f, 1f);
            _room.anchoredPosition = Vector2.zero;
            _room.sizeDelta = new Vector2(RoomW, RoomH);
            _room.localScale = new Vector3(k, k, 1f);
            var box = (RectTransform)_prompt.transform.parent.parent;
            HudUi.Place(box, HudAnchor.BottomCenter, 0, 0, Mathf.Min(620f, Mathf.Max(260f, width)), 28f);
        }

        public void SetVisible(bool visible)
        {
            if (_area == null || _area.gameObject.activeSelf == visible) return;
            if (visible)
            {
                _returnFocus = EventSystem.current == null ? null : EventSystem.current.currentSelectedGameObject;
                _area.gameObject.SetActive(true);
            }
            else
            {
                _area.gameObject.SetActive(false);
                _walkTarget = null; _walkPoint = null;
                if (EventSystem.current != null && _returnFocus != null && _returnFocus.activeInHierarchy)
                    EventSystem.current.SetSelectedGameObject(_returnFocus);
            }
        }

        /// <summary>Call once per frame while this view is in use. With allowKeyboard false no keyboard state is polled; a click's started walk can still finish.</summary>
        public void ReadInput(bool allowKeyboard)
        {
            if (!IsVisible) return;
            float horizontal = 0f, vertical = 0f;
            bool use = false;
            var keys = Keyboard.current;
            if (allowKeyboard && keys != null)
            {
                bool controlsHaveFocus = EventSystem.current != null && EventSystem.current.currentSelectedGameObject != null;
                if (keys.aKey.isPressed || !controlsHaveFocus && keys.leftArrowKey.isPressed) horizontal -= 1f;
                if (keys.dKey.isPressed || !controlsHaveFocus && keys.rightArrowKey.isPressed) horizontal += 1f;
                if (keys.sKey.isPressed || !controlsHaveFocus && keys.downArrowKey.isPressed) vertical -= 1f;
                if (keys.wKey.isPressed || !controlsHaveFocus && keys.upArrowKey.isPressed) vertical += 1f;
                if (horizontal != 0 || vertical != 0) EventSystem.current?.SetSelectedGameObject(null);
                use = keys.eKey.wasPressedThisFrame;
            }
            float dt = Time.unscaledDeltaTime, speed = WalkSpeed / (RoomW - 2f * Wall); // motion space is in floor widths
            if (horizontal != 0f || vertical != 0f)
            {
                _walkTarget = null; _walkPoint = null;
                _motion.Move(horizontal, vertical, dt, speed);
                Settle();
            }
            else if (_walkTarget != null || _walkPoint.HasValue)
            {
                var goal = _walkTarget != null ? new Vector2(_walkTarget.StandX, _walkTarget.StandY) : _walkPoint.Value;
                bool arrived = _motion.MoveToward(new HubPoint(Norm(goal.x, true), Norm(goal.y, false)), dt, speed);
                Settle();
                float remaining = Vector2.Distance(Px(_motion), goal);
                _stall = remaining < _lastDistance - .05f ? 0f : _stall + dt; _lastDistance = remaining;
                if (arrived || _stall > StallSeconds)
                {
                    var target = _walkTarget; _walkTarget = null; _walkPoint = null; _stall = 0f;
                    if (target != null) { if (Distance(target) <= Reach) Activate(target); else SetPrompt("Couldn't reach " + target.Label + ". Try walking closer."); }
                }
            }
            if (use)
            {
                var near = Nearest();
                if (near != null) Activate(near); else SetPrompt("Walk up to a station, then press E.");
            }
            UpdateAvatar();
            RefreshPrompt();
        }

        /// <summary>Sets a destination's externally-owned availability and its plain-language reason (shown when it is used while unavailable).</summary>
        public void SetStationAvailable(HubDestination destination, bool available, string reason)
        {
            foreach (var s in _stations)
            {
                if (!s.IsDestination || s.Destination != destination) continue;
                s.Available = available;
                s.Reason = string.IsNullOrWhiteSpace(reason) ? (available ? s.Label + " is ready." : s.Label + " isn't available right now.") : reason.Trim();
                RefreshStation(s);
            }
        }

        /// <summary>Whether the arena stairs and the training door can be used, with the reason shown when they cannot.</summary>
        public void SetPlayAvailable(bool arena, string arenaReason, string arenaHint, bool training, string trainingReason, string trainingHint)
        {
            foreach (var s in _stations)
            {
                if (s.Kind == Kind.Arena) { s.Available = arena; s.Reason = arenaReason ?? ""; s.OffHint = arenaHint; RefreshStation(s); }
                else if (s.Kind == Kind.Training) { s.Available = training; s.Reason = trainingReason ?? ""; s.OffHint = trainingHint; RefreshStation(s); }
            }
        }

        public void SetFaction(int faction)
        {
            _faction = Mathf.Clamp(faction, 0, 4);
            if (_avatarDisc == null) return;
            var theme = UiTheme.Current;
            _avatarDisc.color = theme.FactionColor(_faction);
            _avatarShape.sprite = MapGlyphs.Sprite(LaunchCopy.Houses[_faction].Shape);
            _floorTint.GetComponent<Image>().color = UiTheme.With(theme.FactionColor(_faction), .035f);
            foreach (var s in _stations) if (s.Kind == Kind.Pedestal) RefreshStation(s);
        }

        // ---------------------------------------------------------------- construction

        void BuildShell(UiTheme theme)
        {
            var shell = HudUi.Inset(_room, "Walls", 0, 0, 0, 0);
            HudUi.Surface(shell, UiTheme.With(theme.SurfaceRaised, .97f), 16f, theme.Border, false, true);
            var floor = HudUi.At(_room, "Floor", Wall, Wall, RoomW - 2 * Wall, RoomH - 2 * Wall);
            HudUi.Surface(floor, UiTheme.With(theme.Surface, .90f), 8f, theme.Border, true, false);
            floor.gameObject.AddComponent<HubFloorPointer>().Owner = this;
            var tint = HudUi.Inset(floor, "FloorTint", 0, 0, 0, 0);
            var tintImage = tint.gameObject.AddComponent<Image>();
            tintImage.sprite = UiSprites.Panel(theme, 8f); tintImage.type = Image.Type.Sliced; tintImage.raycastTarget = false;
            _floorTint = tint;
            // Flagstone rules: faint seams so the floor reads as a floor rather than a flat panel.
            for (int i = 1; i < 8; i++) LaunchUi.Bar(floor, "SeamH" + i, 8f, i * (RoomH - 2 * Wall) / 8f, RoomW - 2 * Wall - 16f, 1f, UiTheme.With(theme.Border, .10f));
            for (int i = 1; i < 13; i++) LaunchUi.Bar(floor, "SeamV" + i, i * (RoomW - 2 * Wall) / 13f, 8f, 1f, RoomH - 2 * Wall - 16f, UiTheme.With(theme.Border, .08f));
        }

        void BuildStations(UiTheme theme)
        {
            // Counters decal first so everything else draws over it.
            var counters = new Station { Kind = Kind.Counters, Id = "Counters", Label = "WEAPON COUNTERS", Hint = "Which weapon beats which", Verb = "Open weapon counters",
                Icon = LaunchIcon.Counters, X = 448, Y = 288, W = 440, H = 160, StandX = 448, StandY = 392, Destination = HubDestination.Counters, IsDestination = true };
            _stations.Add(counters);
            for (int i = 0; i < KioskOrder.Length; i++)
                _stations.Add(new Station { Kind = Kind.Kiosk, Id = KioskLabels[i], Label = KioskLabels[i], Hint = KioskHints[i], Verb = "Open " + KioskLabels[i], Icon = KioskIcons[i],
                    X = Wall + 8 + 88, Y = 96 + i * 78, W = 176, H = 60, StandX = Wall + 8 + 176 + 26, StandY = 96 + i * 78, Destination = KioskOrder[i], IsDestination = true, Solid = true });
            _stations.Add(new Station { Kind = Kind.Arena, Id = "Arena", Label = "THE ARENA", Hint = "Start a run", Verb = "Start your run", Icon = LaunchIcon.Arena,
                X = 448, Y = 66, W = 224, H = 56, StandX = 448, StandY = 122, Solid = true });
            _stations.Add(new Station { Kind = Kind.Training, Id = "Training", Label = "TRAINING", Hint = "Practice room", Verb = "Enter training", Icon = LaunchIcon.Training,
                X = RoomW - Wall - 8 - 70, Y = 288, W = 140, H = 60, StandX = RoomW - Wall - 8 - 140 - 26, StandY = 288, Solid = true });
            for (int i = 0; i < PedestalSpots.Length; i++)
                _stations.Add(new Station { Kind = Kind.Pedestal, Id = "Faction_" + LaunchCopy.Houses[i].Name, Label = LaunchCopy.Houses[i].Name, Hint = LaunchCopy.Houses[i].Weapon,
                    Verb = "Choose " + LaunchCopy.Houses[i].Name, Shape = LaunchCopy.Houses[i].Shape, Faction = i, X = PedestalSpots[i].x, Y = PedestalSpots[i].y, W = 66, H = 66,
                    StandX = PedestalSpots[i].x, StandY = PedestalSpots[i].y });

            // Tab order follows creation order: the kiosks first (west to east reading), then the arena and training, then the pedestals.
            var order = new List<Station>();
            foreach (var s in _stations) if (s.Kind == Kind.Counters) order.Add(s);
            foreach (var s in _stations) if (s.Kind == Kind.Arena) order.Add(s);
            foreach (var s in _stations) if (s.Kind == Kind.Kiosk) order.Add(s);
            foreach (var s in _stations) if (s.Kind == Kind.Training) order.Add(s);
            foreach (var s in _stations) if (s.Kind == Kind.Pedestal && s.Faction >= 0) order.Add(s);
            foreach (var s in order) BuildStationControl(s, theme);
        }

        void BuildStationControl(Station s, UiTheme theme)
        {
            var captured = s;
            float left = s.X - s.W / 2f, top = s.Y - s.H / 2f;
            if (s.Kind == Kind.Counters)
            {
                var b = LaunchUi.Button(_room, "Station_" + s.Id, left, top, s.W, s.H, LaunchUi.Look.Quiet, () => Press(captured), 14f);
                s.Button = b;
                var colors = b.colors; colors.normalColor = UiTheme.With(theme.SurfaceRaised, .35f); b.colors = colors;
                HudUi.Surface((RectTransform)b.transform, Color.white, 14f, theme.Border, true, false);
                s.IconImage = LaunchUi.Icon(b.transform, "Icon", s.Icon, 28f, 40f, 80f, theme.Accent);
                LaunchUi.Text(b.transform, "Name", 130f, 52f, 280f, 28f, s.Label, 18f, theme.Accent, TextAlignmentOptions.MidlineLeft, true, UiFontRole.Display);
                s.HintText = LaunchUi.Text(b.transform, "Hint", 130f, 82f, 290f, 22f, s.Hint, 13f, theme.TextSecondary);
            }
            else if (s.Kind == Kind.Pedestal)
            {
                var b = LaunchUi.Button(_room, "Station_" + s.Id, left, top, s.W, s.H, LaunchUi.Look.Raised, () => Press(captured), 10f);
                s.Button = b;
                s.IconImage = LaunchUi.Shape(b.transform, "Shape", s.Shape, (s.W - 30f) / 2f, 6f, 30f, theme.FactionColor(s.Faction));
                var pedestalName = LaunchUi.Text(b.transform, "Name", 0, 38f, s.W, 16f, s.Label, 12f, theme.TextPrimary, TextAlignmentOptions.Center, true);
                pedestalName.enableAutoSizing = true; pedestalName.fontSizeMin = 9f; pedestalName.fontSizeMax = 12f;
                s.HintText = LaunchUi.Text(b.transform, "Hint", 0, 51f, s.W, 13f, s.Hint, 10f, theme.TextSecondary, TextAlignmentOptions.Center);
                s.SelectedMark = LaunchUi.Icon(b.transform, "Selected", LaunchIcon.Check, s.W - 18f, 3f, 14f, theme.Accent);
            }
            else
            {
                bool arena = s.Kind == Kind.Arena;
                var b = LaunchUi.Button(_room, "Station_" + s.Id, left, top, s.W, s.H, arena ? LaunchUi.Look.Outline : LaunchUi.Look.Raised, () => Press(captured), 10f);
                s.Button = b;
                float iconBox = s.H - 12f;
                s.IconImage = LaunchUi.Icon(b.transform, "Icon", s.Icon, 10f, 6f, iconBox, theme.Accent);
                LaunchUi.Text(b.transform, "Name", iconBox + 14f, 8f, s.W - iconBox - 20f, s.H * .5f - 4f, s.Label, arena ? 17f : 13.5f, arena ? (Color)theme.Accent : theme.TextPrimary,
                    TextAlignmentOptions.MidlineLeft, true, arena ? UiFontRole.Display : UiFontRole.Body);
                s.HintText = LaunchUi.Text(b.transform, "Hint", iconBox + 14f, s.H * .5f + 1f, s.W - iconBox - 20f, s.H * .5f - 8f, s.Hint, 11.5f, theme.TextSecondary);
            }
            RefreshStation(s);
        }

        void BuildAvatar(UiTheme theme)
        {
            _avatar = HudUi.At(_room, "CosmeticAvatar", 0, 0, 28, 28);
            var shadow = HudUi.At(_avatar, "Shadow", 1f, 22f, 26f, 10f);
            var shadowImage = shadow.gameObject.AddComponent<Image>();
            shadowImage.sprite = UiSprites.Panel(theme, 5f); shadowImage.type = Image.Type.Sliced; shadowImage.color = UiTheme.With(theme.OutlineDark, .45f); shadowImage.raycastTarget = false;
            var disc = HudUi.Inset(_avatar, "Disc", 0, 0, 0, 0);
            _avatarDisc = disc.gameObject.AddComponent<Image>();
            _avatarDisc.sprite = UiSprites.Panel(theme, 14f); _avatarDisc.type = Image.Type.Sliced; _avatarDisc.raycastTarget = false;
            _avatarShape = LaunchUi.Shape(_avatar, "FactionMark", MapGlyph.Ring, 5f, 5f, 18f, theme.OutlineDark);
            UpdateAvatar();
        }

        // ---------------------------------------------------------------- behaviour

        void Press(Station s)
        {
            // A pointer or keyboard press on a station: the keyboard uses it directly, a mouse click walks there first (legacy).
            bool keyboard = Keyboard.current != null && (Keyboard.current.enterKey.wasPressedThisFrame || Keyboard.current.spaceKey.wasPressedThisFrame || Keyboard.current.numpadEnterKey.wasPressedThisFrame);
            if (keyboard || Distance(s) <= Reach) { _walkTarget = null; Activate(s); return; }
            _walkTarget = s; _walkPoint = null; _stall = 0f; _lastDistance = float.MaxValue;
            SetPrompt("Walking to " + s.Label.ToLowerInvariant() + "…");
        }

        internal void WalkToPoint(Vector2 roomPoint)
        {
            float margin = AvatarRadius + 2f;
            _walkTarget = null; _stall = 0f; _lastDistance = float.MaxValue;
            _walkPoint = new Vector2(Mathf.Clamp(roomPoint.x, Wall + margin, RoomW - Wall - margin), Mathf.Clamp(roomPoint.y, Wall + margin, RoomH - Wall - margin));
        }

        void Activate(Station s)
        {
            if (s.Kind == Kind.Pedestal)
            {
                if (s.Faction >= 0) { SetFaction(s.Faction); FactionPicked?.Invoke(s.Faction); SetPrompt(s.Label + " chosen."); }
                return;
            }
            if (!s.Available) { SetPrompt(string.IsNullOrEmpty(s.Reason) ? s.Label + " isn't available right now." : s.Reason); return; }
            if (s.Kind == Kind.Arena) { SetPrompt("Starting your run…"); PlayRequested?.Invoke(); return; }
            if (s.Kind == Kind.Training) { SetPrompt("Opening training…"); TrainingRequested?.Invoke(); return; }
            SetPrompt("Opening " + s.Label.ToLowerInvariant() + "…");
            _onStation?.Invoke(s.Destination);
        }

        Station Nearest()
        {
            Station best = null; float bestDistance = Reach;
            foreach (var s in _stations)
            {
                if (s.Button == null) continue;
                float d = Distance(s);
                if (d <= bestDistance) { best = s; bestDistance = d; }
            }
            return best;
        }

        /// <summary>Distance from the avatar's centre to a station's footprint rectangle (0 inside it).</summary>
        float Distance(Station s)
        {
            var p = Px(_motion);
            float dx = Mathf.Max(Mathf.Abs(p.x - s.X) - s.W / 2f, 0f), dy = Mathf.Max(Mathf.Abs(p.y - s.Y) - s.H / 2f, 0f);
            return Mathf.Sqrt(dx * dx + dy * dy);
        }

        void RefreshPrompt()
        {
            if (_walkTarget != null || _walkPoint.HasValue) return;
            var near = Nearest();
            if (near != null) SetPrompt("E: " + near.Verb + (near.Available || near.Kind == Kind.Pedestal ? "" : "  (unavailable)"));
            else if (_prompt.text != DefaultHint && _promptHold <= 0f) SetPrompt(DefaultHint);
            _promptHold = Mathf.Max(0f, _promptHold - Time.unscaledDeltaTime);
        }
        float _promptHold;
        void SetPrompt(string text) { if (_prompt != null && _prompt.text != text) _prompt.text = text; _promptHold = 2.5f; }

        void RefreshStation(Station s)
        {
            if (s.Button == null) return;
            var theme = UiTheme.Current;
            if (s.Kind == Kind.Pedestal)
            {
                bool selected = s.Faction == _faction;
                var colors = s.Button.colors; colors.normalColor = selected ? theme.SurfaceSelected : theme.SurfaceRaised; s.Button.colors = colors;
                HudUi.SetFrame((RectTransform)s.Button.transform, selected ? theme.BorderStrong : theme.Border);
                if (s.SelectedMark != null) s.SelectedMark.enabled = selected;
                return;
            }
            bool counters = s.Kind == Kind.Counters;
            if (s.IconImage != null) s.IconImage.color = s.Available ? (Color)theme.Accent : theme.TextSecondary;
            if (s.HintText != null)
            {
                s.HintText.text = s.Available ? s.Hint : (string.IsNullOrEmpty(s.OffHint) ? "Unavailable" : s.OffHint);
                s.HintText.color = theme.TextSecondary;
            }
            if (!counters)
            {
                var colors = s.Button.colors;
                colors.normalColor = s.Available ? theme.SurfaceRaised : theme.SurfaceDisabled; s.Button.colors = colors;
            }
        }

        void Settle()
        {
            // Keep the avatar on the floor and out of the solid stations (circle against rectangle).
            var p = Px(_motion);
            float lo = Wall + AvatarRadius, hiX = RoomW - Wall - AvatarRadius, hiY = RoomH - Wall - AvatarRadius;
            p.x = Mathf.Clamp(p.x, lo, hiX); p.y = Mathf.Clamp(p.y, lo, hiY);
            for (int pass = 0; pass < 2; pass++)
                foreach (var s in _stations)
                {
                    if (!s.Solid) continue;
                    float cx = Mathf.Clamp(p.x, s.X - s.W / 2f, s.X + s.W / 2f), cy = Mathf.Clamp(p.y, s.Y - s.H / 2f, s.Y + s.H / 2f);
                    var d = new Vector2(p.x - cx, p.y - cy); float len = d.magnitude;
                    if (len >= AvatarRadius) continue;
                    if (len < .001f)
                    {
                        // Centre inside the rectangle: leave through the nearest side.
                        float l = p.x - (s.X - s.W / 2f), r = s.X + s.W / 2f - p.x, t = p.y - (s.Y - s.H / 2f), b = s.Y + s.H / 2f - p.y;
                        float m = Mathf.Min(Mathf.Min(l, r), Mathf.Min(t, b));
                        if (m == l) p.x = s.X - s.W / 2f - AvatarRadius; else if (m == r) p.x = s.X + s.W / 2f + AvatarRadius;
                        else if (m == t) p.y = s.Y - s.H / 2f - AvatarRadius; else p.y = s.Y + s.H / 2f + AvatarRadius;
                    }
                    else p += d / len * (AvatarRadius - len);
                }
            p.x = Mathf.Clamp(p.x, lo, hiX); p.y = Mathf.Clamp(p.y, lo, hiY);
            _motion = new HubAtriumMotion(Norm(p.x, true), Norm(p.y, false));
        }

        void UpdateAvatar()
        {
            if (_avatar == null) return;
            var p = Px(_motion);
            _avatar.anchoredPosition = new Vector2(p.x - 14f, -(p.y - 14f));
        }

        // Motion space: x and y both in floor-width units, x from the floor's left edge, y up from its bottom edge.
        static float Norm(float px, bool horizontal)
        {
            float w = RoomW - 2f * Wall;
            return horizontal ? (px - Wall) / w : (RoomH - Wall - px) / w;
        }

        static Vector2 Px(HubAtriumMotion m)
        {
            float w = RoomW - 2f * Wall;
            return new Vector2(Wall + m.X * w, RoomH - Wall - m.Y * w);
        }

        /// <summary>A right-click on the bare floor walks the avatar there; the room lives in its own scaled space.</summary>
        sealed class HubFloorPointer : MonoBehaviour, IPointerClickHandler
        {
            public HubAtriumView Owner;
            public void OnPointerClick(PointerEventData eventData)
            {
                if (eventData.button != PointerEventData.InputButton.Right || Owner == null) return;
                if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(Owner._room, eventData.position, eventData.pressEventCamera, out var local)) return;
                // Room local space is bottom-up around the pivot; convert to the legacy top-down room pixels.
                float x = local.x + RoomW * Owner._room.pivot.x, y = RoomH - (local.y + RoomH * Owner._room.pivot.y);
                Owner.WalkToPoint(new Vector2(x, y));
            }
        }
    }
}

using System;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// Walkable, cosmetic home hub. The avatar only moves across this screen's floor; destinations are
    /// forwarded to the caller and this view never accesses a Session or issues gameplay commands.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HubAtriumView : MonoBehaviour
    {
        const int StationCount = 8;
        const float AvatarSpeed = .72f;
        const float ActivationRadius = .105f;

        static readonly HubDestination[] Destinations =
        {
            HubDestination.Champions, HubDestination.Weapons, HubDestination.Counters, HubDestination.Shop,
            HubDestination.Wardrobe, HubDestination.Titles, HubDestination.Achievements, HubDestination.Leaderboard
        };
        static readonly string[] Names = { "Champions", "Weapons", "Counters", "Shop", "Wardrobe", "Titles", "Achievements", "Leaderboard" };
        static readonly HubPoint[] StationPoints =
        {
            new HubPoint(.14f, .25f), new HubPoint(.38f, .25f), new HubPoint(.62f, .25f), new HubPoint(.86f, .25f),
            new HubPoint(.14f, .75f), new HubPoint(.38f, .75f), new HubPoint(.62f, .75f), new HubPoint(.86f, .75f)
        };
        static readonly string[] DefaultReasons =
        {
            "Champion selection is available.", "Weapon selection is available.", "Counter guide is available.",
            "Shop services are not available yet.", "Wardrobe services are not available yet.", "Titles are not available yet.",
            "Achievements are not available yet.", "Leaderboard services are not available yet."
        };

        RectTransform _panel;
        RectTransform _floor;
        RectTransform _avatar;
        Image _avatarImage;
        TMP_Text _avatarMark;
        TMP_Text _message;
        Button[] _directoryButtons;
        Button[] _stationButtons;
        Button _closeButton;
        TMP_Text[] _directoryLabels;
        TMP_Text[] _stationLabels;
        readonly bool[] _available = new bool[StationCount];
        readonly string[] _reasons = new string[StationCount];
        HubAtriumMotion _motion = new HubAtriumMotion(.5f, .48f);
        Action<HubDestination> _onStation;
        GameObject _returnFocus;
        Sprite _avatarSprite;
        int _targetStation = -1;
        int _faction = 4;
        bool _initialized;

        public bool IsVisible { get { return _panel != null && _panel.gameObject.activeSelf; } }
        public HubAtriumMotion Motion { get { return _motion; } }
        public Sprite AvatarSprite { get { return _avatarSprite; } set { SetAvatarSprite(value); } }

        /// <summary>Creates the right-side atrium in the reserved 0.37,0.17–0.98,0.87 region.</summary>
        public void Initialize(Transform root, Action<HubDestination> onStation)
        {
            if (_initialized) throw new InvalidOperationException("HubAtriumView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            _onStation = onStation;
            _panel = MythicUi.Panel(root, "HubAtrium", new Vector2(.37f, .17f), new Vector2(.98f, .87f), ShowcasePalette.Panel, true);
            BuildHeader();
            BuildDirectory();
            BuildFloor();
            BuildFooter();
            for (int i = 0; i < StationCount; i++)
            {
                _available[i] = i < 3;
                _reasons[i] = DefaultReasons[i];
            }
            _initialized = true;
            SetFaction(_faction);
            RefreshStationLabels();
            SetVisible(false);
        }

        public void SetVisible(bool visible)
        {
            if (_panel == null || _panel.gameObject.activeSelf == visible) return;
            if (visible)
            {
                _returnFocus = EventSystem.current == null ? null : EventSystem.current.currentSelectedGameObject;
                _panel.gameObject.SetActive(true);
                if (EventSystem.current != null && _directoryButtons != null)
                    EventSystem.current.SetSelectedGameObject(_directoryButtons[0].gameObject);
            }
            else
            {
                _panel.gameObject.SetActive(false);
                _targetStation = -1;
                if (EventSystem.current != null && _returnFocus != null && _returnFocus.activeInHierarchy)
                    EventSystem.current.SetSelectedGameObject(_returnFocus);
            }
        }

        /// <summary>
        /// Call once per frame while this view is in use. When allowKeyboard is false no keyboard
        /// state is polled; a station click's already-started cosmetic walk can still finish.
        /// </summary>
        public void ReadInput(bool allowKeyboard)
        {
            if (!IsVisible) return;
            float horizontal = 0f, vertical = 0f;
            bool activate = false;
            if (allowKeyboard)
            {
                if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) horizontal -= 1f;
                if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) horizontal += 1f;
                if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) vertical -= 1f;
                if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) vertical += 1f;
                activate = Input.GetKeyDown(KeyCode.E);
            }

            bool manualMove = horizontal != 0f || vertical != 0f;
            if (manualMove)
            {
                _targetStation = -1;
                _motion.Move(horizontal, vertical, Time.unscaledDeltaTime, AvatarSpeed);
                UpdateAvatarPosition();
            }
            else if (_targetStation >= 0)
            {
                int target = _targetStation;
                if (_motion.MoveToward(StationPoints[target], Time.unscaledDeltaTime, AvatarSpeed))
                {
                    _targetStation = -1;
                    UpdateAvatarPosition();
                    Activate(target);
                }
                else UpdateAvatarPosition();
            }

            if (activate)
            {
                int nearby = _motion.FindNearby(StationPoints, ActivationRadius);
                if (nearby >= 0) Activate(nearby);
                else _message.text = "Move closer to a station, then press E.";
            }
        }

        /// <summary>Sets a destination's externally-owned availability and its plain-language reason.</summary>
        public void SetStationAvailable(HubDestination destination, bool available, string reason)
        {
            int index = (int)destination;
            if (index < 0 || index >= StationCount) return;
            _available[index] = available;
            _reasons[index] = string.IsNullOrWhiteSpace(reason)
                ? available ? Names[index] + " is ready." : Names[index] + " is not available yet."
                : reason.Trim();
            RefreshStationLabel(index);
        }

        public void SetFaction(int faction)
        {
            _faction = Mathf.Clamp(faction, 0, 4);
            if (_avatarMark == null) return;
            _avatarMark.text = ShowcasePalette.GetFactionMark(_faction);
            _avatarMark.color = ShowcasePalette.Text;
            _avatarImage.color = _avatarSprite == null ? ShowcasePalette.Faction(_faction) : Color.white;
        }

        public void SetAvatarSprite(Sprite sprite)
        {
            _avatarSprite = sprite;
            if (_avatarImage == null) return;
            _avatarImage.sprite = sprite;
            _avatarImage.preserveAspect = sprite != null;
            _avatarMark.gameObject.SetActive(sprite == null);
            _avatarImage.color = sprite == null ? ShowcasePalette.Faction(_faction) : Color.white;
        }

        void BuildHeader()
        {
            var title = MythicUi.Text(_panel, "AtriumTitle", "THE ATRIUM", new Vector2(.035f, .89f), new Vector2(.68f, .99f), 25, ShowcasePalette.Gold);
            title.fontStyle = FontStyles.Bold;
            MythicUi.Text(_panel, "AtriumIntro", "A quiet hall between the arena and your next run.", new Vector2(.035f, .84f), new Vector2(.78f, .91f), 14, ShowcasePalette.MutedText);
            _closeButton = MythicUi.Button(_panel, "CloseAtrium", "CLOSE", new Vector2(.83f, .90f), new Vector2(.97f, .985f), () => SetVisible(false), MythicUi.ButtonStyle.Quiet);
        }

        void BuildDirectory()
        {
            _directoryButtons = new Button[StationCount];
            _directoryLabels = new TMP_Text[StationCount];
            for (int i = 0; i < StationCount; i++)
            {
                int index = i;
                int row = i / 4, column = i % 4;
                float left = .035f + column * .235f;
                float top = .725f - row * .145f;
                var button = MythicUi.Button(_panel, "Direct_" + Names[i], Names[i].ToUpperInvariant(),
                    new Vector2(left, top), new Vector2(left + .215f, top + .12f), () => OpenDirect(index), MythicUi.ButtonStyle.Secondary);
                _directoryButtons[i] = button;
                _directoryLabels[i] = button.GetComponentInChildren<TMP_Text>();
            }
            for (int i = 0; i < StationCount; i++)
            {
                var nav = new Navigation { mode = Navigation.Mode.Explicit };
                nav.selectOnLeft = _directoryButtons[i % 4 == 0 ? i + 3 : i - 1];
                nav.selectOnRight = _directoryButtons[i % 4 == 3 ? i - 3 : i + 1];
                nav.selectOnDown = i < 4 ? _directoryButtons[i + 4] : null;
                nav.selectOnUp = i >= 4 ? _directoryButtons[i - 4] : null;
                if (i < 4) nav.selectOnUp = _closeButton;
                if (i >= 4) nav.selectOnDown = _closeButton;
                _directoryButtons[i].navigation = nav;
            }
            var closeNav = new Navigation { mode = Navigation.Mode.Explicit, selectOnDown = _directoryButtons[3] };
            _closeButton.navigation = closeNav;
        }

        void BuildFloor()
        {
            _floor = MythicUi.Panel(_panel, "AtriumFloor", new Vector2(.035f, .115f), new Vector2(.965f, .535f), new Color32(12, 18, 26, 255), false);
            var rail = MythicUi.Panel(_floor, "FloorDivider", new Vector2(.035f, .5f), new Vector2(.965f, .505f), ShowcasePalette.PanelStroke, false);
            _stationButtons = new Button[StationCount];
            _stationLabels = new TMP_Text[StationCount];
            for (int i = 0; i < StationCount; i++)
            {
                int index = i;
                HubPoint point = StationPoints[i];
                var button = MythicUi.Button(_floor, "Station_" + Names[i], "", new Vector2(point.X, point.Y), new Vector2(point.X, point.Y), () => WalkTo(index), MythicUi.ButtonStyle.Secondary);
                var rect = button.GetComponent<RectTransform>();
                rect.sizeDelta = new Vector2(138, 62);
                var label = button.GetComponentInChildren<TMP_Text>();
                label.fontSize = 13;
                label.fontSizeMin = 10;
                label.text = Names[i].ToUpperInvariant();
                _stationButtons[i] = button;
                _stationLabels[i] = label;
            }

            _avatar = MythicUi.Rect(_floor, "CosmeticAvatar", new Vector2(_motion.X, _motion.Y), new Vector2(_motion.X, _motion.Y));
            _avatar.sizeDelta = new Vector2(42, 42);
            _avatarImage = _avatar.gameObject.AddComponent<Image>();
            _avatarImage.color = ShowcasePalette.Faction(_faction);
            _avatarImage.raycastTarget = false;
            _avatarMark = MythicUi.Text(_avatar, "FactionMark", ShowcasePalette.GetFactionMark(_faction), Vector2.zero, Vector2.one, 13, ShowcasePalette.Text, TextAlignmentOptions.Center);
            _avatarMark.fontStyle = FontStyles.Bold;
            SetAvatarSprite(_avatarSprite);
        }

        void BuildFooter()
        {
            _message = MythicUi.Text(_panel, "StationMessage", "Walk with WASD or arrows · Press E near a station · Click a station to walk there.", new Vector2(.035f, .045f), new Vector2(.965f, .105f), 13, ShowcasePalette.MutedText);
            _message.enableWordWrapping = true;
        }

        void OpenDirect(int index)
        {
            _targetStation = -1;
            Activate(index);
        }

        void WalkTo(int index)
        {
            _targetStation = index;
            _message.text = "Walking to " + Names[index] + "…  Press E near a station to activate it.";
            if (_motion.FindNearby(StationPoints, ActivationRadius) == index)
            {
                _targetStation = -1;
                Activate(index);
            }
        }

        void Activate(int index)
        {
            if (index < 0 || index >= StationCount) return;
            if (!_available[index])
            {
                _message.text = _reasons[index];
                return;
            }
            _message.text = "Opening " + Names[index] + "…";
            _onStation?.Invoke(Destinations[index]);
        }

        void RefreshStationLabels()
        {
            if (_stationLabels == null) return;
            for (int i = 0; i < StationCount; i++) RefreshStationLabel(i);
        }

        void RefreshStationLabel(int index)
        {
            if (_stationLabels == null || _stationLabels[index] == null) return;
            string state = _available[index] ? "OPEN" : "COMING SOON";
            _stationLabels[index].text = Names[index].ToUpperInvariant() + "\n" + state;
            _stationLabels[index].color = _available[index] ? ShowcasePalette.Text : ShowcasePalette.MutedText;
            _directoryLabels[index].text = Names[index].ToUpperInvariant() + "\n" + state;
            _directoryLabels[index].color = _available[index] ? ShowcasePalette.Text : ShowcasePalette.MutedText;
            _stationButtons[index].GetComponent<Image>().color = _available[index] ? ShowcasePalette.PanelRaised : ShowcasePalette.Panel;
            _directoryButtons[index].GetComponent<Image>().color = _available[index] ? ShowcasePalette.PanelRaised : ShowcasePalette.Panel;
        }

        void UpdateAvatarPosition()
        {
            Vector2 position = new Vector2(_motion.X, _motion.Y);
            if (_avatar.anchorMin == position && _avatar.anchorMax == position) return;
            _avatar.anchorMin = position;
            _avatar.anchorMax = position;
        }
    }
}

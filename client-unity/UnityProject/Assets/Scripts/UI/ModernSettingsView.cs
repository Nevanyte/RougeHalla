using System;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>Scrollable display and accessibility settings backed by the existing presentation preferences.</summary>
    public sealed class ModernSettingsView : MonoBehaviour
    {
        const float RowHeight = 72f;
        ShowcaseSettings _source;
        TacticalMapController _map;
        UiDisplayPreferences _prefs;
        Action _close;
        RectTransform _root, _content;
        ScrollRect _scroll;
        Button _quality, _motion, _mapMode, _route, _fps, _ping, _scale, _reset, _closeButton;
        TMP_Text _textScaleValue, _musicValue, _ambienceValue, _sfxValue;
        Slider _textScale, _music, _ambience, _sfx;
        GameObject _previousFocus;
        bool _initialized, _refreshing;

        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;

        public void Initialize(Transform root, ShowcaseSettings source, TacticalMapController map,
            UiDisplayPreferences prefs, Action close)
        {
            if (_initialized) throw new InvalidOperationException("ModernSettingsView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (prefs == null) throw new ArgumentNullException(nameof(prefs));
            _initialized = true; _source = source; _map = map; _prefs = prefs; _close = close;

            _root = MythicUi.Panel(root, "ModernSettings", new Vector2(.16f, .055f), new Vector2(.84f, .945f), ShowcasePalette.Panel);
            MythicUi.Text(_root, "SettingsHeading", "SETTINGS", new Vector2(.035f, .925f), new Vector2(.78f, .995f), 27, ShowcasePalette.Gold);
            _closeButton = MythicUi.Button(_root, "CloseSettings", "CLOSE · ESC", new Vector2(.80f, .925f), new Vector2(.965f, .99f), CloseByUser, MythicUi.ButtonStyle.Quiet);
            MythicUi.Text(_root, "SettingsIntro", "Presentation and device-local controls", new Vector2(.04f, .88f), new Vector2(.96f, .925f), 13, ShowcasePalette.MutedText);

            var scrollRect = MythicUi.Rect(_root, "SettingsScroll", new Vector2(.035f, .105f), new Vector2(.965f, .87f));
            _scroll = scrollRect.gameObject.AddComponent<ScrollRect>();
            _scroll.horizontal = false; _scroll.vertical = true; _scroll.movementType = ScrollRect.MovementType.Clamped;
            _scroll.scrollSensitivity = 42; _scroll.inertia = true;
            var viewport = MythicUi.Rect(scrollRect, "Viewport", Vector2.zero, Vector2.one);
            var viewportImage = viewport.gameObject.AddComponent<Image>(); viewportImage.color = new Color(1, 1, 1, .015f); viewportImage.raycastTarget = true;
            viewport.gameObject.AddComponent<RectMask2D>();
            _content = MythicUi.Rect(viewport, "SettingsContent", new Vector2(0, 1), Vector2.one);
            _content.pivot = new Vector2(.5f, 1);
            var vertical = _content.gameObject.AddComponent<VerticalLayoutGroup>();
            vertical.padding = new RectOffset(10, 10, 10, 10); vertical.spacing = 8;
            vertical.childAlignment = TextAnchor.UpperCenter; vertical.childControlWidth = true; vertical.childControlHeight = false;
            vertical.childForceExpandWidth = true; vertical.childForceExpandHeight = false;
            _content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            _scroll.viewport = viewport; _scroll.content = _content;

            _quality = AddButtonRow("Graphics quality", () => _source.CycleQuality());
            _motion = AddButtonRow("Reduced motion", () => _source.ToggleReducedMotion());
            AddSliderRow("Text size", .85f, 1.5f, _source.TextScale, _source.SetTextScale, out _textScale, out _textScaleValue, "0.00×");
            AddSliderRow("Music", 0, 1, _source.MusicVolume, _source.SetMusicVolume, out _music, out _musicValue, "0%");
            AddSliderRow("Ambience", 0, 1, _source.AmbienceVolume, _source.SetAmbienceVolume, out _ambience, out _ambienceValue, "0%");
            AddSliderRow("Sound effects", 0, 1, _source.SfxVolume, _source.SetSfxVolume, out _sfx, out _sfxValue, "0%");
            _mapMode = AddButtonRow("Map key behavior", ToggleMapMode);
            _route = AddButtonRow("Personal route overlay", ToggleRoute);
            _fps = AddButtonRow("Show frame rate", () => _prefs.SetShowFps(!_prefs.ShowFps));
            _ping = AddButtonRow("Show ping", () => _prefs.SetShowPing(!_prefs.ShowPing));
            _scale = AddButtonRow("Minimap size", _prefs.CycleMinimapScale);
            _reset = AddButtonRow("Reset display options", ResetDisplayOptions, MythicUi.ButtonStyle.Quiet);

            _source.Changed += Refresh;
            _prefs.Changed += Refresh;
            Refresh();
            SetVisible(false);
        }

        public void SetVisible(bool visible)
        {
            if (_root == null) return;
            if (_root.gameObject.activeSelf == visible) return;
            if (visible)
            {
                var current = EventSystem.current;
                _previousFocus = current != null ? current.currentSelectedGameObject : null;
                _root.gameObject.SetActive(true);
                if (current != null) current.SetSelectedGameObject(_quality != null ? _quality.gameObject : _closeButton.gameObject);
            }
            else
            {
                _root.gameObject.SetActive(false);
                var current = EventSystem.current;
                if (current != null)
                {
                    GameObject restore = _previousFocus != null && _previousFocus.activeInHierarchy ? _previousFocus : null;
                    current.SetSelectedGameObject(restore);
                }
                _previousFocus = null;
            }
        }

        void OnDestroy()
        {
            if (_source != null) _source.Changed -= Refresh;
            if (_prefs != null) _prefs.Changed -= Refresh;
        }

        Button AddButtonRow(string label, UnityEngine.Events.UnityAction action, MythicUi.ButtonStyle style = MythicUi.ButtonStyle.Secondary)
        {
            var row = MakeRow(label);
            var button = MythicUi.Button(row, "Value", "", new Vector2(.48f, .09f), new Vector2(.97f, .91f), action, style);
            return button;
        }

        void AddSliderRow(string label, float min, float max, float initial, UnityEngine.Events.UnityAction<float> changed,
            out Slider slider, out TMP_Text value, string format)
        {
            var row = MakeRow(label);
            value = MythicUi.Text(row, "Value", "", new Vector2(.43f, .12f), new Vector2(.55f, .88f), 13,
                ShowcasePalette.Gold, TextAlignmentOptions.Center);
            slider = MakeSlider(row, new Vector2(.57f, .28f), new Vector2(.97f, .72f), min, max, initial);
            var localSlider = slider; var localValue = value;
            localSlider.onValueChanged.AddListener(v =>
            {
                if (_refreshing) return;
                changed(v);
                localValue.text = Format(v, format);
            });
            value.text = Format(initial, format);
        }

        RectTransform MakeRow(string label)
        {
            var row = MythicUi.Panel(_content, "SettingRow", Vector2.zero, Vector2.one, ShowcasePalette.PanelRaised, false);
            var layout = row.gameObject.AddComponent<LayoutElement>();
            layout.minHeight = 66; layout.preferredHeight = RowHeight;
            MythicUi.Text(row, "SettingLabel", label, new Vector2(.025f, .06f), new Vector2(.42f, .94f), 16, ShowcasePalette.Text);
            return row;
        }

        Slider MakeSlider(Transform parent, Vector2 min, Vector2 max, float minimum, float maximum, float currentValue)
        {
            var root = MythicUi.Rect(parent, "Slider", min, max);
            var slider = root.gameObject.AddComponent<Slider>();
            slider.minValue = minimum; slider.maxValue = maximum; slider.wholeNumbers = false;
            slider.direction = Slider.Direction.LeftToRight;
            var backgroundRect = MythicUi.Rect(root, "Track", new Vector2(0, .36f), new Vector2(1, .64f));
            var background = backgroundRect.gameObject.AddComponent<Image>(); background.color = ShowcasePalette.PanelStroke; background.raycastTarget = false;
            var fillArea = MythicUi.Rect(root, "Fill Area", new Vector2(0, .36f), new Vector2(1, .64f));
            var fillRect = MythicUi.Rect(fillArea, "Fill", Vector2.zero, Vector2.one);
            var fill = fillRect.gameObject.AddComponent<Image>(); fill.color = ShowcasePalette.Gold; fill.raycastTarget = false;
            var handleArea = MythicUi.Rect(root, "Handle Slide Area", Vector2.zero, Vector2.one);
            var handleRect = MythicUi.Rect(handleArea, "Handle", new Vector2(0, .08f), new Vector2(0, .92f));
            handleRect.sizeDelta = new Vector2(22, 0);
            var handle = handleRect.gameObject.AddComponent<Image>(); handle.color = ShowcasePalette.Text; handle.raycastTarget = true;
            slider.fillRect = fillRect; slider.handleRect = handleRect; slider.targetGraphic = handle;
            slider.SetValueWithoutNotify(currentValue);
            var colors = slider.colors; colors.normalColor = ShowcasePalette.Text; colors.highlightedColor = ShowcasePalette.Gold;
            colors.pressedColor = ShowcasePalette.Gold; slider.colors = colors;
            return slider;
        }

        void ToggleMapMode()
        {
            bool next = !_prefs.MapToggle;
            if (_map != null) _map.SetToggleMode(next);
            _prefs.SetMapToggle(next);
        }
        void ToggleRoute()
        {
            bool next = !_prefs.ShowRoute;
            if (_map != null) _map.SetShowRoute(next);
            _prefs.SetShowRoute(next);
        }
        void ResetDisplayOptions()
        {
            _prefs.ResetDefaults();
            if (_map != null) { _map.SetToggleMode(_prefs.MapToggle); _map.SetShowRoute(_prefs.ShowRoute); }
        }
        void CloseByUser()
        {
            SetVisible(false);
            if (_close != null) _close();
        }

        void Refresh()
        {
            if (!_initialized) return;
            _refreshing = true;
            if (_quality != null) Label(_quality, "GRAPHICS  " + QualityLabel());
            if (_motion != null) Label(_motion, "REDUCED MOTION  " + (_source.ReducedMotion ? "ON" : "OFF"));
            if (_mapMode != null) Label(_mapMode, "MAP KEY  " + (_prefs.MapToggle ? "TOGGLE" : "HOLD"));
            if (_route != null) Label(_route, "PERSONAL ROUTE  " + (_prefs.ShowRoute ? "SHOWN" : "HIDDEN"));
            if (_fps != null) Label(_fps, "FRAME RATE  " + (_prefs.ShowFps ? "ON" : "OFF"));
            if (_ping != null) Label(_ping, "PING  " + (_prefs.ShowPing ? "ON" : "OFF"));
            if (_scale != null) Label(_scale, "MINIMAP SIZE  " + Mathf.RoundToInt(_prefs.MinimapScale * 100f) + "%");
            SetSlider(_textScale, _textScaleValue, _source.TextScale, "0.00×");
            SetSlider(_music, _musicValue, _source.MusicVolume, "0%");
            SetSlider(_ambience, _ambienceValue, _source.AmbienceVolume, "0%");
            SetSlider(_sfx, _sfxValue, _source.SfxVolume, "0%");
            _refreshing = false;
        }

        string QualityLabel()
        {
            string mode = _source.QualityMode == ShowcaseQualityMode.Adaptive ? "ADAPTIVE" : "MANUAL";
            return mode + " · " + _source.EffectiveQuality.ToString().ToUpperInvariant();
        }
        static void Label(Button button, string text)
        {
            var value = button.GetComponentInChildren<TMP_Text>(); if (value != null) value.text = text;
        }
        static void SetSlider(Slider slider, TMP_Text value, float current, string format)
        {
            if (slider == null) return;
            slider.SetValueWithoutNotify(current);
            if (value != null) value.text = Format(current, format);
        }
        static string Format(float value, string format)
        {
            return format == "0%" ? Mathf.RoundToInt(value * 100f) + "%" : value.ToString(format);
        }
    }
}

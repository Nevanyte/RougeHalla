using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// Legacy settings card (LEGACY_LAYOUT.md 11.1): an anchored, non-modal card under the gear at top 48 / right 12, 320 wide
    /// (min(320, uiW - 24)), capped at uiH - 60 with a scrolling body. Sections: Display, Effects, Audio, Readout, Map, footer.
    /// Backed by the existing presentation preferences; nothing here touches match state.
    /// </summary>
    public sealed class ModernSettingsView : MonoBehaviour
    {
        public const float CardTop = 48f, CardRight = 12f, CardPadTop = 12f, CardPadSide = 14f, RowHeight = 34f, HeaderHeight = 36f;
        ShowcaseSettings _source;
        TacticalMapController _map;
        UiDisplayPreferences _prefs;
        Action _close, _leave;
        RectTransform _root, _content;
        ScrollRect _scroll;
        Button _quality, _closeButton, _reset, _leaveButton;
        Switch _fullscreen, _motion, _fps, _ping, _route, _mapMode;
        Slider _textScale, _music, _ambience, _sfx;
        TMP_Text _textScaleValue, _musicValue, _ambienceValue, _sfxValue, _qualityValue;
        readonly List<Button> _minimapSizes = new List<Button>();
        GameObject _previousFocus;
        bool _initialized, _refreshing;
        float _maxHeight = 740f;

        sealed class Switch { public Button Button; public Image Track; public RectTransform Knob; }

        public RectTransform Root => _root;
        public bool IsVisible => _root != null && _root.gameObject.activeSelf;

        public void Initialize(Transform root, ShowcaseSettings source, TacticalMapController map,
            UiDisplayPreferences prefs, Action close, Action leave = null)
        {
            if (_initialized) throw new InvalidOperationException("ModernSettingsView is already initialized.");
            if (root == null) throw new ArgumentNullException(nameof(root));
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (prefs == null) throw new ArgumentNullException(nameof(prefs));
            _initialized = true; _source = source; _map = map; _prefs = prefs; _close = close; _leave = leave;
            var theme = UiTheme.Current;

            _root = HudUi.Box(root, "ModernSettings", HudAnchor.TopRight, CardRight, CardTop, 320f, 400f);
            HudUi.Surface(_root, theme.Surface, theme.CornerRadiusLarge, theme.Border, true, true);
            HudUi.Label(HudUi.At(_root, "HeadingRow", CardPadSide, CardPadTop, 220, 20), "SettingsHeading", "SETTINGS", theme.SizeBody, theme.TextPrimary, bold: true).characterSpacing = 2f;
            _closeButton = HudUi.Button(_root, "CloseSettings", "x", HudAnchor.TopRight, 10f, 10f, 20f, 20f, CloseByUser, theme.SizeBody, theme.CornerRadiusSmall);

            var scrollRect = HudUi.Inset(_root, "SettingsScroll", 0, HeaderHeight, 0, 10);
            _scroll = scrollRect.gameObject.AddComponent<ScrollRect>();
            _scroll.horizontal = false; _scroll.vertical = true; _scroll.movementType = ScrollRect.MovementType.Clamped;
            _scroll.scrollSensitivity = 30; _scroll.inertia = true;
            var viewport = MythicUi.Rect(scrollRect, "Viewport", Vector2.zero, Vector2.one);
            var viewportImage = viewport.gameObject.AddComponent<Image>(); viewportImage.color = Color.clear; viewportImage.raycastTarget = true;
            viewport.gameObject.AddComponent<RectMask2D>();
            _content = MythicUi.Rect(viewport, "SettingsContent", new Vector2(0, 1), Vector2.one);
            _content.pivot = new Vector2(.5f, 1);
            var vertical = _content.gameObject.AddComponent<VerticalLayoutGroup>();
            vertical.padding = new RectOffset((int)CardPadSide, (int)CardPadSide, 0, 4); vertical.spacing = 0;
            vertical.childAlignment = TextAnchor.UpperLeft; vertical.childControlWidth = true; vertical.childControlHeight = true;
            vertical.childForceExpandWidth = true; vertical.childForceExpandHeight = false;
            _content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            _scroll.viewport = viewport; _scroll.content = _content;

            Heading("Display");
            _fullscreen = SwitchRow("Fullscreen", () => Screen.fullScreen = !Screen.fullScreen, "Alt+Enter does the same.");
            _qualityValue = ValueButtonRow("Graphics quality", () => _source.CycleQuality(), out _quality);
            Heading("Effects");
            _motion = SwitchRow("Reduced motion", () => _source.ToggleReducedMotion());
            SliderRow("Text size", .85f, 1.5f, _source.TextScale, _source.SetTextScale, out _textScale, out _textScaleValue, "0.00×");
            Heading("Audio");
            SliderRow("Music", 0, 1, _source.MusicVolume, _source.SetMusicVolume, out _music, out _musicValue, "0%");
            SliderRow("Ambience", 0, 1, _source.AmbienceVolume, _source.SetAmbienceVolume, out _ambience, out _ambienceValue, "0%");
            SliderRow("Sound effects", 0, 1, _source.SfxVolume, _source.SetSfxVolume, out _sfx, out _sfxValue, "0%");
            Heading("Readout");
            _fps = SwitchRow("Show FPS", () => _prefs.SetShowFps(!_prefs.ShowFps));
            _ping = SwitchRow("Show ping", () => _prefs.SetShowPing(!_prefs.ShowPing));
            Heading("Map");
            _route = SwitchRow("Show route", ToggleRoute);
            _mapMode = SwitchRow("Tab toggles map", ToggleMapMode, "Off: hold Tab to look.");
            SegmentedRow("Minimap size");
            FooterRow();

            _source.Changed += Refresh;
            _prefs.Changed += Refresh;
            Refresh();
            SetVisible(false);
        }

        /// <summary>Legacy size: width min(320, uiW - 24); height fits the content up to uiH - 60.</summary>
        public void ApplyViewport(HudViewport viewport)
        {
            if (_root == null) return;
            _maxHeight = Mathf.Max(160f, viewport.UiHeight - 60f);
            Fit(HudLayout.SettingsWidth(viewport.UiWidth));
        }

        void Fit(float width)
        {
            Canvas.ForceUpdateCanvases();
            LayoutRebuilder.ForceRebuildLayoutImmediate(_content);
            float height = HeaderHeight + LayoutUtility.GetPreferredHeight(_content) + 10f;
            _root.sizeDelta = new Vector2(width, Mathf.Min(height, _maxHeight));
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
                Fit(_root.sizeDelta.x);
                if (current != null) current.SetSelectedGameObject(_fullscreen != null ? _fullscreen.Button.gameObject : _closeButton.gameObject);
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

        // ---- rows

        void Heading(string text)
        {
            var theme = UiTheme.Current;
            var row = Row("Heading", 24f);
            var label = HudUi.Label(row, "SectionLabel", text.ToUpperInvariant(), theme.SizeSmall, theme.TextSecondary, TextAlignmentOptions.BottomLeft, true);
            label.characterSpacing = 2f;
            label.rectTransform.offsetMin = new Vector2(0, 3);
        }

        RectTransform Row(string name, float height)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform), typeof(LayoutElement)).transform;
            rect.SetParent(_content, false);
            var layout = rect.GetComponent<LayoutElement>(); layout.minHeight = height; layout.preferredHeight = height;
            return rect;
        }

        RectTransform ControlRow(string label, float height, string note = null)
        {
            var theme = UiTheme.Current;
            var row = Row("SettingRow", height);
            HudUi.Fill(row, "Rule", Tone(theme.Border, .25f)).rectTransform.sizeDelta = Vector2.zero;
            var rule = row.Find("Rule").GetComponent<RectTransform>();
            rule.anchorMin = new Vector2(0, 0); rule.anchorMax = new Vector2(1, 0); rule.sizeDelta = new Vector2(0, 1); rule.anchoredPosition = Vector2.zero;
            var text = HudUi.Label(row, "SettingLabel", label, theme.SizeBody, theme.TextPrimary, note == null ? TextAlignmentOptions.MidlineLeft : TextAlignmentOptions.TopLeft);
            text.rectTransform.offsetMax = new Vector2(-150f, note == null ? 0 : -4);
            if (note != null)
            {
                var sub = HudUi.Label(row, "SettingNote", note, theme.SizeSmall, theme.TextSecondary, TextAlignmentOptions.BottomLeft);
                sub.rectTransform.offsetMax = new Vector2(-150f, 0); sub.rectTransform.offsetMin = new Vector2(0, 3);
            }
            return row;
        }

        static Color Tone(Color32 c, float a) { return UiTheme.With(c, a); }

        Switch SwitchRow(string label, UnityEngine.Events.UnityAction action, string note = null)
        {
            var theme = UiTheme.Current;
            var row = ControlRow(label, note == null ? RowHeight : 44f, note);
            var rect = HudUi.Box(row, "Value", HudAnchor.MiddleRight, 0, 0, 36f, 20f);
            var track = HudUi.Surface(rect, theme.SurfaceDisabled, 10f, theme.Border, true);
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = track; button.transition = Selectable.Transition.None;
            button.onClick.AddListener(action);
            var knob = HudUi.Box(rect, "Knob", HudAnchor.MiddleLeft, 3f, 0, 14f, 14f);
            HudUi.Surface(knob, theme.SurfaceRaised, 7f, theme.Border, false);
            return new Switch { Button = button, Track = track, Knob = knob };
        }

        static void SetSwitch(Switch toggle, bool on)
        {
            if (toggle == null) return;
            var theme = UiTheme.Current;
            toggle.Track.color = on ? theme.Success : theme.SurfaceDisabled;
            toggle.Knob.anchoredPosition = new Vector2(on ? 19f : 3f, 0);
        }

        TMP_Text ValueButtonRow(string label, UnityEngine.Events.UnityAction action, out Button button)
        {
            var theme = UiTheme.Current;
            var row = ControlRow(label, RowHeight);
            button = HudUi.Button(row, "Value", "", HudAnchor.MiddleRight, 0, 0, 140f, 24f, action, theme.SizeSmall, theme.CornerRadiusSmall);
            return button.GetComponentInChildren<TMP_Text>();
        }

        void SliderRow(string label, float min, float max, float initial, UnityEngine.Events.UnityAction<float> changed,
            out Slider slider, out TMP_Text value, string format)
        {
            var theme = UiTheme.Current;
            var row = ControlRow(label, RowHeight);
            value = HudUi.Label(HudUi.Box(row, "ValueBox", HudAnchor.MiddleRight, 0, 0, 40f, 20f), "Value", "", theme.SizeSmall, theme.Accent, TextAlignmentOptions.MidlineRight, true);
            value.transform.parent.name = "ValueBox";
            slider = MakeSlider(row, min, max, initial);
            var localSlider = slider; var localValue = value;
            localSlider.onValueChanged.AddListener(v =>
            {
                if (_refreshing) return;
                changed(v);
                localValue.text = Format(v, format);
            });
            value.text = Format(initial, format);
        }

        Slider MakeSlider(Transform parent, float minimum, float maximum, float currentValue)
        {
            var theme = UiTheme.Current;
            var root = HudUi.Box(parent, "Slider", HudAnchor.MiddleRight, 46f, 0, 94f, 20f);
            var slider = root.gameObject.AddComponent<Slider>();
            slider.minValue = minimum; slider.maxValue = maximum; slider.wholeNumbers = false;
            slider.direction = Slider.Direction.LeftToRight;
            var backgroundRect = MythicUi.Rect(root, "Track", new Vector2(0, .5f), new Vector2(1, .5f), new Vector2(0, -2), new Vector2(0, 2));
            var background = backgroundRect.gameObject.AddComponent<Image>(); background.color = theme.SurfaceDisabled; background.raycastTarget = false;
            var fillArea = MythicUi.Rect(root, "Fill Area", new Vector2(0, .5f), new Vector2(1, .5f), new Vector2(0, -2), new Vector2(0, 2));
            var fillRect = MythicUi.Rect(fillArea, "Fill", Vector2.zero, Vector2.one);
            var fill = fillRect.gameObject.AddComponent<Image>(); fill.color = theme.Accent; fill.raycastTarget = false;
            var handleArea = MythicUi.Rect(root, "Handle Slide Area", Vector2.zero, Vector2.one);
            var handleRect = MythicUi.Rect(handleArea, "Handle", new Vector2(0, .1f), new Vector2(0, .9f));
            handleRect.sizeDelta = new Vector2(12, 0);
            var handle = handleRect.gameObject.AddComponent<Image>(); handle.color = theme.TextPrimary; handle.raycastTarget = true;
            slider.fillRect = fillRect; slider.handleRect = handleRect; slider.targetGraphic = handle;
            slider.SetValueWithoutNotify(currentValue);
            var colors = slider.colors; colors.normalColor = theme.TextPrimary; colors.highlightedColor = theme.Accent;
            colors.pressedColor = theme.Accent; slider.colors = colors;
            return slider;
        }

        void SegmentedRow(string label)
        {
            var theme = UiTheme.Current;
            var row = ControlRow(label, RowHeight);
            float step = 28f, width = step * UiDisplayPreferences.MinimapScales.Length;
            var group = HudUi.Box(row, "Segments", HudAnchor.MiddleRight, 0, 0, width, 22f);
            for (int i = 0; i < UiDisplayPreferences.MinimapScales.Length; i++)
            {
                float scale = UiDisplayPreferences.MinimapScales[i];
                var button = HudUi.Button(group, "Size" + Mathf.RoundToInt(scale * 100), Mathf.RoundToInt(scale * 100).ToString(), HudAnchor.TopLeft, i * step, 0, step, 22f,
                    () => _prefs.SetMinimapScale(scale), 9f, theme.CornerRadiusSmall);
                _minimapSizes.Add(button);
            }
        }

        void FooterRow()
        {
            var theme = UiTheme.Current;
            var row = Row("Footer", _leave != null ? 62f : 36f);
            HudUi.Label(HudUi.At(row, "Saved", 0, 8, 150, 14), "Label", "Saved in this browser.", theme.SizeSmall, theme.TextSecondary);
            _reset = HudUi.Button(row, "Reset", "Reset to defaults", HudAnchor.TopRight, 0, 4, 120f, 22f, ResetDisplayOptions, theme.SizeSmall, theme.CornerRadiusSmall);
            if (_leave != null)
                _leaveButton = HudUi.Button(row, "Leave", "Leave match", HudAnchor.TopLeft, 0, 34, 120f, 22f, () => { SetVisible(false); _leave(); }, theme.SizeSmall, theme.CornerRadiusSmall);
        }

        // ---- behaviour

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
            SetSwitch(_fullscreen, Screen.fullScreen);
            SetSwitch(_motion, _source.ReducedMotion);
            SetSwitch(_fps, _prefs.ShowFps);
            SetSwitch(_ping, _prefs.ShowPing);
            SetSwitch(_route, _prefs.ShowRoute);
            SetSwitch(_mapMode, _prefs.MapToggle);
            if (_qualityValue != null) _qualityValue.text = QualityLabel();
            for (int i = 0; i < _minimapSizes.Count; i++)
            {
                bool selected = Mathf.Approximately(UiDisplayPreferences.MinimapScales[i], _prefs.MinimapScale);
                var theme = UiTheme.Current;
                HudUi.ApplyColors(_minimapSizes[i], selected ? theme.Success : theme.SurfaceRaised);
                var text = _minimapSizes[i].GetComponentInChildren<TMP_Text>(); if (text != null) text.color = selected ? theme.SurfaceRaised : theme.TextPrimary;
            }
            SetSlider(_textScale, _textScaleValue, _source.TextScale, "0.00×");
            SetSlider(_music, _musicValue, _source.MusicVolume, "0%");
            SetSlider(_ambience, _ambienceValue, _source.AmbienceVolume, "0%");
            SetSlider(_sfx, _sfxValue, _source.SfxVolume, "0%");
            _refreshing = false;
        }

        string QualityLabel()
        {
            string mode = _source.QualityMode == ShowcaseQualityMode.Adaptive ? "Adaptive" : "Manual";
            return mode + " · " + _source.EffectiveQuality;
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

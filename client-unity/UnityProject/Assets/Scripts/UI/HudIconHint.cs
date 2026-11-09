using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;

namespace Roguehalla.Client
{
    /// <summary>Non-interactive hint shown while a HUD control is hovered, focused, or pressed.</summary>
    public sealed class HudIconHint : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler,
        IPointerDownHandler, ISelectHandler, IDeselectHandler
    {
        static readonly List<HudIconHint> ActiveHints = new List<HudIconHint>(8);
        static HudIconHint _stickyHint;
        static HudIconHint _shownHint;
        readonly Vector3[] _worldCorners = new Vector3[4];

        UnityEngine.UI.Selectable _target;
        RectTransform _overlayRect, _panel;
        TMP_Text _label;
        MythicTextScale _textScale;
        ShowcaseSettings _settings;
        string _text = "";
        int _stickyFrame;
        bool _configured, _registered, _pointerInside, _selected, _sticky, _visible;

        /// <summary>Hint content. Updating it while visible refreshes size and placement immediately.</summary>
        public string Text
        {
            get => _text;
            set
            {
                string next = value ?? "";
                if (_text == next) return;
                _text = next;
                if (_label != null) _label.text = _text;
                if (string.IsNullOrWhiteSpace(_text)) Hide();
                else if (_visible) RefreshLayout();
            }
        }

        public bool IsVisible => _visible;

        /// <summary>Attach one reusable hint to a selectable; the overlay root must belong to a Canvas.</summary>
        public static HudIconHint Attach(UnityEngine.UI.Selectable target, Transform overlayRoot, string text)
        {
            if (target == null) throw new System.ArgumentNullException(nameof(target));
            if (overlayRoot == null) throw new System.ArgumentNullException(nameof(overlayRoot));
            if (overlayRoot.GetComponentInParent<Canvas>() == null)
                throw new System.ArgumentException("The hint overlay must be below a Canvas.", nameof(overlayRoot));

            var hint = target.GetComponent<HudIconHint>();
            if (hint == null) hint = target.gameObject.AddComponent<HudIconHint>();
            hint.Configure(target, overlayRoot, text);
            return hint;
        }

        /// <summary>Close all HUD hints on modal transitions or explicit focus changes.</summary>
        public static void CloseAll()
        {
            for (int i = ActiveHints.Count - 1; i >= 0; i--)
            {
                var hint = ActiveHints[i];
                if (hint != null) hint.CloseAndClearInputState();
            }
            _stickyHint = null;
            _shownHint = null;
        }

        void Configure(UnityEngine.UI.Selectable target, Transform overlayRoot, string text)
        {
            _target = target;
            _overlayRect = overlayRoot as RectTransform;
            if (_overlayRect == null) throw new System.ArgumentException("The hint overlay root must have a RectTransform.", nameof(overlayRoot));
            _text = text ?? "";
            _configured = true;
            EnsurePanel();
            if (isActiveAndEnabled) Activate();
            if (string.IsNullOrWhiteSpace(_text)) Hide();
        }

        void OnEnable() { Activate(); }

        void Activate()
        {
            if (!_configured || _registered) return;
            EnsurePanel();
            _registered = true;
            ActiveHints.Add(this);
            _settings = ShowcaseSettings.Current;
            if (_settings != null) _settings.Changed += OnSettingsChanged;
            Hide();
        }

        void OnDisable()
        {
            Hide();
            _pointerInside = _selected = _sticky = false;
            if (_stickyHint == this) _stickyHint = null;
            if (_shownHint == this) _shownHint = null;
            if (_settings != null) _settings.Changed -= OnSettingsChanged;
            _settings = null;
            if (_registered) ActiveHints.Remove(this);
            _registered = false;
        }

        void OnDestroy()
        {
            if (_panel == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(_panel.gameObject);
            else UnityEngine.Object.DestroyImmediate(_panel.gameObject);
        }

        void Update()
        {
            if (!_sticky || Time.frameCount <= _stickyFrame) return;
            var pointer = Pointer.current;
            if (pointer != null && pointer.press.wasPressedThisFrame) CloseAll();
        }

        public void OnPointerEnter(PointerEventData eventData)
        {
            _pointerInside = true;
            if (!_sticky) Show();
        }

        public void OnPointerExit(PointerEventData eventData)
        {
            _pointerInside = false;
            RefreshVisibility();
        }

        public void OnPointerDown(PointerEventData eventData)
        {
            _pointerInside = true;
            if (eventData is ExtendedPointerEventData extended && extended.pointerType == UIPointerType.Touch)
            {
                if (_stickyHint != null && _stickyHint != this)
                {
                    _stickyHint._sticky = false;
                    _stickyHint.RefreshVisibility();
                }
                _stickyHint = this;
                _sticky = true;
                _stickyFrame = Time.frameCount;
            }
            Show();
        }

        public void OnSelect(BaseEventData eventData)
        {
            _selected = true;
            Show();
        }

        public void OnDeselect(BaseEventData eventData)
        {
            _selected = false;
            RefreshVisibility();
        }

        void OnSettingsChanged()
        {
            if (_textScale != null && _settings != null) _textScale.Apply(_settings.TextScale);
            if (_visible) RefreshLayout();
        }

        void EnsurePanel()
        {
            if (_panel != null || _overlayRect == null) return;
            _panel = MythicUi.Rect(_overlayRect, "HudIconHint", new Vector2(.5f, .5f), new Vector2(.5f, .5f));
            _panel.pivot = new Vector2(.5f, .5f);
            var background = _panel.gameObject.AddComponent<UnityEngine.UI.Image>();
            background.color = MythicUi.Backdrop(ShowcasePalette.PanelRaised);
            background.raycastTarget = false;
            MythicUi.Border(_panel, ShowcasePalette.GoldDim, 1);
            _label = MythicUi.Text(_panel, "HintText", _text, Vector2.zero, Vector2.one, 12,
                ShowcasePalette.Text, TextAlignmentOptions.MidlineLeft);
            _label.enableAutoSizing = false;
            _label.textWrappingMode = TextWrappingModes.Normal;
            _label.overflowMode = TextOverflowModes.Truncate;
            _label.raycastTarget = false;
            _textScale = _label.GetComponent<MythicTextScale>();
            _panel.gameObject.SetActive(false);
        }

        void Show()
        {
            if (!_configured || string.IsNullOrWhiteSpace(_text) || !isActiveAndEnabled || _panel == null) return;
            if (_shownHint != null && _shownHint != this) _shownHint.Hide();
            _shownHint = this;
            _visible = true;
            _panel.gameObject.SetActive(true);
            _panel.SetAsLastSibling();
            RefreshLayout();
        }

        void Hide()
        {
            _visible = false;
            if (_shownHint == this) _shownHint = null;
            if (_panel != null) _panel.gameObject.SetActive(false);
        }

        void RefreshVisibility()
        {
            if (_selected || _pointerInside || _sticky) Show();
            else
            {
                Hide();
                var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
                var selectedHint = selected != null ? selected.GetComponent<HudIconHint>() : null;
                if (selectedHint != null && selectedHint != this && selectedHint._selected && selectedHint.isActiveAndEnabled)
                    selectedHint.Show();
            }
        }

        void CloseAndClearInputState()
        {
            _sticky = false;
            _pointerInside = false;
            _selected = false;
            Hide();
        }

        void RefreshLayout()
        {
            if (!_visible || _overlayRect == null || _target == null || _label == null) return;
            var canvas = _overlayRect.GetComponentInParent<Canvas>();
            if (canvas == null) { Hide(); return; }
            var canvasCamera = canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
            Rect bounds = _overlayRect.rect;
            float maxWidth = Mathf.Min(420f, Mathf.Max(1f, bounds.width - 16f));
            float contentWidth = Mathf.Max(1f, maxWidth - 18f);
            Vector2 preferred = _label.GetPreferredValues(_text, contentWidth, 0f);
            float width = Mathf.Min(maxWidth, Mathf.Max(Mathf.Min(150f, maxWidth), preferred.x + 22f));
            float maxHeight = Mathf.Max(1f, bounds.height - 16f);
            float height = Mathf.Min(maxHeight, Mathf.Max(Mathf.Min(38f, maxHeight), preferred.y + 12f));
            _panel.sizeDelta = new Vector2(width, height);

            var targetRect = _target.transform as RectTransform;
            if (targetRect == null) { Hide(); return; }
            targetRect.GetWorldCorners(_worldCorners);
            Vector2 top = (ToOverlay(_worldCorners[1], canvasCamera) + ToOverlay(_worldCorners[2], canvasCamera)) * .5f;
            Vector2 bottom = (ToOverlay(_worldCorners[0], canvasCamera) + ToOverlay(_worldCorners[3], canvasCamera)) * .5f;
            const float gap = 8f, inset = 8f;
            float x = (top.x + bottom.x) * .5f;
            float y = top.y + gap + height * .5f;
            if (y + height * .5f > bounds.yMax - inset) y = bottom.y - gap - height * .5f;
            x = ClampCenter(x, width * .5f, bounds.xMin + inset, bounds.xMax - inset);
            y = ClampCenter(y, height * .5f, bounds.yMin + inset, bounds.yMax - inset);
            _panel.anchoredPosition = new Vector2(x, y);
        }

        Vector2 ToOverlay(Vector3 world, Camera canvasCamera)
        {
            Vector2 screen = RectTransformUtility.WorldToScreenPoint(canvasCamera, world);
            RectTransformUtility.ScreenPointToLocalPointInRectangle(_overlayRect, screen, canvasCamera, out var local);
            return local;
        }

        static float ClampCenter(float value, float halfExtent, float minimum, float maximum)
        {
            float low = minimum + halfExtent;
            float high = maximum - halfExtent;
            return low > high ? (minimum + maximum) * .5f : Mathf.Clamp(value, low, high);
        }
    }
}

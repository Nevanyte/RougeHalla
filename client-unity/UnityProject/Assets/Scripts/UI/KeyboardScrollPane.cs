using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;

namespace Roguehalla.Client
{
    /// <summary>Focusable reading pane with visible focus and keyboard scrolling; it never consumes gameplay actions.</summary>
    public sealed class KeyboardScrollPane : MonoBehaviour, ISelectHandler, IDeselectHandler, IPointerDownHandler
    {
        UnityEngine.UI.ScrollRect _scroll;
        UnityEngine.UI.Selectable _focus;
        GameObject _border;
        bool _selected;
        double _nextArrowAt;
        public void Initialize(UnityEngine.UI.ScrollRect scroll)
        {
            _scroll = scroll;
            _focus = gameObject.AddComponent<UnityEngine.UI.Selectable>();
            _focus.transition = UnityEngine.UI.Selectable.Transition.None;
            _focus.navigation = new UnityEngine.UI.Navigation { mode = UnityEngine.UI.Navigation.Mode.Explicit };
            var r = (RectTransform)new GameObject("ReadingPaneFocus", typeof(RectTransform)).transform;
            r.SetParent(transform, false); r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero;
            Edge(r, "Top", new Vector2(0, 1), Vector2.one, new Vector2(0, 2), new Vector2(0, -1));
            Edge(r, "Bottom", Vector2.zero, new Vector2(1, 0), new Vector2(0, 2), new Vector2(0, 1));
            Edge(r, "Left", Vector2.zero, new Vector2(0, 1), new Vector2(2, 0), new Vector2(1, 0));
            Edge(r, "Right", new Vector2(1, 0), Vector2.one, new Vector2(2, 0), new Vector2(-1, 0));
            _border = r.gameObject; _border.SetActive(false);
        }
        static void Edge(Transform parent, string name, Vector2 min, Vector2 max, Vector2 size, Vector2 offset)
        {
            var rect = MythicUi.Rect(parent, name, min, max); rect.sizeDelta = size; rect.anchoredPosition = offset;
            var image = rect.gameObject.AddComponent<UnityEngine.UI.Image>(); image.color = ShowcasePalette.Gold; image.raycastTarget = false;
        }
        public void OnPointerDown(PointerEventData data) { _focus.Select(); }
        public void OnSelect(BaseEventData data) { _selected = true; if (_border != null) _border.SetActive(true); }
        public void OnDeselect(BaseEventData data) { _selected = false; if (_border != null) _border.SetActive(false); }
        public void Page(bool upwards)
        {
            if (_scroll == null || _scroll.viewport == null) return;
            ScrollPixels(_scroll.viewport.rect.height * .9f * (upwards ? 1 : -1));
        }
        void ScrollPixels(float pixels)
        {
            if (_scroll == null || _scroll.content == null || _scroll.viewport == null) return;
            float distance = Mathf.Max(1, _scroll.content.rect.height - _scroll.viewport.rect.height);
            _scroll.StopMovement(); _scroll.verticalNormalizedPosition = Mathf.Clamp01(_scroll.verticalNormalizedPosition + pixels / distance);
        }
        void Update()
        {
            if (!_selected || Keyboard.current == null || _scroll == null) return;
            var keys = Keyboard.current;
            bool up = keys.upArrowKey.isPressed, down = keys.downArrowKey.isPressed;
            bool pressed = keys.upArrowKey.wasPressedThisFrame || keys.downArrowKey.wasPressedThisFrame;
            double now = Time.realtimeSinceStartupAsDouble;
            if (up != down && (pressed || now >= _nextArrowAt))
            {
                ScrollPixels(up ? 44 : -44); _nextArrowAt = now + (pressed ? .30 : .06);
            }
            if (keys.pageUpKey.wasPressedThisFrame) Page(true);
            if (keys.pageDownKey.wasPressedThisFrame) Page(false);
            if (keys.homeKey.wasPressedThisFrame) _scroll.verticalNormalizedPosition = 1;
            if (keys.endKey.wasPressedThisFrame) _scroll.verticalNormalizedPosition = 0;
        }
        void OnDisable()
        {
            _selected = false;
            if (_border != null) _border.SetActive(false);
            if (EventSystem.current != null && EventSystem.current.currentSelectedGameObject == gameObject)
                EventSystem.current.SetSelectedGameObject(null);
        }
    }
}

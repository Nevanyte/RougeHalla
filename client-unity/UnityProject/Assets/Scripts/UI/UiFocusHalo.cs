using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// A visible keyboard-focus ring: a two-unit cream frame drawn just outside a control while it is the selected object. It is a
    /// separate graphic (not a colour-block state) so it reads on every fill, and its colour is a theme token.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class UiFocusHalo : MonoBehaviour, ISelectHandler, IDeselectHandler
    {
        public const string ChildName = "FocusHalo";
        Image _halo;

        public bool Showing { get { return _halo != null && _halo.enabled; } }

        /// <summary>Adds a halo around the control's rect, <paramref name="radius"/> being the control's own corner radius.</summary>
        public static UiFocusHalo Attach(Component control, float radius)
        {
            var existing = control.GetComponent<UiFocusHalo>();
            if (existing != null) return existing;
            var theme = UiTheme.Current;
            var rect = HudUi.Inset(control.transform, ChildName, -3f, -3f, -3f, -3f);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = UiSprites.Frame(theme, radius + 3f); image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = .5f;
            image.color = theme.OutlineLight; image.raycastTarget = false; image.enabled = false;
            var halo = control.gameObject.AddComponent<UiFocusHalo>();
            halo._halo = image;
            return halo;
        }

        public void OnSelect(BaseEventData eventData) { if (_halo != null) _halo.enabled = true; }
        public void OnDeselect(BaseEventData eventData) { if (_halo != null) _halo.enabled = false; }
        void OnDisable() { if (_halo != null) _halo.enabled = false; }
    }
}

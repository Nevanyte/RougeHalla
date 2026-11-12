using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Follows the text-size setting. A plain instance auto-sizes between 0.85 and 1 of BaseSize x scale. With <see cref="FitBox"/> (every
    /// <c>HudUi.Label</c>) the size is BaseSize x scale capped at the largest size at which the label's current text needs at most
    /// <see cref="WidthShare"/> of the box width and at most the box height (wrapped text measured wrapped), never below <see cref="MinSize"/>;
    /// overflow is never cut. The fit is recomputed when the scale changes and when the label's text changes (compared in LateUpdate: a
    /// reference check, and a measurement only on a real change).
    /// </summary>
    public sealed class MythicTextScale : MonoBehaviour
    {
        public const float WidthShare = .88f;
        public float BaseSize;
        /// <summary>Fit the size to the label's box for its current text.</summary>
        public bool FitBox;
        /// <summary>The smallest size the fit may choose.</summary>
        public float MinSize = 6f;
        float _scale = 1f;
        TMP_Text _text;
        string _fitted;

        public void Apply(float scale)
        {
            _scale = scale;
            if (_text == null) _text = GetComponent<TMP_Text>();
            var text = _text; if (text == null) return;
            float wanted = BaseSize * Mathf.Clamp(scale, .85f, 1.5f);
            if (!FitBox)
            {
                text.fontSize = text.fontSizeMax = wanted;
                text.fontSizeMin = text.fontSize * .85f;
                return;
            }
            float size = Fit(text, wanted, MinSize);
            text.enableAutoSizing = false;
            text.fontSize = text.fontSizeMax = text.fontSizeMin = size;
            text.overflowMode = TextOverflowModes.Overflow;
            _fitted = text.text;
        }

        /// <summary>Recompute the fit for the label's current text at the last applied scale.</summary>
        public void Refit() { Apply(_scale); }

        void OnEnable() { if (FitBox && _text != null && !string.Equals(_fitted, _text.text)) Refit(); }

        void LateUpdate()
        {
            if (!FitBox) return;
            if (_text == null) _text = GetComponent<TMP_Text>();
            if (_text == null) return;
            if (!string.Equals(_text.text, _fitted)) Refit();
        }

        static bool Fits(TMP_Text label, string text, float size, Rect box)
        {
            bool wraps = label.textWrappingMode != TextWrappingModes.NoWrap;
            float keep = label.fontSize; bool auto = label.enableAutoSizing;
            label.enableAutoSizing = false; label.fontSize = size;
            var need = label.GetPreferredValues(text, wraps ? box.width * WidthShare : 0f, 0f);
            label.fontSize = keep; label.enableAutoSizing = auto;
            return need.x <= box.width * WidthShare + .001f && need.y <= box.height + .01f;
        }

        /// <summary>The wanted size when the box holds the text at it, else the largest size (down to the floor) that does.</summary>
        static float Fit(TMP_Text label, float wanted, float floor)
        {
            string text = label.text ?? "";
            var box = label.rectTransform.rect;
            if (wanted <= floor || Fits(label, text, wanted, box)) return Mathf.Max(wanted, floor);
            if (!Fits(label, text, floor, box)) return floor;
            float lo = floor, hi = wanted;
            while (hi - lo > .05f)
            {
                float mid = (lo + hi) * .5f;
                if (Fits(label, text, mid, box)) lo = mid; else hi = mid;
            }
            return lo;
        }
    }
}

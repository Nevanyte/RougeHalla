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
        Vector2 _fittedBox;

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
            _fittedBox = text.rectTransform.rect.size;
        }

        /// <summary>Recompute the fit for the label's current text at the last applied scale.</summary>
        public void Refit() { Apply(_scale); }

        void OnEnable() { if (FitBox && _text != null && !string.Equals(_fitted, _text.text)) Refit(); }

        void LateUpdate()
        {
            if (!FitBox) return;
            if (_text == null) _text = GetComponent<TMP_Text>();
            if (_text == null) return;
            string now = _text.text;
            if (string.Equals(now, _fitted)) return;
            // A text that changes every frame (a countdown) keeps its length and box: keep the fitted size, no scan and bisect.
            if (_fitted != null && now != null && now.Length == _fitted.Length && _text.rectTransform.rect.size == _fittedBox) { _fitted = now; return; }
            Refit();
        }

        static bool Fits(TMP_Text label, string text, float size, Rect box)
        {
            bool wraps = label.textWrappingMode != TextWrappingModes.NoWrap;
            float keep = label.fontSize; bool auto = label.enableAutoSizing;
            label.enableAutoSizing = false; label.fontSize = size;
            var need = label.GetPreferredValues(text, wraps ? box.width : 0f, 0f);
            label.fontSize = keep; label.enableAutoSizing = auto;
            return need.x <= box.width * WidthShare - .005f && need.y <= box.height + .01f;
        }

        /// <summary>
        /// The wanted size when the box holds the text at it, else the largest size (down to the floor) that does.
        /// </summary>
        static float Fit(TMP_Text label, float wanted, float floor)
        {
            string text = label.text ?? "";
            var box = label.rectTransform.rect;
            if (wanted <= floor || Fits(label, text, wanted, box)) return Mathf.Max(wanted, floor);
            // Scan down from the wanted size in quarter steps (a wrapping label can fit at a larger size and not at a smaller one, so the
            // first fit from above is what keeps the size from falling as the scale rises), then bisect inside the step.
            float hi = wanted, lo = wanted - .25f;
            while (lo > floor && !Fits(label, text, lo, box)) { hi = lo; lo -= .25f; }
            if (lo <= floor) { lo = floor; if (!Fits(label, text, lo, box)) return floor; }
            while (hi - lo > .004f)
            {
                float mid = (lo + hi) * .5f;
                if (Fits(label, text, mid, box)) lo = mid; else hi = mid;
            }
            return lo;
        }
    }
}

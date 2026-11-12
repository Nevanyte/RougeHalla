using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed class MythicTextScale : MonoBehaviour
    {
        public float BaseSize;
        float _scale = 1f;

        public void Apply(float scale)
        {
            _scale = scale;
            var text = GetComponent<TMP_Text>(); if (text == null) return;
            text.fontSize = text.fontSizeMax = BaseSize * Mathf.Clamp(scale, .85f, 1.5f);
            text.fontSizeMin = text.fontSize * .85f;
        }

        /// <summary>
        /// P-UNITY-HUD-TEXTSCALE-1 STUB: re-apply the last scale to the label's current text. The implementer makes this cap the size at
        /// what the label's box holds for that text (see the packet brief, "Mechanism contract"); today it keeps the old behaviour.
        /// </summary>
        public void Refit() { Apply(_scale); }
    }
}

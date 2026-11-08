using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed class MythicTextScale : MonoBehaviour
    {
        public float BaseSize;
        public void Apply(float scale)
        {
            var text = GetComponent<TMP_Text>(); if (text == null) return;
            text.fontSize = text.fontSizeMax = BaseSize * Mathf.Clamp(scale, .85f, 1.5f);
            text.fontSizeMin = text.fontSize * .85f;
        }
    }
}

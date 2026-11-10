using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public enum HudAnchor { TopLeft, TopCenter, TopRight, MiddleLeft, Center, MiddleRight, BottomLeft, BottomCenter, BottomRight }

    /// <summary>
    /// Construction helpers for legacy-anchored HUD elements. Positions are insets from the anchor in HUD units (1 unit = 1 legacy CSS px
    /// inside the HudStage), so the numbers in docs/rework/LEGACY_LAYOUT.md are used as written. All colour, font, radius and border
    /// choices are read from <see cref="UiTheme.Current"/>.
    /// </summary>
    public static class HudUi
    {
        static Vector2 Point(HudAnchor anchor)
        {
            switch (anchor)
            {
                case HudAnchor.TopLeft: return new Vector2(0, 1);
                case HudAnchor.TopCenter: return new Vector2(.5f, 1);
                case HudAnchor.TopRight: return new Vector2(1, 1);
                case HudAnchor.MiddleLeft: return new Vector2(0, .5f);
                case HudAnchor.MiddleRight: return new Vector2(1, .5f);
                case HudAnchor.BottomLeft: return new Vector2(0, 0);
                case HudAnchor.BottomCenter: return new Vector2(.5f, 0);
                case HudAnchor.BottomRight: return new Vector2(1, 0);
                default: return new Vector2(.5f, .5f);
            }
        }

        /// <summary>
        /// Places a fixed-size box. For a left/right anchor <paramref name="x"/> is the inset from that edge, for top/bottom <paramref name="y"/>
        /// is the inset from that edge, and for a centred axis the value is a signed offset (right and up positive).
        /// </summary>
        public static RectTransform Box(Transform parent, string name, HudAnchor anchor, float x, float y, float width, float height)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false);
            Place(rect, anchor, x, y, width, height);
            return rect;
        }

        public static void Place(RectTransform rect, HudAnchor anchor, float x, float y, float width, float height)
        {
            var p = Point(anchor);
            rect.anchorMin = rect.anchorMax = rect.pivot = p;
            float ax = p.x < .25f ? x : p.x > .75f ? -x : x;
            float ay = p.y < .25f ? y : p.y > .75f ? -y : y;
            rect.anchoredPosition = new Vector2(ax, ay);
            rect.sizeDelta = new Vector2(width, height);
        }

        /// <summary>A child that fills its parent with the given insets (left, top, right, bottom).</summary>
        public static RectTransform Inset(Transform parent, string name, float left, float top, float right, float bottom)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false);
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.pivot = new Vector2(.5f, .5f);
            rect.offsetMin = new Vector2(left, bottom); rect.offsetMax = new Vector2(-right, -top);
            return rect;
        }

        /// <summary>A fixed-size child placed from a parent's top-left corner (x right, y down), the way legacy flex rows read.</summary>
        public static RectTransform At(Transform parent, string name, float x, float y, float width, float height)
        {
            return Box(parent, name, HudAnchor.TopLeft, x, y, width, height);
        }

        /// <summary>
        /// Fills a rect with a themed rounded surface and an optional hairline frame drawn on top. A <paramref name="raised"/> surface
        /// (buttons, plates, cards) also gets a 2 unit drop shadow and a one unit inner highlight along its top edge.
        /// </summary>
        public static Image Surface(RectTransform rect, Color fill, float radius, Color? border = null, bool raycast = true, bool raised = false)
        {
            var theme = UiTheme.Current;
            var image = rect.GetComponent<Image>() ?? rect.gameObject.AddComponent<Image>();
            image.sprite = UiSprites.Panel(theme, radius); image.type = Image.Type.Sliced; image.color = fill; image.raycastTarget = raycast;
            foreach (string stale in new[] { "Gloss", "Frame" })
            {
                var existing = rect.Find(stale);
                if (existing != null) Object.DestroyImmediate(existing.gameObject);
            }
            var shadow = rect.GetComponent<Shadow>();
            if (raised)
            {
                if (shadow == null) shadow = rect.gameObject.AddComponent<Shadow>();
                shadow.effectColor = new Color(0f, 0f, 0f, .38f); shadow.effectDistance = new Vector2(0f, -2f); shadow.useGraphicAlpha = true;
                var gloss = Inset(rect, "Gloss", 0, 0, 0, 0).gameObject.AddComponent<Image>();
                gloss.sprite = UiSprites.Gloss(theme, radius); gloss.type = Image.Type.Sliced; gloss.color = new Color(1f, 1f, 1f, .16f); gloss.raycastTarget = false;
            }
            else if (shadow != null) Object.DestroyImmediate(shadow);
            if (border.HasValue && theme.BorderWidth > 0f)
            {
                var frame = Inset(rect, "Frame", 0, 0, 0, 0);
                var ring = frame.gameObject.AddComponent<Image>();
                ring.sprite = UiSprites.Frame(theme, radius); ring.type = Image.Type.Sliced; ring.color = border.Value; ring.raycastTarget = false;
            }
            return image;
        }

        /// <summary>Re-colours a Surface's frame (for state changes such as the active weapon slot).</summary>
        public static void SetFrame(RectTransform rect, Color color)
        {
            var frame = rect.Find("Frame");
            var ring = frame != null ? frame.GetComponent<Image>() : null;
            if (ring != null) ring.color = color;
        }

        /// <summary>A flat tinted rectangle with no sprite (meter fills, rules, bars).</summary>
        public static Image Fill(Transform parent, string name, Color color, bool raycast = false)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false);
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = rect.offsetMax = Vector2.zero;
            var image = rect.gameObject.AddComponent<Image>(); image.color = color; image.raycastTarget = raycast;
            return image;
        }

        /// <summary>A single-line (or wrapped) text label at an exact pixel size, in a theme font role.</summary>
        public static TMP_Text Label(Transform parent, string name, string text, float size, Color color,
            TextAlignmentOptions align = TextAlignmentOptions.MidlineLeft, bool bold = false, UiFontRole role = UiFontRole.Body, bool wrap = false)
        {
            var rect = (RectTransform)new GameObject(name, typeof(RectTransform)).transform;
            rect.SetParent(parent, false);
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = rect.offsetMax = Vector2.zero;
            var label = rect.gameObject.AddComponent<TextMeshProUGUI>();
            label.font = UiTheme.Current.Font(role);
            label.text = text ?? "";
            label.richText = false; label.raycastTarget = false;
            label.fontSize = size; label.enableAutoSizing = false;
            label.fontStyle = bold ? FontStyles.Bold : FontStyles.Normal;
            label.color = color; label.alignment = align;
            label.textWrappingMode = wrap ? TextWrappingModes.Normal : TextWrappingModes.NoWrap;
            label.overflowMode = TextOverflowModes.Ellipsis;
            label.margin = Vector4.zero;
            // TextMeshPro hides a line that is taller than its rect when the overflow mode is Ellipsis. Nunito's line box is about 1.36 em,
            // so a rect sized for a 1.2 em legacy line (a 12 to 15 unit row for 10 to 11 px text) would blank the text. Grow the rect
            // vertically, away from the aligned edge, so the line always fits and the text keeps its visual position.
            float lineGrow = Mathf.Ceil(size * .45f);
            switch (label.verticalAlignment)
            {
                case VerticalAlignmentOptions.Top: rect.offsetMin = new Vector2(0f, -lineGrow * 2f); break;
                case VerticalAlignmentOptions.Bottom: case VerticalAlignmentOptions.Baseline: rect.offsetMax = new Vector2(0f, lineGrow * 2f); break;
                default: rect.offsetMin = new Vector2(0f, -lineGrow); rect.offsetMax = new Vector2(0f, lineGrow); break;
            }
            var scale = rect.gameObject.AddComponent<MythicTextScale>(); scale.BaseSize = size;
            scale.Apply(ShowcaseSettings.Current != null ? ShowcaseSettings.Current.TextScale : 1f);
            return label;
        }

        /// <summary>A themed rounded button with a centred label; the colour block carries every state.</summary>
        public static Button Button(Transform parent, string name, string label, HudAnchor anchor, float x, float y, float width, float height,
            UnityAction onClick, float fontSize = 11f, float radius = -1f)
        {
            var theme = UiTheme.Current;
            var rect = Box(parent, name, anchor, x, y, width, height);
            var image = Surface(rect, Color.white, radius < 0f ? theme.CornerRadius : radius, theme.Border, true, true);
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image;
            ApplyColors(button, theme.SurfaceRaised);
            if (onClick != null) button.onClick.AddListener(onClick);
            if (!string.IsNullOrEmpty(label))
                Label(rect, "Label", label, fontSize, theme.TextPrimary, TextAlignmentOptions.Center);
            return button;
        }

        public static void ApplyColors(Selectable selectable, Color normal)
        {
            var theme = UiTheme.Current;
            var colors = selectable.colors;
            colors.normalColor = normal; colors.highlightedColor = theme.SurfaceHover; colors.selectedColor = theme.SurfaceHover;
            colors.pressedColor = theme.SurfaceSelected; colors.disabledColor = theme.SurfaceDisabled; colors.fadeDuration = .08f;
            selectable.colors = colors;
        }
    }
}

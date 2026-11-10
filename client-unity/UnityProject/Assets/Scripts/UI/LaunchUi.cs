using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// Construction helpers shared by the launch panel and the hub room. Positions are top-left insets in HUD units (see <see cref="HudUi"/>);
    /// every colour is read from <see cref="UiTheme.Current"/> at build time.
    /// </summary>
    public static class LaunchUi
    {
        public enum Look { Raised, Primary, Quiet, Outline }

        /// <summary>A themed button with no content yet. Raised = slate, Primary = gold fill with dark ink, Quiet = transparent until hovered, Outline = slate with a gold frame.</summary>
        public static Button Button(Transform parent, string name, float x, float y, float w, float h, Look look, UnityAction onClick, float radius = -1f)
        {
            var theme = UiTheme.Current;
            if (radius < 0f) radius = theme.CornerRadius;
            var rect = HudUi.At(parent, name, x, y, w, h);
            Color frame = look == Look.Primary || look == Look.Outline ? (Color)theme.BorderStrong : (Color)theme.Border;
            var image = HudUi.Surface(rect, Color.white, radius, look == Look.Quiet ? (Color?)null : frame, true, look != Look.Quiet);
            var button = rect.gameObject.AddComponent<Button>(); button.targetGraphic = image;
            var c = button.colors;
            if (look == Look.Primary)
            {
                c.normalColor = theme.AccentDim; c.highlightedColor = theme.Accent; c.selectedColor = theme.Accent;
                c.pressedColor = theme.AccentDim; c.disabledColor = theme.SurfaceDisabled;
            }
            else
            {
                c.normalColor = look == Look.Quiet ? Color.clear : (Color)theme.SurfaceRaised;
                c.highlightedColor = theme.SurfaceHover; c.selectedColor = theme.SurfaceHover;
                c.pressedColor = theme.SurfaceSelected; c.disabledColor = look == Look.Quiet ? Color.clear : (Color)theme.SurfaceDisabled;
            }
            c.fadeDuration = .08f;
            button.colors = c;
            if (onClick != null) button.onClick.AddListener(onClick);
            UiFocusHalo.Attach(button, radius);
            return button;
        }

        /// <summary>A positioned label (single line unless <paramref name="wrap"/>).</summary>
        public static TMP_Text Text(Transform parent, string name, float x, float y, float w, float h, string text, float size, Color color,
            TextAlignmentOptions align = TextAlignmentOptions.MidlineLeft, bool bold = false, UiFontRole role = UiFontRole.Body, bool wrap = false)
        {
            var rect = HudUi.At(parent, name + "Box", x, y, w, h);
            return HudUi.Label(rect, name, text, size, color, align, bold, role, wrap);
        }

        /// <summary>A tinted pictogram from <see cref="LaunchIcons"/>, centred in a size by size box whose top-left is (x, y).</summary>
        public static Image Icon(Transform parent, string name, LaunchIcon icon, float x, float y, float size, Color color)
        {
            var rect = HudUi.At(parent, name, x, y, size, size);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = LaunchIcons.Sprite(icon); image.color = color; image.raycastTarget = false; image.preserveAspect = true;
            return image;
        }

        /// <summary>A tinted faction/zone shape from <see cref="MapGlyphs"/>.</summary>
        public static Image Shape(Transform parent, string name, MapGlyph glyph, float x, float y, float size, Color color)
        {
            var rect = HudUi.At(parent, name, x, y, size, size);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = MapGlyphs.Sprite(glyph); image.color = color; image.raycastTarget = false; image.preserveAspect = true;
            return image;
        }

        /// <summary>A tinted weapon glyph from <see cref="MythicUi"/>.</summary>
        public static Image Weapon(Transform parent, string name, MythicGlyph glyph, float x, float y, float size, Color color)
        {
            var rect = HudUi.At(parent, name, x, y, size, size);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = MythicUi.GlyphSprite(glyph); image.color = color; image.raycastTarget = false; image.preserveAspect = true;
            return image;
        }

        /// <summary>A flat tinted bar (rules, accent strips) with rounded ends.</summary>
        public static Image Bar(Transform parent, string name, float x, float y, float w, float h, Color color)
        {
            var rect = HudUi.At(parent, name, x, y, w, h);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = UiSprites.Panel(UiTheme.Current, Mathf.Min(w, h) * .5f); image.type = Image.Type.Sliced; image.color = color; image.raycastTarget = false;
            return image;
        }

        /// <summary>A single-line text input in the theme's sunken look. The component is named <paramref name="name"/> and holds the text field.</summary>
        public static TMP_InputField Input(Transform parent, string name, string value, string placeholder, float x, float y, float w, float h, int limit)
        {
            var theme = UiTheme.Current;
            var rect = HudUi.At(parent, name, x, y, w, h);
            var back = HudUi.Surface(rect, theme.SurfaceSunken, theme.CornerRadius, theme.Border, true, false);
            var viewport = HudUi.Inset(rect, "Viewport", 10f, 0f, 10f, 0f);
            viewport.gameObject.AddComponent<RectMask2D>();
            var text = HudUi.Label(viewport, "Text", "", 15f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft);
            text.overflowMode = TextOverflowModes.Overflow;
            var hint = HudUi.Label(viewport, "Placeholder", placeholder, 15f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft);
            hint.overflowMode = TextOverflowModes.Overflow; hint.fontStyle = FontStyles.Italic;
            var input = rect.gameObject.AddComponent<TMP_InputField>();
            input.targetGraphic = back;
            input.textViewport = viewport; input.textComponent = (TextMeshProUGUI)text; input.placeholder = hint;
            input.characterLimit = limit; input.lineType = TMP_InputField.LineType.SingleLine; input.text = value ?? "";
            input.caretColor = theme.TextPrimary; input.customCaretColor = true; input.caretWidth = 2;
            input.selectionColor = UiTheme.With(theme.Accent, .4f);
            var colors = input.colors; colors.normalColor = Color.white; colors.highlightedColor = Color.white; colors.selectedColor = Color.white;
            colors.pressedColor = Color.white; colors.disabledColor = new Color(1f, 1f, 1f, .5f); input.colors = colors;
            input.transition = Selectable.Transition.None;
            UiFocusHalo.Attach(input, theme.CornerRadius);
            return input;
        }
    }
}

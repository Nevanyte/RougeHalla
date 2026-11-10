using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Colour accessors that forward to the active <see cref="UiTheme"/>.</summary>
    public static class ShowcasePalette
    {
        // Facade over the single theme seam (UiTheme.Current): kept so existing call sites reskin together.
        public static Color32 Background => UiTheme.Current.SurfaceSunken;
        public static Color32 Panel => UiTheme.Current.Surface;
        public static Color32 PanelRaised => UiTheme.Current.SurfaceRaised;
        public static Color32 PanelStroke => UiTheme.Current.Border;
        public static Color32 Text => UiTheme.Current.TextPrimary;
        public static Color32 MutedText => UiTheme.Current.TextSecondary;
        public static Color32 Gold => UiTheme.Current.Accent;
        public static Color32 GoldDim => UiTheme.Current.AccentDim;
        public static Color32 Success => UiTheme.Current.Success;
        public static Color32 Warning => UiTheme.Current.Warning;

        static readonly string[] FactionNames = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };

        public static Color32 Faction(int faction)
        {
            return UiTheme.Current.FactionColor(faction);
        }

        public static string GetFactionName(int faction)
        {
            return faction >= 0 && faction < FactionNames.Length ? FactionNames[faction] : "Unknown";
        }

        /// <summary>WCAG 2.1 relative-luminance contrast ratio, useful for UI palette checks.</summary>
        public static float ContrastRatio(Color foreground, Color background)
        {
            float a = RelativeLuminance(foreground);
            float b = RelativeLuminance(background);
            float lighter = Mathf.Max(a, b), darker = Mathf.Min(a, b);
            return (lighter + 0.05f) / (darker + 0.05f);
        }

        static float RelativeLuminance(Color color)
        {
            float r = Linear(color.r), g = Linear(color.g), b = Linear(color.b);
            return 0.2126f * r + 0.7152f * g + 0.0722f * b;
        }

        static float Linear(float value)
        {
            return value <= 0.04045f ? value / 12.92f : Mathf.Pow((value + 0.055f) / 1.055f, 2.4f);
        }
    }
}
